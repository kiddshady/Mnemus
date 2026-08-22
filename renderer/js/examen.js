/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — el examen
   Una medición, no un repaso: tomás N fichas del mazo, las contestás una vez
   cada una, y al final hay un puntaje. El SRS no se entera — el examen LEE
   las fichas pero jamás escribe una srs, porque medir cuánto sabés no es lo
   mismo que estudiar, y un examen que te reprograma el plan de repaso está
   castigando dos veces la misma falla.

   Entra el mazo COMPLETO, no la cola del día: un examen evalúa el temario,
   no la deuda. Y sale siempre barajado — un examen con las preguntas en el
   orden en que las cargaste es un machete.

   Puro y sin DOM a propósito, como srs.js: se testea con node pelado
   (test/examen.test.mjs). La contabilidad de correctas e incorrectas vive en
   la sesión (app.js); acá está lo que se puede afirmar sin una pantalla.
   ═══════════════════════════════════════════════════════════════════════════ */

import { barajar } from './srs.js';
import { esInteractiva, opcionesDe, indiceCorrecto } from './ficha.js';

/**
 * Arma el cuestionario: baraja el pool entero y corta a `cantidad`.
 *
 * Se baraja ANTES de cortar, no después: así un examen de 10 sobre un mazo
 * de 80 es una muestra al azar del mazo, no las primeras 10 mezcladas.
 *
 * `cantidad` fuera de rango no rompe: se acota a [1, total]. El stepper de
 * la UI ya lo impide, pero un módulo puro no confía en un stepper.
 */
export function armarExamen(fichas, { cantidad, rand } = {}) {
  const total = fichas.length;
  if (!total) return [];
  const n = Number.isFinite(cantidad)
    ? Math.min(total, Math.max(1, Math.round(cantidad)))
    : total;
  return barajar(fichas, rand).slice(0, n);
}

/** El puntaje, en porcentaje entero. Sin preguntas no hay nota: 0. */
export function pct(correctas, total) {
  if (!total) return 0;
  return Math.round((correctas / total) * 100);
}

/**
 * La frase del final, según el tramo. Una sola voz y sin confeti: el número
 * ya dice cuánto fue; esto dice qué hacer con él.
 */
export function veredicto(p) {
  if (p === 100) return 'Impecable: ni una falla.';
  if (p >= 85) return 'Sólido — esto ya es casi tuyo.';
  if (p >= 70) return 'Bien, con huecos que el repaso va a cerrar.';
  if (p >= 50) return 'A medias: todavía se escapa bastante.';
  return 'Flojo por ahora. El repaso existe para esto.';
}

/**
 * El registro que va al historial: lo que un examen terminado deja en disco.
 *
 * Las falladas se guardan como TEXTO —el frente, cuál era, qué marcaste, la
 * explicación— y no como referencias: una ficha se puede editar o borrar
 * mañana, y el historial cuenta lo que pasó EN ese examen, no lo que las
 * fichas digan hoy. Un registro que apunta a fichas vivas se reescribe solo.
 *
 * El nombre del mazo viaja adentro por la misma razón: renombrar el mazo no
 * reescribe tu historia con él. `mazo: null` es el examen de todo.
 */
export function registro(ex, { nombre = null, now = Date.now() } = {}) {
  return {
    mazo: ex.mazoId || null,
    nombre,
    fecha: now,
    total: ex.cola.length,
    correctas: ex.correctas,
    falladas: ex.falladas.map(({ ficha: f, elegida }) => ({
      front: f.front,
      back: f.back || '',
      // En una básica no hay "cuál era": la respuesta ES el back.
      respuesta: esInteractiva(f) ? (opcionesDe(f)[indiceCorrecto(f)] ?? '') : null,
      elegida: esInteractiva(f) && elegida != null ? (opcionesDe(f)[elegida] ?? null) : null,
    })),
  };
}

/** El promedio del historial, en porcentaje entero. Un historial vacío no
    tiene promedio: 0. */
export function promedio(regs) {
  if (!regs.length) return 0;
  const suma = regs.reduce((n, r) => n + pct(r.correctas, r.total), 0);
  return Math.round(suma / regs.length);
}
