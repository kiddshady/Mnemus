/* ═══════════════════════════════════════════════════════════════════════════
   Los tipos de ficha: normalización, validación y corrección.

   Lo que más cuida este test es la RETROCOMPATIBILIDAD: las fichas escritas
   antes de que existieran los tipos no tienen el campo, y tienen que seguir
   comportándose como básicas para siempre. Si eso se rompe, un mazo viejo
   deja de repasarse — y el que lo cargó no hizo nada mal.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GRADOS } from '../renderer/js/srs.js';
import {
  TIPOS, OPCIONES_VF, MAX_OPCIONES,
  tipoDe, opcionesDe, esInteractiva, indiceCorrecto, letra,
  gradoSugerido, validar, normalizar,
} from '../renderer/js/ficha.js';

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const opcion = (extra = {}) => ({
  front: '¿Qué receptor media la broncodilatación?',
  back: 'El β2 relaja el músculo liso bronquial.',
  tipo: 'opcion',
  opciones: ['α1', 'β1', 'β2', 'M3'],
  correcta: 2,
  ...extra,
});
const vf = (extra = {}) => ({
  front: 'El nervio vago aporta la mayoría de las fibras parasimpáticas.',
  back: 'Verdadero: cerca del 75%.',
  tipo: 'vf',
  correcta: 0,
  ...extra,
});

console.log('\n1. Retrocompatibilidad: lo viejo sigue siendo básico');
ok('una ficha sin tipo es básica', tipoDe({ front: 'a', back: 'b' }) === 'basica');
ok('un tipo desconocido también cae en básica', tipoDe({ tipo: 'trivia' }) === 'basica');
ok('tipoDe aguanta null sin explotar', tipoDe(null) === 'basica');
ok('una básica no tiene opciones', opcionesDe({ front: 'a', back: 'b' }).length === 0);
ok('y no es interactiva', !esInteractiva({ front: 'a', back: 'b' }));
ok('una básica valida con solo frente y dorso', validar({ front: 'a', back: 'b' }) === null);

console.log('\n2. Verdadero/falso: las opciones son implícitas');
ok('siempre las mismas dos', opcionesDe(vf()).join('|') === OPCIONES_VF.join('|'));
ok('correcta 0 es Verdadero', indiceCorrecto(vf({ correcta: 0 })) === 0);
ok('correcta 1 es Falso', indiceCorrecto(vf({ correcta: 1 })) === 1);
ok('un índice fuera de rango no es correcto', indiceCorrecto(vf({ correcta: 2 })) === -1);
ok('y eso lo rechaza validar', validar(vf({ correcta: 2 })) !== null);
ok('normalizar NO guarda las opciones de una vf', normalizar(vf()).opciones === undefined);
ok('unas opciones inventadas en el JSON se ignoran',
  opcionesDe(vf({ opciones: ['Sí', 'No'] })).join('|') === OPCIONES_VF.join('|'));

console.log('\n3. Opción múltiple');
ok('valida una bien formada', validar(opcion()) === null);
ok('devuelve sus alternativas', opcionesDe(opcion()).length === 4);
ok('el índice correcto es el que dice', indiceCorrecto(opcion()) === 2);
ok('con una sola alternativa no valida', validar(opcion({ opciones: ['única'], correcta: 0 })) !== null);
ok(`con más de ${MAX_OPCIONES} tampoco`,
  validar(opcion({ opciones: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], correcta: 0 })) !== null);
ok('una alternativa vacía no pasa', validar(opcion({ opciones: ['α1', '  ', 'β2', 'M3'] })) !== null);
ok('dos repetidas no pasan', validar(opcion({ opciones: ['β2', 'β1', 'β2', 'M3'] })) !== null);
ok('repetidas aunque cambie el caso',
  validar(opcion({ opciones: ['Adrenalina', 'Noradrenalina', 'ADRENALINA', 'Dopamina'] })) !== null);
ok('sin correcta no pasa', validar(opcion({ correcta: undefined })) !== null);
ok('una correcta que apunta afuera no pasa', validar(opcion({ correcta: 9 })) !== null);
ok('la explicación es obligatoria', validar(opcion({ back: '   ' })) !== null);

console.log('\n4. Las etiquetas');
ok('la primera opción es A', letra(0) === 'A');
ok('la cuarta es D', letra(3) === 'D');

console.log('\n5. El grado sugerido');
ok('acertar sugiere Bien, no Fácil', gradoSugerido(true) === GRADOS.bien);
ok('errar manda a Otra vez', gradoSugerido(false) === GRADOS.otra);

console.log('\n6. Normalizar deja el JSON sin restos del tipo anterior');
const aBasica = normalizar({ ...opcion(), tipo: 'basica' });
ok('pasar de opción a básica borra las alternativas', aBasica.opciones === undefined);
ok('y borra la correcta', aBasica.correcta === undefined);
const limpia = normalizar({ ...opcion(), front: '  con espacios  ', back: '  y acá también  ' });
ok('recorta el frente y el dorso', limpia.front === 'con espacios' && limpia.back === 'y acá también');
ok('recorta también cada alternativa',
  normalizar(opcion({ opciones: [' α1', 'β1 ', ' β2 ', 'M3'] })).opciones[2] === 'β2');
ok('conserva el id y la srs intactos',
  normalizar({ ...opcion(), id: 'f-0001', srs: { reps: 3 } }).srs.reps === 3);
ok('todos los tipos declarados se normalizan a sí mismos',
  TIPOS.every((t) => tipoDe({ tipo: t }) === t));

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
