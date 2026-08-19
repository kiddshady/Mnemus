/* ═══════════════════════════════════════════════════════════════════════════
   MNEMUS — el ícono, horneado desde el código
   La marca (el potencial de acción con su nodo) rasterizada sobre la baldosa:
   base Opal con su niebla, esquinas apenas redondeadas, a sangre — nada de
   glifo flotando en un margen transparente.

   Sin dependencias: SDF supersampleado ×4 + los encoders PNG/ICO propios
   (el patrón de NeonCode Pet, ya probado con electron-builder y NSIS).
   El master vive acá; el .ico es un artefacto que se regenera con
   `npm run icons`.
   ═══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
import { encodeICO, resample } from './ico.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build');

/* ── Lienzo ──────────────────────────────────────────────────────────────────
   Se pinta a 1024 (256 × 4 de supersampleo) y se baja con el box filter del
   encoder: el antialias sale del promedio, no de trucos por píxel. */
const S = 256;
const SS = 4;
const W = S * SS;

/* ── La marca, en la misma grilla 16 del brand ─────────────────────────────
   Escala 16 px por unidad (a 256): la traza ocupa ~200 px con aire simétrico.
   El offset vertical centra ópticamente el bbox (y 1.6–12.4). */
const K = 16 * SS;
const OX = 0;
const OY = 14 * SS;

const P = [[1.8, 10.5], [4.6, 10.5], [6.4, 3.2], [8.2, 12.4], [9.6, 10.5], [14.2, 10.5]]
  .map(([x, y]) => [x * K + OX, y * K + OY]);
const NODE = [6.4 * K + OX, 3.2 * K + OY];
const NODE_R = 1.6 * K;

const STROKE = 1.25 * K;      // la traza: 20 px a 256 — legible hasta en 16
const NODE_STROKE = 1.0 * K;  // el anillo, más fino y a media luz, como el trail
const TILE_R = 44 * SS;       // el redondeo de la baldosa (~17%)

const INK = [242, 244, 247];  // --op-text, la luz del sistema

/* ── Geometría ─────────────────────────────────────────────────────────── */

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rrectDist(x, y, half, r) {
  const qx = Math.abs(x - half) - (half - r);
  const qy = Math.abs(y - half) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/* Cobertura con rampa de 1 px de master: el resto del suavizado lo pone el
   downsample. */
const aa = (d) => Math.max(0, Math.min(1, 0.5 - d / SS));

/* ── Pintar el master ────────────────────────────────────────────────────── */

const master = new Uint8Array(W * W * 4);
const half = W / 2;

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const tile = aa(rrectDist(x, y, half, TILE_R));
    const o = (y * W + x) * 4;
    if (tile <= 0) continue;

    // La baldosa: base Opal…
    let r = 10; let g = 10; let b = 10;

    // …con su niebla: dos manchas de pura luz…
    const d1 = Math.hypot(x - 0.20 * W, y - 0.14 * W) / (0.75 * W);
    const d2 = Math.hypot(x - 0.82 * W, y - 0.78 * W) / (0.65 * W);
    const fog = 255 * (0.075 * Math.max(0, 1 - d1) ** 2 + 0.05 * Math.max(0, 1 - d2) ** 2);
    r += fog; g += fog; b += fog;

    // …el velo que hunde abajo…
    const t = Math.max(0, (y / W - 0.62) / 0.38);
    const velo = 1 - 0.12 * t;
    r *= velo; g *= velo; b *= velo;

    // …y el canto iluminado arriba, como toda hoja.
    if (y < 3 * SS) {
      const lit = 255 * 0.10 * (1 - y / (3 * SS));
      r += lit; g += lit; b += lit;
    }

    // El nodo: un anillo a media luz, detrás de la traza.
    const ringCov = aa(Math.abs(Math.hypot(x - NODE[0], y - NODE[1]) - NODE_R) - NODE_STROKE / 2) * 0.5;
    if (ringCov > 0) {
      r += (INK[0] - r) * ringCov;
      g += (INK[1] - g) * ringCov;
      b += (INK[2] - b) * ringCov;
    }

    // La traza, a plena luz.
    let dmin = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const d = segDist(x, y, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
      if (d < dmin) dmin = d;
    }
    const cov = aa(dmin - STROKE / 2);
    if (cov > 0) {
      r += (INK[0] - r) * cov;
      g += (INK[1] - g) * cov;
      b += (INK[2] - b) * cov;
    }

    master[o] = Math.round(Math.min(255, r));
    master[o + 1] = Math.round(Math.min(255, g));
    master[o + 2] = Math.round(Math.min(255, b));
    master[o + 3] = Math.round(tile * 255);
  }
}

/* ── Hornear ─────────────────────────────────────────────────────────────── */

const SIZES = [256, 128, 64, 48, 32, 24, 16];
const images = SIZES.map((size) => ({ size, data: resample(master, W, W, size, size) }));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.ico'), encodeICO(images));
fs.writeFileSync(path.join(OUT, 'icon-256.png'), encodePNG(256, 256, images[0].data));
fs.writeFileSync(path.join(OUT, 'icon-32.png'), encodePNG(32, 32, images.find((i) => i.size === 32).data));

const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024 * 10) / 10;
console.log(`icon.ico      ${kb('icon.ico')} kB  (${SIZES.join(', ')})`);
console.log(`icon-256.png  ${kb('icon-256.png')} kB`);
console.log(`icon-32.png   ${kb('icon-32.png')} kB  (control a tamaño real)`);
