// Race simulation (DOM-free, fixed 60 Hz). Racers, weapons, items, obstacles, AI.
import { TRACK, FEATURES, bounds, wrapS, idx, frameAt, newFrame, typeAt } from './track.js';
import { RACE, SHIPS, LASERS, MISSILES, ITEMS, AI_LEVELS, AI_NAMES, LIVERIES } from './config.js';
import { clamp } from './noise.js';

const L = TRACK.length;
export const dS = (a, b) => { let d = (a - b) % L; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; };
const R = () => Math.random();

let NEXT_ID = 1;

function makeRacer(i, opts) {
  const def = SHIPS[opts.ship];
  const mDef = MISSILES[opts.missile];
  return {
    id: i, name: opts.name, human: !!opts.human, ship: opts.ship, def, laser: LASERS[opts.laser], missileDef: mDef,
    livery: opts.livery, finish: opts.finish || 'gloss', ai: opts.ai ? { ...opts.ai, steer: 0, climb: 0, jink: R() * 10, fireHold: 0, think: 0, tx: 0, ty: 0 } : null,
    dist: -(i % 5) * 14 - Math.floor(i / 1) * 0, x: ((i % 5) - 2) * 18, y: (i % 2) * 8, vx: 0, vy: 0, speed: 0,
    hp: def.hp, maxHp: def.hp, shield: 0, dome: 0, heat: 0, overheat: 0, charge: 0, fireCd: 0,
    ammo: mDef.ammo + (def.extraMissiles || 0), ammoMax: mDef.ammo + (def.extraMissiles || 0), ammoRegen: 0,
    item: -1, abilityCd: 3, abilityT: 0, fx: { boost: 0, slow: 0, emp: 0, phase: 0, decoy: 0, overload: 0, nova: 0, drones: 0, magnet: 0, dash: 0, repair: 0, ring: 0 },
    dead: false, respawnT: 0, protect: 0, finished: false, finishTime: 0, place: i + 1, kills: 0, deaths: 0,
    lockTarget: -1, lockT: 0, bank: 0, pitch: 0, scrape: 0, lastMissile: -1, droneT: 0, hitFlash: 0, beamOn: false, beamEnd: null,
    input: { steer: 0, climb: 0, brake: false, fire: false, missile: false, item: false, ability: false },
  };
}

export class Race {
  constructor({ player, difficulty = 1, aiCount = 4 }) {
    this.time = 0; this.started = false; this.countdown = RACE.countdown; this.over = false;
    this.events = []; this.bolts = []; this.missiles = []; this.drones = [];
    this.level = AI_LEVELS[difficulty];
    this.racers = [];
    const grid = [];
    grid.push({ ...player, human: true });
    const used = new Set([player.ship]);
    const names = [...AI_NAMES].sort(() => R() - 0.5);
    for (let k = 0; k < aiCount; k++) {
      let ship = (player.ship + 1 + k) % SHIPS.length;
      grid.push({ name: names[k], ship, laser: Math.floor(R() * LASERS.length), missile: Math.floor(R() * MISSILES.length), livery: LIVERIES[(k * 3 + 1 + player.ship) % LIVERIES.length], finish: ['gloss', 'metal', 'chrome', 'gloss'][k % 4], ai: this.level });
    }
    // human starts at the back row (classic); grid: 2 columns staggered
    const order = [1, 2, 3, 4, 0];
    order.forEach((gi, slot) => {
      const r = makeRacer(gi, grid[gi]);
      r.dist = -slot * 22; r.x = (slot % 2 ? 1 : -1) * 22 + (slot - 2) * 2; r.y = (slot % 3) * 6;
      this.racers[gi] = r;
    });
    this.pickups = FEATURES.pickups.map(p => ({ ...p, active: true, t: 0, item: Math.floor(R() * ITEMS.length) }));
    this.spires = FEATURES.spires;
    for (const sp of this.spires) sp.alive = true;
    this.player = this.racers[0];
    this.finishOrder = [];
    this.rank();
  }

  emit(e) { if (this.events.length < 300) this.events.push(e); }

