// Level geometry: terrain heightfield carved by the track, tunnel through the mountain,
// cliff exit, stone arches, destructible spires, flagship wreck, force fields, neon guides, sky.
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import { S, ridgeAt, TRACK, FEATURES, RANGES, TYPE_NAMES, SECTOR_INFO, VALLEY_FLOOR, frameAt, newFrame, toWorld, idx, bounds } from './track.js';
import { fbm, ridged, noise2, smooth, lerp, clamp, rng } from './noise.js';
import { makeRockMaterial, forceFieldMaterial, softTex, smokeTex } from './shaders.js';
import { buildCapitalFleet } from './capital.js';

const KS = S / 1.45; // scale relative to the original 11 km layout
const HALF = 3400, G = 700; // inner terrain: 6800 m, ~9.7 m cells
let CX = 0, CZ = 0;
let HF = null; // Float32Array heights (G+1)^2

function dunes(x, z) {
  const w = noise2(x * 0.0018, z * 0.0018) * 5;
  const d = Math.sin(x * 0.016 + z * 0.006 + w);
  return 6 * d * d + 5 * fbm(x * 0.004, z * 0.004, 3);
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function baseHeight(x, z) {
  const n = fbm(x * 0.00052 + 3.1, z * 0.00052 - 7.3, 5);
  const m = smooth(-0.12, 0.28, n);
  let h = 6 + m * 310 + ridged(x * 0.0021, z * 0.0021) * 46 * m + fbm(x * 0.004, z * 0.004, 3) * 14;
  // valley basin (elongated along the wreck + dune sectors)
  const bd = segDist(x, z, -300 * S, 1180 * S, -1180 * S, 260 * S);
  const bm = 1 - smooth(560 * KS, 1100 * KS, bd);
  h = lerp(h, VALLEY_FLOOR + dunes(x, z), bm);
  return h;
}
function terrace(h, step = 24) {
  const q = h / step, f = Math.floor(q), r = q - f;
  return lerp(h, (f + smooth(0.3, 0.7, r)) * step, 0.65);
}

function computeHeightfield() {
  const T = TRACK, N = G + 1, cell = (HALF * 2) / G;
  const nd = new Float32Array(N * N).fill(1e12), ni = new Int32Array(N * N).fill(-1);
  const td = new Float32Array(N * N).fill(1e12);
  const ndN = new Float32Array(N * N).fill(1e12), niN = new Int32Array(N * N).fill(-1); // nearest open-air (non-tunnel) sample
  const R = 560, rc = Math.ceil(R / cell);
  const isTun = TYPE_NAMES.indexOf('tunnel');
  for (let i = 0; i < T.n; i += 3) {
    const x = T.px[i], z = T.pz[i];
    const gx = Math.round((x - CX + HALF) / cell), gz = Math.round((z - CZ + HALF) / cell);
    const tun = T.type[i] === isTun;
    for (let dz = -rc; dz <= rc; dz++) {
      const zz = gz + dz; if (zz < 0 || zz >= N) continue;
      const wz = CZ - HALF + zz * cell, ddz = wz - z;
      for (let dx = -rc; dx <= rc; dx++) {
        const xx = gx + dx; if (xx < 0 || xx >= N) continue;
        const wx = CX - HALF + xx * cell, ddx = wx - x;
        const d2 = ddx * ddx + ddz * ddz; if (d2 > R * R) continue;
        const k = zz * N + xx;
        if (d2 < nd[k]) { nd[k] = d2; ni[k] = i; }
        if (tun && d2 < td[k]) td[k] = d2;
        if (!tun && d2 < ndN[k]) { ndN[k] = d2; niN[k] = i; }
      }
    }
  }
  // portal planes
  const [t0, t1] = RANGES.tunnel;
  const fa = frameAt(t0, newFrame()), fb = frameAt(t1, newFrame());
  const H = new Float32Array(N * N);
  for (let zz = 0; zz < N; zz++) for (let xx = 0; xx < N; xx++) {
    const k = zz * N + xx;
    const x = CX - HALF + xx * cell, z = CZ - HALF + zz * cell;
    const b = baseHeight(x, z);
    let h = b;
    const i = ni[k];
    if (i >= 0) {
      const d = Math.sqrt(nd[k]);
      const ty = TYPE_NAMES[T.type[i]], F = T.floorY[i], hw = T.hw[i];
      const fn = fbm(x * 0.01, z * 0.01, 3);
      if (ty === 'tunnel') {
        h = b;
      } else if (ty === 'start') {
        const edge = hw + 300 + fn * 60;
        h = d < edge ? F + fn * 3 : lerp(F, Math.min(b, F - 40), smooth(edge, edge + 70, d));
        if (d > edge) h = terrace(h, 20);
      } else if (SECTOR_INFO[ty].open) {
        const floor = F + (ty === 'dunes' || ty === 'wreck' ? dunes(x, z) * 0.6 : fn * 3);
        h = lerp(floor, Math.max(b, floor), smooth(hw + 30, hw + 320, d));
      } else {
        const wallTop = Math.max(b, F + 140 + 60 * fbm(x * 0.003, z * 0.003, 3));
        const run = 16 + 26 * (fbm(x * 0.006 + 9, z * 0.006, 2) + 1);
        const t = smooth(hw + 6, hw + 6 + run, d);
        const jag = ridged(x * 0.02, z * 0.02, 3) * 18 * t * (1 - t) * 4;
        h = F + fn * 2.5 + (wallTop - F) * t + jag;
        if (t > 0.02) h = terrace(h, 22);
        // the split: a rock ridge down the middle divides the canyon into two lanes
        const rw = ty === 'split' ? ridgeAt(i * T.ds) : 0;
        if (rw > 0) {
          const top = F + 150 + 50 * fbm(x * 0.004 + 3, z * 0.004, 3) + ridged(x * 0.02, z * 0.02, 2) * 14;
          h = Math.max(h, lerp(h, terrace(top, 22), smooth(rw + 4, rw - 16, d)));
        }
      }
    }
    // mountain over the tunnel, sliced by the two portal planes (gives a sheer cliff at the exit)
    if (td[k] < 1e11) {
      const dT = Math.sqrt(td[k]);
      const ea = (x - fa.p.x) * fa.t.x + (z - fa.p.z) * fa.t.z;
      const eb = (x - fb.p.x) * fb.t.x + (z - fb.p.z) * fb.t.z;
      const nearOpen = niN[k] >= 0 && Math.sqrt(ndN[k]) < T.hw[niN[k]] + 90; // never bury another part of the course
      if (ea > -4 && eb < 0 && !nearOpen) {
        const m = 1 - smooth(330, 540, dT);
        const top = 440 + 110 * fbm(x * 0.002, z * 0.002, 4) + ridged(x * 0.008, z * 0.008) * 40;
        h = Math.max(h, lerp(h, terrace(top, 30), m));
      }
    }
    // nothing may rise into the flight corridor (except the split ridge)
    const io = niN[k];
    if (io >= 0) {
      const dO = Math.sqrt(ndN[k]), rw = TYPE_NAMES[T.type[io]] === 'split' ? ridgeAt(io * T.ds) : 0;
      if (dO < T.hw[io] + 2 && !(rw > 0 && dO < rw + 4)) h = Math.min(h, T.floorY[io] + 3);
    }
    H[k] = h;
  }
  return H;
}

export function heightAt(x, z) {
  const N = G + 1, cell = (HALF * 2) / G;
  const fx = (x - CX + HALF) / cell, fz = (z - CZ + HALF) / cell;
  if (fx < 0 || fz < 0 || fx >= G || fz >= G) return baseHeight(x, z);
  const ix = Math.floor(fx), iz = Math.floor(fz), wx = fx - ix, wz = fz - iz;
  const a = HF[iz * N + ix], b = HF[iz * N + ix + 1], c = HF[(iz + 1) * N + ix], d = HF[(iz + 1) * N + ix + 1];
  return lerp(lerp(a, b, wx), lerp(c, d, wx), wz);
}

function buildTerrainMesh(mat) {
  const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, G, G);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  // PlaneGeometry rows go from +z? after rotateX(-90): row index increases with z
  for (let i = 0; i < pos.count; i++) {
    const xx = i % (G + 1), zz = Math.floor(i / (G + 1));
    pos.setXYZ(i, CX - HALF + xx * (HALF * 2 / G), HF[zz * (G + 1) + xx], CZ - HALF + zz * (HALF * 2 / G));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = false;
  return m;
}

function buildFarTerrain(mat) {
  const SZ = 26000, n = 200;
  const geo = new THREE.PlaneGeometry(SZ, SZ, n, n); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + CX, z = pos.getZ(i) + CZ;
    const inside = Math.abs(x - CX) < HALF - 10 && Math.abs(z - CZ) < HALF - 10;
    let h = baseHeight(x, z) * (1 + smooth(4000, 11000, Math.hypot(x, z)) * 1.6);
    if (inside) h -= 50;
    pos.setXYZ(i, x, h, z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

// ---- tunnel tube ----
function buildTunnel(group) {
  const [t0, t1] = RANGES.tunnel;
  const SEG = 48, step = 4, R0 = 52;
  const f = newFrame();
  const verts = [], glow = [], idxs = [];
  const nRings = Math.ceil((t1 - t0 + 8) / step) + 1;
  const ringEvery = 36;
  const neon = [new THREE.Color(0xff2fd0), new THREE.Color(0x26f6ff)];
  for (let k = 0; k < nRings; k++) {
    const s = t0 - 4 + k * step;
    frameAt(s, f);
    const ringPhase = ((s - t0) % ringEvery + ringEvery) % ringEvery;
    const rg = Math.exp(-Math.pow(Math.min(ringPhase, ringEvery - ringPhase) / 7, 2));
    const col = neon[Math.floor((s - t0) / ringEvery) & 1];
    for (let j = 0; j <= SEG; j++) {
      const a = j / SEG * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      const rr = R0 + noise2(s * 0.05, j * 0.7) * 3.5 + noise2(s * 0.013, j * 0.23) * 4 + (cy < -0.6 ? -4 * (-cy - 0.6) : 0);
      verts.push(f.p.x + (f.r.x * cx + f.u.x * cy) * rr, f.p.y + (f.r.y * cx + f.u.y * cy) * rr, f.p.z + (f.r.z * cx + f.u.z * cy) * rr);
      const floorStrip = Math.abs(cx) < 0.12 && cy < 0 ? 0.25 : 0;
      glow.push(col.r * (rg * 0.55 + floorStrip), col.g * (rg * 0.55 + floorStrip), col.b * (rg * 0.55 + floorStrip));
    }
  }
  const row = SEG + 1;
  for (let k = 0; k < nRings - 1; k++) for (let j = 0; j < SEG; j++) {
    const a = k * row + j, b = a + 1, c = a + row, d = c + 1;
    idxs.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 3));
  geo.setIndex(idxs); geo.computeVertexNormals();
  const mat = makeRockMaterial({ tint: 0.55 });
  const base = mat.onBeforeCompile;
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    base(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aGlow; varying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vGlow * (0.4 + 0.6*diffuseColor.r) * 0.55;');
  };
  const tube = new THREE.Mesh(geo, mat); tube.receiveShadow = false;
  group.add(tube);
  // neon rings
  const ringGeo = new THREE.TorusGeometry(R0 - 3, 0.5, 6, 64);
  const count = Math.floor((t1 - t0) / ringEvery);
  const rings = [new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: neon[0].clone().multiplyScalar(2.2) }), count),
    new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: neon[1].clone().multiplyScalar(2.2) }), count)];
  const c = [0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let k = 0; k < count; k++) {
    const s = t0 + k * ringEvery; frameAt(s, f);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate()));
    m4.compose(f.p, q, new THREE.Vector3(1, 1, 1));
    rings[k & 1].setMatrixAt(c[k & 1]++, m4);
  }
  rings.forEach((r, i) => { r.count = c[i]; group.add(r); });
  // portal frames
  for (const s of [t0, t1]) {
    frameAt(s, f);
    const fr = new THREE.Mesh(new THREE.TorusGeometry(R0 + 2, 1.1, 8, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a6a).multiplyScalar(1.7) }));
    fr.position.copy(f.p); fr.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate()));
    group.add(fr);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(R0 + 9, 4, 6, 8), new THREE.MeshStandardMaterial({ color: 0x2a2d35, metalness: 0.8, roughness: 0.4 }));
    outer.position.copy(f.p); outer.quaternion.copy(fr.quaternion); group.add(outer);
  }
  return { portalA: frameAt(t0, newFrame()), portalB: frameAt(t1, newFrame()), radius: R0 + 1 };
}

