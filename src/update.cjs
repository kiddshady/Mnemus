'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — actualización automática
   Chequea GitHub Releases, descarga en segundo plano y avisa recién cuando el
   instalador ya está bajado y verificado. La app no se actualiza sola a la
   fuerza: se instala al cerrar (autoInstallOnAppQuit), o cuando el usuario
   aprieta «Reiniciar» en el toast.

   Por qué se avisa DESPUÉS de descargar y no antes: un aviso al detectar la
   versión te ofrece algo que todavía no tenés — si aceptás, esperás mirando
   una barra. Avisando al final, apretar «Reiniciar» tarda lo que tarda el
   instalador y nada más.

   ── Las tres trampas ───────────────────────────────────────────────────────
   1. En desarrollo NO hay nada que actualizar. `electron-updater` sin empacar
      revienta buscando app-update.yml; por eso ni se carga si !isPackaged.
      Esto además mantiene a `npm run dev` y al test de humo sin red.

   2. Un fallo del updater NO es un problema del usuario. Sin internet, con el
      repo caído o con un release a medio subir, el evento `error` llega igual.
      Se registra en consola y se sigue: una app de flashcards no puede
      interrumpir un repaso para contarte que no pudo mirar si hay versión
      nueva.

   3. El renderer puede recargarse (o montar tarde) DESPUÉS de que el update
      quedó listo, y ahí se perdería el evento. Por eso el estado se guarda
      acá y el renderer lo puede preguntar cuando arranca.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, ipcMain } = require('electron');

/** Cada cuánto se vuelve a mirar, con la app abierta. Cuatro horas es un
    número cómodo: no golpea la API y una sesión larga igual se entera. */
const INTERVALO = 4 * 60 * 60 * 1000;

/** Lo último que se descargó y quedó esperando, o null. */
let listo = null;
let timer = null;

/**
 * @param {() => import('electron').BrowserWindow | null} getWin
 */
function register(getWin) {
  // El renderer pregunta al montar: si el update se descargó antes de que
  // esta ventana existiera, igual se entera.
  ipcMain.handle('update:pending', () => listo);

  if (!app.isPackaged) {
    // En dev los canales existen igual, así el renderer no necesita saber si
    // está empaquetado: pide, le dicen que no hay nada, y sigue.
    ipcMain.handle('update:install', () => false);
    return;
  }

  const { autoUpdater } = require('electron-updater');

  autoUpdater.autoDownload = true;             // descarga sola, en segundo plano
  autoUpdater.autoInstallOnAppQuit = true;     // y se instala al cerrar la app
  autoUpdater.logger = null;

  const send = (canal, payload) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(canal, payload);
  };

  autoUpdater.on('update-downloaded', (info) => {
    listo = { version: info.version, notas: typeof info.releaseNotes === 'string' ? info.releaseNotes : null };
    console.log(`[update] ${info.version} descargada y lista`);
    send('update:ready', listo);
    // Ya está: dejar de preguntar hasta que reinicie.
    clearInterval(timer);
    timer = null;
  });

  autoUpdater.on('error', (err) => {
    // Trampa 2: se registra y se sigue. El usuario no se entera.
    console.error('[update]', err?.message || err);
  });

  ipcMain.handle('update:install', () => {
    if (!listo) return false;
    // (isSilent, isForceRunAfter): el que apretó «Reiniciar» espera que la app
    // vuelva sola, no quedarse mirando el instalador de NSIS.
    autoUpdater.quitAndInstall(true, true);
    return true;
  });

  const mirar = () => autoUpdater.checkForUpdates().catch(() => {});
  // No al instante: el arranque ya tiene bastante que hacer, y la primera
  // impresión de la app no debería competir con una descarga.
  setTimeout(mirar, 8000);
  timer = setInterval(mirar, INTERVALO);
}

module.exports = { register, INTERVALO };
