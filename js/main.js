// RED RIFT — app shell: renderer, post-processing, hangar menu, race loop, cameras, HUD, input.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TRACK, FEATURES, toWorld, frameAt, newFrame, wrapS, sectorName, typeAt, bounds } from './track.js';
import { buildWorld } from './world.js';
import { buildShip, updateShipFx, loadShipModels, buildWreck } from './ships.js';
import { FX, buildCase, setCase, buildBoostRing } from './fx.js';
import { iconURL } from './icons.js';
import { Race, dS } from './sim.js';
import { Net, snapshot, applySnapshot, extrapolate } from './net.js';
import { SHIPS, SHIP_LIVERIES, FINISHES, PALETTE, LASERS, MISSILES, ITEMS, AI_LEVELS, RACE } from './config.js';
import { Audio } from './audio.js';
import { softTex } from './shaders.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no gl');
} catch (e) { $('loading').classList.add('hidden'); $('err').classList.remove('hidden'); throw e; }
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, 0.5, 40000);
const audio = new Audio();

// ---------------- settings ----------------
const DEF = { ship: 0, liveryIdx: 0, livery: { ...SHIP_LIVERIES[0][0] }, finish: 'gloss', laser: 0, missile: 0, diff: 1, name: 'ПИЛОТ', gfx: 1 };
let S = { ...DEF };
try { const raw = localStorage.getItem('redrift.settings'); if (raw) S = { ...DEF, ...JSON.parse(raw) }; } catch (e) { /* storage blocked */ }
if (!(S.ship >= 0 && S.ship < SHIPS.length)) S.ship = 0;
if (S.liveryIdx > 4 || !S.livery) S.liveryIdx = 0;
if (S.liveryIdx >= 0) S.livery = { ...SHIP_LIVERIES[S.ship][S.liveryIdx] }; // follow the current livery set
// every airframe remembers its own paint
if (!S.paint || typeof S.paint !== 'object') S.paint = {};
S.paint[S.ship] = { idx: S.liveryIdx, livery: { ...S.livery } };
function rememberPaint() { S.paint[S.ship] = { idx: S.liveryIdx, livery: { ...S.livery } }; }
function recallPaint(i) {
  const p = S.paint[i];
  if (p && p.idx >= 0 && p.idx < 5) { S.liveryIdx = p.idx; S.livery = { ...SHIP_LIVERIES[i][p.idx] }; }
  else if (p && p.idx === -1 && p.livery) { S.liveryIdx = -1; S.livery = { ...p.livery }; }
  else { S.liveryIdx = 0; S.livery = { ...SHIP_LIVERIES[i][0] }; }
}
const save = () => { try { localStorage.setItem('redrift.settings', JSON.stringify(S)); } catch (e) { /* ignore */ } };
const GFX = [{ name: 'НИЗКАЯ', pr: 0.75, shadows: false, bloom: 0.6 }, { name: 'СРЕДНЯЯ', pr: 1.25, shadows: true, bloom: 0.8 }, { name: 'ВЫСОКАЯ', pr: 2, shadows: true, bloom: 0.85 }];

