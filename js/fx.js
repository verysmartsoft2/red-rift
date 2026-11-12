// Visual effects: particles, explosions, debris, lasers, beams, missiles, scorch marks, pickups.
import * as THREE from 'three';
import { softTex, smokeTex, beamMaterial } from './shaders.js';
import { buildSpireGeometry } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { iconTexture } from './icons.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

class ParticlePool {
  constructor(scene, max, { additive = true, tex = softTex() } = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(size*uScale/max(-mv.z,0.1), 900.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); float a = t.a*vA; ${additive ? 'gl_FragColor = vec4(vC*a, a);' : 'gl_FragColor = vec4(vC, a);'} }`,
      transparent: true, depthWrite: false, vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  emit(p, v, color, size, life, { grow = 0, drag = 0, grav = 0, alpha = 1 } = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav; this.a0[i] = alpha;
    this.alpha[i] = alpha;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.copy(this.n - 1, i); this.n--; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 12 + 0.2);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
  copy(a, b) {
    for (const arr of [this.pos, this.vel, this.col]) { arr[b * 3] = arr[a * 3]; arr[b * 3 + 1] = arr[a * 3 + 1]; arr[b * 3 + 2] = arr[a * 3 + 2]; }
    for (const arr of [this.size, this.alpha, this.life, this.maxLife, this.grow, this.drag, this.grav, this.a0]) arr[b] = arr[a];
  }
}

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const rv = (s) => tmp2.set(rnd(), rnd(), rnd()).normalize().multiplyScalar(s * (0.3 + Math.random() * 0.7));

export class FX {
  constructor(scene, heightAt) {
    this.scene = scene; this.heightAt = heightAt;
    this.add = new ParticlePool(scene, 6000, { additive: true });
    this.smoke = new ParticlePool(scene, 3000, { additive: false, tex: smokeTex() });
    this.time = 0;
    // flash lights pool
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff8a40, 0, 260, 1.6); scene.add(l); this.lights.push({ l, t: 0, max: 0 }); }
    // shockwave rings
    this.rings = [];
    const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: this.ringTex() });
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat()); m.visible = false; scene.add(m); this.rings.push({ m, t: 0, max: 1, size: 1 }); }
    // fireball spheres
    this.balls = [];
    const fbMat = () => new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: `uniform float uT; uniform float uSeed; varying float vN; varying vec3 vNr; varying vec3 vV;
        float h(vec3 p){ return fract(sin(dot(p,vec3(12.9,78.2,37.7)))*43758.5); }
        float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){ float n = n3(position*2.2+uSeed+uT*2.0)*0.6 + n3(position*5.0-uT*3.0)*0.3; vN = n;
          vec3 p = position*(1.0+n*0.55); vec4 mv = modelViewMatrix*vec4(p,1.0); vNr = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT; varying float vN; varying vec3 vNr; varying vec3 vV;
        void main(){ float heat = clamp(1.25 - uT*1.3 + vN*0.6 - (1.0-abs(dot(vNr,vV)))*0.5, 0.0, 1.5);
          vec3 c = mix(vec3(0.25,0.03,0.01), vec3(1.0,0.35,0.05), smoothstep(0.1,0.6,heat)); c = mix(c, vec3(1.0,0.9,0.6), smoothstep(0.7,1.2,heat));
          float a = smoothstep(0.0,0.2,heat)*(1.0-smoothstep(0.75,1.0,uT));
          gl_FragColor = vec4(c*(0.35+heat*1.3)*a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), fbMat()); m.visible = false; scene.add(m); this.balls.push({ m, t: 0, max: 1, size: 1 }); }
    // debris chunks (instanced)
    this.debrisMax = 260;
    const dg = new THREE.IcosahedronGeometry(1, 0);
    this.debris = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0x5a3020, roughness: 0.9 }), this.debrisMax);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.debris.castShadow = true; this.debris.frustumCulled = false;
    this.debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.debrisMax * 3), 3);
    scene.add(this.debris); this.dlist = [];
    // laser bolts
    this.bolts = new Map();
    this.boltGeo = new THREE.PlaneGeometry(1, 1);
    this.boltMats = new Map();
    // beams (persistent per owner)
    this.beams = new Map();
    // missiles
    this.missiles = new Map();
    this.missileGeo = (() => { const g = new THREE.CylinderGeometry(0.18, 0.28, 2.6, 8); g.rotateX(Math.PI / 2); return g; })();
    this.missileMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.6, roughness: 0.35 });
    // scorch marks
    this.scorch = [];
    this.scorchMat = new THREE.SpriteMaterial({ map: softTex(), color: 0x120806, transparent: true, depthWrite: false, opacity: 0.8 });
    // rail trails
    this.rails = [];
    this.shake = 0;
  }
  ringTex() {
    if (this._rt) return this._rt;
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this._rt = new THREE.CanvasTexture(c); return this._rt;
  }
  flash(p, color, intensity, dur) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.copy(p); L.l.color.set(color); L.max = intensity; L.t = dur; L.dur = dur;
  }
  sparks(p, dir, n, color = 0xffc070, speed = 60) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const v = rv(speed).add(tmp.copy(dir).multiplyScalar(speed * 0.6));
      this.add.emit(p, v, c, 0.6 + Math.random() * 0.8, 0.25 + Math.random() * 0.45, { drag: 2.5, grav: 30 });
    }
  }
  hitImpact(p, normal, color) {
    const c = new THREE.Color(color);
    this.add.emit(p, tmp.set(0, 0, 0), c, 7, 0.12);
    this.add.emit(p, tmp.set(0, 0, 0), new THREE.Color(1, 1, 1), 3, 0.08);
    this.sparks(p, normal, 10, color, 50);
  }
  wallHit(p, normal, color) {
    this.hitImpact(p, normal, color);
    this.smoke.emit(p, tmp.copy(normal).multiplyScalar(4), new THREE.Color(0x6a4030), 3, 1.2, { grow: 6, alpha: 0.5 });
    // glowing scorch that cools down (level damage)
    if (this.scorch.length > 140) { const o = this.scorch.shift(); this.scene.remove(o.s); this.scene.remove(o.g); }
    const s = new THREE.Sprite(this.scorchMat.clone()); s.position.copy(p).addScaledVector(normal, 0.3); s.scale.setScalar(4 + Math.random() * 3); this.scene.add(s);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xff6a20, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); g.position.copy(s.position); g.scale.setScalar(3); this.scene.add(g);
    this.scorch.push({ s, g, t: 0 });
  }
  explosion(p, scale = 1, { color = 0xff7a30, debris = 14, debrisColor = 0x3a3d45, ring = true } = {}) {
    this.flash(p, color, 26 * scale, 0.45);
    // dark smoke column so the blast reads as fire and smoke, not a white blob
    for (let k = 0; k < 10 * Math.min(2, scale + 0.3); k++) this.smoke.emit(tmp.copy(p).add(rv(4 * scale)), rv(6 * scale).add(tmp2.set(0, 5, 0)), new THREE.Color(0x231d1a), (5 + Math.random() * 4) * scale, 2.2, { grow: 7 * scale, alpha: 0.75, drag: 0.8 });
    // fireball(s)
    for (let k = 0; k < 2; k++) {
      const b = this.balls.reduce((a, c) => (!a.m.visible ? a : !c.m.visible ? c : (a.t > c.t ? a : c)));
      b.m.visible = true; b.t = 0; b.max = 0.9 + k * 0.3; b.size = (6 + k * 3) * scale;
      b.m.position.copy(p).add(rv(3 * scale)); b.m.material.uniforms.uSeed.value = Math.random() * 100;
    }
    const cfire = new THREE.Color(1, 0.55, 0.2), cwhite = new THREE.Color(1, 0.95, 0.8);
    this.add.emit(p, tmp.set(0, 0, 0), cwhite, 14 * scale, 0.12, { alpha: 0.7 });
    for (let i = 0; i < 40 * scale; i++) this.add.emit(p, rv(45 * scale), cfire, (2.5 + Math.random() * 3) * scale, 0.35 + Math.random() * 0.45, { drag: 3, grow: 4 * scale, alpha: 0.45 });
    for (let i = 0; i < 60 * scale; i++) this.add.emit(p, rv(140 * scale), new THREE.Color(1, 0.75, 0.4), 0.8, 0.5 + Math.random() * 0.7, { drag: 1.5, grav: 40 });
    for (let i = 0; i < 18 * scale; i++) this.smoke.emit(tmp.copy(p).add(rv(5 * scale)), rv(14 * scale), new THREE.Color(0x5a4640).multiplyScalar(0.8 + Math.random() * 0.4), (5 + Math.random() * 4) * scale, 1.6 + Math.random() * 1.6, { grow: 6 * scale, drag: 0.8, alpha: 0.5 });
    if (ring) {
      const r = this.rings.find(r => !r.m.visible) || this.rings[0];
      r.m.visible = true; r.t = 0; r.max = 0.6; r.size = 70 * scale; r.m.position.copy(p);
      r.m.lookAt(p.x + Math.random() - 0.5, p.y + 10, p.z + Math.random() - 0.5); r.m.material.color.set(color);
    }
    this.spawnDebris(p, debris * scale, debrisColor, 60 * scale, 0.4 + 0.6 * scale);
  }
  spawnDebris(p, n, color, speed, size, smokeTrail = true) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.dlist.length >= this.debrisMax) this.dlist.shift();
      this.dlist.push({ p: p.clone().add(rv(2)), v: rv(speed).add(tmp.set(0, speed * 0.4, 0)), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: rv(8).clone(), s: size * (0.4 + Math.random()), life: 3 + Math.random() * 2, c: c.clone().multiplyScalar(0.7 + Math.random() * 0.5), trail: smokeTrail && Math.random() < 0.5 });
    }
  }
  shatterRock(sp) {
    // big destructible spire: chunks fall near camera with dust
    const base = sp.mesh.position, h = sp.height;
    for (let k = 0; k < 6; k++) {
      const p = base.clone(); p.y += h * (0.2 + k * 0.14);
      this.explosion(p, 0.7, { debris: 8, debrisColor: 0x8a4428, ring: k === 0 });
    }
    for (let i = 0; i < 70; i++) {
      if (this.dlist.length >= this.debrisMax) this.dlist.shift();
      const p = base.clone(); p.y += Math.random() * h; p.x += rnd(sp.radius); p.z += rnd(sp.radius);
      this.dlist.push({ p, v: rv(30).add(tmp.set(0, 10, 0)), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: rv(3).clone(), s: 1.5 + Math.random() * 4.5, life: 5 + Math.random() * 3, c: new THREE.Color(0x9a4a2a).multiplyScalar(0.6 + Math.random() * 0.6), trail: false, rock: true });
    }
    for (let i = 0; i < 40; i++) {
      const p = base.clone(); p.y += Math.random() * h;
      this.smoke.emit(p, rv(10), new THREE.Color(0xb07050), 14 + Math.random() * 10, 3 + Math.random() * 2, { grow: 10, drag: 0.6, alpha: 0.55 });
    }
    sp.mesh.visible = false;
    this.shake = Math.max(this.shake, 1);
  }
  damageSmoke(p, hpFrac, dt) {
    if (hpFrac > 0.6) return;
    const rate = hpFrac < 0.3 ? 40 : 14;
    if (Math.random() < rate * dt) this.smoke.emit(p, rv(3), new THREE.Color(0x2a2522), 2.4, 1.6, { grow: 6, alpha: 0.7 });
    if (hpFrac < 0.3 && Math.random() < 8 * dt) this.add.emit(p, rv(3), new THREE.Color(0.9, 0.32, 0.06), 1.4, 0.18, { grow: 1 });
    if (hpFrac < 0.45 && Math.random() < 6 * dt) this.sparks(p, tmp.set(0, 1, 0), 4, 0xffd080, 25);
  }
  // --- lasers / beams / missiles visuals, keyed by sim ids ---
  boltMat(color) { if (!this.boltMats.has(color)) this.boltMats.set(color, beamMaterial(color)); return this.boltMats.get(color); }
  syncBolts(list, toWorldFn, camPos) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let m = this.bolts.get(b.id);
      if (!m) {
        m = new THREE.Group();
        const mat = this.boltMat(b.color);
        const p1 = new THREE.Mesh(this.boltGeo, mat), p2 = new THREE.Mesh(this.boltGeo, mat);
        p2.rotation.z = Math.PI / 2; m.add(p1, p2);
        m.children.forEach(c => { c.rotation.x = Math.PI / 2; });
        this.scene.add(m); this.bolts.set(b.id, m);
      }
      const p = toWorldFn(b.s, b.x, b.y, tmp);
      const q = toWorldFn(b.s - b.len, b.x - b.vx * 0.012, b.y - b.vy * 0.012, tmp2);
      m.position.copy(p).add(q).multiplyScalar(0.5);
      m.lookAt(p);
      m.scale.set(b.w, b.w, p.distanceTo(q));
      m.children[0].rotation.set(Math.PI / 2, 0, 0); m.children[1].rotation.set(Math.PI / 2, Math.PI / 2, 0);
    }
    for (const [id, m] of this.bolts) if (!seen.has(id)) { this.scene.remove(m); this.bolts.delete(id); }
  }
  setBeam(id, a, b, color, width = 1.2, alpha = 1) {
    let m = this.beams.get(id);
    if (!m) {
      const mat = beamMaterial(color);
      m = new THREE.Group();
      const p1 = new THREE.Mesh(this.boltGeo, mat), p2 = new THREE.Mesh(this.boltGeo, mat);
      m.add(p1, p2); m.userData.mat = mat; this.scene.add(m); this.beams.set(id, m);
    }
    m.visible = true; m.userData.alive = true;
    m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b);
    const L = a.distanceTo(b);
    m.children[0].rotation.set(Math.PI / 2, 0, 0); m.children[1].rotation.set(Math.PI / 2, Math.PI / 2, 0);
    m.scale.set(width, width, L);
    m.children.forEach(c => { c.scale.set(1, 1, 1); });
    m.userData.mat.uniforms.uTime.value = this.time; m.userData.mat.uniforms.uOpacity.value = alpha;
    m.children[0].geometry = this.boltGeo;
  }
  endBeamFrame() {
    for (const [id, m] of this.beams) { if (!m.userData.alive) m.visible = false; m.userData.alive = false; }
  }
  railTrail(a, b, color) {
    const mat = beamMaterial(color);
    const m = new THREE.Group(); const p1 = new THREE.Mesh(this.boltGeo, mat), p2 = new THREE.Mesh(this.boltGeo, mat);
    p1.rotation.set(Math.PI / 2, 0, 0); p2.rotation.set(Math.PI / 2, Math.PI / 2, 0); m.add(p1, p2);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); m.scale.set(2.2, 2.2, a.distanceTo(b));
    this.scene.add(m); this.rails.push({ m, mat, t: 0 });
    // helix sparks along the rail
    const c = new THREE.Color(color), d = tmp.subVectors(b, a); const L = d.length(); d.normalize();
    for (let i = 0; i < L; i += 3) this.add.emit(tmp2.copy(a).addScaledVector(d, i).add(rv(1.2)), rv(4), c, 1.6, 0.6 + Math.random() * 0.4, { drag: 2 });
  }
  syncMissiles(list, toWorldFn, dt) {
    const seen = new Set();
    for (const ms of list) {
      seen.add(ms.id);
      let o = this.missiles.get(ms.id);
      if (!o) {
        o = new THREE.Group();
        const body = new THREE.Mesh(this.missileGeo, this.missileMat); body.scale.setScalar(ms.mine ? 2.2 : (ms.big ? 1.5 : 1)); o.add(body);
        const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: ms.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        fl.scale.setScalar(ms.mine ? 6 : 5); fl.position.z = -1.6; o.add(fl);
        this.scene.add(o); this.missiles.set(ms.id, o); o.userData.prev = toWorldFn(ms.s, ms.x, ms.y, new THREE.Vector3()); o.userData.color = new THREE.Color(ms.color);
      }
      const p = toWorldFn(ms.s, ms.x, ms.y, tmp).clone();
      const prev = o.userData.prev;
      o.position.copy(p);
      if (p.distanceToSquared(prev) > 0.0001) o.lookAt(tmp2.copy(p).multiplyScalar(2).sub(prev));
      if (!ms.mine) {
        const steps = 3;
        for (let k = 0; k < steps; k++) {
          const q = tmp2.copy(prev).lerp(p, k / steps);
          this.smoke.emit(q, rv(1.5), new THREE.Color(0xd8d0cc), 1.4, 1.4, { grow: 4, alpha: 0.35 });
        }
        this.add.emit(p, tmp.set(0, 0, 0), o.userData.color, 2.6, 0.08);
      } else {
        o.rotation.y += dt * 4; o.children[1].material.opacity = 0.5 + 0.5 * Math.sin(this.time * 12);
      }
      prev.copy(p);
    }
    for (const [id, o] of this.missiles) if (!seen.has(id)) { this.scene.remove(o); this.missiles.delete(id); }
  }
  update(dt) {
    this.time += dt;
    this.add.update(dt); this.smoke.update(dt);
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = L.max * Math.max(0, L.t / L.dur) * 60; } else L.l.intensity = 0; }
    for (const r of this.rings) if (r.m.visible) {
      r.t += dt; const k = r.t / r.max; if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(r.size * (0.1 + Math.pow(k, 0.5))); r.m.material.opacity = (1 - k) * 0.9;
    }
    for (const b of this.balls) if (b.m.visible) {
      b.t += dt; const k = b.t / b.max; if (k >= 1) { b.m.visible = false; continue; }
      b.m.material.uniforms.uT.value = k; b.m.scale.setScalar(b.size * (0.35 + Math.pow(k, 0.4) * 0.9));
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let i = 0;
    for (const d of this.dlist) {
      d.life -= dt; d.v.y -= 40 * dt; d.p.addScaledVector(d.v, dt);
      const gh = this.heightAt(d.p.x, d.p.z);
      if (d.p.y < gh + d.s * 0.5) { d.p.y = gh + d.s * 0.5; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; if (d.rock && Math.abs(d.v.y) > 6) this.smoke.emit(d.p, rv(3), new THREE.Color(0xb07050), 4, 1.2, { grow: 6, alpha: 0.4 }); }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt;
      if (d.trail && d.life > 1.5 && Math.random() < 0.6) this.smoke.emit(d.p, rv(1), new THREE.Color(0x222), 1.2 + d.s, 0.9, { grow: 3, alpha: 0.5 });
      if (d.trail && d.life > 2 && Math.random() < 0.5) this.add.emit(d.p, rv(1), new THREE.Color(1, 0.5, 0.15), 1.2 * d.s, 0.15);
      const sc = d.s * Math.min(1, d.life);
      m4.compose(d.p, q.setFromEuler(d.r), s.set(sc, sc * 0.7, sc * 1.2));
      this.debris.setMatrixAt(i, m4); this.debris.setColorAt(i, d.c); i++;
    }
    this.dlist = this.dlist.filter(d => d.life > 0);
    this.debris.count = i; this.debris.instanceMatrix.needsUpdate = true; if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
    for (const sc of this.scorch) {
      sc.t += dt; sc.g.material.opacity = Math.max(0, 1 - sc.t / 2.5);
      if (sc.t > 30) sc.s.material.opacity = Math.max(0, 0.8 - (sc.t - 30) / 10);
    }
    this.rails = this.rails.filter(r => { r.t += dt; r.mat.uniforms.uOpacity.value = Math.max(0, 1 - r.t / 0.5); r.m.scale.x = r.m.scale.y = 2.2 * (1 + r.t * 3); if (r.t > 0.5) { this.scene.remove(r.m); return false; } return true; });
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}

