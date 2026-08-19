/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — importar y exportar mazos
   Un mazo que se puede mandar por chat. El archivo es JSON legible: se abre
   con cualquier editor, se puede revisar antes de importarlo, y si algún día
   Mnemus no existe más los mazos siguen siendo tuyos.

   Puro y sin DOM, como srs.js y ficha.js: se testea con node pelado.

   ── Dos decisiones que definen el formato ──────────────────────────────────

   1. NO viajan los ids. Un `f-0042` del origen no significa nada en el
      destino, y si lo respetáramos, importar dos veces el mismo archivo se
      pisaría a sí mismo. Los ids los asigna quien importa, siempre.

   2. El progreso SÍ viaja, pero se aplica solo si te lo pedís. El mismo
      archivo sirve para dos cosas muy distintas: mandarle un mazo a alguien
      (que lo quiere empezar de cero) y mover tus mazos entre dos máquinas
      (donde perder el historial sería perder meses de repaso). Guardarlo
      siempre y decidir al importar deja las dos puertas abiertas con un solo
      formato — al revés no: lo que no se exportó no se recupera después.
   ═══════════════════════════════════════════════════════════════════════════ */

import { srsNueva } from './srs.js';
import { tipoDe, opcionesDe, indiceCorrecto, validar as validarFicha, normalizar as normalizarFicha } from './ficha.js';

export const FORMATO = 'mnemus/mazos';
export const VERSION = 1;

/* Un archivo de intercambio no debería pesar más que esto ni de casualidad:
   10 MB son decenas de miles de fichas. Más que eso es un archivo equivocado
   o uno armado para hacer daño, y en los dos casos la respuesta es la misma. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Deja la ficha en lo que vale la pena mandar: sin ids, sin fechas locales. */
function paraExportar(f) {
  const tipo = tipoDe(f);
  const out = { tipo, front: f.front, back: f.back };
  if (tipo === 'opcion') out.opciones = opcionesDe(f);
  if (tipo !== 'basica') out.correcta = indiceCorrecto(f);
  out.srs = f.srs || srsNueva(0);
  return out;
}

/**
 * Arma el objeto que se escribe al disco.
 * @param {Array} mazos   los mazos a incluir
 * @param {Array} fichas  TODAS las fichas; se filtran por mazo acá adentro
 */
export function empaquetar(mazos, fichas, { app = null, ahora = Date.now() } = {}) {
  return {
    formato: FORMATO,
    version: VERSION,
    exportado: new Date(ahora).toISOString(),
    app,
    mazos: mazos.map((m) => ({
      name: m.name,
      fichas: fichas.filter((f) => f.mazo === m.id).map(paraExportar),
    })),
  };
}

/**
 * ¿Este objeto es un archivo de Mnemus que se puede importar? Devuelve el
 * problema o `null`. Lo que entra acá vino de un archivo que eligió el
 * usuario: puede ser cualquier cosa, incluido un JSON válido de otra app.
 */
export function validar(data) {
  if (!data || typeof data !== 'object') return 'El archivo no tiene el formato de un mazo de Mnemus.';
  if (data.formato !== FORMATO) return 'Esto no parece un mazo exportado de Mnemus.';
  if (!Number.isInteger(data.version) || data.version < 1) return 'El archivo no declara una versión válida.';
  if (data.version > VERSION) {
    return `El archivo lo escribió una versión más nueva de Mnemus (formato ${data.version}). Actualizá la app para poder abrirlo.`;
  }
  if (!Array.isArray(data.mazos) || !data.mazos.length) return 'El archivo no trae ningún mazo.';

  for (const m of data.mazos) {
    if (!m || typeof m.name !== 'string' || !m.name.trim()) return 'Hay un mazo sin nombre.';
    if (!Array.isArray(m.fichas)) return `El mazo «${m.name}» no trae una lista de fichas.`;
    for (const f of m.fichas) {
      const problema = validarFicha(normalizarFicha({ ...f, front: String(f?.front ?? ''), back: String(f?.back ?? '') }));
      if (problema) return `En «${m.name}» hay una ficha inválida: ${problema}`;
    }
  }
  return null;
}

/** ¿El archivo trae fichas con repasos hechos? Define si vale ofrecer conservarlo. */
export function traeProgreso(data) {
  return (data?.mazos || []).some((m) => (m.fichas || []).some((f) => f?.srs?.reps > 0 || f?.srs?.lapses > 0));
}

/** Lo que se le muestra al usuario ANTES de importar: qué está por entrar. */
export function resumen(data) {
  const mazos = data?.mazos || [];
  const fichas = mazos.flatMap((m) => m.fichas || []);
  const porTipo = fichas.reduce((acc, f) => {
    const t = tipoDe(f);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  return {
    mazos: mazos.length,
    fichas: fichas.length,
    porTipo,
    conProgreso: traeProgreso(data),
    nombres: mazos.map((m) => m.name),
  };
}

/**
 * Convierte el archivo en lo que hay que guardar. NO toca el disco: devuelve
 * los mazos y sus fichas ya normalizados, sin ids, para que quien llama les
 * asigne los suyos.
 *
 * `conProgreso: false` (el default) hace que las fichas entren como nuevas —
 * que es lo correcto cuando el mazo te lo pasó otra persona: su historial
 * describe lo que ELLA recuerda, no lo que recordás vos.
 */
export function desempaquetar(data, { conProgreso = false, ahora = Date.now() } = {}) {
  return (data.mazos || []).map((m) => ({
    name: m.name.trim(),
    fichas: (m.fichas || []).map((f) => {
      const ficha = normalizarFicha({ ...f, front: String(f.front), back: String(f.back) });
      delete ficha.id;
      delete ficha.mazo;
      delete ficha.createdAt;
      delete ficha.updatedAt;
      ficha.srs = conProgreso && f.srs ? { ...f.srs } : srsNueva(ahora);
      return ficha;
    }),
  }));
}

/** Un nombre de archivo que sobrevive a Windows y se entiende en un chat. */
export function nombreArchivo(mazos) {
  const base = mazos.length === 1 ? mazos[0].name : `${mazos.length} mazos`;
  const limpio = base.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Mnemus - ${limpio || 'mazos'}.json`;
}
