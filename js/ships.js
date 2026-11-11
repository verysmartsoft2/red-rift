// Procedural racer models: 5 distinct airframes, painted with liveries. Nose points to +z.
import * as THREE from 'three';
import { loft } from './capital.js';
import { softTex } from './shaders.js';
import { FINISHES } from './config.js';

function wing(pts, thick = 0.35, bevel = 0.12) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(Math.PI / 2); g.translate(0, thick / 2, 0);
  g.computeVertexNormals();
  return g;
}
const mirrorX = (pts) => pts.map(([x, z]) => [-x, z]).reverse();

function flameMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower; varying vec2 vUv;
      void main(){ float t = vUv.y; float flick = 0.8+0.2*sin(uTime*70.0+t*30.0);
        float shock = 0.5+0.5*sin(t*40.0 - uTime*90.0);
        float a = pow(t, 1.6) * flick * uPower * (0.75 + 0.25*shock);
        vec3 c = mix(uColor*1.5, vec3(1.0), pow(t,6.0)); gl_FragColor = vec4(c*a*1.3, a*0.8); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function engine(parent, mats, pos, radius, len, refs) {
  const g = new THREE.Group(); g.position.copy(pos);
  const nac = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.05, radius * 1.15, len, 18), mats.dark);
  nac.rotation.x = Math.PI / 2; g.add(nac);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.05, radius * 0.16, 8, 20), mats.metal);
  lip.position.z = -len / 2; g.add(lip);
  const core = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 20), mats.engineCore);
  core.position.z = -len / 2 - 0.02; core.rotation.y = Math.PI; g.add(core);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.85, radius * 9, 16, 1, true), mats.flame);
  flame.rotation.x = Math.PI / 2; flame.position.z = -len / 2 - radius * 4.5; g.add(flame);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: mats.neonColor, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  glow.scale.setScalar(radius * 3.2); glow.position.z = -len / 2 - radius * 0.8; g.add(glow);
  parent.add(g);
  refs.flames.push(flame); refs.glows.push(glow);
  return g;
}

function neonStrip(parent, mats, a, b, w = 0.12) {
  const d = new THREE.Vector3().subVectors(b, a); const L = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, L), mats.neon);
  m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); parent.add(m); return m;
}

