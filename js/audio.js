// Procedural WebAudio: engine, weapons, explosions, UI, and a synthwave loop.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.musicOn = true; }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.28; this.mus.connect(this.master);
    // noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // engine
    this.eng = ctx.createGain(); this.eng.gain.value = 0.0; this.eng.connect(this.sfx);
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600; this.engF.connect(this.eng);
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o1.frequency.value = 60; this.o1.connect(this.engF); this.o1.start();
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth'; this.o2.frequency.value = 90.5; this.o2.connect(this.engF); this.o2.start();
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 900; this.windF.Q.value = 0.6;
    this.wind = ctx.createGain(); this.wind.gain.value = 0; ns.connect(this.windF); this.windF.connect(this.wind); this.wind.connect(this.sfx); ns.start();
    this.beam = ctx.createGain(); this.beam.gain.value = 0; this.beam.connect(this.sfx);
    const bo = ctx.createOscillator(); bo.type = 'square'; bo.frequency.value = 220; const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1800; bo.connect(bf); bf.connect(this.beam); bo.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 31; const lg = ctx.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(bo.frequency); lfo.start();
    this.startMusic();
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  engine(speed, boost, inTunnel) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const f = 45 + speed * 0.55 + boost * 30;
    this.o1.frequency.setTargetAtTime(f, t, 0.1); this.o2.frequency.setTargetAtTime(f * 1.505, t, 0.1);
    this.engF.frequency.setTargetAtTime(400 + speed * 8 + boost * 1200, t, 0.1);
    this.eng.gain.setTargetAtTime(0.12 + boost * 0.08, t, 0.2);
    this.wind.gain.setTargetAtTime(0.03 + speed / 2000 + (inTunnel ? 0.06 : 0), t, 0.2);
    this.windF.frequency.setTargetAtTime(inTunnel ? 500 : 900 + speed * 4, t, 0.2);
  }
  beamOn(on) { if (this.ctx) this.beam.gain.setTargetAtTime(on ? 0.07 : 0, this.ctx.currentTime, 0.03); }
  tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  noiseHit(dur, f, vol = 0.4, q = 0.7, type = 'lowpass', delay = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.15), t + dur); fl.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  play(name, dist = 0) {
    if (!this.ctx || this.muted) return;
    const v = Math.max(0.05, 1 - dist / 700);
    switch (name) {
      case 'pulse': this.tone('square', 1500, 300, 0.08, 0.05 * v); break;
      case 'prism': this.tone('sawtooth', 900, 120, 0.15, 0.07 * v); this.noiseHit(0.08, 4000, 0.05 * v, 1, 'highpass'); break;
      case 'rail': this.tone('sawtooth', 2400, 60, 0.45, 0.14 * v); this.noiseHit(0.3, 6000, 0.12 * v, 1, 'highpass'); break;
      case 'missile': this.noiseHit(0.7, 2500, 0.22 * v, 2, 'bandpass'); this.tone('triangle', 300, 900, 0.4, 0.05 * v); break;
      case 'explode': this.noiseHit(1.4, 900, 0.7 * v); this.tone('sine', 90, 30, 0.9, 0.5 * v); break;
      case 'bigexplode': this.noiseHit(2.2, 1200, 0.9 * v); this.tone('sine', 70, 20, 1.6, 0.8 * v); this.noiseHit(0.4, 5000, 0.3 * v, 1, 'highpass'); break;
      case 'hit': this.noiseHit(0.1, 3000, 0.12 * v, 2, 'bandpass'); this.tone('square', 700, 200, 0.06, 0.04 * v); break;
      case 'hurt': this.noiseHit(0.18, 1500, 0.3, 1.5, 'bandpass'); this.tone('sawtooth', 160, 60, 0.18, 0.15); break;
      case 'scrape': this.noiseHit(0.15, 3500, 0.12, 3, 'bandpass'); break;
      case 'pickup': [0, 0.06, 0.12].forEach((d, i) => this.tone('triangle', 660 * (1 + i * 0.26), 660 * (1 + i * 0.26), 0.12, 0.12, d)); break;
      case 'item': this.tone('sawtooth', 200, 1600, 0.35, 0.12); break;
      case 'nova': this.tone('sawtooth', 80, 800, 1.2, 0.25); this.noiseHit(2.5, 3000, 0.3, 1); break;
      case 'chrono': this.tone('sine', 900, 60, 1.5, 0.3); this.tone('sine', 1200, 90, 1.5, 0.15); break;
      case 'emp': this.noiseHit(0.6, 8000, 0.3, 5, 'bandpass'); this.tone('square', 2000, 50, 0.6, 0.12); break;
      case 'beep': this.tone('square', 660, 660, 0.18, 0.14); break;
      case 'go': this.tone('square', 1320, 1320, 0.45, 0.16); break;
      case 'ring': this.tone('triangle', 500, 1500, 0.3, 0.12); break;
      case 'lock': this.tone('square', 1800, 1800, 0.05, 0.05); break;
      case 'ui': this.tone('triangle', 900, 1300, 0.06, 0.08); break;
      case 'overheat': this.tone('sawtooth', 400, 100, 0.5, 0.1); break;
      case 'ability': this.tone('triangle', 300, 1200, 0.3, 0.14); this.tone('sine', 600, 2400, 0.3, 0.08, 0.05); break;
      case 'warn': this.tone('square', 1000, 1000, 0.08, 0.08); this.tone('square', 1000, 1000, 0.08, 0.08, 0.12); break;
    }
  }
  startMusic() {
    const ctx = this.ctx; const bpm = 118, step = 60 / bpm / 4;
    const bass = [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 7, 0, 10, 12];
    const prog = [36 + 9, 36 + 5, 36 + 0, 36 + 7]; // A F C G
    const arp = [0, 7, 12, 15, 19, 15, 12, 7];
    let n = 0, next = ctx.currentTime + 0.1;
    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    const voice = (type, f, t, dur, vol, cutoff) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff, t); fl.frequency.exponentialRampToValueAtTime(cutoff * 0.3, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(this.mus); o.start(t); o.stop(t + dur + 0.05);
    };
    const drum = (t, kind) => {
      if (kind === 'k') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.25); }
      else { const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = kind === 's' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 's' ? 1800 : 7000; const g = ctx.createGain(); const d = kind === 's' ? 0.18 : 0.04; g.gain.setValueAtTime(kind === 's' ? 0.5 : 0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(f); f.connect(g); g.connect(this.mus); s.start(t, Math.random()); s.stop(t + d + 0.02); }
    };
    const tick = () => {
      if (!this.ctx) return;
      while (next < ctx.currentTime + 0.25) {
        if (this.musicOn) {
          const bar = Math.floor(n / 16) % 4, i = n % 16, root = prog[bar];
          voice('sawtooth', midi(root + bass[i] - 12), next, step * 0.9, 0.22, 900);
          if (n % 2 === 0) voice('square', midi(root + 24 + arp[(n / 2) % 8]), next, step * 1.6, 0.05, 2600);
          if (i % 4 === 0) drum(next, 'k');
          if (i === 4 || i === 12) drum(next, 's');
          drum(next, 'h');
          if (i === 0) voice('triangle', midi(root + 36), next, step * 14, 0.04, 3000);
        }
        n++; next += step;
      }
      setTimeout(tick, 60);
    };
    tick();
  }
}