function displaceGeo(geo, amp, freq, seed = 0) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise2(v.x * freq + seed, v.z * freq + v.y * freq * 0.7) * amp + noise2(v.y * freq * 2.3 + seed, v.x * freq * 2.1) * amp * 0.5;
    const len = v.length() || 1;
    v.multiplyScalar(1 + n / Math.max(len, 1) * 0.6);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildArches(group, rockMat) {
  const f = newFrame();
  for (const a of FEATURES.arches) {
    frameAt(a.s, f);
    const b = bounds(a.s);
    const Ra = b.hw + 26; a.Ra = Ra; a.yc = a.y - Ra;
    let geo = new THREE.TorusGeometry(Ra, a.thick, 14, 80, Math.PI);
    geo = geo.toNonIndexed(); displaceGeo(geo, 5, 0.05, a.s);
    const m = new THREE.Mesh(geo, rockMat);
    m.position.copy(f.p).addScaledVector(f.u, a.yc);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate()));
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
}

export function buildSpireGeometry(seed, radius, height) {
  let geo = new THREE.CylinderGeometry(radius * 0.55, radius * 1.15, height, 10, 12);
  geo.translate(0, height / 2, 0);
  geo = geo.toNonIndexed();
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const n = 1 + noise2(a * 1.6 + seed, v.y * 0.05) * 0.22 + noise2(a * 4 + seed, v.y * 0.2) * 0.07;
    const ledge = 1 + 0.12 * Math.max(0, Math.sin(v.y * 0.18 + seed));
    p.setXYZ(i, v.x * n * ledge, v.y, v.z * n * ledge);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildSpires(group, rockMat) {
  const meshes = [];
  for (const sp of FEATURES.spires) {
    const w = toWorld(sp.s, sp.x, 0);
    const base = heightAt(w.x, w.z) - 6;
    const cy = TRACK.py[idx(sp.s)];
    const bb = bounds(sp.s); const top = cy + bb.yMin + 55 + (sp.id % 4) * 14;
    sp.height = top - base; sp.baseY = base;
    sp.topY = top - cy; // track-space
    const m = new THREE.Mesh(buildSpireGeometry(sp.id * 3.7, sp.radius, sp.height), rockMat);
    m.position.set(w.x, base, w.z); m.castShadow = true; m.receiveShadow = true;
    group.add(m); sp.mesh = m; meshes.push(m);
  }
  return meshes;
}

function buildRocks(group, rockMat) {
  const r = rng(5);
  const probe = []; for (let i = 0; i < TRACK.n; i += 5) if (TYPE_NAMES[TRACK.type[i]] !== 'tunnel') probe.push(i);
  const clear = (x, z, rad) => { for (const i of probe) { const dx = x - TRACK.px[i], dz = z - TRACK.pz[i], m = TRACK.hw[i] + rad + 6; if (dx * dx + dz * dz < m * m) return false; } return true; };
  const geos = [0, 1, 2].map(k => { let g = mergeVertices(new THREE.IcosahedronGeometry(1, 3)); return displaceGeo(g, 0.35, 1.3, k * 10); });
  const per = 900;
  const inst = geos.map(g => new THREE.InstancedMesh(g, rockMat, per));
  const cnt = [0, 0, 0];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let n = 0; n < per * 3; n++) {
    const s = r() * TRACK.length; const b = bounds(s);
    if (b.tunnel) continue;
    const side = r() < 0.5 ? -1 : 1;
    const sc = 1.5 + Math.pow(r(), 3) * (SECTOR_INFO[b.type].open ? 22 : 12);
    const x = side * (b.hw + 6 + sc * 1.2 + r() * (SECTOR_INFO[b.type].open ? 260 : 40));
    const w = toWorld(s, x, 0); const h = heightAt(w.x, w.z);
    if (!clear(w.x, w.z, sc * 1.2)) continue;
    const k = n % 3; if (cnt[k] >= per) continue;
    e.set(r() * 6, r() * 6, r() * 6); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(w.x, h + sc * 0.2, w.z), q, new THREE.Vector3(sc, sc * (0.6 + r() * 0.5), sc));
    inst[k].setMatrixAt(cnt[k]++, m4);
  }
  inst.forEach((m, i) => { m.count = cnt[i]; m.castShadow = true; m.receiveShadow = true; group.add(m); });
}