function numberTexture(num, liv) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = liv.secondary; x.fillRect(0, 0, 256, 256);
  x.fillStyle = liv.accent; x.fillRect(0, 170, 256, 30); x.fillRect(0, 210, 256, 10);
  x.font = 'bold 150px Arial'; x.textAlign = 'center'; x.fillStyle = liv.primary;
  x.strokeStyle = liv.accent; x.lineWidth = 8; x.strokeText(String(num), 128, 150); x.fillText(String(num), 128, 150);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeMaterials(liv, finishKey = 'gloss') {
  const fin = FINISHES.find(f => f.key === finishKey) || FINISHES[0];
  const paint = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, metalness: fin.metalness, roughness: fin.roughness, clearcoat: fin.clearcoat, clearcoatRoughness: 0.1 });
  const neonColor = new THREE.Color(liv.neon);
  return {
    primary: paint(liv.primary), secondary: paint(liv.secondary), accent: paint(liv.accent),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.8, roughness: 0.35 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 1, roughness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.2, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.88, emissive: neonColor.clone().multiplyScalar(0.12) }),
    neon: new THREE.MeshBasicMaterial({ color: neonColor.clone().multiplyScalar(3.2) }),
    engineCore: new THREE.MeshBasicMaterial({ color: neonColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(2) }),
    flame: flameMaterial(liv.neon), neonColor,
  };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const BUILDERS = {
  kestrel(g, M, refs) {
    g.add(new THREE.Mesh(loft([[8.5, 0.05, 0.05, 0], [7, 0.45, 0.35, 0], [4, 0.95, 0.75, 0.05], [1, 1.25, 0.95, 0.1], [-2.5, 1.25, 0.95, 0.1], [-5.5, 1.05, 0.85, 0.05], [-6.6, 0.95, 0.8, 0]], 10), M.primary));
    const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.glass); cp.scale.set(0.62, 0.5, 2.1); cp.position.set(0, 0.75, 2.6); g.add(cp);
    const wR = [[0.8, 2.5], [7.2, -3.6], [7.4, -4.6], [0.8, -4.2]];
    g.add(new THREE.Mesh(wing(wR, 0.22), M.secondary)); g.add(new THREE.Mesh(wing(mirrorX(wR), 0.22), M.secondary));
    const cn = [[0.6, 5.6], [2.6, 4.3], [2.6, 3.9], [0.6, 4.2]];
    g.add(new THREE.Mesh(wing(cn, 0.12), M.accent)); g.add(new THREE.Mesh(wing(mirrorX(cn), 0.12), M.accent));
    const fin = new THREE.Mesh(wing([[0, -2.2], [2.9, -5.4], [2.9, -6.4], [0, -6.2]], 0.16), M.accent);
    fin.rotation.z = Math.PI / 2; fin.position.set(0.05, 0.75, 0); g.add(fin);
    engine(g, M, V(0, 0.05, -6.4), 0.85, 2.0, refs);
    for (const s of [-1, 1]) { neonStrip(g, M, V(s * 7.25, 0.12, -3.7), V(s * 7.35, 0.12, -4.6)); neonStrip(g, M, V(s * 0.9, 0.14, 2.4), V(s * 7.15, 0.14, -3.55), 0.07); }
    neonStrip(g, M, V(0, 1.02, 0.6), V(0, 1.02, -5.4), 0.09);
    return { finPlane: [V(0.2, 2.2, -5.4), Math.PI / 2] };
  },
  mirage(g, M, refs) {
    g.add(new THREE.Mesh(loft([[6.5, 0.05, 0.05, 0], [5, 0.6, 0.4, 0], [2.5, 1.2, 0.8, 0.05], [-1, 1.35, 0.85, 0.05], [-3.8, 0.9, 0.6, 0]], 10), M.primary));
    const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.glass); cp.scale.set(0.7, 0.5, 1.8); cp.position.set(0, 0.7, 1.8); g.add(cp);
    const wR = [[0.8, 2.6], [4.5, 1.2], [8.6, -0.8], [9.3, -2.4], [8.1, -2.6], [4.4, -1.8], [0.8, -3.6]];
    g.add(new THREE.Mesh(wing(wR, 0.3), M.secondary)); g.add(new THREE.Mesh(wing(mirrorX(wR), 0.3), M.secondary));
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(loft([[1.2, 0.1, 0.1], [0.4, 0.55, 0.55], [-2.2, 0.62, 0.62], [-2.8, 0.55, 0.55]], 10), M.accent);
      pod.position.set(s * 8.7, 0.15, -1.2); g.add(pod);
      engine(g, M, V(s * 8.7, 0.15, -4.2), 0.5, 1.0, refs);
      const fin = new THREE.Mesh(wing([[0, -1.4], [1.6, -2.6], [1.6, -3.2], [0, -3.4]], 0.1), M.primary);
      fin.rotation.z = Math.PI / 2; fin.position.set(s * 8.7, 0.6, 0); g.add(fin);
      neonStrip(g, M, V(s * 0.9, 0.36, 2.55), V(s * 4.5, 0.36, 1.25), 0.08); neonStrip(g, M, V(s * 4.5, 0.36, 1.25), V(s * 8.4, 0.36, -0.7), 0.08);
    }
    engine(g, M, V(0, 0.05, -4.1), 0.55, 0.9, refs);
    return { finPlane: [V(0, 1.2, -2.6), 0] };
  },
  bastion(g, M, refs) {
    g.add(new THREE.Mesh(loft([[6.5, 0.2, 0.2, 0], [5.2, 1.0, 0.8, 0], [2.5, 1.6, 1.25, 0.1], [-1.5, 1.7, 1.3, 0.1], [-3.6, 1.3, 1.0, 0]], 8), M.primary));
    const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.glass); cp.scale.set(0.95, 0.65, 1.7); cp.position.set(0, 1.1, 2.4); g.add(cp);
    const wR = [[1.2, 1.4], [8.2, 0.8], [8.2, -2.0], [1.2, -2.2]];
    g.add(new THREE.Mesh(wing(wR, 0.5, 0.15), M.secondary)); g.add(new THREE.Mesh(wing(mirrorX(wR), 0.5, 0.15), M.secondary));
    for (const s of [-1, 1]) {
      const boom = new THREE.Mesh(loft([[3.5, 0.3, 0.3], [2.6, 0.95, 0.95], [-5, 1.0, 1.0], [-7, 0.9, 0.9]], 8), M.primary);
      boom.position.set(s * 4.6, 0.25, 0); g.add(boom);
      engine(g, M, V(s * 4.6, 0.25, -7.6), 0.9, 1.4, refs);
      const fin = new THREE.Mesh(wing([[0, -4.4], [2.8, -6.2], [2.8, -7], [0, -7.3]], 0.2), M.accent);
      fin.rotation.z = Math.PI / 2; fin.position.set(s * 4.6, 1.0, 0); g.add(fin);
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 3.8), M.accent); armor.position.set(s * 5.65, 0.3, 0.6); g.add(armor);
      neonStrip(g, M, V(s * 8.4, 0.3, 0.7), V(s * 8.4, 0.3, -1.9), 0.12);
      neonStrip(g, M, V(s * 4.6, 1.3, 2.0), V(s * 4.6, 1.3, -5.6), 0.08);
    }
    const tail = new THREE.Mesh(wing([[-4.6, -6.2], [4.6, -6.2], [4.6, -7.1], [-4.6, -7.1]], 0.25), M.secondary); tail.position.y = 1.9; g.add(tail);
    return { finPlane: [V(4.75, 2.4, -6.4), Math.PI / 2] };
  },
  arc(g, M, refs) {
    for (const s of [-1, 1]) {
      const prong = new THREE.Mesh(loft([[8.2, 0.05, 0.05], [6.5, 0.4, 0.35], [2.0, 0.65, 0.55], [-1, 0.75, 0.6]], 8), M.primary);
      prong.position.set(s * 1.05, 0, 0); g.add(prong);
      neonStrip(g, M, V(s * 1.05, 0.4, 7.2), V(s * 1.05, 0.55, 0), 0.07);
    }
    g.add(new THREE.Mesh(loft([[1.5, 1.2, 0.6, 0], [-1.5, 1.7, 0.85, 0.05], [-4.6, 1.5, 0.8, 0], [-5.6, 1.2, 0.7, 0]], 10), M.primary));
    const emit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), M.neon); emit.position.set(0, 0.05, 5.6); g.add(emit);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 24), M.metal); coil.position.set(0, 0.05, 5.6); g.add(coil);
    const coil2 = coil.clone(); coil2.position.z = 4.9; g.add(coil2);
    const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.glass); cp.scale.set(0.7, 0.5, 1.5); cp.position.set(0, 0.75, 0.4); g.add(cp);
    const wR = [[1.3, 0.8], [6.8, -3.2], [7.6, -5.0], [6.4, -5.0], [1.3, -3.5]];
    g.add(new THREE.Mesh(wing(wR, 0.22), M.secondary)); g.add(new THREE.Mesh(wing(mirrorX(wR), 0.22), M.secondary));
    for (const s of [-1, 1]) {
      engine(g, M, V(s * 0.85, 0.1, -6.0), 0.62, 1.4, refs);
      const fin = new THREE.Mesh(wing([[0, -2.6], [2.2, -4.8], [2.2, -5.5], [0, -5.6]], 0.12), M.accent);
      fin.rotation.z = Math.PI / 2 + s * 0.35; fin.position.set(s * 1.3, 0.7, 0); g.add(fin);
      neonStrip(g, M, V(s * 1.4, 0.12, 0.7), V(s * 7.5, 0.12, -4.9), 0.08);
    }
    refs.emitter = emit;
    return { finPlane: [V(1.45, 1.9, -4.6), Math.PI / 2 + 0.35] };
  },
  nomad(g, M, refs) {
    g.add(new THREE.Mesh(loft([[7.5, 0.05, 0.05, 0], [6, 0.55, 0.45, 0], [3, 1.05, 0.85, 0.05], [-1.5, 1.15, 0.9, 0.05], [-5, 0.8, 0.7, 0.1], [-6.2, 0.5, 0.5, 0.15]], 10), M.primary));
    const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.glass); cp.scale.set(0.65, 0.5, 1.9); cp.position.set(0, 0.75, 2.6); g.add(cp);
    const wR = [[0.9, 1.6], [6.2, -0.6], [6.6, -1.8], [0.9, -1.6]];
    g.add(new THREE.Mesh(wing(wR, 0.25), M.secondary)); g.add(new THREE.Mesh(wing(mirrorX(wR), 0.25), M.secondary));
    for (const s of [-1, 1]) {
      const nac = new THREE.Mesh(loft([[2.5, 0.1, 0.1], [1.6, 0.7, 0.7], [-3.2, 0.8, 0.8], [-3.9, 0.72, 0.72]], 12), M.accent);
      nac.position.set(s * 2.6, -0.1, 0); g.add(nac);
      engine(g, M, V(s * 2.6, -0.1, -4.4), 0.72, 1.0, refs);
      const vt = new THREE.Mesh(wing([[0, -3.8], [3.0, -5.8], [3.0, -6.5], [0, -6.4]], 0.14), M.secondary);
      vt.rotation.z = s * 0.6; vt.position.set(s * 0.3, 0.6, 0); g.add(vt);
      neonStrip(g, M, V(s * 6.4, 0.15, -0.6), V(s * 6.7, 0.15, -1.8), 0.12);
      neonStrip(g, M, V(s * 2.6, 0.72, 1.5), V(s * 2.6, 0.72, -3.4), 0.08);
    }
    return { finPlane: [V(1.4, 1.6, -5.4), 0.6] };
  },
};

