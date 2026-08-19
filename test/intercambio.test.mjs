/* ═══════════════════════════════════════════════════════════════════════════
   Importar y exportar mazos.

   El test que más importa es el del VIAJE COMPLETO: exportar y volver a
   importar tiene que devolver las mismas fichas. Un formato que pierde un
   campo en el camino no da error — da un mazo silenciosamente incompleto del
   otro lado, en la máquina de otra persona, donde nadie lo va a notar hasta
   que la respuesta correcta esté mal.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  FORMATO, VERSION,
  empaquetar, validar, desempaquetar, resumen, traeProgreso, nombreArchivo,
} from '../renderer/js/intercambio.js';
import { tipoDe, opcionesDe, indiceCorrecto } from '../renderer/js/ficha.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const T0 = new Date('2026-08-19T10:00:00Z').getTime();

const MAZOS = [
  { id: 'm-0003', name: 'Sistema nervioso simpático', createdAt: 1, updatedAt: 2 },
  { id: 'm-0009', name: 'Otro mazo', createdAt: 1, updatedAt: 1 },
];
const FICHAS = [
  { id: 'f-0001', mazo: 'm-0003', front: '¿Origen del simpático?', back: 'T1 a L2.',
    srs: { reps: 3, interval: 15, ease: 2.5, due: T0, lapses: 1 }, createdAt: 5, updatedAt: 6 },
  { id: 'f-0002', mazo: 'm-0003', tipo: 'opcion', front: '¿Qué receptor broncodilata?',
    back: 'El β2.', opciones: ['α1', 'β1', 'β2', 'M3'], correcta: 2,
    srs: { reps: 0, interval: 0, ease: 2.5, due: T0, lapses: 0 }, createdAt: 7, updatedAt: 8 },
  { id: 'f-0003', mazo: 'm-0003', tipo: 'vf', front: 'El simpático relaja el esfínter interno.',
    back: 'Falso: lo contrae.', correcta: 1,
    srs: { reps: 1, interval: 1, ease: 2.6, due: T0, lapses: 0 }, createdAt: 9, updatedAt: 10 },
  { id: 'f-0004', mazo: 'm-0009', front: 'De otro mazo', back: 'no debería viajar', srs: { reps: 0, interval: 0, ease: 2.5, due: 0, lapses: 0 } },
];

console.log('\n1. Empaquetar: qué viaja y qué no');
const paquete = empaquetar([MAZOS[0]], FICHAS, { app: '0.1.0', ahora: T0 });
ok('declara formato y versión', paquete.formato === FORMATO && paquete.version === VERSION);
ok('trae un solo mazo', paquete.mazos.length === 1 && paquete.mazos[0].name === 'Sistema nervioso simpático');
ok('con sus 3 fichas, y NO la del otro mazo', paquete.mazos[0].fichas.length === 3);
ok('las fichas no llevan id', paquete.mazos[0].fichas.every((f) => f.id === undefined));
ok('ni la referencia al mazo de origen', paquete.mazos[0].fichas.every((f) => f.mazo === undefined));
ok('ni fechas locales', paquete.mazos[0].fichas.every((f) => f.createdAt === undefined && f.updatedAt === undefined));
ok('pero sí el progreso', paquete.mazos[0].fichas[0].srs.reps === 3);
ok('la fecha de exportación es ISO', paquete.exportado === new Date(T0).toISOString());
ok('sobrevive a JSON.stringify/parse', JSON.parse(JSON.stringify(paquete)).mazos[0].fichas.length === 3);

console.log('\n2. El viaje completo: exportar → importar');
const vuelta = desempaquetar(JSON.parse(JSON.stringify(paquete)), { conProgreso: true, ahora: T0 });
const originales = FICHAS.filter((f) => f.mazo === 'm-0003');
ok('vuelve el mismo mazo', vuelta.length === 1 && vuelta[0].name === 'Sistema nervioso simpático');
ok('y la misma cantidad de fichas', vuelta[0].fichas.length === 3);
for (const [i, f] of vuelta[0].fichas.entries()) {
  const o = originales[i];
  ok(`ficha ${i + 1}: mismo frente y dorso`, f.front === o.front && f.back === o.back);
  ok(`ficha ${i + 1}: mismo tipo (${tipoDe(o)})`, tipoDe(f) === tipoDe(o));
  ok(`ficha ${i + 1}: mismas alternativas`, opcionesDe(f).join('|') === opcionesDe(o).join('|'));
  ok(`ficha ${i + 1}: misma correcta`, indiceCorrecto(f) === indiceCorrecto(o));
}
ok('con conProgreso, el historial llega intacto',
  vuelta[0].fichas[0].srs.reps === 3 && vuelta[0].fichas[0].srs.lapses === 1);

console.log('\n3. Sin progreso (el caso de pasarle el mazo a alguien)');
const limpio = desempaquetar(paquete, { conProgreso: false, ahora: T0 });
ok('todas entran como nuevas', limpio[0].fichas.every((f) => f.srs.reps === 0 && f.srs.lapses === 0));
ok('con ease de fábrica', limpio[0].fichas.every((f) => f.srs.ease === 2.5));
ok('y vencen ya, para poder empezar hoy', limpio[0].fichas.every((f) => f.srs.due === T0));
ok('pero el contenido no cambió', limpio[0].fichas[1].opciones.join('|') === 'α1|β1|β2|M3');

console.log('\n4. Validar lo que viene de afuera');
ok('un paquete bien formado pasa', validar(paquete) === null);
ok('null no pasa', validar(null) !== null);
ok('un JSON de otra app no pasa', validar({ decks: [] }) !== null);
ok('sin formato no pasa', validar({ version: 1, mazos: [] }) !== null);
ok('sin mazos no pasa', validar({ formato: FORMATO, version: 1, mazos: [] }) !== null);
ok('un mazo sin nombre no pasa',
  validar({ formato: FORMATO, version: 1, mazos: [{ name: '  ', fichas: [] }] }) !== null);
ok('una ficha inválida no pasa (opción sin correcta)',
  validar({ formato: FORMATO, version: 1, mazos: [{ name: 'X', fichas: [
    { tipo: 'opcion', front: 'a', back: 'b', opciones: ['1', '2'] }] }] }) !== null);
ok('el mensaje dice en qué mazo está el problema',
  /«X»/.test(validar({ formato: FORMATO, version: 1, mazos: [{ name: 'X', fichas: [
    { tipo: 'opcion', front: 'a', back: 'b', opciones: ['1', '2'] }] }] }) || ''));

/* Un formato del futuro tiene que dar un mensaje que diga QUÉ hacer. Si dice
   solo "archivo inválido", el que lo recibe cree que el archivo está roto y
   lo borra, cuando en realidad solo tiene que actualizar la app. */
