/* ═══════════════════════════════════════════════════════════════════════════
   El motor SM-2, contra los números canónicos del algoritmo.

   Los intervalos 1 → 6 → round(6·ease) y las deltas de ease por calificación
   no son de gusto: son la definición de SM-2. Si este test falla después de
   "mejorar" algo en srs.js, lo que se rompió es la compatibilidad con el
   algoritmo, no el test.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  DIA, GRADOS, srsNueva, esNueva, calificar, simular,
  armarCola, barajar, porPrioridad, finDeHoy,
} from '../renderer/js/srs.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const T0 = new Date('2026-08-18T10:00:00').getTime();

console.log('\n1. La escalera canónica de intervalos');
let s = srsNueva(T0);
ok('nueva: reps 0, ease 2.5, vence ya', s.reps === 0 && s.ease === 2.5 && s.due === T0);
ok('y esNueva la reconoce', esNueva(s));

s = calificar(s, GRADOS.bien, T0);
ok('1ª bien → 1 día', s.interval === 1 && s.reps === 1, JSON.stringify(s));
ok('due = ahora + 1 día', s.due === T0 + DIA);
ok('bien no toca el ease', s.ease === 2.5, String(s.ease));

s = calificar(s, GRADOS.bien, T0 + DIA);
ok('2ª bien → 6 días', s.interval === 6 && s.reps === 2);

s = calificar(s, GRADOS.bien, T0 + 7 * DIA);
ok('3ª bien → round(6·2.5) = 15 días', s.interval === 15 && s.reps === 3, String(s.interval));

console.log('\n2. Las calificaciones mueven el ease como SM-2 manda');
let f = calificar(srsNueva(T0), GRADOS.facil, T0);
ok('fácil sube el ease +0.1', Math.abs(f.ease - 2.6) < 1e-9, String(f.ease));

let d = calificar(srsNueva(T0), GRADOS.dificil, T0);
ok('difícil baja el ease −0.14', Math.abs(d.ease - 2.36) < 1e-9, String(d.ease));
ok('difícil igual avanza (q ≥ 3)', d.reps === 1 && d.interval === 1);

let piso = { ...srsNueva(T0), ease: 1.31 };
piso = calificar(piso, GRADOS.dificil, T0);
ok('el ease tiene piso en 1.3', piso.ease === 1.3, String(piso.ease));

console.log('\n3. Olvidar duele pero no destruye');
let v = srsNueva(T0);
v = calificar(v, GRADOS.bien, T0);
v = calificar(v, GRADOS.bien, T0 + DIA);
const antesEase = v.ease;
v = calificar(v, GRADOS.otra, T0 + 3 * DIA);
ok('otra vez: reps a 0 y lapse anotado', v.reps === 0 && v.lapses === 1);
ok('vence AHORA (se re-encola en la sesión)', v.due === T0 + 3 * DIA);
ok('el ease no se toca al fallar (SM-2 canónico)', v.ease === antesEase);
ok('y ya no cuenta como nueva', !esNueva(v));

v = calificar(v, GRADOS.bien, T0 + 3 * DIA);
ok('recuperarla arranca la escalera de nuevo: 1 día', v.interval === 1 && v.reps === 1);

console.log('\n4. calificar no muta: devuelve una srs nueva');
const original = srsNueva(T0);
const copia = JSON.stringify(original);
calificar(original, GRADOS.bien, T0);
ok('la srs original quedó intacta', JSON.stringify(original) === copia);

console.log('\n5. simular espeja a calificar');
const base = calificar(calificar(srsNueva(T0), GRADOS.bien, T0), GRADOS.bien, T0 + DIA);
ok('simular(bien) = el intervalo que daría calificar', simular(base, GRADOS.bien, T0 + 7 * DIA) === 15);
ok('simular(otra) = 0 (misma sesión)', simular(base, GRADOS.otra, T0) === 0);

console.log('\n6. La cola del día');
const mk = (id, srs, createdAt = T0) => ({ id, mazo: 'm', srs, createdAt });
const vencidaVieja = mk('vv', { ...srsNueva(T0), reps: 3, interval: 6, due: T0 - 5 * DIA });
const vencidaHoy = mk('vh', { ...srsNueva(T0), reps: 1, interval: 1, due: T0 - 1000 });
const alDia = mk('ok', { ...srsNueva(T0), reps: 2, interval: 6, due: T0 + 4 * DIA });
const nuevas = Array.from({ length: 12 }, (_, i) => mk(`n${i}`, srsNueva(T0), T0 + i));

const cola = armarCola([alDia, vencidaHoy, ...nuevas, vencidaVieja], { nuevasPorDia: 10, now: T0 });
ok('las vencidas van primero, la más atrasada arriba', cola[0].id === 'vv' && cola[1].id === 'vh',
  cola.slice(0, 2).map((c) => c.id).join(','));
ok('la que está al día no entra', !cola.some((c) => c.id === 'ok'));
ok('las nuevas respetan el cupo diario', cola.filter((c) => c.id.startsWith('n')).length === 10, String(cola.length));
ok('y entran en orden de creación', cola[2].id === 'n0');

ok('finDeHoy queda adelante de ahora', finDeHoy(T0) > T0);

console.log('\n7. El modo azaroso baraja el orden, nunca el contenido');

/* Una fuente predecible en vez de Math.random: con esto el shuffle deja de ser
   "parece mezclado" y pasa a tener un resultado exacto que se puede afirmar. */
const fuente = (valores) => { let i = 0; return () => valores[i++ % valores.length]; };

const abc = ['a', 'b', 'c', 'd', 'e'];
const mezclado = barajar(abc, fuente([0, 0, 0, 0]));
ok('barajar no toca la lista original', abc.join('') === 'abcde');
ok('con rand=0 el barajado es exacto y predecible', mezclado.join('') === 'bcdea', mezclado.join(''));
ok('y no pierde ni duplica nada', [...mezclado].sort().join('') === 'abcde');

const pool = [alDia, vencidaHoy, ...nuevas, vencidaVieja];
const enOrden = armarCola(pool, { nuevasPorDia: 10, now: T0 });
const alAzar = armarCola(pool, { nuevasPorDia: 10, now: T0, azar: true, rand: fuente([0.7, 0.1, 0.4, 0.9, 0.2, 0.55]) });
ok('la cola al azar tiene exactamente las mismas fichas', alAzar.length === enOrden.length
  && alAzar.map((f) => f.id).sort().join() === enOrden.map((f) => f.id).sort().join());
ok('el cupo de nuevas se respeta igual', alAzar.filter((c) => c.id.startsWith('n')).length === 10);
ok('la que está al día sigue afuera', !alAzar.some((c) => c.id === 'ok'));
ok('y el orden cambió', alAzar.map((f) => f.id).join() !== enOrden.map((f) => f.id).join());

const revuelto = [nuevas[3], alDia, vencidaHoy, nuevas[0], vencidaVieja];
ok('porPrioridad reconstruye el orden natural',
  [...revuelto].sort(porPrioridad).map((f) => f.id).join() === 'vv,vh,ok,n0,n3',
  [...revuelto].sort(porPrioridad).map((f) => f.id).join());

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
