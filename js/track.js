// Closed race loop through the desert. Everything in the race lives in "track space":
// s = distance along centreline (m), x = lateral offset (+right), y = vertical offset (+up).
import * as THREE from 'three';
import { rng, clamp } from './noise.js';

export const S = 2.17; // map scale: gives an ~18 km lap
// x, z, centreY, halfWidth, halfHeight, sector
const RAW = [
  [0, -1100, 300, 95, 70, 'start'],
  [450, -1080, 296, 95, 70, 'start'],
  [800, -900, 262, 70, 68, 'canyon'],
  [1000, -650, 232, 58, 66, 'canyon'],
  [1240, -470, 214, 60, 66, 'canyon'],
  [1080, -260, 198, 58, 66, 'canyon'],
  [1260, -40, 186, 64, 66, 'canyon'],
  [1150, 200, 176, 82, 70, 'arches'],
  [1260, 430, 178, 78, 70, 'arches'],
  [1080, 640, 190, 78, 70, 'arches'],
  [820, 830, 202, 46, 40, 'tunnel'],
  [450, 1010, 208, 46, 40, 'tunnel'],
  [140, 1100, 212, 46, 40, 'tunnel'],
  // out of the mountain straight into a narrow gorge that drops ~170 m
  [-120, 1180, 105, 110, 95, 'gorge'],
  [-330, 1140, 25, 52, 80, 'gorge'],
  [-560, 1210, 40, 150, 120, 'wreck'],
  [-800, 1040, 50, 150, 90, 'wreck'],
  // wide canyon split by a rock ridge: two lanes, pick one
  [-930, 780, 56, 150, 80, 'split'],
  [-1120, 520, 58, 150, 80, 'split'],
  [-1180, 260, 60, 130, 60, 'dunes'],
  [-1060, 40, 66, 110, 60, 'climb'],
  [-1240, -200, 110, 80, 70, 'climb'],
  [-1060, -420, 170, 80, 70, 'climb'],
  [-1210, -640, 220, 84, 70, 'climb'],
  [-880, -830, 262, 90, 70, 'start'],
  [-460, -1030, 292, 95, 70, 'start'],
];

export const SECTOR_INFO = {
  start: { name: 'ПОРТ РИФТ', open: true },
  canyon: { name: 'КРАСНЫЙ КАНЬОН', open: false },
  arches: { name: 'КАМЕННЫЕ АРКИ', open: false },
  tunnel: { name: 'ТОННЕЛЬ «ГОРЛО»', open: false },
  gorge: { name: 'УЩЕЛЬЕ «ПРОВАЛ»', open: false },
  wreck: { name: 'ДОЛИНА ФЛАГМАНА', open: true },
  split: { name: 'РАЗВИЛКА «КЛЫКИ»', open: false },
  dunes: { name: 'ДЮННОЕ МОРЕ', open: true },
  climb: { name: 'СЕРПАНТИН', open: false },
};
const TYPES = Object.keys(SECTOR_INFO);
export const VALLEY_FLOOR = -26;

