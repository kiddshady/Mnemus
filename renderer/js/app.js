/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — la app
   Flashcards con repaso espaciado (SM-2) sobre Opal. La estructura viene de
   la plantilla: un espejo en memoria de lo que hay en disco, vistas que
   pintan de ese espejo, y toda mutación pasa por los helpers de guardado.

   El dominio en dos frases: un MAZO agrupa FICHAS; cada ficha lleva su srs
   (ver srs.js) que decide cuándo volvés a verla. La sesión de repaso arma la
   cola del día, muestra el frente, esconde la respuesta detrás del velo
   esmerilado, y cada calificación reescribe la srs en disco.

   Una ficha puede ser básica (te autocalificás), de opción múltiple o de
   verdadero/falso (las contestás eligiendo, ver ficha.js). El tipo vive en la
   ficha y no en el mazo: los tres conviven en la misma sesión sin que el SRS
   se entere de la diferencia.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Tooltip, Toast, Menu, Modal } from './overlays.js';
import Router from './router.js';
import { initClickFlash, initScrollFades, scrollFade, raf2, countTo, exit, bindStepper, bindSwitcher } from './motion.js';
import { viewEl, esc, paint, head, empty, mark, status, setStateLabels, attempt, copy, colorToken } from './ui.js';
import { relTime, plural } from './format.js';
import { designHTML, wireDesign } from './design-view.js';
import {
  DIA, GRADOS, srsNueva, esNueva, calificar, simular,
  armarCola, barajar, porPrioridad, paraHoy, finDeHoy, vencida,
} from './srs.js';
import {
  TIPOS, ETIQUETA_TIPO, OPCIONES_VF, MIN_OPCIONES, MAX_OPCIONES,
  tipoDe, opcionesDe, esInteractiva, indiceCorrecto, letra, gradoSugerido,
  validar as validarFicha, normalizar as normalizarFicha,
} from './ficha.js';
import {
  empaquetar, desempaquetar, nombreArchivo,
  validar as validarPaquete, resumen as resumenPaquete,
} from './intercambio.js';
import {
  armarExamen, pct as puntaje, veredicto, contestadas as contestadasExamen, retirar as retirarExamen,
  registro as registroExamen, promedio as promedioExamenes,
} from './examen.js';
import { agrupar as agruparMazos } from './carpetas.js';
import {
  claveDia, actividadPorDia, racha, cargaProxima,
  distribucion, masOlvidadas, notasExamenes,
} from './stats.js';

const api = window.opal;
const mazosCol = api.col('mazos');
const fichasCol = api.col('fichas');
const examenesCol = api.col('examenes');
const carpetasCol = api.col('carpetas');
const actividadCol = api.col('actividad');

/* La marca y los símbolos del dominio. El set base no se edita: se extiende. */
Icons.add({
  mnemus: '<path d="M1.8 10.5H4.6L6.4 3.2 8.2 12.4 9.6 10.5H14.2"/><circle cx="6.4" cy="3.2" r="1.6"/>',
  /* Azar: los dos caminos que se cruzan. El de arriba pasa entero; el de abajo
     se corta en el medio y por ese hueco se lee cuál pasa por encima. */
  azar: '<path d="M2.7 13.3 13.8 2.2"/><path d="M10.7 2.2h3.1v3.1"/>'
      + '<path d="M2.7 2.7 6 6"/><path d="M10 10l3.8 3.8"/><path d="M13.8 10.7v3.1h-3.1"/>',
  /* Examen: el birrete. El rombo es la tapa, la copa cuelga debajo, y la borla
     cae del vértice derecho. */
  examen: '<path d="M1.7 6.3 8 3.3l6.3 3L8 9.3z"/>'
      + '<path d="M4.2 8v2.8c0 1.05 1.7 1.9 3.8 1.9s3.8-.85 3.8-1.9V8"/><path d="M14.3 6.3v3.2"/>',
  /* Estadísticas: tres barras que crecen sobre su base. */
  grafico: '<path d="M2.4 13.4h11.2"/><path d="M4.6 13.4V9.6M8 13.4V6M11.4 13.4V3.2"/>',
});

/* Las palabras del dominio sobre los estados del sistema. */
setStateLabels({ idle: 'Nueva', queued: 'Vencida', done: 'Al día', waiting: 'Aprendiendo' });

/* ══ Datos ═══════════════════════════════════════════════════════════════════
   Un espejo en memoria de lo que hay en disco. Las vistas leen de acá y nunca
   hacen IPC para dibujarse. */

const S = {
  info: null,
  settings: {},
  mazos: [],
  fichas: [],
  /** Las carpetas que agrupan mazos — un nivel, ver carpetas.js. */
  carpetas: [],
  /** El historial: un registro por examen terminado (ver registro() en examen.js). */
  examenes: [],
  /** La actividad de repaso: un contador por día calendario (d-AAAAMMDD). */
  actividad: [],
  lastSaved: null,
  /** La sesión de repaso viva, o null. */
  sesion: null,
  /** El examen en curso (o ya corregido, mientras el resumen esté a la vista), o null. */
  examen: null,
};

async function loadAll() {
  const [info, settings, mazos, fichas, examenes, carpetas, actividad] = await Promise.all([
    api.info(), api.settings.get(), mazosCol.list(), fichasCol.list(),
    examenesCol.list(), carpetasCol.list(), actividadCol.list(),
  ]);
  S.info = info;
  S.settings = settings;
  S.mazos = mazos.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  S.fichas = fichas;
  S.examenes = examenes;
  S.carpetas = carpetas;
  S.actividad = actividad;
}

async function saveMazo(mazo) {
  const saved = await mazosCol.save({ ...mazo, updatedAt: Date.now() });
  S.mazos = [saved, ...S.mazos.filter((m) => m.id !== saved.id)];
  S.lastSaved = Date.now();
  updateChrome();
  return saved;
}

/** Borrar un mazo se lleva sus fichas: una ficha huérfana no se puede repasar. */
async function removeMazo(id) {
  const huerfanas = S.fichas.filter((f) => f.mazo === id);
  for (const f of huerfanas) await fichasCol.remove(f.id);
  await mazosCol.remove(id);
  S.fichas = S.fichas.filter((f) => f.mazo !== id);
  S.mazos = S.mazos.filter((m) => m.id !== id);
  updateChrome();
}

async function saveFicha(ficha) {
  const saved = await fichasCol.save({ ...ficha, updatedAt: Date.now() });
  S.fichas = [saved, ...S.fichas.filter((f) => f.id !== saved.id)];
  S.lastSaved = Date.now();
  updateChrome();
  return saved;
}

async function removeFicha(id) {
  await fichasCol.remove(id);
  S.fichas = S.fichas.filter((f) => f.id !== id);
  updateChrome();
}

async function saveExamen(reg) {
  const saved = await examenesCol.save(reg);
  S.examenes = [saved, ...S.examenes.filter((x) => x.id !== saved.id)];
  S.lastSaved = Date.now();
  updateChrome();
  return saved;
}

async function removeExamen(id) {
  await examenesCol.remove(id);
  S.examenes = S.examenes.filter((x) => x.id !== id);
  updateChrome();
}

async function saveCarpeta(carpeta) {
  const saved = await carpetasCol.save(carpeta);
  S.carpetas = [saved, ...S.carpetas.filter((c) => c.id !== saved.id)];
  S.lastSaved = Date.now();
  updateChrome();
  return saved;
}

/**
 * Eliminar una carpeta SUELTA sus mazos a la raíz, nunca se los lleva: la
 * carpeta es organización, no propiedad. (Compará con removeMazo, que sí
 * arrastra las fichas — una ficha sin mazo no significa nada; un mazo sin
 * carpeta es un mazo como cualquiera.)
 */
async function removeCarpeta(id) {
  for (const m of S.mazos.filter((x) => x.carpeta === id)) await asignarCarpeta(m.id, null);
  await carpetasCol.remove(id);
  S.carpetas = S.carpetas.filter((c) => c.id !== id);
  // La carpeta se lleva su pliegue: un id muerto en los ajustes es basura.
  const plegadas = (S.settings.plegadas || []).filter((x) => x !== id);
  if (plegadas.length !== (S.settings.plegadas || []).length) persist({ plegadas });
  updateChrome();
}

/** Mover un mazo de carpeta escribe SIN tocar updatedAt: organizar no es
    editar, y un mazo no debería trepar a "reciente" por haberlo archivado. */
async function asignarCarpeta(mazoId, carpetaId) {
  const m = mazo(mazoId);
  if (!m || (m.carpeta || null) === (carpetaId || null)) return;
  const patch = { ...m };
  if (carpetaId) patch.carpeta = carpetaId;
  else delete patch.carpeta;                 // canónico: sin carpeta = sin campo
  const saved = await mazosCol.save(patch);
  S.mazos = S.mazos.map((x) => (x.id === saved.id ? saved : x));
  S.lastSaved = Date.now();
  updateChrome();
}

/* ══ Selección de varios mazos ═══════════════════════════════════════════════
   Para mover de a muchos lo que de a uno cuesta un modal por mazo. El gesto es
   el del Explorador: Ctrl+click suma o quita, Shift+click elige el rango desde
   el último tocado. Con algo elegido la lista entra en «modo selección» y el
   click simple también suma o quita: abrir un mazo ahí sería perder lo elegido.

   Vive fuera de la vista a propósito: un Router.refresh repinta la lista y las
   filas vuelven a nacer marcadas desde este Set. Navegar sí la suelta. */
const seleccion = new Set();
let anclaSel = null;

/** Las filas de mazo que se ven: las de una carpeta plegada no cuentan para
    un rango, porque elegir lo que no ves es mover a ciegas. */
function filasVisibles() {
  return [...document.querySelectorAll('[data-open-mazo]')]
    .filter((f) => !f.closest('.mn-carpeta.is-plegada'))
    .map((f) => f.dataset.openMazo);
}

function elegirMazo(id, { rango = false } = {}) {
  if (rango && anclaSel) {
    const filas = filasVisibles();
    const a = filas.indexOf(anclaSel);
    const b = filas.indexOf(id);
    if (a > -1 && b > -1) {
      filas.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => seleccion.add(x));
      pintarSeleccion();
      return;
    }
  }
  seleccion.has(id) ? seleccion.delete(id) : seleccion.add(id);
  anclaSel = id;
  pintarSeleccion();
}

function limpiarSeleccion() {
  if (!seleccion.size && !anclaSel) return;
  seleccion.clear();
  anclaSel = null;
  pintarSeleccion();
}

/** Marca las filas EN EL LUGAR, sin repintar: un refresh acá movería la lista
    abajo del mouse a mitad de un Shift+click. */
function pintarSeleccion() {
  for (const id of [...seleccion]) if (!mazo(id)) seleccion.delete(id);
  document.querySelectorAll('[data-open-mazo]').forEach((f) => {
    const on = seleccion.has(f.dataset.openMazo);
    f.classList.toggle('is-selected', on);
    f.setAttribute('aria-selected', String(on));
  });
  barraSeleccion();
}

/**
 * La isla de abajo: cuántos hay y qué hacer con ellos. Nace una sola vez fuera
 * de #view —que se repinta entero— y entra y sale con la firma de Opal: aflora.
 */
function barraSeleccion() {
  const app = document.querySelector('.op-app');
  let barra = document.getElementById('mn-seleccion');
  const n = seleccion.size;
  app?.classList.toggle('has-seleccion', n > 0);

  if (!n) {
    const isla = barra?.querySelector('.mn-seleccion__isla');
    if (isla && isla.dataset.state !== 'closing') {
      isla.dataset.state = 'closing';
      isla.addEventListener('animationend', () => { if (!seleccion.size) barra.remove(); }, { once: true });
    }
    return;
  }

  if (!barra) {
    barra = document.createElement('div');
    barra.id = 'mn-seleccion';
    barra.className = 'mn-seleccion';
    barra.innerHTML = `
      <div class="mn-seleccion__isla" role="toolbar" aria-label="Mazos seleccionados">
        <span class="mn-seleccion__cuenta op-num"></span>
        <span class="mn-seleccion__pista">Ctrl+click suma · Shift+click elige un rango</span>
        <button class="op-btn op-btn--primary op-flashable" data-action="mover-seleccion"><i data-icon="folder"></i> Mover a carpeta…</button>
        <button class="op-iconbtn" data-action="limpiar-seleccion" data-tip="Quitar la selección" data-tip-key="Esc"><i data-icon="close"></i></button>
      </div>`;
    Icons.mount(barra);
    document.body.appendChild(barra);
  }
  const isla = barra.querySelector('.mn-seleccion__isla');
  delete isla.dataset.state;
  barra.querySelector('.mn-seleccion__cuenta').textContent = n === 1 ? '1 mazo' : `${n} mazos`;
}

const carpeta = (id) => S.carpetas.find((c) => c.id === id) || null;
const mazosEnCarpeta = (id) => S.mazos.filter((m) => m.carpeta === id);
function fichasDeCarpeta(id) {
  const ids = new Set(mazosEnCarpeta(id).map((m) => m.id));
  return S.fichas.filter((f) => ids.has(f.mazo));
}

const mazo = (id) => S.mazos.find((m) => m.id === id) || null;
const fichasDe = (mazoId) => S.fichas.filter((f) => f.mazo === mazoId);

/* ── Lecturas del dominio ────────────────────────────────────────────────── */

function estadoFicha(f, hasta = finDeHoy()) {
  if (esNueva(f.srs)) return 'idle';
  if (f.srs.reps === 0) return 'waiting';          // falló y está reaprendiendo
  if (vencida(f.srs, hasta)) return 'queued';
  return 'done';
}

function venceTxt(f) {
  if (esNueva(f.srs)) return 'nueva';
  const dias = Math.ceil((f.srs.due - Date.now()) / DIA);
  if (dias <= 0) return 'para hoy';
  return dias === 1 ? 'mañana' : `en ${dias} días`;
}

function diasTxt(n) {
  if (n === 0) return 'ahora';
  return n === 1 ? '1 día' : `${n} días`;
}

/** Las reglas con las que se arma una cola, leídas de los ajustes. */
const reglas = () => ({
  nuevasPorDia: Number(S.settings.nuevasPorDia) || 0,
  azar: !!S.settings.azar,
});

/* ══ Sesión de repaso ════════════════════════════════════════════════════════ */

function iniciarSesion(mazoId = null) {
  const pool = mazoId ? fichasDe(mazoId) : S.fichas;
  const cola = armarCola(pool, reglas());
  if (!cola.length) {
    Toast.show({ title: 'Nada para repasar', text: 'No hay fichas vencidas ni nuevas por hoy.', icon: 'check' });
    return;
  }
  S.sesion = { mazoId, cola, idx: 0, hechas: 0, otraVez: 0, revelada: false, elegida: null };
  // Si ya estás parado en la vista repaso, go() no repinta: refresh lo fuerza.
  Router.go('repaso', mazoId || 'todo') || Router.refresh();
}

/**
 * Corta la sesión y te devuelve de donde saliste.
 *
 * No pregunta nada, y no es descuido: cada calificación ya se escribió en el
 * disco al momento de darla (ver calificarActual), así que irse no pierde
 * NADA. Lo único que se disuelve es la cola, que es material regenerable —
 * las que fallaste vencen ahora mismo y vuelven en la próxima. Un «¿estás
 * seguro?» sobre algo que no destruye nada es fricción disfrazada de cuidado.
 *
 * El toast no es una felicitación: es el recibo de lo que quedó guardado.
 */
