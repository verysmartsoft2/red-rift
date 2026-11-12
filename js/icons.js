// Item icons after references/.../03_Weapons_Pickups_Damage/02_Seven_Flying_Pickups.png:
// boost = lightning, chrono (drag field) = chevrons, nova = four-point star in a ring, shield = shield,
// repair = cross, holo (decoy) = two jets with trails, emp = concentric arcs.
// Drawn on a canvas so the same art serves the 3D case hologram and the HUD.
import * as THREE from 'three';

function path(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
function jet(ctx, x, y, s) {
  path(ctx, [[x + 0.5 * s, y], [x + 0.1 * s, y - 0.09 * s], [x - 0.02 * s, y - 0.32 * s], [x - 0.14 * s, y - 0.32 * s], [x - 0.08 * s, y - 0.08 * s], [x - 0.36 * s, y - 0.06 * s],
    [x - 0.46 * s, y - 0.2 * s], [x - 0.52 * s, y - 0.2 * s], [x - 0.48 * s, y], [x - 0.52 * s, y + 0.2 * s], [x - 0.46 * s, y + 0.2 * s], [x - 0.36 * s, y + 0.06 * s],
    [x - 0.08 * s, y + 0.08 * s], [x - 0.14 * s, y + 0.32 * s], [x - 0.02 * s, y + 0.32 * s], [x + 0.1 * s, y + 0.09 * s]]);
  ctx.fill();
  for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.7 - k * 0.2; ctx.fillRect(x - s * (0.62 + k * 0.28), y - s * 0.03, s * 0.24, s * 0.06); }
  ctx.globalAlpha = 1;
}

export function drawIcon(ctx, key, color, S) {
  const c = S / 2;
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = S * 0.08;
  switch (key) {
    case 'boost':
      path(ctx, [[0.62, 0.08], [0.24, 0.55], [0.47, 0.55], [0.36, 0.92], [0.78, 0.4], [0.54, 0.4], [0.66, 0.08]].map(([x, y]) => [x * S, y * S])); ctx.fill(); break;
    case 'chrono':
      for (let k = 0; k < 3; k++) {
        const y = 0.18 + k * 0.22;
        path(ctx, [[0.22, y], [0.5, y + 0.14], [0.78, y], [0.78, y + 0.1], [0.5, y + 0.24], [0.22, y + 0.1]].map(([x, yy]) => [x * S, yy * S])); ctx.fill();
      }
      break;
    case 'nova': {
      const r1 = S * 0.42, r2 = S * 0.07;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 - Math.PI / 2, r = k % 2 ? r2 : r1; ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = S * 0.035;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(c, c, S * 0.3, k * Math.PI / 2 + 0.25, k * Math.PI / 2 + Math.PI / 2 - 0.25); ctx.stroke(); }
      break;
    }
    case 'shield':
      ctx.lineWidth = S * 0.06;
      path(ctx, [[0.5, 0.1], [0.82, 0.22], [0.78, 0.55], [0.5, 0.9], [0.22, 0.55], [0.18, 0.22]].map(([x, y]) => [x * S, y * S]));
      ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); break;
    case 'repair':
      ctx.fillRect(S * 0.38, S * 0.14, S * 0.24, S * 0.72); ctx.fillRect(S * 0.14, S * 0.38, S * 0.72, S * 0.24); break;
    case 'holo':
      jet(ctx, S * 0.62, S * 0.34, S * 0.42); ctx.globalAlpha = 0.85; jet(ctx, S * 0.5, S * 0.66, S * 0.5); ctx.globalAlpha = 1; break;
    case 'emp':
      ctx.lineWidth = S * 0.055;
      for (const [r, gap] of [[0.38, 0.5], [0.27, 0.6], [0.15, 0.8]]) for (let k = 0; k < 4; k++) {
        ctx.beginPath(); ctx.arc(c, c, S * r, k * Math.PI / 2 + gap * 0.5, k * Math.PI / 2 + Math.PI / 2 - gap * 0.5); ctx.stroke();
      }
      break;
    default:
      ctx.beginPath(); ctx.arc(c, c, S * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// scanlines over the glyph, like the hologram in the reference
function scan(ctx, S) {
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < S; y += 4) ctx.fillRect(0, y, S, 1.5);
  ctx.restore();
}

const TEX = {};
export function iconTexture(key, color) {
  const id = key + color;
  if (TEX[id]) return TEX[id];
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'); drawIcon(ctx, key, color, S); scan(ctx, S);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[id] = t);
}
const URLS = {};
export function iconURL(key, color, S = 96) {
  const id = key + color + S;
  if (URLS[id]) return URLS[id];
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  drawIcon(cv.getContext('2d'), key, color, S);
  return (URLS[id] = cv.toDataURL());
}