let racerNum = 0;
export function buildShip(shipKey, liv, finish = 'gloss', number = ++racerNum) {
  const g = new THREE.Group();
  const M = makeMaterials(liv, finish);
  const refs = { flames: [], glows: [], mats: M };
  const body = new THREE.Group(); g.add(body);
  const info = BUILDERS[shipKey](body, M, refs);
  // racing number decal
  const [p, rotZ] = info.finPlane;
  const dec = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshStandardMaterial({ map: numberTexture(number, liv), roughness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  dec.position.copy(p); dec.rotation.set(0, Math.PI / 2, 0); dec.rotateX(rotZ === 0 ? -Math.PI / 2 : 0);
  if (rotZ === 0) { dec.rotation.set(-Math.PI / 2, 0, 0); }
  body.add(dec);
  body.traverse(o => { if (o.isMesh && o.material !== M.flame && o.material !== M.neon) { o.castShadow = true; o.receiveShadow = true; } });
  // shield bubble
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x4cf0ff) }, uA: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vP=position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uA; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0-abs(dot(vN,vV)),2.5); float hex = step(0.92, fract(vP.y*6.0+uTime)) + step(0.94, fract(atan(vP.z,vP.x)*4.0)); float a=(f*0.9+hex*0.25+0.04)*uA; gl_FragColor=vec4(uColor*a*1.8,a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  shield.scale.set(9.5, 5, 11); shield.visible = false; g.add(shield);
  refs.shield = shield;
  g.userData = { refs, body, key: shipKey };
  return g;
}

export function updateShipFx(ship, time, power, opts = {}) {
  const r = ship.userData.refs;
  for (const f of r.flames) { f.material.uniforms.uTime.value = time; f.material.uniforms.uPower.value = power; f.scale.set(1, 0.6 + power * 0.7, 1); }
  for (const gl of r.glows) gl.material.opacity = 0.25 + power * 0.3;
  if (r.emitter) r.emitter.scale.setScalar(0.85 + Math.sin(time * 14) * 0.15 + (opts.overload ? 0.5 : 0));
  r.shield.visible = (opts.shield || 0) > 0.01;
  r.shield.material.uniforms.uA.value = opts.shield || 0; r.shield.material.uniforms.uTime.value = time;
}
