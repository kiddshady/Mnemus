/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — command palette
   El centro de mando: Ctrl+K. En una app de teclado esto no es un extra, es la
   navegación principal — el rail es para el mouse, la palette es para las manos.

   El match es por subsecuencia (tipeás "rndg" y encontrás "Research Digest") y
   lo que coincide se ILUMINA en blanco, no se pinta de amarillo.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { exit, scrollFade } from './motion.js';

const commands = [];
let open = null;

/* ── Qué dice el campo vacío ─────────────────────────────────────────────────

   Estuvo hardcodeado con «Buscar comandos, pipelines, agentes…» — vocabulario
   de la app para la que se escribió esta paleta, que se vino de arriba con la
   plantilla. Toda app que salga de Opal lo arrastra, y en una de química, donde
   no hay ni pipelines ni agentes, el placeholder promete dos cosas que no
   existen. Lo peor es dónde se esconde: en un componente que nadie vuelve a
   abrir, detrás de un texto que solo se lee cuando el campo está vacío.

   Así que el default es genérico —lo único que Opal sabe con certeza es que
   acá se buscan comandos— y cada app pone el suyo por `init()`. Es la misma
   regla que `Icons.add()`: extender la pieza, no editarla, para que traerse una
   versión nueva de Opal no pise lo propio. */
const PLACEHOLDER = 'Buscar comandos…';
let placeholder = PLACEHOLDER;

/** Registra comandos. { id, label, group, icon, hint, run } */
export function register(list) {
  commands.push(...list);
}

export function clear() { commands.length = 0; }

/* ── Match por subsecuencia ────────────────────────────────────────────────
   Devuelve los índices que matchearon y un puntaje: premia matches al
   principio de palabra y contiguos, castiga los saltos largos. */
function match(text, query) {
  if (!query) return { hits: [], score: 0 };
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const hits = [];
  let score = 0;
  let from = 0;

  for (let i = 0; i < q.length; i++) {
    const at = lower.indexOf(q[i], from);
    if (at === -1) return null;
    const isWordStart = at === 0 || /[\s\-_/.]/.test(text[at - 1]);
    const isContiguous = hits.length && at === hits[hits.length - 1] + 1;
    score += isWordStart ? 12 : isContiguous ? 8 : 2;
    score -= Math.min(6, at - from);          // castigo por saltar lejos
    hits.push(at);
    from = at + 1;
  }
  score -= text.length * 0.05;                // ante empate, gana lo más corto
  return { hits, score };
}

function highlight(text, hits) {
  const set = new Set(hits);
  const frag = document.createDocumentFragment();
  let buffer = '';
  let marked = false;

  const flush = () => {
    if (!buffer) return;
    if (marked) {
      const m = document.createElement('mark');
      m.textContent = buffer;
      frag.appendChild(m);
    } else {
      frag.appendChild(document.createTextNode(buffer));
    }
    buffer = '';
  };

  for (let i = 0; i < text.length; i++) {
    const isHit = set.has(i);
    if (isHit !== marked) { flush(); marked = isHit; }
    buffer += text[i];
  }
  flush();
  return frag;
}

function close() {
  if (!open) return;
  const { scrim, anim } = open;
  open = null;
  document.removeEventListener('keydown', onKey, true);
  exit(anim, { fallback: 300 });
  exit(scrim, { fallback: 300 });
}

function move(dir) {
  if (!open) return;
  const items = [...open.list.querySelectorAll('.op-palette__item')];
  if (!items.length) return;
  const i = items.findIndex((el) => el.classList.contains('is-active'));
  const next = items[Math.min(items.length - 1, Math.max(0, i + dir))];
  items.forEach((el) => el.classList.remove('is-active'));
  next.classList.add('is-active');
  next.scrollIntoView({ block: 'nearest' });
}

function run() {
  const active = open?.list.querySelector('.op-palette__item.is-active');
  if (!active) return;
  const cmd = commands.find((c) => c.id === active.dataset.id);
  close();
  // Corre después del cierre para que la salida del overlay no compita con
  // la transición de la vista que el comando dispara.
  setTimeout(() => cmd?.run?.(), 40);
}