function buildWreckRibs(group) {
  const f = newFrame();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2522, metalness: 0.6, roughness: 0.7 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x3d3a38, metalness: 0.7, roughness: 0.55, side: THREE.DoubleSide });
  const r = rng(11);
  for (const rib of FEATURES.ribs) {
    frameAt(rib.s, f);
    const floor = VALLEY_FLOOR - 4;
    const tilt = (r() - 0.5) * 0.12;
    const geo = new THREE.TorusGeometry(rib.r, 4.5, 6, 48, Math.PI);
    const m = new THREE.Mesh(geo, mat);
    const fr = f.r.clone(); fr.y = 0; fr.normalize();
    const ft = new THREE.Vector3().crossVectors(fr, new THREE.Vector3(0, 1, 0)).normalize();
    const basis = new THREE.Matrix4().makeBasis(fr, new THREE.Vector3(0, 1, 0), ft);
    m.quaternion.setFromRotationMatrix(basis); m.rotateZ(tilt);
    m.position.set(f.p.x, floor, f.p.z);
    m.castShadow = true; group.add(m);
    rib.cx = f.p.x; rib.cz = f.p.z; rib.floor = floor;
    // hanging hull plates on some ribs
    if (r() < 0.6) {
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(rib.r + 3, rib.r + 3, 26, 24, 1, true, 0, 0.6 + r() * 0.7), plate);
      pl.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.t.clone().negate(), new THREE.Vector3(0, -1, 0)));
      pl.rotateY(r() * Math.PI);
      pl.position.set(f.p.x, floor, f.p.z); pl.castShadow = true; group.add(pl);
    }
  }
  // spine beam along the top
  frameAt(FEATURES.wreckS, f);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 300), mat);
  spine.position.set(f.p.x, VALLEY_FLOOR + 150, f.p.z); spine.lookAt(spine.position.clone().add(f.t)); spine.rotateZ(0.05);
  spine.position.addScaledVector(f.r, -20);
  group.add(spine);
}

