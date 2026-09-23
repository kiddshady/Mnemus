# Mnemus

Flashcards con repaso espaciado para escritorio. Windows, Electron, sin cuenta,
sin nube y sin telemetría: **tus mazos son archivos JSON en tu disco**, legibles
con cualquier editor y versionables con git.

El motor es SM-2 clásico —el de SuperMemo y Anki— sin variaciones: decide cuándo
te conviene volver a ver cada ficha para que la repases justo antes de olvidarla.

## Los tipos de ficha

| Tipo | Cómo se contesta |
|---|---|
| **Básica** | Ves la pregunta, revelás la respuesta detrás del velo esmerilado y te autocalificás |
| **Opción múltiple** | Hasta 6 alternativas rotuladas A, B, C… se eligen con las teclas 1-6 o con el mouse |
| **Verdadero o falso** | Una afirmación y dos alternativas |

El tipo vive en la ficha y no en el mazo, así que un mismo mazo puede mezclar los
tres y la sesión de repaso los intercala sin distinguirlos.

Las de opción múltiple y verdadero/falso se corrigen solas y **sugieren** una
calificación —resaltando el botón y enfocándolo, para que Enter lo tome— pero no
califican por vos: acertar adivinando entre dos alternativas no merece el mismo
factor de facilidad que saberlo, y SM-2 se envenena si el *ease* sube por suerte.

## La sesión de repaso

Una ficha por vez. **Espacio** revela la respuesta, **1-4** califican, y las
alternativas de una ficha interactiva se eligen con **1-6** antes de contestar
(por eso se rotulan con letras: si también fueran números, «3» sería la opción C
y «Bien» al mismo tiempo).

| Tecla | Qué hace |
|---|---|
| **Espacio** | Revela la respuesta |
| **1-4** | Califica: Otra vez · Difícil · Bien · Fácil |
| **1-6** | Antes de contestar, elige alternativa |
| **A** | Prende o apaga el modo azaroso |
| **Esc** | Termina la sesión |

**Terminar** no pregunta nada: cada calificación se escribió en el disco cuando
la diste, así que salir no pierde nada. Lo único que se disuelve es la cola, y
las que fallaste vencen ahora mismo — vuelven en la próxima.

### El orden de la cola

Por defecto sale primero lo más atrasado y las nuevas al final, de modo que una
sesión cortada a la mitad igual haya pagado la deuda más urgente. El **modo
azaroso** —el botón del repaso, la tecla `A`, o Ajustes → Repaso— baraja todo
junto y te saca el vicio de recordar una respuesta porque venía después de otra.
El azar decide el orden, nunca el contenido: el cupo diario de fichas nuevas y
el filtro de qué entra no cambian.

Prenderlo a mitad de sesión reordena solo lo que falta **después** de la ficha
actual: la que estás mirando no se mueve.

## El modo examen

Un examen es una medición, no un repaso: tomás N fichas del mazo —el mazo
**completo**, no solo lo vencido—, las contestás una vez cada una y al final hay
un puntaje. **El SRS no se entera**: el examen lee las fichas pero jamás escribe
una srs, porque medir cuánto sabés no es estudiar, y un examen que te reprograma
el plan de repaso castiga dos veces la misma falla.

Se toma desde el **Examen** del Inicio (todos los mazos juntos), desde el botón
**Examen** de un mazo, desde las acciones de su fila, desde su menú contextual,
o desde la paleta. Lo único que se decide al armarlo es cuántas preguntas: salen
siempre barajadas, y menos que el total es una muestra al azar del mazo.

Las de opción múltiple y verdadero/falso se corrigen solas —la elección es el
veredicto, sin calificación que discutir—; en las básicas la respuesta se revela
y contestás en binario, **la sabía** o **no la sabía**, porque en un examen no
hay «más o menos la sabía».

Al final, la prueba corregida: el porcentaje, las cifras, y cada fallada con la
respuesta que era, la que marcaste y su explicación. **Repasar las falladas**
arma ahí mismo una sesión de repaso normal con solo eso — recién ahí el examen
toca el plan de repaso, y lo hace por la puerta de siempre.

