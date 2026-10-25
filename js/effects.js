/* Os cinco efeitos visuais. Todos são ficção artística: tamanhos, cores, tempos e sons
   foram escolhidos para ficar bonitos na tela e não representam nenhum fenômeno real.
   Cada efeito recebe um contexto (ponto, texturas, palco de luzes, câmera, áudio)
   e devolve { duration, sound(tDetonacao), update(t), dispose() },
   onde t é o tempo em segundos desde a detonação (negativo durante a contagem). */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE) return;
  const THREE = window.THREE;
  const U = B.util;
  const P = B.parts;
  const { clamp01, smooth, easeOutCubic, easeOutQuart, envelope, keys, noise1 } = U;

  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  /** cor sRGB -> linear, multiplicada por k (HDR) */
  const C = (hex, k = 1) => {
    const c = new THREE.Color(hex);
    return V(c.r * k, c.g * k, c.b * k);
  };

  function colorKeys(out, list, t) {
    if (t <= list[0][0]) return out.copy(list[0][1]);
    for (let i = 1; i < list.length; i++) {
      if (t <= list[i][0]) {
        const k0 = list[i - 1];
        return out.copy(k0[1]).lerp(list[i][1], smooth((t - k0[0]) / (list[i][0] - k0[0])));
      }
    }
    return out.copy(list[list.length - 1][1]);
  }

  /** Uma tomada: agrupa as peças e cuida do descarte. */
  class Take {
    constructor(ctx) {
      this.ctx = ctx;
      this.parts = [];
      this.systems = [];
      this.frame = { flash: 0, flashColor: V(1, 0.9, 0.8), flashPos: V(), shake: 0, dim: 1 };
    }
    add(part) {
      this.parts.push(part);
      this.ctx.root.add(part.mesh);
      return part;
    }
    particles(o) {
      const c = this.ctx;
      o.origin = o.origin || c.origin;
      o.rng = c.r;
      if (!o.exact) o.count = Math.max(1, Math.round(o.count * c.q));
      const p = new B.Particles(o);
      this.add(p);
      this.systems.push(p);
      return p;
    }
    tick(t) {
      for (const s of this.systems) s.update(t);
    }
    dispose() {
      for (const p of this.parts) p.dispose();
      this.parts.length = 0;
      this.systems.length = 0;
    }
  }

  /** Branco em intensidade k (para rampas); ONE é constante para uso por quadro */
  const WHITE = (k) => C('#ffffff', k);
  const ONE = V(1, 1, 1);

  // =====================================================================
  // FX-01 · Bola de fogo
  // =====================================================================
  function buildFireball(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const d = V();

    const smoke = T.particles({
      count: 110, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#5a3a26', 1.0), C('#2d2622', 0.5), C('#201e1d', 0.42), C('#1c1c1d', 0.4), C('#18191b', 0.38)],
      stops: [0.12, 0.4, 0.75], alpha: [0.08, 0.55, 0.74, 0], occ: [0.0, 0.08, 1.0],
      sizeEase: 1.6, turb: [0.7, 0.55], lit: 0.45, ground: [O.y, 0.45],
      spawn(i, p) {
        r.disk(d, 0.7);
        p.x = O.x + d.x; p.y = O.y + 0.3 + r() * 0.6; p.z = O.z + d.z;
        p.vx = d.x * 0.9 + r.range(-0.3, 0.3); p.vy = r.range(1.3, 3.0); p.vz = d.z * 0.9 + r.range(-0.3, 0.3);
        p.drag = 0.55; p.ay = 0.35; p.delay = 0.12 + Math.pow(r(), 1.4) * 2.4; p.life = r.range(4.5, 7.5);
        p.s0 = r.range(0.7, 1.1); p.s1 = r.range(2.8, 4.4); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });
    const dust = T.particles({
      count: 64, texture: tex.puff, atlas: true, order: 2,
      colors: [C('#9a7a5c', 1.1), C('#5d4d3e', 0.75), C('#3a342e', 0.55), C('#2c2a28', 0.45), C('#232323', 0.4)],
      stops: [0.1, 0.35, 0.7], alpha: [0.05, 0.4, 0.28, 0], occ: [0.0, 0.1, 0.85],
      sizeEase: 2, turb: [0.3, 0.8], lit: 0.8, ground: [O.y, 0.25],
      spawn(i, p, n) {
        const a = (i / n) * Math.PI * 2 + r() * 0.2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        const sp = r.range(6, 9.5);
        p.x = O.x + cx * 0.5; p.y = O.y + 0.12; p.z = O.z + cz * 0.5;
        p.vx = cx * sp; p.vy = r.range(0.2, 0.8); p.vz = cz * sp;
        p.drag = 1.7; p.ay = 0.25; p.delay = 0.03 + r() * 0.08; p.life = r.range(1.8, 3.4);
        p.s0 = r.range(0.4, 0.6); p.s1 = r.range(1.6, 2.4); p.rot = r() * 6.28; p.spin = r.range(-0.5, 0.5);
      },
    });
    const fire = T.particles({
      count: 84, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#fff2d6', 7), C('#ffb14a', 3.2), C('#ff5a1a', 1.4), C('#2a1d17', 0.9), C('#161413', 0.8)],
      stops: [0.1, 0.28, 0.55], alpha: [0.03, 0.55, 0.95, 0], occ: [0.1, 0.4, 0.95],
      sizeEase: 2.2, turb: [0.25, 1.4], lit: 0.5, ground: [O.y, 0.35],
      spawn(i, p) {
        r.hemi(d, 0.05, 1.45);
        const sp = r.range(2.2, 6.5);
        p.x = O.x + d.x * 0.25; p.y = O.y + 0.15 + d.y * 0.25; p.z = O.z + d.z * 0.25;
        p.vx = d.x * sp; p.vy = d.y * sp + 1.2; p.vz = d.z * sp;
        p.drag = 2.8; p.ay = 1.4; p.delay = r() * 0.12; p.life = r.range(1.7, 3.2);
        p.s0 = r.range(0.35, 0.7); p.s1 = r.range(1.7, 2.7); p.rot = r() * 6.28; p.spin = r.range(-0.7, 0.7);
      },
    });
    const embers = T.particles({
      count: 180, texture: tex.glow, order: 5,
      colors: [C('#ffd08a', 9), C('#ff9a3c', 7), C('#ff5a1e', 4), C('#c02a0a', 2), C('#400a00', 0.5)],
      stops: [0.2, 0.5, 0.8], alpha: [0.1, 0.6, 1, 0.65],
      sizeEase: 1, turb: [0.6, 2.4], ground: [O.y, 0.1],
      spawn(i, p) {
        r.sphere(d);
        p.x = O.x + d.x * 1.3; p.y = O.y + 0.4 + Math.abs(d.y) * 1.5; p.z = O.z + d.z * 1.3;
        p.vx = d.x * 0.8; p.vy = r.range(0.5, 2.2); p.vz = d.z * 0.8;
        p.drag = 0.8; p.ay = 0.25; p.delay = 0.25 + r() * 2.6; p.life = r.range(2.2, 4.8);
        p.s0 = r.range(0.05, 0.09); p.s1 = 0.02;
      },
    });
    const sparks = T.particles({
      count: 340, texture: tex.spark, streak: true, stretch: 0.07, order: 6,
      colors: [C('#fff4dc', 6), C('#ffc060', 4), C('#ff7020', 2.2), C('#b02a08', 0.9), C('#300800', 0.15)],
      stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.7, 1, 0],
      sizeEase: 1, ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        r.hemi(d, 0.18, 1.5);
        const sp = r.range(5, 13.5);
        p.x = O.x; p.y = O.y + 0.2; p.z = O.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 0.9; p.ay = -9; p.delay = r() * 0.1; p.life = r.range(0.9, 2.2);
        p.s0 = p.s1 = r.range(0.022, 0.045);
      },
    });

    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const dome = T.add(new P.Dome({ tex: tex.noise, colorA: C('#fff0dc', 1.3), colorB: C('#ff9a4a', 0.7), noise: 0.35, core: 0.02, power: 4 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));

    const center = V(O.x, O.y + 0.6, O.z);
    const lpos = V();
    const lcol = V();
    const litc = V();
    const LCOL = [[0, C('#fff6e8')], [0.25, C('#ffc27a')], [1.2, C('#ff8a3a')], [4, C('#ff5a1c')], [7, C('#b3300c')]];
    const LI = [[0, 0], [0.05, 30], [0.3, 16], [0.8, 10], [2.5, 6], [5.5, 2], [8, 0]];
    const WAVE = C('#ffb676');
    const HEAT = C('#ff5a14');
    const FLASHC = C('#fff0d8');
    const STREAKC = C('#ffd3a0');

    return {
      duration: 9.5,
      sound(tDet) {
        ctx.audio.boom(ctx.bus, tDet, { power: 1, bright: 1, rng: r });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) {
          flash.hide(); streak.hide(); dome.hide(); if (flare) flare.hide();
          return f;
        }
        const flick = 1 + 0.32 * noise1(t * 11) * smooth((t - 0.35) / 0.6) * (reduced ? 0.3 : 1);
        const I = keys(LI, t) * flick;
        colorKeys(lcol, LCOL, t);
        lpos.set(O.x, O.y + 1.0 + Math.min(t, 3) * 0.45, O.z);
        stage.light(0, lpos, lcol, I, 6);
        litc.copy(lcol).multiplyScalar(I * 0.06);
        fire.light(lpos, litc); smoke.light(lpos, litc); dust.light(lpos, litc);

        const fl = envelope(t, 0.045, 0.14);
        const fs = 2.5 + 7.5 * easeOutCubic(t / 0.3);
        flash.set(center, fs, fs, 9 * fl, FLASHC);
        streak.set(center, 16 * (0.6 + 0.4 * easeOutCubic(t / 0.3)), 0.3, 3 * envelope(t, 0.05, 0.3), STREAKC);
        const dt01 = clamp01(t / 0.75);
        dome.set(O, 5.0 * easeOutCubic(dt01), 0.5 * Math.pow(1 - dt01, 2), t);
        const wt = clamp01(t / 2.4);
        stage.wave(0, O.x, O.z, 10.5 * easeOutCubic(wt), 2.4 * Math.pow(1 - wt, 1.5), 0.22 + 0.7 * wt, WAVE);
        stage.setHeat(O.x, O.z, 2.4 - 0.6 * clamp01(t / 5), 2.8 * envelope(t, 0.15, 2.4), HEAT);
        if (flare) flare.set(center, 1.3 * envelope(t, 0.04, 0.35));

        f.flash = (reduced ? 0.22 : 0.8) * envelope(t, 0.035, 0.12);
        f.flashColor.copy(FLASHC);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : Math.exp(-t * 2.6) * smooth(t / 0.03) + 0.35 * envelope(t - 0.35, 0.05, 0.25);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-02 · Meteoro
  // =====================================================================
  function buildMeteor(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const PRE = 1.9;
    const DIST = 44;
    const d = V();
    const right = V().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const fwd = V();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const D = V().addScaledVector(right, -0.85).addScaledVector(fwd, 0.35).add(V(0, 0.95, 0)).normalize();
    const headAt = (s, out) => out.copy(O).addScaledVector(D, DIST * (1 - s));
    const hp = V();

    const trail = T.particles({
      count: 170, texture: tex.puff, atlas: true, order: 4, t0: -PRE,
      colors: [C('#fff4e0', 5), C('#ffb35a', 2.8), C('#e0501a', 1.2), C('#2a2320', 0.7), C('#1c1b1c', 0.5)],
      stops: [0.1, 0.3, 0.6], alpha: [0.05, 0.45, 0.8, 0], occ: [0.3, 0.7, 0.85],
      sizeEase: 1.8, turb: [0.3, 1.5], ground: [O.y, 0.3],
      spawn(i, p, n) {
        const s = Math.pow(i / n, 0.85);
        headAt(s, hp);
        p.x = hp.x + r.range(-0.12, 0.12); p.y = hp.y + r.range(-0.12, 0.12); p.z = hp.z + r.range(-0.12, 0.12);
        p.vx = D.x * 1.6 + r.range(-0.4, 0.4); p.vy = D.y * 1.6 + r.range(-0.2, 0.5); p.vz = D.z * 1.6 + r.range(-0.4, 0.4);
        p.drag = 1.2; p.ay = 0.5; p.delay = s * PRE; p.life = r.range(0.8, 1.6);
        const k = 0.6 + s * 0.6;
        p.s0 = r.range(0.2, 0.35) * k; p.s1 = r.range(1.0, 1.6) * k; p.rot = r() * 6.28; p.spin = r.range(-1, 1);
      },
    });
    const trailSparks = T.particles({
      count: 90, texture: tex.spark, streak: true, stretch: 0.06, order: 6, t0: -PRE,
      colors: [C('#fff8e8', 6), C('#ffd08a', 4), C('#ff8030', 2), C('#a0300a', 0.8), C('#200500', 0.1)],
      stops: [0.2, 0.45, 0.8], alpha: [0.02, 0.6, 1, 0],
      spawn(i, p, n) {
        const s = i / n;
        headAt(s, hp);
        r.sphere(d);
        p.x = hp.x; p.y = hp.y; p.z = hp.z;
        p.vx = D.x * 3 + d.x * 2.5; p.vy = D.y * 3 + d.y * 2.5; p.vz = D.z * 3 + d.z * 2.5;
        p.drag = 1.5; p.ay = -4; p.delay = s * PRE; p.life = r.range(0.3, 0.8);
        p.s0 = p.s1 = r.range(0.02, 0.04);
      },
    });

    const dustWall = T.particles({
      count: 110, texture: tex.puff, atlas: true, order: 2,
      colors: [C('#b08a62', 1.4), C('#6b5642', 0.8), C('#3d342c', 0.55), C('#2c2926', 0.45), C('#232222', 0.4)],
      stops: [0.1, 0.35, 0.7], alpha: [0.05, 0.45, 0.5, 0], occ: [0.0, 0.1, 0.92],
      sizeEase: 2, turb: [0.45, 0.7], lit: 0.7, ground: [O.y, 0.3],
      spawn(i, p, n) {
        const a = (i / n) * Math.PI * 2 + r() * 0.3;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        const sp = r.range(5, 10);
        p.x = O.x + cx * 0.6; p.y = O.y + 0.15; p.z = O.z + cz * 0.6;
        p.vx = cx * sp; p.vy = r.range(0.4, 1.6); p.vz = cz * sp;
        p.drag = 1.1; p.ay = 0.35; p.delay = 0.05 + r() * 0.25; p.life = r.range(3, 6);
        p.s0 = r.range(0.6, 0.9); p.s1 = r.range(2.8, 3.8); p.rot = r() * 6.28; p.spin = r.range(-0.4, 0.4);
      },
    });
    const dustCol = T.particles({
      count: 90, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#c47a40', 1.6), C('#5b4838', 0.7), C('#3a322c', 0.5), C('#2b2826', 0.45), C('#222222', 0.4)],
      stops: [0.1, 0.35, 0.7], alpha: [0.06, 0.5, 0.55, 0], occ: [0.0, 0.1, 0.95],
      sizeEase: 1.7, turb: [0.6, 0.55], lit: 1.1, ground: [O.y, 0.4],
      spawn(i, p) {
        r.disk(d, 0.9);
        p.x = O.x + d.x; p.y = O.y + 0.3; p.z = O.z + d.z;
        p.vx = d.x * 1.2; p.vy = r.range(1.5, 4.2); p.vz = d.z * 1.2;
        p.drag = 0.7; p.ay = 0.2; p.delay = 0.05 + Math.pow(r(), 1.5) * 1.6; p.life = r.range(5, 8);
        p.s0 = r.range(0.8, 1.2); p.s1 = r.range(3.2, 4.6); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });
    const rocks = T.particles({
      count: 70, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#ff9a4a', 2), C('#5a2a14', 0.6), C('#1a1512', 0.35), C('#141210', 0.3), C('#121110', 0.3)],
      stops: [0.08, 0.3, 0.7], alpha: [0.02, 0.8, 1, 0], occ: [0.0, 0.05, 0.95],
      sizeEase: 1, lit: 0.6, ground: [O.y - 0.05, 0.08],
      spawn(i, p) {
        r.hemi(d, 0.6, 1.4);
        const sp = r.range(5, 10);
        p.x = O.x; p.y = O.y + 0.3; p.z = O.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 0.45; p.ay = -10; p.delay = r() * 0.1; p.life = r.range(1.5, 3.0);
        p.s0 = r.range(0.1, 0.24); p.s1 = p.s0 * 0.9; p.rot = r() * 6.28; p.spin = r.range(-6, 6);
      },
    });
    const ejecta = T.particles({
      count: 380, texture: tex.spark, streak: true, stretch: 0.075, order: 6,
      colors: [C('#fffaf0', 6), C('#ffc870', 4), C('#ff6a1e', 2.2), C('#9a2406', 0.9), C('#250600', 0.15)],
      stops: [0.12, 0.4, 0.78], alpha: [0.01, 0.7, 1, 0],
      ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        r.hemi(d, 0.5, 1.45);
        const sp = r.range(7, 16);
        p.x = O.x; p.y = O.y + 0.2; p.z = O.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 0.55; p.ay = -11; p.delay = r() * 0.12; p.life = r.range(1.4, 3.0);
        p.s0 = p.s1 = r.range(0.025, 0.05);
      },
    });

    const head = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const halo = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const tail = T.add(new P.Glow({ tex: tex.glow, order: 11 }));
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const dome = T.add(new P.Dome({ tex: tex.noise, colorA: C('#eef6ff', 1.4), colorB: C('#9cc8ff', 0.7), noise: 0.4, core: 0.02, power: 4 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));

    const center = V(O.x, O.y + 0.5, O.z);
    const lcol = V();
    const litc = V();
    const lpos = V();
    const a2 = V();
    const b2 = V();
    const tailC = V();
    const HEADC = C('#eaf6ff');
    const HALOC = C('#ffb060');
    const FLASHC = C('#e8f3ff');
    const WAVE1 = C('#dfeeff');
    const WAVE2 = C('#d49a60');
    const HEAT = C('#ff5a14');
    const LCOL = [[0, C('#f2f8ff')], [0.3, C('#ffd6a0')], [1.5, C('#ff8a3a')], [5, C('#ff5418')], [9, C('#9a2808')]];
    const LI = [[0, 0], [0.05, 36], [0.5, 13], [2, 6], [5, 2.4], [9, 0]];

    return {
      duration: 10,
      sound(tDet) {
        ctx.audio.meteorIncoming(ctx.bus, tDet - PRE, tDet);
        ctx.audio.boom(ctx.bus, tDet, { power: 1.25, bright: 1.1, length: 1.15, rng: r });
        ctx.audio.rattle(ctx.bus, tDet + 0.5, 2.8, 30, r);
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < -PRE) return f;
        if (t < 0) {
          const s = (t + PRE) / PRE;
          headAt(s, hp);
          const grow = 0.4 + 0.6 * s;
          head.set(hp, 0.9 * grow, 0.9 * grow, 8 * (0.4 + 0.6 * s), HEADC);
          halo.set(hp, 2.6 * grow, 2.6 * grow, 3 * (0.3 + 0.7 * s), HALOC);
          // cauda: brilho alongado na direção do caminho, projetado na tela
          a2.copy(hp).project(camera);
          b2.copy(hp).addScaledVector(D, 1).project(camera);
          const ang = Math.atan2((b2.y - a2.y), (b2.x - a2.x) * camera.aspect);
          tailC.copy(hp).addScaledVector(D, 2.4 * grow);
          tail.set(tailC, 5.5 * grow, 0.55 * grow, 2.2, HALOC, ang);
          stage.light(0, hp, HALOC, 26 * Math.pow(s, 3), 6);
          return f;
        }
        head.hide(); halo.hide(); tail.hide();
        const flick = 1 + 0.25 * noise1(t * 9) * smooth((t - 0.5) / 0.6) * (reduced ? 0.3 : 1);
        const I = keys(LI, t) * flick;
        colorKeys(lcol, LCOL, t);
        lpos.set(O.x, O.y + 0.9 + Math.min(t, 3) * 0.3, O.z);
        stage.light(0, lpos, lcol, I, 6);
        litc.copy(lcol).multiplyScalar(I * 0.05);
        dustWall.light(lpos, litc); dustCol.light(lpos, litc); rocks.light(lpos, litc);

        const fl = envelope(t, 0.04, 0.16);
        const fs = 3 + 9 * easeOutCubic(t / 0.3);
        flash.set(center, fs, fs, 10 * fl, FLASHC);
        streak.set(center, 20 * (0.6 + 0.4 * easeOutCubic(t / 0.3)), 0.32, 3.5 * envelope(t, 0.05, 0.32), FLASHC);
        const dt01 = clamp01(t / 0.8);
        dome.set(O, 6.0 * easeOutCubic(dt01), 0.5 * Math.pow(1 - dt01, 2), t);
        const w1 = clamp01(t / 2.6);
        stage.wave(0, O.x, O.z, 13 * easeOutCubic(w1), 2.8 * Math.pow(1 - w1, 1.5), 0.2 + 0.7 * w1, WAVE1);
        const w2 = clamp01((t - 0.25) / 4.2);
        stage.wave(1, O.x, O.z, 8.5 * easeOutQuart(w2), 1.4 * Math.pow(1 - w2, 1.2) * smooth((t - 0.25) / 0.2), 0.8 + 1.2 * w2, WAVE2);
        stage.setHeat(O.x, O.z, 1.8, 3.4 * envelope(t, 0.1, 3.5), HEAT);
        if (flare) flare.set(center, 1.4 * envelope(t, 0.04, 0.4));

        f.flash = (reduced ? 0.25 : 0.85) * envelope(t, 0.03, 0.14);
        f.flashColor.copy(FLASHC);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : 1.45 * Math.exp(-t * 2.2) * smooth(t / 0.03) + 0.45 * envelope(t - 0.45, 0.05, 0.3);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-03 · Pulso de plasma
  // =====================================================================
  function buildPlasma(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const PRE = 1.3;
    const Cc = V(O.x, O.y + 1.3, O.z);
    const d = V();
    const CY = C('#38e0ff');
    const VI = C('#8a5cff');
    const MG = C('#ff4fe0');
    const ICE = C('#e6ffff');
    const baseSeed = Math.floor(r() * 1e9);

    const charge = T.particles({
      count: 220, texture: tex.glow, order: 6, t0: -PRE, origin: Cc,
      colors: [C('#8feaff', 2), C('#5fe6ff', 3.5), C('#bff8ff', 5), C('#ffffff', 6), C('#ffffff', 6)],
      stops: [0.3, 0.6, 0.85], alpha: [0.25, 0.97, 1, 0],
      swirl: 1.2,
      spawn(i, p) {
        r.sphere(d);
        const rad = r.range(3.2, 5);
        p.x = Cc.x + d.x * rad; p.y = Math.max(O.y + 0.2, Cc.y + d.y * rad); p.z = Cc.z + d.z * rad;
        const k = 2.6;
        p.drag = k;
        p.vx = (Cc.x - p.x) * k; p.vy = (Cc.y - p.y) * k; p.vz = (Cc.z - p.z) * k;
        p.delay = r() * 0.55; p.life = PRE - p.delay + 0.02;
        p.s0 = r.range(0.06, 0.1); p.s1 = 0.03;
      },
    });
    const burst = T.particles({
      count: 420, texture: tex.spark, streak: true, stretch: 0.05, order: 6, origin: Cc,
      colors: [C('#ffffff', 7), C('#9ff2ff', 5), C('#38d8ff', 3), C('#7a5cff', 1.6), C('#2a1060', 0.2)],
      stops: [0.1, 0.35, 0.7], alpha: [0.01, 0.65, 1, 0],
      swirl: 1.4,
      spawn(i, p) {
        r.sphere(d);
        d.y = d.y * 0.8 + 0.2;
        d.normalize();
        const sp = r.range(6, 14);
        p.x = Cc.x; p.y = Cc.y; p.z = Cc.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 2.3; p.ay = -0.8; p.delay = r() * 0.08; p.life = r.range(1.1, 2.3);
        p.s0 = p.s1 = r.range(0.02, 0.04);
      },
    });
    const motes = T.particles({
      count: 260, texture: tex.glow, order: 5, origin: Cc,
      colors: [WHITE(4), WHITE(3), WHITE(2), WHITE(1), WHITE(0.2)],
      stops: [0.2, 0.5, 0.8], alpha: [0.15, 0.6, 1, 0.85], colorMix: 1,
      turb: [0.35, 1.6], ground: [O.y, 0.1],
      spawn(i, p) {
        r.sphere(d);
        const rad = r.range(1.2, 4.2);
        p.x = Cc.x + d.x * rad; p.y = Math.max(O.y + 0.15, Cc.y + d.y * rad * 0.8); p.z = Cc.z + d.z * rad;
        p.vx = d.x * 0.4; p.vy = r.range(0.1, 0.7); p.vz = d.z * 0.4;
        p.drag = 0.6; p.ay = 0.1; p.delay = 0.1 + r() * 1.5; p.life = r.range(2, 4.5);
        p.s0 = r.range(0.05, 0.1); p.s1 = 0.02;
        const c = r() < 0.6 ? CY : r() < 0.5 ? MG : VI;
        p.r = c.x; p.g = c.y; p.b = c.z;
      },
    });
    const haze = T.particles({
      count: 36, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#7a5cff', 1.2), C('#6a4cff', 0.9), C('#4a2cc0', 0.6), C('#2a1470', 0.3), C('#100830', 0.1)],
      stops: [0.2, 0.5, 0.8], alpha: [0.1, 0.5, 0.2, 0],
      sizeEase: 1.5, turb: [0.4, 0.5], ground: [O.y, 0.4],
      spawn(i, p) {
        r.sphere(d);
        p.x = Cc.x + d.x * 0.6; p.y = Cc.y + d.y * 0.4; p.z = Cc.z + d.z * 0.6;
        p.vx = d.x * 2.2; p.vy = Math.abs(d.y) * 1.2 + 0.3; p.vz = d.z * 2.2;
        p.drag = 0.9; p.delay = 0.05 + r() * 0.4; p.life = r.range(3, 5);
        p.s0 = r.range(1, 1.6); p.s1 = r.range(3.5, 5); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });

    const orb = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const orbHalo = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const sphere = T.add(new P.Dome({ tex: tex.noise, hemisphere: false, colorA: C('#8ff0ff', 0.85), colorB: C('#6a4cff', 0.6), noise: 1, core: 0.05, power: 2.2 }));
    const halo = T.add(new P.Ring({ camera, billboard: true, order: 9, depthTest: false }));
    const tilt = T.add(new P.Ring({ camera, billboard: false, order: 9 }));
    const bolts = T.add(new P.Lightning({ bolts: 8, levels: 4, width: reduced ? 0.035 : 0.05, order: 10 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const tiltQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.32, 0.4, 0));

    const lcol = V();
    const boltList = [];
    for (let i = 0; i < 8; i++) boltList.push({ a: V(), b: V(), gain: 0, jag: 0.28, taper: 0.7 });
    let lastStep = -999;
    const regenBolts = (t, radius, outer, gain, count) => {
      const step = Math.floor(t / 0.065);
      if (step === lastStep) return;
      lastStep = step;
      const rr = U.rng(baseSeed + step * 7919);
      for (let i = 0; i < boltList.length; i++) {
        const b = boltList[i];
        if (i >= count) { b.gain = 0; continue; }
        rr.sphere(d);
        b.a.copy(Cc).addScaledVector(d, radius);
        rr.sphere(d);
        const L = rr.range(outer * 0.5, outer);
        b.b.copy(b.a).addScaledVector(d, L);
        if (rr() < 0.35 || b.b.y < O.y + 0.05) b.b.y = O.y + 0.02;
        b.gain = gain * rr.range(0.6, 1.2);
      }
      bolts.regen(boltList, rr);
    };
    const LCOL = [[0, C('#e6ffff')], [0.4, C('#38e0ff')], [2.5, C('#6a5cff')], [6, C('#8a3cff')]];

    return {
      duration: 7.5,
      sound(tDet) {
        ctx.audio.plasmaCharge(ctx.bus, tDet - PRE, tDet);
        ctx.audio.plasmaBurst(ctx.bus, tDet, r);
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < -PRE) return f;
        if (t < 0) {
          const s = (t + PRE) / PRE;
          const pulse = 0.75 + 0.25 * Math.sin(t * (30 + s * 40));
          const os = 0.35 + 1.3 * s * s;
          orb.set(Cc, os, os, (2 + 6 * s) * pulse, ICE);
          orbHalo.set(Cc, os * 3.2, os * 3.2, (0.6 + 1.8 * s) * pulse, CY);
          regenBolts(t, 0.15, 1.2 + 0.8 * s, 0.4 + 1.2 * s, 5);
          bolts.set(0.8 + 1.6 * s, CY, ICE);
          stage.light(0, Cc, CY, (3 + 18 * s * s) * (0.8 + 0.2 * noise1(t * 30)), 5);
          stage.wave(0, O.x, O.z, 4.5 - 4.2 * easeOutCubic(s), 1.2 + 1.8 * s, 0.25, CY);
          f.shake = reduced ? 0 : 0.08 * s * s;
          return f;
        }
        orbHalo.hide();
        const fl = envelope(t, 0.04, 0.16);
        const fs = 2.5 + 7 * easeOutCubic(t / 0.3);
        flash.set(Cc, fs, fs, 9 * fl, ICE);
        streak.set(Cc, 18 * (0.6 + 0.4 * easeOutCubic(t / 0.3)), 0.28, 3 * envelope(t, 0.05, 0.3), CY);
        const core = Math.max(0, 1 - t / 2.2);
        orb.set(Cc, 0.9 + 0.3 * Math.sin(t * 20), 0.9 + 0.3 * Math.sin(t * 20), 5 * core * core, ICE);

        const sr = t < 0.45 ? 3.3 * easeOutQuart(t / 0.45) : 3.3 + 0.3 * clamp01((t - 0.45) / 1.2);
        sphere.set(Cc, sr, 1.1 * (1 - smooth((t - 0.3) / 1.9)), t * 2.2);
        const hr = clamp01(t / 0.8);
        halo.set(Cc, 7 * easeOutCubic(hr), 0.04, 2 * Math.pow(1 - hr, 1.5), ICE);
        const tr = clamp01(t / 1.25);
        tilt.set(Cc, 5.5 * easeOutCubic(tr), 0.05, 1.6 * Math.pow(1 - tr, 1.3), MG, tiltQ);

        const bg = Math.max(0, 1 - t / 1.8);
        regenBolts(t, sr * 0.8, 3.2 + 2.2 * (1 - bg), 1.4 * bg, 8);
        bolts.set(2.2 * bg, CY, ICE);

        colorKeys(lcol, LCOL, t);
        const I = t < 0.05 ? 30 * (t / 0.05) : 30 * Math.exp(-t * 2.2) + 14 * Math.exp(-t * 0.55) * (0.7 + 0.3 * Math.sin(t * 28) * (reduced ? 0.2 : 1));
        stage.light(0, Cc, lcol, I, 7);
        const waveAt = (i, delay, dur, R, col) => {
          const w = clamp01((t - delay) / dur);
          stage.wave(i, O.x, O.z, R * easeOutCubic(w), 3.4 * Math.pow(1 - w, 1.4) * (t > delay ? 1 : 0), 0.14 + 0.35 * w, col);
        };
        waveAt(0, 0, 1.7, 11.5, CY);
        waveAt(1, 0.18, 1.6, 9, VI);
        waveAt(2, 0.36, 1.5, 7, MG);
        stage.setHeat(O.x, O.z, 1.6, 1.6 * envelope(t, 0.1, 1.8), VI);
        if (flare) flare.set(Cc, 1.2 * envelope(t, 0.04, 0.35), CY);

        f.flash = (reduced ? 0.2 : 0.7) * envelope(t, 0.035, 0.12);
        f.flashColor.copy(ICE).lerp(CY, 0.35);
        f.flashPos.copy(Cc);
        f.shake = reduced ? 0 : 0.9 * Math.exp(-t * 2.8) * smooth(t / 0.03);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-04 · Supernova
  // =====================================================================
  function buildNova(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const PRE = 1.1;
    const Cc = V(O.x, O.y + 2.4, O.z);
    const d = V();
    const GOLD = C('#ffc861');
    const MAG = C('#ff4fd2');
    const VIO = C('#7a5cff');
    const TEAL = C('#3ee6c8');
    const ICE = C('#cfeaff');
    const palette = (x) => (x < 0.35 ? MAG : x < 0.65 ? VIO : x < 0.85 ? TEAL : GOLD);

    const accretion = T.particles({
      count: 160, texture: tex.glow, order: 6, t0: -PRE, origin: Cc,
      colors: [C('#ffc861', 2), C('#ffd88a', 3), C('#fff0d0', 4.5), WHITE(6), WHITE(6)],
      stops: [0.3, 0.6, 0.85], alpha: [0.25, 0.95, 1, 0],
      swirl: 3.2,
      spawn(i, p) {
        const a = r() * Math.PI * 2;
        const rad = r.range(2.5, 4.5);
        const lx = Math.cos(a) * rad;
        const lz = Math.sin(a) * rad;
        p.x = Cc.x + lx; p.y = Cc.y + lz * 0.35 + r.range(-0.15, 0.15); p.z = Cc.z + lz * 0.94;
        const k = 1.9;
        p.drag = k;
        p.vx = (Cc.x - p.x) * k; p.vy = (Cc.y - p.y) * k; p.vz = (Cc.z - p.z) * k;
        p.delay = r() * 0.5; p.life = PRE - p.delay + 0.02;
        p.s0 = r.range(0.05, 0.09); p.s1 = 0.025;
      },
    });
    const nebula = T.particles({
      count: 420, texture: tex.puff, atlas: true, order: 4, origin: Cc,
      colors: [WHITE(1.9), WHITE(1.1), WHITE(0.7), WHITE(0.36), WHITE(0.05)],
      stops: [0.08, 0.35, 0.7], alpha: [0.04, 0.5, 0.3, 0], occ: [0.3, 0.9, 0.12], colorMix: 1,
      sizeEase: 1.6, turb: [0.35, 0.6], ground: [O.y, 0.5],
      spawn(i, p) {
        r.sphere(d);
        const sp = r.range(3, 5.5);
        p.x = Cc.x + d.x * 0.3; p.y = Cc.y + d.y * 0.3; p.z = Cc.z + d.z * 0.3;
        p.vx = d.x * sp; p.vy = d.y * sp * 0.85; p.vz = d.z * sp;
        p.drag = 0.8; p.delay = r() * 0.25; p.life = r.range(5, 9);
        p.s0 = r.range(0.6, 0.9); p.s1 = r.range(2.6, 3.8); p.rot = r() * 6.28; p.spin = r.range(-0.25, 0.25);
        const c = palette(r());
        p.r = c.x; p.g = c.y; p.b = c.z;
      },
    });
    const filaments = T.particles({
      count: 240, texture: tex.spark, streak: true, stretch: 0.22, order: 5, origin: Cc,
      colors: [WHITE(4), WHITE(2.8), WHITE(1.6), WHITE(0.6), WHITE(0)],
      stops: [0.12, 0.4, 0.75], alpha: [0.02, 0.55, 1, 0], colorMix: 1,
      spawn(i, p) {
        r.sphere(d);
        const sp = r.range(4, 9);
        p.x = Cc.x; p.y = Cc.y; p.z = Cc.z;
        p.vx = d.x * sp; p.vy = d.y * sp * 0.85; p.vz = d.z * sp;
        p.drag = 0.5; p.delay = r() * 0.15; p.life = r.range(2, 4);
        p.s0 = p.s1 = r.range(0.025, 0.05);
        const c = palette(r());
        p.r = c.x; p.g = c.y; p.b = c.z;
      },
    });
    const ringParticles = (count, tiltX, tiltZ, speed, col) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
      const v = V();
      return T.particles({
        count, texture: tex.glow, order: 6, origin: Cc,
        colors: [WHITE(5), WHITE(3.6), WHITE(2.2), WHITE(1), WHITE(0)],
        stops: [0.1, 0.4, 0.75], alpha: [0.03, 0.6, 1, 0.3], colorMix: 1,
        spawn(i, p, n) {
          const a = (i / n) * Math.PI * 2 + r() * 0.05;
          v.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(q);
          const sp = speed * r.range(0.93, 1.07);
          p.x = Cc.x + v.x * 0.2; p.y = Cc.y + v.y * 0.2; p.z = Cc.z + v.z * 0.2;
          p.vx = v.x * sp; p.vy = v.y * sp; p.vz = v.z * sp;
          p.drag = 0.35; p.delay = 0.05 + r() * 0.1; p.life = r.range(4, 7);
          p.s0 = r.range(0.1, 0.16); p.s1 = r.range(0.14, 0.22);
          p.r = col.x; p.g = col.y; p.b = col.z;
        },
      });
    };
    ringParticles(180, 0.42, 0.1, 3.4, GOLD);
    ringParticles(140, -0.2, -0.62, 2.6, TEAL);
    const glitter = T.particles({
      count: 220, texture: tex.star, order: 7, origin: Cc,
      colors: [WHITE(5), WHITE(5), WHITE(4), WHITE(2), WHITE(0)],
      stops: [0.2, 0.5, 0.8], alpha: [0.2, 0.6, 1, 0.9], colorMix: 1, ground: [O.y, 0.2],
      spawn(i, p) {
        r.sphere(d);
        const rad = r.range(1, 8);
        p.x = Cc.x + d.x * rad; p.y = Math.max(O.y + 0.3, Cc.y + d.y * rad * 0.8); p.z = Cc.z + d.z * rad;
        p.vy = r.range(-0.05, 0.15);
        p.drag = 1; p.delay = 0.3 + r() * 3.2; p.life = r.range(1.5, 3.5);
        p.s0 = r.range(0.12, 0.3); p.s1 = p.s0 * 0.6; p.rot = r() * 0.8;
        const c = r() < 0.6 ? ICE : GOLD;
        p.r = c.x; p.g = c.y; p.b = c.z;
      },
    });

    const core = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const coreHalo = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak2 = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const beamA = T.add(new P.Beam({ order: 8 }));
    const beamB = T.add(new P.Beam({ order: 8 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const axis = V();
    const axisN = V();
    const lcol = V();
    const LCOL = [[0, C('#ffffff')], [0.5, C('#ffe6f6')], [2.5, C('#ff7ad8')], [6, C('#8a6cff')], [10, C('#5a4cff')]];
    const LI = [[0, 0], [0.05, 60], [0.6, 20], [3, 9], [7, 3.5], [10.5, 0]];
    const DUR = 11;

    return {
      duration: DUR,
      sound(tDet) {
        ctx.audio.novaSwell(ctx.bus, tDet - PRE, tDet);
        ctx.audio.novaBurst(ctx.bus, tDet, r);
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < -PRE) return f;
        if (t < 0) {
          const s = (t + PRE) / PRE;
          const pulse = 0.8 + 0.2 * Math.sin(t * (12 + 40 * s));
          const cs = 0.9 - 0.5 * s;
          core.set(Cc, cs, cs, (4 + 12 * s * s) * pulse, ICE);
          coreHalo.set(Cc, 2.5 + 2 * s, 2.5 + 2 * s, 0.6 + 1.2 * s, GOLD);
          stage.light(0, Cc, GOLD, 4 + 12 * s * s, 6);
          f.dim = 1 - 0.55 * smooth(s);
          stage.dim = f.dim;
          return f;
        }
        const endFade = 1 - smooth((t - (DUR - 1.6)) / 1.5);
        const fl = envelope(t, 0.05, 0.2);
        const fs = 3 + 11 * easeOutCubic(t / 0.35);
        flash.set(Cc, fs, fs, 11 * fl, ONE);
        streak.set(Cc, 32 * (0.5 + 0.5 * easeOutCubic(t / 0.4)), 0.34, 3.5 * envelope(t, 0.06, 0.5), ICE);
        streak2.set(Cc, 12, 0.18, 1.8 * envelope(t, 0.06, 0.9), MAG);
        const cp = 0.85 + 0.15 * Math.sin(t * 9);
        core.set(Cc, 0.75 * cp, 0.75 * cp, (3 + 6 * Math.exp(-t * 1.5)) * endFade, ICE);
        coreHalo.set(Cc, 4.5, 4.5, (0.9 + 1.5 * Math.exp(-t * 0.8)) * endFade, MAG);

        const tilt = 0.5;
        const phi = t * 2.4;
        axis.set(Math.sin(tilt) * Math.cos(phi), Math.cos(tilt), Math.sin(tilt) * Math.sin(phi));
        axisN.copy(axis).negate();
        const bI = smooth((t - 0.8) / 1.0) * endFade * 1.8 * (0.9 + 0.1 * Math.sin(t * 40));
        beamA.set(Cc, axis, 9, 0.05, 0.55, bI, ICE);
        beamB.set(Cc, axisN, 9, 0.05, 0.55, bI, ICE);

        colorKeys(lcol, LCOL, t);
        stage.light(0, Cc, lcol, keys(LI, t), 9);
        const w0 = clamp01(t / 3.6);
        stage.wave(0, O.x, O.z, 16 * easeOutCubic(w0), 2.8 * Math.pow(1 - w0, 1.4), 0.3 + 0.9 * w0, MAG);
        const w1 = clamp01((t - 0.45) / 3.0);
        stage.wave(1, O.x, O.z, 11 * easeOutCubic(w1), 2 * Math.pow(1 - w1, 1.4) * (t > 0.45 ? 1 : 0), 0.25 + 0.7 * w1, TEAL);
        stage.setHeat(O.x, O.z, 2.2, 1.4 * envelope(t, 0.2, 2.5), VIO);
        if (flare) flare.set(Cc, 1.6 * envelope(t, 0.05, 0.6) + 0.25 * endFade * smooth(t / 1.5));

        f.dim = t < 2.5 ? 0.45 + 0.55 * smooth(t / 2.5) : 1;
        stage.dim = f.dim;
        f.flash = (reduced ? 0.25 : 0.85) * envelope(t, 0.05, 0.18);
        f.flashColor.copy(ICE);
        f.flashPos.copy(Cc);
        f.shake = reduced ? 0 : 0.8 * Math.exp(-t * 1.8) * smooth(t / 0.04);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-05 · Fogos de artifício
  // =====================================================================
  function buildFireworks(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera, q } = ctx;
    const d = V();
    const COLORS = ['#ff3b5c', '#ffd23f', '#3bd6ff', '#7dff6b', '#c65bff', '#ff8a3d', '#ffffff', '#ff5ec4'].map((h) => C(h));
    const GOLD = C('#ffb347');
    const right = V().setFromMatrixColumn(camera.matrixWorld, 0);
    const plan = [
      [0.0, 'peony'], [0.45, 'willow'], [0.9, 'ring'], [1.4, 'chrys'], [2.0, 'crackle'],
      [2.55, 'peony'], [3.25, 'willow'], [3.3, 'chrys'], [3.35, 'peony'],
    ];
    const shells = plan.map(([tl, type], i) => {
      const L = V();
      r.disk(d, 0.9);
      L.set(O.x + d.x, O.y + 0.05, O.z + d.z);
      const rise = r.range(1.0, 1.3);
      const Bp = V(L.x + r.range(-1, 1), L.y + r.range(4.5, 7), L.z + r.range(-1, 1));
      const col = type === 'willow' ? GOLD : COLORS[(i * 3 + r.int(0, 7)) % COLORS.length];
      const off = V().subVectors(Bp, O);
      const pan = Math.max(-0.8, Math.min(0.8, off.dot(right) / 5));
      const finale = tl > 3.2;
      return { tl, type, L, Bp, rise, tb: tl + rise, col, pan, finale };
    });
    const count = (n) => Math.max(4, Math.round(n * q));

    // foguetes subindo: 1 cabeça + rastro por foguete
    const rocketRecs = [];
    for (const s of shells) {
      rocketRecs.push({ s, head: true });
      const n = count(24);
      for (let k = 0; k < n; k++) rocketRecs.push({ s, head: false, k: k / n });
    }
    const KR = 1.2;
    const AYR = -3;
    T.particles({
      count: rocketRecs.length, exact: true, texture: tex.glow, order: 6,
      colors: [C('#fff4d0', 5), C('#ffd58a', 4), C('#ffa040', 2.5), C('#c04010', 1), C('#300800', 0)],
      stops: [0.2, 0.5, 0.8], alpha: [0.02, 0.6, 1, 0.3],
      spawn(i, p) {
        const rec = rocketRecs[i];
        const s = rec.s;
        if (rec.head) {
          const term = AYR / KR;
          const e = 1 - Math.exp(-KR * s.rise);
          p.x = s.L.x; p.y = s.L.y; p.z = s.L.z;
          p.vx = ((s.Bp.x - s.L.x) * KR) / e;
          p.vz = ((s.Bp.z - s.L.z) * KR) / e;
          p.vy = term + ((s.Bp.y - s.L.y - term * s.rise) * KR) / e;
          p.drag = KR; p.ay = AYR; p.delay = s.tl; p.life = s.rise;
          p.s0 = 0.16; p.s1 = 0.12;
        } else {
          const k = rec.k;
          const e = 1 - Math.pow(1 - k, 2);
          p.x = s.L.x + (s.Bp.x - s.L.x) * e; p.y = s.L.y + (s.Bp.y - s.L.y) * e; p.z = s.L.z + (s.Bp.z - s.L.z) * e;
          p.vx = r.range(-0.2, 0.2); p.vy = r.range(-0.8, -0.2); p.vz = r.range(-0.2, 0.2);
          p.drag = 1.5; p.ay = -1.5; p.delay = s.tl + k * s.rise; p.life = r.range(0.35, 0.7);
          p.s0 = r.range(0.05, 0.08); p.s1 = 0.02;
        }
      },
    });

    // estrelas redondas (peônia, anel, crepitante)
    const starRecs = [];
    const streakRecs = [];
    const glitterRecs = [];
    for (const s of shells) {
      if (s.type === 'peony') for (let k = 0, n = count(140); k < n; k++) starRecs.push({ s, k, n });
      if (s.type === 'ring') {
        const qr = new THREE.Quaternion().setFromEuler(new THREE.Euler(r.range(-0.9, 0.9), r() * 3, r.range(-0.5, 0.5)));
        for (let k = 0, n = count(110); k < n; k++) starRecs.push({ s, k, n, ring: qr });
      }
      if (s.type === 'crackle') {
        for (let k = 0, n = count(80); k < n; k++) starRecs.push({ s, k, n, slow: true });
        for (let k = 0, n = count(130); k < n; k++) glitterRecs.push({ s });
      }
      if (s.type === 'chrys') for (let k = 0, n = count(150); k < n; k++) streakRecs.push({ s, willow: false });
      if (s.type === 'willow') for (let k = 0, n = count(170); k < n; k++) streakRecs.push({ s, willow: true });
    }
    T.particles({
      count: starRecs.length, exact: true, texture: tex.spark, streak: true, stretch: 0.07, order: 6,
      colors: [WHITE(5), WHITE(4), WHITE(2.6), WHITE(1.2), WHITE(0)],
      stops: [0.15, 0.45, 0.8], alpha: [0.02, 0.62, 1, 0.25], colorMix: 1,
      spawn(i, p) {
        const rec = starRecs[i];
        const s = rec.s;
        if (rec.ring) {
          const a = (rec.k / rec.n) * Math.PI * 2;
          d.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(rec.ring);
        } else {
          r.sphere(d);
        }
        const sp = rec.slow ? r.range(2.6, 3.2) : r.range(3.4, 4.2);
        p.x = s.Bp.x; p.y = s.Bp.y; p.z = s.Bp.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 1.3; p.ay = -2.2; p.delay = s.tb + r() * 0.03; p.life = r.range(1.6, 2.3);
        p.s0 = r.range(0.035, 0.055); p.s1 = 0.025;
        p.r = s.col.x; p.g = s.col.y; p.b = s.col.z;
      },
    });
    T.particles({
      count: Math.max(1, streakRecs.length), exact: true, texture: tex.spark, streak: true, stretch: 0.16, order: 6,
      colors: [WHITE(5), WHITE(3.8), WHITE(2.4), WHITE(1), WHITE(0)],
      stops: [0.15, 0.45, 0.8], alpha: [0.02, 0.6, 1, 0.15], colorMix: 1,
      spawn(i, p) {
        const rec = streakRecs[i];
        if (!rec) { p.life = 0.02; p.delay = 999; return; }
        const s = rec.s;
        r.sphere(d);
        p.x = s.Bp.x; p.y = s.Bp.y; p.z = s.Bp.z;
        if (rec.willow) {
          const sp = r.range(3, 3.8);
          p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
          p.drag = 2.4; p.ay = -1.4; p.life = r.range(2.8, 3.8);
          p.s0 = p.s1 = r.range(0.025, 0.04);
        } else {
          const sp = r.range(3.6, 4.4);
          p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
          p.drag = 1.5; p.ay = -2.0; p.life = r.range(1.4, 2.0);
          p.s0 = p.s1 = r.range(0.022, 0.035);
        }
        p.delay = s.tb + r() * 0.03;
        p.r = s.col.x; p.g = s.col.y; p.b = s.col.z;
      },
    });
    T.particles({
      count: Math.max(1, glitterRecs.length), exact: true, texture: tex.star, order: 7,
      colors: [WHITE(5), WHITE(5), WHITE(4), WHITE(2), WHITE(0)],
      stops: [0.2, 0.5, 0.8], alpha: [0.1, 0.5, 1, 0.9],
      spawn(i, p) {
        const rec = glitterRecs[i];
        if (!rec) { p.life = 0.02; p.delay = 999; return; }
        const s = rec.s;
        r.sphere(d);
        const rad = r.range(1.2, 3.2);
        p.x = s.Bp.x + d.x * rad; p.y = s.Bp.y + d.y * rad - 0.6; p.z = s.Bp.z + d.z * rad;
        p.vy = -0.6; p.drag = 1;
        p.delay = s.tb + 0.35 + r() * 1.3; p.life = r.range(0.25, 0.5);
        p.s0 = r.range(0.12, 0.2); p.s1 = 0.05; p.rot = r() * 0.8;
      },
    });
    // clarão de cada estouro
    T.particles({
      count: shells.length, exact: true, texture: tex.glow, order: 8,
      colors: [WHITE(4), WHITE(2.6), WHITE(1.4), WHITE(0.6), WHITE(0)],
      stops: [0.2, 0.5, 0.8], alpha: [0.02, 0.2, 1, 0], colorMix: 0.6,
      spawn(i, p) {
        const s = shells[i];
        p.x = s.Bp.x; p.y = s.Bp.y; p.z = s.Bp.z;
        p.drag = 1; p.delay = s.tb; p.life = 0.4;
        p.s0 = 0.5; p.s1 = 2.4;
        p.r = s.col.x; p.g = s.col.y; p.b = s.col.z;
      },
    });
    const smoke = T.particles({
      count: shells.length * 8, exact: true, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#8a8f99', 0.5), C('#6b7078', 0.4), C('#50545b', 0.35), C('#40434a', 0.3), C('#303338', 0.25)],
      stops: [0.2, 0.5, 0.8], alpha: [0.15, 0.5, 0.12, 0], occ: [0, 0.1, 0.8],
      sizeEase: 1.4, turb: [0.3, 0.4], lit: 0.5,
      spawn(i, p) {
        const s = shells[Math.floor(i / 8)];
        r.sphere(d);
        p.x = s.Bp.x + d.x * 0.8; p.y = s.Bp.y + d.y * 0.6; p.z = s.Bp.z + d.z * 0.8;
        p.vx = d.x * 0.5 + 0.15; p.vy = r.range(-0.1, 0.2); p.vz = d.z * 0.5;
        p.drag = 0.8; p.delay = s.tb + 0.1 + r() * 0.3; p.life = r.range(4, 6);
        p.s0 = r.range(0.8, 1.2); p.s1 = r.range(2.2, 3.2); p.rot = r() * 6.28; p.spin = r.range(-0.2, 0.2);
      },
    });

    const litc = V();
    const launchGlow = C('#ffb060');
    const sorted = shells.slice().sort((a, b) => a.tb - b.tb);
    const lastBurst = sorted[sorted.length - 1].tb;
    const DUR = lastBurst + 4.4;

    return {
      duration: DUR,
      sound(tDet) {
        for (const s of shells) {
          ctx.audio.fwLaunch(ctx.bus, tDet + s.tl, s.rise, s.pan);
          ctx.audio.fwBurst(ctx.bus, tDet + s.tb, s.pan, s.finale ? 1.1 : 0.85, s.type === 'crackle' || s.type === 'willow', r);
        }
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) return f;
        // até 3 luzes para os estouros mais recentes
        let li = 0;
        let flash = 0;
        for (let i = sorted.length - 1; i >= 0 && li < 3; i--) {
          const s = sorted[i];
          const age = t - s.tb;
          if (age < 0 || age > 1.4) continue;
          const I = 8 * envelope(age, 0.02, 0.4) + 1.6 * envelope(age, 0.05, 1.2);
          stage.light(li, s.Bp, s.col, I, 6);
          if (li === 0) {
            litc.copy(s.col).multiplyScalar(I * 0.12);
            smoke.light(s.Bp, litc);
            f.flashPos.copy(s.Bp);
            f.flashColor.copy(s.col).lerp(ONE, 0.5);
          }
          flash = Math.max(flash, (s.finale ? 0.3 : 0.12) * envelope(age, 0.02, 0.1));
          li++;
        }
        // brilho quente na base a cada lançamento
        let launch = 0;
        for (const s of shells) launch = Math.max(launch, envelope(t - s.tl, 0.02, 0.35));
        stage.setHeat(O.x, O.z, 1.1, 1.4 * launch, launchGlow);
        f.flash = reduced ? flash * 0.3 : flash;
        const fin = envelope(t - sorted[sorted.length - 1].tb, 0.03, 0.4);
        f.shake = reduced ? 0 : 0.28 * fin;
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  B.EFFECTS = [
    {
      id: 'fogo', code: 'FX-01', name: 'Bola de fogo',
      desc: 'Explosão clássica de cinema: clarão, labaredas e fumaça escura.',
      swatch: ['#fff1c9', '#ff9d2e', '#b3260d'], build: buildFireball, craterK: 0.7,
    },
    {
      id: 'meteoro', code: 'FX-02', name: 'Meteoro',
      desc: 'Um bólido risca o céu e levanta uma parede de poeira.',
      swatch: ['#e6f4ff', '#ffb35c', '#6b4a2e'], build: buildMeteor, craterK: 1.1,
    },
    {
      id: 'plasma', code: 'FX-03', name: 'Pulso de plasma',
      desc: 'Energia em ciano e violeta, com arcos elétricos e anéis.',
      swatch: ['#e9ffff', '#3de0ff', '#7b4dff'], build: buildPlasma, craterK: 0.5,
    },
    {
      id: 'supernova', code: 'FX-04', name: 'Supernova',
      desc: 'Um núcleo estelar se acende e espalha uma nebulosa colorida.',
      swatch: ['#ffffff', '#ff5fd2', '#3ee6c8'], build: buildNova, craterK: 0.6, aimY: 2.2, frameK: 1.15,
    },
    {
      id: 'fogos', code: 'FX-05', name: 'Fogos de artifício',
      desc: 'Sequência festiva de rojões coloridos, com final triplo.',
      swatch: ['#ffe27a', '#ff4d6d', '#4dd2ff'], build: buildFireworks, aimY: 4.4, frameK: 1.05,
    },
    {
      id: 'solar', code: 'FX-06', name: 'Coluna solar',
      desc: 'Clarão longo e uma coluna de fogo que sobe e se abre em nuvem.',
      swatch: ['#fffbe8', '#ffb347', '#6b3a22'], build: buildSolar, craterK: 1.2, aimY: 4.2, frameK: 1.45,
    },
    {
      id: 'fantasma', code: 'FX-07', name: 'Onda fantasma',
      desc: 'Pulso verde quase silencioso que atravessa o mapa sem fogo.',
      swatch: ['#eafff4', '#7dffb0', '#136b52'], build: buildGhost, aimY: 1.5, frameK: 1.15,
    },
    {
      id: 'tapete', code: 'FX-08', name: 'Tapete de chamas',
      desc: 'Linhas de fogo correm pelo chão, com brasas e fumaça baixa.',
      swatch: ['#ffe0a0', '#ff6a1e', '#5a1a08'], build: buildCarpet, craterK: 0.25, aimY: 0.8, frameK: 1.2,
    },
    {
      id: 'chuva', code: 'FX-09', name: 'Chuva de faíscas',
      desc: 'Uma sequência de estouros pequenos espalhados ao redor do ponto.',
      swatch: ['#fff4d6', '#ffc050', '#a8360c'], build: buildCluster, craterK: 0.45, aimY: 1.0, frameK: 1.1,
    },
    {
      id: 'nuvem', code: 'FX-10', name: 'Nuvem de ignição',
      desc: 'Uma névoa se espalha pelo chão e acende toda de uma vez.',
      swatch: ['#f2eed0', '#ffae42', '#8a3a12'], build: buildIgnition, craterK: 0.8, aimY: 1.2, frameK: 1.15,
    },
    {
      id: 'apagao', code: 'FX-11', name: 'Apagão',
      desc: 'Pulso azul com raios: as luzes do mapa piscam e apagam.',
      swatch: ['#eaf6ff', '#6fb6ff', '#10224a'], build: buildBlackout, aimY: 0.8, frameK: 1.25,
    },
    {
      id: 'nuclear', code: 'FX-12', name: 'Nuclear',
      desc: 'Visual de filme: clarão branco, bola de fogo, cogumelo e onda de choque. Sem escala real.',
      swatch: ['#ffffff', '#ffc060', '#4a2c20'], build: buildNuclear, aimY: 4.6, frameK: 1.6, craterK: 1.4,
    },
  ];

  // =====================================================================
  // Efeito criado pelo usuário: um construtor genérico guiado por controles 0–1
  // =====================================================================
  const CUSTOM_DEFAULTS = {
    name: 'Meu efeito', core: '#fff2d6', mid: '#ff7a2a', smoke: '#2a2624',
    size: 0.5, fire: 0.7, smokeAmt: 0.6, sparks: 0.6, wave: 0.7, flash: 0.7, shake: 0.5, height: 0.4,
    power: 0, sound: 'estrondo',
  };

  /** Potência 0–1 -> multiplicador fictício (×1 a ×1000) e nome. Só muda o visual, não é medida real. */
  function powerInfo(pw) {
    const m = Math.round(Math.pow(1000, clamp01(pw)));
    const nome = pw < 0.2 ? 'Normal' : pw < 0.45 ? 'Forte' : pw < 0.7 ? 'Enorme' : pw < 0.88 ? 'Absurda' : 'Ridícula';
    return { m, nome };
  }

  function makeCustom(raw) {
    const p = Object.assign({}, CUSTOM_DEFAULTS, raw);
    const pw = clamp01(p.power || 0);
    const G = 1 + 5 * Math.pow(pw, 1.25);  // a potência aumenta tudo até 6×
    const S0 = 0.6 + p.size * 1.2;          // escala visual 0,6–1,8
    const S = S0 * G;
    const lift = (1 + p.height * 3) * Math.sqrt(G);
    const info = powerInfo(pw);
    return {
      id: p.id, code: p.code || 'MEU', name: p.name || 'Meu efeito', custom: true, params: p,
      desc: pw >= 0.2 ? `Efeito criado por você · potência ${info.nome.toLowerCase()} (×${info.m}).` : 'Efeito criado por você no editor.',
      swatch: [p.core, p.mid, p.smoke],
      aimY: (0.8 + p.height * 3 * S0) * G, frameK: (0.85 + 0.35 * S0) * Math.pow(G, 0.92),
      craterK: p.wave * (0.3 + 0.9 * p.size) + pw * (0.8 + 6 * pw),
      power: pw,
      build: (ctx) => buildCustom(ctx, p, S, lift, pw),
    };
  }

  function buildCustom(ctx, p, S, lift, pw = 0) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const d = V();
    const n = (k) => Math.round(k * (1 + 1.6 * pw));
    const lit = [];
    if (p.smokeAmt > 0.02) {
      lit.push(T.particles({
        count: n(20 + 130 * p.smokeAmt), texture: tex.puff, atlas: true, order: 3,
        colors: [C(p.mid, 1), C(p.smoke, 0.55), C(p.smoke, 0.45), C(p.smoke, 0.42), C(p.smoke, 0.4)],
        stops: [0.12, 0.4, 0.75], alpha: [0.08, 0.55, 0.72, 0], occ: [0, 0.08, 1],
        sizeEase: 1.6, turb: [0.6, 0.55], lit: 0.45, ground: [O.y, 0.45],
        spawn(i, q) {
          r.disk(d, 0.6 * S);
          q.x = O.x + d.x; q.y = O.y + 0.3; q.z = O.z + d.z;
          q.vx = d.x * 0.8; q.vy = r.range(0.8, 1.8) * lift; q.vz = d.z * 0.8;
          q.drag = 0.55; q.ay = 0.3; q.delay = 0.12 + Math.pow(r(), 1.4) * 2.4; q.life = r.range(4.5, 7.5);
          q.s0 = r.range(0.6, 1) * S; q.s1 = r.range(2.4, 3.8) * S; q.rot = r() * 6.28; q.spin = r.range(-0.3, 0.3);
        },
      }));
    }
    if (p.fire > 0.02) {
      lit.push(T.particles({
        count: n(20 + 100 * p.fire), texture: tex.puff, atlas: true, order: 4,
        colors: [C(p.core, 7), C(p.mid, 3.2), C(p.mid, 1.2), C(p.smoke, 0.9), C(p.smoke, 0.8)],
        stops: [0.1, 0.28, 0.55], alpha: [0.03, 0.55, 0.95, 0], occ: [0.1, 0.4, 0.95],
        sizeEase: 2.2, turb: [0.25, 1.4], lit: 0.5, ground: [O.y, 0.35],
        spawn(i, q) {
          r.hemi(d, 0.05, 1.45);
          const sp = r.range(2.2, 6.5) * S;
          q.x = O.x + d.x * 0.25; q.y = O.y + 0.15; q.z = O.z + d.z * 0.25;
          q.vx = d.x * sp; q.vy = d.y * sp + 1.2 * lift; q.vz = d.z * sp;
          q.drag = 2.8; q.ay = 1.4 * lift; q.delay = r() * 0.12; q.life = r.range(1.7, 3.2);
          q.s0 = r.range(0.35, 0.7) * S; q.s1 = r.range(1.7, 2.7) * S; q.rot = r() * 6.28; q.spin = r.range(-0.7, 0.7);
        },
      }));
      T.particles({
        count: n(160 * p.fire), texture: tex.glow, order: 5,
        colors: [C(p.core, 8), C(p.mid, 6), C(p.mid, 3.5), C(p.mid, 1.5), C(p.smoke, 0.3)],
        stops: [0.2, 0.5, 0.8], alpha: [0.1, 0.6, 1, 0.65], turb: [0.6, 2.4], ground: [O.y, 0.1],
        spawn(i, q) {
          r.sphere(d);
          q.x = O.x + d.x * 1.3 * S; q.y = O.y + 0.4 + Math.abs(d.y) * 1.5 * S; q.z = O.z + d.z * 1.3 * S;
          q.vx = d.x * 0.8; q.vy = r.range(0.5, 2.2) * lift; q.vz = d.z * 0.8;
          q.drag = 0.8; q.ay = 0.25; q.delay = 0.25 + r() * 2.6; q.life = r.range(2.2, 4.8);
          q.s0 = r.range(0.05, 0.09); q.s1 = 0.02;
        },
      });
    }
    if (p.sparks > 0.02) {
      T.particles({
        count: n(20 + 420 * p.sparks), texture: tex.spark, streak: true, stretch: 0.07, order: 6,
        colors: [C(p.core, 6), C(p.core, 4), C(p.mid, 2.2), C(p.mid, 0.9), C(p.smoke, 0.15)],
        stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.7, 1, 0], ground: [O.y - 0.02, 0.06],
        spawn(i, q) {
          r.hemi(d, 0.18, 1.5);
          const sp = r.range(5, 13.5) * Math.sqrt(S);
          q.x = O.x; q.y = O.y + 0.2; q.z = O.z;
          q.vx = d.x * sp; q.vy = d.y * sp; q.vz = d.z * sp;
          q.drag = 0.9; q.ay = -9; q.delay = r() * 0.1; q.life = r.range(0.9, 2.2);
          q.s0 = q.s1 = r.range(0.022, 0.045);
        },
      });
    }
    if (p.wave > 0.02) {
      lit.push(T.particles({
        count: n(70 * p.wave), texture: tex.puff, atlas: true, order: 2,
        colors: [C('#9a7a5c', 1.1), C('#5d4d3e', 0.75), C('#3a342e', 0.55), C('#2c2a28', 0.45), C('#232323', 0.4)],
        stops: [0.1, 0.35, 0.7], alpha: [0.05, 0.4, 0.28, 0], occ: [0, 0.1, 0.85],
        sizeEase: 2, turb: [0.3, 0.8], lit: 0.8, ground: [O.y, 0.25],
        spawn(i, q, cnt) {
          const a = (i / cnt) * Math.PI * 2 + r() * 0.2;
          const sp = r.range(6, 9.5) * S;
          q.x = O.x + Math.cos(a) * 0.5; q.y = O.y + 0.12; q.z = O.z + Math.sin(a) * 0.5;
          q.vx = Math.cos(a) * sp; q.vy = r.range(0.2, 0.8); q.vz = Math.sin(a) * sp;
          q.drag = 1.7; q.ay = 0.25; q.delay = 0.03 + r() * 0.08; q.life = r.range(1.8, 3.4);
          q.s0 = r.range(0.4, 0.6) * S; q.s1 = r.range(1.6, 2.4) * S; q.rot = r() * 6.28;
        },
      }));
    }
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const dome = p.wave > 0.3 ? T.add(new P.Dome({ tex: tex.noise, colorA: C(p.core, 1.3), colorB: C(p.mid, 0.7), noise: 0.35, core: 0.02, power: 4 })) : null;
    const flare = reduced || p.flash < 0.2 ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const center = V(O.x, O.y + 0.6 * S, O.z);
    const lpos = V();
    const lcol = V();
    const litc = V();
    const CORE = C(p.core);
    const MID = C(p.mid);
    const peak = (12 + 30 * Math.max(p.flash, p.fire)) * (1 + 3 * pw);
    // potência alta: cubos em brasa, coluna de luz até o céu e anel de choque horizontal
    const pixels = pw > 0.2 && B.VoxelBurst ? T.add(new B.VoxelBurst({
      count: Math.round((300 + 2200 * pw) * Math.max(0.35, ctx.q)), rng: r, ground: O.y,
      ramp: [[0, C(p.core, 9)], [0.25, C(p.mid, 5)], [0.6, C(p.mid, 1.6)], [1, C(p.smoke, 0.25)]],
      spawn(i, c) {
        r.hemi(d, 0.08, 1.4);
        const sp = r.range(4, 16) * Math.sqrt(S);
        c.x = O.x + d.x * 0.4; c.y = O.y + 0.3; c.z = O.z + d.z * 0.4;
        c.vx = d.x * sp; c.vy = d.y * sp * 0.9 + 2; c.vz = d.z * sp;
        c.drag = 1.1; c.g = 6; c.delay = r() * 0.15; c.life = r.range(2, 4.5);
        c.size = r.range(0.1, 0.3) * Math.sqrt(S);
      },
    })) : null;
    const pillar = pw > 0.55 ? T.add(new P.Beam({ order: 7 })) : null;
    const shock = pw > 0.35 ? T.add(new P.Ring({ camera, billboard: false, order: 7 })) : null;
    const flat = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -Math.PI / 2);
    const UPV = V(0, 1, 0);

    return {
      duration: 5 + 4.5 * Math.max(p.smokeAmt, 0.3) + 4 * pw,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        if (p.sound === 'estrondo') a.boom(b, tDet, { power: Math.min(1.3, 0.5 + 0.6 * p.size + 0.5 * pw), bright: 1 - 0.3 * pw, length: 0.8 + 0.6 * p.smokeAmt + 1.2 * pw, crackle: 0.3 + p.sparks + 2 * pw, rng: r });
        if (pw > 0.5) a.boom(b, tDet + 0.35, { power: 0.6 * pw, bright: 0.5, length: 2, crackle: 0.5, rng: r });
        else if (p.sound === 'eletrico') a.plasmaBurst(b, tDet, r);
        else if (p.sound === 'suave') {
          a.tone(b, tDet, { f0: 70, f1: 40, glide: 3, dur: 5, gain: 0.45, attack: 0.08, hold: 0.3, tau: 1.2, wet: 0.6 });
          a.noise(b, tDet, { dur: 4, gain: 0.08, attack: 0.3, tau: 1, filter: { type: 'bandpass', f0: 2500, f1: 6000, glide: 3, q: 2 }, wet: 0.9 });
        }
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (pixels) pixels.update(t);
        if (t < 0) { flash.hide(); streak.hide(); if (dome) dome.hide(); if (flare) flare.hide(); if (pillar) pillar.hide(); if (shock) shock.hide(); return f; }
        if (pillar) pillar.set(O, UPV, 60 * pw * easeOutCubic(clamp01(t / 0.6)), 0.6 * S * 0.4, 0.15 * S, 4 * envelope(t, 0.08, 3.5), CORE);
        if (shock) {
          const st = clamp01(t / 2.2);
          shock.set(V(O.x, O.y + 0.3, O.z), 16 * S * easeOutCubic(st), 0.05, 3 * pw * Math.pow(1 - st, 1.6), MID, flat);
        }
        const I = keys([[0, 0], [0.05, peak], [0.4, peak * 0.45], [2.5, peak * 0.2], [6, 0]], t) * (1 + 0.3 * noise1(t * 11) * p.fire);
        lcol.copy(CORE).lerp(MID, smooth(t / 1.2));
        lpos.set(O.x, O.y + 1 + Math.min(t, 3) * 0.4 * lift, O.z);
        stage.light(0, lpos, lcol, I, 5 + 2 * S);
        if (pw > 0.2) stage.light(1, V(O.x, O.y + 6 * S * 0.3, O.z), CORE, I * 0.6 * pw, 8 + 4 * S);
        litc.copy(lcol).multiplyScalar(I * 0.05);
        for (const s of lit) s.light(lpos, litc);
        const fl = envelope(t, 0.045, 0.14);
        const fs = (2.5 + 7.5 * easeOutCubic(t / 0.3)) * S;
        flash.set(center, fs, fs, 10 * p.flash * fl, CORE);
        streak.set(center, 16 * S, 0.3, 3 * p.flash * envelope(t, 0.05, 0.3), CORE);
        if (dome) {
          const dt01 = clamp01(t / 0.75);
          dome.set(O, 5 * S * easeOutCubic(dt01), 0.5 * p.wave * Math.pow(1 - dt01, 2), t);
        }
        const wt = clamp01(t / 2.4);
        stage.wave(0, O.x, O.z, 11 * S * easeOutCubic(wt), 2.6 * p.wave * Math.pow(1 - wt, 1.5), 0.22 + 0.7 * wt, MID);
        stage.setHeat(O.x, O.z, 2 * S, 2.4 * p.fire * envelope(t, 0.15, 2.4), MID);
        if (flare) flare.set(center, 1.3 * p.flash * envelope(t, 0.04, 0.35));
        f.flash = (reduced ? 0.22 : 0.9 + 0.5 * pw) * Math.max(p.flash, pw) * envelope(t, 0.035, 0.12 + 0.5 * pw);
        f.flashColor.copy(CORE);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : (1.2 * p.shake + 1.6 * pw) * Math.exp(-t * (2.6 - 1.6 * pw)) * smooth(t / 0.03);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  /** Entrega "como míssil": projétil fictício em arco que chega ao ponto na detonação. */
  function buildMissile(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, stage, camera } = ctx;
    const PRE = 2.6;
    const right = V().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const side = r() < 0.5 ? -1 : 1;
    const dir = V().addScaledVector(right, side).add(V((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6)).normalize();
    const start = V(O.x + dir.x * 30, O.y + 1, O.z + dir.z * 30);
    const apex = 7;
    const path = (s, out) => {
      out.lerpVectors(start, O, s);
      out.y += 4 * apex * s * (1 - s) + (1 - s) * 0.5;
      return out;
    };
    const ease = (u) => Math.pow(u, 1.25);
    const hp = V();
    const hp2 = V();
    const n = Math.round(150 * Math.max(0.5, ctx.q));
    T.particles({
      count: n, exact: true, texture: tex.puff, atlas: true, order: 3, t0: -PRE,
      colors: [C('#fff0d0', 4), C('#c8c0b4', 0.9), C('#8a8680', 0.6), C('#6a6864', 0.5), C('#4a4846', 0.4)],
      stops: [0.05, 0.2, 0.6], alpha: [0.05, 0.5, 0.55, 0], occ: [0.05, 0.2, 0.9],
      sizeEase: 1.4, turb: [0.3, 0.8],
      spawn(i, p) {
        const u = i / n;
        path(ease(u), hp);
        p.x = hp.x + r.range(-0.08, 0.08); p.y = hp.y; p.z = hp.z + r.range(-0.08, 0.08);
        p.vx = r.range(-0.2, 0.2); p.vy = r.range(0.05, 0.3); p.vz = r.range(-0.2, 0.2);
        p.drag = 0.8; p.delay = u * PRE; p.life = r.range(2.2, 3.6);
        p.s0 = r.range(0.12, 0.2); p.s1 = r.range(0.8, 1.3); p.rot = r() * 6.28; p.spin = r.range(-0.5, 0.5);
      },
    });
    const head = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const halo = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const HEAD = C('#fff4e0');
    const FLAME = C('#ff9a40');
    return {
      sound(tDet) { ctx.audio.meteorIncoming(ctx.bus, tDet - PRE, tDet); },
      update(t) {
        T.tick(t);
        if (t < -PRE || t >= 0) { head.hide(); halo.hide(); return; }
        const u = (t + PRE) / PRE;
        path(ease(u), hp);
        path(Math.max(0, ease(u) - 0.01), hp2);
        head.set(hp, 0.45, 0.45, 7, HEAD);
        halo.set(hp, 1.4, 1.4, 2.2 * (0.8 + 0.2 * Math.sin(t * 60)), FLAME);
        stage.light(3, hp, FLAME, 8, 5);
      },
      dispose() { T.dispose(); },
    };
  }
  B.buildMissile = buildMissile;

  B.makeCustomEffect = makeCustom;
  B.CUSTOM_DEFAULTS = CUSTOM_DEFAULTS;
  B.powerInfo = powerInfo;
  B.fxKit = { Take, V, C, colorKeys };

  // =====================================================================
  // FX-12 · Nuclear (visual de cinema, sem escala nem cálculo real)
  // =====================================================================
  function buildNuclear(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const d = V();
    const fireC = [C('#fffbe8', 7), C('#ffc060', 3.4), C('#ff6a1e', 1.6), C('#4a2c20', 0.8), C('#2e2826', 0.62)];
    const stem = T.particles({
      count: 140, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#ffb060', 3.2), C('#a0421a', 1.2), C('#40302a', 0.62), C('#302a28', 0.52), C('#262424', 0.46)],
      stops: [0.08, 0.25, 0.6], alpha: [0.05, 0.6, 0.8, 0], occ: [0.05, 0.3, 0.95],
      sizeEase: 1.5, turb: [0.3, 0.7], lit: 0.8, ground: [O.y, 0.4],
      spawn(i, p) {
        r.disk(d, 0.5);
        p.x = O.x + d.x; p.y = O.y + 0.2; p.z = O.z + d.z;
        p.vx = d.x * 0.2; p.vy = r.range(2, 4); p.vz = d.z * 0.2;
        p.drag = 0.36; p.ay = 0.1; p.delay = 0.2 + r() * 3.5; p.life = r.range(5, 7);
        p.s0 = r.range(0.45, 0.65); p.s1 = r.range(1.2, 1.8); p.rot = r() * 6.28; p.spin = r.range(-0.4, 0.4);
      },
    });
    // capa em anel (toro) que sobe e rola para fora: a forma de cogumelo
    const cap = T.particles({
      count: 220, texture: tex.puff, atlas: true, order: 4, swirl: 0.8,
      colors: fireC, stops: [0.07, 0.2, 0.42], alpha: [0.03, 0.72, 0.9, 0], occ: [0.07, 0.3, 0.97],
      sizeEase: 1.6, turb: [0.35, 0.7], lit: 0.7, ground: [O.y, 0.4],
      spawn(i, p) {
        const a = r() * Math.PI * 2;
        const ring = r.range(0.3, 1);
        p.x = O.x + Math.cos(a) * ring * 0.5; p.y = O.y + 0.4 + r() * 0.3; p.z = O.z + Math.sin(a) * ring * 0.5;
        const out = r.range(0.8, 2.8) * ring;
        p.vx = Math.cos(a) * out; p.vy = r.range(5, 6.5) - ring * 0.8; p.vz = Math.sin(a) * out;
        p.drag = 0.55; p.ay = 0.22; p.delay = r() * 0.2; p.life = r.range(8, 11);
        p.s0 = r.range(0.7, 1.1); p.s1 = r.range(2.6, 3.8); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });
    const skirt = T.particles({
      count: 90, texture: tex.puff, atlas: true, order: 2,
      colors: [C('#b09070', 1.2), C('#6d5a48', 0.8), C('#40382f', 0.58), C('#302c28', 0.48), C('#262525', 0.42)],
      stops: [0.1, 0.35, 0.7], alpha: [0.05, 0.4, 0.4, 0], occ: [0, 0.1, 0.9],
      sizeEase: 2, turb: [0.4, 0.7], lit: 0.7, ground: [O.y, 0.3],
      spawn(i, p, n) {
        const a = (i / n) * Math.PI * 2 + r() * 0.2;
        const sp = r.range(8, 12);
        p.x = O.x + Math.cos(a) * 0.6; p.y = O.y + 0.15; p.z = O.z + Math.sin(a) * 0.6;
        p.vx = Math.cos(a) * sp; p.vy = r.range(0.3, 1.2); p.vz = Math.sin(a) * sp;
        p.drag = 1.3; p.ay = 0.25; p.delay = 0.12 + r() * 0.15; p.life = r.range(3, 5);
        p.s0 = r.range(0.6, 0.9); p.s1 = r.range(2.6, 3.4); p.rot = r() * 6.28;
      },
    });
    T.particles({
      count: 260, texture: tex.spark, streak: true, stretch: 0.07, order: 6,
      colors: [C('#fffaf0', 6), C('#ffd08a', 4), C('#ff7020', 2.2), C('#b02a08', 0.9), C('#300800', 0.15)],
      stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.7, 1, 0], ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        r.hemi(d, 0.25, 1.5);
        const sp = r.range(7, 15);
        p.x = O.x; p.y = O.y + 0.3; p.z = O.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 0.8; p.ay = -9; p.delay = r() * 0.1; p.life = r.range(1, 2.4);
        p.s0 = p.s1 = r.range(0.022, 0.045);
      },
    });
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const ball = T.add(new P.Glow({ tex: tex.glow, order: 11 }));
    const wilson = T.add(new P.Dome({ tex: tex.noise, hemisphere: false, colorA: C('#ffffff', 1.1), colorB: C('#cfe0ff', 0.4), noise: 0.5, core: 0.03, power: 3 }));
    const ring = T.add(new P.Ring({ camera, billboard: false, order: 9 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const center = V(O.x, O.y + 1.2, O.z);
    const ballC = V();
    const ringC = V();
    const lpos = V();
    const lcol = V();
    const litc = V();
    const WH = C('#ffffff');
    const LCOL = [[0, C('#ffffff')], [0.8, C('#ffe2a8')], [2.5, C('#ff9a4a')], [6, C('#ff5a1c')], [11, C('#8a2808')]];
    const LI = [[0, 0], [0.08, 42], [1, 24], [3, 12], [7, 4], [12, 0]];

    return {
      duration: 13,
      sound(tDet) {
        const a = ctx.audio;
        a.boom(ctx.bus, tDet, { power: 1.5, bright: 0.85, length: 1.8, crackle: 0.8, rng: r });
        a.boom(ctx.bus, tDet + 0.9, { power: 0.7, bright: 0.6, length: 1.4, crackle: 0.2, rng: r });
        a.noise(ctx.bus, tDet + 0.3, { buf: 'brown', dur: 11, gain: 0.45, attack: 1.2, hold: 3, tau: 2.6, filter: { type: 'lowpass', f0: 140 }, wet: 0.6 });
        a.noise(ctx.bus, tDet + 0.5, { dur: 3, gain: 0.12, attack: 0.3, tau: 0.9, filter: { type: 'bandpass', f0: 500, f1: 150, glide: 2.5, q: 0.6 }, wet: 0.5 });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { flash.hide(); streak.hide(); ball.hide(); wilson.hide(); ring.hide(); if (flare) flare.hide(); return f; }
        const I = keys(LI, t) * (1 + 0.12 * noise1(t * 5));
        colorKeys(lcol, LCOL, t);
        const rise = O.y + 1.2 + Math.min(t, 7) * 1.05;
        lpos.set(O.x, rise, O.z);
        stage.light(0, lpos, lcol, I, 9);
        stage.light(1, center, lcol, I * 0.5 * Math.exp(-t * 0.4), 6);
        litc.copy(lcol).multiplyScalar(I * 0.05);
        cap.light(lpos, litc); stem.light(lpos, litc); skirt.light(lpos, litc);
        const fl = envelope(t, 0.08, 0.7);
        const fs = 5 + 12 * easeOutCubic(t / 0.8);
        flash.set(center, fs, fs, 11 * fl, WH);
        streak.set(center, 34, 0.4, 3.5 * envelope(t, 0.08, 1), WH);
        // bola de fogo brilhante que sobe e escurece
        ballC.set(O.x, O.y + 0.9 + Math.min(t, 5) * 1.1, O.z);
        const bs = 2 + 1.6 * easeOutCubic(t / 1.2);
        ball.set(ballC, bs, bs, 6 * Math.exp(-t * 0.55), lcol);
        const w = clamp01((t - 0.25) / 1.3);
        wilson.set(center, 8.5 * easeOutCubic(w), 0.6 * Math.pow(1 - w, 1.6) * (t > 0.25 ? 1 : 0), t);
        const wr = clamp01((t - 1.2) / 2.2);
        ringC.set(O.x, O.y + 4.5 + wr * 2, O.z);
        ring.set(ringC, 7 * easeOutCubic(wr), 0.05, 1.1 * Math.pow(1 - wr, 1.5) * (t > 1.2 ? 1 : 0), WH, flat, 0.12);
        const wt = clamp01(t / 3.4);
        stage.wave(0, O.x, O.z, 18 * easeOutCubic(wt), 3 * Math.pow(1 - wt, 1.5), 0.3 + 1 * wt, lcol);
        const wt2 = clamp01((t - 0.5) / 4);
        stage.wave(1, O.x, O.z, 12 * easeOutCubic(wt2), 1.2 * Math.pow(1 - wt2, 1.4) * (t > 0.5 ? 1 : 0), 0.8 + wt2, C('#c49060'));
        stage.setHeat(O.x, O.z, 3.2, 3 * envelope(t, 0.2, 4), C('#ff6a20'));
        if (flare) flare.set(center, 1.8 * envelope(t, 0.08, 1));
        f.flash = (reduced ? 0.25 : 1) * envelope(t, 0.07, 0.6);
        f.flashColor.copy(WH);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : 1.5 * Math.exp(-t * 1.3) * smooth(t / 0.05) + 0.5 * envelope(t - 0.9, 0.05, 0.4);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-06 · Coluna solar
  // =====================================================================
  function buildSolar(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const d = V();
    const stem = T.particles({
      count: 110, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#ffb060', 3), C('#a0421a', 1.1), C('#3a2c26', 0.6), C('#2c2826', 0.5), C('#242323', 0.45)],
      stops: [0.08, 0.25, 0.6], alpha: [0.05, 0.6, 0.75, 0], occ: [0.05, 0.3, 0.95],
      sizeEase: 1.5, turb: [0.35, 0.7], lit: 0.7, ground: [O.y, 0.4],
      spawn(i, p) {
        r.disk(d, 0.45);
        p.x = O.x + d.x; p.y = O.y + 0.2; p.z = O.z + d.z;
        p.vx = d.x * 0.3; p.vy = r.range(1.6, 3.4); p.vz = d.z * 0.3;
        p.drag = 0.38; p.ay = 0.1; p.delay = 0.15 + r() * 3.2; p.life = r.range(4, 6);
        p.s0 = r.range(0.4, 0.6); p.s1 = r.range(1.1, 1.6); p.rot = r() * 6.28; p.spin = r.range(-0.4, 0.4);
      },
    });
    const cap = T.particles({
      count: 150, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#fff2d6', 6), C('#ffb14a', 3), C('#e0501a', 1.3), C('#3a2a22', 0.8), C('#2a2624', 0.6)],
      stops: [0.08, 0.22, 0.45], alpha: [0.03, 0.7, 0.85, 0], occ: [0.08, 0.35, 0.95],
      sizeEase: 1.6, turb: [0.4, 0.8], lit: 0.6, ground: [O.y, 0.4],
      spawn(i, p) {
        const a = r() * Math.PI * 2;
        const out = r.range(0.6, 2.4);
        p.x = O.x + Math.cos(a) * 0.4; p.y = O.y + 0.4; p.z = O.z + Math.sin(a) * 0.4;
        p.vx = Math.cos(a) * out; p.vy = r.range(4.2, 5.6); p.vz = Math.sin(a) * out;
        p.drag = 0.55; p.ay = 0.2; p.delay = r() * 0.25; p.life = r.range(7, 10);
        p.s0 = r.range(0.6, 1.0); p.s1 = r.range(2.4, 3.6); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });
    const dust = T.particles({
      count: 70, texture: tex.puff, atlas: true, order: 2,
      colors: [C('#9a7a5c', 1.1), C('#5d4d3e', 0.75), C('#3a342e', 0.55), C('#2c2a28', 0.45), C('#232323', 0.4)],
      stops: [0.1, 0.35, 0.7], alpha: [0.05, 0.4, 0.3, 0], occ: [0.0, 0.1, 0.85],
      sizeEase: 2, turb: [0.3, 0.8], lit: 0.6, ground: [O.y, 0.25],
      spawn(i, p, n) {
        const a = (i / n) * Math.PI * 2 + r() * 0.2;
        const sp = r.range(7, 11);
        p.x = O.x + Math.cos(a) * 0.6; p.y = O.y + 0.12; p.z = O.z + Math.sin(a) * 0.6;
        p.vx = Math.cos(a) * sp; p.vy = r.range(0.2, 0.7); p.vz = Math.sin(a) * sp;
        p.drag = 1.5; p.ay = 0.2; p.delay = 0.1 + r() * 0.1; p.life = r.range(2.5, 4);
        p.s0 = r.range(0.5, 0.7); p.s1 = r.range(2, 2.8); p.rot = r() * 6.28;
      },
    });
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const streak = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const ring = T.add(new P.Ring({ camera, billboard: false, order: 9 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const center = V(O.x, O.y + 1, O.z);
    const ringC = V();
    const lpos = V();
    const lcol = V();
    const litc = V();
    const WHITEY = C('#fffbe8');
    const LCOL = [[0, C('#fffbe8')], [1, C('#ffd08a')], [3, C('#ff8a3a')], [8, C('#b3300c')]];
    const LI = [[0, 0], [0.08, 34], [1.2, 18], [3, 10], [7, 3], [11, 0]];

    return {
      duration: 12,
      sound(tDet) {
        ctx.audio.boom(ctx.bus, tDet, { power: 1.3, bright: 0.9, length: 1.6, crackle: 0.6, rng: r });
        ctx.audio.noise(ctx.bus, tDet + 0.3, { buf: 'brown', dur: 9, gain: 0.35, attack: 1.5, hold: 2, tau: 2.2, filter: { type: 'lowpass', f0: 160 }, wet: 0.6 });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { flash.hide(); streak.hide(); ring.hide(); if (flare) flare.hide(); return f; }
        const I = keys(LI, t) * (1 + 0.15 * noise1(t * 6));
        colorKeys(lcol, LCOL, t);
        lpos.set(O.x, O.y + 1.5 + Math.min(t, 6) * 1.1, O.z);
        stage.light(0, lpos, lcol, I, 8);
        litc.copy(lcol).multiplyScalar(I * 0.05);
        cap.light(lpos, litc); stem.light(lpos, litc); dust.light(lpos, litc);
        const fl = envelope(t, 0.08, 0.5);
        const fs = 4 + 8 * easeOutCubic(t / 0.6);
        flash.set(center, fs, fs, 10 * fl, WHITEY);
        streak.set(center, 26, 0.35, 3.5 * envelope(t, 0.08, 0.7), WHITEY);
        const w = clamp01((t - 0.5) / 1.8);
        ringC.set(O.x, O.y + 3.2 + w * 1.5, O.z);
        ring.set(ringC, 7.5 * easeOutCubic(w), 0.05, 1.2 * Math.pow(1 - w, 1.5) * (t > 0.5 ? 1 : 0), ONE, flat, 0.15);
        const wt = clamp01(t / 3);
        stage.wave(0, O.x, O.z, 15 * easeOutCubic(wt), 2.6 * Math.pow(1 - wt, 1.5), 0.3 + 0.9 * wt, lcol);
        stage.setHeat(O.x, O.z, 3, 2.4 * envelope(t, 0.2, 4), C('#ff6a20'));
        if (flare) flare.set(center, 1.5 * envelope(t, 0.06, 0.8));
        f.flash = (reduced ? 0.25 : 0.9) * envelope(t, 0.06, 0.4);
        f.flashColor.copy(WHITEY);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : 1.1 * Math.exp(-t * 1.6) * smooth(t / 0.05);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-07 · Onda fantasma
  // =====================================================================
  function buildGhost(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage } = ctx;
    const d = V();
    const G = C('#7dffb0');
    const G2 = C('#38ffd0');
    const PALE = C('#eafff4');
    const Cc = V(O.x, O.y + 1.2, O.z);
    T.particles({
      count: 300, texture: tex.glow, order: 5, origin: Cc,
      colors: [WHITE(3.5), WHITE(2.6), WHITE(1.6), WHITE(0.7), WHITE(0)],
      stops: [0.2, 0.5, 0.8], alpha: [0.2, 0.6, 1, 0.8], colorMix: 1,
      turb: [0.4, 1.1], swirl: 0.6, ground: [O.y, 0.1],
      spawn(i, p) {
        r.sphere(d);
        const rad = r.range(1, 7);
        p.x = Cc.x + d.x * rad; p.y = Math.max(O.y + 0.2, Cc.y + d.y * rad * 0.5); p.z = Cc.z + d.z * rad;
        p.vy = r.range(0.2, 0.7); p.drag = 0.5;
        p.delay = 0.2 + r() * 3; p.life = r.range(2, 4);
        p.s0 = r.range(0.06, 0.12); p.s1 = 0.03;
        const c = r() < 0.6 ? G : G2;
        p.r = c.x; p.g = c.y; p.b = c.z;
      },
    });
    const sphere = T.add(new P.Dome({ tex: tex.noise, hemisphere: false, colorA: C('#aaffd4', 0.9), colorB: C('#1f8f6a', 0.5), noise: 0.6, core: 0.02, power: 3 }));
    const glow = T.add(new P.Glow({ tex: tex.glow, order: 12 }));

    return {
      duration: 7.5,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.tone(b, tDet, { f0: 62, f1: 38, glide: 4, dur: 6, gain: 0.5, attack: 0.08, hold: 0.4, tau: 1.4, wet: 0.5 });
        a.tone(b, tDet, { type: 'triangle', f0: 124, f1: 80, glide: 3, dur: 5, gain: 0.08, attack: 0.3, tau: 1, wet: 0.8 });
        a.noise(b, tDet + 0.1, { dur: 5, gain: 0.06, attack: 0.6, hold: 0.5, tau: 1.2, filter: { type: 'bandpass', f0: 3000, f1: 7000, glide: 4, q: 3 }, wet: 0.9 });
        a.fm(b, tDet, { f0: 180, f1: 90, glide: 2, ratio: 1.5, index0: 200, index1: 5, dur: 3, gain: 0.08, attack: 0.3, tau: 0.8, wet: 0.9 });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { sphere.hide(); glow.hide(); return f; }
        const s = clamp01(t / 2.4);
        sphere.set(Cc, 7 * easeOutCubic(t / 2.2), 0.8 * Math.pow(1 - s, 1.5), t * 1.5);
        glow.set(Cc, 3, 3, 4 * envelope(t, 0.1, 1.2), PALE);
        for (let i = 0; i < 3; i++) {
          const w = clamp01((t - i * 0.5) / 2.8);
          stage.wave(i, O.x, O.z, 12 * easeOutCubic(w), 1.8 * Math.pow(1 - w, 1.3) * (t > i * 0.5 ? 1 : 0), 0.2 + 0.4 * w, i === 1 ? G2 : G);
        }
        stage.light(0, Cc, G, 20 * Math.exp(-t * 0.5) * (0.75 + 0.25 * Math.sin(t * 5)), 8);
        f.dim = 1 - 0.4 * smooth(t / 0.6) * (1 - smooth((t - 3.5) / 2));
        stage.dim = f.dim;
        f.flash = (reduced ? 0.12 : 0.35) * envelope(t, 0.1, 0.4);
        f.flashColor.copy(G);
        f.flashPos.copy(Cc);
        f.shake = reduced ? 0 : 0.2 * envelope(t, 0.1, 0.8);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-08 · Tapete de chamas
  // =====================================================================
  function buildCarpet(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, q } = ctx;
    const SPEED = 3.2;
    const lines = [];
    const nl = 7;
    for (let i = 0; i < nl; i++) {
      const a = (i / nl) * Math.PI * 2 + r.range(-0.2, 0.2);
      lines.push({ dx: Math.cos(a), dz: Math.sin(a), len: r.range(5, 8) });
    }
    const along = (n) => {
      const out = [];
      for (const L of lines) {
        const m = Math.max(4, Math.round(n * q));
        for (let k = 0; k < m; k++) out.push({ L, dist: (k / m) * L.len });
      }
      return out;
    };
    const fireR = along(26);
    const smokeR = along(8);
    const place = (p, rec, jitter) => {
      const perp = r.range(-jitter, jitter);
      p.x = O.x + rec.L.dx * rec.dist - rec.L.dz * perp;
      p.z = O.z + rec.L.dz * rec.dist + rec.L.dx * perp;
    };
    const fire = T.particles({
      count: fireR.length, exact: true, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#fff0c8', 5), C('#ffa040', 3), C('#e04a14', 1.4), C('#3a2418', 0.8), C('#221c1a', 0.6)],
      stops: [0.1, 0.3, 0.55], alpha: [0.05, 0.55, 0.9, 0], occ: [0.15, 0.5, 0.9],
      sizeEase: 1.6, turb: [0.25, 1.6], ground: [O.y, 0.2],
      spawn(i, p) {
        const rec = fireR[i];
        place(p, rec, 0.25);
        p.y = O.y + 0.1;
        p.vx = rec.L.dx * 0.3; p.vy = r.range(0.6, 1.5); p.vz = rec.L.dz * 0.3;
        p.drag = 1.2; p.ay = 1.2; p.delay = 0.05 + rec.dist / SPEED + r() * 0.1; p.life = r.range(1.4, 2.6);
        p.s0 = r.range(0.25, 0.4); p.s1 = r.range(0.9, 1.3); p.rot = r() * 6.28; p.spin = r.range(-0.8, 0.8);
      },
    });
    const embers = T.particles({
      count: fireR.length, exact: true, texture: tex.glow, order: 5,
      colors: [C('#ffd08a', 7), C('#ff9a3c', 5), C('#ff5a1e', 3), C('#c02a0a', 1.4), C('#400a00', 0.3)],
      stops: [0.2, 0.5, 0.8], alpha: [0.1, 0.6, 1, 0.7], turb: [0.4, 2.2], ground: [O.y, 0.1],
      spawn(i, p) {
        const rec = fireR[i];
        place(p, rec, 0.4);
        p.y = O.y + 0.2;
        p.vy = r.range(0.5, 1.6); p.drag = 0.8; p.ay = 0.2;
        p.delay = 0.3 + rec.dist / SPEED + r() * 2.5; p.life = r.range(1.8, 3.5);
        p.s0 = r.range(0.04, 0.07); p.s1 = 0.02;
      },
    });
    const smoke = T.particles({
      count: smokeR.length, exact: true, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#5a3a26', 0.9), C('#2d2622', 0.5), C('#201e1d', 0.42), C('#1c1c1d', 0.4), C('#18191b', 0.38)],
      stops: [0.12, 0.4, 0.75], alpha: [0.1, 0.55, 0.5, 0], occ: [0, 0.1, 0.95],
      sizeEase: 1.5, turb: [0.5, 0.5], lit: 0.5, ground: [O.y, 0.3],
      spawn(i, p) {
        const rec = smokeR[i];
        place(p, rec, 0.4);
        p.y = O.y + 0.3;
        p.vy = r.range(0.4, 0.9); p.drag = 0.5; p.ay = 0.15;
        p.delay = 0.5 + rec.dist / SPEED + r() * 0.6; p.life = r.range(4, 6);
        p.s0 = r.range(0.7, 0.9); p.s1 = r.range(2, 2.8); p.rot = r() * 6.28; p.spin = r.range(-0.2, 0.2);
      },
    });
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const FIRE = C('#ff8a3a');
    const lpos = V();
    const litc = V();
    const maxLen = Math.max(...lines.map((L) => L.len));

    return {
      duration: 9,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.tone(b, tDet, { f0: 90, f1: 40, glide: 0.4, dur: 1.2, gain: 0.6, attack: 0.003, tau: 0.25, wet: 0.2 });
        a.noise(b, tDet, { dur: 1.2, gain: 0.35, attack: 0.02, tau: 0.35, filter: { type: 'bandpass', f0: 300, f1: 1400, glide: 0.6, q: 0.8 }, wet: 0.4 });
        a.noise(b, tDet + 0.2, { buf: 'brown', dur: 7, gain: 0.5, attack: 0.5, hold: 2.2, tau: 1.3, filter: { type: 'lowpass', f0: 420 }, wet: 0.4 });
        for (let i = 0; i < 40; i++) {
          const tt = tDet + 0.3 + r() * 4.5;
          a.noise(b, tt, { dur: 0.05, gain: 0.03 + r() * 0.08, attack: 0.001, tau: 0.012, filter: { type: 'bandpass', f0: 1500 + r() * 3500, q: 1.4 }, pan: r() * 1.6 - 0.8, wet: 0.3 });
        }
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { flash.hide(); return f; }
        const fade = 1 - smooth((t - 4) / 3.5);
        for (let i = 0; i < 3; i++) {
          const L = lines[i * 2];
          const reach = Math.min(L.len, t * SPEED);
          lpos.set(O.x + L.dx * reach, O.y + 0.6, O.z + L.dz * reach);
          stage.light(i, lpos, FIRE, 9 * fade * smooth(t / 0.2), 4);
          if (i === 0) {
            litc.copy(FIRE).multiplyScalar(0.6 * fade);
            smoke.light(lpos, litc);
          }
        }
        const front = Math.min(maxLen, t * SPEED);
        stage.wave(0, O.x, O.z, front, 0.9 * fade, 0.5, FIRE);
        stage.setHeat(O.x, O.z, 0.8 + front * 0.6, 1.3 * fade, C('#ff5a14'));
        flash.set(V(O.x, O.y + 0.4, O.z), 4, 4, 6 * envelope(t, 0.04, 0.2), C('#ffd8a0'));
        f.flash = (reduced ? 0.1 : 0.3) * envelope(t, 0.04, 0.15);
        f.flashColor.copy(FIRE);
        f.flashPos.set(O.x, O.y + 0.4, O.z);
        f.shake = reduced ? 0 : 0.35 * envelope(t, 0.02, 0.4);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-09 · Chuva de faíscas
  // =====================================================================
  function buildCluster(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, q } = ctx;
    const d = V();
    const bursts = [];
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2;
      const rad = i === 0 ? 0 : 0.6 + Math.sqrt(r()) * 3.8;
      bursts.push({ t: 0.05 + i * 0.17 + r() * 0.08, p: V(O.x + Math.cos(a) * rad, O.y + 0.15, O.z + Math.sin(a) * rad) });
    }
    const recs = (n) => {
      const out = [];
      for (const b of bursts) for (let k = 0, m = Math.max(3, Math.round(n * q)); k < m; k++) out.push(b);
      return out;
    };
    const fireR = recs(12);
    const sparkR = recs(40);
    const smokeR = recs(5);
    T.particles({
      count: fireR.length, exact: true, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#fff2d6', 6), C('#ffb14a', 3.2), C('#ff5a1a', 1.4), C('#2a1d17', 0.9), C('#161413', 0.8)],
      stops: [0.1, 0.28, 0.55], alpha: [0.03, 0.55, 0.95, 0], occ: [0.1, 0.4, 0.95],
      sizeEase: 2, turb: [0.15, 1.4], ground: [O.y, 0.2],
      spawn(i, p) {
        const b = fireR[i];
        r.hemi(d, 0.1, 1.4);
        const sp = r.range(1, 2.8);
        p.x = b.p.x; p.y = b.p.y; p.z = b.p.z;
        p.vx = d.x * sp; p.vy = d.y * sp + 0.5; p.vz = d.z * sp;
        p.drag = 3; p.ay = 1; p.delay = b.t + r() * 0.05; p.life = r.range(0.9, 1.6);
        p.s0 = r.range(0.2, 0.3); p.s1 = r.range(0.7, 1); p.rot = r() * 6.28; p.spin = r.range(-1, 1);
      },
    });
    T.particles({
      count: sparkR.length, exact: true, texture: tex.spark, streak: true, stretch: 0.06, order: 6,
      colors: [C('#fff4dc', 6), C('#ffc060', 4), C('#ff7020', 2.2), C('#b02a08', 0.9), C('#300800', 0.15)],
      stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.7, 1, 0], ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        const b = sparkR[i];
        r.hemi(d, 0.2, 1.45);
        const sp = r.range(4, 9);
        p.x = b.p.x; p.y = b.p.y + 0.1; p.z = b.p.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 1; p.ay = -9; p.delay = b.t + r() * 0.04; p.life = r.range(0.5, 1.2);
        p.s0 = p.s1 = r.range(0.018, 0.035);
      },
    });
    const smoke = T.particles({
      count: smokeR.length, exact: true, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#5a3a26', 0.9), C('#2d2622', 0.5), C('#201e1d', 0.42), C('#1c1c1d', 0.4), C('#18191b', 0.38)],
      stops: [0.12, 0.4, 0.75], alpha: [0.1, 0.55, 0.5, 0], occ: [0, 0.1, 0.95],
      sizeEase: 1.5, turb: [0.4, 0.5], lit: 0.5, ground: [O.y, 0.3],
      spawn(i, p) {
        const b = smokeR[i];
        r.disk(d, 0.4);
        p.x = b.p.x + d.x; p.y = b.p.y + 0.3; p.z = b.p.z + d.z;
        p.vy = r.range(0.6, 1.4); p.drag = 0.6; p.ay = 0.15;
        p.delay = b.t + 0.2 + r() * 0.3; p.life = r.range(3, 5);
        p.s0 = r.range(0.5, 0.7); p.s1 = r.range(1.5, 2.1); p.rot = r() * 6.28;
      },
    });
    T.particles({
      count: bursts.length, exact: true, texture: tex.glow, order: 8,
      colors: [C('#fff4dc', 7), C('#ffc070', 4), C('#ff7020', 1.5), C('#401000', 0.3), WHITE(0)],
      stops: [0.2, 0.5, 0.8], alpha: [0.02, 0.2, 1, 0],
      spawn(i, p) {
        const b = bursts[i];
        p.x = b.p.x; p.y = b.p.y + 0.3; p.z = b.p.z;
        p.drag = 1; p.delay = b.t; p.life = 0.35; p.s0 = 0.3; p.s1 = 2;
      },
    });
    const FIRE = C('#ffae5a');
    const WAVE = C('#ffb676');
    const litc = V();
    const last = bursts[bursts.length - 1].t;

    return {
      duration: last + 5,
      sound(tDet) {
        for (const b of bursts) ctx.audio.boom(ctx.bus, tDet + b.t, { power: 0.4, bright: 1.3, length: 0.45, crackle: 0.25, rng: r });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) return f;
        let li = 0;
        let wi = 0;
        for (let i = bursts.length - 1; i >= 0; i--) {
          const b = bursts[i];
          const age = t - b.t;
          if (age < 0) continue;
          if (li < 3 && age < 1.2) {
            const I = 9 * envelope(age, 0.02, 0.3);
            stage.light(li, b.p, FIRE, I, 4);
            if (li === 0) {
              litc.copy(FIRE).multiplyScalar(I * 0.05);
              smoke.light(b.p, litc);
              f.flashPos.copy(b.p);
            }
            f.flash = Math.max(f.flash, (reduced ? 0.06 : 0.22) * envelope(age, 0.02, 0.1));
            f.shake = Math.max(f.shake, reduced ? 0 : 0.3 * envelope(age, 0.01, 0.25));
            li++;
          }
          if (wi < 4 && age < 0.9) {
            const w = clamp01(age / 0.9);
            stage.wave(wi, b.p.x, b.p.z, 2.4 * easeOutCubic(w), 2 * (1 - w), 0.15 + 0.2 * w, WAVE);
            wi++;
          }
        }
        stage.setHeat(O.x, O.z, 3.5, 1.2 * envelope(t, 0.3, 2.5), C('#ff5a14'));
        f.flashColor.copy(FIRE);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-10 · Nuvem de ignição
  // =====================================================================
  function buildIgnition(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const IGN = 1.3;
    const d = V();
    T.particles({
      count: 90, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#d8d4b0', 0.5), C('#c9c49a', 0.45), C('#b0aa84', 0.4), C('#8a8466', 0.3), C('#5a5644', 0.2)],
      stops: [0.2, 0.5, 0.8], alpha: [0.15, 0.4, 0.32, 0], occ: [0, 0.2, 0.55],
      sizeEase: 1.4, turb: [0.3, 0.6], ground: [O.y, 0.3],
      spawn(i, p) {
        r.disk(d, 0.6);
        const a = r() * Math.PI * 2;
        const sp = r.range(3, 6);
        p.x = O.x + d.x; p.y = O.y + 0.25; p.z = O.z + d.z;
        p.vx = Math.cos(a) * sp; p.vy = r.range(0.2, 0.6); p.vz = Math.sin(a) * sp;
        p.drag = 1.4; p.delay = r() * 0.3; p.life = IGN + r.range(0.1, 0.5);
        p.s0 = r.range(0.6, 0.9); p.s1 = r.range(2, 2.8); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });
    const fire = T.particles({
      count: 140, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#fffbe8', 3.2), C('#ffb14a', 2.2), C('#ff5a1a', 1.2), C('#2a1d17', 0.9), C('#161413', 0.8)],
      stops: [0.1, 0.28, 0.55], alpha: [0.03, 0.55, 0.95, 0], occ: [0.1, 0.4, 0.95],
      sizeEase: 2, turb: [0.3, 1.2], lit: 0.4, ground: [O.y, 0.3],
      spawn(i, p) {
        r.disk(d, 4.5);
        const dist = Math.hypot(d.x, d.z);
        p.x = O.x + d.x; p.y = O.y + r.range(0.2, 1); p.z = O.z + d.z;
        p.vx = d.x * 0.15; p.vy = r.range(1, 2.5); p.vz = d.z * 0.15;
        p.drag = 1.5; p.ay = 1.2; p.delay = IGN + dist * 0.06 + r() * 0.05; p.life = r.range(1.2, 2.4);
        p.s0 = r.range(0.5, 0.8); p.s1 = r.range(1.6, 2.2); p.rot = r() * 6.28; p.spin = r.range(-0.6, 0.6);
      },
    });
    const smoke = T.particles({
      count: 80, texture: tex.puff, atlas: true, order: 2,
      colors: [C('#5a3a26', 0.9), C('#2d2622', 0.5), C('#201e1d', 0.42), C('#1c1c1d', 0.4), C('#18191b', 0.38)],
      stops: [0.12, 0.4, 0.75], alpha: [0.08, 0.55, 0.65, 0], occ: [0, 0.08, 1],
      sizeEase: 1.6, turb: [0.6, 0.5], lit: 0.5, ground: [O.y, 0.4],
      spawn(i, p) {
        r.disk(d, 4);
        p.x = O.x + d.x; p.y = O.y + 0.6; p.z = O.z + d.z;
        p.vy = r.range(1, 2); p.drag = 0.5; p.ay = 0.25;
        p.delay = IGN + 0.4 + r() * 1; p.life = r.range(4, 7);
        p.s0 = r.range(0.9, 1.2); p.s1 = r.range(2.6, 3.4); p.rot = r() * 6.28; p.spin = r.range(-0.3, 0.3);
      },
    });
    T.particles({
      count: 200, texture: tex.spark, streak: true, stretch: 0.07, order: 6,
      colors: [C('#fff4dc', 6), C('#ffc060', 4), C('#ff7020', 2.2), C('#b02a08', 0.9), C('#300800', 0.15)],
      stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.7, 1, 0], ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        r.disk(d, 4);
        const dist = Math.hypot(d.x, d.z);
        const h = V();
        r.hemi(h, 0.3, 1.45);
        const sp = r.range(4, 10);
        p.x = O.x + d.x; p.y = O.y + 0.4; p.z = O.z + d.z;
        p.vx = h.x * sp; p.vy = h.y * sp; p.vz = h.z * sp;
        p.drag = 0.9; p.ay = -9; p.delay = IGN + dist * 0.06; p.life = r.range(0.8, 1.8);
        p.s0 = p.s1 = r.range(0.02, 0.04);
      },
    });
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const dome = T.add(new P.Dome({ tex: tex.noise, colorA: C('#fff0dc', 1.3), colorB: C('#ff9a4a', 0.7), noise: 0.35, core: 0.02, power: 4 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const center = V(O.x, O.y + 0.8, O.z);
    const lcol = V();
    const litc = V();
    const LCOL = [[0, C('#fff6e8')], [0.5, C('#ffb060')], [3, C('#ff5a1c')], [7, C('#9a2808')]];
    const LI = [[0, 0], [0.06, 26], [0.5, 13], [2, 7], [5, 2], [8, 0]];
    const FLASHC = C('#fff0d8');

    return {
      duration: IGN + 8,
      sound(tDet) {
        const a = ctx.audio;
        a.noise(ctx.bus, tDet, { dur: IGN + 0.05, env: [[0, 0.0001], [IGN * 0.9, 0.12], [IGN, 0.0001]], filter: { type: 'highpass', f0: 1500, f1: 4000, glide: IGN }, wet: 0.4 });
        a.noise(ctx.bus, tDet + IGN - 0.25, { dur: 0.6, env: [[0, 0.0001], [0.25, 0.35], [0.55, 0.0001]], filter: { type: 'bandpass', f0: 400, f1: 1600, glide: 0.3, q: 0.8 }, wet: 0.4 });
        a.boom(ctx.bus, tDet + IGN, { power: 1.3, bright: 1.1, length: 1.2, rng: r });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        const u = t - IGN;
        if (u < 0) { flash.hide(); dome.hide(); if (flare) flare.hide(); return f; }
        const I = keys(LI, u) * (1 + 0.25 * noise1(u * 10));
        colorKeys(lcol, LCOL, u);
        stage.light(0, center, lcol, I, 7);
        litc.copy(lcol).multiplyScalar(I * 0.05);
        fire.light(center, litc); smoke.light(center, litc);
        const fs = 4 + 8 * easeOutCubic(u / 0.3);
        flash.set(center, fs, fs, 6 * envelope(u, 0.04, 0.16), FLASHC);
        const dt01 = clamp01(u / 0.8);
        dome.set(O, 6.5 * easeOutCubic(dt01), 0.5 * Math.pow(1 - dt01, 2), u);
        const wt = clamp01(u / 2.6);
        stage.wave(0, O.x, O.z, 14 * easeOutCubic(wt), 2.6 * Math.pow(1 - wt, 1.5), 0.25 + 0.8 * wt, C('#ffb676'));
        stage.setHeat(O.x, O.z, 4.5, 2.2 * envelope(u, 0.1, 2.5), C('#ff5a14'));
        if (flare) flare.set(center, 1.3 * envelope(u, 0.04, 0.35));
        f.flash = (reduced ? 0.22 : 0.7) * envelope(u, 0.03, 0.14);
        f.flashColor.copy(FLASHC);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : 1.3 * Math.exp(-u * 2.2) * smooth(u / 0.03);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-11 · Apagão
  // =====================================================================
  function buildBlackout(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage } = ctx;
    const d = V();
    const BL = C('#6fb6ff');
    const ICE = C('#eaf6ff');
    const Cc = V(O.x, O.y + 0.7, O.z);
    const baseSeed = Math.floor(r() * 1e9);
    T.particles({
      count: 180, texture: tex.spark, streak: true, stretch: 0.05, order: 6,
      colors: [C('#ffffff', 6), C('#bfe0ff', 4), C('#6fb6ff', 2.4), C('#2a4aa0', 0.8), C('#0a1030', 0)],
      stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.6, 1, 0], ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        r.hemi(d, 0.1, 1.4);
        const sp = r.range(4, 11);
        p.x = Cc.x; p.y = Cc.y; p.z = Cc.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 1.8; p.ay = -3; p.delay = r() * 0.1; p.life = r.range(0.6, 1.4);
        p.s0 = p.s1 = r.range(0.018, 0.032);
      },
    });
    const bolts = T.add(new P.Lightning({ bolts: 8, levels: 4, width: reduced ? 0.035 : 0.05, order: 10 }));
    const orb = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const list = [];
    for (let i = 0; i < 8; i++) list.push({ a: V(), b: V(), gain: 0, jag: 0.3, taper: 0.5 });
    let lastStep = -999;

    // luzes que voltam: queda e retorno com cintilação, como relés religando
    const dimAt = (t) => {
      if (t < 0.3) return 1;
      if (t < 0.6) return 1 - 0.94 * smooth((t - 0.3) / 0.3);
      if (t < 3.8) return 0.06;
      const back = smooth((t - 3.8) / 2.2);
      const flick = t < 5.6 ? (noise1(t * 14) > 0.1 ? 1 : 0.25) : 1;
      return 0.06 + 0.94 * back * flick;
    };

    return {
      duration: 8,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.fm(b, tDet, { f0: 260, f1: 60, glide: 0.7, ratio: 6.3, index0: 2200, index1: 5, dur: 1.2, gain: 0.4, attack: 0.002, tau: 0.25, wet: 0.5 });
        a.noise(b, tDet, { dur: 0.3, gain: 0.4, attack: 0.001, tau: 0.04, filter: { type: 'highpass', f0: 2500 }, wet: 0.4 });
        a.tone(b, tDet + 0.2, { type: 'sawtooth', f0: 220, f1: 28, glide: 1.6, dur: 1.9, gain: 0.22, attack: 0.02, hold: 1, tau: 0.3, filter: { type: 'lowpass', f0: 1800, f1: 200, glide: 1.6 }, wet: 0.4 });
        a.tone(b, tDet - 0.05, { f0: 60, dur: 0.6, gain: 0.08, attack: 0.01, hold: 0.3, tau: 0.05, wet: 0 });
        for (const k of [4.0, 4.5, 5.0, 5.3]) a.noise(b, tDet + k, { dur: 0.05, gain: 0.25, attack: 0.001, tau: 0.01, filter: { type: 'bandpass', f0: 1800, q: 2 }, wet: 0.3 });
        a.tone(b, tDet + 3.8, { type: 'triangle', f0: 80, f1: 520, glide: 1.8, dur: 2, gain: 0.07, attack: 0.1, hold: 1.4, tau: 0.3, wet: 0.5 });
        a.tone(b, tDet + 5.4, { f0: 60, dur: 2.6, gain: 0.06, attack: 0.5, hold: 1, tau: 0.6, wet: 0.2 });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { orb.hide(); bolts.hide(); return f; }
        const bg = Math.max(0, 1 - t / 1.4);
        if (bg > 0) {
          const step = Math.floor(t / 0.07);
          if (step !== lastStep) {
            lastStep = step;
            const rr = U.rng(baseSeed + step * 7919);
            for (const it of list) {
              const a = rr() * Math.PI * 2;
              const rad = rr.range(2.5, 8);
              it.a.copy(Cc);
              it.b.set(O.x + Math.cos(a) * rad, O.y + 0.02, O.z + Math.sin(a) * rad);
              it.gain = rr.range(0.6, 1.2);
            }
            bolts.regen(list, rr);
          }
          bolts.set(2.2 * bg, BL, ICE);
        } else {
          bolts.hide();
        }
        orb.set(Cc, 2.5, 2.5, 7 * envelope(t, 0.03, 0.3), ICE);
        const w = clamp01(t / 1.2);
        stage.wave(0, O.x, O.z, 16 * easeOutCubic(w), 3 * Math.pow(1 - w, 1.3), 0.2 + 0.5 * w, BL);
        const w2 = clamp01((t - 0.35) / 1.6);
        stage.wave(1, O.x, O.z, 10 * easeOutCubic(w2), 1.6 * Math.pow(1 - w2, 1.3) * (t > 0.35 ? 1 : 0), 0.15 + 0.4 * w2, ICE);
        stage.light(0, Cc, BL, 30 * Math.exp(-t * 3) + 2 * Math.exp(-t * 0.3), 6);
        f.dim = dimAt(t);
        stage.dim = f.dim;
        f.flash = (reduced ? 0.2 : 0.7) * envelope(t, 0.03, 0.12);
        f.flashColor.copy(BL).lerp(ONE, 0.4);
        f.flashPos.copy(Cc);
        f.shake = reduced ? 0 : 0.5 * Math.exp(-t * 3) * smooth(t / 0.03);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }
})();
