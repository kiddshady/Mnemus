/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — la sincronía con el celular
   Mnemus Mobile estudia sin conexión y después vuelve a la PC. Este módulo
   decide qué pasa en ese encuentro. Puro y sin DOM, como srs.js: se testea con
   node pelado (test/sincro.test.mjs).

   ── Quién manda en qué ─────────────────────────────────────────────────────
   El contenido (mazos, fichas, carpetas) se escribe SOLO en la PC: el celu lo
   recibe entero en cada sincronía y lo reemplaza. Lo que viaja del celu a la
   PC no son estados sino HECHOS:

     repasos   { id, ficha, q, ts } — «a tal hora califiqué tal ficha con q»
     examenes  { id, registro }     — un examen rendido, ya con su registro

   ── Por qué hechos y no la srs final ──────────────────────────────────────
   Si el celu mandara la srs resultante y en el medio repasaste la misma ficha
   en la PC, una de las dos historias se pisaría. Con hechos, la PC los VUELVE
   A PASAR por SM-2 sobre su propio estado, en orden de hora. Si la PC no tocó
   la ficha, el resultado es idéntico al que calculó el celu (calificar es
   determinista dado el instante); si la tocó, se suman las dos historias en
   vez de ganar una.

   ── Por qué cada hecho tiene id ───────────────────────────────────────────
   La respuesta puede perderse en el Wi-Fi después de que la PC ya aplicó
   todo. El celu no se entera y reintenta con los mismos hechos. Sin ids, cada
   reintento sumaría repasos que nunca pasaron; con ids, la PC reconoce lo que
   ya aplicó y lo saltea. Los examenes guardan su id en `origen` y se
   reconocen por ahí; los repasos, en la lista de aplicados que lleva quien
   llama (un documento aparte: la ficha no es lugar para un log).
   ═══════════════════════════════════════════════════════════════════════════ */

import { calificar, srsNueva, DIA } from './srs.js';
import { claveDia } from './stats.js';

export const PROTOCOLO = 1;

/** Cuánto se recuerda un id aplicado. Un reintento llega en segundos; 90 días
    es margen de sobra sin que la lista crezca para siempre. */
export const RECUERDO = 90 * DIA;

const Q_VALIDAS = new Set([0, 3, 4, 5]);

/**
 * Lo que la PC le manda al celu: todo lo necesario para estudiar sin conexión.
 * Las fichas van con su srs (el celu arma la cola del día con eso) y los
 * exámenes con su registro de texto (para el historial).
 */
export function instantanea(S, { ahora = Date.now(), version = null } = {}) {
  return {
    protocolo: PROTOCOLO,
    ahora,
    version,
    ajustes: {
      nuevasPorDia: S.settings?.nuevasPorDia ?? 10,
      azar: !!S.settings?.azar,
    },
    carpetas: S.carpetas.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt || 0 })),
    mazos: S.mazos.map((m) => ({ id: m.id, name: m.name, carpeta: m.carpeta || null, updatedAt: m.updatedAt || 0 })),
    fichas: S.fichas.map((f) => {
      const out = { id: f.id, mazo: f.mazo, tipo: f.tipo || 'basica', front: f.front, back: f.back, createdAt: f.createdAt || 0 };
      if (Array.isArray(f.opciones)) out.opciones = f.opciones;
      if (f.correcta != null) out.correcta = f.correcta;
      out.srs = f.srs || srsNueva(f.createdAt || ahora);
      return out;
    }),
    examenes: S.examenes,
    actividad: S.actividad.map((a) => ({ dia: a.dia, repasos: a.repasos || 0, otraVez: a.otraVez || 0 })),
  };
}

/**
 * ¿El paquete del celu se puede aplicar? Devuelve el problema o null. Lo que
 * entra acá viene de la red: se revisa la forma antes de tocar nada.
 */
