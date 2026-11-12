// Multiplayer for 2-3 pilots without a game server of our own.
// Browsers connect peer-to-peer over WebRTC (PeerJS); the free public PeerJS broker only introduces them.
// The host's browser runs the race (sim.js) and streams snapshots + events ~20 times a second;
// guests fly their own ship locally (no input lag) and send position and buttons ~30 times a second.
// Damage, items, pickups, respawns and the finish are decided by the host.
const PREFIX = 'redrift-r2-';
const MAX_GUESTS = 2;

// racer fields mirrored to guests (positions are smoothed separately)
export const MOVE_KEYS = ['dist', 'x', 'y', 'vx', 'vy', 'speed', 'bank'];
export const STATE_KEYS = ['hp', 'maxHp', 'shield', 'dome', 'dead', 'respawnT', 'protect', 'place', 'lap', 'cp', 'finished', 'finishTime', 'item',
  'abilityCd', 'abilityT', 'heat', 'overheat', 'charge', 'ammo', 'lockTarget', 'lockT', 'kills', 'deaths', 'beamOn', 'spawnId', 'lastMissile', 'draft'];
const FX_KEYS = ['boost', 'slow', 'emp', 'phase', 'decoy', 'overload', 'nova', 'dash', 'repair', 'ring', 'holo'];
const r2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

export function snapshot(race, events) {
  return {
    t: 's', time: r2(race.time), cd: r2(race.countdown), st: race.started, fo: race.finishOrder,
    R: race.racers.map(r => [MOVE_KEYS.map(k => r2(r[k])), STATE_KEYS.map(k => r2(r[k])), FX_KEYS.map(k => r2(r.fx[k] || 0)),
      r.beamEnd ? [r2(r.beamEnd.s), r2(r.beamEnd.x), r2(r.beamEnd.y)] : null, r.novaEnd ? [r2(r.novaEnd.s), r2(r.novaEnd.x), r2(r.novaEnd.y)] : null,
      r.holoTrail.map(h => [r2(h.s), r2(h.x), r2(h.y)])]),
    B: race.bolts.map(b => [b.id, b.owner, r2(b.s), r2(b.x), r2(b.y), r2(b.vs), r2(b.vx), r2(b.vy), b.color, b.len, b.w, r2(b.life)]),
    M: race.missiles.map(m => ({ id: m.id, owner: m.owner, s: r2(m.s), x: r2(m.x), y: r2(m.y), vx: r2(m.vx || 0), vy: r2(m.vy || 0), speed: r2(m.speed || 0), mine: !!m.mine, color: m.color, big: !!m.big, target: m.target ?? -1 })),
    P: race.pickups.map(p => (p.active ? 1 : 0) * 16 + p.item),
    D: race.spires.filter(sp => !sp.alive).map(sp => sp.id),
    E: events,
  };
}

// apply a host snapshot on a guest; `me` keeps its own flight unless the host moved it (respawn / big error)
export function applySnapshot(race, snap, me, now) {
  race.time = snap.time; race.countdown = snap.cd; race.started = snap.st; race.finishOrder = snap.fo;
  snap.R.forEach(([mv, st, fx, be, ne, ht], i) => {
    const r = race.racers[i]; if (!r) return;
    const wasDead = r.dead, oldSpawn = r.spawnId;
    STATE_KEYS.forEach((k, j) => { r[k] = st[j]; });
    FX_KEYS.forEach((k, j) => { r.fx[k] = fx[j]; });
    r.beamEnd = be ? { s: be[0], x: be[1], y: be[2] } : null; r.novaEnd = ne ? { s: ne[0], x: ne[1], y: ne[2] } : null;
    r.holoTrail = ht.map(([s, x, y]) => ({ s, x, y }));
    const target = {}; MOVE_KEYS.forEach((k, j) => { target[k] = mv[j]; }); target.at = now;
    if (i === me) {
      if (r.spawnId !== oldSpawn || wasDead !== r.dead || Math.abs(target.dist - r.dist) > 90 || r.dead) MOVE_KEYS.forEach(k => { r[k] = target[k]; });
    } else {
      r.netT = target;
      if (Math.abs(target.dist - r.dist) > 200 || r.dead) MOVE_KEYS.forEach(k => { r[k] = target[k]; });
    }
  });
  race.bolts = snap.B.map(([id, owner, s, x, y, vs, vx, vy, color, len, w, life]) => ({ id, owner, s, x, y, vs, vx, vy, color, len, w, life }));
  race.missiles = snap.M;
  snap.P.forEach((v, i) => { const p = race.pickups[i]; if (p) { p.active = v >= 16; p.item = v % 16; } });
  const dead = new Set(snap.D); for (const sp of race.spires) sp.alive = !dead.has(sp.id);
  for (const e of snap.E) race.events.push(e);
}