const futuro = { ...paquete, version: VERSION + 1 };
ok('un archivo de una versión más nueva se rechaza', validar(futuro) !== null);
ok('y el mensaje pide actualizar, no dice que está roto', /[Aa]ctualiz/.test(validar(futuro)));

console.log('\n5. El resumen que se muestra antes de importar');
const r = resumen(paquete);
ok('cuenta los mazos', r.mazos === 1);
ok('cuenta las fichas', r.fichas === 3);
ok('las agrupa por tipo', r.porTipo.basica === 1 && r.porTipo.opcion === 1 && r.porTipo.vf === 1, JSON.stringify(r.porTipo));
ok('avisa que trae progreso', r.conProgreso === true);
ok('y lista los nombres', r.nombres[0] === 'Sistema nervioso simpático');

const sinProgreso = empaquetar([MAZOS[1]], FICHAS, { ahora: T0 });
ok('un mazo sin repasos no dice traer progreso', traeProgreso(sinProgreso) === false);

console.log('\n6. El nombre del archivo');
ok('un mazo lleva su nombre', nombreArchivo([{ name: 'Simpático' }]) === 'Mnemus - Simpático.json');
ok('varios se cuentan', nombreArchivo([{ name: 'a' }, { name: 'b' }]) === 'Mnemus - 2 mazos.json');
ok('los caracteres que Windows prohíbe se van',
  nombreArchivo([{ name: 'Farma: dosis/kg <urgente>' }]) === 'Mnemus - Farma dosiskg urgente.json');
ok('un nombre larguísimo se recorta', nombreArchivo([{ name: 'x'.repeat(200) }]).length < 80);

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
