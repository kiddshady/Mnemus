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
  // Los canales de actualización, como en main.cjs. Sin empacar solo contestan
  // «nada que hacer», que es justo lo que el humo tiene que ver.
  require(path.join(ROOT, 'src', 'update.cjs')).register(() => null);

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

  /* El diario de actividad del día REAL se fotografía antes de calificar
     nada: el test va a sumarle repasos, y al final lo restaura tal cual —
     los gráficos del usuario no pueden quedar inflados por un test. */
  const claveHoy = await js(`import('./js/stats.js').then(m => m.claveDia(Date.now()))`);
  const idHoy = `d-${claveHoy}`;
  const actividadPrevia = await js(`window.opal.col('actividad').get(${JSON.stringify(idHoy)}).catch(() => null)`);

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

  /* Buscar actualizaciones a mano. Sin empacar no hay nada que buscar, y la
     fila tiene que decirlo en vez de quedarse en «Buscando…» para siempre. */
  await click('[data-view="ajustes"]');
  await sleep(600);
  ok('Ajustes ofrece buscar actualizaciones', (await js(`document.getElementById('upd-btn')?.textContent.trim()`)) === 'Buscar actualizaciones');
  await click('#upd-btn');
  await sleep(250);
  ok('mientras busca lo dice y no se puede reapretar',
    (await js(`document.getElementById('upd-btn').disabled && document.getElementById('upd-estado').textContent.startsWith('Buscando')`)) === true);
  await sleep(1200);
  ok('y termina con una respuesta (en dev: que no hay actualizaciones)',
    ((await js(`document.getElementById('upd-estado').textContent`)) || '').includes('en desarrollo no hay actualizaciones'));
  await click('[data-view="inicio"]');
  await sleep(500);

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
  ok('la calificación todavía no se ofrece', velo?.califOculta);
  /* Y todavía NO es vidrio: no hay nada abajo que esmerilar, y el blur puesto
     de más es justo lo que destellaba al entrar (ver 4-quinquies). */
  ok('todavía no gasta vidrio: no hay qué esmerilar', !/blur\(/.test(velo?.vidrio || ''), String(velo?.vidrio));

  /* El click y la lectura, en la MISMA vuelta: el velo se va por animación, así
     que después de un sleep ya no existe y no se puede mirar. Lo que importa es
     que las tres cosas caigan JUNTAS — respuesta pintada, vidrio puesto, velo
     saliendo. Si el vidrio llegara un cuadro tarde, la respuesta se leería
     nítida por un instante y el esmerilado sería decorativo. */
  const alRevelar = await js(`(() => {
    const v = document.getElementById('velo');
    v.click();
    return {
      estado: v.dataset.state,
      vidrio: getComputedStyle(v).backdropFilter,
      back: getComputedStyle(document.getElementById('back')).visibility,
    };
  })()`);
  ok('al revelar, la respuesta se pinta', alRevelar?.back === 'visible', JSON.stringify(alRevelar));
  ok('el velo se pone el vidrio en ese mismo cuadro', /blur\(/.test(alRevelar?.vidrio || ''), String(alRevelar?.vidrio));
  ok('y arranca a irse', alRevelar?.estado === 'closing', JSON.stringify(alRevelar));

  await sleep(600);
  ok('el velo termina de salir del DOM', !(await js(`!!document.getElementById('velo')`)));
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

  /* El interruptor del azar. Lo que se mide no es que el botón exista, sino la
     promesa que lo hace usable en el medio de una ficha: prenderlo NO repinta
     la vista. viewRepaso dibuja siempre con el velo puesto, así que un refresh
     inocente acá te vuelve a tapar la respuesta que estabas leyendo.

     El test es simétrico —lee el estado, lo da vuelta, lo devuelve— porque
     corre sobre el directorio de datos REAL: no puede asumir cómo lo tiene
     configurado el que lo corre, ni dejárselo cambiado. */
  console.log('\n4-ter. El modo azaroso no te tapa la respuesta');
  const antesAzar = await js(`window.opal.settings.get().then(s => !!s.azar)`);
  ok('el repaso ofrece el interruptor', await js(`!!document.getElementById('btn-azar')`));
  ok('y arranca reflejando el ajuste guardado',
    (await js(`document.getElementById('btn-azar').classList.contains('is-on')`)) === antesAzar);

  await click('#velo');
  await sleep(600);
  const frenteAntes = await js(`document.querySelector('.mn-ficha__front')?.textContent`);
  const contadorAntes = await js(`document.querySelector('.mn-progreso .op-num')?.textContent`);
  ok('la respuesta está destapada antes de tocar nada',
    (await js(`getComputedStyle(document.getElementById('back')).visibility`)) === 'visible');

  await click('#btn-azar');
  await sleep(900);
  const trasAzar = await js(`JSON.stringify({
    on: document.getElementById('btn-azar').classList.contains('is-on'),
    presionado: document.getElementById('btn-azar').getAttribute('aria-pressed'),
    velo: !!document.getElementById('velo'),
    back: getComputedStyle(document.getElementById('back')).visibility,
    frente: document.querySelector('.mn-ficha__front')?.textContent,
    contador: document.querySelector('.mn-progreso .op-num')?.textContent,
  })`);
  const az = JSON.parse(trasAzar);
  ok('el botón cambia de estado', az.on === !antesAzar, trasAzar);
  ok('y lo dice también para quien no lo ve', az.presionado === String(!antesAzar), trasAzar);
  ok('la ficha que estabas mirando no se movió', az.frente === frenteAntes, `${az.frente} ≠ ${frenteAntes}`);
  ok('ni el contador de la sesión', az.contador === contadorAntes, `${az.contador} ≠ ${contadorAntes}`);
  ok('y la respuesta destapada SIGUE destapada', az.back === 'visible' && !az.velo, trasAzar);
  ok('el ajuste llegó al disco',
    (await js(`window.opal.settings.get().then(s => !!s.azar)`)) === !antesAzar);

  await click('#btn-azar');
  await sleep(900);
  ok('y darlo vuelta de nuevo lo deja como estaba',
    (await js(`window.opal.settings.get().then(s => !!s.azar)`)) === antesAzar);

  /* El único test del archivo que mira PÍXELES de una animación, y tiene que
     ser así: hubo un destello que no existía en el DOM. Los estilos computados
     eran idénticos de punta a punta —mismo background, mismo backdrop-filter,
     misma opacidad— y aun así la zona del velo pintaba a 65 de brillo durante
     la entrada y caía a 53 de golpe al terminar.

     La causa: mientras `.op-view` retiene su animación de opacidad, la vista es
     frontera de backdrop, y el velo pasa a muestrear la vista aislada en vez de
     la página. Ahí la ficha —blanco translúcido— se cuenta dos veces. Ninguna
     aserción sobre el DOM lo ve; el compositor no se declara. Por eso se mide
     el píxel. */
  console.log('\n4-quater. La primera ficha entra sin destello');
  await click('[data-view="mazos"]');
  await sleep(600);
  await click(`[data-open-mazo="${mazoId}"]`);
  await sleep(700);
  await click(`[data-action="repasar"][data-arg="${mazoId}"]`);
  await sleep(1300);

  /* El punto se elige LISO a propósito: ni el centro (ahí vive el hint) ni el
     borde (ahí vive el canto iluminado). Y tiene que aguantar los 8 px que la
     vista sube al entrar — un punto pegado a una letra mide el texto
     deslizándose, no el brillo del velo, y da una serie que parece un bug. */
  const zona = await js(`(() => {
    const v = document.getElementById('velo');
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.18), y: Math.round(r.top + r.height * 0.3) };
  })()`);
  ok('hay un velo montado para medir', !!zona, JSON.stringify(zona));

  // Salir y volver a entrar: la animación de vista solo corre al NAVEGAR, y es
  // la que abre la frontera de backdrop. Sin navegación no hay nada que medir.
  await click('[data-view="inicio"]');
  await sleep(900);
  await click('[data-view="mazos"]');
  await sleep(600);
  await click(`[data-open-mazo="${mazoId}"]`);
  await sleep(700);
  await click(`[data-action="repasar"][data-arg="${mazoId}"]`);

  // Se promedia un parche chico en vez de un píxel: el ruido de un solo píxel
  // sobre una superficie translúcida da falsos positivos de 1 o 2 puntos.
  const brillos = [];
  for (let i = 0; i < 14 && zona; i++) {
    const b = (await win.webContents.capturePage({ x: zona.x, y: zona.y, width: 8, height: 8 })).toBitmap();
    let suma = 0; let n = 0;
    for (let p = 0; p < b.length; p += 4) { suma += b[p + 2]; n++; }
    brillos.push(Math.round(suma / n));
    await sleep(45);
  }
  const asentado = brillos[brillos.length - 1];
  // Los primeros cuadros son el fundido de entrada, que SÍ tiene que subir.
  const pico = Math.max(...brillos.slice(3));
  ok('la zona del velo no pasa de largo su brillo final', pico - asentado <= 2,
    `pico ${pico} contra final ${asentado} — [${brillos.join(' ')}]`);
  ok('y llega subiendo, sin caer de golpe después', brillos[3] <= asentado + 2,
    `[${brillos.join(' ')}]`);

  /* Cortar por la mitad. Lo que se mide no es que el botón navegue, sino que
     irse NO toque el disco: cada calificación ya se guardó cuando la diste, y
     abandonar no puede deshacer ninguna. */
  console.log('\n4-quinquies. Terminar la sesión a mitad de camino');
  ok('el repaso ofrece la salida', await js(`!!document.querySelector('[data-action="terminar"]')`));
  const srsAntesDeSalir = await js(`window.opal.col('fichas')
    .get(${JSON.stringify(mc.id)}).then(f => JSON.stringify(f.srs))`);

  await click('[data-action="terminar"]');
  await sleep(1000);
  ok('salir deja la vista del repaso', !(await js(`!!document.querySelector('.mn-ficha')`)));
  ok('y te devuelve al mazo del que saliste',
    await js(`!!document.querySelector('[data-action="nueva-ficha"][data-arg=${JSON.stringify(mazoId)}]')`));
  ok('sin tocar lo que ya estaba guardado',
    (await js(`window.opal.col('fichas').get(${JSON.stringify(mc.id)}).then(f => JSON.stringify(f.srs))`))
      === srsAntesDeSalir);

  await click(`[data-action="repasar"][data-arg="${mazoId}"]`);
  await sleep(1000);
  ok('se puede volver a entrar como si nada', await js(`!!document.querySelector('.mn-ficha')`));
  escape();
  await sleep(1000);
  ok('y Escape es la misma puerta', !(await js(`!!document.querySelector('.mn-ficha')`)));

  /* Un mazo que se manda por chat. Lo único que se reemplaza son los dos
     diálogos NATIVOS de archivo —son de Electron, no código nuestro, y
     bloquearían el test— por una ruta fija en el temp del sistema. Todo lo
     demás es el camino de producción.

     Lo que se mide es el VIAJE COMPLETO: un formato que pierde un campo en el
     camino no da error, da un mazo silenciosamente incompleto del otro lado,
     en la máquina de otra persona, donde nadie lo va a notar hasta que la
     respuesta correcta esté mal. */
  console.log('\n4-sexies. Exportar e importar un mazo');
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

  /* El examen: mide sin escribir. La promesa entera del modo está en UNA
     comparación de disco — las srs de las fichas antes y después del examen
     tienen que ser byte a byte las mismas, porque un examen que reprograma
     el plan de repaso es un repaso disfrazado. Lo demás se mide sobre un
     resultado conocido: la de opción múltiple se contesta MAL a propósito y
     la básica BIEN, así el 50% del final no es una casualidad del barajado. */
  console.log('\n4-septies. El examen: puntaje, revisión y el SRS intacto');
  const srsAntesExamen = await js(`window.opal.col('fichas').list()
    .then(l => JSON.stringify(l.filter(f => f.mazo === ${JSON.stringify(mazoId)})
      .map(f => [f.id, f.srs]).sort()))`);

  await click(`[data-open-mazo="${mazoId}"]`);
  await sleep(700);
  ok('el mazo ofrece el examen', await js(`!!document.querySelector('[data-action="examen"]')`));
  await click(`[data-action="examen"][data-arg="${mazoId}"]`);
  await sleep(600);
  ok('el armado abre proponiendo el mazo completo',
    (await js(`document.querySelector('#ex-cantidad input')?.value`)) === '2');
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1000);

  ok('el examen abre con la hoja de siempre', await js(`!!document.querySelector('.mn-ficha')`));
  ok('con el marcador en cero',
    (await js(`[...document.querySelectorAll('.mn-marcador .op-num')].map(e => e.textContent).join('-')`)) === '0-0');
  ok('y sin el botón de azar: ya nació barajado', !(await js(`!!document.getElementById('btn-azar')`)));

  // El orden es al azar: se contesta según lo que salga — la de opción
  // múltiple siempre mal, la básica siempre bien. Una y una, pase lo que pase.
  const contestar = async () => {
    const interactiva = await js(`!!document.querySelector('#opciones')`);
    if (interactiva) {
      await click('.mn-opcion[data-opcion="0"]');        // «una»: errada a propósito
      await sleep(700);
      ok('errar no abre calificación: la elección ya es el veredicto',
        await js(`!!document.querySelector('[data-ex="siguiente"]')`)
        && !(await js(`!!document.getElementById('calif')`)));
      await click('[data-ex="siguiente"]');
    } else {
      await click('#velo');
      await sleep(600);
      ok('la básica se resuelve en binario, sin grados',
        (await js(`document.querySelectorAll('#ex-resolver [data-ex]').length`)) === 2);
      await click('[data-ex="sabia"]');
    }
    await sleep(900);
  };

  await contestar();

  // Irse con una contestada pregunta: acá SÍ hay algo que perder (ver la
  // simetría con el repaso, que se va sin preguntar porque ya guardó todo).
  escape();
  await sleep(600);
  ok('salir a mitad de examen pide confirmación', await js(`!!document.querySelector('.op-modal')`));
  escape();
  await sleep(600);
  ok('cancelar deja el examen donde estaba',
    !(await js(`!!document.querySelector('.op-modal')`)) && (await js(`!!document.querySelector('.mn-ficha')`)));

  await contestar();

  await sleep(1100);                                     // la nota cuenta hasta llegar
  ok('al terminar aparece la prueba corregida', await js(`!!document.querySelector('.mn-resultado')`));
  ok('con el 50 que se contestó', (await js(`document.getElementById('nota')?.textContent`)) === '50',
    String(await js(`document.getElementById('nota')?.textContent`)));
  ok('una correcta, una incorrecta, dos preguntas',
    (await js(`[...document.querySelectorAll('.mn-resultado .op-stat__value')].map(e => e.textContent).join('-')`)) === '1-1-2');
  const revision = await js(`(() => {
    const items = [...document.querySelectorAll('.mn-revision .op-listitem')];
    return { n: items.length, texto: items[0]?.textContent || '' };
  })()`);
  ok('la revisión lista SOLO la fallada', revision.n === 1, JSON.stringify(revision));
  ok('con cuál era y qué marcaste',
    revision.texto.includes('Era la correcta') && revision.texto.includes('marcaste una'), revision.texto);

  const srsTrasExamen = await js(`window.opal.col('fichas').list()
    .then(l => JSON.stringify(l.filter(f => f.mazo === ${JSON.stringify(mazoId)})
      .map(f => [f.id, f.srs]).sort()))`);
  ok('las srs NO se movieron: el examen mide, no escribe', srsTrasExamen === srsAntesExamen,
    `${srsAntesExamen} → ${srsTrasExamen}`);

  await click('[data-ex="repasar-falladas"]');
  await sleep(1000);
  ok('repasar las falladas arma una sesión con SOLO eso',
    (await js(`document.querySelector('.mn-progreso .op-num')?.textContent`)) === '1/1',
    String(await js(`document.querySelector('.mn-progreso .op-num')?.textContent`)));
  ok('y es la que fallaste',
    (await js(`document.querySelector('.mn-ficha__front')?.textContent.trim()`)) === '¿Cuál de estas es la correcta?');
  await click('[data-action="terminar"]');
  await sleep(900);
  ok('salir del repaso devuelve al mazo del examen',
    await js(`!!document.querySelector('[data-action="nueva-ficha"][data-arg=${JSON.stringify(mazoId)}]')`));

  /* El historial. La mitad de la promesa es qué guarda —textos congelados,
     no referencias a fichas vivas— y la otra mitad es que sea EDITABLE: la
     nota al margen se escribe, y una entrada se elimina de verdad. */
  console.log('\n4-octies. El historial: el registro, la nota al margen y el borrado');
  const regs = await js(`window.opal.col('examenes').list()
    .then(l => l.filter(x => x.mazo === ${JSON.stringify(mazoId)}))`);
  ok('el examen terminado dejó UN registro (ni el confirm cancelado ni el resumen repintado duplican)',
    regs.length === 1, JSON.stringify(regs.map((x) => x.id)));
  const reg = regs[0] || {};
  ok('con las cifras del examen', reg.total === 2 && reg.correctas === 1, JSON.stringify(reg));
  ok('el nombre del mazo viaja adentro, no como referencia', reg.nombre === 'Humo');
  ok('y la fallada quedó como texto: cuál era y qué marcaste',
    reg.falladas?.[0]?.respuesta === 'la correcta' && reg.falladas?.[0]?.elegida === 'una',
    JSON.stringify(reg.falladas));

  await click('[data-view="examenes"]');
  await sleep(800);
  ok('la vista Exámenes lo lista con su nota', await js(`(() => {
    const fila = document.querySelector('[data-action="ver-examen"][data-arg=${JSON.stringify(reg.id)}]');
    return !!fila && fila.querySelector('.op-chip')?.textContent === '50%';
  })()`));

  await click(`[data-action="ver-examen"][data-arg="${reg.id}"]`);
  await sleep(700);
  ok('el detalle abre con la revisión congelada', await js(`(() => {
    const m = document.querySelector('.op-modal');
    return !!m && m.textContent.includes('Era la correcta') && m.textContent.includes('marcaste una');
  })()`));
  await js(`(() => { const t = document.getElementById('ex-comentario');
    t.value = 'Rendido por el test de humo'; return true; })()`);
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1000);
  ok('la nota al margen llegó al disco',
    (await js(`window.opal.col('examenes').get(${JSON.stringify(reg.id)}).then(x => x.comentario)`))
      === 'Rendido por el test de humo');
  ok('y la fila la muestra', await js(`(() => {
    const fila = document.querySelector('[data-action="ver-examen"][data-arg=${JSON.stringify(reg.id)}]');
    return !!fila && fila.textContent.includes('Rendido por el test de humo');
  })()`));

  await click(`[data-action="eliminar-examen"][data-arg="${reg.id}"]`);
  await sleep(600);
  ok('eliminar pide confirmación', await js(`!!document.querySelector('.op-modal')`));
  await click('.op-modal__foot .op-btn--danger-solid');
  await sleep(1000);
  ok('la entrada se fue de la lista',
    !(await js(`!!document.querySelector('[data-action="ver-examen"][data-arg=${JSON.stringify(reg.id)}]')`)));
  ok('y del disco', (await js(`window.opal.col('examenes').list()
    .then(l => l.filter(x => x.mazo === ${JSON.stringify(mazoId)}).length)`)) === 0);

  /* Las carpetas. Lo que se mide con lupa son las dos promesas de
     neutralidad: mover un mazo NO toca su updatedAt (organizar no es
     editar, y archivar no debería treparlo a "reciente"), y eliminar la
     carpeta SUELTA sus mazos en vez de llevárselos. El pliegue es un
     ajuste: tiene que quedar en el disco, no en la vista. */
  console.log('\n4-nonies. Carpetas: mover, plegar, repasar y eliminar sin arrastrar');
  await click('[data-view="mazos"]');
  await sleep(700);
  ok('la vista Mazos ofrece crear carpeta', await js(`!!document.querySelector('[data-action="nueva-carpeta"]')`));
  await click('[data-action="nueva-carpeta"]');
  await sleep(600);
  await js(`(() => { document.querySelector('.op-modal input.op-input').value = 'CarpetaHumo'; return true; })()`);
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1000);

  const carpetaHumo = await js(`window.opal.col('carpetas').list().then(l => l.find(c => c.name === 'CarpetaHumo') || null)`);
  ok('la carpeta quedó en disco con id asignado', !!carpetaHumo, JSON.stringify(carpetaHumo));
  ok('y su sección aparece, vacía y a la vista', await js(`(() => {
    const s = document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo?.id || '')}]');
    return !!s && s.textContent.includes('CarpetaHumo');
  })()`));

  const updatedAntes = await js(`window.opal.col('mazos').get(${JSON.stringify(mazoId)}).then(m => m.updatedAt)`);
  await js(`(() => {
    const fila = document.querySelector('[data-open-mazo=${JSON.stringify(mazoId)}]');
    fila.querySelector('[data-menu="mazo"]').click(); return true; })()`);
  await sleep(500);
  ok('el menú del mazo ofrece moverlo', await js(`(() => {
    const it = [...document.querySelectorAll('.op-menuitem')].find(e => e.textContent.includes('Mover a carpeta'));
    if (!it) return false; it.click(); return true; })()`));
  await sleep(600);
  await click(`[data-destino="${carpetaHumo.id}"]`);
  await sleep(300);
  await click('.op-modal__foot .op-btn--primary');
  await sleep(1000);

  const movido = await js(`window.opal.col('mazos').get(${JSON.stringify(mazoId)})`);
  ok('el mazo quedó en la carpeta, en disco', movido?.carpeta === carpetaHumo.id, JSON.stringify(movido?.carpeta));
  ok('mover NO tocó updatedAt: organizar no es editar',
    movido?.updatedAt === updatedAntes, `${updatedAntes} → ${movido?.updatedAt}`);
  ok('y la fila vive adentro de la sección', await js(`(() => {
    const s = document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}]');
    return !!s && !!s.querySelector('[data-open-mazo=${JSON.stringify(mazoId)}]');
  })()`));

  await js(`(() => { document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}] [data-plegar]').click(); return true; })()`);
  await sleep(700);
  ok('plegar pliega en el lugar, sin repintar la vista',
    await js(`document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}]').classList.contains('is-plegada')`));
  // El computado, no la clase: el <i data-icon> se REEMPLAZA por un SVG al
  // montar, y una clase puesta en el atributo equivocado se pierde ahí.
  ok('y el chevron rota de verdad (la clase sobrevive al montaje del ícono)', await js(`(() => {
    const ch = document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}] .mn-carpeta__chevron');
    return !!ch && getComputedStyle(ch).transform !== 'none';
  })()`));
  ok('y el pliegue queda en los ajustes, en disco',
    (await js(`window.opal.settings.get().then(s => (s.plegadas || []).includes(${JSON.stringify(carpetaHumo.id)}))`)) === true);
  await js(`(() => { document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}] [data-plegar]').click(); return true; })()`);
  await sleep(700);
  ok('desplegar lo saca de los ajustes',
    (await js(`window.opal.settings.get().then(s => (s.plegadas || []).includes(${JSON.stringify(carpetaHumo.id)}))`)) === false);

  await js(`(() => { document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}] [data-menu="carpeta"]').click(); return true; })()`);
  await sleep(500);
  ok('el menú de la carpeta ofrece repasarla entera', await js(`(() => {
    const it = [...document.querySelectorAll('.op-menuitem')].find(e => e.textContent.includes('Repasar la carpeta'));
    if (!it) return false; it.click(); return true; })()`));
  await sleep(1000);
  ok('y la sesión abre con una ficha de sus mazos', await js(`!!document.querySelector('.mn-ficha')`));
  escape();
  await sleep(900);

  await click('[data-view="mazos"]');
  await sleep(700);

  /* Drag & drop: el mismo movimiento del modal, a mano alzada. Ida (a la
     raíz) y vuelta (a la carpeta), leyendo el DISCO después de cada suelta. */
  const arrastrar = (filaSel, destSel) => js(`(() => {
    const dt = new DataTransfer();
    const fila = document.querySelector(${JSON.stringify(filaSel)});
    const dest = document.querySelector(${JSON.stringify(destSel)});
    if (!fila || !dest) return { error: true, fila: !!fila, dest: !!dest };
    fila.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    dest.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const marcado = dest.classList.contains('is-destino');
    dest.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    fila.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    return { marcado };
  })()`);

  const ida = await arrastrar(`[data-open-mazo="${mazoId}"]`, '.mn-carpeta[data-carpeta="raiz"]');
  ok('arrastrar sobre un destino válido lo ilumina', ida?.marcado === true, JSON.stringify(ida));
  await sleep(1000);
  ok('soltarlo en «Sin carpeta» lo saca, en disco',
    !(await js(`window.opal.col('mazos').get(${JSON.stringify(mazoId)}).then(m => m.carpeta || null)`)));
  const vuelta = await arrastrar(`[data-open-mazo="${mazoId}"]`, `.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}]`);
  ok('y arrastrarlo a la carpeta lo devuelve', vuelta?.marcado === true, JSON.stringify(vuelta));
  await sleep(1000);
  ok('también en disco',
    (await js(`window.opal.col('mazos').get(${JSON.stringify(mazoId)}).then(m => m.carpeta)`)) === carpetaHumo.id);

  /* Mover de a muchos: Ctrl+click elige sin abrir, la isla cuenta y ofrece
     mover, y el modal mueve a TODOS los elegidos. Uno ya vive en la carpeta y
     el otro no: tiene que moverse solo el que cambia. Se lee el disco. */
  if (importado) {
    const ctrlClick = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); return true; })()`);
    await ctrlClick(`[data-open-mazo="${mazoId}"]`);
    await ctrlClick(`[data-open-mazo="${importado.id}"]`);
    await sleep(500);
    ok('Ctrl+click elige sin abrir el mazo', (await js(`document.querySelectorAll('[data-open-mazo].is-selected').length`)) === 2
      && (await js(`!!document.querySelector('.mn-carpeta')`)));
    ok('la isla de selección cuenta los elegidos', (await js(`document.querySelector('.mn-seleccion__cuenta')?.textContent`)) === '2 mazos');
    await click('[data-action="mover-seleccion"]');
    await sleep(700);
    ok('el modal nombra cuántos mueve', (await js(`document.querySelector('.op-modal__title')?.textContent`)) === 'Mover 2 mazos');
    await click(`.op-modal [data-destino="${carpetaHumo.id}"]`);
    await js(`[...document.querySelectorAll('.op-modal__foot button')].find(b => b.textContent.trim() === 'Mover').click()`);
    await sleep(1400);
    ok('los dos quedaron en la carpeta, en disco',
      (await js(`window.opal.col('mazos').get(${JSON.stringify(importado.id)}).then(m => m.carpeta)`)) === carpetaHumo.id
      && (await js(`window.opal.col('mazos').get(${JSON.stringify(mazoId)}).then(m => m.carpeta)`)) === carpetaHumo.id);
    ok('y la selección se soltó', !(await js(`document.querySelector('[data-open-mazo].is-selected') || document.getElementById('mn-seleccion')`)));
  }

  await js(`(() => { document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}] [data-menu="carpeta"]').click(); return true; })()`);
  await sleep(500);
  await js(`(() => {
    const it = [...document.querySelectorAll('.op-menuitem')].find(e => e.textContent.includes('Eliminar'));
    it.click(); return true; })()`);
  await sleep(600);
  await click('.op-modal__foot .op-btn--danger-solid');
  await sleep(1100);
  ok('la carpeta se fue del disco',
    (await js(`window.opal.col('carpetas').list().then(l => l.some(c => c.id === ${JSON.stringify(carpetaHumo.id)}))`)) === false);
  const suelto = await js(`window.opal.col('mazos').get(${JSON.stringify(mazoId)})`);
  ok('pero el mazo QUEDA, suelto y con sus fichas', !!suelto && !suelto.carpeta, JSON.stringify(suelto?.carpeta));
  ok('y su sección desapareció de la lista',
    !(await js(`!!document.querySelector('.mn-carpeta[data-carpeta=${JSON.stringify(carpetaHumo.id)}]')`)));

  /* Dos detalles que confundieron a un usuario real (el autor, de hecho):
     el tacho de «Eliminar» que se ponía gris justo al apuntarlo, y la marca
     de estado que no decía qué significaba. */
  console.log('\n4-decies. El menú peligroso se mantiene rojo y la marca se explica');
  await js(`(() => {
    const fila = document.querySelector('[data-open-mazo=${JSON.stringify(mazoId)}]');
    fila.querySelector('[data-menu="mazo"]').click(); return true; })()`);
  await sleep(500);
  const danger = await js(`(() => {
    const it = [...document.querySelectorAll('.op-menuitem--danger')].pop();
    if (!it) return null;
    const probe = document.createElement('span');
    probe.style.color = 'var(--op-danger)';
    document.body.appendChild(probe);
    const esperado = getComputedStyle(probe).color;
    probe.remove();
    const reglas = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules] } catch { return [] } })
      .map(r => r.selectorText).filter(Boolean).join(' ');
    return {
      quieto: getComputedStyle(it.querySelector('.op-icon')).color === esperado,
      reglaHover: reglas.includes('.op-menuitem--danger:hover .op-icon'),
    };
  })()`);
  ok('el ícono del ítem peligroso es rojo en reposo', danger?.quieto === true, JSON.stringify(danger));
  ok('y tiene regla PROPIA de hover: la genérica ya no lo pisa', danger?.reglaHover === true);
  await js(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(400);
  ok('la marca de estado de un mazo lleva su explicación', await js(`(() => {
    const mk = document.querySelector('[data-open-mazo] .op-mark');
    return !!mk && !!mk.closest('[data-tip]')?.dataset.tip;
  })()`));

  /* Las estadísticas. La aserción que importa es de INTEGRACIÓN: el smoke
     calificó exactamente dos veces (un «Bien» en la sección 4, un «Otra
     vez» en 4-bis), así que el diario del día tiene que haber crecido
     exactamente +2 repasos y +1 otra vez respecto de la fotografía inicial
     — ni uno más, ni uno menos, ni un doble conteo. */
  console.log('\n4-undecies. Estadísticas: el diario suma justo y la vista dibuja');
  const actividadTras = await js(`window.opal.col('actividad').get(${JSON.stringify(idHoy)}).catch(() => null)`);
  const repasosPrevios = actividadPrevia?.repasos || 0;
  const otraVezPrevias = actividadPrevia?.otraVez || 0;
  ok('cada calificación quedó anotada en el diario del día: +2 repasos',
    actividadTras?.repasos === repasosPrevios + 2, `${repasosPrevios} → ${actividadTras?.repasos}`);
  ok('y el «Otra vez» quedó contado: +1',
    actividadTras?.otraVez === otraVezPrevias + 1, `${otraVezPrevias} → ${actividadTras?.otraVez}`);

  await click('[data-view="stats"]');
  await sleep(1000);
  ok('la vista Estadísticas pinta', (await js(`document.getElementById('view').children.length`)) > 0);
  ok('y queda activa en el rail', await js(`!!document.querySelector('[data-view="stats"].is-active')`));
  ok('el gráfico de actividad tiene sus 30 columnas',
    (await js(`document.querySelectorAll('.mn-graf')[0].querySelectorAll('.mn-graf__col').length`)) === 30);
  ok('la barra de hoy lleva el acento y refleja lo repasado', await js(`(() => {
    const cols = [...document.querySelectorAll('.mn-graf')[0].querySelectorAll('.mn-graf__col')];
    const hoy = cols[cols.length - 1].querySelector('.mn-graf__barra');
    return hoy.classList.contains('is-hoy') && !hoy.classList.contains('is-cero');
  })()`));
  ok('cada columna explica su día con tooltip', await js(`(() => {
    const cols = [...document.querySelectorAll('.mn-graf__col')];
    return cols.length > 0 && cols.every((c) => !!c.dataset.tip);
  })()`));
  ok('la carga próxima tiene sus 14 columnas',
    (await js(`document.querySelectorAll('.mn-graf')[1].querySelectorAll('.mn-graf__col').length`)) === 14);
  const distSmoke = await js(`(() => {
    const leyenda = [...document.querySelectorAll('.mn-dist__leyenda .op-status')];
    const segs = document.querySelectorAll('.mn-dist__seg').length;
    return { estados: leyenda.length, segs };
  })()`);
  ok('la distribución nombra sus cuatro estados', distSmoke.estados === 4, JSON.stringify(distSmoke));
  ok('y ningún segmento aparece sin fichas que lo respalden', distSmoke.segs <= 4 && distSmoke.segs >= 1);
  // countTo ya asentó (700ms): el texto de la racha es un número real.
  ok('la racha marca al menos un día (hoy se repasó)', await js(`(() => {
    const el = document.getElementById('st-racha');
    return !!el && parseInt(el.textContent, 10) >= 1;
  })()`), String(await js(`document.getElementById('st-racha')?.textContent`)));

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
    const exs = await js(`window.opal.col('examenes').list().then(l => l.filter(x => x.mazo === ${JSON.stringify(id)}).map(x => x.id))`);
    for (const eid of exs) await js(`window.opal.col('examenes').remove(${JSON.stringify(eid)})`);
    await js(`window.opal.col('mazos').remove(${JSON.stringify(id)})`);
  }
  // Y las carpetas del test, si un aborto a mitad de camino dejó alguna.
  const carpetasSucias = await js(`window.opal.col('carpetas').list().then(l => l.filter(c => c.name === 'CarpetaHumo').map(c => c.id))`);
  for (const cid of carpetasSucias) await js(`window.opal.col('carpetas').remove(${JSON.stringify(cid)})`);
  // El diario del día vuelve a su fotografía inicial: los repasos del test
  // no son estudio del usuario y sus gráficos no pueden quedar inflados.
  if (actividadPrevia) await js(`window.opal.col('actividad').save(${JSON.stringify(actividadPrevia)})`);
  else await js(`window.opal.col('actividad').remove(${JSON.stringify(idHoy)}).catch(() => null)`);
  await js(`window.opal.settings.save({ nuevasPorDia: 10 })`);

  console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
  console.log(errores.length ? `CONSOLA:\n  ${errores.join('\n  ')}` : 'CONSOLA: limpia');
  app.exit(fail || errores.length ? 1 : 0);
});
