// Race rules from the spec, checked on the DOM-free simulation: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { Race } from '../js/sim.js';
import { TRACK, FEATURES } from '../js/track.js';
import { RACE, SHIPS, ITEMS, AI_LEVELS, SHIP_LIVERIES } from '../js/config.js';

const L = TRACK.length;
function newRace(diff = 1) {
  const r = new Race({ player: { name: 'T', ship: 0, laser: 0, missile: 0, livery: SHIP_LIVERIES[0][0], finish: 'gloss' }, difficulty: diff });
  r.player.ai = { ...AI_LEVELS[diff], steer: 0, climb: 0, jink: 1, fireHold: 0, think: 0, tx: 0, ty: 0 }; // autopilot for the human slot
  return r;
}

test('content: 5 ships x 5 liveries, 7 spec items present, one player + 4 AI', () => {
  assert.equal(SHIPS.length, 5);
  for (const l of SHIP_LIVERIES) assert.equal(l.length, 5);
  for (const k of ['boost', 'chrono', 'nova', 'shield', 'repair', 'holo', 'emp']) assert.ok(ITEMS.some(i => i.key === k), k);
  const r = newRace();
  assert.equal(r.racers.length, 5);
  assert.equal(r.racers.filter(x => x.human).length, 1);
});

test('track: ~18 km lap, checkpoints every ~1 km ending on the finish line', () => {
  assert.ok(Math.abs(L - 18000) < 300, `lap ${L}`);
  const cps = FEATURES.checkpoints;
  assert.equal(cps.length, 18);
  assert.ok(Math.abs(cps[cps.length - 1] - L) < 1e-6);
  for (let i = 1; i < cps.length; i++) assert.ok(cps[i] > cps[i - 1]);
});

test('respawn: 4 s, rollback <= 250 m, never behind the lap start; protection blocks attacks and pickups', () => {
  const r = newRace(); r.started = true;
  const v = r.racers[2];
  v.dist = L + 120; v.protect = 0;
  r.damage(v, 1e6, null, 'test');
  assert.ok(v.dead); assert.equal(v.respawnT, RACE.respawnDelay); assert.equal(RACE.respawnDelay, 4);
  for (let i = 0; i < 4 * 60 + 2; i++) r.move(v, 1 / 60);
  assert.ok(!v.dead);
  assert.ok(v.dist >= L, 'rolled back across the lap start');
  assert.ok(v.protect > 0);
  const hp = v.hp; r.damage(v, 50, r.racers[1], 'laser'); assert.equal(v.hp, hp, 'protected racer took damage');
  v.input.fire = true; r.weapons(v, 1 / 60); assert.equal(r.bolts.length, 0, 'protected racer fired');
  v.dist = 3000; v.dead = true; v.respawnT = 0.001; r.move(v, 1 / 60);
  assert.equal(Math.round(v.dist), 3000 - RACE.rollback);
});

test('items: one slot; one pickup per case group per lap, not reset by death', () => {
  const r = newRace(); r.started = true;
  const v = r.racers[1]; const p = r.pickups.find(q => q.group === 0);
  v.dist = p.s; v.x = p.x; v.y = p.y; v.protect = 0; v.item = -1;
  r.updatePickups(0); assert.ok(v.item >= 0, 'picked up');
  const held = v.item; const p2 = r.pickups.find(q => q.group === 0 && q !== p);
  v.x = p2.x; v.y = p2.y; r.updatePickups(0); assert.equal(v.item, held, 'second item while slot full');
  v.item = -1; r.updatePickups(0); assert.equal(v.item, -1, 'same group twice in one lap');
  r.damage(v, 1e6, null, 'test'); v.dead = false; v.protect = 0;
  r.updatePickups(0); assert.equal(v.item, -1, 'death reset the group lock');
  v.dist = p.s + L; r.updatePickups(0); assert.ok(v.item >= 0, 'next lap allows the group again');
});

test('full race: everyone finishes 3 laps through every checkpoint in about 9 minutes', () => {
  const r = newRace(1);
  const cps = new Map(r.racers.map(x => [x.id, []]));
  for (let i = 0; i < 60 * 1000 && r.finishOrder.length < 5; i++) {
    r.step(1 / 60);
    for (const e of r.events) if (e.type === 'checkpoint') cps.get(e.r).push(e.n);
    r.events.length = 0;
  }
  assert.equal(r.finishOrder.length, 5, 'not everyone finished');
  for (const [, list] of cps) {
    assert.equal(list.length, 18 * 3);
    list.forEach((n, i) => assert.equal(n, (i % 18) + 1, 'checkpoint out of order'));
  }
  const winner = r.racers[r.finishOrder[0]].finishTime / 60;
  assert.ok(winner > 7 && winner < 12, `winner time ${winner.toFixed(2)} min`);
});