// fires + smoke columns at the wreck
function buildFires(group) {
  const fires = [];
  const f = newFrame(); const r = rng(3);
  for (let i = 0; i < 9; i++) {
    frameAt(FEATURES.wreckS + (i - 4) * 70, f);
    const side = r() < 0.5 ? -1 : 1;
    const p = f.p.clone().addScaledVector(f.r, side * (170 + r() * 160));
    p.y = heightAt(p.x, p.z) + 4;
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xff7a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    fire.position.copy(p); fire.scale.setScalar(40); group.add(fire);
    const smokes = [];
    for (let k = 0; k < 7; k++) {
      const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color: 0x2a2220, transparent: true, depthWrite: false, opacity: 0.6 }));
      sm.position.copy(p); group.add(sm); smokes.push({ sp: sm, ph: k / 7 });
    }
    fires.push({ fire, smokes, p, seed: r() * 10 });
  }
  return fires;
}

function buildForceFields(group) {
  // ceiling ribbon everywhere except tunnel; side walls in open sectors
  const f = newFrame();
  const build = (fn, filter) => {
    const pos = [], base = [], uv = [], ix = [];
    let k = 0, lastOk = false, s = 0;
    for (let i = 0; i < TRACK.n; i += 4) {
      s = i * TRACK.ds; const ty = TYPE_NAMES[TRACK.type[i]];
      const ok = filter(ty);
      if (!ok) { lastOk = false; continue; }
      frameAt(s, f);
      const [a, b, bs] = fn(s, f, i, ty);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); base.push(bs, bs);
      uv.push(0, s, a.distanceTo(b), s);
      if (lastOk) ix.push(k - 2, k - 1, k, k - 1, k + 1, k);
      k += 2; lastOk = true;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 1));
    g.setIndex(ix); return g;
  };
  const mats = [];
  const cm = forceFieldMaterial(0x39f2ff); mats.push(cm);
  const ceil = build((s, f, i, ty) => {
    const hw = TRACK.hw[i] + 20, y = TRACK.ceilY[i];
    const a = f.p.clone().addScaledVector(f.r, -hw); a.y = y;
    const b = f.p.clone().addScaledVector(f.r, hw); b.y = y;
    return [a, b, ty === 'dunes' ? 1 : 0.25];
  }, ty => ty !== 'tunnel');
  group.add(new THREE.Mesh(ceil, cm));
  const wm = forceFieldMaterial(0xff3ad0); mats.push(wm);
  for (const side of [-1, 1]) {
    const wall = build((s, f, i) => {
      const hw = TRACK.hw[i];
      const a = f.p.clone().addScaledVector(f.r, side * hw); a.y = TRACK.floorY[i] - 10;
      const b = a.clone(); b.y = TRACK.ceilY[i];
      return [a, b, 0.08];
    }, ty => SECTOR_INFO[ty].open && ty !== 'tunnel');
    group.add(new THREE.Mesh(wall, wm));
  }
  return mats;
}

