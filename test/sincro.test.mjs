/* ═══════════════════════════════════════════════════════════════════════════
   La sincronía con el celular, contra casos fijos. Lo que se mide son las
   tres promesas del encabezado de sincro.js: que un hecho aplicado dos veces
   cuente una sola (el reintento tras una respuesta perdida), que el resultado
   sea el mismo que calculó el celu cuando la PC no tocó nada, y que si la PC
   también repasó, las dos historias se sumen en vez de pisarse.
   ═══════════════════════════════════════════════════════════════════════════ */

import { instantanea, validarPaquete, aplicar, PROTOCOLO, RECUERDO } from '../renderer/js/sincro.js';
import { calificar, srsNueva, DIA } from '../renderer/js/srs.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T0 = new Date('2026-09-20T10:00:00').getTime();
const f1 = { id: 'f-0001', mazo: 'm-0001', front: 'Uno', back: 'A', srs: srsNueva(T0 - 5 * DIA), createdAt: T0 - 5 * DIA };
const f2 = { id: 'f-0002', mazo: 'm-0001', tipo: 'vf', front: 'Dos', back: 'B', correcta: 0, srs: srsNueva(T0 - 5 * DIA), createdAt: T0 - 5 * DIA };
const estado = { fichas: [f1, f2], actividad: [], examenes: [] };
const paquete = (repasos = [], examenes = []) => ({ protocolo: PROTOCOLO, repasos, examenes });

console.log('\n1. La forma del paquete');
ok('uno bien formado pasa', validarPaquete(paquete([{ id: 'r1', ficha: 'f-0001', q: 4, ts: T0 }])) === null);
ok('sin protocolo no', validarPaquete({ repasos: [], examenes: [] }) !== null);
ok('uno más nuevo pide actualizar la PC', /PC/.test(validarPaquete({ ...paquete(), protocolo: PROTOCOLO + 1 })));
ok('una q fuera de la escala no', validarPaquete(paquete([{ id: 'r1', ficha: 'f-0001', q: 2, ts: T0 }])) !== null);
ok('un repaso sin id no', validarPaquete(paquete([{ ficha: 'f-0001', q: 4, ts: T0 }])) !== null);
ok('un examen sin registro no', validarPaquete(paquete([], [{ id: 'e1' }])) !== null);

console.log('\n2. Sin cambios en la PC, el resultado es el del celu');
const r1 = { id: 'r1', ficha: 'f-0001', q: 4, ts: T0 };
const r2 = { id: 'r2', ficha: 'f-0001', q: 5, ts: T0 + 2 * DIA };
const enCelu = calificar(calificar(f1.srs, 4, T0), 5, T0 + 2 * DIA);
const res = aplicar(estado, paquete([r2, r1]), {}, { ahora: T0 + 3 * DIA });
ok('la srs es idéntica a la que calculó el celu', igual(res.fichas[0].srs, enCelu), JSON.stringify(res.fichas[0].srs));
ok('aunque los hechos lleguen desordenados', res.cuenta.repasos === 2);
ok('solo vuelve la ficha que cambió', res.fichas.length === 1 && res.fichas[0].id === 'f-0001');
ok('y no muta el estado de entrada', igual(f1.srs, srsNueva(T0 - 5 * DIA)));

console.log('\n3. El reintento no cuenta dos veces');
const otra = aplicar({ ...estado, fichas: res.fichas.concat(f2), actividad: res.actividad }, paquete([r1, r2]), res.aplicados, { ahora: T0 + 3 * DIA });
ok('los dos repasos se reconocen', otra.cuenta.repetidos === 2 && otra.cuenta.repasos === 0);
ok('y no toca ninguna ficha', otra.fichas.length === 0);
ok('ni la actividad', otra.actividad.length === 0);

console.log('\n4. Si la PC también repasó, las historias se suman');
const enPc = { ...f1, srs: calificar(f1.srs, 4, T0 - DIA) };   // la PC la estudió ayer
const suma = aplicar({ ...estado, fichas: [enPc, f2] }, paquete([r1]), {}, { ahora: T0 });
ok('el repaso del celu se aplica ENCIMA del de la PC',
  igual(suma.fichas[0].srs, calificar(enPc.srs, 4, T0)), JSON.stringify(suma.fichas[0].srs));
ok('dos repeticiones seguidas, no una', suma.fichas[0].srs.reps === 2);

