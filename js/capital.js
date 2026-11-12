// Huge capital ships: hovering carriers over the start, patrol frigates, crashed flagship.
import * as THREE from 'three';
import { rng } from './noise.js';
import { softTex } from './shaders.js';

export function loft(stations, sides = 8, rot = Math.PI / 8) {
  const v = [], idx = [];
  for (const [z, w, h, y = 0] of stations)
    for (let j = 0; j < sides; j++) { const a = j / sides * Math.PI * 2 + rot; v.push(Math.cos(a) * w, y + Math.sin(a) * h, z); }
  for (let i = 0; i < stations.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      idx.push(a, a + sides, b, b, a + sides, b + sides);
    }
  const k = (stations.length - 1) * sides;
  for (let j = 1; j < sides - 1; j++) { idx.push(0, j, j + 1); idx.push(k, k + j + 1, k + j); }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}

const hullMat = new THREE.MeshStandardMaterial({ color: 0x3b404b, metalness: 0.75, roughness: 0.42 });
const plateMat = new THREE.MeshStandardMaterial({ color: 0x5c616c, metalness: 0.7, roughness: 0.5 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.6, roughness: 0.6 });
const burntMat = new THREE.MeshStandardMaterial({ color: 0x2a211d, metalness: 0.5, roughness: 0.85 });

function glowSprite(color, size) {
  const m = new THREE.SpriteMaterial({ map: softTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(m); s.scale.setScalar(size); return s;
}

// length ~ L metres, nose toward +z
export function buildCapitalShip({ L = 520, seed = 1, accent = 0xff3c8a, broken = false } = {}) {
  const r = rng(seed);
  const g = new THREE.Group();
  const W = L * 0.085, H = L * 0.06;
  const st = [
    [L * 0.5, 0.5, 0.5, 0], [L * 0.44, W * 0.35, H * 0.3, 0], [L * 0.3, W * 0.8, H * 0.65, 0],
    [L * 0.1, W, H * 0.9, 0], [-L * 0.15, W * 1.05, H, 0], [-L * 0.35, W * 0.95, H * 1.05, H * 0.1], [-L * 0.47, W * 0.8, H * 0.9, H * 0.1], [-L * 0.5, W * 0.7, H * 0.8, H * 0.1],
  ];
  const mat = broken ? burntMat : hullMat;
  const hull = new THREE.Mesh(loft(st, 8), mat); g.add(hull);
  // keel / armour belt
  const belt = new THREE.Mesh(loft(st.map(([z, w, h, y]) => [z, w * 1.08, h * 0.25, y - h * 0.15]), 6), broken ? burntMat : plateMat);
  g.add(belt);
  // flight deck on top
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 1.1, H * 0.12, L * 0.62), darkMat);
  deck.position.set(0, H * 0.98, -L * 0.04); g.add(deck);
  // tower
  const tower = new THREE.Group();
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(W * 0.35, H * 0.8, L * 0.12), mat); t1.position.y = H * 0.4;
  const t2 = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, H * 0.25, L * 0.08), plateMat); t2.position.y = H * 0.85;
  const t3 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, H * 0.9, 6), darkMat); t3.position.set(0, H * 1.3, -L * 0.02);
  tower.add(t1, t2, t3); tower.position.set(W * 0.6, H * 1.0, -L * 0.3); g.add(tower);
  // engines
  const engines = [];
  const eng = [[-W * 0.45, H * 0.35], [W * 0.45, H * 0.35], [-W * 0.45, -H * 0.35], [W * 0.45, -H * 0.35], [0, 0]];
  for (const [x, y] of eng) {
    const rad = (x === 0 ? 0.38 : 0.3) * W;
    const n = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.15, L * 0.08, 16, 1, true), darkMat);
    n.rotation.x = Math.PI / 2; n.position.set(x, y + H * 0.1, -L * 0.52); g.add(n);
    if (!broken) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.95, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fd6ff).multiplyScalar(4) }));
      disc.position.set(x, y + H * 0.1, -L * 0.555); disc.rotation.y = Math.PI; g.add(disc);
      const fl = glowSprite(0x2a6a9a, rad * 3); // dimmer exhaust flare (was blowing out to white) fl.position.copy(disc.position).z -= rad; g.add(fl); engines.push(fl);
    }
  }
  // greebles
  const gN = Math.floor(L * 0.9);
  const gg = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), broken ? burntMat : plateMat, gN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < gN; i++) {
    const z = (r() - 0.5) * L * 0.85; const a = r() * Math.PI * 2;
    const k = 1 - Math.abs(z / (L * 0.5)) * 0.4;
    p.set(Math.cos(a) * W * k, Math.sin(a) * H * k + H * 0.05, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    sc.set(2 + r() * 8, 1 + r() * 4, 3 + r() * 16);
    m4.compose(p, q, sc); gg.setMatrixAt(i, m4);
  }
  g.add(gg);
  // lit windows rows + accent strip
  if (!broken) {
    const wN = Math.floor(L * 1.2);
    const win = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 2.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), wN);
    const c = new THREE.Color();
    for (let i = 0; i < wN; i++) {
      const side = r() < 0.5 ? -1 : 1; const z = (r() - 0.55) * L * 0.75; const row = Math.floor(r() * 4);
      const k = 1 - Math.abs(z / (L * 0.5)) * 0.35;
      p.set(side * W * k * 1.0, (row - 1.5) * H * 0.18, z); q.identity(); sc.set(1, 1, 1);
      m4.compose(p, q, sc); win.setMatrixAt(i, m4);
      win.setColorAt(i, c.set(r() < 0.8 ? 0xffc890 : 0x7cf6ff).multiplyScalar(2.5));
    }
    g.add(win);
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(3) });
    for (const side of [-1, 1]) {
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, L * 0.6), stripMat);
      s1.position.set(side * W * 1.08, -H * 0.12, -L * 0.03); g.add(s1);
    }
    for (let i = 0; i < 12; i++) {
      const sp = glowSprite(i % 2 ? 0xff4060 : 0x40ff90, 14); sp.position.set((i % 2 ? -1 : 1) * W * 1.1, H * 0.5, L * 0.4 - i * L * 0.07); g.add(sp);
    }
  }
  g.userData.engines = engines;
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

