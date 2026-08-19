'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — puente IPC
   El renderer no tiene fs, ni require, ni red: `contextIsolation` está activo.
   Todo lo que necesite del sistema pasa por acá, y acá se decide qué se puede
   pedir. Es la superficie de ataque de la app: todo lo que agregues es una
   puerta más.

   Convención: cada handler devuelve {ok:true, data} o {ok:false, error}. El
   preload la desenvuelve y convierte el error en una excepción real, así el
   renderer escribe try/catch normal en vez de chequear banderas.
   ═══════════════════════════════════════════════════════════════════════════ */

const { ipcMain, app, dialog, BrowserWindow } = require('electron');
const fsp = require('fs/promises');
const store = require('./store.cjs');

/* Un archivo de intercambio no pesa más que esto ni de casualidad: 10 MB son
   decenas de miles de fichas. Leer sin techo es dejar que cualquier archivo
   que el usuario elija por error se coma la memoria del proceso. */
const MAX_BYTES = 10 * 1024 * 1024;

/* Las colecciones que el renderer puede tocar. Es una lista blanca a
   propósito: sin ella, cualquier bug en el renderer puede crear carpetas
   sueltas en tu directorio de datos. Agregá las tuyas acá. */
const COLLECTIONS = ['mazos', 'fichas'];

function coll(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`colección no permitida: ${name}`);
  return store.collection(name);
}

/** Envuelve un handler para que un throw viaje como error y no como crash. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function register() {
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataDir: store.ROOT,
    electron: process.versions.electron,
  }));

  handle('settings:get', () => store.loadSettings());
  handle('settings:save', (patch) => store.saveSettings(patch));

  handle('doc:read', (name, fallback = null) => store.doc(name, fallback).read());
  handle('doc:write', (name, data) => store.doc(name).write(data).then(() => true));

  /* ── Archivos de intercambio ───────────────────────────────────────────────
     La RUTA la elige el usuario en el diálogo del sistema, nunca el renderer:
     eso es lo que hace seguros a estos dos canales. Un `file:write(ruta)` que
     acepte una ruta del renderer es un primitivo para escribir en cualquier
     parte del disco; este no lo es. */

  handle('file:save-json', async (nombreSugerido, data) => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Exportar',
      defaultPath: String(nombreSugerido || 'mnemus.json'),
      filters: [{ name: 'Mazo de Mnemus', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return filePath;
  });

  handle('file:open-json', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Importar mazo',
      filters: [{ name: 'Mazo de Mnemus', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const file = filePaths?.[0];
    if (canceled || !file) return null;

    const { size } = await fsp.stat(file);
    if (size > MAX_BYTES) throw new Error('El archivo es demasiado grande para ser un mazo.');

    const texto = await fsp.readFile(file, 'utf8');
    try {
      return { path: file, data: JSON.parse(texto) };
    } catch {
      // El SyntaxError crudo ("Unexpected token < in JSON at position 0") no
      // le dice nada a nadie. Lo que hay que saber es que el archivo no sirve.
      throw new Error('El archivo no es un JSON válido.');
    }
  });

  handle('col:list', (name) => coll(name).list());
  handle('col:get', (name, id) => coll(name).get(id));
  handle('col:save', (name, item) => coll(name).save(item));
  handle('col:remove', (name, id) => coll(name).remove(id).then(() => true));
  handle('col:next-id', (name, prefix) => coll(name).nextId(prefix));
}

module.exports = { register, COLLECTIONS };