**Retirarse** a mitad de examen no tira lo contestado: el examen termina ahí y
se corrige sobre lo que llegaste a contestar, con la misma prueba corregida del
final. Las que faltaban no cuentan ni a favor ni en contra — lo que no se
preguntó no se midió. Pide confirmación, al revés que el repaso, porque un
examen retirado no se retoma.

### El historial

Cada examen rendido queda en la vista **Exámenes**: la fecha, la nota, y la
revisión congelada de ese día — qué fallaste y qué marcaste, guardado como
**texto**, no como referencias, así editar o borrar una ficha mañana no te
reescribe la historia. Uno retirado queda con la nota de lo contestado y dice
en cuánto te retiraste.

El historial es tuyo y es editable: cada examen acepta una **nota al margen**
(el contexto que el número no cuenta: «sin estudiar», «antes del parcial») y
cualquier entrada se puede eliminar. Como todo en Mnemus, cada registro es un
archivo JSON en tu carpeta de datos.

## Las carpetas

Cuando los mazos se acumulan, se agrupan en **carpetas** — un solo nivel, a
propósito: con lo que junta una persona estudiando, un nivel ordena todo y dos
niveles esconden la mitad. Un mazo vive en una carpeta o en ninguna, y quien no
usa carpetas ve la lista plana de siempre.

Se crean desde la vista Mazos o la paleta; un mazo se mueve desde su menú
(**Mover a carpeta…**) o **arrastrándolo** y soltándolo sobre la carpeta — sobre
«Sin carpeta» lo saca. Cada sección se **pliega y despliega** con un click, y
el pliegue persiste — la carpeta que plegaste ayer sigue plegada hoy. Mover un
mazo no toca su fecha de edición: organizar no es editar.

La carpeta es la **unidad de estudio**: desde su encabezado o su menú se repasa
la carpeta entera (todas las fichas de sus mazos, con las reglas de siempre) y
se le toma examen. También se exporta de una.

Eliminar una carpeta **suelta** sus mazos a la raíz, nunca se los lleva: la
carpeta es organización, no contenido.

## Las estadísticas

La vista **Estadísticas** dibuja lo que los repasos van dejando:

- **Actividad**: repasos por día, últimos 30 días, con la racha al lado. El
  diario se anota con cada calificación a partir de que existe la vista — la
  srs de una ficha guarda su estado, no su historia, así que los días previos
  no se pueden reconstruir: el gráfico crece con el uso.
- **Lo que viene**: cuántas fichas vencen cada día de las próximas dos semanas.
  Lo ya vencido cae en HOY — la deuda no vive en el pasado.
- **El estado de las fichas**: nuevas, aprendiendo, vencidas y al día, la misma
  lectura que la marca de cada ficha, sumada.
- **Exámenes**: la línea de las notas del historial, en orden de rendida.
- **Las más olvidadas**: las fichas con más olvidos — tus enemigas conocidas,
  listas para editar.

Los gráficos son HTML y SVG de la casa, sin librerías: una sola serie por
gráfico, tooltips propios en cada barra y cada punto, y el acento reservado
para el presente (la barra de hoy, la última nota).

## Pasar un mazo a otra persona

Desde el menú de un mazo, **Exportar…**; o el botón de exportar en la vista Mazos
para llevarte todos de una. Sale un `.json` que se puede mandar por donde sea.
Del otro lado, **Importar** en la vista Mazos.

El archivo lleva el progreso de repaso, pero al importar viene **apagado**: si el
mazo te lo pasó otra persona, su historial dice lo que recuerda ella, no vos.
Prendelo solo cuando estés moviendo tus propios mazos entre dos máquinas.

Los ids nunca viajan. Los asigna quien importa, así que importar dos veces el
mismo archivo no pisa nada, y un mazo de afuera no puede chocar con los tuyos.

## Correr y construir

