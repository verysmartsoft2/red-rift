// Racer models: five airframes built in Blender (tools/blender/build_ships.py) and exported as GLB with
// baked ambient occlusion. Materials are named rr_<role>; the game swaps them for livery materials.
// Engine flames, spinning turbines, nav lights, number decals and the shield are added per instance.
// Nose points to +z, up is +y.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { softTex } from './shaders.js';
import { FINISHES } from './config.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MODELS = {};

function b64ToBuffer(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

// Loads models/<key>.glb (or the copies embedded in the offline build as window.__RR_MODELS).
export async function loadShipModels(keys, onProgress = () => {}) {
  const loader = new GLTFLoader();
  const embedded = window.__RR_MODELS || null;
  let done = 0;
  await Promise.all(keys.map(async (key) => {
    const buf = embedded && embedded[key] ? b64ToBuffer(embedded[key]) : await (await fetch(`models/${key}.glb`)).arrayBuffer();
    const gltf = await loader.parseAsync(buf, '');
    const entry = { parts: [], turbines: [], meta: {}, ao: null };
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.userData && o.userData.rr) entry.meta = JSON.parse(o.userData.rr);
      if (!o.isMesh) return;
      if (o.name.startsWith('TURBINE')) { entry.turbines.push({ geo: o.geometry, pos: o.getWorldPosition(new THREE.Vector3()) }); return; }
      const role = (o.material.name || 'dark').replace(/^rr_/, '');
      if (o.material.aoMap && !entry.ao) entry.ao = o.material.aoMap;
      const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.computeBoundingSphere();
      entry.parts.push({ geo, role });
    });
    MODELS[key] = entry;
    onProgress(++done / keys.length);
  }));
}

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

// Panel lines, rivets and racing stripes in object space plus a darker belly.
// stripe = [inner |x|, outer |x|, min y, enabled]
function paintShader(mat, stripeColor, stripe) {
  const U = { uStripeCol: { value: new THREE.Color(stripeColor) }, uStripe: { value: new THREE.Vector4(...stripe) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vOP; uniform vec3 uStripeCol; uniform vec4 uStripe;
      float rrLine(float v, float s){ return abs(fract(v / s + 0.5) - 0.5) * s; }
      float rrAA(float d, float w){ float fw = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - fw, w + fw, d); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float rrBand = floor(vOP.x / 1.15);
      float rrZ = vOP.z + rrBand * 0.53;
      float rrP = max(rrAA(rrLine(rrZ, 1.7), 0.012), rrAA(rrLine(vOP.x, 1.15), 0.012));
      float rrRiv = rrAA(length(vec2(rrLine(rrZ - 0.1, 1.7), rrLine(vOP.x, 0.2))), 0.02);
      float rrFade = 1.0 - smoothstep(22.0, 65.0, length(vViewPosition));
      float rrPanel = clamp(rrP + rrRiv * 0.7, 0.0, 1.0) * rrFade;
      float rrAx = abs(vOP.x);
      float rrSt = uStripe.w * step(uStripe.z, vOP.y) * (smoothstep(uStripe.x - 0.015, uStripe.x, rrAx) - smoothstep(uStripe.y, uStripe.y + 0.015, rrAx));
      diffuseColor.rgb = mix(diffuseColor.rgb, uStripeCol, rrSt);
      diffuseColor.rgb *= (1.0 - 0.45 * rrPanel) * mix(0.72, 1.0, smoothstep(-0.9, 0.4, vOP.y));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + rrPanel * 0.35, 0.0, 1.0);');
  };
  mat.customProgramCacheKey = () => 'rr-paint';
  return mat;
}

export function makeMaterials(liv, finishKey = 'gloss', meta = {}, ao = null) {
  const fin = FINISHES.find(f => f.key === finishKey) || FINISHES[0];
  const withAO = (m) => { if (ao) { m.aoMap = ao; m.aoMapIntensity = 1; } return m; };
  const paint = (hex, stripe = [0, 0, 0, 0]) => withAO(paintShader(new THREE.MeshPhysicalMaterial({ color: hex, metalness: fin.metalness, roughness: fin.roughness, clearcoat: fin.clearcoat, clearcoatRoughness: 0.08 }), liv.accent, stripe));
  const std = (color, metalness, roughness, side = THREE.FrontSide) => withAO(new THREE.MeshStandardMaterial({ color, metalness, roughness, side }));
  const neonColor = new THREE.Color(liv.neon);
  const st = meta.stripe || [0, 0, 0], band = meta.band || [0, 0];
  return {
    primary: paint(liv.primary, [st[0], st[1], st[2], 1]),
    secondary: paint(liv.secondary, [band[0], band[1], -10, 1]),
    accent: paint(liv.accent),
    white: paint('#e8eaf0'),
    dark: std(0x1b1d23, 0.7, 0.42),
    gunmetal: std(0x3c414b, 0.9, 0.3),
    metal: std(0xc4cad4, 1, 0.16),
    inner: std(0x0b0c10, 0.4, 0.75, THREE.DoubleSide),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x05070b, metalness: 0.2, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.93, iridescence: 0.5, iridescenceIOR: 1.3, emissive: neonColor.clone().multiplyScalar(0.05) }),
    warm: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa020).multiplyScalar(2.4) }),
    neon: new THREE.MeshBasicMaterial({ color: neonColor.clone().multiplyScalar(3.2) }),
    core: new THREE.MeshBasicMaterial({ color: neonColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(2.2), side: THREE.DoubleSide }),
    flame: flameMaterial(liv.neon), neonColor,
  };
}