export function buildCapitalFleet(scene, startPos, wreckFrame) {
  const fleet = { carriers: [], frigates: [], t: 0 };
  // two carriers over the start line
  const c1 = buildCapitalShip({ L: 620, seed: 3, accent: 0xff2f8f });
  c1.position.set(startPos.x + 120, startPos.y + 330, startPos.z - 40); c1.rotation.y = Math.PI * 0.5 + 0.15;
  const c2 = buildCapitalShip({ L: 460, seed: 9, accent: 0x29f0ff });
  c2.position.set(startPos.x - 260, startPos.y + 230, startPos.z + 420); c2.rotation.y = Math.PI * 0.5 - 0.25;
  scene.add(c1, c2); fleet.carriers.push(c1, c2);
  for (const c of fleet.carriers) c.userData.base = c.position.clone();
  // frigate patrol
  for (let i = 0; i < 3; i++) {
    const f = buildCapitalShip({ L: 170, seed: 20 + i, accent: 0xffb020 });
    scene.add(f); fleet.frigates.push(f);
  }
  // crashed flagship in the valley (two broken halves lying in the sand)
  if (wreckFrame) {
    const { p, t, r } = wreckFrame;
    const bow = buildCapitalShip({ L: 700, seed: 41, broken: true });
    bow.position.copy(p).addScaledVector(r, -470).addScaledVector(t, 220); bow.position.y = -45;
    bow.lookAt(bow.position.clone().add(t.clone().multiplyScalar(-1).addScaledVector(r, 0.22)));
    bow.rotateZ(0.5); bow.rotateX(-0.12);
    const stern = buildCapitalShip({ L: 560, seed: 42, broken: true });
    stern.position.copy(p).addScaledVector(r, 470).addScaledVector(t, -260); stern.position.y = -40;
    stern.lookAt(stern.position.clone().add(t.clone().addScaledVector(r, -0.15)));
    stern.rotateZ(-0.7);
    scene.add(bow, stern);
    fleet.wreck = [bow, stern];
  }
  fleet.update = (dt, time) => {
    fleet.carriers.forEach((c, i) => {
      c.position.y = c.userData.base.y + Math.sin(time * 0.2 + i * 2) * 6;
      c.rotation.z = Math.sin(time * 0.15 + i) * 0.02;
      for (const e of c.userData.engines) e.material.opacity = 0.8 + Math.random() * 0.2;
    });
    fleet.frigates.forEach((f, i) => {
      const a = time * 0.035 + i * 0.14;
      const R = 2300;
      f.position.set(Math.cos(a) * R - 300 + i * 40, 560 + i * 25 + Math.sin(time * 0.3 + i) * 4, Math.sin(a) * R + 200 + i * 60);
      f.lookAt(Math.cos(a + 0.01) * R - 300 + i * 40, f.position.y, Math.sin(a + 0.01) * R + 200 + i * 60);
    });
  };
  return fleet;
}
