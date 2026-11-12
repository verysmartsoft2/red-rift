// Procedural WebAudio: layered engine, weapons, explosions, item sounds, UI and an adaptive synthwave score.
// Buses: sfx -> master, music -> master, both send into a shared reverb (thicker inside the tunnel).
// play(name, dist, pan): dist in metres dulls and quiets distant sounds, pan in [-1, 1] places them left/right.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.musicOn = true; this.intensity = 0; this.ext = null; }
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
    if (window.RR_MUSIC) this.useTracks(window.RR_MUSIC); // set in index.html when recorded tracks ship with the site
  }
  impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  buildEngine() {
    // jet engine, not a synth: brown-noise roar that opens up with speed, a fluttering low rumble,
    // a turbine whine with a few partials, air hiss, and afterburner crackle on boost
    const ctx = this.ctx, sr = ctx.sampleRate;
    const bn = ctx.createBuffer(1, sr * 3, sr), bd = bn.getChannelData(0); let last = 0;
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    const cr = ctx.createBuffer(1, sr * 2, sr), cd = cr.getChannelData(0); // sparse pops for the afterburner
    for (let k = 0; k < 520; k++) { const at = Math.floor(Math.random() * (cd.length - 400)), a = (Math.random() * 0.8 + 0.2) * (Math.random() < 0.5 ? -1 : 1), len = 40 + Math.random() * 260; for (let i = 0; i < len; i++) cd[at + i] += a * Math.exp(-i / (len * 0.25)) * (Math.random() * 0.6 + 0.4); }
    const loop = (buf) => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(0, Math.random() * buf.duration); return n; };
    this.eng = ctx.createGain(); this.eng.gain.value = 0; this.eng.connect(this.sfx);
    this.body = loop(bn); this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 400; this.engF.Q.value = 0.9;
    this.engB = ctx.createBiquadFilter(); this.engB.type = 'peaking'; this.engB.frequency.value = 220; this.engB.Q.value = 1.2; this.engB.gain.value = 6;
    const bodyG = ctx.createGain(); bodyG.gain.value = 0.9; this.body.connect(this.engF); this.engF.connect(this.engB); this.engB.connect(bodyG); bodyG.connect(this.eng);
    const rum = loop(bn), rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 95;
    this.rumG = ctx.createGain(); this.rumG.gain.value = 1.1;
    const flut = ctx.createOscillator(); flut.frequency.value = 11; const fg = ctx.createGain(); fg.gain.value = 0.4; flut.connect(fg); fg.connect(this.rumG.gain); flut.start(); this.flut = flut;
    rum.connect(rf); rf.connect(this.rumG); this.rumG.connect(this.eng);
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0; this.whineG.connect(this.sfx);
    this.whineF = ctx.createBiquadFilter(); this.whineF.type = 'bandpass'; this.whineF.Q.value = 2.5; this.whineF.frequency.value = 2200; this.whineF.connect(this.whineG);
    this.whines = [[1, 'triangle', 0.55], [2.03, 'sine', 0.28], [3.07, 'sine', 0.1]].map(([m, type, v]) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = 900 * m; const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(this.whineF); o.start(); return { o, m }; });
    const vib = ctx.createOscillator(); vib.frequency.value = 5.7; const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg); for (const w of this.whines) vg.connect(w.o.detune); vib.start();
    const ns = loop(this.noise);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 900; this.windF.Q.value = 0.5;
    this.wind = ctx.createGain(); this.wind.gain.value = 0; ns.connect(this.windF); this.windF.connect(this.wind); this.wind.connect(this.sfx);
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'lowpass'; this.roarF.frequency.value = 500;
    this.roar = ctx.createGain(); this.roar.gain.value = 0; const rb = loop(bn); rb.connect(this.roarF); this.roarF.connect(this.roar); this.roar.connect(this.sfx); this.roar.connect(this.verbIn);
    const crk = loop(cr), cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 1300; cf.Q.value = 0.7;
    this.crackle = ctx.createGain(); this.crackle.gain.value = 0; crk.connect(cf); cf.connect(this.crackle); this.crackle.connect(this.sfx);
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
  setIntensity(x) { this.intensity = x; this.mixTracks(); }
  // recorded music (music/menu.mp3, music/race.mp3) replaces the procedural score when present; missing files keep the synth
  async useTracks(map) {
    if (!this.ctx || this.ext) return;
    const ext = {};
    await Promise.all(Object.entries(map).map(async ([k, url]) => {
      try {
        const r = await fetch(url); if (!r.ok) return;
        const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
        const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.mus); src.start();
        ext[k] = g;
      } catch (e) { /* offline file or no track: keep the synth */ }
    }));
    if (Object.keys(ext).length) { this.ext = ext; this.mixTracks(); }
  }
  mixTracks() {
    if (!this.ctx || !this.ext) return; const t = this.ctx.currentTime, on = this.musicOn ? 1 : 0, I = this.intensity;
    const { menu, race } = this.ext;
    if (menu) menu.gain.setTargetAtTime(on * (race ? 1 - I : 1) * 2.2, t, 0.6);
    if (race) race.gain.setTargetAtTime(on * (menu ? I : 1) * 2.2, t, 0.6);
  }
  engine(speed, boost, inTunnel) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const k = Math.min(1.6, speed / 120); // 1 at cruise
    this.body.playbackRate.setTargetAtTime(0.75 + k * 0.3 + boost * 0.15, t, 0.2);
    this.engF.frequency.setTargetAtTime(260 + k * 520 + boost * 1100, t, 0.15);
    this.engB.frequency.setTargetAtTime(160 + k * 90 + boost * 60, t, 0.2);
    this.eng.gain.setTargetAtTime(0.16 + k * 0.05 + boost * 0.1, t, 0.2);
    this.flut.frequency.setTargetAtTime(8 + k * 6, t, 0.3);
    const wf = 620 + speed * 7.5 + boost * 520;
    for (const { o, m } of this.whines) o.frequency.setTargetAtTime(wf * m, t, 0.35);
    this.whineF.frequency.setTargetAtTime(wf * 1.8, t, 0.35);
    this.whineG.gain.setTargetAtTime(0.012 + k * 0.012 + boost * 0.008, t, 0.3);
    this.wind.gain.setTargetAtTime(0.02 + speed / 2600 + (inTunnel ? 0.06 : 0), t, 0.2);
    this.windF.frequency.setTargetAtTime(inTunnel ? 420 : 700 + speed * 5, t, 0.25);
    this.roar.gain.setTargetAtTime(boost * 0.3, t, 0.1); this.roarF.frequency.setTargetAtTime(380 + boost * 1200, t, 0.15);
    this.crackle.gain.setTargetAtTime(boost * 0.16, t, 0.08);
    this.verbIn.gain.setTargetAtTime(inTunnel ? 0.6 : 0.22, t, 0.4);
  }
  stopEngine() { if (this.ctx) { const t = this.ctx.currentTime; for (const g of [this.eng, this.whineG, this.wind, this.roar, this.crackle]) g.gain.setTargetAtTime(0, t, 0.15); } }
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
      case 'pulse': T('sawtooth', 2100, 300, 0.09, 0.04); T('sine', 1100, 160, 0.11, 0.06); N(0.035, 7000, 0.035, 1, 'highpass'); T('sine', 90, 50, 0.08, 0.05); break;
      case 'prism': T('sawtooth', 1100, 140, 0.16, 0.06); T('square', 700, 90, 0.12, 0.03, 0.01); N(0.08, 4000, 0.05, 1, 'highpass'); break;
      case 'rail': T('sawtooth', 3200, 50, 0.5, 0.13, 0, 0.3); N(0.35, 7000, 0.12, 1, 'highpass', 0, 0.3); T('sine', 120, 40, 0.4, 0.2); break;
      case 'missile': N(0.9, 2600, 0.2, 2, 'bandpass', 0, 0.2, 600); T('triangle', 260, 900, 0.45, 0.05); break;
      case 'explode': N(1.4, 1100, 0.6, 0.7, 'lowpass', 0, 0.35); T('sine', 110, 28, 0.9, 0.5); N(0.25, 3200, 0.18, 2, 'bandpass', 0.05); break;
      case 'bigexplode': N(2.4, 1400, 0.85, 0.7, 'lowpass', 0, 0.5); T('sine', 80, 18, 1.8, 0.8, 0, 0.3); N(0.5, 5200, 0.28, 1, 'highpass', 0, 0.3); N(1.2, 2400, 0.2, 3, 'bandpass', 0.18, 0.4); break;
      case 'hit': N(0.09, 3200, 0.12, 2, 'bandpass'); T('square', 820, 220, 0.05, 0.03); [1130, 1790, 2610].forEach((f, i) => T('sine', f, f * 0.97, 0.16, 0.025 / (i + 1))); break;
      case 'clang': N(0.12, 1800, 0.45, 1.2, 'bandpass', 0, 0.25); T('sine', 75, 38, 0.3, 0.5); [187, 431, 779, 1263].forEach((f, i) => T('triangle', f, f * 0.94, 0.55 - i * 0.08, 0.12 / (i + 1), 0, 0.3)); N(0.4, 5200, 0.12, 3, 'bandpass', 0.02, 0.2, 1800); break;
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
        if (this.musicOn && !this.ext) {
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
      this.mixTracks();
      setTimeout(tick, 60);
    };
    tick();
  }
}
