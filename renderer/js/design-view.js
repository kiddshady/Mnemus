/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — Piezas (documentación viva)
   Todos los primitivos del sistema, funcionando. No es una vista del producto:
   es el catálogo contra el que se compara todo lo demás.

   Regla: si un primitivo no aparece acá, no existe en el sistema. Agregarlo
   acá es parte de crearlo — un componente sin vitrina se vuelve invisible y
   alguien termina reinventándolo peor tres pantallas más allá.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Toast, Menu, Modal } from './overlays.js';
import Palette from './palette.js';
import { bindSwitcher, bindStepper, raf2 } from './motion.js';
import { mark, status, copy, colorToken } from './ui.js';

/* ── Las tres perillas ───────────────────────────────────────────────────────
   Los presets del acento. El nombre importa: son las cinco temperaturas que
   cubren casi cualquier app. El rojo NO está, a propósito — está reservado
   para el fallo, y un acento rojo lo deja sin significado. */
const ACCENTS = [
  { id: 'luz',     label: 'Luz',      rgb: '240 243 247', hue: 258 },
  { id: 'cian',    label: 'Cian',     rgb: '34 211 238',  hue: 205 },
  { id: 'violeta', label: 'Violeta',  rgb: '167 139 250', hue: 285 },
  { id: 'verde',   label: 'Verde',    rgb: '74 222 128',  hue: 155 },
  { id: 'ambar',   label: 'Ámbar',    rgb: '251 191 36',  hue: 60 },
];

const swatch = (name, varName) => `
  <div class="op-col" style="gap:6px">
    <div style="height:52px;border-radius:8px;background:var(${varName});box-shadow:var(--op-hairline)"></div>
    <span class="op-meta">${name}</span>
    <span class="op-mono op-dim2" style="font-size:10px">${varName}</span>
  </div>`;

const fadeDemoRows = Array.from({ length: 14 }, (_, i) =>
  `<div style="padding:7px 0;font-size:12px;color:var(--op-text-2);box-shadow:inset 0 -1px 0 var(--op-line)">Elemento de lista ${i + 1}</div>`).join('');

const section = (title, note, body) => `
  <section style="margin-bottom:40px">
    <div class="op-row" style="margin-bottom:4px"><span class="op-eyebrow">${title}</span></div>
    ${note ? `<p class="op-meta op-copyable" style="max-width:640px;line-height:1.65;margin-bottom:16px">${note}</p>` : '<div style="height:12px"></div>'}
    ${body}
  </section>`;

