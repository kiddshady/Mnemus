/* ═══════════════════════════════════════════════════════════════════════════
   ENGRAMA — la app
   Flashcards con repaso espaciado (SM-2) sobre Opal. La estructura viene de
   la plantilla: un espejo en memoria de lo que hay en disco, vistas que
   pintan de ese espejo, y toda mutación pasa por los helpers de guardado.

   El dominio en dos frases: un MAZO agrupa FICHAS; cada ficha lleva su srs
   (ver srs.js) que decide cuándo volvés a verla. La sesión de repaso arma la
   cola del día, muestra el frente, esconde la respuesta detrás del velo
   esmerilado, y cada calificación reescribe la srs en disco.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Tooltip, Toast, Menu, Modal } from './overlays.js';
import Palette from './palette.js';
import Router from './router.js';
import { initClickFlash, initScrollFades, raf2, countTo, exit, bindStepper } from './motion.js';
import { viewEl, esc, paint, head, empty, mark, setStateLabels, attempt, copy, colorToken } from './ui.js';
import { relTime, plural } from './format.js';
import { designHTML, wireDesign } from './design-view.js';
import { DIA, GRADOS, srsNueva, esNueva, calificar, simular, armarCola, paraHoy, finDeHoy, vencida } from './srs.js';

const api = window.opal;
const mazosCol = api.col('mazos');
const fichasCol = api.col('fichas');

/* La marca y los símbolos del dominio. El set base no se edita: se extiende. */
Icons.add({
  engrama: '<path d="M1.8 10.5H4.6L6.4 3.2 8.2 12.4 9.6 10.5H14.2"/><circle cx="6.4" cy="3.2" r="1.6"/>',
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
  lastSaved: null,
  /** La sesión de repaso viva, o null. */
  sesion: null,
};

async function loadAll() {
  const [info, settings, mazos, fichas] = await Promise.all([
    api.info(), api.settings.get(), mazosCol.list(), fichasCol.list(),
  ]);
  S.info = info;
  S.settings = settings;
  S.mazos = mazos.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  S.fichas = fichas;
}

async function saveMazo(mazo) {
  const saved = await mazosCol.save({ ...mazo, updatedAt: Date.now() });
  S.mazos = [saved, ...S.mazos.filter((m) => m.id !== saved.id)];
  S.lastSaved = Date.now();
  updateChrome();
  registerCommands();
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
  registerCommands();
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

const cupo = () => ({ nuevasPorDia: Number(S.settings.nuevasPorDia) || 0 });

/* ══ Sesión de repaso ════════════════════════════════════════════════════════ */

function iniciarSesion(mazoId = null) {
  const pool = mazoId ? fichasDe(mazoId) : S.fichas;
  const cola = armarCola(pool, cupo());
  if (!cola.length) {
    Toast.show({ title: 'Nada para repasar', text: 'No hay fichas vencidas ni nuevas por hoy.', icon: 'check' });
    return;
  }
  S.sesion = { mazoId, cola, idx: 0, hechas: 0, otraVez: 0, revelada: false };
  // Si ya estás parado en la vista repaso, go() no repinta: refresh lo fuerza.
  Router.go('repaso', mazoId || 'todo') || Router.refresh();
}

async function calificarActual(q) {
  const ses = S.sesion;
  if (!ses || !ses.revelada) return;
  const actual = ses.cola[ses.idx];
  const srs = calificar(actual.srs || srsNueva(), q);

  const saved = await attempt(() => saveFicha({ ...actual, srs }), { errorTitle: 'No se pudo guardar el repaso' });
  if (!saved) return;

  ses.hechas += 1;
  if (q < 3) {
    ses.otraVez += 1;
    ses.cola.push(saved);       // vuelve al final de la misma sesión
  }
  ses.idx += 1;
  ses.revelada = false;
  Router.refresh();
}

function revelar() {
  const ses = S.sesion;
  if (!ses || ses.revelada) return;
  ses.revelada = true;
  // El orden importa: primero se pinta la respuesta DEBAJO del velo, después
  // el velo se disuelve — el texto se aclara a través del vidrio que se va.
  const back = document.getElementById('back');
  if (back) back.style.visibility = 'visible';
  const velo = document.getElementById('velo');
  if (velo) exit(velo, { fallback: 260 });
  document.getElementById('calif')?.classList.add('is-on');
  updateChrome();
}

/* ══ Vista: Inicio ═══════════════════════════════════════════════════════════ */

function viewInicio() {
  const hoy = paraHoy(S.fichas, cupo());

  paint(head({
    title: 'Inicio',
    sub: 'Lo que se repasa hoy es lo que no se olvida mañana',
    actions: `
      ${hoy ? '<button class="op-btn op-btn--primary op-flashable" data-action="repasar"><i data-icon="zap"></i> Repasar ahora</button>' : ''}
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
          <div class="op-list">${S.mazos.map(rowMazo).join('')}</div>
        </div>`
      : `<div class="op-empty" style="margin:24px auto">${Icons.svg('engrama')}
          <div class="op-empty__title">Todavía no hay mazos</div>
          <div class="op-empty__text">Un mazo agrupa fichas de un tema. Creá el primero, cargale preguntas, y Engrama decide cuándo te conviene volver a verlas.</div>
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
  const hoy = paraHoy(fichas, cupo());
  const st = hoy ? 'queued' : (fichas.length ? 'done' : 'idle');
  return `
    <div class="op-listitem" role="button" tabindex="0" data-open-mazo="${esc(m.id)}">
      ${mark(st, 'square')}
      <div class="op-listitem__main">
        <span class="op-listitem__title">${esc(m.name)}</span>
        <span class="op-listitem__sub">${plural(fichas.length, 'ficha')}${hoy ? ` · ${hoy} para hoy` : ' · al día'}</span>
      </div>
      <div class="op-listitem__aside">
        ${hoy ? `<span class="op-chip">${hoy}</span>` : ''}
        <div class="op-rowactions">
          <button class="op-iconbtn op-iconbtn--sm" data-action="repasar" data-arg="${esc(m.id)}" data-tip="Repasar este mazo"><i data-icon="zap"></i></button>
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
    actions: '<button class="op-btn op-btn--primary op-flashable" data-action="nuevo-mazo"><i data-icon="plus"></i> Nuevo mazo</button>',
  }) + (S.mazos.length
    ? `<div class="op-scroll op-grow">
         <div class="op-list">${S.mazos.map(rowMazo).join('')}</div>
         <div style="height:32px"></div>
       </div>`
    : empty({
      icon: 'engrama',
      title: 'No hay mazos',
      text: 'Cada mazo es una carpeta de fichas JSON en tu disco: legibles, versionables, tuyas.',
      actions: '<button class="op-btn op-btn--secondary op-flashable" data-action="nuevo-mazo"><i data-icon="plus"></i> Crear el primero</button>',
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
  const hoy = paraHoy(fichas, cupo());

  paint(head({
    title: m.name,
    sub: plural(fichas.length, 'ficha') + (hoy ? ` · ${hoy} para hoy` : ' · al día'),
    crumbs: [{ label: 'Mazos', view: 'mazos' }, { label: m.name }],
    actions: `
      <button class="op-btn op-btn--primary op-flashable" data-action="nueva-ficha" data-arg="${esc(id)}"><i data-icon="plus"></i> Nueva ficha</button>
      ${hoy ? `<button class="op-btn op-btn--secondary op-flashable" data-action="repasar" data-arg="${esc(id)}"><i data-icon="zap"></i> Repasar</button>` : ''}
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
  return `
    <div class="op-listitem" role="button" tabindex="0" data-action="editar-ficha" data-arg="${esc(f.id)}">
      ${mark(estadoFicha(f))}
      <div class="op-listitem__main">
        <span class="op-listitem__title">${esc(f.front)}</span>
        <span class="op-listitem__sub">${esc(venceTxt(f))}${f.srs?.lapses ? ` · ${plural(f.srs.lapses, 'olvido')}` : ''}</span>
      </div>
      <div class="op-rowactions">
        <button class="op-iconbtn op-iconbtn--sm" data-menu="ficha" data-menu-arg="${esc(f.id)}" data-tip="Más"><i data-icon="more"></i></button>
      </div>
    </div>`;
}

/* ══ Vista: Repaso ═══════════════════════════════════════════════════════════
   Una ficha por vez, centrada sobre la niebla. La respuesta nace detrás del
   velo esmerilado; Espacio la revela, 1–4 califican. */

function viewRepaso(param) {
  const mazoId = param === 'todo' ? null : param;

  // Entrar directo (paleta, arranque) sin sesión viva: se arma acá.
  if (!S.sesion || (S.sesion.mazoId || 'todo') !== (mazoId || 'todo')) {
    const cola = armarCola(mazoId ? fichasDe(mazoId) : S.fichas, cupo());
    if (!cola.length) {
      paint(head({ title: 'Repaso' }) + empty({
        icon: 'check',
        title: 'Nada para repasar',
        text: 'No hay fichas vencidas ni nuevas por hoy. Volvé mañana, o bajá el cupo si te quedaste con ganas.',
        actions: '<button class="op-btn op-btn--secondary op-flashable" data-goto="inicio">Volver al inicio</button>',
      }));
      return;
    }
    S.sesion = { mazoId, cola, idx: 0, hechas: 0, otraVez: 0, revelada: false };
  }

  const ses = S.sesion;

  /* Los atajos viven mientras vive la vista: Router.onLeave los suelta.
     Sin eso, cada visita apila un handler más y una tecla califica dos veces. */
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (document.querySelector('.op-modal, .op-palette, .op-menu')) return;
    if (e.key === ' ') { e.preventDefault(); ses.revelada ? null : revelar(); }
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx >= 0) {
      e.preventDefault();
      calificarActual([GRADOS.otra, GRADOS.dificil, GRADOS.bien, GRADOS.facil][idx]);
    }
  };
  document.addEventListener('keydown', onKey);
  Router.onLeave(() => document.removeEventListener('keydown', onKey));

  if (ses.idx >= ses.cola.length) {
    S.sesion = null;
    paint(head({ title: 'Repaso' }) + `
      <div class="en-repaso">
        <div class="en-fin">
          ${Icons.svg('check')}
          <div class="op-subtitle">Sesión terminada</div>
          <div class="op-meta">Lo repasado hoy vuelve justo antes de que se olvide.</div>
          <div class="en-fin__cifras">
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
  }) + `
    <div class="en-repaso">
      <div class="en-progreso">
        <span class="op-meta op-num">${ses.idx + 1}/${ses.cola.length}</span>
        <div class="op-meter"><div class="op-meter__fill" style="--op-pct:${pct}%"></div></div>
        <span class="op-meta op-num">${ses.otraVez} otra vez</span>
      </div>

      <div class="en-ficha">
        <div class="en-ficha__zona"><div class="en-ficha__front op-copyable">${esc(f.front)}</div></div>
        <div class="en-ficha__divisor"></div>
        <div class="en-ficha__answer">
          <!-- La respuesta nace SIN PINTAR (visibility:hidden), no solo tapada:
               así ningún capricho del compositor puede dejarla legible antes
               de tiempo. El des-esmerilado real pasa al revelar: se pinta el
               texto debajo del velo y el velo se disuelve encima. -->
          <div class="en-ficha__back op-copyable" id="back" style="visibility:hidden">${esc(f.back)}</div>
          <button class="en-velo" id="velo" aria-label="Revelar la respuesta">
            <span class="en-velo__hint"><span class="op-kbd">Espacio</span> revelar</span>
          </button>
        </div>
      </div>

      <div class="en-calif" id="calif">
        ${grados.map(([id, label, q], i) => `
          <button class="op-btn op-btn--secondary op-flashable en-calif__${id}" data-grado="${q}">
            <span class="en-calif__label">${label}</span>
            <span class="en-calif__int">${id === 'otra' ? 'vuelve hoy' : diasTxt(simular(f.srs, q))} · ${i + 1}</span>
          </button>`).join('')}
      </div>
    </div>`);

  const raiz = viewEl();
  raiz.querySelector('#velo').addEventListener('click', revelar);
  raiz.querySelector('#calif').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-grado]');
    if (btn) calificarActual(Number(btn.dataset.grado));
  });

  updateChrome();
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
          </div></div>
        </div>

      </div>
      <div style="height:32px"></div>
    </div>`);

  bindStepper(document.getElementById('set-nuevas'), (value) => persist({ nuevasPorDia: value }));
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

/**
 * Alta y edición comparten el modal. En el alta, «Guardar y otra» deja el
 * diálogo listo para la siguiente: cargar un mazo entero no debería costar
 * un viaje por el mouse por ficha.
 */
async function fichaModal(mazoId, fichaId = null) {
  const original = fichaId ? S.fichas.find((f) => f.id === fichaId) : null;

  while (true) {
    const body = document.createElement('div');
    body.className = 'op-col';
    body.style.gap = '16px';
    body.innerHTML = `
      <div class="op-field">
        <label class="op-field__label">Frente — la pregunta</label>
        <textarea class="op-textarea" id="f-front" rows="3"
                  placeholder="¿Qué enzima inhibe la aspirina?"></textarea>
      </div>
      <div class="op-field">
        <label class="op-field__label">Dorso — la respuesta</label>
        <textarea class="op-textarea" id="f-back" rows="4"
                  placeholder="La ciclooxigenasa (COX), de forma irreversible."></textarea>
      </div>`;
    if (original) {
      body.querySelector('#f-front').value = original.front;
      body.querySelector('#f-back').value = original.back;
    }

    const res = await Modal.show({
      title: original ? 'Editar ficha' : 'Nueva ficha',
      sub: original ? `${original.id} · el historial de repaso se conserva.` : undefined,
      body,
      width: 520,
      actions: [
        { label: 'Cancelar', value: null },
        ...(original ? [] : [{ label: 'Guardar y otra', value: 'otra' }]),
        { label: 'Guardar', value: true, variant: 'primary', autofocus: !original },
      ],
    });
    if (!res) return;

    const front = body.querySelector('#f-front').value.trim();
    const back = body.querySelector('#f-back').value.trim();
    if (!front || !back) {
      Toast.error('Ficha incompleta', 'El frente y el dorso no pueden quedar vacíos.');
      if (res !== 'otra') return;
      continue;
    }

    await attempt(async () => {
      if (original) {
        await saveFicha({ ...original, front, back });
      } else {
        const id = await fichasCol.nextId('f');
        await saveFicha({ id, mazo: mazoId, front, back, srs: srsNueva(), createdAt: Date.now() });
      }
      Router.refresh();
    }, { errorTitle: 'No se pudo guardar la ficha' });

    if (res !== 'otra') return;
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
  piezas: { view: viewPiezas },
  ajustes: { view: viewAjustes },
}, document.getElementById('view'));

/* ══ Menús de contexto ═══════════════════════════════════════════════════════ */

const MENUS = {
  mazo: (id) => [
    { label: 'Abrir', icon: 'external', onSelect: () => Router.go('mazo', id) },
    { label: 'Repasar', icon: 'zap', onSelect: () => iniciarSesion(id) },
    { label: 'Renombrar…', icon: 'edit', onSelect: () => renombrarMazo(id) },
    { label: 'Copiar id', icon: 'copy', onSelect: () => copy(id) },
    { sep: true },
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => eliminarMazo(id) },
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

  document.getElementById('btn-palette')?.addEventListener('click', () => Palette.toggle());
  document.getElementById('btn-repasar')?.addEventListener('click', () => iniciarSesion(null));

  /* Delegación global: las vistas se repintan enteras, así que el cableado se
     hace UNA vez acá y sobrevive a cualquier innerHTML. */
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) Router.go(goto.dataset.goto, goto.dataset.param || null);

    const open = e.target.closest('[data-open-mazo]');
    if (open && !e.target.closest('[data-menu], [data-action]')) Router.go('mazo', open.dataset.openMazo);

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
      if (a === 'nueva-ficha') fichaModal(arg || Router.param);
      if (a === 'editar-ficha') fichaModal(null, arg);
      if (a === 'repasar') iniciarSesion(arg);
    }
  });

  // Enter y Espacio sobre una fila: la lista tiene que ser usable sin mouse.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest?.('[data-open-mazo]');
    if (!row) return;
    e.preventDefault();
    Router.go('mazo', row.dataset.openMazo);
  });
}

/** Todo lo que vive fuera de la vista: statusbar, contadores del rail, contexto. */
function updateChrome() {
  const count = document.querySelector('[data-view="mazos"] .op-navitem__count');
  if (count) count.textContent = S.mazos.length;

  const hoy = document.getElementById('stat-hoy');
  if (hoy) hoy.textContent = paraHoy(S.fichas, cupo());

  const saved = document.querySelector('#stat-saved .op-statusbar__value');
  if (saved) saved.textContent = S.lastSaved ? relTime(S.lastSaved) : '—';

  const foot = document.getElementById('rail-foot');
  if (foot) foot.innerHTML = `<span class="op-meta op-truncate" data-tip="${esc(S.info?.dataDir || '')}">${esc(S.info?.dataDir || '')}</span>`;

  const ctx = document.getElementById('titlebar-context');
  if (!ctx) return;
  if (Router.name === 'repaso' && S.sesion) {
    ctx.innerHTML = `${Icons.svg('engrama', 'op-icon--sm')}<span>${S.sesion.idx + 1} de ${S.sesion.cola.length}</span>`;
  } else if (Router.name === 'mazo') {
    const m = mazo(Router.param);
    ctx.innerHTML = m ? `${Icons.svg('layers', 'op-icon--sm')}<span>${esc(m.name)}</span>` : '';
  } else {
    ctx.innerHTML = '';
  }
}

function registerCommands() {
  Palette.clear();
  Palette.register([
    { id: 'repasar', group: 'Repasar', icon: 'zap', label: 'Repasar ahora', run: () => iniciarSesion(null) },
    ...S.mazos.map((m) => ({
      id: `rep-${m.id}`, group: 'Repasar', icon: 'zap', label: `Repasar ${m.name}`, hint: m.id,
      run: () => iniciarSesion(m.id),
    })),
    { id: 'nuevo-mazo', group: 'Crear', icon: 'plus', label: 'Nuevo mazo', run: nuevoMazoModal },
    { id: 'nav-inicio', group: 'Ir a', icon: 'home', label: 'Inicio', run: () => Router.go('inicio') },
    { id: 'nav-mazos', group: 'Ir a', icon: 'layers', label: 'Mazos', run: () => Router.go('mazos') },
    { id: 'nav-piezas', group: 'Ir a', icon: 'grid', label: 'Piezas', run: () => Router.go('piezas') },
    { id: 'nav-ajustes', group: 'Ir a', icon: 'settings', label: 'Ajustes', run: () => Router.go('ajustes') },
    ...S.mazos.map((m) => ({
      id: `open-${m.id}`, group: 'Abrir', icon: 'layers', label: m.name, hint: m.id,
      run: () => Router.go('mazo', m.id),
    })),
  ]);
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
    icon: 'engrama',
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

/* ══ Arranque ════════════════════════════════════════════════════════════════ */

async function boot() {
  Icons.mount(document);
  Tooltip.init();
  Palette.init({ placeholder: 'Buscar comandos y mazos…' });
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

  registerCommands();
  updateChrome();
  Router.onChange(updateChrome);
  Router.go('inicio');

  raf2(() => {
    const splash = document.getElementById('boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600);
  });
}

boot();