function terminarSesion() {
  const ses = S.sesion;
  if (!ses) {
    // Sin sesión viva y parados en repaso solo puede ser el resumen del final:
    // ahí Escape sigue siendo la puerta, aunque ya no haya nada que cortar.
    if (Router.name === 'repaso') Router.go('inicio');
    return;
  }
  const { mazoId, hechas, otraVez } = ses;
  S.sesion = null;

  if (hechas) {
    Toast.show({
      title: 'Sesión terminada',
      text: `${plural(hechas, 'repaso')}${otraVez ? ` · ${otraVez} para otra vez` : ''}, ya guardados.`,
      icon: 'check',
    });
  }
  Router.go(mazoId ? 'mazo' : 'inicio', mazoId || null) || Router.refresh();
}

/**
 * Prende o apaga el modo azaroso. Es un AJUSTE, no un modo de sesión: se
 * guarda en disco y la próxima cola ya nace en el orden que elegiste. Por eso
 * el botón del repaso y el segmentado de Ajustes entran los dos por acá: son
 * dos manijas de la misma perilla.
 *
 * En vivo reordena lo que falta, y arranca DESPUÉS de la ficha actual: la que
 * estás mirando no se mueve. Cambiar la pregunta abajo del mouse —o peor, con
 * la respuesta ya destapada— no es barajar, es perder el hilo.
 *
 * Apagarlo devuelve la prioridad al resto; no "desbaraja" lo ya repasado,
 * porque eso no existe.
 */
async function setAzar(azar) {
  if (!!S.settings.azar === azar) return;
  await persist({ azar });

  const ses = S.sesion;
  if (ses) {
    const resto = ses.cola.slice(ses.idx + 1);
    ses.cola = [
      ...ses.cola.slice(0, ses.idx + 1),
      ...(azar ? barajar(resto) : resto.sort(porPrioridad)),
    ];
  }

  /* Se toca el botón a mano en vez de repintar la vista: viewRepaso dibuja
     siempre con el velo puesto, así que un refresh acá volvería a tapar una
     respuesta que ya estabas leyendo. */
  const btn = document.getElementById('btn-azar');
  if (btn) {
    btn.classList.toggle('is-on', azar);
    btn.setAttribute('aria-pressed', String(azar));
    btn.dataset.tip = azar ? 'Volver al orden por prioridad' : 'Barajar el repaso';
  }

  Toast.show({
    title: azar ? 'Modo azaroso' : 'Orden por prioridad',
    text: azar
      ? 'Las preguntas salen mezcladas, sin importar cuál vence antes.'
      : 'Vuelve a salir primero lo más atrasado, y las nuevas al final.',
    icon: 'azar',
    duration: 2600,
  });
}

/**
 * El diario de estudio: un contador por día calendario, que crece con cada
 * calificación. Es lo ÚNICO que la app suma sobre la marcha — la srs de cada
 * ficha guarda su estado actual pero no su historia, y sin este registro los
 * gráficos de actividad no tendrían de dónde salir.
 */
async function anotarActividad(q) {
  const id = `d-${claveDia(Date.now())}`;
  await attempt(async () => {
    const previo = S.actividad.find((a) => a.id === id)
      || { id, dia: id.slice(2), repasos: 0, otraVez: 0 };
    const saved = await actividadCol.save({
      ...previo,
      repasos: previo.repasos + 1,
      otraVez: previo.otraVez + (q < 3 ? 1 : 0),
    });
    S.actividad = [saved, ...S.actividad.filter((a) => a.id !== id)];
  }, { errorTitle: 'No se pudo anotar la actividad' });
}

async function calificarActual(q) {
  const ses = S.sesion;
  if (!ses || !ses.revelada) return;
  const actual = ses.cola[ses.idx];
  const srs = calificar(actual.srs || srsNueva(), q);

  const saved = await attempt(() => saveFicha({ ...actual, srs }), { errorTitle: 'No se pudo guardar el repaso' });
  if (!saved) return;
  await anotarActividad(q);

  ses.hechas += 1;
  if (q < 3) {
    ses.otraVez += 1;
    ses.cola.push(saved);       // vuelve al final de la misma sesión
  }
  ses.idx += 1;
  ses.revelada = false;
  ses.elegida = null;
  Router.refresh();
}

/**
 * Contestar una ficha de opción múltiple o de verdadero/falso: marca lo
 * elegido, destapa cuál era, y revela la explicación.
 *
 * No califica sola. Sugiere —resaltando un botón y enfocándolo, así Enter lo
 * toma— pero la última palabra la tiene el que estudia: acertar tirando una
 * moneda entre dos opciones no merece el mismo ease que saberlo, y SM-2 se
 * envenena si el ease sube por suerte.
 */
function elegirOpcion(i) {
  const ses = S.sesion;
  if (!ses || ses.revelada || ses.elegida != null) return;
  const f = ses.cola[ses.idx];
  if (!esInteractiva(f) || i < 0 || i >= opcionesDe(f).length) return;

  ses.elegida = i;
  revelar();                                  // el pintado de las opciones vive ahí

  const sugerido = gradoSugerido(i === indiceCorrecto(f));
  const btn = document.querySelector(`#calif [data-grado="${sugerido}"]`);
  if (btn) {
    btn.classList.add('is-sugerido');
    // El foco espera a que la fila termine de entrar: enfocar algo que todavía
    // es visibility:hidden no le da el foco a nadie.
    setTimeout(() => btn.focus({ preventScroll: true }), 280);
  }
}

/** Destapa el resultado sobre las alternativas. `elegida` puede ser null: es
    el caso de rendirse con Espacio, y ahí solo se muestra cuál era. */
function pintarOpciones(f, elegida) {
  const lista = document.getElementById('opciones');
  if (!lista) return;
  const correcta = indiceCorrecto(f);
  lista.classList.add('is-resuelta');
  lista.querySelectorAll('.mn-opcion').forEach((btn, j) => {
    const marca = btn.querySelector('.mn-opcion__marca');
    if (j === correcta) {
      btn.classList.add('is-correcta');
      marca.innerHTML = Icons.svg('check');
    } else if (j === elegida) {
      btn.classList.add('is-errada');
      marca.innerHTML = Icons.svg('close');
    } else {
      btn.classList.add('is-apagada');
    }
  });
}

function revelar() {
  const ses = S.sesion;
  if (!ses || ses.revelada) return;
  ses.revelada = true;

  const f = ses.cola[ses.idx];
  if (esInteractiva(f)) pintarOpciones(f, ses.elegida);

  /* El orden importa, y son tres cosas en el MISMO frame: se pinta la
     respuesta debajo del velo, el velo se pone el vidrio, y recién ahí se
     disuelve — el texto se aclara a través del vidrio que se va.

     El vidrio llega acá y no antes porque antes no había nada que esmerilar
     (ver `.mn-velo.is-vidrio` en mnemus.css): la respuesta recién existe en
     esta línea. Las tres mutaciones caen en el mismo repintado, así que no
     hay un cuadro con el texto nítido en el medio. */
  const back = document.getElementById('back');
  if (back) back.style.visibility = 'visible';
  const velo = document.getElementById('velo');
  if (velo) {
    velo.classList.add('is-vidrio');
    exit(velo, { fallback: 260 });
  }
  document.getElementById('calif')?.classList.add('is-on');
  updateChrome();
}

/* ══ Sesión de examen ════════════════════════════════════════════════════════
   Una medición, no un repaso (ver examen.js): cada ficha se pregunta UNA vez,
   nada se re-encola, y el SRS no se escribe. La contabilidad es binaria —
   correcta o fallada — y las falladas se guardan enteras para la revisión
   del final: un examen que solo te da un número te dice cuánto no sabés,
   pero no QUÉ. */

/** `extra` es la puerta de los exámenes que no son de UN mazo: una carpeta
    pasa su propio pool y su nombre, y todo lo demás — el armado, el registro
    del historial — sale idéntico. */
function iniciarExamen(mazoId = null, { pool: poolCustom, nombre: nombreCustom } = {}) {
  const pool = poolCustom || (mazoId ? fichasDe(mazoId) : S.fichas);
  if (!pool.length) {
    Toast.show({ title: 'No hay nada que evaluar', text: 'Un examen necesita al menos una ficha.', icon: 'examen' });
    return;
  }
  const m = mazoId ? mazo(mazoId) : null;
  const nombre = nombreCustom || m?.name || null;

  /* El examen empieza con UNA decisión: cuántas preguntas. Todo lo demás ya
     está decidido — entra el mazo completo (no la cola del día) y sale
     barajado. Un armado de cinco perillas no es un examen, es un formulario. */
  const body = document.createElement('div');
  body.className = 'op-field';
  body.innerHTML = `
    <label class="op-field__label">Preguntas</label>
    <div class="op-stepper" id="ex-cantidad" style="max-width:220px">
      <input class="op-input op-num" type="number" min="1" max="${pool.length}" step="1" value="${pool.length}">
      <div class="op-stepper__btns">
        <button class="op-stepper__btn" data-step="up" tabindex="-1"><i data-icon="chevronUp"></i></button>
        <button class="op-stepper__btn" data-step="down" tabindex="-1"><i data-icon="chevronDown"></i></button>
      </div>
    </div>
    <span class="op-field__hint">Salen barajadas, del mazo completo — no solo lo vencido.
      Menos que el total es una muestra al azar. El resultado no toca tu plan de repaso.</span>`;
  Icons.mount(body);
  bindStepper(body.querySelector('#ex-cantidad'), () => {});
  const input = body.querySelector('input');

  return Modal.show({
    title: nombre ? `Examen de ${nombre}` : 'Examen de todo',
    sub: `${plural(pool.length, 'ficha')} en juego. Cada una se pregunta una sola vez.`,
    body,
    width: 420,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Empezar', value: true, variant: 'primary', autofocus: true },
    ],
  }).then((ok) => {
    if (!ok) return;
    const cola = armarExamen(pool, { cantidad: Number(input.value) });
    S.examen = { mazoId, nombre, cola, idx: 0, correctas: 0, falladas: [], revelada: false, elegida: null };
    Router.go('examen', mazoId || 'todo') || Router.refresh();
  });
}

/**
 * Retirarse a la mitad no tira lo contestado: el examen termina ahí y se
 * corrige sobre lo que llegaste a contestar (ver retirar() en examen.js). Lo
 * que no se preguntó no se midió, así que no cuenta ni a favor ni en contra.
 *
 * La salida SÍ pregunta, y la del repaso no: retirarse no se deshace — el
 * examen no se retoma después. Sin nada contestado no hay nota que sacar y
 * se sale sin preguntar, igual que del resumen.
 */
async function abandonarExamen() {
  const ex = S.examen;
  if (!ex) {
    if (Router.name === 'examen') Router.go('inicio');
    return;
  }

  const terminado = ex.idx >= ex.cola.length;
  const n = contestadasExamen(ex);
  if (!terminado && n > 0) {
    const ok = await Modal.confirm({
      title: '¿Retirarte del examen?',
      sub: `Llevás ${n} de ${ex.cola.length} contestadas. Se corrige lo que contestaste; las que faltan no cuentan.`,
      confirmLabel: 'Retirarme',
    });
    if (!ok || S.examen !== ex) return;
    S.examen = retirarExamen(ex);
    guardarExamen(S.examen);
    Router.refresh();
    return;
  }
  const { mazoId } = ex;
  S.examen = null;
  Router.go(mazoId ? 'mazo' : 'inicio', mazoId || null) || Router.refresh();
}

/** Contestar eligiendo, en el examen: acá la elección ES el veredicto. No hay
    autocalificación posible ni grado que discutir — marcaste la que marcaste. */
function elegirOpcionExamen(i) {
  const ex = S.examen;
  if (!ex || ex.revelada) return;
  const f = ex.cola[ex.idx];
  if (!esInteractiva(f) || i < 0 || i >= opcionesDe(f).length) return;
  ex.elegida = i;
  if (i === indiceCorrecto(f)) ex.correctas += 1;
  else ex.falladas.push({ ficha: f, elegida: i });
  revelarExamen();
}

/** El mismo destape del repaso (ver revelar(): las tres mutaciones del velo en
    el mismo frame), con la contabilidad del examen encima. */
function revelarExamen() {
  const ex = S.examen;
  if (!ex || ex.revelada) return;
  const f = ex.cola[ex.idx];

  /* Rendirse en una ficha con alternativas —pedir verla sin elegir— es no
     saberla: en un examen, en blanco no suma. Queda anotada sin elección. */
  if (esInteractiva(f) && ex.elegida == null) ex.falladas.push({ ficha: f, elegida: null });
  ex.revelada = true;
  if (esInteractiva(f)) pintarOpciones(f, ex.elegida);

  const back = document.getElementById('back');
  if (back) back.style.visibility = 'visible';
  const velo = document.getElementById('velo');
  if (velo) {
    velo.classList.add('is-vidrio');
    exit(velo, { fallback: 260 });
  }

  const fila = document.getElementById('ex-resolver');
  if (fila) fila.classList.add('is-on');
  if (esInteractiva(f)) {
    const btn = fila?.querySelector('[data-ex="siguiente"]');
    // El foco espera a que la fila termine de entrar, como en el repaso.
    if (btn) setTimeout(() => btn.focus({ preventScroll: true }), 280);
  }
  updateChrome();
}

/** La básica no se corrige sola: la respuesta ya está a la vista y el único
    que sabe si la tenía sos vos. Binario a propósito — en un examen no hay
    «más o menos la sabía». */
function resolverBasicaExamen(supo) {
  const ex = S.examen;
  if (!ex || !ex.revelada) return;
  const f = ex.cola[ex.idx];
  if (esInteractiva(f)) return;              // las interactivas ya se contaron al elegir
  if (supo) ex.correctas += 1;
  else ex.falladas.push({ ficha: f, elegida: null });
  avanzarExamen();
}

function avanzarExamen() {
  const ex = S.examen;
  if (!ex || !ex.revelada) return;
  ex.idx += 1;
  ex.revelada = false;
  ex.elegida = null;
  // El historial se escribe en la TRANSICIÓN al resumen, no al pintarlo: el
  // resumen se puede repintar mil veces y el registro tiene que ser uno.
  if (ex.idx >= ex.cola.length) guardarExamen(ex);
  Router.refresh();
}

/**
 * Un examen corregido queda en el historial — terminado o retirado. El
 * retirado se guarda con la nota sobre lo contestado y lleva `planeadas`
 * para que el historial diga en cuánto te retiraste.
 */
async function guardarExamen(ex) {
  if (ex.guardado) return;
  ex.guardado = true;                    // antes del await: nadie escribe dos veces
  await attempt(async () => {
    const id = await examenesCol.nextId('e');
    await saveExamen({ ...registroExamen(ex, { nombre: ex.nombre || null }), id });
  }, { errorTitle: 'No se pudo guardar el examen en el historial' });
}

/**
 * Del resumen a una sesión de repaso normal con SOLO lo que fallaste. Recién
 * acá el examen toca el plan de repaso, y lo hace por la puerta de siempre:
 * la sesión que arranca es un repaso común, que escribe su SRS al calificar
 * como cualquier repaso que hayas pedido vos.
 */
function repasarFalladas() {
  const ex = S.examen;
  if (!ex || !ex.falladas.length) return;
  // De S.fichas y no del examen: si una ficha cambió en el medio, se repasa la viva.
  const cola = ex.falladas
    .map(({ ficha }) => S.fichas.find((f) => f.id === ficha.id))
    .filter(Boolean);
  if (!cola.length) return;
  const { mazoId } = ex;
  S.examen = null;
  S.sesion = { mazoId, cola, idx: 0, hechas: 0, otraVez: 0, revelada: false, elegida: null };
  Router.go('repaso', mazoId || 'todo') || Router.refresh();
}