export function designHTML() {
  return `
    <div class="op-scroll op-grow" id="design-scroll">
    <div id="design-body" style="max-width:920px">

      ${section('Las perillas', 'Todo el sistema deriva de estas seis variables. Movelas: la app entera cambia en vivo, incluido el color con el que el compositor de Windows pinta el frame de restaurar. Esto es literalmente lo que hacés al empezar una app nueva — salvo que ahí lo hacés con <span class="op-mono">node tools/retint.mjs</span>, que además mantiene en sincronía las dos copias en hex del color base.', `
        <div class="op-card" style="padding:18px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px 28px;align-items:start">
            <div class="op-field">
              <label class="op-field__label">Desenfoque <span class="op-mono op-dim2" id="blur-val"></span></label>
              <input type="range" class="op-slider" id="knob-blur" min="0" max="40" step="1">
              <span class="op-field__hint">EL carácter de Opal. Bajo, el vidrio es casi transparente; arriba de 28, esmerilado profundo.</span>
            </div>
            <div class="op-field">
              <label class="op-field__label">Niebla <span class="op-mono op-dim2" id="fog-val"></span></label>
              <input type="range" class="op-slider" id="knob-fog" min="0" max="30" step="1">
              <span class="op-field__hint">Cuánta luz hay detrás del vidrio. En 0, el blur se queda sin nada que repartir.</span>
            </div>
            <div class="op-field">
              <label class="op-field__label">Matiz <span class="op-mono op-dim2" id="hue-val"></span></label>
              <input type="range" class="op-slider" id="knob-hue" min="0" max="360" step="1">
              <span class="op-field__hint">Latente: con la temperatura en 0 no actúa. Queda esperando a la app que lo despierte.</span>
            </div>
            <div class="op-field">
              <label class="op-field__label">Temperatura <span class="op-mono op-dim2" id="tint-val"></span></label>
              <input type="range" class="op-slider" id="knob-tint" min="0" max="60" step="1">
              <span class="op-field__hint">Cuánta croma. El default de Opal es 0: la variación la pone la niebla, no el tinte.</span>
            </div>
            <div class="op-field" style="grid-column:1/-1">
              <label class="op-field__label">Monoespaciada</label>
              <div class="op-row" style="gap:6px;flex-wrap:wrap" id="knob-mono"></div>
              <span class="op-field__hint">Empaquetada en <span class="op-mono">renderer/fonts/</span>, no tomada del sistema: si depende de lo que haya instalado, la app se ve distinta en cada máquina.</span>
              <div class="op-sunken" style="margin-top:10px;padding:12px 14px">
                <div class="op-mono" id="mono-sample" style="font-size:13px;line-height:19px">
                  const total = items.filter(i =&gt; i.ok).length;  // 0O1lI|i{}[]<br>
                  n-0007 · 42.3k · 1m 12s · S:\\tools\\Opal · ñ á é í ó ú ü
                </div>
              </div>
            </div>

            <div class="op-field" style="grid-column:1/-1">
              <label class="op-field__label">Acento</label>
              <div class="op-row" style="gap:6px;flex-wrap:wrap" id="knob-accent">
                ${ACCENTS.map((a) => `
                  <button class="op-btn op-btn--secondary op-flashable" data-accent="${a.id}" style="gap:8px">
                    <span style="width:11px;height:11px;border-radius:50%;background:rgb(${a.rgb});box-shadow:0 0 0 1px rgb(0 0 0 / .35)"></span>${a.label}
                  </button>`).join('')}
                <div class="op-spacer"></div>
                <button class="op-btn op-btn--ghost op-flashable" id="knob-reset"><i data-icon="retry"></i> Volver al default</button>
              </div>
              <span class="op-field__hint">El acento no rellena planos: tiñe cantos, líneas y puntos. Elegí uno saturado y mirá cómo se enciende el canto del primario y del check.</span>
            </div>
          </div>
        </div>`)}

      ${section('Superficies', 'Una sola superficie opaca en todo el sistema: el fondo. Lo demás son HOJAS —rellenos de luz con alfa— y POZOS —alfas de negro—, así el mismo componente funciona sobre la niebla, sobre una card o sobre un modal. La jerarquía se construye por elevación, nunca con bordes marcados: cuanto más alto flota algo, más luz junta.', `
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px">
          ${swatch('Hundido', '--op-sunken')}${swatch('Base', '--op-bg')}${swatch('Rail', '--op-s1')}
          ${swatch('Panel', '--op-s2')}${swatch('Flotante', '--op-s3')}${swatch('Máximo', '--op-s4')}
        </div>

        <!-- El vidrio en vivo: contenido con color atrás, una hoja adelante.
             La perilla Desenfoque de arriba mueve ESTE blur en tiempo real.

             OJO: esta hoja NO usa backdrop-filter, y eso es la lección. Estamos
             ADENTRO de un .op-scroll con esfumado: su máscara es frontera de
             backdrop y un backdrop-filter acá queda CIEGO — computa el blur y
             no muestrea nada (el texto de abajo se leería nítido a través).
             La hoja usa el ESPEJO: una copia del fondo esmerilada con filter,
             alineada por JS en wireDesign(). Idéntica a la vista, inmune a la
             frontera. -->
        <div id="glass-demo" style="position:relative;border-radius:var(--op-r-lg);overflow:hidden;min-height:180px;margin-top:14px;box-shadow:var(--op-hairline)">
          <div id="glass-fondo" style="position:absolute;inset:0;padding:18px 20px;background:
              radial-gradient(60% 90% at 12% 8%, rgb(255 255 255 / .10), transparent 60%),
              radial-gradient(50% 80% at 88% 92%, rgb(255 255 255 / .07), transparent 60%)">
            <div class="op-row" style="gap:8px;margin-bottom:12px">
              <span style="width:13px;height:13px;border-radius:50%;background:#22d3ee"></span>
              <span style="width:13px;height:13px;border-radius:50%;background:#a78bfa"></span>
              <span style="width:13px;height:13px;border-radius:50%;background:#4ade80"></span>
              <span style="width:13px;height:13px;border-radius:50%;background:#fbbf24"></span>
              <span class="op-meta">contenido con color, para que el vidrio tenga qué revelar</span>
            </div>
            <div class="op-meta" style="line-height:1.8;max-width:75%">
              Lo que pasa debajo de una hoja no desaparece: se vuelve profundidad. El
              <span class="op-mono">saturate(135%)</span> del vidrio es lo que hace que este texto y esos
              puntos de color atraviesen el desenfoque como luz y no como una mancha gris.
              Sin niebla y sin contenido, el vidrio no tiene nada que hacer.
            </div>
          </div>
          <div id="glass-hoja" style="position:absolute;right:20px;top:50%;transform:translateY(-50%);width:min(56%,300px);border-radius:var(--op-r-lg);overflow:hidden;box-shadow:var(--op-sheet),var(--op-e3)">
            <!-- El espejo es OPACO a propósito: un backdrop de verdad REEMPLAZA
                 lo de abajo por su versión esmerilada; una copia con fondo
                 transparente solo suma borrón encima y el original se sigue
                 leyendo nítido a través. La base opaca ocluye, la copia pinta. -->
            <div id="glass-espejo" style="position:absolute;inset:0;background:var(--op-bg)" aria-hidden="true"></div>
            <div style="position:relative;padding:16px 18px;background:var(--op-s3)">
              <div class="op-subtitle">Una hoja de vidrio</div>
              <div class="op-meta" style="margin-top:6px;line-height:1.65">
                Relleno <span class="op-mono">--op-s3</span> + canto <span class="op-mono">--op-sheet</span> +
                sombra <span class="op-mono">--op-e3</span>, y el desenfoque revelando lo de abajo.
                Mové la perilla <b>Desenfoque</b> y mirá.
              </div>
            </div>
          </div>
        </div>
        <p class="op-meta op-copyable" style="max-width:640px;line-height:1.65;margin-top:14px">
          LA REGLA DE LAS HOJAS: <span class="op-mono">backdrop-filter</span> va solo donde puede
          muestrear — el shell, los overlays, y hojas directas de la vista FUERA del scroller
          (<span class="op-mono">.op-card--glass</span>). ADENTRO de un <span class="op-mono">.op-scroll</span>
          con esfumado el vidrio queda ciego: la máscara es frontera de backdrop. Ahí va el truco del
          espejo (como esta hoja) o directamente no va vidrio. Y lo que vive adentro de una hoja es
          relleno translúcido sin blur: desenfocar lo ya desenfocado cuesta GPU y no se ve.
        </p>

        <!-- LAS DOS FORMAS DE LA TARJETA, y están las dos a propósito.

             El cuerpo llevaba padding-top en cero para no repetir el aire que
             el encabezado ya pone. Con encabezado se veía perfecto; SIN él, el
             contenido quedaba pegado al borde de arriba: 0 px contra 16 abajo.

             Sobrevivió porque acá se mostraba UNA tarjeta y con padding inline,
             salteándose el componente. La vitrina existe para ver las piezas y
             era el único lugar donde la pieza rota no se veía. Si una variante
             no está en esta página, no está verificada. -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
          <div class="op-card">
            <div class="op-card__head">
              <span class="op-grow" style="font-size:var(--op-fs-13)">Con encabezado</span>
              <button class="op-iconbtn" data-tip="Más">${Icons.svg('more')}</button>
            </div>
            <div class="op-card__body">
              <div class="op-kv">
                <span class="op-kv__k">Estado</span><span class="op-kv__v">Listo</span>
                <span class="op-kv__k">Versión</span><span class="op-kv__v op-mono">1.4.0</span>
              </div>
            </div>
          </div>
          <div class="op-card">
            <div class="op-card__body">
              <div class="op-kv">
                <span class="op-kv__k">Sin head</span><span class="op-kv__v">El cuerpo pone su aire</span>
                <span class="op-kv__k">Arriba</span><span class="op-kv__v op-mono">= abajo</span>
              </div>
            </div>
          </div>
        </div>`)}

      ${section('Tipografía', 'Sans para toda la interfaz, mono <b>solo</b> para dato exacto: IDs, números, rutas, timestamps. El mono en texto corrido se ve técnico de más; la sans en una columna de números la desalinea.', `
        <div class="op-col" style="gap:10px">
          <div class="op-display">Instrumento silencioso</div>
          <div class="op-title">Título de vista</div>
          <div class="op-subtitle">Subtítulo de panel</div>
          <div>Cuerpo de la interfaz a 13 píxeles, que es la densidad de una herramienta profesional.</div>
          <div class="op-meta">Metadato secundario · 11 px</div>
          <div class="op-eyebrow">Versalita espaciada</div>
          <div class="op-mono">n-0007 · 42.3k · 1m 12s · S:\\tools\\Opal</div>
        </div>`)}

      ${section('Estado', 'La pieza central. La <b>forma</b> dice qué es la cosa, la <b>luminancia</b> si está viva, y el <b>movimiento</b> es exclusivo de lo que corre ahora mismo. Con eso se lee una pantalla entera sin un solo color — que es el punto: así el rojo queda libre para significar «se rompió».', `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px 12px">
          ${['idle', 'queued', 'running', 'waiting', 'done', 'skipped', 'failed'].map((s) => `
            <div class="op-col" style="gap:8px">${status(s)}
              <div class="op-row" style="gap:10px;padding-left:2px">
                ${mark(s, 'circle')}${mark(s, 'square')}${mark(s, 'diamond')}${mark(s, 'hex')}
              </div>
            </div>`).join('')}
        </div>
        <div class="op-row op-meta op-dim2" style="gap:20px;margin-top:22px;flex-wrap:wrap">
          ${[['circle', 'círculo'], ['square', 'cuadrado'], ['diamond', 'rombo'], ['hex', 'hexágono']]
            .map(([k, label]) => `<span class="op-row" style="gap:7px">${mark('done', k)}${label}</span>`).join('')}
        </div>`)}

      ${section('Botones', 'La ley del énfasis: <b>la luz no rellena, talla</b>. El primario no es el plano más claro — es el más profundo, con el canto más vivo (obsidiana). Sigue habiendo uno solo por pantalla: dos pozos compitiendo confunden igual que dos blancos. El sólido rojo se reserva para lo que no tiene vuelta atrás.', `
        <div class="op-row" style="flex-wrap:wrap;gap:8px">
          <button class="op-btn op-btn--primary op-flashable"><i data-icon="play"></i> Acción primaria</button>
          <button class="op-btn op-btn--secondary op-flashable">Secundario</button>
          <button class="op-btn op-btn--ghost op-flashable">Ghost</button>
          <button class="op-btn op-btn--danger op-flashable"><i data-icon="trash"></i> Eliminar</button>
          <button class="op-btn op-btn--danger-solid op-flashable">Borrar todo</button>
          <button class="op-btn op-btn--secondary" disabled>Deshabilitado</button>
          <button class="op-iconbtn" data-tip="Botón de ícono"><i data-icon="settings"></i></button>
          <button class="op-btn op-btn--sm op-btn--secondary">Chico</button>
          <button class="op-btn op-btn--lg op-btn--secondary">Grande</button>
        </div>`)}

      ${section('Campos y controles', 'Ningún control nativo de Chromium sobrevive: el select abre un menú nuestro, el tilde se dibuja con <span class="op-mono">stroke-dashoffset</span> y la cápsula del segmentado viaja entre opciones en vez de saltar. Un control nativo grita «esto es una página web en una ventana».', `
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px">
          <div class="op-field">
            <label class="op-field__label">Nombre</label>
            <input class="op-input" value="Sin título" spellcheck="false">
          </div>
          <div class="op-field">
            <label class="op-field__label">Modelo</label>
            <button class="op-select" id="demo-select">
              <span class="op-select__value">claude-opus-5</span><i data-icon="chevronDown"></i>
            </button>
          </div>
          <div class="op-field">
            <label class="op-field__label">Con error</label>
            <input class="op-input is-invalid" value="temperatura = 3.4" spellcheck="false">
            <span class="op-field__hint op-field__hint--error">Tiene que estar entre 0 y 1.</span>
          </div>
          <div class="op-field">
            <label class="op-field__label">Deslizador</label>
            <input type="range" class="op-slider" id="demo-slider" min="0" max="100" value="30">
          </div>
          <div class="op-field">
            <label class="op-field__label">Copias</label>
            <div class="op-stepper" id="demo-stepper">
              <input class="op-input op-num" type="number" min="1" max="12" step="1" value="1">
              <div class="op-stepper__btns">
                <button class="op-stepper__btn" data-step="up" tabindex="-1"><i data-icon="chevronUp"></i></button>
                <button class="op-stepper__btn" data-step="down" tabindex="-1"><i data-icon="chevronDown"></i></button>
              </div>
            </div>
            <span class="op-field__hint">Mantené apretada una flecha: repite, y acelera. El tope apaga el botón.</span>
          </div>
          <div class="op-field" style="grid-column:1/-1">
            <label class="op-field__label">Texto largo</label>
            <textarea class="op-textarea" placeholder="Escribí algo…"></textarea>
          </div>
          <div class="op-col" style="gap:12px">
            <label class="op-row" style="gap:10px"><button class="op-switch is-on" data-toggle></button> <span class="op-label">Guardado automático</span></label>
            <label class="op-row" style="gap:10px"><button class="op-switch" data-toggle></button> <span class="op-label">Confirmar al salir</span></label>
            <label class="op-row" style="gap:10px"><button class="op-check is-on" data-check><i data-icon="check"></i></button> <span class="op-label">Recordar la ventana</span></label>
            <label class="op-row" style="gap:10px"><button class="op-check" data-check><i data-icon="check"></i></button> <span class="op-label">Notificar al terminar</span></label>
          </div>
          <div class="op-col" style="gap:12px;align-items:flex-start">
            <div class="op-segmented" id="demo-seg">
              <button class="op-segmented__opt is-active" data-value="a">Lista</button>
              <button class="op-segmented__opt" data-value="b">Grilla</button>
              <button class="op-segmented__opt" data-value="c">Tabla</button>
            </div>
            <div class="op-tabs" id="demo-tabs">
              <button class="op-tab is-active" data-value="1">Resumen</button>
              <button class="op-tab" data-value="2">Detalle <span class="op-tab__count">12</span></button>
              <button class="op-tab" data-value="3">Historial</button>
            </div>
            <div class="op-row" style="gap:6px">
              <span class="op-kbd">Ctrl</span><span class="op-kbd">K</span>
              <span class="op-meta">abre la paleta de comandos</span>
            </div>
          </div>
        </div>`)}

      ${section('Overlays', 'Todos entran <i>y salen</i> animados, y todos son nuestros: ni un <span class="op-mono">title=</span> amarillo, ni un <span class="op-mono">confirm()</span> del sistema. Lo que más se olvida es la salida — un overlay que desaparece de golpe hace sentir rota a toda la app.', `
        <div class="op-row" style="flex-wrap:wrap;gap:8px">
          <button class="op-btn op-btn--secondary" data-tip="Portaleado, con entrada y salida animadas, y se da vuelta solo si no entra">Tooltip (hover)</button>
          <button class="op-btn op-btn--secondary op-flashable" id="demo-menu">Menú</button>
          <button class="op-btn op-btn--secondary op-flashable" id="demo-modal">Modal</button>
          <button class="op-btn op-btn--secondary op-flashable" id="demo-confirm">Confirmación destructiva</button>
          <button class="op-btn op-btn--secondary op-flashable" id="demo-toast">Toast</button>
          <button class="op-btn op-btn--secondary op-flashable" id="demo-toast-err">Toast de error</button>
          <button class="op-btn op-btn--secondary op-flashable" id="demo-palette"
                  data-tip="El texto del campo vacío lo pone cada app con Palette.init({ placeholder }); el default solo promete comandos">Paleta de comandos</button>
        </div>`)}

      ${section('Métricas y medidores', '', `
        <div class="op-row" style="gap:40px;margin-bottom:20px;flex-wrap:wrap">
          <div class="op-stat"><span class="op-stat__value">42.3<span class="op-stat__unit">k</span></span><span class="op-stat__label">Registros</span></div>
          <div class="op-stat"><span class="op-stat__value">96<span class="op-stat__unit">%</span></span><span class="op-stat__label">Éxito</span></div>
          <div class="op-stat"><span class="op-stat__value"><span class="op-stat__unit">USD </span>3.42</span><span class="op-stat__label">Gasto</span></div>
        </div>
        <div class="op-col" style="gap:14px;max-width:420px">
          <div class="op-meter" style="--op-pct:62%"><div class="op-meter__fill"></div></div>
          <div class="op-meter op-meter--danger" style="--op-pct:88%"><div class="op-meter__fill"></div></div>
          <div class="op-meter op-meter--indeterminate"><div class="op-meter__fill"></div></div>
        </div>`)}

      ${section('Chips, avatares y esqueletos', 'El esqueleto va donde va a aparecer el contenido, con su forma. Un spinner centrado dice «esperá»; un esqueleto dice «esto va a ser una lista de tres líneas», que es mucho más.', `
        <div class="op-row" style="flex-wrap:wrap;gap:8px;margin-bottom:20px">
          <span class="op-chip">7 elementos</span>
          <span class="op-chip op-chip--mono">claude-opus-5</span>
          <span class="op-chip op-chip--outline">Borrador</span>
          <span class="op-chip op-chip--danger">2 fallos</span>
          <span class="op-avatar">FP</span>
          <span class="op-avatar op-avatar--lg">ON</span>
        </div>
        <div class="op-col" style="gap:8px;max-width:420px">
          <div class="op-skeleton" style="height:12px;width:70%"></div>
          <div class="op-skeleton" style="height:12px;width:92%"></div>
          <div class="op-skeleton" style="height:12px;width:48%"></div>
        </div>`)}

      ${section('Listas y tablas', 'La fila entera es el objetivo del click, no un link adentro. Las acciones de fila aparecen con el hover para no ensuciar la lectura en reposo.', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
          <div class="op-list">
            ${[['Documento de trabajo', 'modificado recién', 'running'],
               ['Notas de la reunión', 'hace 2 h', 'done'],
               ['Borrador sin título', 'ayer', 'idle']].map(([t, s, st]) => `
              <div class="op-listitem" role="button" tabindex="0">
                ${mark(st)}
                <div class="op-listitem__main">
                  <span class="op-listitem__title">${t}</span>
                  <span class="op-listitem__sub">${s}</span>
                </div>
                <div class="op-rowactions">
                  <button class="op-iconbtn op-iconbtn--sm" data-tip="Editar"><i data-icon="edit"></i></button>
                  <button class="op-iconbtn op-iconbtn--sm" data-tip="Más"><i data-icon="more"></i></button>
                </div>
              </div>`).join('')}
          </div>
          <table class="op-table">
            <thead><tr><th>Id</th><th>Estado</th><th class="op-td--num">Tamaño</th></tr></thead>
            <tbody>
              ${[['n-0003', 'done', '4.2 kB'], ['n-0002', 'failed', '820 B'], ['n-0001', 'done', '12 kB']].map(([id, st, sz]) => `
                <tr class="op-tr"><td class="op-mono">${id}</td><td>${status(st)}</td><td class="op-td--num op-num">${sz}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`)}

      ${section('Esfumado del scroll', 'Donde el scroll recorta <b>al aire</b>, el contenido se desvanece: un corte al aire se lee como un bug, y el fade dice «hay más, seguí». Pero el fade no va en todo corte — va donde nada más explica el límite. Si de ese lado hay una línea, la línea YA es el límite: el esfumado encima la ensucia y además miente, porque el contenido no se pierde en la nada sino que muere contra un borde. Ese lado se apaga con <span class="op-mono">.op-scroll--line-top</span> / <span class="op-mono">--line-bottom</span>. Los dos casos, con la misma lista:', `
        <div class="op-row" style="gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div class="op-col" style="gap:8px">
            <span class="op-meta">Sin borde — se esfuma de los dos lados</span>
            <div style="width:296px;height:180px">
              <div class="op-scroll" style="height:100%;--op-fade:20px">
                ${fadeDemoRows}
              </div>
            </div>
          </div>
          <div class="op-col" style="gap:8px">
            <span class="op-meta">Con borde — corta limpio contra él</span>
            <div class="op-sunken" style="width:296px;height:180px;overflow:hidden">
              <div class="op-scroll op-scroll--line-top op-scroll--line-bottom"
                   style="height:100%;padding-left:14px;padding-right:14px;--op-fade:20px">
                ${fadeDemoRows}
              </div>
            </div>
          </div>
        </div>`)}

      ${section('Íconos', 'El set base. Todos sobre grilla de 16, trazo 1.5, puntas redondeadas — por eso se ven de la misma familia. Hacé click en cualquiera para copiar su etiqueta. Los de tu dominio se suman con <span class="op-mono">Icons.add({...})</span>, no editando este archivo.', `
        <div id="icon-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:2px">
          ${Icons.names.map((n) => `
            <button class="op-iconcell" data-icon-name="${n}" data-tip="&lt;i data-icon=&quot;${n}&quot;&gt;">
              ${Icons.svg(n, 'op-icon--lg')}<span class="op-truncate">${n}</span>
            </button>`).join('')}
        </div>`)}

    </div>
    <div style="height:32px"></div>
    </div>`;
}

