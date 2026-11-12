// Procedural WebAudio: layered engine, weapons, explosions, item sounds, UI and an adaptive synthwave score.
// Buses: sfx -> master, music -> master, both send into a shared reverb (thicker inside the tunnel).
// play(name, dist, pan): dist in metres dulls and quiets distant sounds, pan in [-1, 1] places them left/right.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.musicOn = true; this.intensity = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.75; this.sfx.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.26; this.mus.connect(this.master);
    // reverb: generated impulse response (decaying stereo noise)
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.4, 2.6);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.22; this.verbIn.connect(this.verb);
    const vOut = ctx.createGain(); vOut.gain.value = 0.55; this.verb.connect(vOut); vOut.connect(this.master);
    this.mus.connect(this.verbIn);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this.buildEngine(); this.buildBeam();
    this.startMusic();
  }
  impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  buildEngine() {
    const ctx = this.ctx;
    this.eng = ctx.createGain(); this.eng.gain.value = 0; this.eng.connect(this.sfx);
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600; this.engF.Q.value = 2; this.engF.connect(this.eng);
    this.engOsc = [0.996, 1.004, 1.5].map((m, i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60 * m; const g = ctx.createGain(); g.gain.value = i === 2 ? 0.35 : 0.5; o.connect(g); g.connect(this.engF); o.start(); return { o, m }; });
    this.sub = ctx.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = 40; const sg = ctx.createGain(); sg.gain.value = 0.5; this.sub.connect(sg); sg.connect(this.eng); this.sub.start();
    // turbine whine
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 1800;
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0; this.whine.connect(this.whineG); this.whineG.connect(this.sfx); this.whine.start();
    // wind + afterburner roar
    const ns = ctx.createBufferSource(); ns.buffer = this.noise; ns.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 900; this.windF.Q.value = 0.6;
    this.wind = ctx.createGain(); this.wind.gain.value = 0; ns.connect(this.windF); this.windF.connect(this.wind); this.wind.connect(this.sfx);
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'lowpass'; this.roarF.frequency.value = 500;
    this.roar = ctx.createGain(); this.roar.gain.value = 0; ns.connect(this.roarF); this.roarF.connect(this.roar); this.roar.connect(this.sfx); this.roar.connect(this.verbIn);
    ns.start();
  }
  buildBeam() {
    const ctx = this.ctx;
    this.beam = ctx.createGain(); this.beam.gain.value = 0; this.beam.connect(this.sfx);
    const bo = ctx.createOscillator(); bo.type = 'sawtooth'; bo.frequency.value = 180;
    const bo2 = ctx.createOscillator(); bo2.type = 'square'; bo2.frequency.value = 361;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1600; bf.Q.value = 3;
    bo.connect(bf); bo2.connect(bf); bf.connect(this.beam); bo.start(); bo2.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 27; const lg = ctx.createGain(); lg.gain.value = 500; lfo.connect(lg); lg.connect(bf.frequency); lfo.start();
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.02); }
  setIntensity(x) { this.intensity = x; }
  engine(speed, boost, inTunnel) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const f = 42 + speed * 0.5 + boost * 26;
    for (const { o, m } of this.engOsc) o.frequency.setTargetAtTime(f * m, t, 0.12);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.12);
    this.engF.frequency.setTargetAtTime(350 + speed * 7 + boost * 1400, t, 0.12);
    this.eng.gain.setTargetAtTime(0.1 + boost * 0.06, t, 0.2);
    this.whine.frequency.setTargetAtTime(1400 + speed * 14 + boost * 900, t, 0.25);
    this.whineG.gain.setTargetAtTime(0.008 + speed / 26000 + boost * 0.01, t, 0.3);
    this.wind.gain.setTargetAtTime(0.025 + speed / 2200 + (inTunnel ? 0.07 : 0), t, 0.2);
    this.windF.frequency.setTargetAtTime(inTunnel ? 420 : 800 + speed * 4, t, 0.25);
    this.roar.gain.setTargetAtTime(boost * 0.22, t, 0.12); this.roarF.frequency.setTargetAtTime(300 + boost * 900, t, 0.2);
    this.verbIn.gain.setTargetAtTime(inTunnel ? 0.6 : 0.22, t, 0.4);
  }
  stopEngine() { if (this.ctx) { const t = this.ctx.currentTime; for (const g of [this.eng, this.whineG, this.wind, this.roar]) g.gain.setTargetAtTime(0, t, 0.15); } }
  beamOn(on) { if (this.ctx) this.beam.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 0.03); }
  // output chain for one-shot sounds: distance lowpass -> stereo pan -> sfx (+ optional reverb send)
  out(dist, pan, send) {
    const ctx = this.ctx, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 18000 / (1 + dist / 90));
    let node = lp;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); lp.connect(p); node = p; }
    node.connect(this.sfx);
    if (send) { const g = ctx.createGain(); g.gain.value = send; node.connect(g); g.connect(this.verbIn); }
    return lp;
  }
  tone(type, f0, f1, dur, vol, delay, dest) {
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.03);
  }
  noiseHit(dur, f, vol, q, type, delay, dest, f1) {
    const t = this.ctx.currentTime + (delay || 0);
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const fl = this.ctx.createBiquadFilter(); fl.type = type || 'lowpass'; fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1 || f * 0.15), t + dur); fl.Q.value = q || 0.7;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  play(name, dist = 0, pan = 0) {
    if (!this.ctx || this.muted) return;
    const v = Math.max(0.04, 1 - dist / 750);
    const T = (type, f0, f1, dur, vol, delay = 0, send = 0) => this.tone(type, f0, f1, dur, vol * v, delay, this.out(dist, pan, send));
    const N = (dur, f, vol, q, type, delay = 0, send = 0, f1) => this.noiseHit(dur, f, vol * v, q, type, delay, this.out(dist, pan, send), f1);
    switch (name) {
      case 'pulse': T('square', 1700, 380, 0.07, 0.045); N(0.03, 6000, 0.03, 1, 'highpass'); break;
      case 'prism': T('sawtooth', 1100, 140, 0.16, 0.06); T('square', 700, 90, 0.12, 0.03, 0.01); N(0.08, 4000, 0.05, 1, 'highpass'); break;
      case 'rail': T('sawtooth', 3200, 50, 0.5, 0.13, 0, 0.3); N(0.35, 7000, 0.12, 1, 'highpass', 0, 0.3); T('sine', 120, 40, 0.4, 0.2); break;
      case 'missile': N(0.9, 2600, 0.2, 2, 'bandpass', 0, 0.2, 600); T('triangle', 260, 900, 0.45, 0.05); break;
      case 'explode': N(1.4, 1100, 0.6, 0.7, 'lowpass', 0, 0.35); T('sine', 110, 28, 0.9, 0.5); N(0.25, 3200, 0.18, 2, 'bandpass', 0.05); break;
      case 'bigexplode': N(2.4, 1400, 0.85, 0.7, 'lowpass', 0, 0.5); T('sine', 80, 18, 1.8, 0.8, 0, 0.3); N(0.5, 5200, 0.28, 1, 'highpass', 0, 0.3); N(1.2, 2400, 0.2, 3, 'bandpass', 0.18, 0.4); break;
      case 'hit': N(0.09, 3200, 0.12, 2, 'bandpass'); T('square', 820, 220, 0.05, 0.035); break;
      case 'hurt': N(0.2, 1500, 0.3, 1.5, 'bandpass'); T('sawtooth', 170, 55, 0.2, 0.14); T('sine', 60, 30, 0.25, 0.25); break;
      case 'scrape': N(0.16, 3800, 0.12, 4, 'bandpass'); break;
      case 'flyby': N(0.9, 900, 0.32, 1.2, 'bandpass', 0, 0.2, 2600); T('sawtooth', 220, 120, 0.8, 0.05); break;
      case 'pickup': [0, 0.06, 0.12, 0.2].forEach((d, i) => T('triangle', 660 * [1, 1.26, 1.5, 2][i], 660 * [1, 1.26, 1.5, 2][i], 0.18, 0.1, d, 0.4)); break;
      case 'boost': N(1.6, 600, 0.35, 0.8, 'lowpass', 0, 0.3, 2400); T('sawtooth', 90, 260, 1.2, 0.12); break;
      case 'shield': T('sine', 300, 900, 0.5, 0.15, 0, 0.4); T('sine', 450, 1350, 0.5, 0.08, 0.04, 0.4); N(0.5, 6000, 0.05, 6, 'bandpass', 0, 0.4); break;
      case 'repair': [0, 0.08, 0.16, 0.24, 0.32].forEach((d, i) => T('sine', 440 * Math.pow(1.19, i), 440 * Math.pow(1.19, i), 0.22, 0.09, d, 0.4)); break;
      case 'holo': for (let i = 0; i < 8; i++) T('square', 400 + Math.random() * 1800, 300 + Math.random() * 900, 0.06, 0.04, i * 0.045, 0.5); break;
      case 'nova': T('sawtooth', 70, 900, 1.3, 0.22, 0, 0.4); N(2.6, 3200, 0.3, 1, 'lowpass', 0.2, 0.4); T('sine', 50, 40, 2.4, 0.35); break;
      case 'chrono': T('sine', 1000, 50, 1.6, 0.28, 0, 0.6); T('sine', 1330, 70, 1.6, 0.14, 0, 0.6); T('sawtooth', 200, 30, 1.4, 0.06); break;
      case 'emp': N(0.7, 9000, 0.3, 6, 'bandpass', 0, 0.5, 400); T('square', 2400, 40, 0.7, 0.12, 0, 0.3); break;
      case 'item': T('sawtooth', 220, 1700, 0.32, 0.1, 0, 0.3); break;
      case 'beep': T('square', 660, 660, 0.18, 0.12, 0, 0.3); break;
      case 'go': T('square', 1320, 1320, 0.5, 0.14, 0, 0.4); T('square', 660, 660, 0.5, 0.08, 0, 0.4); break;
      case 'ring': T('triangle', 500, 1600, 0.3, 0.11, 0, 0.4); break;
      case 'checkpoint': T('triangle', 1200, 1200, 0.08, 0.06, 0, 0.3); T('triangle', 1800, 1800, 0.1, 0.05, 0.06, 0.3); break;
      case 'lock': T('square', 1800, 1800, 0.05, 0.045); break;
      case 'ui': T('triangle', 900, 1300, 0.06, 0.07); break;
      case 'overheat': T('sawtooth', 420, 90, 0.55, 0.1); N(0.5, 3000, 0.06, 2, 'bandpass'); break;
      case 'ability': T('triangle', 300, 1200, 0.3, 0.13, 0, 0.3); T('sine', 600, 2400, 0.3, 0.07, 0.05, 0.3); break;
      case 'warn': T('square', 1000, 1000, 0.08, 0.07); T('square', 1000, 1000, 0.08, 0.07, 0.12); break;
    }
  }
  // adaptive synthwave: pad + bass + arp always; drums, lead and density follow `intensity` (0 = hangar, 1 = race)
  startMusic() {
    const ctx = this.ctx; const bpm = 120, step = 60 / bpm / 4;
    const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const bassPat = [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 7, 0, 10, 12];
    const arp = [0, 7, 12, 16, 19, 16, 12, 7];
    const lead = [[0, 76], [3, 74], [6, 72], [8, 74], [12, 76], [14, 79], [16, 81], [22, 79], [24, 76], [28, 74]];
    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    const duck = ctx.createGain(); duck.connect(this.mus); // side-chain style pump on the pad
    let n = 0, next = ctx.currentTime + 0.1;
    const voice = (type, f, t, dur, vol, cutoff, dest = this.mus, det = 0) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff, t); fl.frequency.exponentialRampToValueAtTime(cutoff * 0.35, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    };
    const drum = (t, kind, vol = 1) => {
      if (kind === 'k') {
        const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.9 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.25);
        duck.gain.setValueAtTime(0.35, t); duck.gain.linearRampToValueAtTime(1, t + step * 3);
      } else {
        const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter();
        f.type = kind === 's' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 's' ? 1900 : 7500;
        const g = ctx.createGain(); const d = kind === 's' ? 0.2 : 0.035; g.gain.setValueAtTime((kind === 's' ? 0.45 : 0.14) * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
        s.connect(f); f.connect(g); g.connect(this.mus); if (kind === 's') g.connect(this.verbIn); s.start(t, Math.random()); s.stop(t + d + 0.02);
      }
    };
    const tick = () => {
      if (!this.ctx) return;
      if (next < ctx.currentTime - 0.1) next = ctx.currentTime + 0.05; // skip notes missed while the tab slept
      while (next < ctx.currentTime + 0.3) {
        const I = this.intensity;
        if (this.musicOn) {
          const bar = Math.floor(n / 16) % 4, i = n % 16, chord = prog[bar], root = chord[0] - 24;
          if (i === 0) for (const m of chord) for (const det of [-9, 9]) voice('sawtooth', midi(m), next, step * 16, 0.035, 1400 + I * 1200, duck, det);
          if (I > 0.3 || i % 2 === 0) voice('sawtooth', midi(root + bassPat[i]), next, step * 0.9, 0.2, 700 + I * 500);
          if (n % 2 === 0) voice('square', midi(chord[0] + 12 + arp[(n / 2) % 8]), next, step * 1.6, 0.035 + I * 0.02, 2400);
          if (I > 0.5) {
            if (i % 4 === 0) drum(next, 'k');
            if (i === 4 || i === 12) drum(next, 's');
            drum(next, 'h', i % 2 ? 0.6 : 1);
            const ph = n % 64, nt = lead.find(([s]) => s * 2 === ph);
            if (nt && Math.floor(n / 64) % 2 === 1) voice('square', midi(nt[1]), next, step * 3.5, 0.045, 3200, this.mus, 6);
          } else if (i === 0) drum(next, 'k', 0.4);
        }
        n++; next += step;
      }
      setTimeout(tick, 60);
    };
    tick();
  }
}