/**
 * Repasar una carpeta entera: la cola se arma con las fichas de TODOS sus
 * mazos, con las mismas reglas de siempre (vencidas primero, cupo de nuevas,
 * azar si está prendido). Es la razón de fondo de agrupar por tema — la
 * carpeta es la unidad de estudio, el mazo es la unidad de contenido.
 */
function repasarCarpeta(id) {
  const cola = armarCola(fichasDeCarpeta(id), reglas());
  if (!cola.length) {
    Toast.show({ title: 'Nada para repasar en esta carpeta', text: 'No hay fichas vencidas ni nuevas por hoy.', icon: 'check' });
    return;
  }
  S.sesion = { mazoId: null, cola, idx: 0, hechas: 0, otraVez: 0, revelada: false, elegida: null };
  Router.go('repaso', 'todo') || Router.refresh();
}

/* ══ La lista de mazos, agrupada por carpeta ═════════════════════════════════
   La misma lista en Inicio y en Mazos. Sin carpetas creadas es la lista plana
   de siempre — las carpetas no le cobran nada a quien no las usa. */

function listaMazosHTML() {
  if (!S.carpetas.length) return `<div class="op-list">${S.mazos.map(rowMazo).join('')}</div>`;

  const plegadas = new Set(S.settings.plegadas || []);
  return agruparMazos(S.mazos, S.carpetas).map(({ carpeta: c, mazos }) => {
    const id = c ? c.id : 'raiz';
    const abierta = !plegadas.has(id);
    const hoy = paraHoy(mazos.flatMap((m) => fichasDe(m.id)), reglas());
    return `
      <div class="mn-carpeta${abierta ? '' : ' is-plegada'}" data-carpeta="${esc(id)}">
        <div class="mn-carpeta__head" role="button" tabindex="0" data-plegar="${esc(id)}" aria-expanded="${abierta}">
          <i data-icon="chevronDown" data-icon-class="mn-carpeta__chevron"></i>
          ${c ? '<i data-icon="folder"></i>' : ''}
          <span class="mn-carpeta__nombre">${esc(c ? c.name : 'Sin carpeta')}</span>
          <span class="op-meta">${plural(mazos.length, 'mazo')}${hoy ? ` · ${hoy} para hoy` : ''}</span>
          <span class="op-grow"></span>
          ${c ? `
          <div class="op-rowactions">
            <button class="op-iconbtn op-iconbtn--sm" data-action="repasar-carpeta" data-arg="${esc(c.id)}" data-tip="Repasar la carpeta entera"><i data-icon="zap"></i></button>
            <button class="op-iconbtn op-iconbtn--sm" data-menu="carpeta" data-menu-arg="${esc(c.id)}" data-tip="Más"><i data-icon="more"></i></button>
          </div>` : ''}
        </div>
        <div class="mn-carpeta__cuerpo"><div class="mn-carpeta__inner">
          ${mazos.length
            ? `<div class="op-list">${mazos.map(rowMazo).join('')}</div>`
            : '<div class="op-meta mn-carpeta__vacia">Vacía. Los mazos se mueven acá desde su menú.</div>'}
        </div></div>
      </div>`;
  }).join('');
}

/**
 * Plegar es un ajuste, no un estado de la vista: persiste, y NO repinta —
 * el CSS anima el cierre en el lugar (misma razón que el botón de azar:
 * un refresh acá te movería la lista abajo del mouse).
 */