// ---------------- post ----------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.8, 0.55, 0.82);
composer.addPass(bloom);
const cinema = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAberr: { value: 0 }, uDesat: { value: 0 }, uVig: { value: 0.9 }, uRed: { value: 0 }, uTime: { value: 0 }, uEmp: { value: 0 }, uBlur: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAberr, uDesat, uVig, uRed, uTime, uEmp, uBlur; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv-0.5;
      if (uEmp>0.0) uv.x += (h(vec2(floor(uv.y*90.0), floor(uTime*30.0)))-0.5)*0.02*uEmp;
      vec3 col = vec3(0.0); float tot = 0.0;
      for (int i=0;i<6;i++){ float k = 1.0 - uBlur*0.012*float(i); vec2 q = 0.5 + c*k; float w = 1.0 - float(i)*0.12;
        col.r += texture2D(tDiffuse, q + c*uAberr).r*w; col.g += texture2D(tDiffuse, q).g*w; col.b += texture2D(tDiffuse, q - c*uAberr).b*w; tot += w; }
      col /= tot;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(l)*vec3(0.85,0.8,1.15), uDesat);
      col *= uTint;
      float v = dot(c,c);
      col *= 1.0 - v*uVig;
      col = mix(col, vec3(0.6,0.0,0.05), clamp(uRed*smoothstep(0.08,0.5,v)*1.4,0.0,0.85));
      if (uEmp>0.0) col += vec3(0.2,0.5,1.0)*step(0.985, h(uv*vec2(400.0,200.0)+uTime))*uEmp;
      gl_FragColor = vec4(col,1.0);
    }`,
});
composer.addPass(cinema);
composer.addPass(new OutputPass());

function applyGfx() {
  const g = GFX[S.gfx];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, g.pr));
  renderer.shadowMap.enabled = g.shadows;
  bloom.strength = g.bloom;
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------- loading ----------------
let W, fx;
async function boot() {
  const bar = $('loadbar'), txt = $('loadtext');
  const step = (p, t) => { bar.style.width = (p * 100) + '%'; if (t) txt.textContent = t; return new Promise(r => setTimeout(r, 30)); };
  await step(0.1, 'Генерация каньонов и тоннеля…');
  W = buildWorld(scene, renderer, () => {});
  await step(0.55, 'Загрузка самолётов…');
  await loadShipModels(SHIPS.map(s => s.key), (k) => step(0.55 + k * 0.15));
  await step(0.7, 'Сборка флота и эффектов…');
  fx = new FX(scene, W.heightAt);
  // warm-up compile
  applyGfx();
  setupHangar();
  renderer.compile(scene, camera);
  await step(1, 'Готово');
  $('loading').classList.add('hidden');
  showMenu();
  requestAnimationFrame(loop);
  const room = new URLSearchParams(location.search).get('room');
  if (room) { document.querySelector('#tabs [data-tab=online]').click(); $('mpCode').value = room.toUpperCase(); $('mpJoin').click(); }
}

// ---------------- hangar ----------------
let mode = 'menu';
let displayShip = null;
const hangarPos = new THREE.Vector3();
const pad = new THREE.Group();
function setupHangar() {
  const f = frameAt(-140, newFrame());
  hangarPos.copy(f.p).addScaledVector(f.r, -60); hangarPos.y = TRACK.floorY[0] + 16;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(16, 18, 1.5, 48), new THREE.MeshStandardMaterial({ color: 0x15151c, metalness: 0.9, roughness: 0.25 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(17, 0.35, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2f6a).multiplyScalar(1.6) }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.8;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(13, 0.2, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x29f3ff).multiplyScalar(1.6) }));
  ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.8;
  const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xff2f6a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.08 }));
  beam.scale.set(34, 5, 1); beam.position.y = 1;
  pad.add(disc, ring, ring2, beam); pad.position.copy(hangarPos).add(new THREE.Vector3(0, -3.6, 0));
  const spot = new THREE.SpotLight(0xffffff, 900, 120, 0.6, 0.6, 1.4); spot.position.set(20, 40, 25); spot.target = pad; pad.add(spot);
  const rim = new THREE.PointLight(0x29f3ff, 400, 80, 1.5); rim.position.set(-25, 10, -20); pad.add(rim);
  scene.add(pad);
}
function refreshDisplayShip() {
  if (displayShip) scene.remove(displayShip);
  displayShip = buildShip(SHIPS[S.ship].key, S.livery, S.finish, 7);
  displayShip.position.copy(hangarPos);
  displayShip.scale.setScalar(1.15);
  scene.add(displayShip);
  // frame the whole airframe: orbit distance follows the ship's size
  const bs = new THREE.Box3().setFromObject(displayShip.userData.body).getBoundingSphere(new THREE.Sphere());
  orbit.base = Math.max(20, bs.radius * 3.0); orbit.dist = orbit.base;
}

// ---------------- menu UI ----------------
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function buildMenu() {
  const sl = $('shipList'); sl.innerHTML = '';
  SHIPS.forEach((sh, i) => { const b = el('button', i === S.ship ? 'on' : '', sh.name); b.onclick = () => { S.ship = i; recallPaint(i); audio.play('ui'); save(); buildMenu(); refreshDisplayShip(); }; sl.appendChild(b); });
  const sh = SHIPS[S.ship];
  $('shipName').textContent = sh.name; $('shipRole').textContent = sh.role; $('shipDesc').textContent = sh.desc;
  const st = $('shipStats'); st.innerHTML = '';
  const names = { speed: 'Скорость', handling: 'Манёвр', armor: 'Броня', firepower: 'Огонь' };
  for (const k in names) { st.appendChild(el('span', '', names[k])); const p = el('div', 'pips'); for (let i = 0; i < 5; i++) p.appendChild(el('i', i < sh.stats[k] ? 'f' : '')); st.appendChild(p); }
  st.appendChild(el('span', '', 'Броня, ед.')); st.appendChild(el('span', '', String(sh.hp)));
  st.appendChild(el('span', '', 'Макс. км/ч')); st.appendChild(el('span', '', String(Math.round(sh.top * 3.6))));
  $('abName').textContent = sh.ability.name; $('abDesc').textContent = sh.ability.desc;
  // liveries
  // this airframe's five paint schemes: in the Livery tab and right under the ship on the Ship tab
  for (const ll of [$('liveryList'), $('shipLiveries')]) {
    ll.innerHTML = '';
    SHIP_LIVERIES[S.ship].forEach((lv, i) => {
      const b = el('button', i === S.liveryIdx ? 'on' : '');
      const strip = el('div', 'strip'); for (const k of ['primary', 'secondary', 'accent', 'neon']) { const c = el('i'); c.style.background = lv[k]; strip.appendChild(c); }
      b.appendChild(strip); b.appendChild(el('span', '', lv.name));
      b.onclick = () => { S.liveryIdx = i; S.livery = { ...lv }; rememberPaint(); audio.play('ui'); save(); buildMenu(); refreshDisplayShip(); };
      ll.appendChild(b);
    });
  }
  $('paintFor').textContent = SHIPS[S.ship].name;
  const fl = $('finishList'); fl.innerHTML = '';
  FINISHES.forEach(f => { const b = el('button', f.key === S.finish ? 'on' : '', f.name); b.onclick = () => { S.finish = f.key; audio.play('ui'); save(); buildMenu(); refreshDisplayShip(); }; fl.appendChild(b); });
  document.querySelectorAll('.sw').forEach(sw => {
    const slot = sw.dataset.slot; sw.style.background = S.livery[slot];
    sw.onclick = (ev) => {
      const pop = $('swatchPop'); pop.innerHTML = ''; pop.hidden = false;
      const r = sw.getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - 230) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
      PALETTE.forEach(c => { const i = el('i'); i.style.background = c; i.onclick = () => { S.livery = { ...S.livery, [slot]: c, name: 'СВОЯ' }; S.liveryIdx = -1; rememberPaint(); pop.hidden = true; save(); buildMenu(); refreshDisplayShip(); }; pop.appendChild(i); });
      ev.stopPropagation();
    };
  });
  const card = (list, sel, onPick) => (it, i) => { const b = el('button', i === sel ? 'on' : ''); const d = el('div', 'dot'); d.style.background = it.color || '#fff'; b.append(d, el('b', '', it.name), el('span', '', it.desc)); b.onclick = () => { onPick(i); audio.play('ui'); save(); buildMenu(); }; list.appendChild(b); };
  const lz = $('laserList'); lz.innerHTML = ''; LASERS.forEach(card(lz, S.laser, i => S.laser = i));
  const ms = $('missileList'); ms.innerHTML = ''; MISSILES.forEach(card(ms, S.missile, i => S.missile = i));
  const dl = $('diffList'); dl.innerHTML = '';
  const dDesc = ['Медленные, мажут, редко стреляют', 'Честная гонка', 'Агрессивные и точные', 'Без пощады, идеальная траектория'];
  AI_LEVELS.forEach((lv, i) => card(dl, S.diff, j => S.diff = j)({ name: lv.name, desc: dDesc[i], color: ['#00ff9c', '#29f3ff', '#ffb020', '#ff3050'][i] }, i));
  const gl = $('gfxList'); gl.innerHTML = '';
  GFX.forEach((g, i) => { const b = el('button', i === S.gfx ? 'on' : '', g.name); b.onclick = () => { S.gfx = i; save(); applyGfx(); buildMenu(); }; gl.appendChild(b); });
  $('pilotName').value = S.name;
  $('startBtn').textContent = net.role === 'client' ? 'ЖДЁМ ХОЗЯИНА' : net.role === 'host' && mp.guests.size ? 'НА СТАРТ · ОНЛАЙН' : 'НА СТАРТ';
  if (net.role === 'client') net.send({ t: 'hello', p: profile() }); // keep the host's copy of our ship and paint current
}
$('pilotName').addEventListener('input', e => { S.name = (e.target.value || 'ПИЛОТ').toUpperCase().slice(0, 12); save(); });
document.addEventListener('click', () => { $('swatchPop').hidden = true; });
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('#panel section').forEach(s => s.hidden = s.dataset.pane !== b.dataset.tab);
  audio.init(); audio.play('ui');
});
function showMenu() {
  mode = 'menu'; clearRace(); audio.setIntensity(0); if (audio.ctx) { audio.stopEngine(); audio.beamOn(false); } r0beamSound = false;
  ['hud', 'pause', 'results'].forEach(id => $(id).classList.add('hidden')); showTouch(false);
  $('menu').classList.remove('hidden'); canvas.style.cursor = 'grab';
  buildMenu(); refreshDisplayShip(); pad.visible = true;
}
$('startBtn').onclick = () => { audio.init(); if (net.role === 'client') { mpStatus('Гонку запускает хозяин комнаты'); return; } startRace(); };
$('resumeBtn').onclick = () => togglePause(false);
$('restartBtn').onclick = () => { togglePause(false); if (net.role === 'client') return; startRace(); };
$('quitBtn').onclick = () => { togglePause(false); if (net.role === 'host') net.send({ t: 'end' }); showMenu(); };
$('againBtn').onclick = () => { if (net.role === 'client') { sub('Ждём хозяина комнаты'); return; } startRace(); };
$('hangarBtn').onclick = () => { if (net.role === 'host') net.send({ t: 'end' }); showMenu(); };

// ---------------- race ----------------
let race = null, raceGroup = null, shipMeshes = [], caseMeshes = [], ghosts = [], droneSprites = [], holoMeshes = [], wrecks = [];
let paused = false, acc = 0, timeScale = 1, slowT = 0, slowScale = 1;
let camMode = 0, missileCam = false, mcamHold = 0, mcamLast = new THREE.Vector3(), deathPos = null;
let lapStart = 0, lastLap = 1, bestLap = Infinity, lastSector = '', sectorT = 0, finishT = -1;
let hurt = 0, hitShake = 0, empFx = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

function clearRace() {
  if (raceGroup) { scene.remove(raceGroup); raceGroup = null; }
  race = null; shipMeshes = []; caseMeshes = []; ghosts = []; droneSprites = []; holoMeshes = []; wrecks = [];
  for (const sp of FEATURES.spires) { if (sp.mesh) sp.mesh.visible = true; sp.alive = true; }
  if (fx) { fx.syncBolts([], toWorld); fx.syncMissiles([], toWorld, 0); fx.endBeamFrame(); }
}

function startRace(setup = null) {
  clearRace();
  if (displayShip) { scene.remove(displayShip); displayShip = null; }
  pad.visible = false;
  race = makeRace(setup);
  raceGroup = new THREE.Group(); scene.add(raceGroup);
  race.racers.forEach((r, i) => {
    const m = buildShip(r.def.key, r.livery, r.finish, i + 1); raceGroup.add(m); shipMeshes[i] = m;
    const ds = []; for (let k = 0; k < 3; k++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xff8a1e, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); s.scale.setScalar(3); s.visible = false; raceGroup.add(s); ds.push(s); }
    droneSprites[i] = ds;
  });
  for (const p of race.pickups) { const c = buildCase(); raceGroup.add(c); caseMeshes.push(c); }
  const f = newFrame();
  for (const ring of FEATURES.boostRings) {
    const m = buildBoostRing(); frameAt(ring.s, f);
    m.position.copy(toWorld(ring.s, ring.x, ring.y));
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate()));
    raceGroup.add(m);
  }
  for (const cs of FEATURES.checkpoints.slice(0, -1)) raceGroup.add(buildGate(cs, f));
  paused = false; acc = 0; timeScale = 1; slowT = 0; camMode = 0; missileCam = false; deathPos = null;
  lapStart = 0; lastLap = 1; bestLap = Infinity; lastSector = ''; finishT = -1; hurt = 0;
  mode = 'race'; audio.setIntensity(1);
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('hud').classList.remove('hidden'); showTouch(true); canvas.style.cursor = '';
  $('hCpN').textContent = FEATURES.checkpoints.length;
  $('hMslName').textContent = MISSILES[S.missile].name; $('hAbName').textContent = SHIPS[S.ship].ability.name;
  $('hFeed').innerHTML = ''; $('hSub').textContent = ''; subT = 0; toastT = 0; $('hToast').classList.remove('show'); $('hItem').dataset.key = '-';
  const p = race.player; placeCamera(p, 1, true);
  center('3', true);
}

// checkpoint gate: two neon posts on the corridor edges (a thin ring inside the tunnel)
const gateMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x29f3ff).multiplyScalar(3), transparent: true, opacity: 0.85, depthWrite: false });
function buildGate(cs, f) {
  const g = new THREE.Group(); const b = bounds(cs); frameAt(cs, f);
  const basis = new THREE.Matrix4().makeBasis(f.r, f.u, f.t.clone().negate());
  if (b.tunnel) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(b.hw - 2, 0.35, 6, 64), gateMat);
    ring.position.copy(toWorld(cs, 0, 0)); ring.quaternion.setFromRotationMatrix(basis); g.add(ring);
    return g;
  }
  const h = Math.min(60, b.yMax - b.yMin);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), gateMat);
    post.position.copy(toWorld(cs, side * (b.hw - 3), b.yMin + h / 2)); post.quaternion.setFromRotationMatrix(basis);
    g.add(post);
  }
  return g;
}

// ---------------- multiplayer (2-3 pilots, host runs the race) ----------------
const net = new Net();
const mp = { guests: new Map(), seats: new Map(), me: 0, outbox: [], lastSnap: 0, lastSend: 0, pending: null, cnt: { m: 0, e: 0, q: 0 }, lobby: [] };
const profile = () => ({ name: S.name, ship: S.ship, laser: S.laser, missile: S.missile, livery: S.livery, finish: S.finish });
function mpStatus(t) { $('mpStatus').textContent = t; }
function makeRace(setup) {
  if (setup) { mp.me = setup.me; return new Race({ player: profile(), difficulty: setup.diff, grid: setup.grid, me: setup.me }); }
  if (net.role === 'host' && mp.guests.size) {
    const list = [...mp.guests.entries()];
    const rc = new Race({ player: profile(), difficulty: S.diff, guests: list.map(([, p]) => p) });
    mp.seats = new Map(list.map(([peer], i) => [peer, i + 1])); mp.outbox = [];
    for (const [peer, idx] of mp.seats) net.send({ t: 'start', grid: rc.grid, diff: S.diff, me: idx }, peer);
    return rc;
  }
  mp.seats = new Map();
  return new Race({ player: profile(), difficulty: S.diff });
}
function renderLobby(list) {
  mp.lobby = list; const ol = $('mpPlayers'); ol.innerHTML = '';
  list.forEach((p, i) => { ol.appendChild(el('li', '', p.name + ' <span>· ' + (SHIPS[p.ship] ? SHIPS[p.ship].name : '?') + (i === 0 ? ' · хозяин' : '') + '</span>')); });
  $('mpLeave').hidden = !net.role; $('mpHost').hidden = !!net.role;
  buildMenu();
}
function hostLobby() { const list = [profile(), ...mp.guests.values()]; renderLobby(list); net.send({ t: 'lobby', list }); }
function hostSend(force) {
  const now = performance.now();
  if (!force && now - mp.lastSnap < 50) return;
  mp.lastSnap = now; net.send(snapshot(race, mp.outbox)); mp.outbox = [];
}
function clientStep(dt) {
  const P = race.player, inp = P.input;
  if (inp.missile) mp.cnt.m++; if (inp.item) mp.cnt.e++; if (inp.ability) mp.cnt.q++;
  inp.missile = inp.item = inp.ability = false; // the host fires missiles and uses items
  if (race.started && !P.finished) race.move(P, dt); else if (!race.started) P.speed = 0;
  race.events.length = 0; // local flight events are cosmetic duplicates; the host sends the real ones
}
function clientSync(rdt) {
  const now = performance.now();
  if (mp.pending) { applySnapshot(race, mp.pending, mp.me, now); mp.pending = null; }
  extrapolate(race, mp.me, rdt, now, wrapS);
  if (now - mp.lastSend > 33) {
    mp.lastSend = now; const P = race.player, i = P.input;
    net.send({ t: 'i', steer: i.steer, climb: i.climb, fire: i.fire, brake: i.brake, m: mp.cnt.m, e: mp.cnt.e, q: mp.cnt.q, sp: P.spawnId, n: { dist: P.dist, x: P.x, y: P.y, vx: P.vx, vy: P.vy, speed: P.speed, bank: P.bank } });
  }
}
net.on('join', () => mpStatus('Пилот подключается…'));
net.on('msg', (d, from) => {
  if (net.role === 'host') {
    if (d.t === 'hello') { mp.guests.set(from, d.p); hostLobby(); mpStatus('В комнате пилотов: ' + (mp.guests.size + 1) + ' из 3'); }
    else if (d.t === 'i' && race) {
      const r = race.racers[mp.seats.get(from)]; if (!r || !r.remote) return;
      r.input.steer = d.steer; r.input.climb = d.climb; r.input.fire = d.fire; r.input.brake = d.brake;
      if (d.m > (r._m || 0)) r.input.missile = true; if (d.e > (r._e || 0)) r.input.item = true; if (d.q > (r._q || 0)) r.input.ability = true;
      r._m = d.m; r._e = d.e; r._q = d.q;
      if (d.sp === r.spawnId && !r.dead) r.net = d.n;
    }
  } else {
    if (d.t === 'lobby') { renderLobby(d.list); mpStatus('В комнате ' + net.code + '. Ждём старта от хозяина…'); }
    else if (d.t === 'start') { mp.cnt = { m: 0, e: 0, q: 0 }; mp.pending = null; startRace(d); }
    else if (d.t === 's' && mode === 'race') { if (mp.pending) d.E = mp.pending.E.concat(d.E); mp.pending = d; }
    else if (d.t === 'end' && mode !== 'menu') { showMenu(); mpStatus('Хозяин вернулся в ангар'); }
    else if (d.t === 'full') { mpStatus('Комната заполнена (максимум 3 пилота)'); net.leave(); renderLobby([]); }
  }
});
net.on('leave', (peer) => {
  if (net.role === 'host') {
    const p = mp.guests.get(peer); mp.guests.delete(peer);
    const idx = mp.seats.get(peer); mp.seats.delete(peer);
    if (race && idx != null && race.racers[idx]) { const r = race.racers[idx]; r.remote = false; r.net = null; r.ai = { ...race.level, steer: 0, climb: 0, jink: 1, fireHold: 0, think: 0, tx: 0, ty: 0 }; if (mode === 'race') feed(r.name + ' отключился — его ведёт бот'); }
    hostLobby(); mpStatus(p ? p.name + ' вышел из комнаты' : 'Пилот вышел');
  } else {
    net.leave(); renderLobby([]); if (mode !== 'menu') showMenu(); mpStatus('Связь с хозяином комнаты потеряна');
  }
});
net.on('error', (e) => mpStatus('Ошибка сети: ' + ((e && (e.message || e.type)) || e)));
$('mpHost').onclick = async () => {
  audio.init(); mpStatus('Создаём комнату…');
  try {
    const code = await net.host(); mp.guests.clear();
    const url = location.origin + location.pathname + '?room=' + code;
    $('mpUrl').value = url; $('mpLink').hidden = false; $('mpCode').value = code;
    mpStatus('Комната ' + code + ' открыта. Отправьте ссылку друзьям (до 2 гостей).'); hostLobby();
  } catch (e) { mpStatus('Не удалось создать комнату: ' + (e.message || e.type || e)); }
};
$('mpJoin').onclick = async () => {
  const code = $('mpCode').value.trim().toUpperCase(); if (code.length < 4) { mpStatus('Введите код комнаты'); return; }
  audio.init(); mpStatus('Подключаемся к комнате ' + code + '…');
  try { await net.join(code); net.send({ t: 'hello', p: profile() }); mpStatus('Подключено. Ждём хозяина…'); $('mpLink').hidden = true; renderLobby([]); }
  catch (e) { mpStatus('Не удалось войти: ' + (e.message || e.type || e)); net.leave(); renderLobby([]); }
};
$('mpLeave').onclick = () => { if (net.role === 'host') net.send({ t: 'end' }); net.leave(); mp.guests.clear(); mp.seats.clear(); $('mpLink').hidden = true; renderLobby([]); mpStatus('Вы вышли из комнаты'); };
$('mpCopy').onclick = () => { const u = $('mpUrl'); u.select(); try { navigator.clipboard.writeText(u.value); mpStatus('Ссылка скопирована'); } catch (e) { document.execCommand('copy'); } };
// a hidden host tab still runs the race for its guests (browsers pause requestAnimationFrame in background tabs)
setInterval(() => {
  if (net.role !== 'host' || !document.hidden || mode !== 'race' || !race || !mp.seats.size) return;
  for (let k = 0; k < 3; k++) { race.step(1 / 60); for (const e of race.events) mp.outbox.push(e); race.events.length = 0; }
  hostSend(true);
}, 50);

function togglePause(v = !paused) {
  if (mode !== 'race') return;
  paused = v; $('pause').classList.toggle('hidden', !paused);
  if (paused && audio.ctx) { audio.stopEngine(); audio.beamOn(false); r0beamSound = false; }
}

// ---------------- input ----------------
const keys = new Set(); let mouse0 = false;
const edge = { missile: false, item: false, ability: false };
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (mode === 'race' && e.ctrlKey) e.preventDefault(); // Ctrl is the air brake: keep Ctrl+F/D/S etc. inside the game
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  audio.init();
  if (mode === 'race') {
    if (e.code === 'KeyF') edge.missile = true;
    if (e.code === 'KeyE') edge.item = true;
    if (e.code === 'KeyQ') edge.ability = true;
    if (e.code === 'KeyR') toggleMissileCam();
    if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  }
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); sub(audio.muted ? 'ЗВУК ВЫКЛЮЧЕН · M' : 'ЗВУК ВКЛЮЧЁН · M', 1.2); }
  if (e.code === 'KeyN') { audio.musicOn = !audio.musicOn; sub(audio.musicOn ? 'МУЗЫКА ВКЛЮЧЕНА · N' : 'МУЗЫКА ВЫКЛЮЧЕНА · N', 1.2); }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse0 = false; if (mode === 'race' && !paused) togglePause(true); });
canvas.addEventListener('mousedown', e => { audio.init(); if (e.button === 0) mouse0 = true; if (e.button === 2 && mode === 'race') edge.missile = true; });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse0 = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

let padPrev = {};
function readInput() {
  const k = (c) => keys.has(c);
  let steer = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  let climb = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  let fire = k('Space') || mouse0, brake = k('ControlLeft') || k('ControlRight') || k('ShiftLeft') || k('ShiftRight');
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null;
  if (gp) {
    const dz = v => Math.abs(v) < 0.15 ? 0 : v;
    steer += dz(gp.axes[0]); climb -= dz(gp.axes[1]);
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    if (b(7)) fire = true; if (b(6)) brake = true;
    const ed = (i, fn) => { if (b(i) && !padPrev[i]) fn(); padPrev[i] = b(i); };
    ed(0, () => edge.missile = true); ed(2, () => edge.item = true); ed(3, () => edge.ability = true); ed(1, toggleMissileCam); ed(9, () => togglePause());
  }
  steer += touch.steer; climb += touch.climb; fire = fire || touch.fire; brake = brake || touch.brake;
  const inp = race.player.input;
  inp.steer = Math.max(-1, Math.min(1, steer)); inp.climb = Math.max(-1, Math.min(1, climb));
  inp.fire = fire; inp.brake = brake;
  if (edge.missile) { inp.missile = true; edge.missile = false; }
  if (edge.item) { inp.item = true; edge.item = false; }
  if (edge.ability) { inp.ability = true; edge.ability = false; }
}

// ---------------- touch controls ----------------
const touch = { steer: 0, climb: 0, fire: false, brake: false };
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');
function showTouch(v) { $('touch').classList.toggle('hidden', !(v && isTouch)); }
(function setupTouch() {
  const stick = $('stick'), knob = $('stickKnob');
  let sid = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    touch.steer = dx / R; touch.climb = -dy / R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const endStick = () => { sid = null; touch.steer = touch.climb = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); audio.init(); moveStick(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) moveStick(e); });
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  document.querySelectorAll('#touch [data-k]').forEach(b => {
    const k = b.dataset.k;
    const down = (e) => {
      e.preventDefault(); audio.init(); b.classList.add('on');
      if (k === 'fire' || k === 'brake') touch[k] = true;
      else if (k === 'mcam') toggleMissileCam();
      else edge[k] = true;
    };
    const up = () => { b.classList.remove('on'); if (k === 'fire' || k === 'brake') touch[k] = false; };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
  $('tPause').addEventListener('click', () => togglePause());
})();
// leaving mid-race (e.g. Ctrl+W while braking) asks for confirmation
window.addEventListener('beforeunload', e => { if (mode === 'race') { e.preventDefault(); e.returnValue = ''; } });

function toggleMissileCam() {
  if (!race) return;
  if (missileCam) { missileCam = false; return; }
  if (race.missiles.some(m => m.id === race.player.lastMissile && !m.mine)) { missileCam = true; mcamHold = 0; audio.play('ui'); }
}

// ---------------- slow-mo ----------------
function slowmo(scale, dur) { if (net.role) return; // no slow-motion online: every pilot shares one clock
 if (scale < slowScale || slowT <= 0) { slowScale = scale; } slowT = Math.max(slowT, dur); }

// ---------------- events -> fx/audio/HUD ----------------
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), nf = newFrame();
function worldNormal(s, nx, ny) { frameAt(s, nf); return new THREE.Vector3().addScaledVector(nf.r, nx).addScaledVector(nf.u, ny).normalize(); }
// positional one-shot: distance from the camera dulls the sound, the side of the screen pans it
const _sv = new THREE.Vector3(), _right = new THREE.Vector3();
function sfx(name, pos, mul = 1) {
  if (!pos) return audio.play(name);
  const d = pos.distanceTo(camera.position) * mul;
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  const pan = d > 0.5 ? _sv.subVectors(pos, camera.position).normalize().dot(_right) : 0;
  audio.play(name, d, pan * 0.85);
}
function feed(html) { const d = el('div', '', html); $('hFeed').prepend(d); setTimeout(() => d.remove(), 5000); while ($('hFeed').children.length > 5) $('hFeed').lastChild.remove(); }
const nameOf = (r) => `<span style="color:${r.livery.primary}">${r.name}</span>`;
function center(t, pop = false) { const c = $('hCenter'); c.textContent = t; if (pop) { c.classList.remove('popin'); void c.offsetWidth; c.classList.add('popin'); } }
let subT = 0; function sub(t, dur = 1.6) { $('hSub').textContent = t; subT = dur; }
// pickup card: what the case gave and what it does
let toastT = 0;
function toast(it) {
  const t = $('hToast'); t.style.setProperty('--c', it.color);
  t.innerHTML = `<img src="${iconURL(it.key, it.color, 96)}" alt=""><div><b>${it.name}</b><span>${it.desc}</span><em>${isTouch ? 'кнопка КЕЙС' : 'E'} — применить</em></div>`;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); toastT = 3.2;
}

function processEvents() {
  const P = race.player;
  const camDist = (p) => p.distanceTo(camera.position);
  for (const e of race.events) {
    switch (e.type) {
      case 'go': center('СТАРТ!', true); audio.play('go'); setTimeout(() => { if (race && race.started) center(''); }, 900); break;
      case 'shot': { const r = race.racers[e.r]; if (r === P || Math.random() < 0.3) sfx(e.kind === 'prism' ? 'prism' : 'pulse', shipMeshes[e.r].position); break; }
      case 'hit': {
        const p = toWorld(e.s, e.x, e.y, tv).clone();
        fx.hitImpact(p, tv2.subVectors(camera.position, p).normalize(), e.color);
        if (e.big) fx.explosion(p, 0.35, { debris: 4, ring: false });
        if (e.v === P.id) { hurt = Math.min(1, hurt + 0.35); hitShake = Math.min(1, hitShake + 0.3); audio.play('hurt'); }
        else sfx('hit', p);
        break;
      }
      case 'wallhit': { const p = toWorld(e.s, e.x, e.y, tv).clone(); fx.wallHit(p, worldNormal(e.s, e.nx, e.ny), e.color); break; }
      case 'scrape': { const p = toWorld(e.s, e.x, e.y, tv).clone(); fx.sparks(p, worldNormal(e.s, e.nx, e.ny), 14, 0xffd080, 50); if (e.r === P.id) { audio.play('scrape'); hitShake = Math.min(1, hitShake + 0.15); } break; }
      case 'crash': case 'bump': {
        const p = toWorld(e.s, e.x, e.y, tv).clone(); fx.sparks(p, tv2.set(0, 1, 0), 40, 0xffc070, 80); fx.explosion(p, 0.3, { debris: 6, debrisColor: 0x8a4428, ring: false });
        if (e.r === P.id || e.a === P.id || e.b === P.id) { hitShake = 1; audio.play('hurt'); if (e.type === 'crash') sub('СТОЛКНОВЕНИЕ!'); }
        break;
      }
      case 'rail': { const a = toWorld(e.s0, e.x0, e.y0, tv).clone(), b = toWorld(e.s1, e.x1, e.y1, tv2).clone(); fx.railTrail(a, b, e.color); sfx('rail', a); break; }
      case 'missile': sfx('missile', shipMeshes[e.r].position); break;
      case 'explode': {
        const p = toWorld(e.s, e.x, e.y, tv).clone(); fx.explosion(p, e.scale, { color: 0xff7a30 });
        const d = camDist(p); sfx(e.scale > 1 ? 'bigexplode' : 'explode', p);
        if (d < 70) { fx.shake = Math.max(fx.shake, 1 - d / 70); if (e.scale >= 1) slowmo(0.35, 0.5); }
        if (missileCam && e.owner === P.id) { mcamHold = 1.1; mcamLast.copy(p); }
        break;
      }
      case 'kill': {
        const v = race.racers[e.victim], k = e.killer >= 0 ? race.racers[e.killer] : null;
        const p = toWorld(e.s, e.x, e.y, tv).clone();
        fx.explosion(p, 1.6, { color: 0xff9040, debris: 26, debrisColor: new THREE.Color(v.livery.primary).getHex() });
        fx.spawnDebris(p, 16, new THREE.Color(v.livery.secondary).getHex(), 70, 1.6);
        spawnWreck(v);
        const d = camDist(p); audio.play('bigexplode', d * 0.5);
        feed(k && k !== v ? `${nameOf(k)} <b>✕</b> ${nameOf(v)}` : `${nameOf(v)} разбился`);
        if (v === P) { deathPos = p.clone(); slowmo(0.2, 1.4); center('СБИТ', true); missileCam = false; }
        else if (k === P) { slowmo(0.22, 1.1); center('СБИТ ' + v.name, true); setTimeout(() => center(''), 1300); }
        else if (d < 120) slowmo(0.4, 0.6);
        break;
      }
      case 'respawn': if (e.r === P.id) { center(''); deathPos = null; sub(`ВОЗВРАТ НА ТРАССУ · −${RACE.rollback} м`); } break;
      case 'checkpoint': if (e.r === P.id && e.n < e.of) { sub(`КОНТРОЛЬНАЯ ТОЧКА ${e.n}/${e.of}`, 1.0); audio.play('checkpoint'); } break;
      case 'phantom': { const p = toWorld(e.s, e.x, e.y, tv).clone(); fx.flash(p, '#7dfcff', 14, 0.3); fx.sparks(p, tv2.set(0, 1, 0), 30, 0x7dfcff, 60); if (e.r === P.id) sub('ФАНТОМ ПРИНЯЛ РАКЕТУ'); break; }
      case 'shatter': { const sp = race.spires[e.sp]; fx.shatterRock(sp); const d = camDist(sp.mesh.position); audio.play('bigexplode', d * 0.6); if (d < 260) slowmo(0.3, 0.9); break; }
      case 'pickup': {
        const p = toWorld(e.s, e.x, e.y, tv).clone(); const it = ITEMS[e.item];
        fx.sparks(p, tv2.set(0, 1, 0), 30, it.color, 40); fx.flash(p, it.color, 10, 0.3);
        if (e.r === P.id) { audio.play('pickup'); toast(it); }
        break;
      }
      case 'item': {
        const r = race.racers[e.r]; const p = shipMeshes[e.r].position;
        if (e.item === 'chrono') { sfx('chrono', p); fx.explosion(p.clone(), 0.01, { ring: true, debris: 0, color: 0xa05cff }); for (let i = 0; i < 80; i++) fx.add.emit(p, tv2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(160), new THREE.Color(0xa05cff), 3, 1.2, { drag: 2 }); if (r === P) slowmo(0.5, 0.6); else if (race.player.fx.slow > 0) sub('ВАС ЗАМЕДЛИЛИ!'); }
        if (e.item === 'emp') { sfx('emp', p); for (let i = 0; i < 120; i++) fx.add.emit(p, tv2.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize().multiplyScalar(220), new THREE.Color(0xe6f2ff), 2, 0.8, { drag: 1 }); if (r !== P && P.fx.emp > 0) { sub('ЭМИ! ОРУЖИЕ ЗАГЛУШЕНО'); empFx = 1; } }
        if (e.item === 'nova') sfx('nova', p);
        if (['boost', 'shield', 'repair', 'holo'].includes(e.item)) sfx(e.item, p);
        if (r === P) { const used = ITEMS.find(i => i.key === e.item); if (used) sub(used.name + ' — АКТИВИРОВАН', 1.2); }
        if (r !== P && ['nova', 'chrono', 'emp'].includes(e.item)) feed(`${nameOf(r)} → ${ITEMS.find(i => i.key === e.item).name}`);
        break;
      }
      case 'ability': if (e.r === P.id) audio.play('ability'); break;
      case 'ring': if (e.r === P.id) { audio.play('ring'); } break;
      case 'overheat': if (e.r === P.id) { audio.play('overheat'); sub('ПЕРЕГРЕВ'); } break;
      case 'finish': {
        const r = race.racers[e.r];
        feed(`${nameOf(r)} финишировал ${e.place}-м`);
        if (r === P) { const lt = race.time - lapStart; if (lt > 1) bestLap = Math.min(bestLap, lt); finishT = 3; center(e.place === 1 ? 'ПОБЕДА!' : `ФИНИШ · ${e.place} МЕСТО`, true); r.ai = { ...AI_LEVELS[1], steer: 0, climb: 0, jink: 0, think: 0, tx: 0, ty: 0 }; slowmo(0.3, 1.5); }
        break;
      }
    }
  }
  race.events.length = 0;
}

// ---------------- breakup: the dying ship splits into nose, tail and wings ----------------
function spawnWreck(r) {
  const m = shipMeshes[r.id]; if (!m || !raceGroup) return;
  const root = new THREE.Group(); root.position.copy(m.position); root.quaternion.copy(m.quaternion); root.rotation.z += 0; raceGroup.add(root);
  root.updateMatrixWorld(true);
  const pieces = buildWreck(m);
  for (const pc of pieces) { pc.g.rotation.z = m.userData.body.rotation.z; root.add(pc.g); }
  wrecks.push({ root, pieces, t: 0 });
  if (wrecks.length > 6) { const w = wrecks.shift(); raceGroup.remove(w.root); }
}
const _wp = new THREE.Vector3(), _down = new THREE.Vector3();
function updateWrecks(dt) {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const w = wrecks[i]; w.t += dt;
    _down.set(0, -1, 0).applyQuaternion(w.root.quaternion.clone().invert());
    for (const pc of w.pieces) {
      pc.vel.multiplyScalar(1 - Math.min(1, dt * 0.5)); pc.vel.addScaledVector(_down, 14 * dt);
      pc.g.position.addScaledVector(pc.vel, dt);
      pc.g.rotation.x += pc.spin.x * dt; pc.g.rotation.y += pc.spin.y * dt; pc.g.rotation.z += pc.spin.z * dt;
      pc.g.getWorldPosition(_wp);
      if (Math.random() < dt * 30) fx.smoke.emit(_wp, new THREE.Vector3((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3), new THREE.Color(0x1a1716), 2.5, 1.6, { grow: 6, alpha: 0.55 });
      if (w.t < 1.4 && Math.random() < dt * 40) fx.add.emit(_wp, new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), new THREE.Color(1, 0.5, 0.15), 2.4, 0.35, { grow: 2 });
    }
    if (w.t > 4.5) { raceGroup.remove(w.root); wrecks.splice(i, 1); }
  }
}

// ---------------- visuals ----------------
const f0 = newFrame();
let gtime = 0;
function updateRaceVisuals(dt, rdt) {
  gtime += dt;
  const P = race.player;
  race.racers.forEach((r, i) => {
    const m = shipMeshes[i];
    const s = wrapS(r.dist);
    if (r.dead) { m.visible = false; return; }
    frameAt(s, f0);
    const pos = toWorld(s, r.x, r.y, tv);
    m.position.copy(pos);
    const spd = Math.max(r.speed, 30);
    tv2.copy(f0.t).multiplyScalar(spd).addScaledVector(f0.r, r.vx).addScaledVector(f0.u, r.vy).normalize().add(pos);
    m.up.copy(f0.u); m.lookAt(tv2);
    m.userData.body.rotation.z = -r.bank * 1.1;
    m.visible = r.protect > 0 ? Math.floor(gtime * 14) % 2 === 0 : (r.fx.phase > 0 ? Math.floor(gtime * 30) % 3 !== 0 : true);
    if (r === P && camMode === 2 && !missileCam) m.visible = false; // cockpit view: no slab of own fuselage
    const power = Math.min(1.6, r.speed / r.def.top + (r.fx.boost > 0 || r.fx.dash > 0 || r.fx.ring > 0 ? 0.6 : 0));
    updateShipFx(m, gtime, power, { shield: (r.shield > 0 ? 0.55 : 0) + (r.dome > 0 ? 0.9 : 0), overload: r.fx.overload > 0 });
    const hpF = r.hp / r.maxHp;
    m.userData.refs.setDamage(Math.max(0, Math.min(1, 1 - hpF)));
    fx.damageSmoke(pos, hpF, dt);
    if (hpF < 0.35) for (const ex of m.userData.refs.exits) { // engine failure: fire and black smoke from the nozzles
      if (Math.random() < dt * 25) { const wp = m.userData.body.localToWorld(ex.clone()); fx.add.emit(wp, new THREE.Vector3((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4), new THREE.Color(1, 0.45 + Math.random() * 0.2, 0.1), 2.6, 0.28, { grow: 2 }); if (Math.random() < 0.5) fx.smoke.emit(wp, new THREE.Vector3(0, 3, 0), new THREE.Color(0x141210), 2.2, 1.6, { grow: 6, alpha: 0.6 }); }
    }
    if (r.fx.emp > 0 && Math.random() < 0.5) fx.add.emit(tv2.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 10)), new THREE.Vector3(), new THREE.Color(0x60b0ff), 1.5, 0.12);
    if (r.fx.slow > 0 && Math.random() < 0.6) fx.add.emit(pos, new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8), new THREE.Color(0xa05cff), 2.5, 0.5);
    if (r.fx.phase > 0 && Math.random() < 0.8) fx.add.emit(pos, new THREE.Vector3(), new THREE.Color(0xffffff), 4, 0.25);
    if (r.charge > 0) fx.add.emit(tv2.copy(pos).addScaledVector(f0.t, 8), new THREE.Vector3(), new THREE.Color(r.laser.color), 1 + r.charge * 5, 0.05);
    if (r !== P) { const near = pos.distanceTo(camera.position) < 22; if (near && !r._near) sfx('flyby', pos); r._near = near; }
    // decoy ghost
    if (r.fx.decoy > 0) {
      if (!ghosts[i]) { const g = buildShip(r.def.key, r.livery, 'gloss', i + 1); g.traverse(o => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } }); raceGroup.add(g); ghosts[i] = g; }
      const g = ghosts[i]; g.visible = true; g.position.copy(toWorld(s, r.x + 25, r.y + 12, tv2)); g.quaternion.copy(m.quaternion);
    } else if (ghosts[i]) ghosts[i].visible = false;
    // holographic trail
    if (r.holoTrail.length) {
      if (!holoMeshes[i]) {
        holoMeshes[i] = [];
        for (let k = 0; k < 4; k++) { const g = buildShip(r.def.key, r.livery, 'gloss', i + 1); g.traverse(o => { if (o.isMesh) o.material = holoMat; }); g.visible = false; raceGroup.add(g); holoMeshes[i].push(g); }
      }
      holoMeshes[i].forEach((g, k) => {
        const h = r.holoTrail[k]; g.visible = !!h && Math.random() > 0.08;
        if (h) { g.position.copy(toWorld(h.s, h.x, h.y, tv2)); g.quaternion.copy(m.quaternion); }
      });
    } else if (holoMeshes[i]) holoMeshes[i].forEach(g => g.visible = false);
    // drones
    droneSprites[i].forEach((d, k) => { d.visible = r.fx.drones > 0; if (d.visible) { const a = gtime * 3 + k * 2.1; d.position.copy(toWorld(s, r.x + Math.cos(a) * 9, r.y + Math.sin(a) * 6 + 4, tv2)); } });
    // beams
    const nose = toWorld(s + 8, r.x, r.y, new THREE.Vector3());
    if (r.beamOn && r.laser.beam && r.beamEnd) {
      const end = toWorld(r.beamEnd.s, r.beamEnd.x, r.beamEnd.y, new THREE.Vector3());
      fx.setBeam('b' + i, nose, end, r.laser.color, 1.6 + Math.random() * 0.4);
      if (Math.random() < 0.5) fx.sparks(end, tv2.subVectors(nose, end).normalize(), 3, r.laser.color, 40);
    }
    if (r.fx.nova > 0 && r.novaEnd) {
      const end = toWorld(r.novaEnd.s, r.novaEnd.x, r.novaEnd.y, new THREE.Vector3());
      fx.setBeam('n' + i, nose, end, '#ffc24a', 9 + Math.sin(gtime * 40) * 2);
      fx.setBeam('nc' + i, nose, end, '#ffffff', 3);
      fx.sparks(end, tv2.subVectors(nose, end).normalize(), 6, 0xffc24a, 80);
      if (r === P) hitShake = Math.max(hitShake, 0.25);
    }
  });
  fx.endBeamFrame();
  if (r0beamSound !== (P.beamOn && P.laser.beam)) { r0beamSound = P.beamOn && P.laser.beam; audio.beamOn(r0beamSound); }
  // pickups
  race.pickups.forEach((p, i) => {
    const c = caseMeshes[i]; c.visible = p.active;
    if (!p.active) return;
    const it = ITEMS[p.item];
    setCase(c, it.key, it.color, !race.canTake(P, p) || P.item >= 0);
    c.position.copy(toWorld(p.s, p.x, p.y + Math.sin(gtime * 2 + i) * 0.8, tv));
    c.rotation.y += rdt * 0.7; c.rotation.x = Math.sin(gtime * 0.8 + i) * 0.12;
    c.userData.icon.position.y = Math.sin(gtime * 3 + i) * 0.15;
  });
  updateWrecks(dt);
  fx.syncBolts(race.bolts, toWorld);
  fx.syncMissiles(race.missiles, toWorld, dt);
  fx.time = gtime;
  fx.update(dt);
}
let r0beamSound = false;
const holoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4fd8).multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });

function placeCamera(P, dt, snap = false) {
  const s = wrapS(P.dist);
  let fov = 74;
  const missile = missileCam ? race.missiles.find(m => m.id === P.lastMissile) : null;
  if (missileCam && (missile || mcamHold > 0)) {
    if (missile) {
      frameAt(missile.s, f0);
      camPos.copy(toWorld(missile.s - 8, missile.x - missile.vx * 0.03, missile.y + 1.8 - missile.vy * 0.03, tv));
      camLook.copy(toWorld(missile.s + 40, missile.x + missile.vx * 0.25, missile.y + missile.vy * 0.25, tv2));
      mcamLast.copy(toWorld(missile.s, missile.x, missile.y, tv));
      camera.up.copy(f0.u); fov = 96;
      camera.position.copy(camPos); camera.lookAt(camLook);
    } else {
      mcamHold -= dt;
      camera.lookAt(mcamLast); fov = 70;
      if (mcamHold <= 0) missileCam = false;
    }
    $('hMcam').hidden = false;
  } else {
    missileCam = false; $('hMcam').hidden = true;
    frameAt(s, f0);
    if (P.dead && deathPos) {
      const a = gtime * 0.6;
      camPos.copy(deathPos).add(tv.set(Math.cos(a) * 70, 28, Math.sin(a) * 70));
      camera.position.lerp(camPos, Math.min(1, dt * 3)); camera.up.set(0, 1, 0); camera.lookAt(deathPos);
    } else {
      const back = camMode === 1 ? 34 : camMode === 2 ? -2 : 21;
      const up = camMode === 1 ? 9 : camMode === 2 ? 1.6 : 5.5;
      const target = toWorld(s - back, P.x * (camMode === 2 ? 1 : 0.88), P.y + up, tv);
      if (snap) camera.position.copy(target);
      else {
        const k = camMode === 2 ? 1 : Math.min(1, dt * 9);
        camera.position.lerp(target, k);
        // keep the chase distance stable along the track
        const lag = camera.position.distanceTo(target);
        if (lag > 25) camera.position.lerp(target, 0.5);
      }
      camLook.copy(toWorld(s + 45, P.x + P.vx * 0.35, P.y + 1 + P.vy * 0.35, tv2));
      camera.up.copy(f0.u).applyAxisAngle(f0.t, -P.bank * 0.28).normalize();
      camera.lookAt(camLook);
      const boost = P.fx.boost > 0 || P.fx.dash > 0 || P.fx.ring > 0;
      fov = 72 + Math.max(0, P.speed - 80) * 0.35 + (boost ? 10 : 0) + (camMode === 2 ? 6 : 0);
    }
  }
  const sh = (fx.shake + hitShake * 0.6) * 0.9;
  if (sh > 0.01) { camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; camera.position.z += (Math.random() - 0.5) * sh; }
  if (camera.aspect < 1.25) fov = Math.max(fov, 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(70) / 2) / camera.aspect) * 180 / Math.PI);
  camera.fov += (Math.min(camera.aspect < 1.25 ? 118 : 108, fov) - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

// ---------------- HUD ----------------
const fmt = (t) => { if (!isFinite(t)) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
let hudT = 0, lockBeep = false;
const mm = $('minimap'), mmx = mm.getContext('2d');
let mmPts = null;
function minimap() {
  if (!mmPts) {
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < TRACK.n; i += 8) { minx = Math.min(minx, TRACK.px[i]); maxx = Math.max(maxx, TRACK.px[i]); minz = Math.min(minz, TRACK.pz[i]); maxz = Math.max(maxz, TRACK.pz[i]); }
    const sc = 180 / Math.max(maxx - minx, maxz - minz);
    mmPts = { sc, minx, minz, ox: (200 - (maxx - minx) * sc) / 2, oz: (200 - (maxz - minz) * sc) / 2 };
  }
  const { sc, minx, minz, ox, oz } = mmPts;
  const X = x => ox + (x - minx) * sc, Z = z => oz + (z - minz) * sc;
  mmx.clearRect(0, 0, 200, 200);
  mmx.lineWidth = 5; mmx.strokeStyle = 'rgba(10,4,20,0.7)'; mmx.beginPath();
  for (let i = 0; i < TRACK.n; i += 8) { const fn = i ? 'lineTo' : 'moveTo'; mmx[fn](X(TRACK.px[i]), Z(TRACK.pz[i])); }
  mmx.closePath(); mmx.stroke();
  mmx.lineWidth = 2; mmx.strokeStyle = 'rgba(41,243,255,0.7)'; mmx.stroke();
  for (const r of race.racers) {
    if (r.dead) continue; const i = Math.floor(wrapS(r.dist) / TRACK.ds) % TRACK.n;
    mmx.fillStyle = r.livery.primary; mmx.beginPath(); mmx.arc(X(TRACK.px[i]), Z(TRACK.pz[i]), r.human ? 6 : 4, 0, 7); mmx.fill();
    if (r.human) { mmx.strokeStyle = '#fff'; mmx.lineWidth = 2; mmx.stroke(); }
  }
}
const tagPool = [], caseTagPool = [];
function updateHUD(rdt) {
  const P = race.player;
  hudT -= rdt; subT -= rdt; if (subT <= 0) $('hSub').textContent = '';
  if (!race.started) { const c = Math.ceil(race.countdown); if ($('hCenter').textContent !== String(c) && c > 0) { center(String(c), true); audio.play('beep'); } }
  $('hSpeed').textContent = Math.round(P.speed * 3.6);
  $('hHp').style.width = Math.max(0, P.hp / P.maxHp * 100) + '%';
  $('hHp').style.background = P.hp / P.maxHp < 0.3 ? '#ff3050' : '';
  $('hShield').style.width = Math.min(100, (P.shield + P.dome) / 70 * 100) + '%';
  $('hHeat').style.width = (P.laser.rail ? P.charge / P.laser.charge * 100 : P.heat) + '%';
  $('hHeatL').textContent = P.laser.rail ? 'ЗАРЯД' : (P.overheat > 0 ? 'ПЕРЕГРЕВ' : 'НАГРЕВ');
  document.querySelector('.meter.heat').classList.toggle('over', P.overheat > 0);
  // item / ability / missiles
  const it = P.item >= 0 ? ITEMS[P.item] : null;
  if ($('hItem').dataset.key !== (it ? it.key : '')) {
    $('hItem').dataset.key = it ? it.key : '';
    $('hItemIco').innerHTML = it ? `<img src="${iconURL(it.key, it.color, 72)}" alt="">` : '·';
    $('hItemName').textContent = it ? it.name : 'ПУСТО'; $('hItemDesc').textContent = it ? it.desc : 'влетите в кейс';
  }
  toastT -= rdt; if (toastT <= 0) $('hToast').classList.remove('show');
  $('hItem').classList.toggle('full', !!it); $('hItem').style.color = it ? it.color : '';
  $('hAbRing').style.setProperty('--p', (100 - P.abilityCd / P.def.ability.cd * 100) + '%');
  $('hAbility').style.opacity = P.abilityCd > 0 ? 0.6 : 1;
  const pips = $('hMsl'); if (pips.children.length !== P.ammoMax) { pips.innerHTML = ''; for (let i = 0; i < P.ammoMax; i++) pips.appendChild(el('i')); }
  [...pips.children].forEach((c, i) => c.classList.toggle('f', i < P.ammo));
  // time / lap
  const t = race.time;
  $('hTime').textContent = fmt(t);
  if (P.lap !== lastLap && P.lap > lastLap) { const lt = t - lapStart; bestLap = Math.min(bestLap, lt); lapStart = t; lastLap = P.lap; center(P.lap === RACE.laps ? 'ПОСЛЕДНИЙ КРУГ' : `КРУГ ${P.lap}`, true); setTimeout(() => { if (race && !P.finished) center(''); }, 1400); sub('Круг: ' + fmt(lt)); }
  $('hLap').textContent = Math.min(P.lap || 1, RACE.laps);
  const nCp = FEATURES.checkpoints.length; $('hCp').textContent = P.finished ? nCp : Math.max(0, (P.cp || 0) - (Math.min(P.lap || 1, RACE.laps) - 1) * nCp);
  $('hBest').textContent = 'лучший круг ' + fmt(bestLap) + ' · круг ' + fmt(t - lapStart);
  $('hPos').textContent = P.place;
  // sector banner
  const sn = sectorName(wrapS(P.dist));
  if (sn !== lastSector) { lastSector = sn; $('hSector').textContent = sn; $('hSector').classList.add('show'); sectorT = 3; }
  sectorT -= rdt; if (sectorT <= 0) $('hSector').classList.remove('show');
  if (hudT <= 0) {
    hudT = 0.2;
    const st = $('hStand'); st.innerHTML = '';
    for (const r of race.order || race.racers) {
      const li = el('li', (r.human ? 'me ' : '') + (r.dead ? 'dead' : ''));
      const sw = el('i'); sw.style.background = r.livery.primary;
      const lead = race.order[0];
      const gap = r === lead ? (r.finished ? 'ФИНИШ' : 'ЛИДЕР') : (r.finished ? fmt(r.finishTime) : '−' + Math.max(0, Math.round(lead.dist - r.dist)) + ' м');
      li.append(el('span', '', r.place), sw, el('span', '', r.name), el('span', '', gap));
      st.appendChild(li);
    }
    minimap();
  }
  // warnings
  const incoming = race.missiles.some(m => m.target === P.id && dS(m.s, wrapS(P.dist)) > -260 && dS(m.s, wrapS(P.dist)) < 0);
  if (incoming && subT <= 0) { sub('⚠ РАКЕТА НА ХВОСТЕ — Q/E/манёвр', 0.4); audio.play('warn'); }
  if (P.dead) center('СБИТ · ' + Math.max(0, P.respawnT).toFixed(1));
  // lock box
  const lb = $('lockbox');
  if (P.lockTarget >= 0 && !P.dead && !missileCam) {
    const tr = race.racers[P.lockTarget];
    const sp = shipMeshes[tr.id].position.clone().project(camera);
    if (sp.z < 1) {
      lb.hidden = false; lb.style.left = ((sp.x + 1) / 2 * innerWidth) + 'px'; lb.style.top = ((1 - sp.y) / 2 * innerHeight) + 'px';
      const locked = P.lockT > 0.6 && P.missileDef.lock;
      lb.classList.toggle('locked', locked); $('lockTxt').textContent = locked ? 'ЗАХВАТ · F' : 'НАВЕДЕНИЕ';
      if (locked && !lockBeep) audio.play('lock'); lockBeep = locked;
    } else lb.hidden = true;
  } else { lb.hidden = true; lockBeep = false; }
  // name tags
  const tags = $('tags'); let n = 0;
  for (const r of race.racers) {
    if (r === P || r.dead) continue;
    const d = Math.abs(dS(wrapS(r.dist), wrapS(P.dist)));
    if (d > 700) continue;
    const p = shipMeshes[r.id].position.clone(); p.y += 5; const sp = p.project(camera);
    if (sp.z > 1 || Math.abs(sp.x) > 1.1 || Math.abs(sp.y) > 1.1) continue;
    let t = tagPool[n]; if (!t) { t = el('div', 'tag'); t.innerHTML = '<span></span><i><b></b></i>'; tags.appendChild(t); tagPool.push(t); }
    t.style.display = ''; t.style.left = ((sp.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - sp.y) / 2 * innerHeight) + 'px';
    t.firstChild.textContent = `${r.name} ${Math.round(d)}м`; t.firstChild.style.color = r.livery.primary;
    t.lastChild.firstChild.style.width = Math.max(0, r.hp / r.maxHp * 100) + '%';
    n++;
  }
  for (let i = n; i < tagPool.length; i++) tagPool[i].style.display = 'none';
  let m = 0; const ps = wrapS(P.dist);
  let gNear = -1, gd = 1e9;
  for (const p of race.pickups) { const d = dS(p.s, ps); if (p.active && d > 30 && d < 330 && d < gd && race.canTake(P, p)) { gd = d; gNear = p.group; } }
  if (!P.dead && P.item < 0) race.pickups.forEach((p, i) => {
    if (!p.active || p.group !== gNear || m >= 6) return;
    const d = dS(p.s, ps); if (d < 30 || d > 330) return;
    const sp = caseMeshes[i].position.clone(); sp.y += 4.2; sp.project(camera);
    if (sp.z > 1 || Math.abs(sp.x) > 1.05 || Math.abs(sp.y) > 1.05) return;
    const it = ITEMS[p.item];
    let t = caseTagPool[m]; if (!t) { t = el('div', 'ctag'); $('tags').appendChild(t); caseTagPool.push(t); }
    t.style.display = ''; t.style.left = ((sp.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - sp.y) / 2 * innerHeight) + 'px';
    const far = d > 150, k = it.key + (far ? ':far' : '');
    if (t.dataset.k !== k) { t.dataset.k = k; t.innerHTML = far ? `<img src="${iconURL(it.key, it.color, 40)}" alt="${it.name}">` : it.name; t.style.color = it.color; }
    t.style.opacity = far ? 0.8 : 1;
    m++;
  });
  for (let i = m; i < caseTagPool.length; i++) caseTagPool[i].style.display = 'none';
}

function showResults() {
  mode = 'results'; audio.setIntensity(0.4); if (audio.ctx) { audio.stopEngine(); audio.beamOn(false); } r0beamSound = false;
  $('hud').classList.add('hidden'); $('results').classList.remove('hidden'); showTouch(false);
  const P = race.player;
  const total = RACE.laps * TRACK.length;
  const rows = race.racers.map(r => ({ r, t: r.finished ? r.finishTime : race.time + (total - r.dist) / (r.def.cruise * 0.95) }));
  rows.sort((a, b) => a.t - b.t);
  const place = rows.findIndex(x => x.r === P) + 1;
  $('resTitle').textContent = place === 1 ? 'ПОБЕДА' : `${place} МЕСТО`;
  let html = '<tr><th>МЕСТО</th><th>ПИЛОТ</th><th>САМОЛЁТ</th><th>ВРЕМЯ</th><th>СБИЛ</th><th>ПОТЕРИ</th></tr>';
  rows.forEach((x, i) => { html += `<tr class="${x.r === P ? 'me' : ''}"><td>${i + 1}</td><td style="color:${x.r.livery.primary}">${x.r.name}</td><td>${x.r.def.name}</td><td>${fmt(x.t)}${x.r.finished ? '' : '*'}</td><td>${x.r.kills}</td><td>${x.r.deaths}</td></tr>`; });
  html += `<tr><td colspan="6" class="small">Лучший круг: ${fmt(bestLap)} · уровень ИИ: ${AI_LEVELS[S.diff].name}${rows.some(x => !x.r.finished) ? ' · * расчётное время' : ''}</td></tr>`;
  $('resTable').innerHTML = html;
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
const FAR = new THREE.Vector3(1e6, 1e6, 1e6);
let menuA = 0;
// hangar orbit camera: drag to rotate, wheel to zoom; idles into a slow sway with the sun behind the camera
const SUN_AZ = Math.atan2(0.66, -0.72);
const orbit = { az: SUN_AZ + 0.6, el: 0.32, dist: 30, base: 30, idle: 99, drag: null };
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'menu') return;
  orbit.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; orbit.idle = 0; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  const d = orbit.drag; if (!d || d.id !== e.pointerId || mode !== 'menu') return;
  orbit.az += (e.clientX - d.x) * 0.008; orbit.el = Math.max(0.02, Math.min(1.25, orbit.el + (e.clientY - d.y) * 0.005));
  d.x = e.clientX; d.y = e.clientY; orbit.idle = 0;
});
const endDrag = () => { orbit.drag = null; canvas.style.cursor = mode === 'menu' ? 'grab' : ''; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { if (mode !== 'menu') return; orbit.dist = Math.max(12, Math.min(60, orbit.dist * (e.deltaY > 0 ? 1.08 : 0.93))); orbit.idle = 0; e.preventDefault(); }, { passive: false });
function menuCamera(rdt) {
  orbit.idle += rdt;
  if (orbit.idle > 4 && !orbit.drag) { // drift back toward a flattering, sun-behind-camera angle
    const target = SUN_AZ + Math.sin(menuA * 0.6) * 0.9;
    const dAz = ((target - orbit.az + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    orbit.az += dAz * Math.min(1, rdt * 0.4); orbit.el += (0.32 - orbit.el) * Math.min(1, rdt * 0.4);
  }
  const c = Math.cos(orbit.el);
  camera.position.copy(hangarPos).add(tv.set(Math.cos(orbit.az) * c * orbit.dist, 1 + Math.sin(orbit.el) * orbit.dist, Math.sin(orbit.az) * c * orbit.dist));
  camera.up.set(0, 1, 0); camera.lookAt(tv2.copy(hangarPos).add(new THREE.Vector3(0, 0.6, 0)));
  camera.fov = 45;
  // keep the ship clear of the settings panel on wide screens
  const panel = $('panel'), w = innerWidth, h = innerHeight;
  const shift = w > 760 && panel && !$('menu').classList.contains('hidden') ? Math.min((panel.getBoundingClientRect().right + 10) / 2, w * 0.2) : 0;
  if (shift) camera.setViewOffset(w, h, -shift * 0.9, 0, w, h);
  else if (w <= 760 && !$('menu').classList.contains('hidden')) camera.setViewOffset(w, h, 0, h * 0.24, w, h); // phone: ship above the bottom panel
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function loop() {
  requestAnimationFrame(loop);
  const rdt = Math.min(0.05, clock.getDelta());
  cinema.uniforms.uTime.value += rdt;
  if (mode === 'menu' || !race) {
    menuA += rdt * 0.25;
    if (displayShip) { displayShip.position.y = hangarPos.y + Math.sin(menuA * 3) * 0.4; updateShipFx(displayShip, menuA * 4, 0.8); }
    menuCamera(rdt);
    // softer exposure and bloom in the hangar so the paint stays readable against the bright desert
    renderer.toneMappingExposure = 0.82; bloom.strength = GFX[S.gfx].bloom * 0.35; bloom.threshold = 0.93;
    W.update(rdt, FAR, false, hangarPos);
    if (fx) fx.update(rdt);
    cinema.uniforms.uDesat.value = 0; cinema.uniforms.uAberr.value = 0.001; cinema.uniforms.uRed.value = 0; cinema.uniforms.uBlur.value = 0; cinema.uniforms.uEmp.value = 0;
    composer.render();
    return;
  }
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  renderer.toneMappingExposure = 1.0; bloom.strength = GFX[S.gfx].bloom; bloom.threshold = 0.82;
  if (mode === 'race' && paused) {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null;
    const st = gp && gp.buttons[9] && gp.buttons[9].pressed;
    if (st && !padPrev[9]) togglePause(false);
    if (gp) padPrev[9] = st;
  }
  if (mode === 'race' && (!paused || net.role)) { // online the race keeps running behind the pause menu
    // slow-mo (real-time driven)
    if (slowT > 0) { slowT -= rdt; if (slowT <= 0) slowScale = 1; }
    const target = slowT > 0 ? slowScale : 1;
    timeScale += (target - timeScale) * Math.min(1, rdt * (target < timeScale ? 14 : 4));
    const dt = rdt * timeScale;
    acc += dt;
    let steps = 0;
    while (acc >= 1 / 60 && steps < 6) { readInput(); if (net.role === 'client') clientStep(1 / 60); else race.step(1 / 60); acc -= 1 / 60; steps++; }
    if (net.role === 'host' && mp.seats.size) { for (const e of race.events) mp.outbox.push(e); hostSend(); }
    if (net.role === 'client') clientSync(rdt);
    processEvents();
    updateRaceVisuals(dt, rdt);
    const P = race.player;
    placeCamera(P, rdt);
    hurt = Math.max(0, hurt - rdt * 1.2); hitShake = Math.max(0, hitShake - rdt * 2.5); empFx = Math.max(0, empFx - rdt * 0.4);
    const camS = wrapS(P.dist - 20);
    const inTunnel = typeAt(camS) === 'tunnel' && !missileCam;
    W.update(dt, camera.position, inTunnel || typeAt(wrapS(P.dist)) === 'tunnel');
    audio.engine(P.speed, P.fx.boost > 0 || P.fx.dash > 0 ? 1 : 0, inTunnel);
    updateHUD(rdt);
    // cinematic post
    const slow = 1 - timeScale;
    const boost = (P.fx.boost > 0 || P.fx.dash > 0 || P.fx.ring > 0) ? 1 : 0;
    cinema.uniforms.uDesat.value = slow * 0.55 + (P.fx.slow > 0 ? 0.3 : 0);
    cinema.uniforms.uAberr.value = 0.001 + slow * 0.01 + boost * 0.002 + hurt * 0.006 + (missileCam ? 0.004 : 0);
    cinema.uniforms.uBlur.value = boost * 0.45 + (missileCam ? 0.9 : 0) + Math.max(0, P.speed - 100) * 0.008;
    cinema.uniforms.uRed.value = Math.max(hurt, P.hp / P.maxHp < 0.3 && !P.dead ? 0.35 + Math.sin(gtime * 6) * 0.15 : 0);
    cinema.uniforms.uEmp.value = P.fx.emp > 0 ? 1 : empFx;
    cinema.uniforms.uTint.value.set(1 + slow * 0.05, 1 - slow * 0.05, 1 + slow * 0.15);
    $('hSlow').hidden = timeScale > 0.7;
    if (finishT > 0) { finishT -= rdt; if (finishT <= 0) showResults(); }
  } else if (mode === 'results' && race) {
    // keep the world alive behind the results
    race.step(rdt); race.events.length = 0; updateRaceVisuals(rdt, rdt); placeCamera(race.player, rdt); W.update(rdt, camera.position, false);
    cinema.uniforms.uDesat.value = 0.2; cinema.uniforms.uRed.value = 0; cinema.uniforms.uBlur.value = 0; cinema.uniforms.uEmp.value = 0;
  }
  composer.render();
}

window.__rr = { get race() { return race; }, get fx() { return fx; }, camera, scene, startRace, shim: () => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16); loop(); }, get net() { return net; }, get mp() { return mp; }, renderNow: () => { if (mode === 'menu') menuCamera(0.016); composer.render(); return renderer.info.programs.length; } };
boot().catch(e => { console.error(e); $('loadtext').textContent = 'Ошибка загрузки: ' + e.message; });