  step(dt) {
    if (!this.started) {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.started = true; for (const r of this.racers) r.protect = 3; this.emit({ type: 'go' }); }
      for (const r of this.racers) { r.speed = 0; }
      return;
    }
    this.time += dt;
    for (const r of this.racers) { if (r.ai && !r.finished) this.think(r, dt); else if (r.ai) this.think(r, dt); }
    for (const r of this.racers) this.move(r, dt);
    this.collideRacers();
    for (const r of this.racers) this.weapons(r, dt);
    this.updateBolts(dt); this.updateMissiles(dt); this.updatePickups(dt);
    this.rank();
  }

  rank() {
    const live = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.dist - a.dist;
    });
    live.forEach((r, i) => r.place = i + 1);
    this.order = live;
  }

  move(r, dt) {
    const F = r.fx;
    for (const k in F) if (F[k] > 0) F[k] = Math.max(0, F[k] - dt);
    r.protect = Math.max(0, r.protect - dt); r.hitFlash = Math.max(0, r.hitFlash - dt * 3);
    r.abilityCd = Math.max(0, r.abilityCd - dt); r.abilityT = Math.max(0, r.abilityT - dt);
    if (r.abilityT <= 0) r.dome = 0;
    if (r.dead) {
      r.respawnT -= dt; r.speed = 0;
      if (r.respawnT <= 0) {
        r.dead = false; r.dist = Math.max(0, r.dist - RACE.rollback); r.x = 0; r.y = 0; r.vx = r.vy = 0;
        const b = bounds(wrapS(r.dist)); r.y = clamp(0, b.yMin + 10, b.yMax - 10);
        r.hp = r.maxHp; r.shield = 0; r.heat = 0; r.protect = RACE.protect; r.speed = r.def.cruise * 0.6;
        this.emit({ type: 'respawn', r: r.id });
      }
      return;
    }
    const inp = r.input, def = r.def;
    // speed
    let target = def.cruise * (r.ai ? r.ai.speed : 1);
    if (r.ai) {
      const gap = this.player.dist - r.dist;
      target *= 1 + clamp(gap / 600, -1, 1) * r.ai.rubber;
    }
    if (inp.brake) target *= 0.62;
    if (F.boost > 0) target = Math.max(target, def.top * 1.5);
    if (F.dash > 0) target = Math.max(target, def.top * 1.6);
    if (F.ring > 0) target = Math.max(target, def.top * 1.3);
    if (F.magnet > 0 && r.place > 1) target *= 1.22;
    if (F.slow > 0) target *= 0.55;
    if (r.finished) target = def.cruise * 0.7;
    const acc = target > r.speed ? def.accel * (F.boost || F.dash ? 3 : 1) : 60;
    r.speed += clamp(target - r.speed, -acc * dt, acc * dt);
    r.speed = Math.max(r.speed, 30);
    // lateral / vertical
    const h = def.handling * (F.slow > 0 ? 0.6 : 1), c = def.climb * (F.slow > 0 ? 0.6 : 1);
    let steer = inp.steer, climb = inp.climb;
    if (F.magnet > 0 && this.order && this.order[0] !== r) { const ld = this.order[0]; steer += clamp((ld.x - r.x) / 30, -0.6, 0.6); climb += clamp((ld.y - r.y) / 30, -0.6, 0.6); }
    r.vx += (clamp(steer, -1, 1) * h - r.vx) * Math.min(1, dt * 5);
    r.vy += (clamp(climb, -1, 1) * c - r.vy) * Math.min(1, dt * 5);
    r.dist += r.speed * dt; r.x += r.vx * dt; r.y += r.vy * dt;
    r.bank += ((-r.vx / h) * 0.85 - r.bank) * Math.min(1, dt * 6);
    r.pitch += ((r.vy / c) * 0.3 - r.pitch) * Math.min(1, dt * 6);
    const s = wrapS(r.dist);
    // corridor
    const b = bounds(s);
    let scraped = false, nx = 0, ny = 0;
    if (b.tunnel) {
      const rr = Math.hypot(r.x, r.y), m = b.hw - 7;
      if (rr > m) { nx = -r.x / rr; ny = -r.y / rr; r.x *= m / rr; r.y *= m / rr; scraped = true; r.vx *= 0.3; r.vy *= 0.3; }
    } else {
      if (r.x > b.hw - 4) { r.x = b.hw - 4; nx = -1; scraped = true; r.vx = Math.min(r.vx, -5); }
      if (r.x < -b.hw + 4) { r.x = -b.hw + 4; nx = 1; scraped = true; r.vx = Math.max(r.vx, 5); }
      if (r.y < b.yMin) { r.y = b.yMin; ny = 1; scraped = true; r.vy = Math.max(r.vy, 6); }
      if (r.y > b.yMax - 3) { r.y = b.yMax - 3; ny = -1; r.vy = Math.min(r.vy, -6); if (!b.tunnel) this.emit({ type: 'ceiling', r: r.id, s, x: r.x, y: r.y }); }
    }
    if (scraped && F.phase <= 0) {
      r.scrape += dt; this.damage(r, RACE.wallDamage * dt, null, 'wall'); r.speed *= 1 - 0.6 * dt;
      if (r.scrape > 0.08) { r.scrape = 0; this.emit({ type: 'scrape', r: r.id, s, x: r.x - nx * 3, y: r.y - ny * 3, nx, ny }); }
    }
    // obstacles
    if (F.phase <= 0 && r.protect <= 0) this.obstacles(r, s);
    // rings
    for (const ring of FEATURES.boostRings) {
      const d = dS(s, ring.s);
      if (d > 0 && d < r.speed * dt + 1 && Math.hypot(r.x - ring.x, r.y - ring.y) < 16) { F.ring = 1.4; this.emit({ type: 'ring', r: r.id }); }
    }
    // heat / ammo
    r.heat = Math.max(0, r.heat - def.cooling * dt * (r.overheat > 0 ? 1.4 : 1));
    if (r.overheat > 0) r.overheat -= dt;
    if (r.ammo < r.ammoMax) { r.ammoRegen += dt; if (r.ammoRegen > r.missileDef.regen) { r.ammoRegen = 0; r.ammo++; } }
    if (F.repair > 0) r.hp = Math.min(r.maxHp, r.hp + 40 / 3 * dt);
    // finish
    if (!r.finished && r.dist >= RACE.laps * L) {
      r.finished = true; r.finishTime = this.time; this.finishOrder.push(r.id);
      this.emit({ type: 'finish', r: r.id, place: this.finishOrder.length });
    }
    r.lap = Math.min(RACE.laps, Math.floor(Math.max(0, r.dist) / L) + 1);
    // ability + item
    if (inp.ability && r.abilityCd <= 0 && F.emp <= 0) this.useAbility(r);
    if (inp.item && r.item >= 0 && F.emp <= 0) this.useItem(r);
    inp.ability = false; inp.item = false;
  }

  obstacles(r, s) {
    for (const sp of this.spires) {
      if (!sp.alive) continue;
      const d = dS(s, sp.s);
      if (Math.abs(d) < sp.radius + 5 && Math.abs(r.x - sp.x) < sp.radius + 5 && r.y < sp.topY) {
        const side = r.x > sp.x ? 1 : -1;
        r.x = sp.x + side * (sp.radius + 6); r.vx = side * 25; r.speed *= 0.55;
        this.damage(r, RACE.crashDamage, null, 'crash');
        this.emit({ type: 'crash', r: r.id, s, x: r.x - side * 4, y: r.y });
      }
    }
    for (const a of FEATURES.arches) {
      const d = dS(s, a.s);
      if (Math.abs(d) < a.thick + 2) {
        const dd = Math.hypot(r.x, r.y - a.yc);
        if (Math.abs(dd - a.Ra) < a.thick + 2.5) {
          const out = dd > a.Ra ? 1 : -1;
          const k = (a.Ra + out * (a.thick + 3)) / dd;
          r.x *= k; r.y = a.yc + (r.y - a.yc) * k; r.speed *= 0.5; r.vy = out * 20;
          this.damage(r, RACE.crashDamage, null, 'crash');
          this.emit({ type: 'crash', r: r.id, s, x: r.x, y: r.y + out * -3 });
        }
      }
    }
    const i = idx(s); const cy = TRACK.py[i];
    for (const rib of FEATURES.ribs) {
      const d = dS(s, rib.s);
      if (Math.abs(d) < 6) {
        const wy = cy + r.y;
        const dd = Math.hypot(r.x, wy - rib.floor);
        if (Math.abs(dd - rib.r) < 7) {
          const out = dd > rib.r ? 1 : -1; const k = (rib.r + out * 9) / dd;
          r.x *= k; r.y = (rib.floor + (wy - rib.floor) * k) - cy; r.speed *= 0.6;
          this.damage(r, RACE.crashDamage * 0.8, null, 'crash'); this.emit({ type: 'crash', r: r.id, s, x: r.x, y: r.y });
        }
      }
    }
  }

  collideRacers() {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j]; if (a.dead || b.dead || a.fx.phase > 0 || b.fx.phase > 0) continue;
      const d = dS(wrapS(a.dist), wrapS(b.dist));
      if (Math.abs(d) < 11 && Math.abs(a.x - b.x) < 9 && Math.abs(a.y - b.y) < 5) {
        const side = a.x >= b.x ? 1 : -1;
        const ma = a.def.hp, mb = b.def.hp;
        a.vx += side * 30 * mb / (ma + mb) * 2; b.vx -= side * 30 * ma / (ma + mb) * 2;
        a.x += side * 1.5; b.x -= side * 1.5;
        this.damage(a, 4 * mb / ma, b, 'ram'); this.damage(b, 4 * ma / mb, a, 'ram');
        this.emit({ type: 'bump', s: wrapS(a.dist), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: a.id, b: b.id });
      }
    }
  }

  damage(r, amt, src, kind) {
    if (r.dead || r.protect > 0 || r.fx.phase > 0 || r.finished) return;
    if (r.dome > 0 && r.abilityT > 0) { const ab = Math.min(r.dome, amt); r.dome -= ab; amt -= ab; }
    if (r.shield > 0) { const ab = Math.min(r.shield, amt); r.shield -= ab; amt -= ab; }
    if (amt <= 0) return;
    r.hp -= amt; r.hitFlash = 1;
    if (src) r.lastHitBy = src.id;
    if (r.hp <= 0) {
      r.dead = true; r.deaths++; r.respawnT = RACE.respawnDelay; r.item = -1; r.fx.nova = 0; r.fx.drones = 0;
      const killer = src || (r.lastHitBy != null ? this.racers[r.lastHitBy] : null);
      if (killer && killer !== r) killer.kills++;
      this.emit({ type: 'kill', victim: r.id, killer: killer ? killer.id : -1, s: wrapS(r.dist), x: r.x, y: r.y, kind });
    }
  }

  // --- targeting helpers ---
  findTarget(r, range, cx, cy, wantLock = false) {
    let best = null, bd = 1e9; const s = wrapS(r.dist);
    for (const o of this.racers) {
      if (o === r || o.dead || o.finished) continue;
      const d = dS(wrapS(o.dist), s);
      if (d < 8 || d > range) continue;
      const k = d / range; const ax = cx * (0.35 + k), ay = cy * (0.35 + k);
      if (Math.abs(o.x - r.x) > ax || Math.abs(o.y - r.y) > ay) continue;
      const score = d + Math.abs(o.x - r.x) * 2 + Math.abs(o.y - r.y) * 2;
      if (score < bd) { bd = score; best = o; }
    }
    return best;
  }

  weapons(r, dt) {
    r.fireCd -= dt; r.beamOn = false;
    if (r.dead || r.finished) { r.charge = 0; return; }
    const inp = r.input, W = r.laser, F = r.fx;
    const s = wrapS(r.dist);
    const canFire = F.emp <= 0 && r.overheat <= 0 && r.protect <= 0;
    const over = F.overload > 0, dmgMul = over ? 1.6 : 1;
    // missile lock (homing types)
    const lockT = this.findTarget(r, 650, 90, 80);
    if (lockT) { if (r.lockTarget === lockT.id) r.lockT += dt; else { r.lockTarget = lockT.id; r.lockT = 0; } } else { r.lockTarget = -1; r.lockT = 0; }
    if (inp.fire && canFire) {
      const aimErr = r.ai ? (1 - r.ai.aim) : 0;
      if (W.beam) {
        const t = this.findTarget(r, W.range, 28, 24);
        r.beamOn = true;
        if (t) {
          const miss = r.ai && R() < aimErr * 0.6;
          r.beamEnd = { s: wrapS(t.dist) , x: t.x + (miss ? 8 : 0), y: t.y };
          if (!miss) { this.damage(t, W.dps * dmgMul * dt, r, 'laser'); if (R() < dt * 20) this.emit({ type: 'hit', s: wrapS(t.dist), x: t.x, y: t.y, color: W.color, v: t.id }); }
        } else {
          r.beamEnd = this.rayEnd(s, r.x, r.y, W.range);
        }
        if (!over) r.heat += W.heatPS * dt;
        if (R() < dt * 8) this.emit({ type: 'beamfx', r: r.id });
      } else if (W.rail) {
        r.charge += dt;
        if (r.charge >= W.charge) {
          r.charge = 0;
          const t = this.findTarget(r, W.range, 40, 34);
          const end = this.rayEnd(s, r.x, r.y, W.range);
          let tx = r.x, ty = r.y;
          if (t && !(r.ai && R() < aimErr * 0.7)) { tx = t.x; ty = t.y; }
          // pierce along the line toward aim point
          const endS = t ? wrapS(t.dist) + 1 : end.s;
          const reach = t ? dS(wrapS(t.dist), s) + 300 : dS(end.s, s);
          const ex = r.x + (tx - r.x) * (reach / Math.max(1, t ? dS(wrapS(t.dist), s) : reach)), ey = r.y + (ty - r.y) * (reach / Math.max(1, t ? dS(wrapS(t.dist), s) : reach));
          for (const o of this.racers) {
            if (o === r || o.dead) continue;
            const d = dS(wrapS(o.dist), s); if (d < 0 || d > reach) continue;
            const k = d / reach; const lx = r.x + (ex - r.x) * k, ly = r.y + (ey - r.y) * k;
            if (Math.abs(o.x - lx) < 6 && Math.abs(o.y - ly) < 5) { this.damage(o, W.dmg * dmgMul, r, 'rail'); this.emit({ type: 'hit', s: wrapS(o.dist), x: o.x, y: o.y, color: W.color, big: true, v: o.id }); }
          }
          const b = bounds(wrapS(s + reach));
          const fx2 = clamp(ex, -b.hw + 2, b.hw - 2), fy2 = clamp(ey, b.yMin, b.yMax);
          this.emit({ type: 'rail', r: r.id, s0: s, x0: r.x, y0: r.y, s1: wrapS(s + Math.min(reach, W.range)), x1: fx2, y1: fy2, color: W.color });
          if (!over) r.heat += W.heat;
          r.fireCd = 0.15;
        }
      } else if (r.fireCd <= 0) {
        r.fireCd = 1 / W.rate;
        const t = this.findTarget(r, W.range, 42, 36);
        const n = W.pellets || 1;
        for (let k = 0; k < n; k++) {
          let vx = 0, vy = 0;
          const rel = W.speed;
          if (t) {
            const d = dS(wrapS(t.dist), s); const tt = d / Math.max(50, rel);
            vx = (t.x + t.vx * tt - r.x) / tt; vy = (t.y + t.vy * tt - r.y) / tt;
            if (r.ai) { vx += (R() - 0.5) * aimErr * 60; vy += (R() - 0.5) * aimErr * 40; }
          }
          if (n > 1) { vx += (k - (n - 1) / 2) * W.spread * rel; vy += (R() - 0.5) * W.spread * rel * 0.5; }
          const side = n > 1 ? 0 : (this.time * W.rate) % 2 < 1 ? -1.6 : 1.6;
          this.bolts.push({ id: NEXT_ID++, owner: r.id, s: wrapS(s + 9), x: r.x + side, y: r.y, vs: rel + r.speed, vx, vy, dmg: W.dmg * dmgMul, color: W.color, life: W.range / rel, len: 14, w: n > 1 ? 0.9 : 1.2 });
        }
        if (!over) r.heat += W.heat;
        this.emit({ type: 'shot', r: r.id, kind: W.key });
      }
      if (r.heat >= RACE.heatMax) { r.heat = RACE.heatMax; r.overheat = RACE.overheatLock; this.emit({ type: 'overheat', r: r.id }); }
    } else {
      if (W.rail && r.charge > 0) r.charge = Math.max(0, r.charge - dt * 2);
    }
    // missiles
    if (inp.missile && canFire && r.ammo > 0 && r.fireCdM === undefined) r.fireCdM = 0;
    r.fireCdM = Math.max(0, (r.fireCdM || 0) - dt);
    if (inp.missile && canFire && r.ammo > 0 && r.fireCdM <= 0) {
      inp.missile = false; r.ammo--; r.fireCdM = 0.6;
      const M = r.missileDef;
      const tgt = M.lock && r.lockTarget >= 0 ? r.lockTarget : -1;
      for (let k = 0; k < M.count; k++) {
        const id = NEXT_ID++;
        if (M.mine) {
          this.missiles.push({ id, owner: r.id, mine: true, s: wrapS(s - 14 - k * 18), x: r.x + (k - 1) * 10, y: r.y + (k % 2) * 4, speed: 0, life: 25, dmg: M.dmg, radius: M.radius, color: M.color, arm: 0.6 });
        } else {
          this.missiles.push({ id, owner: r.id, s: wrapS(s + 6), x: r.x + (k - (M.count - 1) / 2) * 3, y: r.y - 1.5, vx: (k - (M.count - 1) / 2) * 14, vy: 6, speed: r.speed + M.speed * 0.3, maxSpeed: r.speed + M.speed, target: tgt, turn: M.turn, life: 6, dmg: M.dmg, radius: M.radius, color: M.color, big: M.key === 'harpoon' || M.key === 'lance', delay: k * 0.08 });
        }
        if (k === 0) r.lastMissile = id;
      }
      this.emit({ type: 'missile', r: r.id, kind: M.key });
    }
    inp.missile = false;
    // nova super weapon
    if (F.nova > 0) {
      r.beamOn = true;
      const reach = 700; r.novaEnd = this.rayEnd(s, r.x, r.y, reach);
      for (const o of this.racers) {
        if (o === r || o.dead) continue;
        const d = dS(wrapS(o.dist), s);
        if (d > 0 && d < reach && Math.abs(o.x - r.x) < 34 && Math.abs(o.y - r.y) < 30) { this.damage(o, 85 * dt, r, 'nova'); if (R() < dt * 15) this.emit({ type: 'hit', s: wrapS(o.dist), x: o.x, y: o.y, color: '#ff3050', big: true, v: o.id }); }
      }
      for (const sp of this.spires) if (sp.alive) { const d = dS(sp.s, s); if (d > 0 && d < reach && Math.abs(sp.x - r.x) < 34) { sp.alive = false; this.emit({ type: 'shatter', sp: sp.id }); } }
    }
    // drones
    if (F.drones > 0) {
      r.droneT -= dt;
      if (r.droneT <= 0) {
        r.droneT = 0.3;
        const t = this.findTarget(r, 450, 90, 80);
        if (t) {
          const k = Math.floor(R() * 3), a = this.time * 3 + k * 2.1;
          const ox = Math.cos(a) * 9, oy = Math.sin(a) * 6 + 4;
          const d = dS(wrapS(t.dist), s), tt = d / 700;
          this.bolts.push({ id: NEXT_ID++, owner: r.id, s, x: r.x + ox, y: r.y + oy, vs: 700 + r.speed, vx: (t.x - r.x - ox) / tt, vy: (t.y - r.y - oy) / tt, dmg: 4, color: '#ff8a1e', life: 0.8, len: 10, w: 0.9 });
        }
      }
    }
  }

  rayEnd(s, x, y, range) {
    // march forward until the corridor ends (wall/arch)
    for (let d = 10; d < range; d += 20) {
      const b = bounds(wrapS(s + d));
      if (b.tunnel ? Math.hypot(x, y) > b.hw : (Math.abs(x) > b.hw || y < b.yMin || y > b.yMax)) return { s: wrapS(s + d), x, y, wall: true };
    }
    return { s: wrapS(s + range), x, y, wall: false };
  }

  updateBolts(dt) {
    const keep = [];
    for (const b of this.bolts) {
      b.life -= dt; if (b.life <= 0) continue;
      const step = b.vs * dt;
      const s0 = b.s; b.s = wrapS(b.s + step); b.x += b.vx * dt; b.y += b.vy * dt;
      let hit = false;
      for (const o of this.racers) {
        if (o.id === b.owner || o.dead) continue;
        const d = dS(wrapS(o.dist), s0);
        if (d > -6 && d < step + 6 && Math.abs(o.x - b.x) < 5.5 && Math.abs(o.y - b.y) < 4) {
          if (o.fx.decoy > 0 && R() < 0.5) continue;
          this.damage(o, b.dmg, this.racers[b.owner], 'laser');
          this.emit({ type: 'hit', s: wrapS(o.dist), x: b.x, y: b.y, color: b.color, v: o.id });
          hit = true; break;
        }
      }
      if (hit) continue;
      const bd = bounds(b.s);
      const out = bd.tunnel ? Math.hypot(b.x, b.y) > bd.hw + 4 : (Math.abs(b.x) > bd.hw + 8 || b.y < bd.yMin - 4);
      if (out) {
        let nx = 0, ny = 0;
        if (bd.tunnel) { const rr = Math.hypot(b.x, b.y); nx = -b.x / rr; ny = -b.y / rr; } else if (b.y < bd.yMin - 4) ny = 1; else nx = -Math.sign(b.x);
        this.emit({ type: 'wallhit', s: b.s, x: b.x, y: b.y, nx, ny, color: b.color }); continue;
      }
      keep.push(b);
    }
    this.bolts = keep;
  }

  explode(m, s, x, y) {
    this.emit({ type: 'explode', s, x, y, scale: m.big ? 1.2 : (m.mine ? 1 : 0.6), owner: m.owner, color: m.color });
    for (const o of this.racers) {
      if (o.dead) continue;
      const d = Math.hypot(dS(wrapS(o.dist), s), o.x - x, o.y - y);
      if (d < m.radius) this.damage(o, m.dmg * (1 - d / m.radius * 0.6) * (o.id === m.owner ? 0.3 : 1), this.racers[m.owner], 'missile');
    }
    for (const sp of this.spires) {
      if (!sp.alive) continue;
      const d = Math.hypot(dS(sp.s, s), sp.x - x);
      if (d < m.radius + sp.radius && y < sp.topY) { sp.alive = false; this.emit({ type: 'shatter', sp: sp.id }); }
    }
  }

  updateMissiles(dt) {
    const keep = [];
    for (const m of this.missiles) {
      m.life -= dt;
      if (m.mine) {
        m.arm -= dt;
        let trig = null;
        if (m.arm <= 0) for (const o of this.racers) { if (o.id === m.owner && m.life > 22) continue; if (o.dead) continue; if (Math.hypot(dS(wrapS(o.dist), m.s), o.x - m.x, o.y - m.y) < 13) { trig = o; break; } }
        if (trig || m.life <= 0) { if (trig) this.explode(m, m.s, m.x, m.y); continue; }
        keep.push(m); continue;
      }
      if (m.delay > 0) { m.delay -= dt; const ow = this.racers[m.owner]; m.s = wrapS(ow.dist + 6); m.x = ow.x; m.y = ow.y - 1.5; keep.push(m); continue; }
      m.speed = Math.min(m.maxSpeed, m.speed + 400 * dt);
      let t = m.target >= 0 ? this.racers[m.target] : null;
      if (t && (t.dead || t.fx.phase > 0)) t = null;
      if (t) {
        let tx = t.x, ty = t.y, ts = wrapS(t.dist);
        if (t.fx.decoy > 0) { tx = t.x + 25; ty = t.y + 12; }
        const d = dS(ts, m.s);
        const tt = Math.max(0.05, d / Math.max(30, m.speed - t.speed));
        const wantX = (tx - m.x) / tt, wantY = (ty - m.y) / tt;
        const k = Math.min(1, dt * m.turn * 2.2);
        m.vx += (clamp(wantX, -140, 140) - m.vx) * k; m.vy += (clamp(wantY, -140, 140) - m.vy) * k;
        if (d < -30) t = null;
      } else { m.vx *= 1 - dt * 0.8; m.vy *= 1 - dt * 0.8; }
      const s0 = m.s; m.s = wrapS(m.s + m.speed * dt); m.x += m.vx * dt; m.y += m.vy * dt;
      let boom = m.life <= 0;
      if (!boom) for (const o of this.racers) {
        if (o.id === m.owner || o.dead) continue;
        const d = dS(wrapS(o.dist), s0);
        if (d > -4 && d < m.speed * dt + 5 && Math.abs(o.x - m.x) < 6 && Math.abs(o.y - m.y) < 5) { boom = true; break; }
        if (o.fx.decoy > 0 && t === o && Math.hypot(d, o.x + 25 - m.x, o.y + 12 - m.y) < 8) { boom = true; break; }
      }
      const b = bounds(m.s);
      if (!boom && (b.tunnel ? Math.hypot(m.x, m.y) > b.hw - 2 : (Math.abs(m.x) > b.hw + 6 || m.y < b.yMin - 3))) boom = true;
      if (!boom) for (const sp of this.spires) { if (sp.alive && Math.abs(dS(sp.s, m.s)) < sp.radius + 3 && Math.abs(sp.x - m.x) < sp.radius + 2 && m.y < sp.topY) { boom = true; break; } }
      if (!boom) for (const a of FEATURES.arches) { if (Math.abs(dS(m.s, a.s)) < a.thick && Math.abs(Math.hypot(m.x, m.y - a.yc) - a.Ra) < a.thick) { boom = true; break; } }
      if (boom) { this.explode(m, m.s, m.x, m.y); continue; }
      keep.push(m);
    }
    this.missiles = keep;
  }

  updatePickups(dt) {
    for (const p of this.pickups) {
      if (!p.active) { p.t -= dt; if (p.t <= 0) { p.active = true; p.item = Math.floor(R() * ITEMS.length); } continue; }
      for (const r of this.racers) {
        if (r.dead || r.item >= 0 || r.protect > 0) continue;
        const d = dS(wrapS(r.dist), p.s);
        if (d > -8 && d < 8 && Math.abs(r.x - p.x) < 10 && Math.abs(r.y - p.y) < 9) {
          p.active = false; p.t = RACE.pickupRespawn;
          r.item = this.rollItem(r);
          this.emit({ type: 'pickup', r: r.id, item: r.item, s: p.s, x: p.x, y: p.y });
          break;
        }
      }
    }
  }
  rollItem(r) {
    // catch-up weighting: trailing racers get stronger items
    const w = ITEMS.map(it => 1);
    const back = (r.place - 1) / 4;
    const k = (key, v) => { w[ITEMS.findIndex(i => i.key === key)] = v; };
    k('nova', 0.3 + back * 1.6); k('chrono', 0.4 + back * 1.4); k('magnet', back * 1.6 + 0.1); k('boost', 1 + back);
    k('shield', 1.2 - back * 0.5); k('emp', 0.7 + back * 0.6);
    let sum = w.reduce((a, b) => a + b, 0), x = R() * sum;
    for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
    return 0;
  }

  useItem(r) {
    const it = ITEMS[r.item]; r.item = -1; const F = r.fx; const s = wrapS(r.dist);
    switch (it.key) {
      case 'boost': F.boost = 3; break;
      case 'chrono':
        for (const o of this.racers) { if (o === r || o.dead) continue; const d = dS(wrapS(o.dist), s); if (d > -60 && d < 320 && o.fx.phase <= 0) o.fx.slow = 3.2; }
        break;
      case 'nova': F.nova = 2.5; break;
      case 'shield': r.shield = 60; break;
      case 'repair': r.hp = Math.min(r.maxHp, r.hp + 50); break;
      case 'emp':
        for (const o of this.racers) { if (o === r || o.dead) continue; if (Math.abs(dS(wrapS(o.dist), s)) < 300) { o.fx.emp = 3.5; o.shield = 0; } }
        break;
      case 'drones': F.drones = 7; break;
      case 'phase': F.phase = 2.5; break;
      case 'magnet': F.magnet = 4; break;
    }
    this.emit({ type: 'item', r: r.id, item: it.key, s, x: r.x, y: r.y });
  }

  useAbility(r) {
    const a = r.def.ability; r.abilityCd = a.cd; r.abilityT = a.dur; const F = r.fx;
    if (a.key === 'dash') F.dash = a.dur;
    if (a.key === 'decoy') F.decoy = a.dur;
    if (a.key === 'shield') { r.dome = 70; F.domeT = a.dur; }
    if (a.key === 'overload') { F.overload = a.dur; r.heat = 0; r.overheat = 0; }
    if (a.key === 'repair') F.repair = a.dur;
    if (a.key === 'decoy') for (const m of this.missiles) if (m.target === r.id) m.target = -1;
    this.emit({ type: 'ability', r: r.id, key: a.key });
  }

  // ---------------- AI ----------------
  think(r, dt) {
    const A = r.ai, inp = r.input, s = wrapS(r.dist), b = bounds(s);
    if (r.dead) return;
    A.think -= dt;
    if (A.think <= 0) {
      A.think = A.react * (0.6 + R() * 0.6);
      // racing line: inside of upcoming turn
      const f0 = frameAt(s, newFrame()), f1 = frameAt(s + 160, newFrame());
      const turn = f0.t.x * f1.t.z - f0.t.z * f1.t.x; // >0 turning right? sign only
      let tx = clamp(turn * 6, -1, 1) * b.hw * 0.45 * A.line + Math.sin(this.time * 0.3 + r.id) * b.hw * 0.15;
      let ty = 4 + Math.sin(this.time * 0.21 + r.id * 2) * 8;
      if (b.tunnel) { tx *= 0.6; ty = Math.sin(this.time * 0.5 + r.id) * 10; }
      // pickups
      if (r.item < 0) {
        let best = null, bd = 1e9;
        for (const p of this.pickups) { if (!p.active) continue; const d = dS(p.s, s); if (d > 30 && d < 260 && d < bd) { bd = d; best = p; } }
        if (best && R() < 0.4 + A.line * 0.5) { tx = best.x; ty = best.y; }
      }
      // chase target to shoot
      const tgt = this.findTarget(r, 400, 80, 70);
      if (tgt && R() < A.aggro * 0.7) { tx = tgt.x + (R() - 0.5) * 6; ty = tgt.y; }
      // threats: incoming missiles -> jink
      const threat = this.missiles.some(m => m.target === r.id && Math.abs(dS(m.s, s)) < 220);
      if (threat) { tx = r.x + Math.sign(Math.sin(this.time * 2 + A.jink)) * 40; ty = r.y + Math.sign(Math.cos(this.time * 2.3 + A.jink)) * 20; }
      A.tx = tx; A.ty = ty; A.threat = threat; A.tgt = tgt ? tgt.id : -1;
    }
    let tx = A.tx, ty = A.ty;
    // obstacle avoidance (always reactive)
    for (const sp of this.spires) {
      if (!sp.alive) continue; const d = dS(sp.s, s);
      if (d > 0 && d < 140 && Math.abs(tx - sp.x) < sp.radius + 14) { tx = sp.x + (r.x > sp.x ? 1 : -1) * (sp.radius + 18); if (Math.abs(tx) > b.hw - 8) tx = sp.x - Math.sign(tx - sp.x) * (sp.radius + 18); }
    }
    for (const a of FEATURES.arches) { const d = dS(a.s, s); if (d > -5 && d < 160) ty = Math.min(ty, a.y - a.thick - 14); }
    const cy = TRACK.py[idx(s)];
    for (const rib of FEATURES.ribs) { const d = dS(rib.s, s); if (d > -5 && d < 160) { ty = Math.min(ty, rib.floor + rib.r - 26 - cy); tx = clamp(tx, -rib.r * 0.5, rib.r * 0.5); } }
    const bb = bounds(s + 40);
    tx = clamp(tx, -bb.hw + 12, bb.hw - 12); ty = clamp(ty, bb.yMin + 8, bb.yMax - 12);
    if (bb.tunnel) { const rr = Math.hypot(tx, ty), m = bb.hw - 16; if (rr > m) { tx *= m / rr; ty *= m / rr; } }
    inp.steer = clamp((tx - r.x) / 14 - r.vx * 0.02, -1, 1);
    inp.climb = clamp((ty - r.y) / 10 - r.vy * 0.02, -1, 1);
    inp.brake = false;
    // fire control
    const tgt = A.tgt >= 0 ? this.racers[A.tgt] : null;
    const heatOk = r.heat < 80 || r.fx.overload > 0;
    inp.fire = !!tgt && !tgt.dead && heatOk && R() < 0.4 + A.aggro * 0.6;
    if (r.laser.rail && tgt) inp.fire = true;
    if (r.lockTarget >= 0 && r.lockT > 0.6 && r.ammo > 0 && R() < dt * (0.25 + A.aggro * 0.9)) inp.missile = true;
    if (r.missileDef.mine && R() < dt * 0.15 * A.aggro && r.place <= 3) inp.missile = true;
    // items
    if (r.item >= 0) {
      const key = ITEMS[r.item].key; let use = false;
      if (key === 'boost' || key === 'magnet') use = !b.tunnel || R() < dt;
      else if (key === 'nova' || key === 'drones') use = !!tgt;
      else if (key === 'chrono' || key === 'emp') use = r.place > 1 && this.racers.some(o => o !== r && dS(wrapS(o.dist), s) > 0 && dS(wrapS(o.dist), s) < 250);
      else if (key === 'shield' || key === 'repair') use = r.hp < r.maxHp * 0.6;
      else if (key === 'phase') use = A.threat;
      if (use && R() < dt * (1 + A.aggro * 3)) inp.item = true;
    }
    if (r.abilityCd <= 0) {
      const k = r.def.ability.key; let use = false;
      if (k === 'dash') use = !b.tunnel && R() < dt * 0.5;
      if (k === 'decoy') use = A.threat;
      if (k === 'shield') use = r.hitFlash > 0.5;
      if (k === 'overload') use = !!tgt;
      if (k === 'repair') use = r.hp < r.maxHp * 0.55;
      if (use) inp.ability = true;
    }
  }
}
