/* ═══════════════════════════════════════════════════════════════════════════
   Las carpetas, en lo que se puede afirmar sin pantalla: que los grupos
   salen en el orden prometido, que nada se pierde, y que un JSON roto a
   mano degrada a la raíz en vez de desaparecer mazos.
   ═══════════════════════════════════════════════════════════════════════════ */

import { agrupar } from '../renderer/js/carpetas.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const carpetas = [
  { id: 'c-0002', name: 'neuro' },
  { id: 'c-0001', name: 'Anatomía' },
  { id: 'c-0003', name: 'Fármacos' },
];
const mazos = [
  { id: 'm1', name: 'Corazón', carpeta: 'c-0001' },
  { id: 'm2', name: 'Suelto' },
  { id: 'm3', name: 'Pares craneales', carpeta: 'c-0002' },
  { id: 'm4', name: 'Miembro superior', carpeta: 'c-0001' },
  { id: 'm5', name: 'Huérfano', carpeta: 'c-borrada' },
];

console.log('\n1. Los grupos salen en el orden prometido');
const g = agrupar(mazos, carpetas);
ok('una sección por carpeta, más la raíz', g.length === 4, String(g.length));
ok('las carpetas van alfabéticas, sin distinguir mayúsculas',
  g.slice(0, 3).map((x) => x.carpeta.name).join() === 'Anatomía,Fármacos,neuro',
  g.slice(0, 3).map((x) => x.carpeta.name).join());
ok('la raíz va última', g[3].carpeta === null);
ok('cada mazo cae en su carpeta', g[0].mazos.map((m) => m.id).join() === 'm1,m4');
ok('los mazos conservan el orden en que llegan (no se reordenan)',
  g[0].mazos[0].id === 'm1' && g[0].mazos[1].id === 'm4');

console.log('\n2. Nada se pierde, nada se inventa');
ok('todos los mazos quedan en algún grupo',
  g.reduce((n, x) => n + x.mazos.length, 0) === mazos.length);
ok('el de carpeta inexistente cae a la raíz, no desaparece',
  g[3].mazos.some((m) => m.id === 'm5'));
ok('el suelto también está en la raíz', g[3].mazos.some((m) => m.id === 'm2'));
ok('no muta la lista de carpetas', carpetas[0].id === 'c-0002');

console.log('\n3. Los bordes');
const vacia = agrupar(mazos.slice(0, 1), [{ id: 'c-9', name: 'Vacía' }, { id: 'c-0001', name: 'Anatomía' }]);
ok('una carpeta vacía aparece igual (hay que poder llenarla)',
  vacia.some((x) => x.carpeta?.name === 'Vacía' && x.mazos.length === 0));
ok('sin sueltos no hay sección raíz', !vacia.some((x) => x.carpeta === null));
const plano = agrupar(mazos.slice(0, 2).map(({ carpeta, ...m }) => m), []);
ok('sin carpetas: un solo grupo raíz con todo', plano.length === 1 && plano[0].carpeta === null && plano[0].mazos.length === 2);
ok('sin nada: la raíz vacía existe (la vista decide qué mostrar)',
  agrupar([], []).length === 1);

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