function onKey(e) {
  if (!open) return;
  if (e.key === 'Escape')         { e.preventDefault(); e.stopPropagation(); close(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter')     { e.preventDefault(); run(); }
}

function render(query) {
  const { list } = open;
  list.innerHTML = '';

  const scored = commands
    .map((c) => {
      const m = match(c.label, query);
      if (query && !m) return null;
      return { cmd: c, hits: m?.hits || [], score: m?.score || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    list.innerHTML = `
      <div class="op-empty" style="padding:32px 16px">
        ${Icons.svg('search')}
        <div class="op-empty__text">Nada coincide con lo que escribiste.</div>
      </div>`;
    return;
  }

  let lastGroup = null;
  scored.forEach(({ cmd, hits }, i) => {
    // Los grupos solo se muestran sin filtro: al buscar, el orden es el ranking.
    if (!query && cmd.group && cmd.group !== lastGroup) {
      lastGroup = cmd.group;
      const g = document.createElement('div');
      g.className = 'op-palette__group';
      g.textContent = cmd.group;
      list.appendChild(g);
    }

    const b = document.createElement('button');
    b.className = `op-palette__item${i === 0 ? ' is-active' : ''}`;
    b.dataset.id = cmd.id;
    b.innerHTML = cmd.icon ? Icons.svg(cmd.icon) : '<span style="width:15px"></span>';

    const label = document.createElement('span');
    label.className = 'op-truncate';
    label.appendChild(query ? highlight(cmd.label, hits) : document.createTextNode(cmd.label));
    b.appendChild(label);

    if (cmd.hint) {
      const h = document.createElement('span');
      h.className = 'op-palette__item__hint';
      h.textContent = cmd.hint;
      b.appendChild(h);
    }

    b.addEventListener('click', run);
    b.addEventListener('pointerenter', () => {
      list.querySelectorAll('.op-palette__item').forEach((el) => el.classList.remove('is-active'));
      b.classList.add('is-active');
    });
    list.appendChild(b);
  });
}

export function show() {
  if (open) return;

  const host = document.getElementById('op-layer') || document.body;

  const scrim = document.createElement('div');
  scrim.className = 'op-scrim';
  scrim.addEventListener('click', close);

  const anim = document.createElement('div');
  anim.className = 'op-palette__anim';
  anim.innerHTML = `
    <div class="op-palette" role="dialog" aria-modal="true">
      <div class="op-palette__search">
        ${Icons.svg('search', 'op-icon--lg')}
        <input class="op-palette__input" placeholder="${placeholder.replace(/"/g, '&quot;')}" spellcheck="false" autocomplete="off">
      </div>
      <div class="op-palette__list op-scroll"></div>
      <div class="op-palette__foot">
        <span class="op-row"><span class="op-kbd">${Icons.svg('keyUp')}</span><span class="op-kbd">${Icons.svg('keyDown')}</span> navegar</span>
        <span class="op-row"><span class="op-kbd">${Icons.svg('keyEnter')}</span> ejecutar</span>
        <span class="op-row"><span class="op-kbd">Esc</span> cerrar</span>
      </div>
    </div>`;

  host.append(scrim, anim);

  const input = anim.querySelector('.op-palette__input');
  const list = anim.querySelector('.op-palette__list');
  open = { scrim, anim, input, list };

  input.addEventListener('input', () => render(input.value.trim()));
  render('');
  scrollFade(list);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => input.focus(), 40);
}

export function toggle() { open ? close() : show(); }

/**
 * Cablea Ctrl+K / Cmd+K globalmente.
 *
 * `placeholder` es lo que dice el campo vacío. Poné el vocabulario de TU app:
 * el default solo puede prometer comandos, porque es lo único que Opal sabe que
 * hay acá adentro.
 *
 *   Palette.init({ placeholder: 'Buscar comandos y estructuras…' })
 */
export function init({ placeholder: texto } = {}) {
  // Una cadena vacía vuelve al default: un campo sin ninguna pista es peor que
  // uno con una genérica.
  placeholder = String(texto || '').trim() || PLACEHOLDER;

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
    }
  });
}

export const Palette = { register, clear, show, close, toggle, init };
export default Palette;