function buildTrack() {
  const pts = RAW.map(r => new THREE.Vector3(r[0] * S, r[2], r[1] * S));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const N = RAW.length;
  // dense sampling over parameter t, accumulate length
  const M = 20000;
  const tp = [], cum = [0];
  let prev = curve.getPoint(0);
  tp.push(prev);
  for (let i = 1; i <= M; i++) {
    const p = curve.getPoint(i / M);
    cum.push(cum[i - 1] + p.distanceTo(prev));
    tp.push(p); prev = p;
  }
  const length = cum[M];
  const DS = 2;
  const n = Math.floor(length / DS);
  const T = {
    length, ds: DS, n,
    px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
    tx: new Float32Array(n), ty: new Float32Array(n), tz: new Float32Array(n),
    rx: new Float32Array(n), rz: new Float32Array(n),
    ux: new Float32Array(n), uy: new Float32Array(n), uz: new Float32Array(n),
    hw: new Float32Array(n), floorY: new Float32Array(n), ceilY: new Float32Array(n),
    type: new Uint8Array(n), sectorStart: {}, ctrlS: [],
  };
  let k = 0;
  const ctrlS = new Array(N).fill(0);
  for (let i = 0; i < n; i++) {
    const target = i * DS;
    while (k < M && cum[k + 1] < target) k++;
    const f = (target - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
    const t = (k + f) / M;
    const p = tp[k].clone().lerp(tp[k + 1], f);
    T.px[i] = p.x; T.py[i] = p.y; T.pz[i] = p.z;
    const seg = Math.floor(t * N) % N, lt = t * N - Math.floor(t * N);
    const a = RAW[seg], b = RAW[(seg + 1) % N];
    const e = lt * lt * (3 - 2 * lt);
    T.hw[i] = a[3] + (b[3] - a[3]) * e;
    const vh = a[4] + (b[4] - a[4]) * e;
    T.type[i] = TYPES.indexOf(a[5]);
    if (a[5] === 'tunnel') T.hw[i] = Math.min(T.hw[i], 46); // the tube does not widen with the gorge ahead
    if (lt * N < 1e-9 || (i > 0 && Math.floor(((k + f - 0.0001) / M) * N) !== seg)) ctrlS[seg] = target;
    let floor = p.y - vh - 6;
    if (a[5] === 'wreck' || a[5] === 'dunes' || a[5] === 'split') floor = Math.max(VALLEY_FLOOR, Math.min(floor, VALLEY_FLOOR + 30));
    T.floorY[i] = floor;
    T.ceilY[i] = p.y + vh * 1.5;
  }
  // tangents and frames
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    const tg = new THREE.Vector3(T.px[b] - T.px[a], T.py[b] - T.py[a], T.pz[b] - T.pz[a]).normalize();
    const r = new THREE.Vector3().crossVectors(tg, up).normalize();
    const u = new THREE.Vector3().crossVectors(r, tg).normalize();
    T.tx[i] = tg.x; T.ty[i] = tg.y; T.tz[i] = tg.z;
    T.rx[i] = r.x; T.rz[i] = r.z;
    T.ux[i] = u.x; T.uy[i] = u.y; T.uz[i] = u.z;
  }
  // smooth floor / ceiling so transitions are not stair-stepped (except cliff edge)
  for (let pass = 0; pass < 2; pass++) {
    for (const arr of [T.ceilY, T.floorY]) {
      const c = arr.slice();
      for (let i = 0; i < n; i++) { let s = 0; for (let j = -20; j <= 20; j++) s += c[(i + j + n) % n]; arr[i] = s / 41; }
    }
  }
  // sector starts
  for (let i = 0; i < n; i++) {
    const ty = T.type[i], pt = T.type[(i - 1 + n) % n];
    if (ty !== pt) { (T.sectorStart[TYPES[ty]] ??= []).push(i * DS); }
  }
  T.ctrlS = ctrlS;
  return T;
}

export const TRACK = buildTrack();
export const TYPE_NAMES = TYPES;

export function wrapS(s) { const L = TRACK.length; return ((s % L) + L) % L; }
export function idx(s) { return Math.floor(wrapS(s) / TRACK.ds) % TRACK.n; }
export function typeAt(s) { return TYPES[TRACK.type[idx(s)]]; }
export function sectorName(s) { return SECTOR_INFO[typeAt(s)].name; }

// fill out: {p:Vector3, t, r, u} frame at s (linear interp)
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function frameAt(s, out) {
  const T = TRACK, f = wrapS(s) / T.ds, i = Math.floor(f) % T.n, j = (i + 1) % T.n, w = f - Math.floor(f);
  out.p.set(T.px[i] + (T.px[j] - T.px[i]) * w, T.py[i] + (T.py[j] - T.py[i]) * w, T.pz[i] + (T.pz[j] - T.pz[i]) * w);
  out.t.set(T.tx[i] + (T.tx[j] - T.tx[i]) * w, T.ty[i] + (T.ty[j] - T.ty[i]) * w, T.tz[i] + (T.tz[j] - T.tz[i]) * w).normalize();
  out.r.set(T.rx[i] + (T.rx[j] - T.rx[i]) * w, 0, T.rz[i] + (T.rz[j] - T.rz[i]) * w).normalize();
  out.u.crossVectors(out.r, out.t).normalize();
  return out;
}
export function newFrame() { return { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() }; }

const _f = newFrame();
export function toWorld(s, x, y, out = new THREE.Vector3()) {
  frameAt(s, _f);
  return out.copy(_f.p).addScaledVector(_f.r, x).addScaledVector(_f.u, y);
}

// corridor limits at s (track-space offsets)
export function bounds(s) {
  const T = TRACK, i = idx(s), cy = T.py[i];
  const ty = TYPES[T.type[i]];
  return {
    tunnel: ty === 'tunnel', hw: T.hw[i],
    yMin: T.floorY[i] - cy + 5, yMax: T.ceilY[i] - cy, type: ty,
  };
}

// ---- Level features (deterministic) ----
function range(type) { // [start,end) of the first run of this sector type
  const T = TRACK; let st = -1, en = -1;
  for (let i = 0; i < T.n; i++) {
    const ty = TYPES[T.type[i]];
    if (ty === type && st < 0) st = i;
    if (st >= 0 && ty !== type) { en = i; break; }
  }
  if (en < 0) en = T.n;
  return [st * T.ds, en * T.ds];
}
export const RANGES = Object.fromEntries(TYPES.map(t => [t, range(t)]));
// start sector wraps around s=0; real start line at s=0
RANGES.tunnel = range('tunnel');