// guests: smooth other racers toward their latest host position; advance shots between snapshots
export function extrapolate(race, me, dt, now, wrapS) {
  race.racers.forEach((r, i) => {
    if (i === me || !r.netT || r.dead) return;
    const n = r.netT, age = Math.min(0.25, (now - n.at) / 1000), k = Math.min(1, dt * 10);
    r.dist += (n.dist + n.speed * age - r.dist) * k + r.speed * dt * (1 - k);
    r.x += (n.x + n.vx * age - r.x) * k; r.y += (n.y + n.vy * age - r.y) * k;
    r.vx = n.vx; r.vy = n.vy; r.speed = n.speed; r.bank += (n.bank - r.bank) * k;
  });
  for (const b of race.bolts) { b.s = wrapS(b.s + b.vs * dt); b.x += b.vx * dt; b.y += b.vy * dt; }
  for (const m of race.missiles) if (!m.mine) { m.s = wrapS(m.s + m.speed * dt); m.x += m.vx * dt; m.y += m.vy * dt; }
}

export class Net {
  constructor() { this.role = null; this.peer = null; this.conns = new Map(); this.handlers = {}; this.code = ''; }
  on(type, fn) { this.handlers[type] = fn; }
  emit(type, ...a) { const h = this.handlers[type]; if (h) h(...a); }
  async lib() { const m = await import('peerjs'); return m.Peer || (m.default && m.default.Peer) || m.default; }
  static newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)]; return c; }
  async host(tries = 3) {
    const Peer = await this.lib();
    this.leave(); this.role = 'host'; this.code = Net.newCode();
    return new Promise((resolve, reject) => {
      const peer = this.peer = new Peer(PREFIX + this.code, { debug: 0 });
      peer.on('open', () => resolve(this.code));
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && tries > 0) { this.host(tries - 1).then(resolve, reject); return; }
        this.emit('error', e); reject(e);
      });
      peer.on('connection', (c) => {
        c.on('open', () => {
          if (this.conns.size >= MAX_GUESTS) { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); return; }
          this.conns.set(c.peer, c); this.emit('join', c.peer);
        });
        c.on('data', (d) => this.emit('msg', d, c.peer));
        c.on('close', () => { if (this.conns.delete(c.peer)) this.emit('leave', c.peer); });
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* closed */ } });
    });
  }
  async join(code) {
    const Peer = await this.lib();
    this.leave(); this.role = 'client'; this.code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = this.peer = new Peer({ debug: 0 });
      const fail = (e) => { this.emit('error', e); reject(e); };
      peer.on('error', fail);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
        const to = setTimeout(() => fail(new Error('Комната не найдена или недоступна')), 12000);
        c.on('open', () => { clearTimeout(to); this.conns.set('host', c); resolve(); });
        c.on('data', (d) => this.emit('msg', d, 'host'));
        c.on('close', () => { if (this.conns.delete('host')) this.emit('leave', 'host'); });
      });
    });
  }
  send(d, to) {
    if (to) { const c = this.conns.get(to); if (c && c.open) c.send(d); return; }
    for (const c of this.conns.values()) if (c.open) c.send(d);
  }
  get guests() { return [...this.conns.keys()]; }
  leave() {
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.peer = null; this.role = null; this.code = '';
  }
}
