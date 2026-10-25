/* Utilidades compartilhadas: aleatoriedade com semente, curvas, molas e formatação. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const easeOutCubic = (t) => { t = clamp01(t); return 1 - Math.pow(1 - t, 3); };
  const easeOutQuart = (t) => { t = clamp01(t); return 1 - Math.pow(1 - t, 4); };
  const easeInCubic = (t) => { t = clamp01(t); return t * t * t; };
  const easeInOut = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  /** Envelope de ataque/queda: sobe linear até `a`, decai exponencial com constante `d`. */
  const envelope = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));

  /** Interpola chaves [[t, v], ...] com suavização entre elas. */
  function keys(list, t) {
    if (t <= list[0][0]) return list[0][1];
    for (let i = 1; i < list.length; i++) {
      const k1 = list[i];
      if (t <= k1[0]) {
        const k0 = list[i - 1];
        return lerp(k0[1], k1[1], smooth((t - k0[0]) / (k1[0] - k0[0])));
      }
    }
    return list[list.length - 1][1];
  }

  /** Ruído 1D suave e determinístico (para cintilação de luzes). */
  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const h = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const u = f * f * (3 - 2 * f);
    return lerp(h(i), h(i + 1), u) * 2 - 1;
  }

  /** Gerador mulberry32 com helpers geométricos. Mesma semente = mesma tomada. */
  function rng(seed) {
    let a = seed >>> 0;
    const r = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    /** direção uniforme na esfera -> out {x,y,z} */
    r.sphere = (out) => {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      out.x = s * Math.cos(th); out.y = u; out.z = s * Math.sin(th);
      return out;
    };
    /** direção com elevação entre e0 e e1 (radianos) */
    r.hemi = (out, e0, e1) => {
      const el = lerp(e0, e1, r());
      const th = r() * Math.PI * 2;
      out.x = Math.cos(el) * Math.cos(th); out.y = Math.sin(el); out.z = Math.cos(el) * Math.sin(th);
      return out;
    };
    /** ponto uniforme num disco de raio rad (plano XZ) */
    r.disk = (out, rad) => {
      const rr = Math.sqrt(r()) * rad;
      const th = r() * Math.PI * 2;
      out.x = rr * Math.cos(th); out.z = rr * Math.sin(th);
      return out;
    };
    return r;
  }

  /** Mola física (rigidez 300, amortecimento 30, massa 1 por padrão): acompanha a velocidade e passa um pouco do alvo antes de assentar. */
  class Spring {
    constructor(value = 0, opts = {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.k = opts.stiffness ?? 300;
      this.c = opts.damping ?? 30;
      this.m = opts.mass ?? 1;
      this.onUpdate = opts.onUpdate || null;
      this.rest = true;
    }
    set(target, velocity) {
      this.target = target;
      if (velocity !== undefined) this.velocity = velocity;
      this.rest = false;
      Spring.active.add(this);
    }
    jump(value) {
      this.value = this.target = value;
      this.velocity = 0;
      this.rest = true;
      Spring.active.delete(this);
      if (this.onUpdate) this.onUpdate(this.value);
    }
    step(dt) {
      const steps = 4;
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const f = -this.k * (this.value - this.target) - this.c * this.velocity;
        this.velocity += (f / this.m) * h;
        this.value += this.velocity * h;
      }
      if (Math.abs(this.velocity) < 0.001 && Math.abs(this.value - this.target) < 0.0005) {
        this.value = this.target;
        this.velocity = 0;
        this.rest = true;
      }
      if (this.onUpdate) this.onUpdate(this.value);
      return this.rest;
    }
    static tick(dt) {
      for (const s of Spring.active) if (s.step(Math.min(dt, 1 / 30))) Spring.active.delete(s);
    }
  }
  Spring.active = new Set();

  const store = {
    key: 'brasil-fx:v1',
    read() {
      try { return JSON.parse(localStorage.getItem(this.key) || '{}') || {}; } catch (e) { return {}; }
    },
    write(obj) {
      try { localStorage.setItem(this.key, JSON.stringify(obj)); } catch (e) { /* armazenamento indisponível: segue sem lembrar */ }
    },
  };

  /** 15.793 -> "15,79° S" */
  function fmtLat(lat) { return Math.abs(lat).toFixed(2).replace('.', ',') + '° ' + (lat < 0 ? 'S' : 'N'); }
  function fmtLon(lon) { return Math.abs(lon).toFixed(2).replace('.', ',') + '° ' + (lon < 0 ? 'O' : 'L'); }

  /** timecode SS:FF a 24 quadros por segundo, com sinal para a contagem */
  function timecode(t) {
    const neg = t < 0;
    const a = Math.abs(t);
    const m = Math.floor(a / 60);
    const s = Math.floor(a % 60);
    const f = Math.floor((a % 1) * 24);
    const p = (n) => String(n).padStart(2, '0');
    return (neg ? '-' : '') + p(m) + ':' + p(s) + ':' + p(f);
  }

  B.util = {
    clamp, clamp01, lerp, smooth, easeOutCubic, easeOutQuart, easeInCubic, easeInOut,
    envelope, keys, noise1, rng, Spring, store, fmtLat, fmtLon, timecode,
  };
})();