console.log('\n5. La actividad por día');
const act = aplicar(estado, paquete([
  { id: 'a', ficha: 'f-0001', q: 0, ts: T0 },
  { id: 'b', ficha: 'f-0002', q: 4, ts: T0 + 60_000 },
  { id: 'c', ficha: 'f-0002', q: 4, ts: T0 + DIA },
]), {}, { ahora: T0 + DIA });
const hoy = act.actividad.find((a) => a.dia === '20260920');
ok('suma los repasos del día', hoy?.repasos === 2, JSON.stringify(act.actividad));
ok('y cuenta los «otra vez»', hoy?.otraVez === 1);
ok('con el id del diario de siempre', hoy?.id === 'd-20260920');
ok('el día siguiente va aparte', act.actividad.find((a) => a.dia === '20260921')?.repasos === 1);
const conPrevio = aplicar({ ...estado, actividad: [{ id: 'd-20260920', dia: '20260920', repasos: 7, otraVez: 2 }] },
  paquete([{ id: 'z', ficha: 'f-0001', q: 4, ts: T0 }]), {}, { ahora: T0 });
ok('se suma a lo que ya había en la PC', conPrevio.actividad[0].repasos === 8 && conPrevio.actividad[0].otraVez === 2);

console.log('\n6. Fichas que ya no existen');
const huerf = aplicar(estado, paquete([{ id: 'h', ficha: 'f-9999', q: 4, ts: T0 }]), {}, { ahora: T0 });
ok('el repaso de una ficha borrada no rompe nada', huerf.cuenta.huerfanos === 1 && huerf.fichas.length === 0);
ok('pero la actividad sí cuenta: el repaso pasó', huerf.actividad[0]?.repasos === 1);

console.log('\n7. Los exámenes');
const reg = { mazo: 'm-0001', nombre: 'Humo', fecha: T0, total: 2, correctas: 1, falladas: [] };
const ex = aplicar(estado, paquete([], [{ id: 'e-celu-1', registro: reg }]), {}, { ahora: T0 });
ok('entra el registro, marcado con su origen', ex.examenes.length === 1 && ex.examenes[0].origen === 'e-celu-1');
ok('sin id propio: lo asigna quien guarda', !('id' in ex.examenes[0]));
const exOtra = aplicar({ ...estado, examenes: [{ ...ex.examenes[0], id: 'e-0007' }] },
  paquete([], [{ id: 'e-celu-1', registro: reg }]), {}, { ahora: T0 });
ok('el reintento lo reconoce por su origen', exOtra.examenes.length === 0 && exOtra.cuenta.repetidos === 1);

console.log('\n8. La poda de lo aplicado');
const viejo = aplicar(estado, paquete([{ id: 'nuevo', ficha: 'f-0001', q: 4, ts: T0 }]),
  { antiquisimo: T0 - RECUERDO - DIA, reciente: T0 - DIA }, { ahora: T0 });
ok('se olvida lo aplicado hace más de 90 días', !('antiquisimo' in viejo.aplicados));
ok('y se recuerda lo reciente', 'reciente' in viejo.aplicados && 'nuevo' in viejo.aplicados);
const tardio = aplicar(estado, paquete([{ id: 'tardio', ficha: 'f-0001', q: 4, ts: T0 - 200 * DIA }]), {}, { ahora: T0 });
ok('un repaso viejo que llega hoy se recuerda desde hoy', tardio.aplicados.tardio === T0);

console.log('\n9. La instantánea');
const S = {
  settings: { nuevasPorDia: 15, azar: true },
  carpetas: [{ id: 'c-0001', name: 'Farmaco', createdAt: 1 }],
  mazos: [{ id: 'm-0001', name: 'SNA', carpeta: 'c-0001', updatedAt: 2 }],
  fichas: [f1, { ...f2, srs: undefined }],
  examenes: [{ id: 'e-0001', total: 1, correctas: 1, falladas: [] }],
  actividad: [{ id: 'd-20260920', dia: '20260920', repasos: 3, otraVez: 1 }],
};
const snap = instantanea(S, { ahora: T0, version: '0.11.0' });
ok('declara el protocolo', snap.protocolo === PROTOCOLO);
ok('lleva los ajustes del repaso', snap.ajustes.nuevasPorDia === 15 && snap.ajustes.azar === true);
ok('los mazos con su carpeta', snap.mazos[0].carpeta === 'c-0001');
ok('una ficha sin srs sale como nueva', snap.fichas[1].srs?.reps === 0 && snap.fichas[1].srs?.ease === 2.5);
ok('la vf conserva su correcta', snap.fichas[1].correcta === 0 && snap.fichas[1].tipo === 'vf');
ok('una básica sale con su tipo explícito', snap.fichas[0].tipo === 'basica');
ok('y el historial viaja', snap.examenes.length === 1 && snap.actividad[0].repasos === 3);

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
