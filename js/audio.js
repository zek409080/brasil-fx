/* Motor de som procedural (Web Audio API). Nenhum arquivo de áudio: tudo é sintetizado
   com ruído filtrado, osciladores e um reverb de convolução gerado na hora.
   Cada simulação usa um "bus" próprio, que pode ser silenciado ao limpar ou repetir. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.volume = 0.75;
      this.muted = false;
      this.userPaused = false;
    }

    get ready() { return !!this.ctx; }
    now() { return this.ctx ? this.ctx.currentTime : 0; }
    running() { return !!this.ctx && this.ctx.state === 'running'; }

    /** Precisa ser chamado dentro de um gesto do usuário (clique/toque). */
    unlock() {
      if (!this.ctx) this._init();
      if (this.ctx && this.ctx.state !== 'running' && !this.userPaused) {
        this.ctx.resume().catch(() => {});
      }
    }

    _init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      let ctx;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return; }
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this._level();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(3.2, 2.3);
      const rvOut = ctx.createGain();
      rvOut.gain.value = 0.6;
      this.reverb.connect(rvOut);
      rvOut.connect(this.master);

      this.white = this._noise('white', 3);
      this.brown = this._noise('brown', 4);

      const uiDry = ctx.createGain();
      uiDry.connect(this.master);
      const uiWet = ctx.createGain();
      uiWet.gain.value = 0.5;
      uiWet.connect(this.reverb);
      this.uiBus = { dry: uiDry, wet: uiWet };
    }

    _level() { return this.muted ? 0 : this.volume * this.volume; }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.setTargetAtTime(this._level(), this.ctx.currentTime, 0.03);
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(this._level(), this.ctx.currentTime, 0.03);
    }

    /** Pausar suspende o relógio do áudio: todos os sons agendados congelam junto com a animação. */
    pause() {
      this.userPaused = true;
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }

    resume() {
      this.userPaused = false;
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    }

    _noise(type, seconds) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      if (type === 'white') {
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } else {
        let last = 0;
        for (let i = 0; i < len; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = last * 3.5;
        }
      }
      return buf;
    }

    _impulse(seconds, decay) {
      const ctx = this.ctx;
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let y = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const x = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
          // passa-baixa que escurece a cauda com o tempo (sala grande, som de cinema)
          const k = 0.62 - 0.5 * t;
          y += k * (x - y);
          const fadeIn = i < rate * 0.012 ? i / (rate * 0.012) : 1;
          d[i] = y * fadeIn * 1.6;
        }
      }
      return buf;
    }

    /** Novo bus para uma simulação. */
    bus() {
      if (!this.ctx) return null;
      const dry = this.ctx.createGain();
      dry.connect(this.master);
      const wet = this.ctx.createGain();
      wet.connect(this.reverb);
      return { dry, wet };
    }

    killBus(bus, fade = 0.08) {
      if (!bus || !this.ctx) return;
      const now = this.ctx.currentTime;
      for (const n of [bus.dry, bus.wet]) {
        n.gain.cancelScheduledValues(now);
        n.gain.setValueAtTime(n.gain.value, now);
        n.gain.linearRampToValueAtTime(0, now + fade);
      }
      setTimeout(() => {
        try { bus.dry.disconnect(); bus.wet.disconnect(); } catch (e) { /* já desconectado */ }
      }, (fade + 0.15) * 1000);
    }

    // ---------- vozes básicas ----------

    _env(param, t, o) {
      if (o.env) {
        param.setValueAtTime(Math.max(o.env[0][1], 0.0001), t + o.env[0][0]);
        for (let i = 1; i < o.env.length; i++) param.linearRampToValueAtTime(Math.max(o.env[i][1], 0.0001), t + o.env[i][0]);
        return;
      }
      const a = o.attack ?? 0.005;
      const peak = Math.max(o.gain ?? 0.5, 0.0002);
      const hold = o.hold ?? 0;
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(peak, t + a);
      param.setTargetAtTime(0.0001, t + a + hold, o.tau ?? 0.2);
    }

    _filter(node, t, f, dur) {
      const bq = this.ctx.createBiquadFilter();
      bq.type = f.type;
      bq.Q.value = f.q ?? 0.7;
      bq.frequency.setValueAtTime(f.f0, t);
      if (f.f1) bq.frequency.exponentialRampToValueAtTime(f.f1, t + (f.glide || dur));
      node.connect(bq);
      return bq;
    }

    _out(bus, node, o, t) {
      let last = node;
      if ((o.pan || o.panTo !== undefined) && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.setValueAtTime(o.pan || 0, t);
        if (o.panTo !== undefined) p.pan.linearRampToValueAtTime(o.panTo, t + (o.panTime || o.dur));
        last.connect(p);
        last = p;
      }
      last.connect(bus.dry);
      const wet = o.wet ?? 0.25;
      if (wet > 0) {
        const w = this.ctx.createGain();
        w.gain.value = wet;
        last.connect(w);
        w.connect(bus.wet);
      }
    }

    noise(bus, t, o) {
      if (!this.ctx || !bus) return;
      const src = this.ctx.createBufferSource();
      src.buffer = o.buf === 'brown' ? this.brown : this.white;
      src.loop = true;
      if (o.rate) src.playbackRate.value = o.rate;
      let node = src;
      if (o.filter) node = this._filter(node, t, o.filter, o.dur);
      if (o.filter2) node = this._filter(node, t, o.filter2, o.dur);
      const g = this.ctx.createGain();
      this._env(g.gain, t, o);
      node.connect(g);
      this._out(bus, g, o, t);
      src.start(t, Math.random() * (src.buffer.duration - 0.2));
      src.stop(t + o.dur);
    }

    tone(bus, t, o) {
      if (!this.ctx || !bus) return;
      const osc = this.ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.dur));
      if (o.detune) osc.detune.value = o.detune;
      if (o.vib) {
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = o.vib.rate;
        const lg = this.ctx.createGain();
        lg.gain.value = o.vib.depth;
        lfo.connect(lg);
        lg.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + o.dur);
      }
      let node = osc;
      if (o.filter) node = this._filter(node, t, o.filter, o.dur);
      const g = this.ctx.createGain();
      this._env(g.gain, t, o);
      if (o.trem) {
        // tremolo: um segundo ganho modulado por LFO
        const tg = this.ctx.createGain();
        tg.gain.value = 1 - o.trem.depth;
        const lfo = this.ctx.createOscillator();
        lfo.frequency.setValueAtTime(o.trem.rate, t);
        if (o.trem.rate1) lfo.frequency.linearRampToValueAtTime(o.trem.rate1, t + o.dur);
        const lg = this.ctx.createGain();
        lg.gain.value = o.trem.depth;
        lfo.connect(lg);
        lg.connect(tg.gain);
        lfo.start(t);
        lfo.stop(t + o.dur);
        node.connect(tg);
        tg.connect(g);
      } else {
        node.connect(g);
      }
      this._out(bus, g, o, t);
      osc.start(t);
      osc.stop(t + o.dur);
    }

    /** Síntese FM: bom para "zaps" elétricos. */
    fm(bus, t, o) {
      if (!this.ctx || !bus) return;
      const car = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      car.frequency.setValueAtTime(o.f0, t);
      mod.frequency.setValueAtTime(o.f0 * o.ratio, t);
      if (o.f1) {
        car.frequency.exponentialRampToValueAtTime(o.f1, t + o.glide);
        mod.frequency.exponentialRampToValueAtTime(o.f1 * o.ratio, t + o.glide);
      }
      const mg = this.ctx.createGain();
      mg.gain.setValueAtTime(o.index0, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(1, o.index1), t + o.dur * 0.8);
      mod.connect(mg);
      mg.connect(car.frequency);
      const g = this.ctx.createGain();
      this._env(g.gain, t, o);
      car.connect(g);
      this._out(bus, g, o, t);
      car.start(t); mod.start(t);
      car.stop(t + o.dur); mod.stop(t + o.dur);
    }

    // ---------- sons compostos ----------

    /** "Bip" de líder de filme: 1 kHz curto. */
    leaderBeep(bus, t) {
      this.tone(bus, t, { f0: 1000, dur: 0.2, gain: 0.2, attack: 0.003, hold: 0.08, tau: 0.02, wet: 0.12 });
      this.tone(bus, t, { f0: 2000, dur: 0.16, gain: 0.035, attack: 0.003, hold: 0.06, tau: 0.02, wet: 0 });
    }

    /** Explosão de cinema: estalo, corpo filtrado, grave, estrondo estéreo e estalidos. */
    boom(bus, t, p = {}) {
      const P = p.power ?? 1;
      const br = p.bright ?? 1;
      const L = p.length ?? 1;
      const r = p.rng || Math.random;
      this.noise(bus, t, { dur: 0.25, gain: 0.5 * P, attack: 0.001, tau: 0.03, filter: { type: 'highpass', f0: 700 * br }, wet: 0.35 });
      this.noise(bus, t, { dur: 3.8 * L, gain: 0.75 * P, attack: 0.003, hold: 0.04, tau: 0.5 * L, filter: { type: 'lowpass', f0: 3200 * br, f1: 110, glide: 1.4 * L, q: 0.5 }, wet: 0.55 });
      this.tone(bus, t, { f0: 105, f1: 33, glide: 0.6, dur: 2.4 * L, gain: 0.9 * P, attack: 0.002, hold: 0.05, tau: 0.4 * L, wet: 0.1 });
      this.tone(bus, t, { type: 'triangle', f0: 190, f1: 52, glide: 0.25, dur: 0.7, gain: 0.3 * P, attack: 0.001, tau: 0.08, wet: 0.2 });
      for (const pan of [-0.55, 0.55]) {
        this.noise(bus, t + 0.04, { buf: 'brown', dur: 7.5 * L, gain: 0.5 * P, attack: 0.25, hold: 0.35, tau: 1.5 * L, filter: { type: 'lowpass', f0: 280, f1: 90, glide: 5 * L, q: 0.4 }, pan, wet: 0.5 });
      }
      const n = Math.round(22 * (p.crackle ?? 1));
      for (let i = 0; i < n; i++) {
        const tt = t + 0.2 + Math.pow(r(), 1.8) * 3.8 * L;
        this.noise(bus, tt, {
          dur: 0.07, gain: 0.04 + r() * 0.1, attack: 0.001, tau: 0.01 + r() * 0.015,
          filter: { type: 'bandpass', f0: 1200 + r() * 4000, q: 1.4 }, pan: r() * 1.4 - 0.7, wet: 0.35,
        });
      }
    }

    rattle(bus, t, dur, count, r = Math.random) {
      for (let i = 0; i < count; i++) {
        const tt = t + Math.pow(r(), 1.4) * dur;
        this.noise(bus, tt, {
          dur: 0.09, gain: 0.035 + r() * 0.09, attack: 0.001, tau: 0.018,
          filter: { type: 'bandpass', f0: 220 + r() * 900, q: 2 }, pan: r() * 1.6 - 0.8, wet: 0.3,
        });
      }
    }

    meteorIncoming(bus, t0, t1) {
      const d = t1 - t0;
      this.noise(bus, t0, { dur: d + 0.03, env: [[0, 0.0001], [d * 0.55, 0.08], [d * 0.97, 0.42], [d + 0.02, 0.0001]], filter: { type: 'bandpass', f0: 280, f1: 1700, glide: d, q: 0.8 }, pan: -0.75, panTo: 0, panTime: d, wet: 0.3 });
      this.noise(bus, t0, { buf: 'brown', dur: d + 0.03, env: [[0, 0.0001], [d * 0.97, 0.6], [d + 0.02, 0.0001]], filter: { type: 'lowpass', f0: 180, f1: 800, glide: d }, pan: -0.5, panTo: 0, panTime: d, wet: 0.2 });
      this.tone(bus, t0, { f0: 2200, f1: 360, glide: d, dur: d + 0.03, env: [[0, 0.0001], [d * 0.3, 0.035], [d * 0.95, 0.1], [d + 0.02, 0.0001]], vib: { rate: 9, depth: 22 }, pan: -0.7, panTo: 0, panTime: d, wet: 0.35 });
    }

    plasmaCharge(bus, t0, t1) {
      const d = t1 - t0;
      this.tone(bus, t0, { type: 'sawtooth', f0: 90, f1: 760, glide: d, dur: d + 0.02, env: [[0, 0.0001], [d * 0.92, 0.16], [d + 0.01, 0.0001]], filter: { type: 'lowpass', f0: 300, f1: 5200, glide: d, q: 7 }, trem: { rate: 12, rate1: 38, depth: 0.55 }, wet: 0.3 });
      this.tone(bus, t0, { type: 'sawtooth', f0: 91.5, f1: 772, glide: d, dur: d + 0.02, env: [[0, 0.0001], [d * 0.92, 0.1], [d + 0.01, 0.0001]], filter: { type: 'lowpass', f0: 300, f1: 4200, glide: d, q: 4 }, pan: 0.4, wet: 0.3 });
      this.tone(bus, t0, { f0: 700, f1: 3400, glide: d, dur: d + 0.02, env: [[0, 0.0001], [d * 0.9, 0.05], [d + 0.01, 0.0001]], wet: 0.4 });
    }

    plasmaBurst(bus, t, r = Math.random) {
      this.fm(bus, t, { f0: 230, f1: 52, glide: 0.8, ratio: 7.1, index0: 2600, index1: 5, dur: 1.3, gain: 0.45, attack: 0.002, tau: 0.25, wet: 0.5 });
      this.fm(bus, t + 0.32, { f0: 200, f1: 60, glide: 0.6, ratio: 7.1, index0: 1500, index1: 5, dur: 0.9, gain: 0.14, attack: 0.002, tau: 0.18, pan: -0.5, wet: 0.7 });
      this.fm(bus, t + 0.64, { f0: 190, f1: 60, glide: 0.5, ratio: 7.1, index0: 1000, index1: 5, dur: 0.8, gain: 0.06, attack: 0.002, tau: 0.15, pan: 0.5, wet: 0.8 });
      this.noise(bus, t, { dur: 0.3, gain: 0.45, attack: 0.001, tau: 0.04, filter: { type: 'highpass', f0: 2500 }, wet: 0.4 });
      this.tone(bus, t, { f0: 150, f1: 36, glide: 0.9, dur: 2.6, gain: 0.95, attack: 0.002, hold: 0.1, tau: 0.5, wet: 0.15 });
      for (let i = 0; i < 34; i++) {
        const tt = t + Math.pow(r(), 1.5) * 2.4;
        this.noise(bus, tt, { dur: 0.04, gain: 0.05 + r() * 0.15, attack: 0.001, tau: 0.006 + r() * 0.012, filter: { type: 'bandpass', f0: 2500 + r() * 5000, q: 3 }, pan: r() * 1.6 - 0.8, wet: 0.4 });
        if (r() < 0.3) this.tone(bus, tt, { type: 'square', f0: 1200 + r() * 1800, dur: 0.04, gain: 0.02, attack: 0.001, tau: 0.008, pan: r() * 1.6 - 0.8, wet: 0.3 });
      }
      for (const [f, pan] of [[55, -0.3], [55.8, 0.3]]) {
        this.tone(bus, t + 0.1, { type: 'sawtooth', f0: f, dur: 5, gain: 0.1, attack: 0.3, hold: 0.8, tau: 1.3, filter: { type: 'lowpass', f0: 420, q: 2 }, trem: { rate: 7, depth: 0.4 }, pan, wet: 0.4 });
      }
    }

    novaSwell(bus, t0, t1) {
      const d = t1 - t0;
      this.noise(bus, t0, { dur: d + 0.02, env: [[0, 0.0001], [d * 0.7, 0.05], [d * 0.97, 0.3], [d + 0.01, 0.0001]], filter: { type: 'highpass', f0: 2500, f1: 6000, glide: d }, wet: 0.5 });
      for (const f of [110, 164.8, 220]) {
        this.tone(bus, t0, { f0: f * 0.97, f1: f, glide: d, dur: d + 0.02, env: [[0, 0.0001], [d * 0.95, 0.07], [d + 0.01, 0.0001]], wet: 0.6 });
      }
      this.noise(bus, t0, { buf: 'brown', dur: d + 0.02, env: [[0, 0.0001], [d * 0.95, 0.35], [d + 0.01, 0.0001]], filter: { type: 'lowpass', f0: 90, f1: 200, glide: d }, wet: 0.2 });
    }

    novaBurst(bus, t, r = Math.random) {
      this.boom(bus, t, { power: 1.05, bright: 0.8, length: 1.4, crackle: 0.3, rng: r });
      this.noise(bus, t + 0.1, { dur: 8, gain: 0.07, attack: 1.2, hold: 1.5, tau: 2, filter: { type: 'bandpass', f0: 5200, f1: 9000, glide: 6, q: 2 }, wet: 0.8 });
      const chord = [220, 261.63, 329.63, 440, 493.88];
      chord.forEach((f, i) => {
        this.tone(bus, t + 0.15 + i * 0.12, { type: i % 2 ? 'sine' : 'triangle', f0: f, dur: 9, gain: 0.045, attack: 1.3, hold: 2.2, tau: 2.2, vib: { rate: 4 + i, depth: 1.5 }, pan: (i - 2) * 0.3, wet: 0.9 });
      });
      const notes = [1760, 1975.5, 2217.5, 2637, 2960, 3520];
      for (let i = 0; i < 14; i++) {
        this.tone(bus, t + 0.6 + r() * 5, { type: 'triangle', f0: notes[Math.floor(r() * notes.length)], dur: 1.2, gain: 0.018 + r() * 0.02, attack: 0.004, tau: 0.25, pan: r() * 1.6 - 0.8, wet: 0.85 });
      }
    }

    fwLaunch(bus, t, rise, pan) {
      this.tone(bus, t, { f0: 620, f1: 2500, glide: rise, dur: rise, env: [[0, 0.0001], [0.08, 0.05], [rise * 0.85, 0.04], [rise, 0.0001]], vib: { rate: 16, depth: 55 }, pan, wet: 0.35 });
      this.noise(bus, t, { dur: rise, env: [[0, 0.0001], [0.06, 0.04], [rise, 0.0001]], filter: { type: 'highpass', f0: 3200 }, pan, wet: 0.2 });
    }

    fwBurst(bus, t, pan, big, crackle, r = Math.random) {
      this.noise(bus, t, { dur: 0.9, gain: 0.5 * big, attack: 0.001, tau: 0.09, filter: { type: 'lowpass', f0: 4400, f1: 280, glide: 0.5 }, pan, wet: 0.6 });
      this.tone(bus, t, { f0: 135, f1: 42, glide: 0.35, dur: 1, gain: 0.55 * big, attack: 0.001, tau: 0.16, pan: pan * 0.5, wet: 0.2 });
      if (crackle) {
        for (let i = 0; i < 34; i++) {
          const tt = t + 0.35 + r() * 1.6;
          this.noise(bus, tt, { dur: 0.025, gain: 0.03 + r() * 0.07, attack: 0.001, tau: 0.004, filter: { type: 'highpass', f0: 2200 }, pan: Math.max(-1, Math.min(1, pan + (r() - 0.5) * 0.7)), wet: 0.4 });
        }
      }
    }

    // ---------- interface ----------

    uiBlip(kind) {
      if (!this.running()) return;
      const t = this.ctx.currentTime + 0.01;
      const b = this.uiBus;
      if (kind === 'point') {
        this.tone(b, t, { f0: 520, f1: 980, glide: 0.09, dur: 0.22, gain: 0.07, attack: 0.004, tau: 0.05, wet: 0.2 });
      } else if (kind === 'select') {
        this.tone(b, t, { type: 'triangle', f0: 1320, dur: 0.1, gain: 0.04, attack: 0.002, tau: 0.02, wet: 0.1 });
      } else if (kind === 'error') {
        this.tone(b, t, { type: 'triangle', f0: 240, f1: 180, glide: 0.12, dur: 0.2, gain: 0.07, attack: 0.004, tau: 0.05, wet: 0.1 });
      }
    }
  }

  B.SoundEngine = SoundEngine;
})();
