<#
.SYNOPSIS
  Crea una app de escritorio nueva a partir de la plantilla Opal.

.DESCRIPTION
  Copia la plantilla a una carpeta nueva, la renombra, la re-tinta si le pedís
  un acento, e instala las dependencias. La app resultante es 100% independiente:
  no enlaza contra Opal, así que tocar Opal después nunca la rompe.

  Lo que NO hace, a propósito:
    · dibujarte la marca (el cabujón de Opal queda de placeholder — reemplazalo
      en renderer/index.html y en icons.js);
    · borrar la app demo (arranca mostrando algo real; vaciás las vistas cuando
      quieras empezar de cero).

.PARAMETER Name
  Nombre de la app. Se usa como título de ventana, marca y productName.

.PARAMETER Path
  Dónde crearla. Por defecto, al lado de Opal.

.PARAMETER Accent
  Preset de acento: luz, cian, violeta, verde, ambar. También acepta un
  triplete RGB entre comillas, por ejemplo "34 211 238".

.PARAMETER Hue
  Matiz de la escalera de grises (0-360). Si usás un preset, ya viene con el suyo.

.PARAMETER Tint
  Multiplicador de temperatura. 0 es el default de Opal (acromático absoluto);
  arriba de 3 el tinte es evidente.

.PARAMETER Blur
  Desenfoque del vidrio, en px. 17 es el default; rango útil 10–28.

.PARAMETER Fog
  Multiplicador de la niebla del sustrato. 1 es el default; 0 la apaga
  (no recomendado: el blur se queda sin nada que repartir).

.PARAMETER NoInstall
  No corre npm install.

.EXAMPLE
  .\scaffold.ps1 -Name Cristal -Blur 24

.EXAMPLE
  .\scaffold.ps1 -Name MiApp -Path S:\tools\MiApp -Accent violeta -Fog 1.4
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^[A-Za-z][A-Za-z0-9 _-]{0,39}$')]
  [string]$Name,

  [string]$Path,
  [string]$Accent,
  [string]$Mono,
  [ValidateRange(0, 360)][double]$Hue,
  [ValidateRange(0, 20)][double]$Tint,
  [ValidateRange(0, 80)][double]$Blur,
  [ValidateRange(0, 10)][double]$Fog,
  [switch]$NoInstall,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Template = $PSScriptRoot
$Parent = Split-Path $Template -Parent

