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
    const entry = { parts: [], turbines: [], meta: {}, ao: null, edge: null };
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.userData && o.userData.rr) entry.meta = JSON.parse(o.userData.rr);
      if (!o.isMesh) return;
      if (o.name.startsWith('TURBINE')) { entry.turbines.push({ geo: o.geometry, pos: o.getWorldPosition(new THREE.Vector3()) }); return; }
      const role = (o.material.name || 'dark').replace(/^rr_/, '');
      if (o.material.aoMap && !entry.ao) entry.ao = o.material.aoMap;
      if (o.material.emissiveMap && !entry.edge) { entry.edge = o.material.emissiveMap; entry.edge.colorSpace = THREE.NoColorSpace; entry.edge.needsUpdate = true; } // baked edge mask (not light)
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
const NO_EDGE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); NO_EDGE.needsUpdate = true;
function paintShader(mat, stripeColor, stripe, damage, edge = null, exit = null) {
  const U = { uStripeCol: { value: new THREE.Color(stripeColor) }, uStripe: { value: new THREE.Vector4(...stripe) }, uDamage: damage, uEdge: { value: edge || NO_EDGE },
    uExit: { value: exit || new THREE.Vector4(0, 0, -999, 1) } }; // |x|, y, z of the nozzle (mirrored pairs share |x|)
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vOP; uniform vec3 uStripeCol; uniform vec4 uStripe; uniform float uDamage; uniform sampler2D uEdge; uniform vec4 uExit;
      float rrLine(float v, float s){ return abs(fract(v / s + 0.5) - 0.5) * s; }
      float rrAA(float d, float w){ float fw = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - fw, w + fw, d); }
      float rrH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float rrN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(rrH(i), rrH(i + vec3(1,0,0)), f.x), mix(rrH(i + vec3(0,1,0)), rrH(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(rrH(i + vec3(0,0,1)), rrH(i + vec3(1,0,1)), f.x), mix(rrH(i + vec3(0,1,1)), rrH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float rrBand = floor(vOP.x / 1.15);
      float rrZ = vOP.z + rrBand * 0.53;
      float rrP = max(rrAA(rrLine(rrZ, 1.7), 0.012), rrAA(rrLine(vOP.x, 1.15), 0.012));
      float rrRiv = rrAA(length(vec2(rrLine(rrZ - 0.1, 1.7), rrLine(vOP.x, 0.2))), 0.02);
      float rrFade = 1.0 - smoothstep(22.0, 65.0, length(vViewPosition));
      float rrPanel = clamp(rrP + rrRiv * 0.7, 0.0, 1.0) * rrFade;
      float rrAx = abs(vOP.x);
      float rrSt = uStripe.w * step(uStripe.z, vOP.y) * (smoothstep(uStripe.x - 0.015, uStripe.x, rrAx) - smoothstep(uStripe.y, uStripe.y + 0.015, rrAx));
      // small access hatches between the big panels
      vec2 rrCell = floor(vec2(vOP.x / 0.55, (vOP.z + rrBand * 0.3) / 0.8));
      float rrHatch = step(0.86, rrH(vec3(rrCell, 3.0))) * max(rrAA(rrLine(vOP.x, 0.55), 0.01), rrAA(rrLine(vOP.z + rrBand * 0.3, 0.8), 0.01)) * rrFade;
      rrPanel = max(rrPanel, rrHatch * 0.8);
      // grime and worn paint: soft streaks along the flow, darker toward the tail and belly
      float rrG = rrN(vOP * vec3(1.6, 3.0, 0.45)) * 0.6 + rrN(vOP * 6.0) * 0.4;
      float rrWear = smoothstep(0.78, 0.97, rrN(vOP * 3.2 + 7.0)) * smoothstep(0.55, 0.8, rrN(vOP * 0.7 + 3.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, uStripeCol, rrSt);
      float rrTone = 0.9 + 0.14 * rrH(vec3(floor(vOP.x / 1.15), floor(rrZ / 1.7), 1.0)); // panels differ slightly in tone
      diffuseColor.rgb *= (1.0 - 0.72 * rrPanel) * mix(0.72, 1.0, smoothstep(-0.9, 0.4, vOP.y)) * (0.93 + 0.08 * rrG) * rrTone;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + vec3(0.08), rrWear * 0.35);
      float rrRough = rrG; float rrChip = 0.0;
      #ifdef USE_AOMAP
      { // baked masks: convex edges lose paint down to bare metal, cavities collect grime
        float rrAO = texture2D(aoMap, vAoMapUv).r, rrEd = texture2D(uEdge, vAoMapUv).r * smoothstep(0.55, 0.85, rrAO);
        float rrBreak = rrN(vOP * 7.0) * 0.55 + rrN(vOP * 2.2 + 4.0) * 0.45;
        rrChip = smoothstep(0.5, 0.7, rrEd * 0.75 + rrBreak * 0.55) * rrFade; // chips big enough to read at chase distance
        diffuseColor.rgb *= 1.0 + rrEd * 0.1;
        diffuseColor.rgb *= mix(vec3(0.5, 0.44, 0.38), vec3(1.0), smoothstep(0.2, 0.85, rrAO));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.51, 0.53), rrChip * 0.85);
      }
      #endif
      { // engine soot: dark streaks on the skin just ahead of the nozzles
        float rrDz = vOP.z - uExit.z, rrDl = length(vec2(abs(vOP.x) - uExit.x, vOP.y - uExit.y));
        float rrSoot = smoothstep(3.2, 0.2, rrDz) * step(-0.6, rrDz) * (1.0 - smoothstep(0.7, 2.1, rrDl));
        rrSoot *= 0.55 + 0.45 * rrN(vec3(vOP.x * 5.0, vOP.y * 5.0, vOP.z * 0.5));
        diffuseColor.rgb *= 1.0 - 0.6 * rrSoot; rrRough = mix(rrRough, 1.0, rrSoot * 0.5); rrChip *= 1.0 - rrSoot;
      }
      // battle damage (damage stages reference): scorched patches spread with damage, embers glow in them when badly hurt
      float rrB = rrN(vOP * 0.9 + 11.0) * 0.65 + rrN(vOP * 3.6) * 0.35;
      float rrBurn = smoothstep(1.02 - uDamage * 0.75, 1.1 - uDamage * 0.75, rrB);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), rrBurn * 0.85);
      float rrEmber = rrBurn * smoothstep(0.5, 0.85, uDamage) * (1.0 - smoothstep(0.0, 0.05, abs(rrN(vOP * vec3(2.2, 2.2, 1.1) + 5.0) - 0.5))); // glowing cracks
      rrRough = mix(rrRough, 1.0, rrBurn * 0.6);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + String.fromCharCode(10) + 'totalEmissiveRadiance += vec3(1.0, 0.38, 0.06) * rrEmber * 2.5;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(roughnessFactor + rrPanel * 0.35 + (rrRough - 0.5) * 0.18, 0.32, rrChip), 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, rrChip);');
  };
  mat.customProgramCacheKey = () => 'rr-paint';
  return mat;
}