export function validarPaquete(p) {
  if (!p || typeof p !== 'object') return 'El paquete no tiene forma.';
  if (p.protocolo !== PROTOCOLO) {
    return p.protocolo > PROTOCOLO
      ? 'El celular usa una versión más nueva de la sincronía. Actualizá Mnemus en la PC.'
      : 'El celular usa una versión vieja de la sincronía. Actualizá Mnemus Mobile.';
  }
  if (!Array.isArray(p.repasos) || !Array.isArray(p.examenes)) return 'Faltan los repasos o los exámenes.';
  for (const r of p.repasos) {
    if (!r || typeof r.id !== 'string' || !r.id) return 'Hay un repaso sin id.';
    if (typeof r.ficha !== 'string') return 'Hay un repaso sin ficha.';
    if (!Q_VALIDAS.has(r.q)) return `Calificación inválida: ${r.q}`;
    if (!Number.isFinite(r.ts)) return 'Hay un repaso sin hora.';
  }
  for (const e of p.examenes) {
    const reg = e?.registro;
    if (!e || typeof e.id !== 'string' || !e.id) return 'Hay un examen sin id.';
    if (!reg || !Number.isInteger(reg.total) || !Number.isInteger(reg.correctas) || !Array.isArray(reg.falladas)) {
      return 'Hay un examen con un registro incompleto.';
    }
  }
  return null;
}

/**
 * Aplica el paquete sobre el estado de la PC. NO toca el disco: devuelve lo
 * que hay que guardar, y quien llama lo persiste por sus helpers de siempre.
 *
 * @param estado    { fichas, actividad, examenes } — el espejo de la PC
 * @param paquete   lo que mandó el celu (ya validado)
 * @param aplicados { [idRepaso]: ts } — lo que ya se aplicó antes
 * @returns {
 *   fichas:    las fichas con su srs nueva (solo las que cambiaron)
 *   actividad: los días de actividad actualizados (solo los que cambiaron)
 *   examenes:  los registros nuevos, sin id (lo asigna quien guarda)
 *   aplicados: la lista de aplicados actualizada y podada
 *   cuenta:    { repasos, examenes, repetidos, huerfanos }
 * }
 */
export function aplicar(estado, paquete, aplicados = {}, { ahora = Date.now() } = {}) {
  const ya = { ...aplicados };
  const cuenta = { repasos: 0, examenes: 0, repetidos: 0, huerfanos: 0 };

  // Los repasos nuevos, en orden de hora: SM-2 no conmuta — calificar Bien y
  // después Otra vez no deja lo mismo que al revés.
  const nuevos = [];
  for (const r of paquete.repasos) {
    if (ya[r.id]) { cuenta.repetidos += 1; continue; }
    // Se anota la hora de APLICACIÓN, no la del repaso: un repaso de hace
    // cuatro meses que llega hoy tiene que recordarse desde hoy, o la poda
    // lo olvidaría en el acto y un reintento lo contaría dos veces.
    ya[r.id] = ahora;
    nuevos.push(r);
  }
  nuevos.sort((a, b) => a.ts - b.ts);

  const fichas = new Map(estado.fichas.map((f) => [f.id, f]));
  const tocadas = new Map();
  const dias = new Map(estado.actividad.map((a) => [a.dia, a]));
  const diasTocados = new Map();

  for (const r of nuevos) {
    // La actividad cuenta aunque la ficha ya no exista: el repaso pasó.
    const dia = claveDia(r.ts);
    const previo = diasTocados.get(dia) || dias.get(dia) || { id: `d-${dia}`, dia, repasos: 0, otraVez: 0 };
    diasTocados.set(dia, { ...previo, repasos: (previo.repasos || 0) + 1, otraVez: (previo.otraVez || 0) + (r.q < 3 ? 1 : 0) });

    const f = tocadas.get(r.ficha) || fichas.get(r.ficha);
    if (!f) { cuenta.huerfanos += 1; continue; }
    tocadas.set(r.ficha, { ...f, srs: calificar(f.srs || srsNueva(f.createdAt || r.ts), r.q, r.ts) });
    cuenta.repasos += 1;
  }

  const origenes = new Set(estado.examenes.map((e) => e.origen).filter(Boolean));
  const examenes = [];
  for (const e of paquete.examenes) {
    if (origenes.has(e.id)) { cuenta.repetidos += 1; continue; }
    origenes.add(e.id);
    examenes.push({ ...e.registro, origen: e.id, dispositivo: 'celular' });
    cuenta.examenes += 1;
  }

  // Poda: lo que se aplicó hace más de RECUERDO ya no puede volver.
  for (const [id, ts] of Object.entries(ya)) {
    if (ahora - ts > RECUERDO) delete ya[id];
  }

  return {
    fichas: [...tocadas.values()],
    actividad: [...diasTocados.values()],
    examenes,
    aplicados: ya,
    cuenta,
  };
}
