'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — el puente con el celular
   Un servidor HTTP chico, en la red local, por el que Mnemus Mobile se
   sincroniza. Solo existe mientras el interruptor de Ajustes › Celular está
   prendido: apagado, no hay puerto abierto.

   ── Dos rutas, y por qué una no pide clave ─────────────────────────────────
     GET  /api/ping   sin clave: «sí, acá hay un Mnemus».
     POST /api/sync   con clave: los hechos del celu entran, la instantánea sale.

   El ping abierto no expone nada (ni un dato de estudio) y es lo que deja al
   celu distinguir las dos fallas, que se arreglan distinto: «no llego a esa
   dirección» (Wi-Fi, IP, PC apagada, interruptor apagado) contra «llego, pero
   la clave no sirve» (copiala de nuevo).

   ── Por qué el puente no escribe el disco ──────────────────────────────────
   La ventana tiene todos los datos en memoria y es la única que escribe. Si
   este proceso guardara las fichas por su cuenta, la ventana abierta seguiría
   con su copia vieja y el próximo repaso en la PC pisaría el progreso del
   celu con ella. Así que el puente solo transporta: le pasa el paquete al
   renderer, el renderer lo aplica con sus helpers de siempre (ver
   recibirSincro en app.js) y devuelve la instantánea.

   ── Sin TLS, a propósito ───────────────────────────────────────────────────
   Es la red de tu casa y datos de estudio. La clave impide que otro aparato
   de la red escriba en tus fichas; cifrar exigiría certificados que el celu
   no puede verificar sin otra ceremonia. No se expone a internet: nada de
   port-forward.
   ═══════════════════════════════════════════════════════════════════════════ */

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { app, ipcMain } = require('electron');
const store = require('./store.cjs');

/** Un paquete de sincronía son hechos chiquitos: miles de repasos no llegan
    a 1 MB. Más que esto es otra cosa, y no se lee entero a memoria. */
const MAX_BODY = 5 * 1024 * 1024;
/** Lo que se espera a que la ventana aplique. Aplicar son escrituras de
    archivos chicos: si tarda esto, algo se colgó. */
const TIMEOUT = 20_000;

/* Sin 0/o ni 1/l/i: la clave se copia a mano mirando la pantalla de la PC. */
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';

let server = null;
/** El último error al abrir el puerto (EADDRINUSE, EACCES), o null. */
let error = null;
/** @type {() => (import('electron').BrowserWindow | null)} */
let getWin = () => null;

const esperando = new Map();
let seq = 0;

function nuevaClave() {
  return [...crypto.randomBytes(20)].map((b) => ALFABETO[b % ALFABETO.length]).join('');
}

/** Las IPv4 de esta máquina que un celu puede alcanzar. Tailscale va con su
    nombre: es la que sirve también fuera de casa. */
function direcciones() {
  const out = [];
  for (const [nombre, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (i.address.startsWith('169.254.')) continue;          // sin DHCP: no llega nadie
      const tailscale = /tailscale/i.test(nombre) || i.address.startsWith('100.');
      out.push({ nombre: tailscale ? 'Tailscale' : nombre, ip: i.address, tailscale });
    }
  }
  // La de la red de casa primero: es la que se usa casi siempre.
  return out.sort((a, b) => Number(a.tailscale) - Number(b.tailscale));
}

async function config() {
  const s = await store.loadSettings();
  return s.movil;
}

async function estado() {
  const c = await config();
  return {
    activo: !!c.activo,
    escuchando: !!server,
    puerto: c.puerto,
    clave: c.clave,
    direcciones: direcciones(),
    error,
  };
}

function igualSeguro(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function responder(res, status, obj) {
  const cuerpo = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
  });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) {
        reject(Object.assign(new Error('El paquete es demasiado grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

/** Le pasa el paquete a la ventana y espera su respuesta (movil:respuesta). */
function pedirAlRenderer(paquete) {
  const win = getWin();
  if (!win || win.isDestroyed()) {
    return Promise.reject(Object.assign(new Error('La ventana de Mnemus no está abierta.'), { status: 503 }));
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      esperando.delete(id);
      reject(Object.assign(new Error('Mnemus en la PC no respondió a tiempo.'), { status: 504 }));
    }, TIMEOUT);
    esperando.set(id, { resolve, reject, timer });
    win.webContents.send('movil:sync', id, paquete);
  });
}

ipcMain.on('movil:respuesta', (_e, id, res) => {
  const p = esperando.get(id);
  if (!p) return;                       // llegó tarde: el timeout ya contestó
  esperando.delete(id);
  clearTimeout(p.timer);
  if (res?.ok) p.resolve(res.data);
  else p.reject(Object.assign(new Error(res?.error || 'No se pudo aplicar la sincronía.'), { status: 409 }));
});

async function atender(req, res) {
  const ruta = (req.url || '').split('?')[0];

  if (req.method === 'GET' && ruta === '/api/ping') {
    return responder(res, 200, { app: 'mnemus', version: app.getVersion() });
  }

  if (req.method === 'POST' && ruta === '/api/sync') {
    const { clave } = await config();
    const dada = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!clave || !igualSeguro(dada, clave)) {
      return responder(res, 401, { error: 'La clave no coincide con la de la PC.' });
    }
    let paquete;
    try {
      paquete = JSON.parse(await leerCuerpo(req));
    } catch (err) {
      return responder(res, err.status || 400, { error: err.status ? err.message : 'El paquete no es JSON válido.' });
    }
    try {
      return responder(res, 200, await pedirAlRenderer(paquete));
    } catch (err) {
      return responder(res, err.status || 500, { error: err.message });
    }
  }

  return responder(res, 404, { error: 'No existe esa ruta.' });
}

function abrir(puerto) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      atender(req, res).catch((err) => {
        console.error('[puente]', err);
        if (!res.headersSent) responder(res, 500, { error: 'Error interno del puente.' });
      });
    });
    s.once('error', (err) => {
      error = err.code === 'EADDRINUSE'
        ? `El puerto ${puerto} ya lo está usando otro programa.`
        : `No se pudo abrir el puerto ${puerto} (${err.code || err.message}).`;
      console.error('[puente]', err.message);
      resolve(null);
    });
    // 0.0.0.0: el celu llega por la IP de la red local (o la de Tailscale).
    s.listen(puerto, '0.0.0.0', () => { error = null; resolve(s); });
  });
}

function cerrar() {
  if (!server) return Promise.resolve();
  const s = server;
  server = null;
  return new Promise((resolve) => s.close(() => resolve()));
}

/** Deja el servidor como dicen los ajustes: abierto si está activo, cerrado si no. */
async function sincronizarServidor() {
  const c = await config();
  if (c.activo && !server) server = await abrir(c.puerto);
  if (!c.activo) { await cerrar(); error = null; }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[puente] ${channel}:`, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function register(ventana) {
  getWin = ventana;

  handle('movil:estado', estado);

  handle('movil:activar', async (activo) => {
    const c = await config();
    // La clave nace la primera vez que se prende: no hay puerto sin clave.
    await store.saveSettings({ movil: { ...c, activo: !!activo, clave: c.clave || nuevaClave() } });
    await sincronizarServidor();
    return estado();
  });

  handle('movil:regenerar', async () => {
    const c = await config();
    await store.saveSettings({ movil: { ...c, clave: nuevaClave() } });
    return estado();
  });

  sincronizarServidor().catch((err) => console.error('[puente] no arrancó:', err));
  app.on('before-quit', () => { cerrar(); });
}

module.exports = { register, nuevaClave, direcciones };