function numberTexture(num, liv) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = liv.secondary; x.fillRect(0, 0, 256, 256);
  x.fillStyle = liv.accent; x.fillRect(0, 186, 256, 26); x.fillRect(0, 222, 256, 8);
  x.font = 'bold 150px Arial'; x.textAlign = 'center'; x.fillStyle = liv.primary;
  x.strokeStyle = liv.accent; x.lineWidth = 8; x.strokeText(String(num), 128, 158); x.fillText(String(num), 128, 158);
  x.fillStyle = 'rgba(0,0,0,0.55)'; x.font = 'bold 20px Arial'; x.fillText('RED RIFT', 128, 252);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const LIGHT_GEO = new THREE.SphereGeometry(0.09, 10, 8);
const DECAL_GEO = new THREE.PlaneGeometry(1.4, 1.4);
let racerNum = 0;
export function buildShip(shipKey, liv, finish = 'gloss', number = ++racerNum) {
  const D = MODELS[shipKey];
  if (!D) throw new Error('ship model not loaded: ' + shipKey);
  const meta = D.meta;
  const M = makeMaterials(liv, finish, meta, D.ao);
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const refs = { flames: [], glows: [], turbines: [], lights: [], mats: M };
  for (const p of D.parts) {
    const mesh = new THREE.Mesh(p.geo, M[p.role] || M.dark);
    const lit = !['neon', 'core', 'glass', 'warm'].includes(p.role); mesh.castShadow = lit; mesh.receiveShadow = lit;
    if (p.role === 'glass') mesh.renderOrder = 2;
    body.add(mesh);
  }
  for (const t of D.turbines) { const m = new THREE.Mesh(t.geo, M.gunmetal); m.position.copy(t.pos); body.add(m); refs.turbines.push(m); }
  for (const e of meta.engines || []) {
    const exit = V(...e.exit);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(e.r * 0.85, e.r * 9, 16, 1, true), M.flame);
    flame.rotation.x = Math.PI / 2; flame.position.copy(exit).add(V(0, 0, -e.r * 4.5)); body.add(flame); refs.flames.push(flame);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: M.neonColor, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    glow.scale.setScalar(e.r * 3.2); glow.position.copy(exit).add(V(0, 0, 0.1)); body.add(glow); refs.glows.push(glow);
  }
  (meta.lights || []).forEach((l, i) => {
    const c = new THREE.Color(l.color);
    const m = new THREE.Mesh(LIGHT_GEO, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(4) })); m.position.set(...l.p); body.add(m);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.scale.setScalar(l.kind === 'nav' ? 1.4 : 2.2); sp.position.set(...l.p); body.add(sp);
    refs.lights.push({ m, sp, kind: l.kind, ph: i * 0.37 });
  });
  if (meta.emitter) { const em = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), M.neon); em.position.set(...meta.emitter); body.add(em); refs.emitter = em; }
  const decMat = new THREE.MeshStandardMaterial({ map: numberTexture(number, liv), roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const d of meta.decals || []) {
    const p = new THREE.Mesh(DECAL_GEO, decMat); p.position.set(...d.p);
    if (d.q) p.quaternion.set(...d.q); else p.rotation.y = d.ry;
    p.scale.setScalar((d.s || 1.4) / 1.4); body.add(p);
  }
  // shield bubble
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x4cf0ff) }, uA: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vP=position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uA; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0-abs(dot(vN,vV)),2.5); float hex = step(0.92, fract(vP.y*6.0+uTime)) + step(0.94, fract(atan(vP.z,vP.x)*4.0)); float a=(f*0.9+hex*0.25+0.04)*uA; gl_FragColor=vec4(uColor*a*1.8,a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  shield.scale.set(10, 5, 11.5); shield.visible = false; g.add(shield);
  refs.shield = shield;
  g.userData = { refs, body, key: shipKey };
  return g;
}

export function updateShipFx(ship, time, power, opts = {}) {
  const r = ship.userData.refs;
  for (const f of r.flames) { f.material.uniforms.uTime.value = time; f.material.uniforms.uPower.value = power; f.scale.set(1, 0.6 + power * 0.7, 1); }
  for (const gl of r.glows) gl.material.opacity = 0.25 + power * 0.3;
  for (const t of r.turbines) t.rotation.z = time * (6 + power * 30);
  for (const l of r.lights) {
    const t = (time + l.ph) % 1.3;
    const on = l.kind === 'strobe' ? (t < 0.07 || (t > 0.16 && t < 0.23)) : l.kind === 'beacon' ? Math.sin((time + l.ph) * 5) > 0 : true;
    l.m.visible = on; l.sp.material.opacity = on ? (l.kind === 'nav' ? 0.7 : 1) : 0;
  }
  if (r.emitter) r.emitter.scale.setScalar(0.85 + Math.sin(time * 14) * 0.15 + (opts.overload ? 0.5 : 0));
  r.shield.visible = (opts.shield || 0) > 0.01;
  r.shield.material.uniforms.uA.value = opts.shield || 0; r.shield.material.uniforms.uTime.value = time;
}
