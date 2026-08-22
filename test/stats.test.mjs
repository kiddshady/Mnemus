/* ═══════════════════════════════════════════════════════════════════════════
   Las estadísticas, contra fechas fijas: que la serie ponga sus ceros, que
   la racha viva y muera cuando corresponde, que la deuda caiga en HOY, y
   que el calendario se camine por días y no por 86400000 — el cambio de
   hora no puede correr un día de lugar.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  claveDia, actividadPorDia, racha, cargaProxima,
  distribucion, masOlvidadas, notasExamenes,
} from '../renderer/js/stats.js';
import { DIA } from '../renderer/js/srs.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const T0 = new Date('2026-08-22T15:00:00').getTime();     // sábado, media tarde
const dia = (n) => {
  const d = new Date(T0);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime();
};

console.log('\n1. La clave del día es local y calendaria');
ok('claveDia formatea AAAAMMDD', claveDia(T0) === '20260822', claveDia(T0));
ok('la medianoche menos uno sigue siendo ayer',
  claveDia(new Date('2026-08-21T23:59:59').getTime()) === '20260821');
ok('la medianoche en punto ya es hoy',
  claveDia(new Date('2026-08-22T00:00:00').getTime()) === '20260822');

console.log('\n2. La actividad pone sus ceros');
const regs = [
  { dia: '20260822', repasos: 12, otraVez: 3 },
  { dia: '20260820', repasos: 5, otraVez: 0 },
];
const serie = actividadPorDia(regs, { dias: 7, hoy: T0 });
ok('siete días, ni uno menos', serie.length === 7);
ok('termina hoy', serie[6].dia === '20260822');
ok('empieza hace seis', serie[0].dia === '20260816');
ok('los días con repasos traen sus números', serie[6].repasos === 12 && serie[4].repasos === 5);
ok('los días vacíos existen y valen cero', serie[5].repasos === 0 && serie[0].repasos === 0);

console.log('\n3. La racha vive hasta que ayer también falle');
ok('hoy con repasos: cuenta desde hoy',
  racha([{ dia: '20260822', repasos: 1 }, { dia: '20260821', repasos: 4 }], T0) === 2);
ok('hoy sin repasos pero ayer sí: la racha de ayer sigue viva',
  racha([{ dia: '20260821', repasos: 4 }, { dia: '20260820', repasos: 2 }], T0) === 2);
ok('ni hoy ni ayer: cero', racha([{ dia: '20260820', repasos: 9 }], T0) === 0);
ok('un hueco corta la cuenta',
  racha([{ dia: '20260822', repasos: 1 }, { dia: '20260820', repasos: 1 }], T0) === 1);
ok('un día con cero repasos no sostiene nada',
  racha([{ dia: '20260822', repasos: 0 }], T0) === 0);
ok('sin registros: cero', racha([], T0) === 0);

console.log('\n4. La deuda cae en hoy, el futuro en su día');
const srsCon = (due) => ({ reps: 3, interval: 10, ease: 2.5, due, lapses: 0 });
const fichas = [
  { id: 'a', srs: srsCon(dia(-5)) },              // vencida hace rato → hoy
  { id: 'b', srs: srsCon(T0 + 3600_000) },        // vence hoy mismo → hoy
  { id: 'c', srs: srsCon(dia(2)) },               // pasado mañana
  { id: 'd', srs: srsCon(dia(2)) },               // también
  { id: 'e', srs: srsCon(dia(20)) },              // fuera del horizonte
  { id: 'f', srs: { reps: 0, interval: 0, ease: 2.5, due: T0, lapses: 0 } },  // nueva: no cuenta
];
const carga = cargaProxima(fichas, { dias: 14, desde: T0 });
ok('catorce días', carga.length === 14);
ok('lo vencido y lo de hoy caen juntos en HOY', carga[0].vencen === 2, String(carga[0].vencen));
ok('pasado mañana espera a las suyas', carga[2].vencen === 2);
ok('lo de más allá del horizonte no aparece', carga.every((c, i) => i === 0 || i === 2 || c.vencen === 0));

console.log('\n5. La distribución suma como las marcas');
const pool = [
  { srs: { reps: 0, interval: 0, ease: 2.5, due: T0, lapses: 0 } },          // nueva
  { srs: { reps: 0, interval: 0, ease: 2.5, due: T0, lapses: 2 } },          // aprendiendo (falló)
  { srs: srsCon(T0 - DIA) },                                                  // vencida
  { srs: srsCon(dia(5)) },                                                    // al día
  { srs: srsCon(dia(6)) },                                                    // al día
];
const d = distribucion(pool, T0 + 8 * 3600_000);
ok('una nueva', d.nuevas === 1);
ok('una aprendiendo', d.aprendiendo === 1);
ok('una vencida', d.vencidas === 1);
ok('dos al día', d.alDia === 2);

console.log('\n6. Las más olvidadas');
const conLapses = [
  { front: 'B', srs: { ...srsCon(T0), lapses: 2 } },
  { front: 'A', srs: { ...srsCon(T0), lapses: 2 } },
  { front: 'C', srs: { ...srsCon(T0), lapses: 7 } },
  { front: 'D', srs: { ...srsCon(T0), lapses: 0 } },
];
const top = masOlvidadas(conLapses, { top: 2 });
ok('ordena por olvidos y corta', top.length === 2 && top[0].front === 'C');
ok('el empate desempata por texto, estable', top[1].front === 'A');
ok('sin olvidos no hay acusados', masOlvidadas([{ front: 'X', srs: srsCon(T0) }]).length === 0);

console.log('\n7. Las notas, en orden de rendida');
const notas = notasExamenes([
  { fecha: dia(-1), correctas: 1, total: 2, nombre: 'B' },
  { fecha: dia(-9), correctas: 9, total: 10, nombre: 'A' },
]);
ok('cronológico ascendente', notas[0].nombre === 'A' && notas[1].nombre === 'B');
ok('con la nota calculada', notas[0].nota === 90 && notas[1].nota === 50);

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
