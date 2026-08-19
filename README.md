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

## Correr y construir

```
npm install
npm run dev      # con la consola del renderer en la terminal
npm start
npm test         # unidad: SM-2, tipos de ficha, almacenamiento, formato, tokens
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
  settings.json      ajustes (cuántas fichas nuevas por día)
  mazos/m-0001.json  un archivo por mazo
  fichas/f-0001.json un archivo por ficha, con su historial de repaso
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
renderer/js/app.js    las vistas
renderer/css/         el sistema de diseño
```

La referencia del sistema de diseño está en [docs/sistema.md](docs/sistema.md), y
la vitrina viva de todos los primitivos, dentro de la app en **Piezas**.

## Licencia

MIT — ver [LICENSE](LICENSE). La fuente Roboto Mono viaja empaquetada bajo la
SIL Open Font License 1.1; los detalles están en [NOTICE](NOTICE).