function togglePlegada(id) {
  const plegadas = new Set(S.settings.plegadas || []);
  const plegada = !plegadas.has(id);
  plegada ? plegadas.add(id) : plegadas.delete(id);
  persist({ plegadas: [...plegadas] });
  document.querySelectorAll(`.mn-carpeta[data-carpeta="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.toggle('is-plegada', plegada);
    el.querySelector('[data-plegar]')?.setAttribute('aria-expanded', String(!plegada));
  });
}

/* ══ Vista: Inicio ═══════════════════════════════════════════════════════════ */

function viewInicio() {
  const hoy = paraHoy(S.fichas, reglas());

  paint(head({
    title: 'Inicio',
    sub: 'Lo que se repasa hoy es lo que no se olvida mañana',
    actions: `
      ${hoy ? '<button class="op-btn op-btn--primary op-flashable" data-action="repasar"><i data-icon="zap"></i> Repasar ahora</button>' : ''}
      ${S.fichas.length ? '<button class="op-btn op-btn--secondary op-flashable" data-action="examen" data-tip="Un examen de todos los mazos juntos"><i data-icon="examen"></i> Examen</button>' : ''}
      <button class="op-btn op-btn--secondary op-flashable" data-action="nuevo-mazo"><i data-icon="plus"></i> Nuevo mazo</button>`,
  }) + `
    <div class="op-scroll op-grow">
      <div class="op-row" style="gap:40px;margin-bottom:28px;flex-wrap:wrap">
        <div class="op-stat"><span class="op-stat__value" id="k-hoy">0</span><span class="op-stat__label">Para hoy</span></div>
        <div class="op-stat"><span class="op-stat__value" id="k-fichas">0</span><span class="op-stat__label">Fichas</span></div>
        <div class="op-stat"><span class="op-stat__value" id="k-mazos">0</span><span class="op-stat__label">Mazos</span></div>
      </div>

      ${S.mazos.length ? `
        <div class="op-section">
          <div class="op-section__head"><span class="op-section__title">Mazos</span></div>
          ${listaMazosHTML()}
        </div>`
      : `<div class="op-empty" style="margin:24px auto">${Icons.svg('mnemus')}
          <div class="op-empty__title">Todavía no hay mazos</div>
          <div class="op-empty__text">Un mazo agrupa fichas de un tema. Creá el primero, cargale preguntas, y Mnemus decide cuándo te conviene volver a verlas.</div>
          <div class="op-row" style="margin-top:6px"><button class="op-btn op-btn--secondary op-flashable" data-action="nuevo-mazo"><i data-icon="plus"></i> Crear el primero</button></div>
        </div>`}
      <div style="height:32px"></div>
    </div>`);

  countTo(document.getElementById('k-hoy'), hoy);
  countTo(document.getElementById('k-fichas'), S.fichas.length);
  countTo(document.getElementById('k-mazos'), S.mazos.length);
}

function rowMazo(m) {
  const fichas = fichasDe(m.id);
  const hoy = paraHoy(fichas, reglas());
  const st = hoy ? 'queued' : (fichas.length ? 'done' : 'idle');
  /* La marca se explica sola: el lleno es «al día» y el hueco «con deuda», y
     eso no se adivina — se pregunta con el mouse. */
  const tip = { queued: 'Tiene fichas para hoy', done: 'Al día: nada vence hoy', idle: 'Sin fichas todavía' }[st];
  return `
    <div class="op-listitem${seleccion.has(m.id) ? ' is-selected' : ''}" role="button" tabindex="0" data-open-mazo="${esc(m.id)}" draggable="true" aria-selected="${seleccion.has(m.id)}">
      <span data-tip="${esc(tip)}">${mark(st, 'square')}</span>
      <div class="op-listitem__main">
        <span class="op-listitem__title">${esc(m.name)}</span>
        <span class="op-listitem__sub">${plural(fichas.length, 'ficha')}${hoy ? ` · ${hoy} para hoy` : ' · al día'}</span>
      </div>
      <div class="op-listitem__aside">
        ${hoy ? `<span class="op-chip">${hoy}</span>` : ''}
        <div class="op-rowactions">
          <button class="op-iconbtn op-iconbtn--sm" data-action="repasar" data-arg="${esc(m.id)}" data-tip="Repasar este mazo"><i data-icon="zap"></i></button>
          ${fichas.length ? `<button class="op-iconbtn op-iconbtn--sm" data-action="examen" data-arg="${esc(m.id)}" data-tip="Tomar examen"><i data-icon="examen"></i></button>` : ''}
          <button class="op-iconbtn op-iconbtn--sm" data-menu="mazo" data-menu-arg="${esc(m.id)}" data-tip="Más"><i data-icon="more"></i></button>
        </div>
      </div>
    </div>`;
}

/* ══ Vista: Mazos ════════════════════════════════════════════════════════════ */

function viewMazos() {
  paint(head({
    title: 'Mazos',
    sub: plural(S.mazos.length, 'mazo') + ' · ' + plural(S.fichas.length, 'ficha'),
    actions: `
      <button class="op-btn op-btn--primary op-flashable" data-action="nuevo-mazo"><i data-icon="plus"></i> Nuevo mazo</button>
      ${S.mazos.length ? '<button class="op-btn op-btn--secondary op-flashable" data-action="nueva-carpeta"><i data-icon="folder"></i> Nueva carpeta</button>' : ''}
      <button class="op-btn op-btn--secondary op-flashable" data-action="importar"><i data-icon="download"></i> Importar</button>
      ${S.mazos.length ? '<button class="op-iconbtn" data-action="exportar-todo" data-tip="Exportar todos los mazos"><i data-icon="upload"></i></button>' : ''}`,
  }) + (S.mazos.length
    ? `<div class="op-scroll op-grow">
         ${listaMazosHTML()}
         <div style="height:32px"></div>
       </div>`
    : empty({
      icon: 'mnemus',
      title: 'No hay mazos',
      text: 'Cada mazo es una carpeta de fichas JSON en tu disco: legibles, versionables, tuyas. Si alguien te pasó un mazo, importalo acá.',
      actions: `
        <button class="op-btn op-btn--secondary op-flashable" data-action="nuevo-mazo"><i data-icon="plus"></i> Crear el primero</button>
        <button class="op-btn op-btn--ghost op-flashable" data-action="importar"><i data-icon="download"></i> Importar uno</button>`,
    })));
}

/* ══ Vista: un mazo ══════════════════════════════════════════════════════════ */

function viewMazo(id) {
  const m = mazo(id);
  if (!m) {
    paint(head({ title: 'No encontrado', crumbs: [{ label: 'Mazos', view: 'mazos' }, { label: id }] })
      + empty({ icon: 'alert', title: `No existe ${id}`, text: 'Puede que lo hayas borrado, o que el archivo ya no esté en la carpeta de datos.' }));
    return;
  }

  const fichas = fichasDe(id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const hoy = paraHoy(fichas, reglas());
  const c = m.carpeta ? carpeta(m.carpeta) : null;

  paint(head({
    title: m.name,
    sub: plural(fichas.length, 'ficha') + (hoy ? ` · ${hoy} para hoy` : ' · al día'),
    crumbs: [
      { label: 'Mazos', view: 'mazos' },
      ...(c ? [{ label: c.name, view: 'mazos' }] : []),
      { label: m.name },
    ],
    actions: `
      <button class="op-btn op-btn--primary op-flashable" data-action="nueva-ficha" data-arg="${esc(id)}"><i data-icon="plus"></i> Nueva ficha</button>
      ${hoy ? `<button class="op-btn op-btn--secondary op-flashable" data-action="repasar" data-arg="${esc(id)}"><i data-icon="zap"></i> Repasar</button>` : ''}
      ${fichas.length ? `<button class="op-btn op-btn--secondary op-flashable" data-action="examen" data-arg="${esc(id)}"><i data-icon="examen"></i> Examen</button>` : ''}
      <button class="op-iconbtn" data-menu="mazo" data-menu-arg="${esc(id)}" data-tip="Más"><i data-icon="more"></i></button>`,
  }) + (fichas.length
    ? `<div class="op-scroll op-grow">
         <div class="op-list">${fichas.map(rowFicha).join('')}</div>
         <div style="height:32px"></div>
       </div>`
    : empty({
      icon: 'inbox',
      title: 'Mazo vacío',
      text: 'Cargá la primera pregunta. La respuesta va a vivir detrás del vidrio hasta que digas.',
      actions: `<button class="op-btn op-btn--secondary op-flashable" data-action="nueva-ficha" data-arg="${esc(id)}"><i data-icon="plus"></i> Primera ficha</button>`,
    })));
}

function rowFicha(f) {
  const st = estadoFicha(f);
  const tip = {
    idle: 'Nueva: todavía no la estudiaste',
    waiting: 'Aprendiendo: la fallaste y vuelve enseguida',
    queued: 'Vencida: entra en el próximo repaso',
    done: 'Al día',
  }[st];
  return `
    <div class="op-listitem" role="button" tabindex="0" data-action="editar-ficha" data-arg="${esc(f.id)}">
      <span data-tip="${esc(tip)}">${mark(st)}</span>
      <div class="op-listitem__main">
        <span class="op-listitem__title">${esc(f.front)}</span>
        <span class="op-listitem__sub">${tipoDe(f) === 'basica' ? '' : `${esc(ETIQUETA_TIPO[tipoDe(f)])} · `}${esc(venceTxt(f))}${f.srs?.lapses ? ` · ${plural(f.srs.lapses, 'olvido')}` : ''}</span>
      </div>
      <div class="op-rowactions">
        <button class="op-iconbtn op-iconbtn--sm" data-menu="ficha" data-menu-arg="${esc(f.id)}" data-tip="Más"><i data-icon="more"></i></button>
      </div>
    </div>`;
}

/* ══ Vista: Repaso ═══════════════════════════════════════════════════════════
   Una ficha por vez, centrada sobre la niebla. La respuesta nace detrás del
   velo esmerilado; Espacio la revela, 1–4 califican, «a» baraja lo que falta. */

/**
 * Lo que va arriba a la derecha mientras dura el repaso.
 *
 * Salir lleva PALABRA y no solo ícono. Un cuadrado o una cruz ahí arriba caen
 * a setenta píxeles de maximizar y cerrar la ventana, y las tres cosas se
 * leerían igual: el ícono solo es barato cuando no compite con otro ícono que
 * significa algo mucho más gordo.
 */
function accionesRepaso({ conSalida = true } = {}) {
  const on = !!S.settings.azar;
  return `
    ${conSalida ? `
      <button class="op-btn op-btn--ghost op-flashable" data-action="terminar" data-tip-key="Esc"
              data-tip="La sesión corta acá; lo calificado ya está guardado"><i data-icon="stop"></i> Terminar</button>` : ''}
    <button class="op-iconbtn${on ? ' is-on' : ''}" id="btn-azar" data-action="azar"
            aria-pressed="${on}" data-tip="${on ? 'Volver al orden por prioridad' : 'Barajar el repaso'}"
            data-tip-key="A"><i data-icon="azar"></i></button>`;
}

/** La hoja de la ficha — compartida por el repaso y el examen: el frente (con
    sus alternativas si las hay), el divisor, y la respuesta naciendo detrás
    del velo. Quien la pinta cablea sus propios clicks: la hoja es la misma,
    lo que significa contestarla no. */
function hojaFicha(f) {
  const interactiva = esInteractiva(f);
  const ops = opcionesDe(f);
  return `
      <div class="mn-ficha${interactiva ? ' mn-ficha--interactiva' : ''}">
        <div class="mn-ficha__zona">${interactiva ? `
          <div class="mn-consulta op-scroll">
            <div class="mn-ficha__front op-copyable">${esc(f.front)}</div>
            <div class="mn-opciones" id="opciones">
              ${ops.map((o, i) => `
                <button class="mn-opcion op-flashable" data-opcion="${i}">
                  <span class="mn-opcion__letra">${letra(i)}</span>
                  <span class="mn-opcion__texto op-copyable">${esc(o)}</span>
                  <span class="op-kbd">${i + 1}</span>
                  <span class="mn-opcion__marca"></span>
                </button>`).join('')}
            </div>
          </div>`
          : `<div class="mn-ficha__front op-copyable">${esc(f.front)}</div>`}
        </div>
        <div class="mn-ficha__divisor"></div>
        <div class="mn-ficha__answer">
          <!-- La respuesta nace SIN PINTAR (visibility:hidden), no solo tapada:
               así ningún capricho del compositor puede dejarla legible antes
               de tiempo. El des-esmerilado real pasa al revelar: se pinta el
               texto debajo del velo y el velo se disuelve encima. -->
          <div class="mn-ficha__back op-copyable${interactiva ? ' op-scroll' : ''}" id="back" style="visibility:hidden">${esc(f.back)}</div>
          <button class="mn-velo" id="velo" aria-label="Revelar la respuesta">
            <span class="mn-velo__hint">${interactiva
              ? 'Elegí una · <span class="op-kbd">Espacio</span> la muestra'
              : '<span class="op-kbd">Espacio</span> revelar'}</span>
          </button>
        </div>
      </div>`;
}

function viewRepaso(param) {
  const mazoId = param === 'todo' ? null : param;

  // Entrar directo desde el arranque sin sesión viva: se arma acá.
  if (!S.sesion || (S.sesion.mazoId || 'todo') !== (mazoId || 'todo')) {
    const cola = armarCola(mazoId ? fichasDe(mazoId) : S.fichas, reglas());
    if (!cola.length) {
      paint(head({ title: 'Repaso' }) + empty({
        icon: 'check',
        title: 'Nada para repasar',
        text: 'No hay fichas vencidas ni nuevas por hoy. Volvé mañana, o bajá el cupo si te quedaste con ganas.',
        actions: '<button class="op-btn op-btn--secondary op-flashable" data-goto="inicio">Volver al inicio</button>',
      }));
      return;
    }
    S.sesion = { mazoId, cola, idx: 0, hechas: 0, otraVez: 0, revelada: false, elegida: null };
  }

  const ses = S.sesion;

  /* Los atajos viven mientras vive la vista: Router.onLeave los suelta.
     Sin eso, cada visita apila un handler más y una tecla califica dos veces. */
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    /* Con un overlay abierto no se toca nada: Escape es de él —cerrarlo— antes
       que de la sesión, y una calificación no puede salir de atrás de un
       modal. El guard va ANTES que todo lo demás por eso mismo. */
    if (document.querySelector('.op-modal, .op-menu')) return;
    if (e.key === ' ') { e.preventDefault(); ses.revelada ? null : revelar(); }

    // Salir. Sin overlay abierto, Escape es la puerta de la sesión.
    if (e.key === 'Escape') { e.preventDefault(); terminarSesion(); return; }

    /* «a» de azar. Es la única letra con atajo acá y no compite con nada: los
       dígitos ya están tomados por las alternativas y las calificaciones. */
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setAzar(!S.settings.azar); return; }

    const n = '123456'.indexOf(e.key);
    if (n < 0) return;
    e.preventDefault();
    /* El mismo dígito significa dos cosas según la fase, y nunca las dos a la
       vez: antes de contestar elige una alternativa, después califica. Por eso
       las opciones se rotulan con letras — si también fueran números, «3»
       sería la opción C y «Bien» al mismo tiempo. */
    if (!ses.revelada && esInteractiva(ses.cola[ses.idx])) elegirOpcion(n);
    else if (n < 4) calificarActual([GRADOS.otra, GRADOS.dificil, GRADOS.bien, GRADOS.facil][n]);
  };
  document.addEventListener('keydown', onKey);
  Router.onLeave(() => document.removeEventListener('keydown', onKey));

  if (ses.idx >= ses.cola.length) {
    S.sesion = null;
    // El de azar sigue acá a propósito: terminar es cuándo se decide cómo
    // querés la próxima. Sin sesión viva, solo guarda el ajuste. El de salir
    // no: de acá ya saliste, y abajo está el botón que corresponde.
    paint(head({ title: 'Repaso', actions: accionesRepaso({ conSalida: false }) }) + `
      <div class="mn-repaso">
        <div class="mn-fin">
          ${Icons.svg('check')}
          <div class="op-subtitle">Sesión terminada</div>
          <div class="op-meta">Lo repasado hoy vuelve justo antes de que se olvide.</div>
          <div class="mn-fin__cifras">
            <div class="op-stat"><span class="op-stat__value">${ses.hechas}</span><span class="op-stat__label">Repasos</span></div>
            <div class="op-stat"><span class="op-stat__value">${ses.otraVez}</span><span class="op-stat__label">Otra vez</span></div>
          </div>
          <div class="op-row" style="gap:8px;margin-top:14px">
            <button class="op-btn op-btn--primary op-flashable" data-goto="inicio">Volver al inicio</button>
          </div>
        </div>
      </div>`);
    updateChrome();
    return;
  }

  const f = ses.cola[ses.idx];
  const m = mazo(f.mazo);
  const pct = Math.round((ses.idx / ses.cola.length) * 100);
  const grados = [
    ['otra', 'Otra vez', GRADOS.otra],
    ['dificil', 'Difícil', GRADOS.dificil],
    ['bien', 'Bien', GRADOS.bien],
    ['facil', 'Fácil', GRADOS.facil],
  ];

  paint(head({
    title: m ? m.name : 'Repaso',
    sub: `${ses.idx + 1} de ${ses.cola.length}${ses.otraVez ? ` · ${ses.otraVez} otra vez` : ''}`,
    crumbs: m ? [{ label: 'Mazos', view: 'mazos' }, { label: m.name }] : undefined,
    actions: accionesRepaso(),
  }) + `
    <div class="mn-repaso">
      <div class="mn-progreso">
        <span class="op-meta op-num">${ses.idx + 1}/${ses.cola.length}</span>
        <div class="op-meter"><div class="op-meter__fill" style="--op-pct:${pct}%"></div></div>
        <span class="op-meta op-num">${ses.otraVez} otra vez</span>
      </div>

      ${hojaFicha(f)}

      <div class="mn-calif" id="calif">
        ${grados.map(([id, label, q], i) => `
          <button class="op-btn op-btn--secondary op-flashable mn-calif__${id}" data-grado="${q}">
            <span class="mn-calif__label">${label}</span>
            <span class="mn-calif__int">${id === 'otra' ? 'vuelve hoy' : diasTxt(simular(f.srs, q))} · ${i + 1}</span>
          </button>`).join('')}
      </div>
    </div>`);

  const raiz = viewEl();
  raiz.querySelector('#velo').addEventListener('click', revelar);
  raiz.querySelector('#opciones')?.addEventListener('click', (e) => {
    // El texto de las alternativas es copiable: marcarlo y soltar dispara un
    // click que NO es una respuesta. Si quedó algo seleccionado, no fue elegir.
    if (!window.getSelection().isCollapsed) return;
    const btn = e.target.closest('[data-opcion]');
    if (btn) elegirOpcion(Number(btn.dataset.opcion));
  });
  raiz.querySelector('#calif').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-grado]');
    if (btn) calificarActual(Number(btn.dataset.grado));
  });

  updateChrome();
}

/* ══ Vista: Examen ═══════════════════════════════════════════════════════════
   La misma hoja del repaso con otra contabilidad: cada ficha se pregunta una
   vez, nada se re-encola, y al final hay una nota. Sin botón de azar — el
   examen ya nace barajado y no hay prioridad que restaurar. */

function viewExamen(param) {
  const mazoId = param === 'todo' ? null : param;
  const ex = S.examen;

  /* Aterrizar acá sin examen armado (el flujo normal arma primero y navega
     después): se ofrece armarlo, no se arma solo. Un examen empieza con una
     decisión, no con un render. */
  if (!ex || (ex.mazoId || 'todo') !== (mazoId || 'todo')) {
    paint(head({ title: 'Examen' }) + empty({
      icon: 'examen',
      title: 'No hay examen en curso',
      text: 'Un examen toma fichas del mazo, las pregunta una sola vez cada una, y te devuelve la prueba corregida. Sin tocar tu plan de repaso.',
      actions: `<button class="op-btn op-btn--secondary op-flashable" data-action="examen"${mazoId ? ` data-arg="${esc(mazoId)}"` : ''}><i data-icon="examen"></i> Armar examen</button>`,
    }));
    return;
  }

  const m = ex.mazoId ? mazo(ex.mazoId) : null;
  const titulo = ex.nombre || 'Examen';
  const total = ex.cola.length;
  const crumbs = m ? [{ label: 'Mazos', view: 'mazos' }, { label: m.name }] : undefined;

  /* Los atajos viven mientras vive la vista, como en el repaso. */
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (document.querySelector('.op-modal, .op-menu')) return;
    if (e.key === 'Escape') { e.preventDefault(); abandonarExamen(); return; }
    if (ex.idx >= total) return;                    // en el resumen solo queda la puerta

    const f = ex.cola[ex.idx];
    if (e.key === ' ') {
      e.preventDefault();
      if (!ex.revelada) revelarExamen();
      else if (esInteractiva(f)) avanzarExamen();   // Espacio también pasa de página
      return;
    }
    const n = '123456'.indexOf(e.key);
    if (n < 0) return;
    e.preventDefault();
    /* El mismo dígito, dos fases: antes de contestar elige la alternativa;
       en una básica revelada, 1 y 2 son «No la sabía» y «La sabía». */
    if (!ex.revelada && esInteractiva(f)) elegirOpcionExamen(n);
    else if (ex.revelada && !esInteractiva(f) && n < 2) resolverBasicaExamen(n === 1);
  };
  document.addEventListener('keydown', onKey);
  Router.onLeave(() => document.removeEventListener('keydown', onKey));

  /* ── El resumen: la prueba corregida ──
     Vive mientras S.examen viva — un repintado vuelve a mostrarlo. Se
     disuelve recién al salir por cualquiera de sus puertas. */
  if (ex.idx >= total) {
    const nota = puntaje(ex.correctas, total);
    const correctaDe = (f) => opcionesDe(f)[indiceCorrecto(f)] ?? '';
    const retirado = !!ex.planeadas;

    paint(head({
      title: titulo,
      sub: retirado
        ? `Te retiraste con ${total} de ${ex.planeadas} contestadas: se corrigió eso`
        : 'La prueba, corregida',
      crumbs,
    }) + `
      <div class="op-scroll op-grow">
        <div class="mn-resultado">
          <div class="mn-nota"><span class="mn-nota__num op-num" id="nota">0</span><span class="mn-nota__pct">%</span></div>
          <div class="op-subtitle">${esc(veredicto(nota))}</div>
          <div class="mn-fin__cifras">
            <div class="op-stat"><span class="op-stat__value op-num">${ex.correctas}</span><span class="op-stat__label">Correctas</span></div>
            <div class="op-stat"><span class="op-stat__value op-num">${ex.falladas.length}</span><span class="op-stat__label">Incorrectas</span></div>
            <div class="op-stat"><span class="op-stat__value op-num">${total}</span><span class="op-stat__label">${retirado ? 'Contestadas' : 'Preguntas'}</span></div>
            ${retirado ? `<div class="op-stat"><span class="op-stat__value op-num">${ex.planeadas - total}</span><span class="op-stat__label">Sin contestar</span></div>` : ''}
          </div>
          <div class="op-row" style="gap:8px;margin-top:14px">
            ${ex.falladas.length ? '<button class="op-btn op-btn--primary op-flashable" data-ex="repasar-falladas"><i data-icon="zap"></i> Repasar las falladas</button>' : ''}
            <button class="op-btn op-btn--${ex.falladas.length ? 'secondary' : 'primary'} op-flashable" data-ex="salir">Volver al inicio</button>
            <button class="op-btn op-btn--ghost op-flashable" data-goto="examenes" data-tip="Este resultado ya quedó guardado ahí"><i data-icon="examen"></i> Historial</button>
          </div>
        </div>

        ${ex.falladas.length ? `
          <div class="op-section mn-revision">
            <div class="op-section__head"><span class="op-section__title">Para revisar</span></div>
            <div class="op-list">
              ${ex.falladas.map(({ ficha: f, elegida }) => `
                <div class="op-listitem mn-revision__item">
                  ${mark('failed')}
                  <div class="op-listitem__main">
                    <span class="op-listitem__title op-copyable">${esc(f.front)}</span>
                    <span class="op-listitem__sub op-copyable">${esInteractiva(f)
                      ? `Era ${esc(correctaDe(f))}${elegida != null ? ` · marcaste ${esc(opcionesDe(f)[elegida])}` : ' · la dejaste pasar'}`
                      : esc(f.back)}</span>
                    ${esInteractiva(f) && f.back ? `<span class="op-listitem__sub op-copyable">${esc(f.back)}</span>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>` : ''}
        <div style="height:32px"></div>
      </div>`);

    countTo(document.getElementById('nota'), nota, { duration: 900 });
    const raiz = viewEl();
    raiz.querySelector('[data-ex="repasar-falladas"]')?.addEventListener('click', repasarFalladas);
    raiz.querySelector('[data-ex="salir"]').addEventListener('click', () => {
      S.examen = null;
      Router.go('inicio');
    });
    updateChrome();
    return;
  }

  /* ── La pregunta ── */
  const f = ex.cola[ex.idx];
  const interactiva = esInteractiva(f);
  const pctAvance = Math.round((ex.idx / total) * 100);
  const ultima = ex.idx === total - 1;

  paint(head({
    title: titulo,
    sub: `Examen · ${ex.idx + 1} de ${total}`,
    crumbs,
    actions: `
      <button class="op-btn op-btn--ghost op-flashable" data-action="abandonar-examen" data-tip-key="Esc"
              data-tip="Terminar acá: se corrige lo que llevás contestado"><i data-icon="stop"></i> Retirarse</button>`,
  }) + `
    <div class="mn-repaso">
      <div class="mn-progreso">
        <span class="op-meta op-num">${ex.idx + 1}/${total}</span>
        <div class="op-meter"><div class="op-meter__fill" style="--op-pct:${pctAvance}%"></div></div>
        <span class="mn-marcador">
          <span>${Icons.svg('check', 'op-icon--sm')}<span class="op-num">${ex.correctas}</span></span>
          <span>${Icons.svg('close', 'op-icon--sm')}<span class="op-num">${ex.falladas.length}</span></span>
        </span>
      </div>

      ${hojaFicha(f)}

      ${interactiva ? `
        <div class="mn-avance" id="ex-resolver">
          <button class="op-btn op-btn--primary op-flashable" data-ex="siguiente">
            ${ultima ? 'Ver el resultado' : 'Siguiente'}
          </button>
        </div>`
      : `
        <div class="mn-calif mn-calif--par" id="ex-resolver">
          <button class="op-btn op-btn--secondary op-flashable mn-calif__otra" data-ex="no-sabia">
            <span class="mn-calif__label">No la sabía</span>
            <span class="mn-calif__int">incorrecta · 1</span>
          </button>
          <button class="op-btn op-btn--secondary op-flashable" data-ex="sabia">
            <span class="mn-calif__label">La sabía</span>
            <span class="mn-calif__int">correcta · 2</span>
          </button>
        </div>`}
    </div>`);

  const raiz = viewEl();
  raiz.querySelector('#velo').addEventListener('click', revelarExamen);
  raiz.querySelector('#opciones')?.addEventListener('click', (e) => {
    // Marcar texto para copiarlo no es contestar, igual que en el repaso.
    if (!window.getSelection().isCollapsed) return;
    const btn = e.target.closest('[data-opcion]');
    if (btn) elegirOpcionExamen(Number(btn.dataset.opcion));
  });
  raiz.querySelector('#ex-resolver').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ex]');
    if (!btn) return;
    if (btn.dataset.ex === 'siguiente') avanzarExamen();
    else resolverBasicaExamen(btn.dataset.ex === 'sabia');
  });

  updateChrome();
}

/* ══ Vista: Exámenes ═════════════════════════════════════════════════════════
   El historial de lo rendido. Es tuyo y es editable: cada examen acepta una
   nota al margen (para anotarle el contexto que el número no cuenta) y se
   puede eliminar. Como todo en Mnemus, cada registro es un JSON en tu disco. */

function viewExamenes() {
  const regs = [...S.examenes].sort((a, b) => (b.fecha || 0) - (a.fecha || 0));

  paint(head({
    title: 'Exámenes',
    sub: regs.length
      ? `${plural(regs.length, 'examen', 'exámenes')} · promedio ${promedioExamenes(regs)}%`
      : 'El historial de lo que rendiste',
  }) + (regs.length
    ? `<div class="op-scroll op-grow">
         <div class="op-list">${regs.map(rowExamen).join('')}</div>
         <div style="height:32px"></div>
       </div>`
    : empty({
      icon: 'examen',
      title: 'Todavía no rendiste ninguno',
      text: 'Cada examen que rindas queda acá: la nota, qué fallaste, y lo que quieras anotarle. Si te retirás a la mitad, queda con la nota de lo que contestaste.',
      actions: S.fichas.length
        ? '<button class="op-btn op-btn--secondary op-flashable" data-action="examen"><i data-icon="examen"></i> Tomar el primero</button>'
        : '',
    })));
}

function rowExamen(r) {
  const nota = puntaje(r.correctas, r.total);
  return `
    <div class="op-listitem" role="button" tabindex="0" data-action="ver-examen" data-arg="${esc(r.id)}">
      ${mark(nota >= 50 ? 'done' : 'failed')}
      <div class="op-listitem__main">
        <span class="op-listitem__title">${esc(r.nombre || 'Todos los mazos')}</span>
        <span class="op-listitem__sub">${esc(relTime(r.fecha))} · ${r.correctas} de ${plural(r.total, 'pregunta')}${r.planeadas ? ` · retirado (${r.total} de ${r.planeadas})` : ''}${r.comentario ? ` · ${esc(r.comentario)}` : ''}</span>
      </div>
      <div class="op-listitem__aside">
        <span class="op-chip op-num">${nota}%</span>
        <div class="op-rowactions">
          <button class="op-iconbtn op-iconbtn--sm" data-action="eliminar-examen" data-arg="${esc(r.id)}" data-tip="Eliminar del historial"><i data-icon="trash"></i></button>
        </div>
      </div>
    </div>`;
}

/** El detalle de un examen rendido: las cifras, la revisión que quedó
    congelada ese día, y la nota al margen — lo único editable, porque el
    resultado ya pasó y los resultados no se editan. */
async function verExamen(id) {
  const r = S.examenes.find((x) => x.id === id);
  if (!r) return;
  const nota = puntaje(r.correctas, r.total);
  const fecha = new Date(r.fecha).toLocaleString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const body = document.createElement('div');
  body.className = 'op-col';
  body.style.gap = '14px';
  body.innerHTML = `
    <div class="op-kv">
      <span class="op-kv__k">Nota</span><span class="op-kv__v"><span class="op-num">${nota}%</span> — ${esc(veredicto(nota))}</span>
      <span class="op-kv__k">Cifras</span><span class="op-kv__v op-num">${r.correctas} de ${r.total} correctas${r.planeadas ? ` · te retiraste con ${r.total} de ${r.planeadas} contestadas` : ''}</span>
      <span class="op-kv__k">Fecha</span><span class="op-kv__v">${esc(fecha)}</span>
    </div>
    <div class="op-field">
      <label class="op-field__label">Nota al margen</label>
      <textarea class="op-textarea" id="ex-comentario" rows="2" placeholder="Rendido sin estudiar, antes del parcial…"></textarea>
    </div>
    ${r.falladas?.length ? `
      <div class="op-field">
        <label class="op-field__label">Lo que fallaste ese día</label>
        <div class="op-list op-scroll" id="ex-falladas" style="max-height:230px">
          ${r.falladas.map((f) => `
            <div class="op-listitem mn-revision__item">
              ${mark('failed')}
              <div class="op-listitem__main">
                <span class="op-listitem__title op-copyable">${esc(f.front)}</span>
                <span class="op-listitem__sub op-copyable">${f.respuesta != null
                  ? `Era ${esc(f.respuesta)}${f.elegida ? ` · marcaste ${esc(f.elegida)}` : ' · la dejaste pasar'}`
                  : esc(f.back || '')}</span>
                ${f.respuesta != null && f.back ? `<span class="op-listitem__sub op-copyable">${esc(f.back)}</span>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`
    : '<span class="op-meta">Sin falladas: ese día no se te escapó ninguna.</span>'}`;

  const comentario = body.querySelector('#ex-comentario');
  comentario.value = r.comentario || '';
  const falladas = body.querySelector('#ex-falladas');
  if (falladas) scrollFade(falladas);

  const res = await Modal.show({
    title: r.nombre ? `Examen de ${r.nombre}` : 'Examen de todo',
    sub: `${r.id} · un archivo JSON en tu carpeta de datos, como todo acá.`,
    body,
    width: 560,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: true, variant: 'primary' },
    ],
  });
  if (!res) return;

  const texto = comentario.value.trim();
  if (texto === (r.comentario || '')) return;
  await attempt(() => saveExamen({ ...r, comentario: texto }));
  Router.refresh();
}

async function eliminarExamen(id) {
  const r = S.examenes.find((x) => x.id === id);
  const ok = await Modal.confirm({
    title: '¿Eliminar este examen del historial?',
    sub: r
      ? `${r.nombre || 'Todos los mazos'} · ${puntaje(r.correctas, r.total)}% · ${relTime(r.fecha)}. Esto no se puede deshacer.`
      : undefined,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  await attempt(() => removeExamen(id));
  Toast.show({ title: 'Examen eliminado', text: 'El historial es tuyo: cuenta lo que vos digas.', icon: 'trash' });
  Router.refresh();
}

/* ══ Vista: Estadísticas ═════════════════════════════════════════════════════
   Los números del estudio, dibujados con las piezas de la casa: barras HTML
   con tooltips del sistema, una sola serie por gráfico (nada que exija
   leyendas de colores), y el acento reservado para UNA cosa — el presente:
   la barra de hoy, la última nota. Los datos salen de stats.js, puro. */

function viewStats() {
  const dist = distribucion(S.fichas);
  const act = actividadPorDia(S.actividad, { dias: 30 });
  const rachaViva = racha(S.actividad);
  const carga = cargaProxima(S.fichas, { dias: 14 });
  const notas = notasExamenes(S.examenes);
  const olvidadas = masOlvidadas(S.fichas, { top: 5 });

  const hoyClave = claveDia(Date.now());
  const alDiaPct = S.fichas.length ? Math.round((dist.alDia / S.fichas.length) * 100) : 0;
  const totalAct = act.reduce((n, d) => n + d.repasos, 0);
  const fCorta = (ts) => new Date(ts).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

  /* Un gráfico de barras es una fila de columnas: la columna entera es el
     blanco del mouse (más grande que la marca, como pide la usabilidad) y
     la barra crece adentro. Los días en cero muestran su punto base — un
     gráfico que esconde los días vacíos convierte una semana floja en una
     racha apretada. */
  const barras = (serie, valorDe, tipDe, { max, resaltar = () => false }) => `
    <div class="mn-graf__barras">
      ${serie.map((d, i) => `
        <div class="mn-graf__col" data-tip="${esc(tipDe(d))}">
          <div class="mn-graf__barra${resaltar(d) ? ' is-hoy' : ''}${valorDe(d) ? '' : ' is-cero'}"
               style="--h:${Math.max(2, Math.round((valorDe(d) / max) * 100))}%;--i:${i}"></div>
        </div>`).join('')}
    </div>`;

  const maxAct = Math.max(1, ...act.map((d) => d.repasos));
  const maxCarga = Math.max(1, ...carga.map((d) => d.vencen));

  const segmentos = [
    ['nuevas', 'idle', dist.nuevas, 'nuevas'],
    ['aprendiendo', 'waiting', dist.aprendiendo, 'aprendiendo'],
    ['vencidas', 'queued', dist.vencidas, 'vencidas'],
    ['aldia', 'done', dist.alDia, 'al día'],
  ];

  const puntosLinea = notas.map((p, i) => ({
    ...p,
    x: notas.length === 1 ? 50 : (i / (notas.length - 1)) * 100,
  }));

  paint(head({
    title: 'Estadísticas',
    sub: 'Lo que los repasos van dejando: el diario, la deuda que viene y las notas',
  }) + `
    <div class="op-scroll op-grow">
      <div class="op-row" style="gap:40px;margin-bottom:28px;flex-wrap:wrap">
        <div class="op-stat"><span class="op-stat__value op-num" id="st-fichas">0</span><span class="op-stat__label">Fichas</span></div>
        <div class="op-stat"><span class="op-stat__value op-num" id="st-aldia">0</span><span class="op-stat__label">Al día</span></div>
        <div class="op-stat"><span class="op-stat__value op-num" id="st-racha">0</span><span class="op-stat__label">Racha</span></div>
        ${notas.length ? `<div class="op-stat"><span class="op-stat__value op-num" id="st-prom">0</span><span class="op-stat__label">Promedio de exámenes</span></div>` : ''}
      </div>

      <div class="op-section">
        <div class="op-section__head"><span class="op-section__title">Actividad</span>
          <span class="op-meta">últimos 30 días · ${plural(totalAct, 'repaso')}</span></div>
        <div class="op-card"><div class="op-card__body">
          ${totalAct ? '' : `<p class="op-meta" style="margin:0 0 12px">El diario arranca hoy: cada repaso que hagas
            de ahora en más queda anotado acá, día por día.</p>`}
          <div class="mn-graf">
            ${barras(act, (d) => d.repasos,
    (d) => `${fCorta(d.ts)} · ${plural(d.repasos, 'repaso')}${d.otraVez ? ` · ${d.otraVez} otra vez` : ''}`,
    { max: maxAct, resaltar: (d) => d.dia === hoyClave })}
            <div class="mn-graf__eje"><span>hace 30 días</span><span>hoy</span></div>
          </div>
        </div></div>
      </div>

      <div class="op-section">
        <div class="op-section__head"><span class="op-section__title">Lo que viene</span>
          <span class="op-meta">vencimientos de los próximos 14 días, sin contar nuevas</span></div>
        <div class="op-card"><div class="op-card__body">
          <div class="mn-graf">
            ${barras(carga, (d) => d.vencen,
    (d) => `${fCorta(d.ts)} · ${d.vencen ? `vencen ${d.vencen}` : 'no vence nada'}`,
    { max: maxCarga, resaltar: (d) => d.dia === hoyClave })}
            <div class="mn-graf__eje"><span>hoy</span><span>en dos semanas</span></div>
          </div>
          ${carga[0].vencen ? `<p class="op-meta" style="margin:12px 0 0">La barra de hoy incluye todo lo ya vencido: la deuda no vive en el pasado — te espera hoy.</p>` : ''}
        </div></div>
      </div>

      <div class="op-section">
        <div class="op-section__head"><span class="op-section__title">El estado de las fichas</span></div>
        <div class="op-card"><div class="op-card__body">
          ${S.fichas.length ? `
            <div class="mn-dist__barra">
              ${segmentos.filter(([, , n]) => n > 0).map(([k, , n, palabra]) => `
                <div class="mn-dist__seg mn-dist__seg--${k}" style="flex-grow:${n}" data-tip="${n} ${palabra}"></div>`).join('')}
            </div>
            <div class="mn-dist__leyenda">
              ${segmentos.map(([, st, n, palabra]) => status(st, { label: `${n} ${palabra}` })).join('')}
            </div>`
    : '<p class="op-meta" style="margin:0">Sin fichas todavía: el estado aparece cuando cargues las primeras.</p>'}
        </div></div>
      </div>

      <div class="op-section">
        <div class="op-section__head"><span class="op-section__title">Exámenes</span>
          ${notas.length ? `<span class="op-meta">${plural(notas.length, 'examen', 'exámenes')} · el último ${notas[notas.length - 1].nota}%</span>` : ''}</div>
        <div class="op-card"><div class="op-card__body">
          ${notas.length >= 2 ? `
            <div class="mn-linea">
              <span class="mn-linea__guia mn-linea__guia--alto"><i>100</i></span>
              <span class="mn-linea__guia mn-linea__guia--bajo"><i>0</i></span>
              <svg class="mn-linea__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${puntosLinea.map((p) => `${p.x.toFixed(2)},${(100 - p.nota).toFixed(2)}`).join(' ')}"
                          fill="none" vector-effect="non-scaling-stroke"/>
              </svg>
              ${puntosLinea.map((p, i) => `
                <span class="mn-linea__punto${i === puntosLinea.length - 1 ? ' is-ultimo' : ''}"
                      style="left:${p.x.toFixed(2)}%;bottom:${p.nota}%"
                      data-tip="${esc(`${p.nombre ? `${p.nombre} · ` : ''}${fCorta(p.fecha)} · ${p.nota}%`)}"></span>`).join('')}
            </div>
            <div class="mn-graf__eje"><span>el primero</span><span>el último</span></div>`
    : `<p class="op-meta" style="margin:0">${notas.length === 1
      ? `Un examen rendido (${notas[0].nota}%). Con el segundo, acá aparece la línea del progreso.`
      : 'Todavía no rendiste exámenes: la línea del progreso se dibuja con sus notas.'}</p>`}
        </div></div>
      </div>

      ${olvidadas.length ? `
        <div class="op-section">
          <div class="op-section__head"><span class="op-section__title">Las más olvidadas</span>
            <span class="op-meta">tus enemigas conocidas — tocá una para editarla</span></div>
          <div class="op-list">${olvidadas.map(rowFicha).join('')}</div>
        </div>` : ''}
      <div style="height:32px"></div>
    </div>`);

  countTo(document.getElementById('st-fichas'), S.fichas.length);
  countTo(document.getElementById('st-aldia'), alDiaPct, { format: (n) => `${n}%` });
  countTo(document.getElementById('st-racha'), rachaViva, { format: (n) => `${n} d` });
  const prom = document.getElementById('st-prom');
  if (prom) {
    const media = Math.round(notas.reduce((s, p) => s + p.nota, 0) / notas.length);
    countTo(prom, media, { format: (n) => `${n}%` });
  }
}

/* ══ Vista: Piezas ═══════════════════════════════════════════════════════════ */

function viewPiezas() {
  paint(head({
    title: 'Piezas',
    sub: 'Todos los primitivos del sistema, vivos',
    actions: '<button class="op-btn op-btn--ghost op-flashable" id="replay"><i data-icon="retry"></i> Repetir entradas</button>',
  }) + designHTML());

  wireDesign(viewEl());
  document.getElementById('replay')?.addEventListener('click', () => {
    const body = document.getElementById('design-body');
    body.style.animation = 'none';
    void body.offsetWidth;
    body.style.animation = 'op-rise-in 420ms var(--op-ease) both';
  });
}

/* ══ Vista: Ajustes ══════════════════════════════════════════════════════════ */

function viewAjustes() {
  paint(head({ title: 'Ajustes', sub: 'Se guardan en settings.json, con escritura atómica' }) + `
    <div class="op-scroll op-grow">
      <div style="max-width:620px">

        <div class="op-section">
          <div class="op-section__head"><span class="op-section__title">Repaso</span></div>
          <div class="op-card"><div class="op-card__body">
            <div class="op-field" style="max-width:220px">
              <label class="op-field__label">Fichas nuevas por día</label>
              <div class="op-stepper" id="set-nuevas">
                <input class="op-input op-num" type="number" min="0" max="100" step="1" value="${esc(S.settings.nuevasPorDia ?? 10)}">
                <div class="op-stepper__btns">
                  <button class="op-stepper__btn" data-step="up" tabindex="-1"><i data-icon="chevronUp"></i></button>
                  <button class="op-stepper__btn" data-step="down" tabindex="-1"><i data-icon="chevronDown"></i></button>
                </div>
              </div>
              <span class="op-field__hint">Las vencidas entran siempre: el cupo solo frena el material nuevo.</span>
            </div>

            <div class="op-field" style="max-width:400px;margin-top:22px">
              <label class="op-field__label">Orden de la cola</label>
              <div class="op-segmented" id="set-orden" style="max-width:260px">
                <button class="op-segmented__opt${S.settings.azar ? '' : ' is-active'}" data-value="prioridad">Por prioridad</button>
                <button class="op-segmented__opt${S.settings.azar ? ' is-active' : ''}" data-value="azar">Al azar</button>
              </div>
              <span class="op-field__hint">Por prioridad sale primero lo más atrasado: si cortás la sesión a la mitad,
                igual pagaste la deuda más urgente. Al azar mezcla todo y te saca el vicio de recordar una respuesta
                porque venía después de otra. En el repaso se cambia con la tecla A.</span>
            </div>
          </div></div>
        </div>

        <div class="op-section">
          <div class="op-section__head"><span class="op-section__title">Datos</span></div>
          <div class="op-card"><div class="op-card__body">
            <div class="op-kv">
              <span class="op-kv__k">Carpeta</span>
              <span class="op-kv__v op-mono op-copyable" data-copy="${esc(S.info?.dataDir || '')}">${esc(S.info?.dataDir || '—')}</span>
              <span class="op-kv__k">Mazos</span><span class="op-kv__v op-num">${S.mazos.length}</span>
              <span class="op-kv__k">Fichas</span><span class="op-kv__v op-num">${S.fichas.length}</span>
              <span class="op-kv__k">Esquema</span><span class="op-kv__v op-mono">v${esc(S.settings.schema ?? 1)}</span>
            </div>
            <p class="op-meta" style="margin-top:14px;line-height:1.65">
              Cada ficha es un archivo JSON con su historial de repaso adentro. Se pueden abrir
              con un editor, versionar en git y llevar a otra máquina copiando la carpeta.
            </p>
          </div></div>
        </div>

        <div class="op-section">
          <div class="op-section__head"><span class="op-section__title">Acerca de</span></div>
          <div class="op-card"><div class="op-card__body">
            <div class="op-kv">
              <span class="op-kv__k">App</span><span class="op-kv__v">${esc(S.info?.name || '—')} ${esc(S.info?.version || '')}</span>
              <span class="op-kv__k">Motor</span><span class="op-kv__v">SM-2 (SuperMemo)</span>
              <span class="op-kv__k">Electron</span><span class="op-kv__v op-mono">${esc(S.info?.electron || '—')}</span>
            </div>
            <div class="mn-update">
              <div class="mn-update__texto">
                <span class="mn-update__titulo">Actualizaciones</span>
                <span class="op-meta mn-update__estado" id="upd-estado"></span>
              </div>
              <button class="op-btn op-btn--secondary op-flashable" id="upd-btn"></button>
            </div>
          </div></div>
        </div>

      </div>
      <div style="height:32px"></div>
    </div>`);

  bindStepper(document.getElementById('set-nuevas'), (value) => persist({ nuevasPorDia: value }));
  bindSwitcher(document.getElementById('set-orden'), (v) => setAzar(v === 'azar'));
  document.getElementById('upd-btn').addEventListener('click', () => {
    if (upd?.estado === 'listo') api.update.install();
    else buscarUpdate();
  });
  pintarUpdate({ animar: false });
}

async function persist(patch) {
  const saved = await attempt(() => api.settings.save(patch), { errorTitle: 'No se pudieron guardar los ajustes' });
  if (!saved) return;
  S.settings = saved;
  S.lastSaved = Date.now();
  updateChrome();
}

/* ══ Modales ═════════════════════════════════════════════════════════════════ */

async function nuevoMazoModal() {
  const body = document.createElement('div');
  body.className = 'op-field';
  body.innerHTML = '<label class="op-field__label">Nombre</label><input class="op-input" placeholder="Farmacología I" spellcheck="false">';
  const input = body.querySelector('input');

  const ok = await Modal.show({
    title: 'Nuevo mazo',
    sub: 'Un mazo por tema: los cupos y las colas se arman por mazo o para todo junto.',
    body,
    width: 420,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Crear', value: true, variant: 'primary', autofocus: true },
    ],
  });
  if (!ok) return null;
  const name = input.value.trim();
  if (!name) return null;

  return attempt(async () => {
    const id = await mazosCol.nextId('m');
    const saved = await saveMazo({ id, name, createdAt: Date.now() });
    Toast.show({ title: 'Mazo creado', text: `${saved.name} · ${saved.id}`, icon: 'check' });
    Router.go('mazo', saved.id);
    return saved;
  }, { errorTitle: 'No se pudo crear el mazo' });
}

async function renombrarMazo(id) {
  const m = mazo(id);
  if (!m) return;
  const body = document.createElement('div');
  body.className = 'op-field';
  body.innerHTML = '<label class="op-field__label">Nombre</label><input class="op-input" spellcheck="false">';
  const input = body.querySelector('input');
  input.value = m.name;

  const ok = await Modal.show({
    title: 'Renombrar',
    body,
    width: 420,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: true, variant: 'primary' }],
  });
  if (!ok) return;
  const name = input.value.trim();
  if (!name || name === m.name) return;
  await attempt(() => saveMazo({ ...m, name }));
  Router.refresh();
}

async function eliminarMazo(id) {
  const m = mazo(id);
  const n = fichasDe(id).length;
  const ok = await Modal.confirm({
    title: `¿Eliminar “${m?.name || id}”?`,
    sub: n
      ? `Se borran también sus ${plural(n, 'ficha')} con todo su historial de repaso. Esto no se puede deshacer.`
      : 'El mazo está vacío. Esto no se puede deshacer.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  await attempt(() => removeMazo(id));
  Toast.show({ title: 'Mazo eliminado', text: m?.name || id, icon: 'trash' });
  Router.current.name === 'mazo' && Router.current.param === id ? Router.go('mazos') : Router.refresh();
}

async function nuevaCarpetaModal() {
  const body = document.createElement('div');
  body.className = 'op-field';
  body.innerHTML = '<label class="op-field__label">Nombre</label><input class="op-input" placeholder="Anatomía" spellcheck="false">';
  const input = body.querySelector('input');

  const ok = await Modal.show({
    title: 'Nueva carpeta',
    sub: 'Una carpeta agrupa mazos de un tema. Un solo nivel: alcanza para ordenar y no alcanza para esconder.',
    body,
    width: 420,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Crear', value: true, variant: 'primary', autofocus: true },
    ],
  });
  if (!ok) return null;
  const name = input.value.trim();
  if (!name) return null;

  return attempt(async () => {
    const id = await carpetasCol.nextId('c');
    const saved = await saveCarpeta({ id, name, createdAt: Date.now() });
    Toast.show({ title: 'Carpeta creada', text: `${saved.name} · movés mazos desde su menú.`, icon: 'folder' });
    Router.refresh();
    return saved;
  }, { errorTitle: 'No se pudo crear la carpeta' });
}

async function renombrarCarpeta(id) {
  const c = carpeta(id);
  if (!c) return;
  const body = document.createElement('div');
  body.className = 'op-field';
  body.innerHTML = '<label class="op-field__label">Nombre</label><input class="op-input" spellcheck="false">';
  const input = body.querySelector('input');
  input.value = c.name;

  const ok = await Modal.show({
    title: 'Renombrar la carpeta',
    body,
    width: 420,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: true, variant: 'primary' }],
  });
  if (!ok) return;
  const name = input.value.trim();
  if (!name || name === c.name) return;
  await attempt(() => saveCarpeta({ ...c, name }));
  Router.refresh();
}

async function eliminarCarpeta(id) {
  const c = carpeta(id);
  const n = mazosEnCarpeta(id).length;
  const ok = await Modal.confirm({
    title: `¿Eliminar la carpeta “${c?.name || id}”?`,
    sub: n
      ? `${plural(n, 'mazo')} quedan sueltos, con todas sus fichas: la carpeta es organización, no contenido.`
      : 'Está vacía; no se pierde nada.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  await attempt(() => removeCarpeta(id));
  Toast.show({ title: 'Carpeta eliminada', text: n ? `Sus ${plural(n, 'mazo')} siguen en la lista, sueltos.` : c?.name || id, icon: 'trash' });
  Router.refresh();
}

/** Mover un mazo: elegís el destino de una lista y confirmás — el mismo
    patrón del resto de los modales, sin menús anidados. */
/**
 * Mover uno o varios mazos a una carpeta. Con varios, la carpeta de partida
 * puede no ser la misma para todos: entonces no se marca ninguna, y elegir
 * una mueve solo a los que no estaban ya ahí.
 */
async function moverMazosModal(ids) {
  const mazos = ids.map(mazo).filter(Boolean);
  if (!mazos.length) return;
  const nombre = mazos.length === 1 ? mazos[0].name : `${mazos.length} mazos`;

  const mover = async (destino) => {
    const aMover = mazos.filter((m) => (m.carpeta || null) !== (destino || null));
    if (!aMover.length) return;
    for (const m of aMover) {
      if (await attempt(() => asignarCarpeta(m.id, destino)) === null) break;
    }
    Toast.show({
      title: aMover.length === 1 ? 'Mazo movido' : `${aMover.length} mazos movidos`,
      text: aMover.length === 1
        ? `${aMover[0].name} → ${destino ? carpeta(destino)?.name : 'sin carpeta'}`
        : (destino ? `Ahora están en ${carpeta(destino)?.name}` : 'Ahora están sin carpeta'),
      icon: 'folder',
    });
    limpiarSeleccion();
    Router.refresh();
  };

  if (!S.carpetas.length) {
    const creada = await nuevaCarpetaModal();
    if (creada) await mover(creada.id);
    return;
  }

  const partidas = new Set(mazos.map((m) => m.carpeta || null));
  const actual = partidas.size === 1 ? [...partidas][0] : undefined;
  let elegida = actual;
  const opciones = [
    ...[...S.carpetas].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .map((c) => ({ id: c.id, label: c.name, icon: 'folder' })),
    { id: null, label: 'Sin carpeta', icon: 'inbox' },
  ];

  const body = document.createElement('div');
  body.className = 'op-list';
  body.innerHTML = opciones.map((o) => `
    <div class="op-listitem${(o.id || null) === actual ? ' is-selected' : ''}" role="button" tabindex="0" data-destino="${esc(o.id || '')}">
      <i data-icon="${o.icon}"></i>
      <div class="op-listitem__main"><span class="op-listitem__title">${esc(o.label)}</span></div>
      <span class="mn-mover__marca">${(o.id || null) === actual ? Icons.svg('check', 'op-icon--sm') : ''}</span>
    </div>`).join('');
  Icons.mount(body);

  body.addEventListener('click', (e) => {
    const fila = e.target.closest('[data-destino]');
    if (!fila) return;
    elegida = fila.dataset.destino || null;
    body.querySelectorAll('[data-destino]').forEach((el) => {
      const es = el === fila;
      el.classList.toggle('is-selected', es);
      el.querySelector('.mn-mover__marca').innerHTML = es ? Icons.svg('check', 'op-icon--sm') : '';
    });
  });

  const ok = await Modal.show({
    title: mazos.length === 1 ? `Mover “${nombre}”` : `Mover ${nombre}`,
    sub: 'La carpeta organiza; los mazos y su historial no se tocan.',
    body,
    width: 420,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Mover', value: true, variant: 'primary', autofocus: true },
    ],
  });
  if (!ok || elegida === undefined || elegida === actual) return;
  await mover(elegida);
}

/**
 * Alta y edición comparten el modal. En el alta, «Guardar y otra» deja el
 * diálogo listo para la siguiente: cargar un mazo entero no debería costar
 * un viaje por el mouse por ficha.
 */
async function fichaModal(mazoId, fichaId = null) {
  const original = fichaId ? S.fichas.find((f) => f.id === fichaId) : null;

  /* El borrador vive AFUERA del while: cargando un mazo de opción múltiple de
     a diez fichas, «Guardar y otra» tiene que dejarte en opción múltiple. Se
     vacía el contenido entre fichas, nunca la forma. */
  const borrador = {
    tipo: tipoDe(original),
    front: original?.front || '',
    back: original?.back || '',
    opciones: tipoDe(original) === 'opcion' ? opcionesDe(original) : ['', '', '', ''],
    correcta: Math.max(0, indiceCorrecto(original)),
  };

  while (true) {
    const body = document.createElement('div');
    body.className = 'op-col';
    body.style.gap = '16px';
    body.innerHTML = `
      <div class="op-field">
        <label class="op-field__label">Tipo</label>
        <div class="op-segmented" id="f-tipo">
          ${TIPOS.map((t) => `
            <button class="op-segmented__opt${t === borrador.tipo ? ' is-active' : ''}" data-value="${t}">
              ${esc(ETIQUETA_TIPO[t])}
            </button>`).join('')}
        </div>
      </div>
      <div class="op-field">
        <label class="op-field__label" id="f-front-label"></label>
        <textarea class="op-textarea" id="f-front" rows="2"></textarea>
      </div>
      <div id="f-dinamico"></div>
      <div class="op-field">
        <label class="op-field__label" id="f-back-label"></label>
        <textarea class="op-textarea" id="f-back" rows="3"></textarea>
      </div>`;

    const $ = (sel) => body.querySelector(sel);
    const front = $('#f-front');
    const back = $('#f-back');
    front.value = borrador.front;
    back.value = borrador.back;

    /** Vuelca lo tipeado al borrador. Se llama antes de repintar y antes de
        guardar: sin esto, cambiar de tipo se come lo que venías escribiendo. */
    const leer = () => {
      borrador.front = front.value;
      borrador.back = back.value;
      const alts = [...body.querySelectorAll('[data-alt]')];
      if (alts.length) borrador.opciones = alts.map((i) => i.value);
    };

    /* Lo que cambia con el tipo: los textos de los dos campos fijos y el
       bloque del medio. Se repinta entero en vez de mostrar y esconder tres
       formularios — el DOM que no existe no se puede desincronizar. */
    const pintarTipo = () => {
      const t = borrador.tipo;
      $('#f-front-label').textContent = t === 'vf' ? 'La afirmación' : 'Frente — la pregunta';
      $('#f-back-label').textContent = t === 'basica' ? 'Dorso — la respuesta' : 'Dorso — la explicación';
      front.placeholder = t === 'vf'
        ? 'El nervio vago llega hasta el colon descendente.'
        : '¿Qué enzima inhibe la aspirina?';
      back.placeholder = t === 'basica'
        ? 'La ciclooxigenasa (COX), de forma irreversible.'
        : 'Por qué: el vago llega solo hasta el ángulo esplénico (punto de Cannon-Böhm).';

      const din = $('#f-dinamico');
      if (t === 'basica') { din.innerHTML = ''; return; }

      if (t === 'vf') {
        din.innerHTML = `
          <div class="op-field">
            <label class="op-field__label">La afirmación es…</label>
            <div class="op-segmented" id="f-vf">
              ${OPCIONES_VF.map((o, i) => `
                <button class="op-segmented__opt${i === borrador.correcta ? ' is-active' : ''}" data-value="${i}">${o}</button>`).join('')}
            </div>
          </div>`;
        bindSwitcher($('#f-vf'), (v) => { borrador.correcta = Number(v); });
        return;
      }

      din.innerHTML = `
        <div class="op-field">
          <label class="op-field__label">Alternativas — marcá la correcta</label>
          <div class="op-col" style="gap:6px" id="f-alts">
            ${borrador.opciones.map((o, i) => `
              <div class="op-row" style="gap:8px">
                <button class="op-check${i === borrador.correcta ? ' is-on' : ''}" data-correcta="${i}"
                        data-tip="Esta es la correcta"><i data-icon="check"></i></button>
                <input class="op-input op-grow" data-alt="${i}" spellcheck="false"
                       placeholder="Alternativa ${letra(i)}" value="${esc(o)}">
                <button class="op-iconbtn op-iconbtn--sm" data-quitar="${i}" data-tip="Quitar"
                        ${borrador.opciones.length <= MIN_OPCIONES ? 'disabled' : ''}><i data-icon="close"></i></button>
              </div>`).join('')}
          </div>
          <div class="op-row" style="margin-top:8px">
            <button class="op-btn op-btn--ghost op-btn--sm op-flashable" id="f-add"
                    ${borrador.opciones.length >= MAX_OPCIONES ? 'disabled' : ''}><i data-icon="plus"></i> Agregar alternativa</button>
          </div>
          <span class="op-field__hint" style="margin-top:8px">Hasta ${MAX_OPCIONES}. En el repaso se rotulan A, B, C… y se eligen con las teclas 1 a ${MAX_OPCIONES}.</span>
        </div>`;

      Icons.mount(din);

      $('#f-alts').addEventListener('click', (e) => {
        const marcar = e.target.closest('[data-correcta]');
        if (marcar) {
          // Es un radio con cara de check: la correcta es una sola.
          borrador.correcta = Number(marcar.dataset.correcta);
          $('#f-alts').querySelectorAll('[data-correcta]').forEach((c, i) => c.classList.toggle('is-on', i === borrador.correcta));
          return;
        }
        const quitar = e.target.closest('[data-quitar]');
        if (quitar && !quitar.disabled) {
          leer();
          const i = Number(quitar.dataset.quitar);
          borrador.opciones.splice(i, 1);
          // El índice de la correcta se corre con lo que quedó arriba de ella;
          // si la borrada ERA la correcta, la marca pasa a la primera.
          if (borrador.correcta === i) borrador.correcta = 0;
          else if (borrador.correcta > i) borrador.correcta -= 1;
          pintarTipo();
        }
      });

      $('#f-add').addEventListener('click', () => {
        if (borrador.opciones.length >= MAX_OPCIONES) return;
        leer();
        borrador.opciones.push('');
        pintarTipo();
        // El campo recién creado se enfoca: agregar una alternativa es querer
        // escribirla, no mirarla.
        din.querySelector(`[data-alt="${borrador.opciones.length - 1}"]`)?.focus();
      });
    };

    bindSwitcher($('#f-tipo'), (v) => { leer(); borrador.tipo = v; pintarTipo(); });
    pintarTipo();

    const res = await Modal.show({
      title: original ? 'Editar ficha' : 'Nueva ficha',
      sub: original ? `${original.id} · el historial de repaso se conserva.` : undefined,
      body,
      width: 560,
      actions: [
        { label: 'Cancelar', value: null },
        ...(original ? [] : [{ label: 'Guardar y otra', value: 'otra' }]),
        { label: 'Guardar', value: true, variant: 'primary', autofocus: !original },
      ],
    });
    if (!res) return;

    leer();
    const propuesta = normalizarFicha({
      ...(original || {}),
      tipo: borrador.tipo,
      front: borrador.front,
      back: borrador.back,
      opciones: borrador.opciones,
      correcta: borrador.correcta,
    });

    const problema = validarFicha(propuesta);
    if (problema) {
      Toast.error('Ficha incompleta', problema);
      // Se vuelve a abrir con TODO lo que había: el borrador vive afuera del
      // while justamente para esto. Cerrar el modal ante un error te hace
      // perder cuatro alternativas escritas por una que quedó vacía.
      continue;
    }

    await attempt(async () => {
      if (original) {
        await saveFicha(propuesta);
      } else {
        const id = await fichasCol.nextId('f');
        await saveFicha({ ...propuesta, id, mazo: mazoId, srs: srsNueva(), createdAt: Date.now() });
      }
      Router.refresh();
    }, { errorTitle: 'No se pudo guardar la ficha' });

    if (res !== 'otra') return;
    // Se vacía el contenido y se conserva la forma: el tipo y la cantidad de
    // alternativas siguen ahí para la que viene.
    borrador.front = '';
    borrador.back = '';
    borrador.opciones = borrador.opciones.map(() => '');
    borrador.correcta = 0;
    Toast.show({ title: 'Guardada', text: 'Lista la siguiente.', icon: 'check', duration: 1600 });
  }
}

async function eliminarFicha(id) {
  const f = S.fichas.find((x) => x.id === id);
  const ok = await Modal.confirm({
    title: '¿Eliminar la ficha?',
    sub: f ? `«${f.front.slice(0, 80)}» y su historial de repaso. Esto no se puede deshacer.` : undefined,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  await attempt(() => removeFicha(id));
  Toast.show({ title: 'Ficha eliminada', icon: 'trash' });
  Router.refresh();
}

/* ══ Router ══════════════════════════════════════════════════════════════════ */

Router.define({
  inicio: { view: viewInicio },
  mazos: { view: viewMazos },
  mazo: { view: viewMazo, nav: 'mazos' },
  repaso: { view: viewRepaso, nav: 'inicio' },
  examen: { view: viewExamen, nav: 'inicio' },
  examenes: { view: viewExamenes },
  stats: { view: viewStats },
  piezas: { view: viewPiezas },
  ajustes: { view: viewAjustes },
}, document.getElementById('view'));

/* ══ Menús de contexto ═══════════════════════════════════════════════════════ */

/* ══ Importar y exportar ═════════════════════════════════════════════════════
   Un mazo que se puede mandar por chat. El formato vive en intercambio.js;
   acá está el ir y venir con el disco y lo que se le pregunta al usuario. */

async function exportarMazos(mazos) {
  if (!mazos.length) {
    Toast.error('No hay nada para exportar', 'Creá un mazo primero.');
    return;
  }
  await attempt(async () => {
    const paquete = empaquetar(mazos, S.fichas, { app: S.info?.version || null });
    const ruta = await api.archivo.guardarJSON(nombreArchivo(mazos), paquete);
    if (!ruta) return;                                  // canceló el diálogo
    const fichas = paquete.mazos.reduce((n, m) => n + m.fichas.length, 0);
    Toast.show({
      title: 'Mazo exportado',
      text: `${plural(fichas, 'ficha')} en un archivo que podés mandar por donde quieras.`,
      icon: 'upload',
      duration: 5200,
    });
  }, { errorTitle: 'No se pudo exportar' });
}

/**
 * Guarda un paquete ya validado. Los ids los asigna ESTE lado siempre: los
 * del origen no significan nada acá, y respetarlos haría que importar dos
 * veces el mismo archivo se pisara a sí mismo.
 *
 * Escribe con las colecciones directo y recarga UNA vez al final. Pasar por
 * saveFicha() repintaría el chrome por cada ficha: con un mazo de cien, son
 * cien renders para mostrar un número que solo importa al terminar.
 */
async function importarPaquete(data, conProgreso) {
  const entrantes = desempaquetar(data, { conProgreso });

  let nMazo = Number((await mazosCol.nextId('m')).slice(2));
  let nFicha = Number((await fichasCol.nextId('f')).slice(2));
  const ahora = Date.now();
  let total = 0;

  for (const entrante of entrantes) {
    const mazoId = `m-${String(nMazo++).padStart(4, '0')}`;
    await mazosCol.save({ id: mazoId, name: entrante.name, createdAt: ahora, updatedAt: ahora });
    for (const [i, ficha] of entrante.fichas.entries()) {
      const id = `f-${String(nFicha++).padStart(4, '0')}`;
      await fichasCol.save({
        ...ficha,
        id,
        mazo: mazoId,
        createdAt: ahora + i,          // conserva el orden del archivo en la cola
        updatedAt: ahora - i,          // y en la lista del mazo
      });
      total++;
    }
  }

  await loadAll();
  updateChrome();
  Router.refresh();
  return { mazos: entrantes.length, fichas: total };
}

async function importarModal() {
  const abierto = await attempt(() => api.archivo.abrirJSON(), { errorTitle: 'No se pudo abrir el archivo' });
  if (!abierto) return;                                 // canceló, o falló y ya se avisó

  const problema = validarPaquete(abierto.data);
  if (problema) {
    Toast.error('Ese archivo no se puede importar', problema);
    return;
  }

  const r = resumenPaquete(abierto.data);
  const tipos = Object.entries(r.porTipo)
    .map(([t, n]) => `${n} ${ETIQUETA_TIPO[t].toLowerCase()}`)
    .join(' · ');

  const body = document.createElement('div');
  body.className = 'op-col';
  body.style.gap = '14px';
  body.innerHTML = `
    <div class="op-list">
      ${r.nombres.map((n) => `
        <div class="op-listitem">
          ${Icons.svg('layers', 'op-icon--sm')}
          <div class="op-listitem__main"><span class="op-listitem__title">${esc(n)}</span></div>
        </div>`).join('')}
    </div>
    <div class="op-kv">
      <span class="op-kv__k">Fichas</span><span class="op-kv__v">${r.fichas}</span>
      <span class="op-kv__k">Tipos</span><span class="op-kv__v">${esc(tipos)}</span>
    </div>
    ${r.conProgreso ? `
      <label class="op-row" style="gap:10px;align-items:flex-start">
        <button class="op-check" id="i-progreso"><i data-icon="check"></i></button>
        <span>
          <span class="op-label">Conservar el historial de repaso</span>
          <span class="op-field__hint" style="display:block">
            Dejalo apagado si el mazo te lo pasó otra persona: su historial dice lo que
            recuerda ELLA. Prendelo solo si estás moviendo tus propios mazos.
          </span>
        </span>
      </label>` : ''}`;

  Icons.mount(body);
  const check = body.querySelector('#i-progreso');
  check?.addEventListener('click', () => check.classList.toggle('is-on'));

  const res = await Modal.show({
    title: r.mazos === 1 ? 'Importar este mazo' : `Importar ${r.mazos} mazos`,
    sub: abierto.path.split(/[\\/]/).pop(),
    body,
    width: 520,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Importar', value: true, variant: 'primary', autofocus: true },
    ],
  });
  if (!res) return;

  const conProgreso = !!check?.classList.contains('is-on');
  const hecho = await attempt(() => importarPaquete(abierto.data, conProgreso),
    { errorTitle: 'No se pudo importar' });
  if (!hecho) return;

  Toast.show({
    title: 'Importado',
    text: `${plural(hecho.fichas, 'ficha')} en ${plural(hecho.mazos, 'mazo')}${conProgreso ? ', con su historial' : ', listas para repasar desde cero'}.`,
    icon: 'download',
    duration: 5200,
  });
}

const MENUS = {
  mazo: (id) => [
    { label: 'Abrir', icon: 'external', onSelect: () => Router.go('mazo', id) },
    { label: 'Repasar', icon: 'zap', onSelect: () => iniciarSesion(id) },
    { label: 'Tomar examen…', icon: 'examen', onSelect: () => iniciarExamen(id) },
    { label: 'Mover a carpeta…', icon: 'folder', onSelect: () => moverMazosModal([id]) },
    {
      label: seleccion.has(id) ? 'Quitar de la selección' : 'Seleccionar',
      icon: 'check',
      onSelect: () => elegirMazo(id),
    },
    { label: 'Renombrar…', icon: 'edit', onSelect: () => renombrarMazo(id) },
    { label: 'Exportar…', icon: 'upload', onSelect: () => exportarMazos([mazo(id)].filter(Boolean)) },
    { label: 'Copiar id', icon: 'copy', onSelect: () => copy(id) },
    { sep: true },
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => eliminarMazo(id) },
  ],
  carpeta: (id) => [
    { label: 'Repasar la carpeta', icon: 'zap', onSelect: () => repasarCarpeta(id) },
    {
      label: 'Tomar examen…', icon: 'examen',
      onSelect: () => iniciarExamen(null, { pool: fichasDeCarpeta(id), nombre: carpeta(id)?.name }),
    },
    { label: 'Exportar…', icon: 'upload', onSelect: () => exportarMazos(mazosEnCarpeta(id)) },
    { label: 'Renombrar…', icon: 'edit', onSelect: () => renombrarCarpeta(id) },
    { sep: true },
    { label: 'Eliminar (los mazos quedan)', icon: 'trash', danger: true, onSelect: () => eliminarCarpeta(id) },
  ],
  ficha: (id) => [
    { label: 'Editar…', icon: 'edit', onSelect: () => fichaModal(null, id) },
    { label: 'Copiar id', icon: 'copy', onSelect: () => copy(id) },
    { sep: true },
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => eliminarFicha(id) },
  ],
};

/* ══ Shell ═══════════════════════════════════════════════════════════════════ */

function wireShell() {
  const w = api?.win;
  document.getElementById('win-min')?.addEventListener('click', () => w?.minimize());
  document.getElementById('win-close')?.addEventListener('click', () => w?.close());
  const maxBtn = document.getElementById('win-max');
  maxBtn?.addEventListener('click', () => w?.toggleMaximize());
  w?.onMaximized((isMax) => {
    maxBtn.innerHTML = Icons.svg(isMax ? 'winRestore' : 'winMax');
    maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
  });

  document.querySelectorAll('.op-navitem').forEach((b) =>
    b.addEventListener('click', () => Router.go(b.dataset.view)));

  document.getElementById('btn-repasar')?.addEventListener('click', () => iniciarSesion(null));

  /* Delegación global: las vistas se repintan enteras, así que el cableado se
     hace UNA vez acá y sobrevive a cualquier innerHTML. */
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) Router.go(goto.dataset.goto, goto.dataset.param || null);

    const open = e.target.closest('[data-open-mazo]');
    if (open && !e.target.closest('[data-menu], [data-action]')) {
      const id = open.dataset.openMazo;
      if (e.ctrlKey || e.metaKey || e.shiftKey || seleccion.size) elegirMazo(id, { rango: e.shiftKey });
      else Router.go('mazo', id);
    }

    const cp = e.target.closest('[data-copy]');
    if (cp) copy(cp.dataset.copy);

    const trigger = e.target.closest('[data-menu]');
    if (trigger) {
      e.stopPropagation();
      const build = MENUS[trigger.dataset.menu];
      if (build) Menu.show(trigger, build(trigger.dataset.menuArg), { align: 'end' });
      return;
    }

    const act = e.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      const arg = act.dataset.arg || null;
      if (a === 'nuevo-mazo') nuevoMazoModal();
      if (a === 'nueva-carpeta') nuevaCarpetaModal();
      if (a === 'nueva-ficha') fichaModal(arg || Router.param);
      if (a === 'editar-ficha') fichaModal(null, arg);
      if (a === 'repasar') iniciarSesion(arg);
      if (a === 'repasar-carpeta') repasarCarpeta(arg);
      if (a === 'examen') iniciarExamen(arg);
      if (a === 'abandonar-examen') abandonarExamen();
      if (a === 'ver-examen') verExamen(arg);
      if (a === 'eliminar-examen') eliminarExamen(arg);
      if (a === 'importar') importarModal();
      if (a === 'mover-seleccion') moverMazosModal([...seleccion]);
      if (a === 'limpiar-seleccion') limpiarSeleccion();
      if (a === 'exportar-todo') exportarMazos(S.mazos);
      if (a === 'azar') setAzar(!S.settings.azar);
      if (a === 'terminar') terminarSesion();
      return;
    }

    /* Plegar va al final: un click en las acciones DE ADENTRO del encabezado
       (repasar, menú) ya se atendió arriba y no debe plegar de rebote. */
    const plegar = e.target.closest('[data-plegar]');
    if (plegar) togglePlegada(plegar.dataset.plegar);
  });

  // Enter y Espacio sobre una fila: la lista tiene que ser usable sin mouse.
  document.addEventListener('keydown', (e) => {
    // Escape suelta la selección, salvo que haya un overlay: ahí es de él.
    if (e.key === 'Escape' && seleccion.size && !document.querySelector('.op-modal, .op-menu')) {
      e.preventDefault();
      limpiarSeleccion();
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest?.('[data-open-mazo]');
    if (row) {
      e.preventDefault();
      // En modo selección, Espacio elige como en cualquier lista; Enter abre.
      if (e.key === ' ' && seleccion.size) elegirMazo(row.dataset.openMazo, { rango: e.shiftKey });
      else Router.go('mazo', row.dataset.openMazo);
      return;
    }
    const examen = e.target.closest?.('[data-action="ver-examen"]');
    if (examen) {
      e.preventDefault();
      verExamen(examen.dataset.arg);
      return;
    }
    const plegar = e.target.closest?.('[data-plegar]');
    if (plegar && e.target === plegar) {
      e.preventDefault();
      togglePlegada(plegar.dataset.plegar);
    }
  });

  /* ── Arrastrar mazos a carpetas ──
     El complemento veloz del modal «Mover a carpeta…»: agarrás la fila y la
     soltás sobre una carpeta — o sobre «Sin carpeta» para sacarla. Delegado
     acá, como los clicks: sobrevive a cualquier repintado. */
  // Los ids que viajan en el gesto: uno, o toda la selección si agarraste
  // una fila elegida — arrastrar lo que se ve marcado mueve lo marcado.
  let dragMazos = null;

  document.addEventListener('dragstart', (e) => {
    const fila = e.target.closest?.('[data-open-mazo]');
    if (!fila) return;
    // Sin carpetas no hay dónde soltar: mejor ni arrancar el gesto.
    if (!S.carpetas.length) { e.preventDefault(); return; }
    const id = fila.dataset.openMazo;
    dragMazos = seleccion.has(id) ? [...seleccion] : [id];
    e.dataTransfer.setData('text/plain', dragMazos.join(','));
    e.dataTransfer.effectAllowed = 'move';
    document.querySelectorAll('[data-open-mazo]').forEach((f) => {
      if (dragMazos.includes(f.dataset.openMazo)) f.classList.add('is-arrastrado');
    });
  });

  document.addEventListener('dragend', () => {
    dragMazos = null;
    document.querySelectorAll('.is-arrastrado').forEach((el) => el.classList.remove('is-arrastrado'));
    document.querySelectorAll('.mn-carpeta.is-destino').forEach((el) => el.classList.remove('is-destino'));
  });

  /** ¿Soltar acá cambia algo? Si todos ya viven en esa carpeta, no es mover. */
  const destinoDe = (e) => {
    const dest = e.target.closest?.('.mn-carpeta');
    if (!dest || !dragMazos) return null;
    const id = dest.dataset.carpeta === 'raiz' ? null : dest.dataset.carpeta;
    const cambia = dragMazos.some((m) => (mazo(m)?.carpeta || null) !== id);
    return cambia ? { dest, id } : null;
  };

  document.addEventListener('dragover', (e) => {
    const d = destinoDe(e);
    if (!d) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    d.dest.classList.add('is-destino');
  });

  document.addEventListener('dragleave', (e) => {
    const dest = e.target.closest?.('.mn-carpeta');
    if (dest && !dest.contains(e.relatedTarget)) dest.classList.remove('is-destino');
  });

  document.addEventListener('drop', async (e) => {
    const d = destinoDe(e);
    if (!d) return;
    e.preventDefault();
    const ids = dragMazos;
    dragMazos = null;
    d.dest.classList.remove('is-destino');

    const aMover = ids.map(mazo).filter((m) => m && (m.carpeta || null) !== d.id);
    for (const m of aMover) {
      if (await attempt(() => asignarCarpeta(m.id, d.id)) === null) break;
    }
    Toast.show({
      title: aMover.length === 1 ? 'Mazo movido' : `${aMover.length} mazos movidos`,
      text: aMover.length === 1
        ? `${aMover[0].name} → ${d.id ? carpeta(d.id)?.name : 'sin carpeta'}`
        : (d.id ? `Ahora están en ${carpeta(d.id)?.name}` : 'Ahora están sin carpeta'),
      icon: 'folder',
      duration: 2200,
    });
    if (ids.length > 1) limpiarSeleccion();
    Router.refresh();
  });

  // Shift+click elige un rango: sin esto, el navegador además selecciona el
  // texto de todas las filas del medio.
  document.addEventListener('mousedown', (e) => {
    if (e.shiftKey && e.target.closest?.('[data-open-mazo]')) e.preventDefault();
  });

  // Navegar suelta la selección: lo elegido es de esta lista, no de la app.
  Router.onChange(() => limpiarSeleccion());
}

/** Todo lo que vive fuera de la vista: statusbar, contadores del rail, contexto. */
function updateChrome() {
  const count = document.querySelector('[data-view="mazos"] .op-navitem__count');
  if (count) count.textContent = S.mazos.length;

  const hoy = document.getElementById('stat-hoy');
  if (hoy) hoy.textContent = paraHoy(S.fichas, reglas());

  const saved = document.querySelector('#stat-saved .op-statusbar__value');
  if (saved) saved.textContent = S.lastSaved ? relTime(S.lastSaved) : '—';

  const foot = document.getElementById('rail-foot');
  if (foot) foot.innerHTML = `<span class="op-meta op-truncate" data-tip="${esc(S.info?.dataDir || '')}">${esc(S.info?.dataDir || '')}</span>`;

  const ctx = document.getElementById('titlebar-context');
  if (!ctx) return;
  if (Router.name === 'repaso' && S.sesion) {
    ctx.innerHTML = `${Icons.svg('mnemus', 'op-icon--sm')}<span>${S.sesion.idx + 1} de ${S.sesion.cola.length}</span>`;
  } else if (Router.name === 'examen' && S.examen) {
    const ex = S.examen;
    ctx.innerHTML = `${Icons.svg('examen', 'op-icon--sm')}<span>${ex.idx >= ex.cola.length
      ? 'Examen corregido' : `Examen · ${ex.idx + 1} de ${ex.cola.length}`}</span>`;
  } else if (Router.name === 'mazo') {
    const m = mazo(Router.param);
    ctx.innerHTML = m ? `${Icons.svg('layers', 'op-icon--sm')}<span>${esc(m.name)}</span>` : '';
  } else {
    ctx.innerHTML = '';
  }
}

/* ══ Semilla ═════════════════════════════════════════════════════════════════
   El primer arranque no puede ser una pantalla vacía que te pide fe: viene un
   mazo real de Farmacología para repasar YA y ver cómo se siente. */

const SEED = [
  ['¿Qué enzima inhibe la aspirina (AAS) y de qué forma?',
    'La ciclooxigenasa (COX-1 y COX-2), de forma irreversible por acetilación.'],
  ['¿Qué es la biodisponibilidad (F)?',
    'La fracción de la dosis administrada que llega inalterada a la circulación sistémica. Por vía IV es 100%.'],
  ['¿Qué es la vida media de eliminación (t½)?',
    'El tiempo en que la concentración plasmática cae a la mitad. En ~4–5 t½ se alcanza el estado estacionario (o se elimina el fármaco).'],
  ['Antagonista competitivo de los receptores opioides',
    'Naloxona — de acción corta; se usa en la sobredosis por opioides.'],
  ['Antídoto de la intoxicación por paracetamol',
    'N-acetilcisteína: repone el glutatión hepático. Ideal dentro de las primeras 8–10 horas.'],
  ['¿Qué es el efecto de primer paso?',
    'El metabolismo (intestinal y hepático) que sufre un fármaco oral antes de llegar a la circulación sistémica; reduce su biodisponibilidad.'],
  ['Inductor clásico del citocromo P450',
    'Rifampicina (también fenitoína, carbamazepina y fenobarbital): baja las concentraciones de los fármacos co-administrados.'],
  ['Agonista β2 selectivo de acción corta (SABA)',
    'Salbutamol — broncodilatador de rescate en la crisis asmática.'],
];

async function seed() {
  const id = await mazosCol.nextId('m');
  await saveMazo({ id, name: 'Farmacología I', createdAt: Date.now() });
  for (const [front, back] of SEED) {
    const fid = await fichasCol.nextId('f');
    await saveFicha({ id: fid, mazo: id, front, back, srs: srsNueva(), createdAt: Date.now() });
  }
  Toast.show({
    title: 'Mazo de ejemplo listo',
    text: 'Farmacología I trae 8 fichas para probar el repaso. Es tuyo: editalo o borralo.',
    icon: 'mnemus',
    duration: 6000,
  });
}

/* ══ Color de la ventana ═════════════════════════════════════════════════════
   La traducción a hex la hace colorToken() con un canvas, no un regex: desde
   Chromium 144 el computado puede venir en oklch y parsearlo pinta la ventana
   de verde. Ver ui.js. */
function syncWindowColor() {
  const hex = colorToken('--op-bg');
  if (hex) api?.win?.setBackground(hex);
}

/* ══ Actualización ═══════════════════════════════════════════════════════════
   La descarga la maneja el proceso principal (src/update.cjs) y avisa recién
   cuando el instalador ya está bajado. Acá solo se ofrece la decisión, con un
   toast propio: nada de diálogos nativos.

   Sin duración: se queda hasta que decidas. Un aviso que se va solo a los
   cuatro segundos no es una decisión, y si lo ignorás no perdés nada — la
   versión nueva se instala igual la próxima vez que cierres la app. */
function avisarUpdate(info) {
  if (!info?.version) return;
  Toast.show({
    title: `Mnemus ${info.version} está lista`,
    text: 'Se instala sola al cerrar la app. O reiniciá ahora y la usás ya.',
    icon: 'download',
    duration: 0,
    actions: [
      { label: 'Después' },
      { label: 'Reiniciar', variant: 'primary', onSelect: () => api.update.install() },
    ],
  });
}

/* ── Buscar a mano, desde Ajustes ──
   El chequeo automático alcanza casi siempre, pero «¿ya salió la versión que
   me dijeron?» merece una respuesta ahora y no dentro de cuatro horas. El
   estado vive acá y no en la vista: si salís de Ajustes a mitad de una
   descarga y volvés, el porcentaje sigue donde iba. */
let upd = null;

const TEXTO_UPD = {
  inicio: () => ['Se buscan solas al abrir la app y cada 4 horas.', 'Buscar actualizaciones'],
  buscando: () => ['Buscando en GitHub…', 'Buscando…'],
  'al-dia': (u) => [`Tenés la última versión (${u.actual}).`, 'Buscar de nuevo'],
  bajando: (u) => [`Bajando la ${u.version}… ${u.porcentaje || 0} %`, 'Bajando…'],
  listo: (u) => [`La ${u.version} ya está bajada. Se instala sola al cerrar la app.`, 'Reiniciar y actualizar'],
  dev: () => ['Esta copia corre desde el repo: en desarrollo no hay actualizaciones.', 'Buscar actualizaciones'],
  error: (u) => [`No se pudo buscar: ${u.mensaje || 'sin respuesta'}. Revisá la conexión y probá de nuevo.`, 'Reintentar'],
};

function pintarUpdate({ animar = true } = {}) {
  const estado = document.getElementById('upd-estado');
  const btn = document.getElementById('upd-btn');
  if (!estado || !btn) return;                 // Ajustes no está montado
  const clave = upd?.estado in TEXTO_UPD ? upd.estado : 'inicio';
  const [texto, etiqueta] = TEXTO_UPD[clave](upd || {});
  const ocupado = clave === 'buscando' || clave === 'bajando';
  btn.disabled = ocupado || clave === 'dev';
  btn.classList.toggle('op-btn--primary', clave === 'listo');
  btn.classList.toggle('op-btn--secondary', clave !== 'listo');
  const icono = clave === 'listo' ? 'download' : 'retry';
  btn.innerHTML = `${Icons.svg(icono, ocupado ? 'op-spinning' : '')} ${esc(etiqueta)}`;

  if (estado.textContent === texto) return;
  // El avance de la descarga cambia varias veces por segundo: ese se escribe
  // directo. Los cambios de estado se funden, no saltan.
  if (!animar || (clave === 'bajando' && estado.dataset.clave === 'bajando')) {
    estado.textContent = texto;
  } else {
    estado.classList.add('is-cambiando');
    setTimeout(() => { estado.textContent = texto; estado.classList.remove('is-cambiando'); }, 140);
  }
  estado.dataset.clave = clave;
}

async function buscarUpdate() {
  if (!api?.update?.check) return;
  upd = { estado: 'buscando' };
  pintarUpdate();
  // Un mínimo de espera: si GitHub contesta en 80 ms, «Buscando…» sería un
  // parpadeo que no se llega a leer, y no queda claro que algo pasó.
  const [r] = await Promise.all([
    api.update.check().catch((e) => ({ estado: 'error', mensaje: String(e?.message || e) })),
    new Promise((r) => setTimeout(r, 700)),
  ]);
  // Si mientras tanto la descarga avanzó o terminó, lo más nuevo gana.
  if (upd?.estado === 'buscando') upd = r;
  pintarUpdate();
}

async function wireUpdates() {
  if (!api?.update) return;                    // build viejo del preload
  api.update.onProgress?.((info) => { upd = { estado: 'bajando', ...info }; pintarUpdate(); });
  api.update.onReady((info) => { upd = { estado: 'listo', ...info }; pintarUpdate(); });
  api.update.onReady(avisarUpdate);
  // Y el que ya estaba listo antes de que esta ventana existiera (ver la
  // trampa 3 de src/update.cjs).
  const pendiente = await api.update.pending().catch(() => null);
  if (pendiente?.version) upd = { estado: 'listo', ...pendiente };
  avisarUpdate(pendiente);
}

/* ══ Arranque ════════════════════════════════════════════════════════════════ */

async function boot() {
  Icons.mount(document);
  Tooltip.init();
  initClickFlash();
  initScrollFades();
  wireShell();
  syncWindowColor();

  try {
    await loadAll();
    if (!S.mazos.length && !S.fichas.length) await seed();
  } catch (err) {
    paint(empty({ icon: 'alert', title: 'No se pudo iniciar', text: err.message }));
    console.error(err);
    return;
  }

  updateChrome();
  Router.onChange(updateChrome);
  Router.go('inicio');
  wireUpdates();

  raf2(() => {
    const splash = document.getElementById('boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600);
  });
}

boot();
