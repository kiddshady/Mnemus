/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — carpetas
   Un nivel de organización arriba de los mazos, y UNO solo: una carpeta
   agrupa mazos, un mazo vive en una carpeta o en ninguna. Sin anidado — con
   la cantidad de mazos que junta una persona estudiando, un nivel ordena
   todo y dos niveles esconden la mitad.

   La carpeta es organización, no propiedad: eliminar una suelta sus mazos a
   la raíz, nunca se los lleva. (Compará con mazo→fichas, donde la ficha
   huérfana no significa nada y borrar el mazo la borra.)

   Puro y sin DOM, como todo lo que decide algo: test/carpetas.test.mjs.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Arma los grupos que la lista pinta: cada carpeta con sus mazos, y al final
 * la raíz con los sueltos.
 *
 * Las carpetas van alfabéticas — son categorías, y una categoría que cambia
 * de lugar según cuándo la tocaste es una categoría que no se encuentra. Los
 * mazos adentro conservan el orden en que llegan (recientes primero, como
 * siempre). Las carpetas vacías aparecen: una carpeta recién creada tiene
 * que estar a la vista para poder llenarla.
 *
 * La raíz va última y solo si tiene mazos. Un mazo cuya carpeta ya no existe
 * (un JSON editado a mano) cae a la raíz en vez de desaparecer de la lista.
 */
export function agrupar(mazos, carpetas) {
  const ordenadas = [...carpetas].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
  const ids = new Set(ordenadas.map((c) => c.id));

  const grupos = ordenadas.map((carpeta) => ({
    carpeta,
    mazos: mazos.filter((m) => m.carpeta === carpeta.id),
  }));

  const sueltos = mazos.filter((m) => !m.carpeta || !ids.has(m.carpeta));
  if (sueltos.length || !grupos.length) grupos.push({ carpeta: null, mazos: sueltos });
  return grupos;
}