let RIDGE = null;
function buildFeatures() {
  const r = rng(77);
  const F = { arches: [], spires: [], ribs: [], pickups: [], checkpoints: [], boostRings: [] };
  const [a0, a1] = RANGES.arches;
  for (let k = 0; k < 4; k++) {
    const s = a0 + (a1 - a0) * (0.15 + k * 0.23);
    F.arches.push({ s, y: 48 + r() * 14, thick: 14 });
  }
  // destructible rock spires inside the corridor
  const spireZones = ['canyon', 'climb', 'wreck', 'dunes', 'arches'];
  for (const z of spireZones) {
    const [z0, z1] = RANGES[z];
    const count = z === 'dunes' || z === 'wreck' ? 6 : 4;
    for (let k = 0; k < count; k++) {
      const s = z0 + (z1 - z0) * ((k + 0.5) / count) + (r() - 0.5) * 60;
      const hw = TRACK.hw[idx(s)];
      const x = (r() < 0.5 ? -1 : 1) * hw * (0.25 + r() * 0.5);
      F.spires.push({ s, x, radius: 9 + r() * 5, alive: true, id: F.spires.length });
    }
  }
  const [w0, w1] = RANGES.wreck;
  const ws = w0 + (w1 - w0) * 0.55;
  for (let k = 0; k < 9; k++) F.ribs.push({ s: ws + (k - 4) * 34, r: 155 });
  F.wreckS = ws;
  // pickup groups: 9 per lap (every ~2 km from 1 km), 5 cases across the corridor
  const L = TRACK.length, k18 = L / 18000;
  for (let g = 0; g < 9; g++) {
    const s = (1000 + g * 2000) * k18;
    const b = bounds(s);
    for (let k = 0; k < 5; k++) {
      const x = b.tunnel ? (k - 2) * 14 : (k - 2) * Math.min(b.hw * 0.35, 30);
      const y = b.tunnel ? (k % 2 ? 8 : -6) : (k % 2 ? 14 : -4);
      F.pickups.push({ s, x, y, group: g, id: F.pickups.length });
    }
  }
  // dive column down the gorge after the tunnel
  const [c0] = RANGES.gorge;
  for (let k = 0; k < 4; k++) {
    const s = c0 + 160 + k * 170;
    F.pickups.push({ s, x: (k % 2 ? 1 : -1) * 10, y: bounds(s).yMin + 22 + (k % 2) * 10, group: 9, id: F.pickups.length });
  }
  // the split: a lens-shaped rock ridge down the middle of the 'split' sector
  const [p0, p1] = RANGES.split;
  RIDGE = F.ridge = { s0: p0 + 120, s1: p1 - 60, w: 36 };
  // the right lane gets a boost ring, the left lane keeps the cases: a real choice
  F.boostRings.push({ s: (RIDGE.s0 + RIDGE.s1) / 2, x: RIDGE.w + 24, y: 10 }); // on the lane line the AI flies
  // keep cases off the ridge
  for (const pk of F.pickups) { const w = ridgeAt(pk.s); if (w > 0) pk.x = Math.sign(pk.x || (pk.id % 2 ? 1 : -1)) * (w + 18 + Math.abs(pk.x) * 0.4); }
  // checkpoints every ~1 km, passed in order; the last one is the start/finish line
  const nCp = Math.max(1, Math.round(L / 1000));
  for (let k = 1; k <= nCp; k++) F.checkpoints.push(k * L / nCp);
  F.groups = 10;
  // boost rings (fly through = short speed burst)
  for (const s of [RANGES.canyon[0] + 300, RANGES.dunes[0] + 350, RANGES.climb[0] + 250, RANGES.wreck[0] + 120]) {
    F.boostRings.push({ s, x: 0, y: 10 });
  }
  return F;
}
export const FEATURES = buildFeatures();
// half width of the central ridge at s (0 outside the split)
export function ridgeAt(s) {
  const R = RIDGE; if (!R) return 0;
  const t = (wrapS(s) - R.s0) / (R.s1 - R.s0); if (t <= 0 || t >= 1) return 0;
  return R.w * Math.pow(Math.sin(Math.PI * t), 0.55);
}

export function clampToBounds(s, x, y) {
  const b = bounds(s);
  if (b.tunnel) {
    const r = Math.hypot(x, y), m = b.hw - 6;
    if (r > m) { x *= m / r; y *= m / r; }
  } else {
    x = clamp(x, -b.hw + 4, b.hw - 4); y = clamp(y, b.yMin, b.yMax - 3);
  }
  return [x, y];
}
