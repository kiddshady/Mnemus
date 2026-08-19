/* ═══════════════════════════════════════════════════════════════════════════
   Humo del renderer: monta MNEMUS de verdad y la recorre.

   Se corre con `npm run smoke` (necesita Electron, por eso no está en el
   `npm test`, que es node pelado).

   Lo que busca es lo que un test de unidad NO ve: overlays que aterrizan fuera
   de pantalla, vistas que no montan, el velo que no tapa la respuesta, una
   calificación que no llega al disco. La regla que lo guía: **medí dónde CAE
   una cosa y qué QUEDÓ en disco, no solo si existe**.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const W = 1440; const H = 900;

const BG_MAIN = (fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8')
  .match(/const BG = '(#[0-9a-f]{6})'/i)?.[1] || '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };
const bail = (w, e) => { console.log(`ABORTADO ${w}`, e?.stack || e || ''); app.exit(3); };
process.on('unhandledRejection', (e) => bail('rechazo', e));
process.on('uncaughtException', (e) => bail('excepción', e));
setTimeout(() => bail('timeout de 150s'), 150000);

app.whenReady().then(async () => {
  require(path.join(ROOT, 'src', 'ipc.cjs')).register();

  const win = new BrowserWindow({
    x: -20000, y: -20000, width: W, height: H,
    frame: false, show: false, paintWhenInitiallyHidden: true, backgroundColor: '#000',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  const errores = [];
  win.webContents.on('console-message', (e) => { if (e.level >= 2) errores.push(`${e.level}: ${e.message}`); });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.show();
  await sleep(2600);

  const js = (c) => win.webContents.executeJavaScript(c);
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; el.click(); return true; })()`);
  // Un click real es pointerdown → pointerup → click: varios overlays cierran
  // en pointerdown y con el().click() solo, ese orden nunca se prueba.
  const tap = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    el.click(); return true; })()`);
  const escape = () => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });

  console.log('\n1. Arranque');
  ok('el splash se fue', !(await js(`!!document.getElementById('boot-splash')`)));
  ok('el shell está montado', await js(`!!document.querySelector('.op-titlebar') && !!document.querySelector('.op-rail')`));
  ok('los <i data-icon> se reemplazaron por SVG', !(await js(`!!document.querySelector('i[data-icon]')`)));
  ok('la vista inicial pintó algo', (await js(`document.getElementById('view').children.length`)) > 0);
  // El primer arranque siembra un mazo real: la app nunca nace vacía.
  const mazosSemilla = await js(`window.opal.col('mazos').list().then(l => l.length)`);
  ok('hay al menos un mazo (la semilla o los del usuario)', mazosSemilla >= 1, String(mazosSemilla));

  console.log('\n2. Crear por la UI real: mazo → ficha → disco');
  await click('[data-action="nuevo-mazo"]');
  await sleep(600);
  ok('el modal de mazo abre', await js(`!!document.querySelector('.op-modal')`));
  await js(`(() => { document.querySelector('.op-modal input.op-input').value = 'Humo'; return true; })()`);
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1200);

  const mazoTest = await js(`window.opal.col('mazos').list().then(l => l.find(m => m.name === 'Humo') || null)`);
  const mazoId = mazoTest?.id;
  // Todo mazo que cree el test se anota acá para borrarlo al final: los datos
  // son del usuario, y un test que deja basura adentro no se puede correr dos
  // veces sin ensuciar la app de verdad.
  const creados = mazoId ? [mazoId] : [];
  ok('el mazo quedó en disco con id asignado', !!mazoId, JSON.stringify(mazoTest));
  ok('el router saltó a su detalle', (await js(`document.querySelector('.op-viewhead__title')?.textContent`)) === 'Humo');
  ok('la titlebar muestra el contexto', (await js(`document.getElementById('titlebar-context').textContent.trim()`)) === 'Humo');

  await click('[data-action="nueva-ficha"]');
  await sleep(600);
  ok('el modal de ficha abre', await js(`!!document.querySelector('#f-front')`));
  await js(`(() => { document.getElementById('f-front').value = '¿Humo?';
    document.getElementById('f-back').value = 'Sí: creado por el test.'; return true; })()`);
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1200);

  const fichaTest = await js(`window.opal.col('fichas').list().then(l => l.find(f => f.front === '¿Humo?') || null)`);
  ok('la ficha quedó en disco, en su mazo', fichaTest?.mazo === mazoId, JSON.stringify(fichaTest));
  ok('nació con srs de ficha nueva', fichaTest?.srs?.reps === 0 && fichaTest?.srs?.ease === 2.5);
  ok('los ajustes persisten', (await js(`window.opal.settings.save({ nuevasPorDia: 7 }).then(s => s.nuevasPorDia)`)) === 7);

  console.log('\n3. Todas las vistas montan');
  for (const v of ['mazos', 'piezas', 'ajustes', 'inicio']) {
    await click(`[data-view="${v}"]`);
    await sleep(700);
    const hijos = await js(`document.getElementById('view').children.length`);
    const activo = await js(`!!document.querySelector('[data-view="${v}"].is-active')`);
    ok(`${v}: pinta y queda activa en el rail`, hijos > 0 && activo, `hijos=${hijos} activo=${activo}`);
  }

  console.log('\n4. El repaso: velo, revelado y la srs en el disco');
  await click('[data-view="mazos"]');
  await sleep(600);
  ok('el mazo aparece en la lista', await click(`[data-open-mazo="${mazoId}"]`));
  await sleep(800);
  ok('el rail sigue marcando la sección padre', await js(`!!document.querySelector('[data-view="mazos"].is-active')`));
  ok('las migas llevan de vuelta', await js(`!!document.querySelector('[data-goto="mazos"]')`));

  await click(`[data-action="repasar"][data-arg="${mazoId}"]`);
  await sleep(900);
  ok('la sesión abre con la ficha', await js(`!!document.querySelector('.mn-ficha')`));
  ok('el frente se ve', (await js(`document.querySelector('.mn-ficha__front')?.textContent.trim()`)) === '¿Humo?');

  /* La garantía es ESTRUCTURAL, no cosmética: la respuesta ni siquiera está
     pintada antes de revelar (visibility:hidden). Un velo que solo tapa
     depende del compositor — y el compositor ya nos mintió una vez: con la
     animación de vista retenida, el blur computaba pero no pintaba. */
  const velo = await js(`(() => {
    const v = document.getElementById('velo');
    const back = document.getElementById('back');
    if (!v || !back) return null;
    const rv = v.getBoundingClientRect(); const rb = back.getBoundingClientRect();
    return {
      cubre: rv.top <= rb.top + 1 && rv.bottom >= rb.bottom - 1 && rv.left <= rb.left + 1 && rv.right >= rb.right - 1,
      backSinPintar: getComputedStyle(back).visibility === 'hidden',
      vidrio: getComputedStyle(v).backdropFilter,
      califOculta: getComputedStyle(document.getElementById('calif')).visibility === 'hidden',
    };
  })()`);
  ok('la respuesta NI SIQUIERA está pintada todavía', velo?.backSinPintar, JSON.stringify(velo));
  ok('el velo cubre su zona entera', velo?.cubre);
  ok('y es vidrio (blur en el computado)', /blur\(/.test(velo?.vidrio || ''), String(velo?.vidrio));
  ok('la calificación todavía no se ofrece', velo?.califOculta);

  await click('#velo');
  await sleep(600);
  ok('revelar pinta la respuesta',
    await js(`getComputedStyle(document.getElementById('back')).visibility === 'visible'`));
  ok('y saca el velo del DOM', !(await js(`!!document.getElementById('velo')`)));
  ok('y la calificación aflora', await js(`document.getElementById('calif').classList.contains('is-on')`));

  await click('[data-grado="4"]');   // «Bien»
  await sleep(1000);

  const srsTras = await js(`window.opal.col('fichas').get(${JSON.stringify(fichaTest.id)}).then(f => f.srs)`);
  ok('la calificación llegó al disco: reps 1', srsTras?.reps === 1, JSON.stringify(srsTras));
  ok('con intervalo de 1 día', srsTras?.interval === 1);
  ok('y vence en el futuro', srsTras?.due > Date.now());
  ok('la sesión terminó con su resumen', await js(`!!document.querySelector('.mn-fin')`));

  /* Los tipos que se contestan eligiendo. Lo que se mide acá no es que las
     alternativas existan, sino que el resultado quede BIEN REPARTIDO: una
     correcta, una errada y el resto apagadas. Un bug que marque dos correctas
     —o ninguna— se ve idéntico en el DOM si solo contás elementos. */
  console.log('\n4-bis. Opción múltiple: elegir, corregir y sugerir');
  await click('[data-view="mazos"]');
  await sleep(600);
  await click(`[data-open-mazo="${mazoId}"]`);
  await sleep(700);
  await click('[data-action="nueva-ficha"]');
  await sleep(600);

  await click('#f-tipo [data-value="opcion"]');
  await sleep(500);
  ok('el modal ofrece los tres tipos', (await js(`document.querySelectorAll('#f-tipo .op-segmented__opt').length`)) === 3);
  ok('y abre 4 alternativas vacías', (await js(`document.querySelectorAll('[data-alt]').length`)) === 4);
  await js(`(() => {
    document.getElementById('f-front').value = '¿Cuál de estas es la correcta?';
    document.getElementById('f-back').value = 'La tercera: la escribió el test.';
    ['una', 'otra', 'la correcta', 'ninguna'].forEach((v, i) => {
      document.querySelector('[data-alt="' + i + '"]').value = v;
    });
    return true; })()`);
  await click('[data-correcta="2"]');
  await sleep(300);
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1200);

  // Por el frente, no por el tipo: el directorio de datos puede tener mazos
  // reales con fichas de opción múltiple, y `find` agarraría cualquiera.
  const mc = await js(`window.opal.col('fichas').list()
    .then(l => l.find(f => f.front === '¿Cuál de estas es la correcta?') || null)`);
  ok('la ficha de opción múltiple llegó al disco', !!mc, JSON.stringify(mc));
  ok('con sus 4 alternativas', mc?.opciones?.length === 4, JSON.stringify(mc?.opciones));
  ok('y la correcta apuntando a la tercera', mc?.opciones?.[mc?.correcta] === 'la correcta', String(mc?.correcta));

  await click(`[data-action="repasar"][data-arg="${mazoId}"]`);
  await sleep(900);
  ok('la ficha se monta en su variante interactiva', await js(`!!document.querySelector('.mn-ficha--interactiva')`));
  ok('con una alternativa por opción', (await js(`document.querySelectorAll('.mn-opcion').length`)) === 4);
  ok('rotuladas A, B, C, D',
    (await js(`[...document.querySelectorAll('.mn-opcion__letra')].map(e => e.textContent.trim()).join('')`)) === 'ABCD');
  ok('el velo sigue tapando la explicación',
    await js(`getComputedStyle(document.getElementById('back')).visibility === 'hidden'`));

  await click('.mn-opcion[data-opcion="1"]');       // la B: incorrecta a propósito
  await sleep(700);
  const reparto = await js(`JSON.stringify({
    correcta: [...document.querySelectorAll('.mn-opcion')].findIndex(e => e.classList.contains('is-correcta')),
    errada: [...document.querySelectorAll('.mn-opcion')].findIndex(e => e.classList.contains('is-errada')),
    apagadas: document.querySelectorAll('.mn-opcion.is-apagada').length,
    marcas: document.querySelectorAll('.mn-opcion__marca .op-icon').length,
    sugerido: document.querySelector('#calif .is-sugerido')?.dataset.grado,
    velo: !!document.getElementById('velo'),
    back: getComputedStyle(document.getElementById('back')).visibility,
  })`);
  const r = JSON.parse(reparto);
  ok('la C quedó marcada como la correcta', r.correcta === 2, reparto);
  ok('la B elegida quedó marcada como errada', r.errada === 1, reparto);
  ok('las otras dos se apagaron', r.apagadas === 2, reparto);
  ok('hay exactamente dos símbolos, no cuatro', r.marcas === 2, reparto);
  ok('elegir revela: el velo se fue', !r.velo);
  ok('y la explicación se pintó', r.back === 'visible');
  ok('errar sugiere «Otra vez» (grado 0)', r.sugerido === '0', reparto);

  await click('[data-grado="0"]');
  await sleep(1000);
  const srsMc = await js(`window.opal.col('fichas').get(${JSON.stringify(mc.id)}).then(f => f.srs)`);
  ok('el olvido llegó al disco', srsMc?.lapses === 1 && srsMc?.reps === 0, JSON.stringify(srsMc));
  ok('y la ficha vuelve en la misma sesión', await js(`!!document.querySelector('.mn-ficha')`));

  /* Un mazo que se manda por chat. Lo único que se reemplaza son los dos
     diálogos NATIVOS de archivo —son de Electron, no código nuestro, y
     bloquearían el test— por una ruta fija en el temp del sistema. Todo lo
     demás es el camino de producción.

     Lo que se mide es el VIAJE COMPLETO: un formato que pierde un campo en el
     camino no da error, da un mazo silenciosamente incompleto del otro lado,
     en la máquina de otra persona, donde nadie lo va a notar hasta que la
     respuesta correcta esté mal. */
  console.log('\n4-ter. Exportar e importar un mazo');
  const archivo = path.join(app.getPath('temp'), 'mnemus-humo.test.json');
  fs.rmSync(archivo, { force: true });
  ipcMain.removeHandler('file:save-json');
  ipcMain.removeHandler('file:open-json');
  ipcMain.handle('file:save-json', (_e, _nombre, data) => {
    fs.writeFileSync(archivo, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, data: archivo };
  });
  ipcMain.handle('file:open-json', () => ({
    ok: true, data: { path: archivo, data: JSON.parse(fs.readFileSync(archivo, 'utf8')) },
  }));

  await click('[data-view="mazos"]');
  await sleep(700);
  await click(`[data-open-mazo="${mazoId}"]`);
  await sleep(700);
  await click('[data-menu="mazo"]');
  await sleep(500);
  const exportarItem = await js(`(() => {
    const it = [...document.querySelectorAll('.op-menuitem')].find(e => e.textContent.includes('Exportar'));
    if (!it) return false; it.click(); return true; })()`);
  ok('el menú del mazo ofrece exportar', exportarItem);
  await sleep(1200);

  ok('el archivo se escribió', fs.existsSync(archivo));
  const paquete = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : null;
  ok('declara formato y versión', paquete?.formato === 'mnemus/mazos' && paquete?.version === 1);
  ok('trae el mazo con sus 2 fichas', paquete?.mazos?.[0]?.fichas?.length === 2, JSON.stringify(paquete?.mazos?.[0]?.fichas?.length));
  ok('ninguna ficha lleva id: los asigna quien importa',
    paquete?.mazos?.[0]?.fichas?.every((f) => !f.id));
  ok('la de opción múltiple viajó entera',
    paquete?.mazos?.[0]?.fichas?.some((f) => f.tipo === 'opcion' && f.opciones?.length === 4),
    JSON.stringify(paquete?.mazos?.[0]?.fichas?.map((f) => f.tipo)));

  const mazosAntes = await js(`window.opal.col('mazos').list().then(l => l.length)`);
  // Importar vive en la vista Mazos; exportar dejó al router en el detalle.
  await click('[data-view="mazos"]');
  await sleep(700);
  await click('[data-action="importar"]');
  await sleep(1300);
  ok('el modal de importar abre', await js(`!!document.querySelector('.op-modal')`));
  ok('y dice qué está por entrar',
    (await js(`document.querySelector('.op-modal')?.textContent || ''`)).includes('Humo'));
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1800);

  const mazosDespues = await js(`window.opal.col('mazos').list()`);
  ok('quedó un mazo más', mazosDespues.length === mazosAntes + 1, `${mazosAntes} → ${mazosDespues.length}`);
  const importado = mazosDespues.find((m) => m.name === 'Humo' && m.id !== mazoId);
  ok('con un id propio, distinto del original', !!importado, JSON.stringify(mazosDespues.map((m) => m.id)));

  const fichasImportadas = await js(`window.opal.col('fichas').list()
    .then(l => l.filter(f => f.mazo === ${JSON.stringify(importado?.id || '')}))`);
  ok('con sus 2 fichas', fichasImportadas.length === 2, String(fichasImportadas.length));
  ok('sin heredar los ids del origen', fichasImportadas.every((f) => f.id !== fichaTest.id));
  ok('entran como nuevas, sin el historial ajeno',
    fichasImportadas.every((f) => f.srs.reps === 0 && f.srs.lapses === 0));
  const mcImportada = fichasImportadas.find((f) => f.tipo === 'opcion');
  ok('la de opción múltiple conserva su respuesta correcta',
    mcImportada?.opciones?.[mcImportada?.correcta] === 'la correcta',
    JSON.stringify(mcImportada?.opciones));

  if (importado) creados.push(importado.id);
  fs.rmSync(archivo, { force: true });

  console.log('\n5. Overlays: dónde caen, no solo si existen');
  await click('[data-view="inicio"]');
  await sleep(700);
  await click('[data-menu="mazo"]');
  await sleep(400);
  const menu = await js(`(() => { const m=document.querySelector('.op-menu'); if(!m) return null;
    const r=m.getBoundingClientRect(); return {t:Math.round(r.top),l:Math.round(r.left),b:Math.round(r.bottom),rt:Math.round(r.right)}; })()`);
  ok('el menú del mazo abre dentro de la ventana',
    menu && menu.t >= 0 && menu.l >= 0 && menu.b <= H && menu.rt <= W, JSON.stringify(menu));
  await js(`document.body.click(); true`); await sleep(300);

  await click('#btn-palette');
  await sleep(500);
  const pal = await js(`(() => { const p=document.querySelector('.op-palette'); if(!p) return null;
    const r=p.getBoundingClientRect(); return {t:Math.round(r.top),cx:Math.round(r.left+r.width/2)}; })()`);
  ok('la paleta abre centrada y visible', pal && pal.t > 0 && Math.abs(pal.cx - W / 2) < 4, JSON.stringify(pal));

  const ph = await js(`document.querySelector('.op-palette__input')?.placeholder || ''`);
  ok('con una pista en el campo vacío', ph.length > 3, ph);
  ok('y con el vocabulario de ESTA app', /mazo/i.test(ph), ph);

  await click('.op-scrim'); await sleep(400);

  await click('[data-view="piezas"]');
  await sleep(900);
  await click('#demo-modal');
  await sleep(600);
  const modal = await js(`(() => { const m=document.querySelector('.op-modal'); if(!m) return null;
    const r=m.getBoundingClientRect(); return {cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),t:Math.round(r.top)}; })()`);
  ok('el modal queda CENTRADO en la ventana',
    modal && Math.abs(modal.cx - W / 2) < 4 && Math.abs(modal.cy - H / 2) < 4 && modal.t > 0, JSON.stringify(modal));
  await click('[data-dismiss]'); await sleep(400);

  // El toggle del menú: volver a tocar el botón que lo abrió TIENE que cerrarlo.
  const abierto = () => js(`!!document.querySelector('.op-menu')`);
  await tap('#demo-select');
  await sleep(400);
  ok('el select abre su menú', await abierto());
  await tap('#demo-select');
  await sleep(500);
  ok('volver a tocarlo lo CIERRA (no rebota)', !(await abierto()));
  ok('y el ancla suelta el estado abierto', !(await js(`!!document.querySelector('#demo-select.is-open')`)));

  await tap('#demo-select');
  await sleep(400);
  await js(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(500);
  ok('y un click afuera también lo cierra', !(await abierto()));

  /* ── 5-bis. Escape con un menú abierto encima de un modal ────────────────── */
  console.log('\n5-bis. Escape se lleva el menú, no el diálogo de atrás');
  await click('#demo-modal');
  await sleep(600);
  await click('#demo-select');
  await sleep(400);
  const hayModal = () => js(`!!document.querySelector('.op-modal')`);
  ok('con el diálogo abierto, el menú abre encima', (await abierto()) && (await hayModal()));

  escape();
  await sleep(600);
  ok('el primer Escape cierra SOLO el menú', !(await abierto()));
  ok('y el diálogo sigue en pie', await hayModal());

  escape();
  await sleep(600);
  ok('el segundo Escape sí cierra el diálogo', !(await hayModal()));

  /* ── 6. El medidor indeterminado ─────────────────────────────────────────── */
  console.log('\n6. El medidor indeterminado nunca deja la pista vacía');
  const pista = await js(`(async () => {
    const m = document.querySelector('.op-meter--indeterminate');
    const f = m && m.querySelector('.op-meter__fill');
    if (!f) return { error: 'no existe' };
    const muestras = [];
    for (let i = 0; i < 40; i++) {
      const p = m.getBoundingClientRect(); const r = f.getBoundingClientRect();
      muestras.push(Math.min(r.right, p.right) - Math.max(r.left, p.left));
      await new Promise(res => setTimeout(res, 50));
    }
    let racha = 0; let peor = 0;
    for (const v of muestras) { if (v < 1) { racha++; peor = Math.max(peor, racha); } else racha = 0; }
    return { peor, min: Math.round(Math.min(...muestras) * 100) / 100, n: muestras.length };
  })()`);
  ok('la barra nunca falta dos muestras seguidas',
    pista && !pista.error && pista.peor <= 1, JSON.stringify(pista));

  console.log('\n6-bis. El campo numérico y sus flechas');
  const paso = await js(`(async () => {
    const root = document.getElementById('demo-stepper');
    if (!root) return { error: 'no existe el stepper' };
    const input = root.querySelector('input[type="number"]');
    const arriba = root.querySelector('[data-step="up"]');
    const abajo = root.querySelector('[data-step="down"]');

    let cambios = 0;
    input.addEventListener('change', () => cambios++);

    const tocar = (b) => {
      const o = { bubbles: true, pointerId: 1, pointerType: 'mouse' };
      b.dispatchEvent(new PointerEvent('pointerdown', o));
      b.dispatchEvent(new PointerEvent('pointerup', o));
    };

    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    tocar(arriba);
    const trasSubir = input.value;
    tocar(abajo); tocar(abajo);
    const trasBajar = input.value;
    const abajoApagado = abajo.disabled;

    for (let i = 0; i < 20; i++) tocar(arriba);
    const tope = input.value;
    const arribaApagado = arriba.disabled;

    return {
      trasSubir, trasBajar, tope, cambios, abajoApagado, arribaApagado,
      apariencia: getComputedStyle(input).appearance,
    };
  })()`);
  ok('subir suma uno', paso.trasSubir === '2', JSON.stringify(paso));
  ok('bajar no pasa del mínimo', paso.trasBajar === '1', paso.trasBajar);
  ok('y ahí la flecha de abajo se apaga', paso.abajoApagado === true);
  ok('no pasa del máximo', paso.tope === '12', paso.tope);
  ok('y ahí se apaga la de arriba', paso.arribaApagado === true);
  ok('cada paso real despacha change', paso.cambios === 13, `${paso.cambios}`);
  ok('el input no muestra el control nativo', paso.apariencia === 'textfield', paso.apariencia);

  console.log('\n7. La fuente empaquetada carga de verdad');
  const fuente = await js(`(async () => {
    await document.fonts.ready;
    const cargadas = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ':' + f.weight);
    const medir = (fam) => { const s = document.createElement('span');
      s.style.cssText = 'position:fixed;left:-9999px;font-size:64px;white-space:pre;font-family:' + fam;
      s.textContent = 'MMMiiilll0O1'; document.body.appendChild(s);
      const w = s.getBoundingClientRect().width; s.remove(); return Math.round(w); };
    return {
      cargadas,
      declarada: getComputedStyle(document.documentElement).getPropertyValue('--op-mono').trim(),
      roboto: medir("'Roboto Mono'"), serif: medir('serif'),
      disponible: document.fonts.check('400 13px "Roboto Mono"'),
    };
  })()`);
  ok('el @font-face resolvió a archivos reales', fuente.cargadas.length > 0, JSON.stringify(fuente.cargadas));
  ok('Roboto Mono está disponible para pintar', fuente.disponible, JSON.stringify(fuente));
  ok('y NO está cayendo a la de respaldo', fuente.roboto !== fuente.serif, `roboto=${fuente.roboto} serif=${fuente.serif}`);
  ok('la familia efectiva es la empaquetada', fuente.declarada.includes('Roboto Mono'), fuente.declarada);

  console.log('\n8. Las perillas re-tintan de verdad');
  const antes = await js(`getComputedStyle(document.body).backgroundColor`);
  await js(`(() => { const h=document.getElementById('knob-hue'); h.value=30; h.dispatchEvent(new Event('input')); return true; })()`);
  await sleep(300);
  ok('cambiar el matiz cambia el fondo computado', (await js(`getComputedStyle(document.body).backgroundColor`)) !== antes);
  await click('#knob-reset');
  await sleep(300);
  ok('el reset vuelve al original', (await js(`getComputedStyle(document.body).backgroundColor`)) === antes);

  console.log('\n8-bis. El color que va a la ventana');
  const colorVentana = await js(`(async () => {
    const { colorToken, aHex } = await import('./js/ui.js');
    return {
      hex: colorToken('--op-bg'),
      desdeRgb: aHex('rgb(10, 10, 10)'),
      desdeHex: aHex('#0a0a0a'),
    };
  })()`);
  ok('el token resuelve a un hex de 6 dígitos',
    /^#[0-9a-f]{6}$/i.test(colorVentana.hex || ''), JSON.stringify(colorVentana));
  ok('coincide con el backgroundColor de main.cjs',
    colorVentana.hex.toLowerCase() === BG_MAIN, `${colorVentana.hex} vs ${BG_MAIN}`);
  ok('y no es un color saturado salido de parsear mal el oklch', (() => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colorVentana.hex.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) < 40;
  })(), colorVentana.hex);
  ok('aHex normaliza cualquier notación',
    colorVentana.desdeRgb === '#0a0a0a' && colorVentana.desdeHex === '#0a0a0a', JSON.stringify(colorVentana));

  console.log('\n8-ter. Los botones de solo ícono centran su contenido');
  const descentrados = await js(`(() => {
    const malos = [];
    for (const b of document.querySelectorAll('button')) {
      if (b.children.length !== 1 || b.textContent.trim()) continue;
      const hijo = b.firstElementChild;
      if (hijo.tagName.toLowerCase() !== 'svg') continue;
      const rb = b.getBoundingClientRect();
      const rh = hijo.getBoundingClientRect();
      if (!rb.width || !rh.width) continue;
      const d = ((rh.left + rh.right) / 2) - ((rb.left + rb.right) / 2);
      const desborda = rh.right > rb.right + 0.5 || rh.left < rb.left - 0.5;
      if (Math.abs(d) > 0.51 || desborda) {
        malos.push({ clase: b.className.slice(0, 34), corrimiento: +d.toFixed(2), desborda });
      }
    }
    return { malos, revisados: [...document.querySelectorAll('button')].length };
  })()`);
  ok('ninguno tiene el ícono corrido ni desbordado',
    descentrados.malos.length === 0, JSON.stringify(descentrados.malos));
  ok('y había botones que revisar', descentrados.revisados > 10, `${descentrados.revisados}`);

  console.log('\n8-quater. Las dos formas de la tarjeta');
  const tarjetas = await js(`(() => [...document.querySelectorAll('.op-card__body')].map((b) => {
    const s = getComputedStyle(b);
    const head = b.previousElementSibling?.classList.contains('op-card__head');
    const arriba = b.getBoundingClientRect().top - b.closest('.op-card').getBoundingClientRect().top;
    return {
      head: !!head,
      top: parseFloat(s.paddingTop),
      bottom: parseFloat(s.paddingBottom),
      aire: +(arriba + parseFloat(s.paddingTop)).toFixed(1),
    };
  }))()`);
  const sinHead = tarjetas.filter((t) => !t.head);
  const conHead = tarjetas.filter((t) => t.head);
  ok('la vitrina muestra las dos formas', sinHead.length > 0 && conHead.length > 0, JSON.stringify(tarjetas));
  ok('sin encabezado, el cuerpo pone su propio aire arriba',
    sinHead.every((t) => t.top > 0 && t.top === t.bottom), JSON.stringify(sinHead));
  ok('con encabezado, el cuerpo NO lo repite', conHead.every((t) => t.top === 0), JSON.stringify(conHead));
  ok('pero el contenido igual queda separado del filo',
    tarjetas.every((t) => t.aire >= 12), JSON.stringify(tarjetas.map((t) => t.aire)));

  console.log('\n8-quinquies. El vidrio: en el shell y los overlays, no en las cards');
  const vidrio = await js(`(() => {
    const bf = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backdropFilter : null; };
    return { fog: !!document.querySelector('.op-fog'), titlebar: bf('.op-titlebar'),
             rail: bf('.op-rail'), card: bf('.op-card') };
  })()`);
  ok('el sustrato de niebla existe', vidrio.fog);
  ok('la titlebar es vidrio (blur en el computado)', /blur\(/.test(vidrio.titlebar || ''), String(vidrio.titlebar));
  ok('el rail es vidrio', /blur\(/.test(vidrio.rail || ''), String(vidrio.rail));
  ok('la card NO lleva blur de fábrica (regla de las hojas)', vidrio.card === 'none', String(vidrio.card));

  await click('#demo-menu');
  await sleep(400);
  const menuGlass = await js(`(() => { const m = document.querySelector('.op-menu'); return m ? getComputedStyle(m).backdropFilter : null; })()`);
  ok('el menú es vidrio', /blur\(/.test(menuGlass || ''), String(menuGlass));
  await js(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(400);

  /* La demo de la vitrina vive ADENTRO del scroller, donde el backdrop queda
     ciego (la máscara del esfumado es frontera): tiene que usar el ESPEJO —
     copia del fondo con filter, alineada al píxel — y no backdrop-filter. */
  const espejo = await js(`(() => {
    const demo = document.getElementById('glass-demo');
    const hoja = document.getElementById('glass-hoja');
    const copia = document.querySelector('#glass-espejo > div');
    if (!demo || !hoja || !copia) return null;
    const rd = demo.getBoundingClientRect(); const rc = copia.getBoundingClientRect();
    return {
      filtro: getComputedStyle(copia).filter,
      alineada: Math.abs(rc.left - rd.left) < 1.5 && Math.abs(rc.top - rd.top) < 1.5
             && Math.abs(rc.width - rd.width) < 1.5 && Math.abs(rc.height - rd.height) < 1.5,
      sinBackdrop: getComputedStyle(hoja).backdropFilter === 'none',
    };
  })()`);
  ok('la demo usa el espejo (filter con blur en la copia)', /blur\(/.test(espejo?.filtro || ''), JSON.stringify(espejo));
  ok('la copia queda alineada con el fondo', espejo?.alineada === true, JSON.stringify(espejo));
  ok('y la hoja no intenta backdrop adentro del scroller', espejo?.sinBackdrop === true);
  /* Sin base opaca, el espejo solo SUMA borrón y el texto real de abajo se
     sigue leyendo nítido a través del relleno translúcido: la oclusión es
     parte del truco, no un detalle. */
  const espejoOpaco = await js(`(() => {
    const host = document.getElementById('glass-espejo');
    if (!host) return null;
    const c = getComputedStyle(host).backgroundColor;
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    const alfa = m && m[1].split(',').length === 4 ? parseFloat(m[1].split(',')[3]) : 1;
    return { color: c, alfa };
  })()`);
  ok('y el espejo es opaco (ocluye el original)', espejoOpaco && espejoOpaco.alfa >= 0.99, JSON.stringify(espejoOpaco));

  /* ── Rutas largas: el pie del rail trunca y el tooltip contiene ────────────
     El bug real: en dev la ruta de datos es corta y todo parece andar; la app
     INSTALADA llega con C:\Users\...\Roaming\Mnemus\data y el span inline no
     trunca (text-overflow pide caja de bloque) mientras el tooltip desborda
     su burbuja (una cadena sin espacios no envuelve sin overflow-wrap). Se
     inyecta una ruta larga y se miden CAJAS, no clases. */
  console.log('\n8-sexies. Rutas largas: el pie trunca y el tooltip contiene');
  const rutas = await js(`(async () => {
    const foot = document.getElementById('rail-foot');
    const original = foot.innerHTML;
    const ruta = ['C:', 'Users', 'usuario', 'AppData', 'Roaming', 'UnaAppDeNombreLargo', 'data'].join('\\\\');
    foot.innerHTML = '<span class="op-meta op-truncate"></span>';
    const el = foot.firstElementChild;
    el.dataset.tip = ruta;
    el.textContent = ruta;
    const r = {
      truncado: el.scrollWidth > el.clientWidth + 1,
      elipsis: getComputedStyle(el).textOverflow === 'ellipsis',
      contenido: el.getBoundingClientRect().right <= foot.getBoundingClientRect().right + 1,
    };
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 700));
    const tip = document.querySelector('.op-tooltip');
    if (tip) {
      const rt = tip.getBoundingClientRect();
      const ra = el.getBoundingClientRect();
      r.tip = {
        dentroDeSi: tip.scrollWidth <= tip.clientWidth + 1 && tip.scrollHeight <= tip.clientHeight + 1,
        centradoOClampeado: Math.abs((rt.left + rt.right) / 2 - (ra.left + ra.right) / 2) < 12 || rt.left <= 12,
        enVentana: rt.left >= 0 && rt.right <= window.innerWidth,
      };
    }
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    foot.innerHTML = original;
    return r;
  })()`);
  ok('la ruta larga trunca con elipsis', rutas.truncado && rutas.elipsis, JSON.stringify(rutas));
  ok('y no desborda el rail', rutas.contenido === true);
  ok('el tooltip contiene su texto (nada cuelga afuera del vidrio)', rutas.tip?.dentroDeSi === true, JSON.stringify(rutas.tip));
  ok('y queda centrado sobre el ancla (o clampeado al borde) y en ventana',
    rutas.tip?.centradoOClampeado === true && rutas.tip?.enVentana === true, JSON.stringify(rutas.tip));

  console.log('\n9. Las reglas de oro');
  const glifos = await js(`(() => {
    const malo = /[\\u2190-\\u21FF\\u2300-\\u23FF\\u25A0-\\u27BF\\u2B00-\\u2BFF\\uFE0F\\u{1F300}-\\u{1FAFF}]/u;
    const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (malo.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 40));
    return out;
  })()`);
  ok('cero emojis y glifos unicode en la UI', glifos.length === 0, JSON.stringify(glifos));
  ok('cero title= nativo', (await js(`document.querySelectorAll('[title]').length`)) === 0);
  const reglas = await js(`(() => { const r = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules] } catch { return [] } })
      .map(x => x.selectorText).filter(Boolean).join(' ');
    return { scrollbar: r.includes('::-webkit-scrollbar'), seleccion: r.includes('::selection'), focus: r.includes(':focus-visible') }; })()`);
  ok('scrollbar propia', reglas.scrollbar);
  ok('::selection propia', reglas.seleccion);
  ok('focus ring propio (:focus-visible)', reglas.focus);

  // El test no puede dejar basura en los datos: se lleva TODOS los mazos que
  // creó (el suyo y el que importó), sus fichas y el ajuste que tocó. La
  // semilla queda — es de la app, no del test.
  for (const id of creados) {
    const sucias = await js(`window.opal.col('fichas').list().then(l => l.filter(f => f.mazo === ${JSON.stringify(id)}).map(f => f.id))`);
    for (const fid of sucias) await js(`window.opal.col('fichas').remove(${JSON.stringify(fid)})`);
    await js(`window.opal.col('mazos').remove(${JSON.stringify(id)})`);
  }
  await js(`window.opal.settings.save({ nuevasPorDia: 10 })`);

  console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
  console.log(errores.length ? `CONSOLA:\n  ${errores.join('\n  ')}` : 'CONSOLA: limpia');
  app.exit(fail || errores.length ? 1 : 0);
});