const DEMO_MENU = [
  { groupLabel: 'Acciones' },
  { label: 'Abrir', icon: 'external', key: 'Ctrl O' },
  { label: 'Editar', icon: 'edit' },
  { label: 'Duplicar', icon: 'duplicate', selected: true },
  { sep: true },
  { label: 'Eliminar', icon: 'trash', danger: true },
];

/* ── Las perillas en vivo ────────────────────────────────────────────────────
   Escriben sobre :root, que es exactamente lo que harías en tokens.css. Se
   avisa al proceso principal del color nuevo para que el frame fantasma del
   compositor siga camuflado (si no, minimizar y restaurar delata el cambio). */
const root = document.documentElement;

function readKnob(name, fallback) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v ? parseFloat(v) : fallback;
}

function pushBackground() {
  /* Mover las perillas re-tinta la app entera, así que el fondo de la ventana
     tiene que seguirlas o el frame fantasma del restore queda del color viejo.
     La traducción a hex la hace colorToken() con un canvas — ver ui.js. */
  const hex = colorToken('--op-bg');
  if (hex) window.opal?.win?.setBackground(hex);
}

export function wireDesign(rootEl) {
  /* Perillas */
  const hue = rootEl.querySelector('#knob-hue');
  const tint = rootEl.querySelector('#knob-tint');
  const hueVal = rootEl.querySelector('#hue-val');
  const tintVal = rootEl.querySelector('#tint-val');

  const syncSlider = (el) => el.style.setProperty('--op-pct', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);

  const applyHue = () => {
    root.style.setProperty('--op-hue', hue.value);
    hueVal.textContent = `${hue.value}°`;
    syncSlider(hue);
    pushBackground();
  };
  const applyTint = () => {
    const v = (tint.value / 10).toFixed(1);
    root.style.setProperty('--op-tint', v);
    tintVal.textContent = `×${v}`;
    syncSlider(tint);
    pushBackground();
  };

  hue.value = readKnob('--op-hue', 258);
  tint.value = Math.round(readKnob('--op-tint', 0) * 10);
  applyHue();
  applyTint();
  hue.addEventListener('input', applyHue);
  tint.addEventListener('input', applyTint);

  /* Las perillas del vidrio. El blur NO pasa por pushBackground: no cambia el
     color de la ventana, solo cuánto esmerila cada hoja. readKnob hace
     parseFloat, así que el "17px" computado vuelve como 17. */
  const blur = rootEl.querySelector('#knob-blur');
  const fog = rootEl.querySelector('#knob-fog');
  const blurVal = rootEl.querySelector('#blur-val');
  const fogVal = rootEl.querySelector('#fog-val');

  const applyBlur = () => {
    root.style.setProperty('--op-blur', `${blur.value}px`);
    blurVal.textContent = `${blur.value}px`;
    syncSlider(blur);
  };
  const applyFog = () => {
    const v = (fog.value / 10).toFixed(1);
    root.style.setProperty('--op-fog', v);
    fogVal.textContent = `×${v}`;
    syncSlider(fog);
  };

  blur.value = readKnob('--op-blur', 17);
  fog.value = Math.round(readKnob('--op-fog', 1) * 10);
  applyBlur();
  applyFog();
  blur.addEventListener('input', applyBlur);
  fog.addEventListener('input', applyFog);

  /* Las monoespaciadas se descubren solas leyendo los tokens `--op-mono-*` de
     las hojas de estilo. Si mañana sumás una en tokens.css, aparece acá sin
     tocar este archivo — que es la única forma de que la vitrina no mienta. */
  const monoHost = rootEl.querySelector('#knob-mono');
  const monoIds = monoHost ? [...new Set(
    [...document.styleSheets]
      .flatMap((ss) => { try { return [...ss.cssRules]; } catch { return []; } })
      .filter((r) => r.style)
      .flatMap((r) => [...r.style].filter((p) => p.startsWith('--op-mono-')))
      .map((p) => p.replace('--op-mono-', '')),
  )].sort() : [];

  const pintarMono = () => {
    if (!monoHost) return;
    const hoy = getComputedStyle(root).getPropertyValue('--op-mono').trim();
    monoHost.innerHTML = monoIds.map((id) => `
      <button class="op-btn op-btn--${hoy.includes(`--op-mono-${id}`) ? 'primary' : 'secondary'} op-flashable"
              data-mono="${id}" style="font-family:var(--op-mono-${id})">${id}</button>`).join('');
  };
  pintarMono();

  monoHost?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mono]');
    if (!btn) return;
    root.style.setProperty('--op-mono', `var(--op-mono-${btn.dataset.mono})`);
    pintarMono();
    Toast.show({ title: `Mono: ${btn.dataset.mono}`, text: `--op-mono: var(--op-mono-${btn.dataset.mono})`, icon: 'check' });
  });

  rootEl.querySelector('#knob-accent')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accent]');
    if (!btn) return;
    const a = ACCENTS.find((x) => x.id === btn.dataset.accent);
    root.style.setProperty('--op-accent-rgb', a.rgb);
    // Con un acento de color, la tinta encima tiene que ser oscura igual, pero
    // el matiz de la app acompaña: es lo que hace que se vea deliberado y no
    // como un color pegado encima de un gris ajeno.
    hue.value = a.hue;
    applyHue();
    Toast.show({ title: `Acento: ${a.label}`, text: `--op-accent-rgb: ${a.rgb}`, icon: 'check' });
  });

  rootEl.querySelector('#knob-reset')?.addEventListener('click', () => {
    root.style.removeProperty('--op-accent-rgb');
    root.style.removeProperty('--op-hue');
    root.style.removeProperty('--op-tint');
    root.style.removeProperty('--op-mono');
    root.style.removeProperty('--op-blur');
    root.style.removeProperty('--op-fog');
    pintarMono();
    hue.value = readKnob('--op-hue', 258);
    tint.value = Math.round(readKnob('--op-tint', 0) * 10);
    blur.value = readKnob('--op-blur', 17);
    fog.value = Math.round(readKnob('--op-fog', 1) * 10);
    applyHue();
    applyTint();
    applyBlur();
    applyFog();
  });

  /* El espejo de la demo de vidrio: una copia del fondo, esmerilada con
     filter (que no depende del backdrop) y alineada con lo que hay debajo.
     Existe porque acá adentro —un .op-scroll con esfumado— un backdrop-filter
     de verdad queda ciego: la máscara del scroller es frontera de backdrop.
     La copia mide lo que el demo y se corre en negativo hasta coincidir. */
  const demo = rootEl.querySelector('#glass-demo');
  const hoja = rootEl.querySelector('#glass-hoja');
  const espejoHost = rootEl.querySelector('#glass-espejo');
  const fondo = rootEl.querySelector('#glass-fondo');
  if (demo && hoja && espejoHost && fondo) {
    const copia = fondo.cloneNode(true);
    copia.removeAttribute('id');
    copia.style.position = 'absolute';
    copia.style.inset = 'auto';
    copia.style.pointerEvents = 'none';
    copia.style.userSelect = 'none';
    copia.style.filter = 'var(--op-glass)';   // mismas perillas que el vidrio real
    espejoHost.appendChild(copia);

    const alinear = () => {
      const rd = demo.getBoundingClientRect();
      const rh = hoja.getBoundingClientRect();
      copia.style.width = `${rd.width}px`;
      copia.style.height = `${rd.height}px`;
      copia.style.left = `${rd.left - rh.left}px`;
      copia.style.top = `${rd.top - rh.top}px`;
    };
    raf2(alinear);
    // La hoja también: si su texto re-fluye cambia de alto, y el translateY(-50%)
    // la mueve — el espejo tiene que seguirla.
    const ro = new ResizeObserver(alinear);
    ro.observe(demo);
    ro.observe(hoja);
  }

  /* Controles */
  rootEl.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => b.classList.toggle('is-on')));
  rootEl.querySelectorAll('[data-check]').forEach((b) =>
    b.addEventListener('click', () => b.classList.toggle('is-on')));

  const seg = rootEl.querySelector('#demo-seg');
  if (seg) bindSwitcher(seg, () => {});
  const tabs = rootEl.querySelector('#demo-tabs');
  if (tabs) bindSwitcher(tabs, () => {});

  const slider = rootEl.querySelector('#demo-slider');
  if (slider) {
    const sync = () => syncSlider(slider);
    sync();
    slider.addEventListener('input', sync);
  }

  const stepper = rootEl.querySelector('#demo-stepper');
  if (stepper) bindStepper(stepper);

  rootEl.querySelector('#demo-select')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const val = btn.querySelector('.op-select__value');
    Menu.show(btn, ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4.5', 'minimax-m3', 'qwen3.5-9b'].map((m) => ({
      label: m,
      selected: val.textContent === m,
      onSelect: () => { val.textContent = m; },
    })));
  });

  /* Overlays */
  rootEl.querySelector('#demo-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    Menu.show(e.currentTarget, DEMO_MENU);
  });

  rootEl.querySelector('#demo-modal')?.addEventListener('click', () => {
    Modal.show({
      title: 'Nuevo elemento',
      sub: 'El modal atrapa el foco, cierra con Escape y devuelve una promesa con el valor del botón que apretaste.',
      body: `
        <div class="op-col" style="gap:16px">
          <div class="op-field">
            <label class="op-field__label">Nombre</label>
            <input class="op-input" placeholder="Sin título" spellcheck="false">
          </div>
          <div class="op-field">
            <label class="op-field__label">Descripción</label>
            <textarea class="op-textarea" placeholder="Para qué sirve…"></textarea>
          </div>
        </div>`,
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Crear', value: true, variant: 'primary', autofocus: true },
      ],
    }).then((v) => v && Toast.show({ title: 'Devolvió true', text: 'Esto es la vitrina: no se creó nada.', icon: 'info' }));
  });

  rootEl.querySelector('#demo-confirm')?.addEventListener('click', () => {
    Modal.confirm({
      title: '¿Eliminar “Documento de trabajo”?',
      sub: 'Se borra también su historial. Esto no se puede deshacer.',
      confirmLabel: 'Eliminar',
      danger: true,
    }).then((ok) => ok && Toast.error('Vitrina', 'No se borró nada: acá solo se muestran los primitivos.'));
  });

  rootEl.querySelector('#demo-toast')?.addEventListener('click', () =>
    Toast.show({ title: 'Guardado', text: 'El documento quedó en disco · 4.2 kB.', icon: 'check' }));

  rootEl.querySelector('#demo-toast-err')?.addEventListener('click', () =>
    Toast.error('No se pudo guardar', 'EPERM: el archivo está tomado por otro proceso. Se reintentó 5 veces.'));

  rootEl.querySelector('#demo-palette')?.addEventListener('click', () => Palette.show());

  /* Íconos: click = copiar la etiqueta lista para pegar. */
  rootEl.querySelector('#icon-grid')?.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-icon-name]');
    if (cell) copy(`<i data-icon="${cell.dataset.iconName}"></i>`, { label: 'Etiqueta copiada' });
  });
}