# Slug: minúsculas, sin acentos ni espacios. Es el "name" de npm y el prefijo
# de la variable de entorno, así que no puede tener nada raro.
$slug = $Name.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
$slug = ($slug -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLowerInvariant()
$envVar = ($slug -replace '-', '_').ToUpperInvariant() + '_DATA'

if (-not $Path) { $Path = Join-Path $Parent $Name }
$Path = [IO.Path]::GetFullPath($Path)

if ($Path -eq $Template) { throw "El destino es la plantilla misma." }
if ((Test-Path $Path) -and (Get-ChildItem $Path -Force | Select-Object -First 1) -and -not $Force) {
  throw "$Path ya existe y no está vacía. Usá -Force si estás seguro."
}

Write-Host ""
Write-Host "  $Name" -ForegroundColor White
Write-Host "  $Path" -ForegroundColor DarkGray
Write-Host ""

# ── Copiar ───────────────────────────────────────────────────────────────────
# node_modules y data quedan afuera: el primero se reinstala, el segundo es del
# usuario de la plantilla y no tiene nada que hacer en una app nueva.
$excluir = @('node_modules', 'data', '.git', 'dist', 'out')
New-Item -ItemType Directory -Force -Path $Path | Out-Null

Get-ChildItem $Template -Force | Where-Object { $excluir -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName -Destination $Path -Recurse -Force
}
Write-Host "  copiada la plantilla" -ForegroundColor DarkGray

# ── Renombrar ────────────────────────────────────────────────────────────────
function Edit-File($rel, [scriptblock]$transform) {
  $file = Join-Path $Path $rel
  if (-not (Test-Path $file)) { return }
  $text = Get-Content $file -Raw
  Set-Content $file -Value (& $transform $text) -NoNewline -Encoding utf8
}

Edit-File 'package.json' {
  param($t)
  $t = $t -replace '"name":\s*"opal"', ('"name": "' + $slug + '"')
  $t = $t -replace '"productName":\s*"Opal"', ('"productName": "' + $Name + '"')
  $t -replace '"description":\s*"[^"]*"', ('"description": "' + $Name + ' — app de escritorio construida sobre Opal."')
}

Edit-File 'renderer/index.html' {
  param($t)
  $t = $t -replace '<title>Opal</title>', ('<title>' + $Name + '</title>')
  $t = $t -replace 'data-tip="Opal"', ('data-tip="' + $Name + '"')
  $t -replace '(<span class="op-brand__name">)Opal(</span>)', ('${1}' + $Name + '${2}')
}

# La variable de entorno lleva el nombre de la app: si dos apps Opal corren a la
# vez, un OPAL_DATA global las mandaría a las dos a la misma carpeta.
Edit-File 'src/store.cjs' { param($t) $t -replace 'process\.env\.OPAL_DATA', ('process.env.' + $envVar) }
Edit-File 'test/store.test.mjs' { param($t) $t -replace 'process\.env\.OPAL_DATA', ('process.env.' + $envVar) }

# El README de Opal documenta el framework, no tu app. La referencia del sistema
# viaja en docs/ y acá queda un README propio.
Set-Content -Path (Join-Path $Path 'README.md') -Encoding utf8 -Value @"
# $Name

App de escritorio construida sobre [Opal]($Template).

``````
npm run dev     # con la consola del renderer en la terminal
npm start
npm test
``````

La referencia del sistema de diseño está en [docs/sistema.md](docs/sistema.md), y
la vitrina viva de todos los primitivos, dentro de la app en **Piezas**.

## Lo primero que conviene hacer

1. **La marca.** El cabujón es el placeholder de Opal. Está en dos lugares que
   tienen que coincidir: el splash de ``renderer/index.html`` y el ícono
   ``opal`` de ``renderer/js/icons.js``.
2. **El vidrio.** ``node tools/retint.mjs --blur 24 --fog 1.4`` (y ``--accent``,
   ``--hue``, ``--tint``). Deja en sincronía tokens.css, el fondo de la ventana
   y el del splash.
3. **Las vistas.** ``renderer/js/app.js`` trae una app demo funcionando. Vaciá
   las vistas y dejá el arranque.
4. **Los datos.** ``src/store.cjs`` declara los ajustes; ``src/ipc.cjs``, qué
   puede pedir el renderer. La carpeta de datos se puede mover con ``$envVar``.
"@
Write-Host "  renombrada a $Name (env: $envVar)" -ForegroundColor DarkGray

# ── Re-tintar ────────────────────────────────────────────────────────────────
$retintArgs = @()
if ($Accent) { $retintArgs += @('--accent', $Accent) }
if ($Mono)   { $retintArgs += @('--mono', $Mono) }
if ($PSBoundParameters.ContainsKey('Hue'))  { $retintArgs += @('--hue', $Hue) }
if ($PSBoundParameters.ContainsKey('Tint')) { $retintArgs += @('--tint', $Tint) }
if ($PSBoundParameters.ContainsKey('Blur')) { $retintArgs += @('--blur', $Blur) }
if ($PSBoundParameters.ContainsKey('Fog'))  { $retintArgs += @('--fog', $Fog) }

if ($retintArgs.Count) {
  Push-Location $Path
  try { & node 'tools/retint.mjs' @retintArgs } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "Falló el re-tintado." }
}

# ── Instalar ─────────────────────────────────────────────────────────────────
if (-not $NoInstall) {
  Write-Host "  instalando dependencias…" -ForegroundColor DarkGray
  Push-Location $Path
  try { & npm install --silent } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Write-Warning "npm install falló. Corrélo a mano en $Path." }
}

# ── Verificar ────────────────────────────────────────────────────────────────
Push-Location $Path
try { & npm test | Out-Null } finally { Pop-Location }
$testOk = $LASTEXITCODE -eq 0

Write-Host ""
if ($testOk) {
  Write-Host "  Lista." -ForegroundColor Green
} else {
  Write-Host "  Creada, pero npm test falló. Corrélo a mano para ver qué pasó." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "    cd $Path" -ForegroundColor White
Write-Host "    npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "  Después: la marca (index.html + icons.js), y vaciar las vistas de app.js." -ForegroundColor DarkGray
Write-Host ""