// Flying case (pickup) after references/.../02_Seven_Flying_Pickups.png: a glass cube with armoured
// corner brackets, neon edges, glowing emitters top and bottom and a holographic item icon inside.
const CASE_SIZE = 5;
let CASE_GEO = null;
function caseGeometry() {
  if (CASE_GEO) return CASE_GEO;
  const S = CASE_SIZE, h = S / 2, dark = [], glow = [];
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) {
    // chunky corner armour: plates meeting at the corner
    dark.push(new THREE.BoxGeometry(1.25, 0.5, 1.25).translate(x * 0.93, y * 0.96, z * 0.93));
    dark.push(new THREE.BoxGeometry(0.5, 1.2, 0.5).translate(x * 0.98, y * 0.8, z * 0.98));
    glow.push(new THREE.BoxGeometry(0.18, 0.6, 0.18).translate(x * 1.06, y * 0.62, z * 0.86));
  }
  for (const a of [-h, h]) for (const b of [-h, h]) {
    glow.push(new THREE.BoxGeometry(0.09, S * 0.7, 0.09).translate(a, 0, b));
    glow.push(new THREE.BoxGeometry(S * 0.72, 0.07, 0.07).translate(0, a, b));
    glow.push(new THREE.BoxGeometry(0.07, 0.07, S * 0.72).translate(a, b, 0));
  }
  for (const y of [-h, h]) {
    dark.push(new THREE.CylinderGeometry(0.95, 1.1, 0.4, 24).translate(0, y * 0.86, 0));
    glow.push(new THREE.TorusGeometry(0.62, 0.09, 8, 32).rotateX(Math.PI / 2).translate(0, y * 0.86 - Math.sign(y) * 0.22, 0));
    glow.push(new THREE.CircleGeometry(0.45, 24).rotateX(y > 0 ? Math.PI / 2 : -Math.PI / 2).translate(0, y * 0.86 - Math.sign(y) * 0.21, 0));
  }
  CASE_GEO = { glass: new THREE.BoxGeometry(S * 0.98, S * 0.98, S * 0.98), dark: mergeGeometries(dark), glow: mergeGeometries(glow) };
  return CASE_GEO;
}
const CASE_DARK = new THREE.MeshStandardMaterial({ color: 0x4a4f58, metalness: 0.5, roughness: 0.4 });
const CASE_MATS = {};
function caseMaterials(key, color) {
  if (CASE_MATS[key]) return CASE_MATS[key];
  const c = new THREE.Color(color);
  return (CASE_MATS[key] = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb4c8, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, emissive: c.clone().multiplyScalar(0.06) }),
    glow: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.15) }),
    icon: new THREE.SpriteMaterial({ map: iconTexture(key, color), color: new THREE.Color(1.25, 1.25, 1.25), transparent: true, depthWrite: false }),
    halo: new THREE.SpriteMaterial({ map: softTex(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.32 }),
  });
}
export function buildCase() {
  const G = caseGeometry(), g = new THREE.Group();
  const glass = new THREE.Mesh(G.glass), dark = new THREE.Mesh(G.dark, CASE_DARK), glow = new THREE.Mesh(G.glow);
  const icon = new THREE.Sprite(); icon.scale.setScalar(3.6);
  const halo = new THREE.Sprite(); halo.scale.setScalar(10);
  dark.castShadow = true;
  g.add(glass, dark, glow, halo, icon);
  g.userData = { glass, glow, icon, halo, key: null, dim: null };
  return g;
}
// show item `key` (colour `color`) in case `c`; `dim` = this racer cannot take it on this lap
export function setCase(c, key, color, dim = false) {
  const u = c.userData;
  if (u.key !== key) {
    const M = caseMaterials(key, color);
    u.glass.material = M.glass; u.glow.material = M.glow; u.icon.material = M.icon; u.halo.material = M.halo; u.key = key;
  }
  if (u.dim !== dim) { u.dim = dim; c.scale.setScalar(dim ? 0.55 : 1); u.halo.visible = !dim; u.glow.visible = !dim; }
}

// Boost ring
export function buildBoostRing() {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(16, 0.5, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x29f3ff).multiplyScalar(1.8) }));
  const t2 = new THREE.Mesh(new THREE.TorusGeometry(19, 0.25, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2fd0).multiplyScalar(1.8) }));
  g.add(t, t2); return g;
}