export function makeMaterials(liv, finishKey = 'gloss', meta = {}, ao = null, edge = null) {
  const fin = FINISHES.find(f => f.key === finishKey) || FINISHES[0];
  const withAO = (m) => { if (ao) { m.aoMap = ao; m.aoMapIntensity = 1; } return m; };
  const damage = { value: 0 }; // shared by all painted parts of this ship
  const e0 = (meta.engines || [])[0], exit = e0 ? new THREE.Vector4(Math.abs(e0.exit[0]), e0.exit[1], e0.exit[2], 1) : null;
  const paint = (hex, stripe = [0, 0, 0, 0]) => withAO(paintShader(new THREE.MeshPhysicalMaterial({ color: hex, metalness: fin.metalness, roughness: fin.roughness, clearcoat: fin.clearcoat, clearcoatRoughness: 0.08 }), liv.accent, stripe, damage, edge, exit));
  const std = (color, metalness, roughness, side = THREE.FrontSide) => withAO(new THREE.MeshStandardMaterial({ color, metalness, roughness, side }));
  const neonColor = new THREE.Color(liv.neon);
  const st = meta.stripe || [0, 0, 0], band = meta.band || [0, 0];
  return {
    damage,
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
  const M = makeMaterials(liv, finish, meta, D.ao, D.edge);
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const refs = { flames: [], glows: [], turbines: [], lights: [], mats: M, exits: (meta.engines || []).map(e => V(...e.exit)), setDamage: (d) => { M.damage.value = d; } };
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
    uniforms: { uColor: { value: new THREE.Color(0x3d8bff) }, uA: { value: 0 }, uTime: { value: 0 } },
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

// ---------------- breakup (damage stage 04) ----------------
// Split every part of the airframe into nose / tail / left wing / right wing by triangle position,
// once per airframe; wrecks reuse the dying ship's own materials.
const WRECK = {};
function wreckParts(key) {
  if (WRECK[key]) return WRECK[key];
  const D = MODELS[key], regions = { N: [], T: [], L: [], R: [] };
  const region = (x, z) => (x > 2.4 ? 'L' : x < -2.4 ? 'R' : z > 1.2 ? 'N' : 'T');
  for (const p of D.parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const bins = { N: [[], [], []], T: [[], [], []], L: [[], [], []], R: [[], [], []] };
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const b = bins[region(cx, cz)];
      for (let k = 0; k < 3; k++) {
        b[0].push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        b[1].push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k));
        if (uv) b[2].push(uv.getX(i + k), uv.getY(i + k));
      }
    }
    for (const r in bins) {
      const [P, N, U] = bins[r]; if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      if (U.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      regions[r].push({ geo, role: p.role });
    }
  }
  const out = [];
  for (const r in regions) {
    if (!regions[r].length) continue;
    const box = new THREE.Box3(); for (const q of regions[r]) { q.geo.computeBoundingBox(); box.union(q.geo.boundingBox); }
    const c = box.getCenter(new THREE.Vector3());
    for (const q of regions[r]) q.geo.translate(-c.x, -c.y, -c.z);
    out.push({ region: r, center: c, parts: regions[r] });
  }
  return (WRECK[key] = out);
}
// pieces of `ship` positioned in the ship's body frame; caller adds them to a group placed at the ship
export function buildWreck(ship) {
  const M = ship.userData.refs.mats;
  return wreckParts(ship.userData.key).map(({ region, center, parts }) => {
    const g = new THREE.Group();
    for (const q of parts) { const m = new THREE.Mesh(q.geo, M[q.role] || M.dark); m.castShadow = !['neon', 'core', 'glass', 'warm'].includes(q.role); g.add(m); }
    g.position.copy(center);
    const out = region === 'L' ? 1 : region === 'R' ? -1 : 0;
    const vel = new THREE.Vector3(out * (8 + Math.random() * 8) + (Math.random() - 0.5) * 4, 4 + Math.random() * 8, region === 'N' ? 30 + Math.random() * 15 : region === 'T' ? -6 + Math.random() * 6 : 10 + Math.random() * 10);
    const spin = new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6 + out * 3);
    return { g, vel, spin, region };
  });
}
