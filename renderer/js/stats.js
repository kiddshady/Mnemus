/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — estadísticas
   Los números detrás de los gráficos: actividad por día, racha, carga que
   viene, distribución de estados, notas de exámenes y las más olvidadas.

   Todo el calendario se camina con new Date(año, mes, día - i), nunca
   restando 86400000: el constructor normaliza días CALENDARIO y el cambio
   de hora no corre ningún día de lugar.

   Puro y sin DOM, como todo lo que decide algo: test/stats.test.mjs.
   ═══════════════════════════════════════════════════════════════════════════ */

import { esNueva, vencida, finDeHoy } from './srs.js';
import { pct } from './examen.js';

/** La clave calendario de un instante, en hora LOCAL: '20260822'. El estudio
    pasa en el día de la persona, no en el de Greenwich. */
export function claveDia(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** El día calendario que cae `i` días antes (o después, con negativo) de `ts`. */
function diaCorrido(ts, i) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
}

/**
 * La serie de actividad de los últimos `dias`, con los ceros puestos: un
 * gráfico que omite los días vacíos convierte una semana floja en una racha
 * apretada, y eso es mentirse.
 */
export function actividadPorDia(registros, { dias = 30, hoy = Date.now() } = {}) {
  const porDia = new Map(registros.map((r) => [r.dia, r]));
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = diaCorrido(hoy, i);
    const clave = claveDia(d.getTime());
    const r = porDia.get(clave);
    serie.push({ dia: clave, ts: d.getTime(), repasos: r?.repasos || 0, otraVez: r?.otraVez || 0 });
  }
  return serie;
}

/**
 * Días seguidos con repasos, contando hacia atrás. Si hoy todavía no
 * estudiaste, la racha de ayer sigue VIVA — el día no terminó y todavía se
 * puede salvar. Recién se corta cuando ayer tampoco hubo nada.
 */
export function racha(registros, hoy = Date.now()) {
  const con = new Set(registros.filter((r) => (r.repasos || 0) > 0).map((r) => r.dia));
  let desde = 0;
  if (!con.has(claveDia(hoy))) {
    if (!con.has(claveDia(diaCorrido(hoy, 1).getTime()))) return 0;
    desde = 1;
  }
  let n = 0;
  while (con.has(claveDia(diaCorrido(hoy, desde + n).getTime()))) n++;
  return n;
}

/**
 * Cuántas fichas vencen cada día de los próximos `dias`. Lo ya vencido cae
 * en HOY — la deuda no vive en el pasado: te espera hoy. Las nuevas no
 * cuentan: todavía no tienen fecha comprometida (el cupo diario decide).
 */
export function cargaProxima(fichas, { dias = 14, desde = Date.now() } = {}) {
  const serie = [];
  const porClave = new Map();
  for (let i = 0; i < dias; i++) {
    const d = diaCorrido(desde, -i);
    const item = { dia: claveDia(d.getTime()), ts: d.getTime(), vencen: 0 };
    serie.push(item);
    porClave.set(item.dia, item);
  }
  const hoyHasta = finDeHoy(desde);
  for (const f of fichas) {
    if (esNueva(f.srs) || !f.srs) continue;
    if (f.srs.due <= hoyHasta) { serie[0].vencen += 1; continue; }
    const item = porClave.get(claveDia(f.srs.due));
    if (item) item.vencen += 1;
  }
  return serie;
}

/** El estado del mazo entero, en cuatro números. La misma lectura que la
    marca de cada ficha, sumada. */
export function distribucion(fichas, hasta = finDeHoy()) {
  const d = { nuevas: 0, aprendiendo: 0, vencidas: 0, alDia: 0 };
  for (const f of fichas) {
    if (esNueva(f.srs)) d.nuevas += 1;
    else if (f.srs.reps === 0) d.aprendiendo += 1;
    else if (vencida(f.srs, hasta)) d.vencidas += 1;
    else d.alDia += 1;
  }
  return d;
}

/** Las fichas que más veces se olvidaron — las enemigas conocidas. Solo las
    que tienen al menos un olvido: una lista de ceros no acusa a nadie. */
export function masOlvidadas(fichas, { top = 5 } = {}) {
  return fichas
    .filter((f) => (f.srs?.lapses || 0) > 0)
    .sort((a, b) => (b.srs.lapses - a.srs.lapses) || String(a.front).localeCompare(String(b.front), 'es'))
    .slice(0, top);
}

/** Las notas del historial, en orden cronológico — la línea del progreso. */
export function notasExamenes(examenes) {
  return [...examenes]
    .sort((a, b) => (a.fecha || 0) - (b.fecha || 0))
    .map((e) => ({ fecha: e.fecha, nombre: e.nombre || null, nota: pct(e.correctas, e.total) }));
}
