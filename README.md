# Mnemus

App de escritorio construida sobre [Opal](S:\tools\Opal).

```
npm run dev     # con la consola del renderer en la terminal
npm start
npm test
```

La referencia del sistema de diseño está en [docs/sistema.md](docs/sistema.md), y
la vitrina viva de todos los primitivos, dentro de la app en **Piezas**.

## Lo primero que conviene hacer

1. **La marca.** El cabujón es el placeholder de Opal. Está en dos lugares que
   tienen que coincidir: el splash de `renderer/index.html` y el ícono
   `opal` de `renderer/js/icons.js`.
2. **El vidrio.** `node tools/retint.mjs --blur 24 --fog 1.4` (y `--accent`,
   `--hue`, `--tint`). Deja en sincronía tokens.css, el fondo de la ventana
   y el del splash.
3. **Las vistas.** `renderer/js/app.js` trae una app demo funcionando. Vaciá
   las vistas y dejá el arranque.
4. **Los datos.** `src/store.cjs` declara los ajustes; `src/ipc.cjs`, qué
   puede pedir el renderer. La carpeta de datos se puede mover con `MNEMUS_DATA`.