function buildGuides(group) {
  const f = newFrame();
  const geo = new THREE.BoxGeometry(1.2, 1.2, 5);
  const L = TRACK.length, every = 26;
  const n = Math.floor(L / every);
  const mats = [new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2fb0).multiplyScalar(3.2) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x24f2ff).multiplyScalar(3.2) })];
  const inst = mats.map(m => new THREE.InstancedMesh(geo, m, n));
  const c = [0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let k = 0; k < n; k++) {
    const s = k * every; const b = bounds(s); if (b.tunnel) continue;
    frameAt(s, f);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate()));
    for (const side of [-1, 1]) {
      const p = f.p.clone().addScaledVector(f.r, side * (b.hw - 3));
      p.y = Math.max(heightAt(p.x, p.z) + 1.2, TRACK.floorY[idx(s)] + 1.2);
      m4.compose(p, q, new THREE.Vector3(1, 1, 1));
      const j = side < 0 ? 0 : 1; inst[j].setMatrixAt(c[j]++, m4);
    }
  }
  inst.forEach((m, i) => { m.count = c[i]; group.add(m); });
}

function buildStartGate(group) {
  const f = frameAt(0, newFrame()); const b = bounds(0);
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.85, roughness: 0.35 });
  const hw = b.hw + 8, h = b.yMax + 20;
  for (const side of [-1, 1]) {
    const py = new THREE.Mesh(new THREE.BoxGeometry(10, h - b.yMin + 30, 10), metal);
    py.position.set(side * hw, (h + b.yMin - 30) / 2, 0); g.add(py);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, h - b.yMin + 20, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(side < 0 ? 0xff2fb0 : 0x24f2ff).multiplyScalar(1.6) }));
    strip.position.set(side * (hw - 5.6), (h + b.yMin - 30) / 2, 5.2); g.add(strip);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 10, 12, 10), metal); beam.position.y = h; g.add(beam);
  // checker banner
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64; const x = c.getContext('2d');
  for (let i = 0; i < 64; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 16, j * 16, 16, 16); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: 0xffffff }));
  ban.position.set(0, h, 5.2); g.add(ban);
  const lc = document.createElement('canvas'); lc.width = 1024; lc.height = 128; const lx = lc.getContext('2d');
  lx.fillStyle = '#000'; lx.fillRect(0, 0, 1024, 128); lx.font = 'bold 92px Arial'; lx.textAlign = 'center'; lx.fillStyle = '#ff3a6a';
  lx.fillText('RED  RIFT  ·  ПОРТ РИФТ', 512, 98);
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.6, hw * 0.2), new THREE.MeshBasicMaterial({ map: lt, side: THREE.DoubleSide, color: new THREE.Color(2, 2, 2) }));
  logo.position.set(0, h + 18, 0); g.add(logo);
  g.position.copy(f.p);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate()));
  group.add(g);
}

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(30000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec3 d = normalize(vD); float y = d.y;
        vec3 zen = vec3(0.05,0.03,0.16), mid = vec3(0.32,0.10,0.34), hor = vec3(1.0,0.45,0.28), low = vec3(0.35,0.14,0.16);
        vec3 c = mix(hor, mid, smoothstep(0.0,0.22,y)); c = mix(c, zen, smoothstep(0.2,0.75,y)); c = mix(c, low, smoothstep(0.0,-0.2,y));
        float sd = max(dot(d, normalize(uSun)),0.0);
        c += vec3(1.0,0.55,0.25)*pow(sd,8.0)*0.6 + vec3(1.0,0.8,0.55)*pow(sd,220.0)*2.5 + vec3(1.0,0.6,0.3)*pow(sd,2.0)*0.12;
        // thin neon cloud bands
        float band = sin(y*80.0 + d.x*6.0 + sin(d.z*9.0)*2.0)*0.5+0.5;
        c += vec3(0.9,0.25,0.5)*smoothstep(0.92,1.0,band)*smoothstep(0.03,0.12,y)*smoothstep(0.35,0.15,y)*0.25;
        // stars
        vec2 g = floor(vec2(atan(d.z,d.x)*300.0, y*300.0)); float st = step(0.997, h(g)) * smoothstep(0.25,0.7,y);
        c += vec3(st)*0.9;
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat); sky.renderOrder = -1; sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export function buildWorld(scene, renderer, onProgress = () => {}) {
  // centre terrain on the track bounding box
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < TRACK.n; i++) { minx = Math.min(minx, TRACK.px[i]); maxx = Math.max(maxx, TRACK.px[i]); minz = Math.min(minz, TRACK.pz[i]); maxz = Math.max(maxz, TRACK.pz[i]); }
  CX = (minx + maxx) / 2; CZ = (minz + maxz) / 2;
  HF = computeHeightfield();
  onProgress(0.4);
  const world = new THREE.Group(); scene.add(world);

  const sunDir = new THREE.Vector3(-0.72, 0.2, 0.66).normalize();
  const sky = buildSky(scene); sky.material.uniforms.uSun.value.copy(sunDir);
  scene.fog = new THREE.Fog(0x8a3a58, 1400, 9000);
  scene.background = new THREE.Color(0x2a1030);

  const hemi = new THREE.HemisphereLight(0x8a72ff, 0x6a3020, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
  sun.position.copy(sunDir).multiplyScalar(600);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -180; sc.right = 180; sc.top = 180; sc.bottom = -180; sc.near = 10; sc.far = 1600;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const tunnelInfo = { portalA: frameAt(RANGES.tunnel[0], newFrame()), portalB: frameAt(RANGES.tunnel[1], newFrame()) };
  const terrainMat = makeRockMaterial();
  const tg = new THREE.Group(); world.add(tg);
  const tinfo = buildTunnel(tg);
  const U = terrainMat.userData.uniforms;
  U.uPortA.value.copy(tinfo.portalA.p); U.uDirA.value.copy(tinfo.portalA.t);
  U.uPortB.value.copy(tinfo.portalB.p); U.uDirB.value.copy(tinfo.portalB.t); U.uPR.value = tinfo.radius;
  world.add(buildTerrainMesh(terrainMat));
  const far = buildFarTerrain(makeRockMaterial({ tint: 0.95 })); far.name = 'far'; world.add(far);
  onProgress(0.6);
  const rockMat = makeRockMaterial();
  buildArches(world, rockMat);
  buildSpires(world, rockMat);
  buildRocks(world, rockMat);
  buildWreckRibs(world);
  const fires = buildFires(world);
  const ffMats = buildForceFields(world);
  buildGuides(world);
  buildStartGate(world);
  onProgress(0.8);
  const fleet = buildCapitalFleet(scene, frameAt(0, newFrame()).p, frameAt(FEATURES.wreckS, newFrame()));

  // environment map for shiny ships
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = buildSky(envScene); envSky.material.uniforms.uSun.value.copy(sunDir);
  envScene.add(new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2).translate(0, -200, 0), new THREE.MeshBasicMaterial({ color: 0x5a2416 })));
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.5;

  let time = 0;
  const update = (dt, focus, inTunnel, shadowFocus = focus) => {
    time += dt;
    sun.target.position.copy(shadowFocus); sun.position.copy(shadowFocus).addScaledVector(sunDir, 700);
    const k = inTunnel ? 0.08 : 1;
    sun.intensity += (2.6 * k - sun.intensity) * Math.min(1, dt * 4);
    hemi.intensity += (0.7 * (inTunnel ? 0.25 : 1) - hemi.intensity) * Math.min(1, dt * 4);
    for (const m of ffMats) { m.uniforms.uPlayer.value.copy(focus); m.uniforms.uTime.value = time; }
    fleet.update(dt, time);
    for (const fr of fires) {
      fr.fire.scale.setScalar(36 + Math.sin(time * 9 + fr.seed) * 5 + Math.random() * 4);
      for (const s of fr.smokes) {
        const ph = (s.ph + time * 0.05) % 1;
        s.sp.position.set(fr.p.x + Math.sin(ph * 3 + fr.seed) * 20 + ph * 60, fr.p.y + ph * 260, fr.p.z + ph * 40);
        s.sp.scale.setScalar(40 + ph * 180); s.sp.material.opacity = 0.55 * (1 - ph);
      }
    }
  };
  onProgress(1);
  return { world, sun, update, fleet, heightAt };
}
