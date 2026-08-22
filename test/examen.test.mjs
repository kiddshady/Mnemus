/* ═══════════════════════════════════════════════════════════════════════════
   El examen, en lo que se puede afirmar sin pantalla: que el cuestionario es
   una muestra al azar del tamaño pedido, que el puntaje es la división que
   dice ser, y que el veredicto cae en el tramo que corresponde.

   El `rand` inyectado vuelve exacto el barajado (misma técnica que en
   srs.test.mjs): con una fuente predecible, "parece mezclado" se convierte
   en una igualdad que falla o no falla.
   ═══════════════════════════════════════════════════════════════════════════ */

import { armarExamen, pct, veredicto, registro, promedio } from '../renderer/js/examen.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const fichas = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}` }));
const ids = (l) => l.map((f) => f.id).join();

console.log('\n1. El cuestionario es una muestra, no un prefijo');
// rand constante en 0: Fisher-Yates con j=0 siempre — permutación conocida.
const cero = () => 0;
const todo = armarExamen(fichas, { rand: cero });
ok('sin cantidad entran todas', todo.length === 8);
ok('barajadas (no en el orden de carga)', ids(todo) !== ids(fichas), ids(todo));
ok('sin repetidas ni faltantes', new Set(todo.map((f) => f.id)).size === 8);

const cinco = armarExamen(fichas, { cantidad: 5, rand: cero });
ok('cantidad corta el mazo', cinco.length === 5);
ok('y corta DESPUÉS de barajar (muestra al azar)',
  ids(cinco) === ids(armarExamen(fichas, { rand: cero }).slice(0, 5)), ids(cinco));

console.log('\n2. La cantidad no confía en el stepper');
ok('más que el total → total', armarExamen(fichas, { cantidad: 99 }).length === 8);
ok('cero → una', armarExamen(fichas, { cantidad: 0 }).length === 1);
ok('negativa → una', armarExamen(fichas, { cantidad: -3 }).length === 1);
ok('no numérica → todas', armarExamen(fichas, { cantidad: 'todas' }).length === 8);
ok('pool vacío → examen vacío', armarExamen([], { cantidad: 5 }).length === 0);
ok('el pool original no se muta', ids(fichas) === 'f0,f1,f2,f3,f4,f5,f6,f7');

console.log('\n3. El puntaje es la división que dice ser');
ok('8 de 10 → 80', pct(8, 10) === 80);
ok('redondea al entero (2 de 3 → 67)', pct(2, 3) === 67);
ok('todo bien → 100', pct(5, 5) === 100);
ok('todo mal → 0', pct(0, 5) === 0);
ok('sin preguntas no hay nota', pct(0, 0) === 0);

console.log('\n4. El veredicto cae en su tramo');
ok('100 es impecable', veredicto(100).startsWith('Impecable'));
ok('99 ya no', !veredicto(99).startsWith('Impecable'));
ok('85 es sólido', veredicto(85).startsWith('Sólido'));
ok('84 baja de tramo', !veredicto(84).startsWith('Sólido'));
ok('70 está bien', veredicto(70).startsWith('Bien'));
ok('50 va a medias', veredicto(50).startsWith('A medias'));
ok('49 es flojo', veredicto(49).startsWith('Flojo'));
ok('0 también', veredicto(0).startsWith('Flojo'));

console.log('\n5. El registro del historial es texto, no referencias');
const T0 = new Date('2026-08-22T10:00:00').getTime();
const basica = { id: 'f1', front: '¿Qué válvula?', back: 'La mitral.' };
const mc = { id: 'f2', tipo: 'opcion', front: '¿Marcapasos?', back: 'El sinusal manda.', opciones: ['El AV', 'El His', 'El sinusal'], correcta: 2 };
const vf = { id: 'f3', tipo: 'vf', front: 'Afirmación.', back: 'Al revés.', correcta: 1 };
const ex = {
  mazoId: 'm-0001',
  cola: [basica, mc, vf],
  correctas: 1,
  falladas: [
    { ficha: mc, elegida: 0 },        // marcó «El AV»
    { ficha: vf, elegida: null },     // la dejó pasar
  ],
};
const reg = registro(ex, { nombre: 'Cardio', now: T0 });
ok('lleva el mazo y su nombre de ese momento', reg.mazo === 'm-0001' && reg.nombre === 'Cardio');
ok('la fecha es la del examen', reg.fecha === T0);
ok('las cifras: 1 de 3', reg.correctas === 1 && reg.total === 3);
ok('la fallada elegida guarda TEXTOS, no índices',
  reg.falladas[0].respuesta === 'El sinusal' && reg.falladas[0].elegida === 'El AV',
  JSON.stringify(reg.falladas[0]));
ok('y se lleva la explicación', reg.falladas[0].back === 'El sinusal manda.');
ok('la dejada pasar queda sin elección', reg.falladas[1].elegida === null);
ok('en la de V/F la respuesta también es texto', reg.falladas[1].respuesta === 'Falso', reg.falladas[1].respuesta);
ok('sin ids de ficha adentro: el historial no apunta a nada vivo',
  !('id' in reg.falladas[0]) && !('ficha' in reg.falladas[0]));
ok('el examen de todo va con mazo null',
  registro({ ...ex, mazoId: null }, { now: T0 }).mazo === null);

const basicaFallada = registro({ ...ex, falladas: [{ ficha: basica, elegida: null }] }, { now: T0 }).falladas[0];
ok('en una básica no hay "cuál era": la respuesta es el back',
  basicaFallada.respuesta === null && basicaFallada.back === 'La mitral.');

console.log('\n6. El promedio del historial');
ok('vacío no tiene promedio: 0', promedio([]) === 0);
ok('uno solo es su propia nota', promedio([{ correctas: 1, total: 2 }]) === 50);
ok('promedia las notas, no las fichas',
  promedio([{ correctas: 1, total: 2 }, { correctas: 100, total: 100 }]) === 75);
ok('y redondea al entero', promedio([{ correctas: 1, total: 3 }, { correctas: 2, total: 3 }]) === 50,
  String(promedio([{ correctas: 1, total: 3 }, { correctas: 2, total: 3 }])));

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