```
npm install
npm run dev      # con la consola del renderer en la terminal
npm start
npm test         # unidad: SM-2, tipos de ficha, examen, carpetas, almacenamiento, formato, tokens
npm run smoke    # monta la app de verdad en Electron y la recorre
npm run dist     # instalador NSIS en dist/
```

## Publicar una versión

La app se actualiza sola contra GitHub Releases (`electron-updater`): chequea al
arrancar y cada 4 horas, descarga en segundo plano, y recién cuando el instalador
está bajado y verificado muestra un aviso propio ofreciendo reiniciar. Si lo
ignorás, la versión nueva se instala la próxima vez que cierres la app.

Para sacar una versión:

```
npm version patch                    # sube el número y deja el tag
git push --follow-tags
gh release create v0.1.1 --draft --title "Mnemus 0.1.1" --notes "…"
$env:GH_TOKEN = (gh auth token)      # electron-builder publica con este token
npm run release                      # construye y sube el instalador + latest.yml
gh release edit v0.1.1 --draft=false
```

**El release se crea a mano ANTES de `npm run release`, y no es un capricho.**
`electron-builder` sube el `.exe` y el `.blockmap` en paralelo, y si el release
todavía no existe los dos hilos lo crean: quedan **dos drafts con el mismo tag**
y los archivos repartidos entre ambos, con lo cual ninguno sirve. Con el draft ya
creado, los dos hilos lo encuentran y suben ahí.

El `latest.yml` es lo que el updater lee para saber que hay algo nuevo: un release
sin ese archivo es invisible para la app. Después de publicar conviene confirmarlo
como lo va a ver la app, sin credenciales:

```
curl -sL https://github.com/kiddshady/Mnemus/releases/latest/download/latest.yml
```

> **Sin firma de código.** Los instaladores no están firmados, así que Windows
> SmartScreen advierte la primera vez ("Más información" → "Ejecutar de todas
> formas"). Las actualizaciones posteriores no vuelven a preguntar; `electron-updater`
> igual verifica el SHA-512 de cada descarga contra el `latest.yml`.

## Dónde viven los datos

En desarrollo, en `data/` al lado del código. Ya instalada, en el `userData` de
la app. Se puede mover con la variable de entorno `MNEMUS_DATA`.

```
data/
  settings.json         ajustes (cuántas fichas nuevas por día)
  mazos/m-0001.json     un archivo por mazo
  fichas/f-0001.json    un archivo por ficha, con su historial de repaso
  examenes/e-0001.json  un archivo por examen rendido
  carpetas/c-0001.json  un archivo por carpeta
  actividad/d-20260822.json  el diario: un contador de repasos por día
```

Un archivo por ítem y no un array gigante: guardar una ficha no reescribe las
otras, y borrar a mano es borrar un archivo. Las escrituras son atómicas
(temporal + `fsync` + rename) para que un corte de luz no trunque nada.

## Estructura

```
main.cjs              proceso principal: la ventana sin flash blanco
preload.cjs           la única puerta entre el renderer y el sistema
src/store.cjs         JSON atómico sobre el disco
src/ipc.cjs           qué puede pedir el renderer (lista blanca)
src/update.cjs        actualización automática
renderer/js/srs.js    el motor SM-2, puro y testeable sin DOM
renderer/js/ficha.js  los tipos de ficha, también puro
renderer/js/examen.js el modo examen: la muestra, el puntaje y el veredicto
renderer/js/carpetas.js  la agrupación de mazos en carpetas
renderer/js/stats.js  las cuentas de las estadísticas, puras
renderer/js/app.js    las vistas
renderer/css/         el sistema de diseño
```

La referencia del sistema de diseño está en [docs/sistema.md](docs/sistema.md), y
la vitrina viva de todos los primitivos, dentro de la app en **Piezas**.

## Licencia

MIT — ver [LICENSE](LICENSE). La fuente Roboto Mono viaja empaquetada bajo la
SIL Open Font License 1.1; los detalles están en [NOTICE](NOTICE).
