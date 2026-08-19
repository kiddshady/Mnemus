/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — los tipos de ficha
   Qué se te pregunta y cómo se contesta. Es lo único que cambia entre una
   ficha básica y una de opción múltiple: el SRS de abajo (srs.js) no se entera
   de nada — una ficha es una ficha, y el intervalo se calcula igual.

   Puro y sin DOM a propósito, como srs.js: se testea con node pelado
   (test/ficha.test.mjs).

   El modelo:
     tipo      'basica' | 'opcion' | 'vf'   (ausente = 'basica')
     front     la pregunta, o la afirmación en las de verdadero/falso
     back      la explicación — POR QUÉ esa es la respuesta, no solo cuál
     opciones  solo en 'opcion': las alternativas, en orden
     correcta  índice en opciones; en 'vf', 0 = Verdadero, 1 = Falso

   Las de 'vf' NO guardan opciones: son siempre las mismas dos. Guardarlas
   sería dejar que un archivo editado a mano diga «Verdadero / Verdadero».
   ═══════════════════════════════════════════════════════════════════════════ */

import { GRADOS } from './srs.js';

export const TIPOS = ['basica', 'opcion', 'vf'];

export const ETIQUETA_TIPO = {
  basica: 'Básica',
  opcion: 'Opción múltiple',
  vf: 'Verdadero o falso',
};

/** Las dos únicas opciones de una ficha de verdadero/falso. */
export const OPCIONES_VF = ['Verdadero', 'Falso'];

/* Entre 2 y 6: con una sola no hay pregunta, y arriba de 6 la ficha no entra
   en pantalla sin volverse una lista para scrollear, que es otra cosa. */
export const MIN_OPCIONES = 2;
export const MAX_OPCIONES = 6;

/** El tipo de una ficha, tolerando lo viejo y lo roto: todo cae en 'basica'.
    Las fichas anteriores a esta función no tienen el campo y siguen andando. */
export function tipoDe(f) {
  return TIPOS.includes(f?.tipo) ? f.tipo : 'basica';
}

/** Las alternativas a mostrar. Una ficha básica no tiene: devuelve []. */
export function opcionesDe(f) {
  const t = tipoDe(f);
  if (t === 'vf') return [...OPCIONES_VF];
  if (t === 'opcion') return Array.isArray(f?.opciones) ? f.opciones.slice() : [];
  return [];
}

/** ¿Se contesta eligiendo, en vez de revelando y autocalificándose? */
export function esInteractiva(f) {
  return tipoDe(f) !== 'basica';
}

/** El índice de la respuesta correcta, o -1 si la ficha no tiene una. */
export function indiceCorrecto(f) {
  if (!esInteractiva(f)) return -1;
  const n = Number(f?.correcta);
  return Number.isInteger(n) && n >= 0 && n < opcionesDe(f).length ? n : -1;
}

/** A, B, C… — la etiqueta de una opción. Nunca un número: el número ya lo usa
    la tecla, y ver «3» dos veces con significados distintos confunde. */
export function letra(i) {
  return String.fromCharCode(65 + i);
}

/**
 * Qué calificación proponer según si acertó. Es una SUGERENCIA: el que decide
 * sigue siendo el usuario, porque acertar adivinando entre dos no es lo mismo
 * que saberlo, y SM-2 se envenena si el ease sube por suerte.
 *
 * Errar sí manda «Otra vez» sin vueltas: elegir la opción equivocada es la
 * definición de haberla olvidado.
 */
export function gradoSugerido(acerto) {
  return acerto ? GRADOS.bien : GRADOS.otra;
}

/**
 * Valida una ficha antes de guardarla. Devuelve `null` si está bien, o el
 * mensaje del problema — uno solo, el primero, porque una lista de seis
 * errores en un modal no se lee.
 */
export function validar(ficha) {
  const front = String(ficha?.front ?? '').trim();
  const back = String(ficha?.back ?? '').trim();
  if (!front) return 'La pregunta no puede quedar vacía.';
  if (!back) return 'La explicación no puede quedar vacía.';

  const tipo = tipoDe(ficha);
  if (tipo === 'basica') return null;

  if (tipo === 'opcion') {
    const ops = opcionesDe(ficha).map((o) => String(o ?? '').trim());
    if (ops.length < MIN_OPCIONES) return `Una ficha de opción múltiple necesita al menos ${MIN_OPCIONES} alternativas.`;
    if (ops.length > MAX_OPCIONES) return `No más de ${MAX_OPCIONES} alternativas por ficha.`;
    if (ops.some((o) => !o)) return 'Hay una alternativa vacía.';
    // Sin distinguir mayúsculas: dos opciones que solo difieren en el caso son
    // la misma opción para el que la lee, y vuelven ambigua la correcta.
    const vistas = new Set(ops.map((o) => o.toLowerCase()));
    if (vistas.size !== ops.length) return 'Hay dos alternativas repetidas.';
  }

  if (indiceCorrecto(ficha) < 0) return 'Falta marcar cuál es la respuesta correcta.';
  return null;
}

/**
 * Deja la ficha en su forma canónica para el disco: sin campos de un tipo que
 * ya no es. Sin esto, cambiar una ficha de opción múltiple a básica le deja
 * las alternativas viejas escondidas en el JSON, y vuelven solas el día que
 * alguien la edite de nuevo.
 */
export function normalizar(ficha) {
  const tipo = tipoDe(ficha);
  const base = { ...ficha, tipo, front: String(ficha.front).trim(), back: String(ficha.back).trim() };

  if (tipo === 'basica') {
    delete base.opciones;
    delete base.correcta;
    return base;
  }
  if (tipo === 'vf') {
    delete base.opciones;                       // implícitas, ver el encabezado
    base.correcta = Number(ficha.correcta);
    return base;
  }
  base.opciones = opcionesDe(ficha).map((o) => String(o).trim());
  base.correcta = Number(ficha.correcta);
  return base;
}
