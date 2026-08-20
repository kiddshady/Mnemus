/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — repaso espaciado (SM-2)
   El motor de la app: decide CUÁNDO volvés a ver cada ficha. Es SM-2 clásico,
   sin inventos — el algoritmo está probado por décadas de Anki/SuperMemo y
   cada desviación "intuitiva" que se le mete lo suele empeorar.

   Puro y sin DOM a propósito: se testea con node pelado (test/srs.test.mjs).

   El modelo por ficha (`ficha.srs`):
     reps     repeticiones exitosas consecutivas (0 = nueva o recién fallada)
     interval días hasta el próximo repaso (0 = hoy mismo, en esta sesión)
     ease     factor de facilidad (arranca 2.5, piso 1.3)
     due      timestamp de vencimiento
     lapses   cuántas veces se olvidó (reps ≥ 1 → «Otra vez»)
   ═══════════════════════════════════════════════════════════════════════════ */

export const DIA = 86_400_000;

/** Las cuatro calificaciones, en la escala q de SM-2. */
export const GRADOS = { otra: 0, dificil: 3, bien: 4, facil: 5 };

export function srsNueva(now = Date.now()) {
  return { reps: 0, interval: 0, ease: 2.5, due: now, lapses: 0 };
}

/** Nunca estudiada: ni una repetición ni un olvido encima. */
export function esNueva(srs) {
  return !srs || (srs.reps === 0 && srs.lapses === 0);
}

/** ¿Vence dentro del día? (las que ya vencieron también cuentan) */
export function vencida(srs, hastaTs) {
  return !!srs && srs.due <= hastaTs;
}

/** El fin del día LOCAL: la frontera de "para hoy". */
export function finDeHoy(now = Date.now()) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Aplica una calificación q (0–5; acá llegan 0, 3, 4 o 5) y devuelve la srs
 * NUEVA — nunca muta la que recibió, así el que llama decide cuándo persistir.
 *
 * q < 3 («Otra vez»): la ficha se olvidó. Vuelve a reps 0 con due AHORA:
 * queda vencida y la sesión la re-encola. El ease NO se toca al fallar —
 * eso es SM-2 canónico: el castigo es volver a empezar, no endurecer el
 * factor (para eso está «Difícil», que sí lo baja).
 */
export function calificar(srs, q, now = Date.now()) {
  const s = { ...srs };

  if (q < 3) {
    s.reps = 0;
    s.interval = 0;
    s.lapses += 1;
    s.due = now;
    return s;
  }

  s.ease = Math.max(1.3, s.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  s.reps += 1;
  if (s.reps === 1) s.interval = 1;
  else if (s.reps === 2) s.interval = 6;
  else s.interval = Math.round(s.interval * s.ease);
  s.due = now + s.interval * DIA;
  return s;
}

/** Cuánto quedaría el intervalo con cada calificación — para mostrarlo en los
    botones sin duplicar la matemática de arriba. */
export function simular(srs, q, now = Date.now()) {
  const s = calificar(srs || srsNueva(now), q, now);
  return s.interval;
}

/**
 * El orden natural de la cola, como comparador: lo vencido antes que lo nuevo,
 * y adentro de cada grupo lo más urgente arriba — la deuda más vieja primero,
 * el material nuevo en el orden en que lo cargaste.
 *
 * Vive suelto porque la sesión también lo necesita: al apagar el modo azaroso
 * en el medio del repaso hay que devolverle este orden a lo que falta, sin
 * volver a armar la cola desde cero (ver `barajar`).
 */
export function porPrioridad(a, b) {
  const na = esNueva(a.srs);
  const nb = esNueva(b.srs);
  if (na !== nb) return na ? 1 : -1;
  if (na) return (a.createdAt || 0) - (b.createdAt || 0);
  return a.srs.due - b.srs.due;
}

/**
 * Devuelve una COPIA barajada — Fisher-Yates, que es el único shuffle que
 * reparte parejo. (El `sort(() => Math.random() - .5)` que se ve por ahí no:
 * el comparador incoherente le rompe el invariante al algoritmo de orden y
 * las permutaciones salen sesgadas.)
 *
 * `rand` se inyecta para poder testearlo: con una fuente predecible el
 * resultado es exacto y deja de ser "mirá, parece random".
 */
export function barajar(lista, rand = Math.random) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Arma la cola de una sesión: vencidas primero (la más atrasada arriba) y
 * después nuevas hasta el cupo diario. Las nuevas van al final a propósito:
 * lo que ya está en riesgo de olvidarse le gana a lo que todavía no entró.
 *
 * Con `azar`, la cola se baraja ENTERA después de armarse — vencidas y nuevas
 * mezcladas. El cupo y el filtro de qué entra no cambian: el azar decide el
 * orden, nunca el contenido. Sirve contra el efecto de orden (recordar la
 * respuesta porque venía después de la otra, no porque la sepas) al precio de
 * perder la prioridad: si cortás la sesión a la mitad, lo que quede sin
 * repasar es un recorte al azar y no lo menos urgente.
 */
export function armarCola(fichas, { nuevasPorDia = 10, azar = false, rand, now = Date.now() } = {}) {
  const hasta = finDeHoy(now);
  const vencidas = fichas
    .filter((f) => !esNueva(f.srs) && vencida(f.srs, hasta))
    .sort(porPrioridad);
  const nuevas = fichas
    .filter((f) => esNueva(f.srs))
    .sort(porPrioridad)
    .slice(0, Math.max(0, nuevasPorDia));
  const cola = [...vencidas, ...nuevas];
  return azar ? barajar(cola, rand) : cola;
}

/** Resumen para el inicio y la statusbar: cuántas hay para hoy. El orden no le
    importa a un número, así que nunca baraja — es la misma cuenta con azar o
    sin él, y este se llama en cada repintado del chrome. */
export function paraHoy(fichas, opts) {
  return armarCola(fichas, { ...opts, azar: false }).length;
}
