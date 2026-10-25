/* Eventos: tornado, tsunami, vulcão, terremoto e ataque alienígena.
   Ficção visual: nada aqui reproduz a física, a escala ou os danos de eventos reais.
   Além do update visual, cada evento devolve "hits": marcas no terreno de blocos
   ({ t, dx, dz, k, R, D, raise, pull, spread, dur }) que o app aplica no tempo certo. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE || !B.fxKit || !B.VoxelBurst) return;
  const THREE = window.THREE;
  const U = B.util;
  const P = B.parts;
  const { Take, V, C } = B.fxKit;
  const { clamp01, smooth, easeOutCubic, envelope, keys, noise1 } = U;

  const PREMULT = {
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  };
  /** malha avulsa como peça da tomada */
  const piece = (mesh, ...extra) => ({
    mesh,
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      for (const e of extra) e.dispose();
    },
  });
  /** direção horizontal sorteada e sua perpendicular */
  function heading(r) {
    const a = r() * Math.PI * 2;
    return { dir: V(Math.cos(a), 0, Math.sin(a)), perp: V(-Math.sin(a), 0, Math.cos(a)) };
  }

  // =====================================================================
  // FX-16 · Tornado: funil de vento que anda devagar e suga os blocos do chão
  // =====================================================================
  const FUNNEL_VERT = /* glsl */ `
    uniform float uTime;
    uniform float uH;
    uniform float uBend;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    varying float vY;
    void main() {
      vec3 p = position;
      float k = clamp(p.y / uH, 0.0, 1.0);
      p.x += sin(p.y * 0.45 + uTime * 1.3) * uBend * k;
      p.z += cos(p.y * 0.38 + uTime * 1.1) * uBend * 0.8 * k;
      vec4 w = modelMatrix * vec4(p, 1.0);
      vW = w.xyz;
      vUv = uv;
      vY = k;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const FUNNEL_FRAG = /* glsl */ `
    uniform sampler2D uNoise;
    uniform float uTime;
    uniform float uSpin;
    uniform float uA;
    uniform vec3 uCol;
    uniform vec3 uGlow;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    varying float vY;
    void main() {
      vec2 nuv = vec2(vUv.x * 2.0 + uTime * uSpin - vY * 0.7, vY * 1.3 - uTime * 0.35);
      float n = texture2D(uNoise, nuv).r * 0.7 + texture2D(uNoise, nuv * 2.1 + 0.4).g * 0.5;
      float dens = smoothstep(0.32, 0.95, n);
      vec3 V = normalize(cameraPosition - vW);
      float edge = pow(abs(dot(normalize(vN), V)), 0.5);
      float fadeY = smoothstep(0.0, 0.05, vY) * (1.0 - smoothstep(0.86, 1.0, vY));
      float a = clamp(dens * (0.3 + 0.7 * edge) * fadeY * uA, 0.0, 0.92);
      vec3 col = uCol * (0.5 + 0.6 * n) + uGlow;
      gl_FragColor = vec4(col * a, a);
    }
  `;

  function buildTornado(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage } = ctx;
    const { dir, perp } = heading(r);
    const END = 11;
    const pathAt = (t, out = V()) => {
      const u = clamp01(t / END);
      return out.copy(O).addScaledVector(dir, -3.5 + 7 * u).addScaledVector(perp, Math.sin(u * Math.PI * 2.2) * 1.6);
    };
    const H = 10;
    const funnels = [];
    for (const [rTop, rBot, spin, a, col] of [[3.2, 0.5, 0.55, 0.85, '#6a6460'], [2.0, 0.28, 1.1, 0.7, '#8a8278']]) {
      const g = new THREE.CylinderGeometry(rTop, rBot, H, 56, 40, true);
      g.translate(0, H / 2, 0);
      const u = {
        uNoise: { value: tex.noise }, uTime: { value: 0 }, uH: { value: H }, uBend: { value: 0.7 },
        uSpin: { value: spin }, uA: { value: 0 }, uCol: { value: C(col, 0.55) }, uGlow: { value: V() },
      };
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: FUNNEL_VERT, fragmentShader: FUNNEL_FRAG, ...PREMULT }));
      m.renderOrder = 4;
      m.visible = false;
      T.add(piece(m));
      funnels.push({ m, u, a });
    }
    const d = V();
    const pp = V();
    // nuvem de tempestade girando lá em cima
    T.particles({
      count: 150, texture: tex.puff, atlas: true, order: 3, swirl: 0.9,
      colors: [C('#3a3c42', 0.6), C('#2a2c31', 0.5), C('#202226', 0.45), C('#1c1d21', 0.42), C('#18191c', 0.4)],
      stops: [0.2, 0.5, 0.8], alpha: [0.12, 0.8, 0.85, 0], occ: [0, 0.1, 1], sizeEase: 1.2, turb: [0.4, 0.4], lit: 0.9,
      spawn(i, p) {
        r.disk(d, 13);
        p.x = O.x + d.x; p.y = O.y + H - 0.5 + r() * 1.6; p.z = O.z + d.z;
        p.vx = -d.z * 0.15; p.vy = 0; p.vz = d.x * 0.15;
        p.drag = 0.3; p.delay = -2.5 + r() * 9; p.life = r.range(5, 7.5);
        p.s0 = r.range(2.5, 3.5); p.s1 = r.range(4, 5.5); p.rot = r() * 6.28; p.spin = r.range(-0.15, 0.15);
      },
    });
    // poeira e detritos girando na base do funil (nascem onde o funil está naquele instante)
    T.particles({
      count: 260, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#8a7660', 1.0), C('#6a5a4a', 0.8), C('#4a4038', 0.6), C('#3a342e', 0.5), C('#2c2826', 0.45)],
      stops: [0.15, 0.45, 0.75], alpha: [0.08, 0.5, 0.6, 0], occ: [0, 0.1, 0.9], sizeEase: 1.4, turb: [0.3, 1], lit: 0.7,
      spawn(i, p) {
        const t0 = 0.6 + r() * (END - 0.8);
        pathAt(t0, pp);
        const a = r() * Math.PI * 2;
        const rad = r.range(0.4, 2.2);
        p.x = pp.x + Math.cos(a) * rad; p.y = O.y + 0.15; p.z = pp.z + Math.sin(a) * rad;
        const tang = r.range(5, 9);
        p.vx = -Math.sin(a) * tang - Math.cos(a) * 1.2; p.vy = r.range(1.5, 5); p.vz = Math.cos(a) * tang - Math.sin(a) * 1.2;
        p.drag = 1.3; p.ay = 0.6; p.delay = t0; p.life = r.range(1.4, 2.4);
        p.s0 = r.range(0.4, 0.7); p.s1 = r.range(1.4, 2.4); p.rot = r() * 6.28; p.spin = r.range(-2, 2);
      },
    });
    // raios na nuvem
    const bolts = T.add(new P.Lightning({ bolts: 3, levels: 4, width: reduced ? 0.03 : 0.045, order: 10 }));
    const strikes = [2.1, 4.4, 6.6, 8.9, 10.4].map((t) => ({ t: t + r() * 0.4, done: false }));
    const boltList = [0, 1, 2].map(() => ({ a: V(), b: V(), gain: 0, jag: 0.35, taper: 0.5 }));
    const BOLT = C('#cfe0ff');
    const hits = [];
    for (let t = 1.2; t < END - 0.4; t += 0.32) {
      pathAt(t, pp);
      hits.push({ t, dx: pp.x - O.x + (r() - 0.5) * 0.6, dz: pp.z - O.z + (r() - 0.5) * 0.6, k: 0.35, R: 1.3, D: 0.55, pull: { y: 6.5 }, spread: 0.5, dur: 0.7, noSplash: true });
    }
    const pos = V();
    return {
      duration: 13,
      hits,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.noise(b, tDet - 1, { dur: 13, env: [[0, 0.0001], [2, 0.18], [10, 0.22], [13, 0.0001]], filter: { type: 'bandpass', f0: 380, f1: 900, glide: 9, q: 0.7 }, wet: 0.5 });
        a.noise(b, tDet, { buf: 'brown', dur: 12, env: [[0, 0.0001], [1.5, 0.4], [10, 0.45], [12, 0.0001]], filter: { type: 'lowpass', f0: 160, f1: 240, glide: 10 }, wet: 0.3 });
        a.noise(b, tDet + 0.5, { dur: 11, env: [[0, 0.0001], [2, 0.05], [9, 0.07], [11, 0.0001]], filter: { type: 'bandpass', f0: 2200, f1: 3600, glide: 8, q: 3 }, wet: 0.7 });
        for (const s of strikes) a.boom(b, tDet + s.t + 0.15, { power: 0.45, bright: 0.45, length: 1.2, crackle: 0.6, rng: r });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0;
        const grow = smooth(clamp01(t / 1.6)) * (1 - smooth(clamp01((t - END + 0.3) / 1.6)));
        f.dim = 1 - 0.45 * clamp01((t + 2) / 2.5) * (1 - smooth(clamp01((t - 11.5) / 1.5)));
        pathAt(Math.max(0, t), pos);
        for (const fn of funnels) {
          fn.m.visible = grow > 0.01;
          fn.u.uTime.value = t;
          fn.u.uA.value = fn.a * grow;
          fn.m.position.set(pos.x, O.y - 0.1, pos.z);
          fn.m.scale.set(0.4 + 0.6 * grow, grow, 0.4 + 0.6 * grow);
        }
        // raio: escolhe um novo traçado a cada descarga
        let flashI = 0;
        for (const s of strikes) {
          const dt = t - s.t;
          if (dt < 0 || dt > 0.35) continue;
          if (!s.done) {
            s.done = true;
            for (const bl of boltList) {
              const a = r() * Math.PI * 2;
              bl.a.set(O.x + Math.cos(a) * r.range(3, 10), O.y + H, O.z + Math.sin(a) * r.range(3, 10));
              bl.b.set(bl.a.x + r.range(-3, 3), O.y + r.range(0.2, 4), bl.a.z + r.range(-3, 3));
              bl.gain = 0.6 + r() * 0.6;
            }
            bolts.regen(boltList, r);
          }
          flashI = Math.max(flashI, (dt < 0.08 || (dt > 0.14 && dt < 0.2)) ? 1 : 0.25);
        }
        bolts.set(flashI * 2.2, BOLT);
        for (const fn of funnels) fn.u.uGlow.value.set(0.25, 0.28, 0.35).multiplyScalar(flashI * 0.3);
        if (flashI > 0) {
          stage.light(1, V(O.x, O.y + H, O.z), BOLT, 9 * flashI, 20);
          f.flash = (reduced ? 0.04 : 0.1) * flashI;
          f.flashColor.copy(BOLT);
          f.flashPos.set(O.x, O.y + H, O.z);
        }
        stage.light(0, V(pos.x, O.y + 2, pos.z), C('#ffd2a0'), 2.5 * grow, 8);
        f.shake = reduced ? 0 : 0.18 * grow;
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-17 · Tsunami: uma parede de água vem do mar, passa por cima e arrasta blocos
  // =====================================================================
  const WAVE_VERT = /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vec3 p = position;
      p.y += sin(p.x * 1.3 + uTime * 3.0) * 0.05 * uv.y + sin(p.x * 0.37 - uTime * 1.7) * 0.08 * uv.y;
      vec4 w = modelMatrix * vec4(p, 1.0);
      vW = w.xyz;
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const WAVE_FRAG = /* glsl */ `
    uniform sampler2D uNoise;
    uniform float uTime;
    uniform float uLit;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vec3 n = normalize(vN);
      vec3 V = normalize(cameraPosition - vW);
      if (dot(n, V) < 0.0) n = -n;
      vec3 L = normalize(vec3(-0.35, 1.0, 0.3));
      float v = vUv.y;
      vec3 deep = vec3(0.008, 0.05, 0.085);
      vec3 mid = vec3(0.02, 0.2, 0.27);
      vec3 crest = vec3(0.16, 0.6, 0.62);
      vec3 col = mix(deep, mid, smoothstep(0.0, 0.55, v));
      col = mix(col, crest, smoothstep(0.55, 0.8, v));
      float nz = texture2D(uNoise, vec2(vUv.x * 7.0 + uTime * 0.15, v * 2.2 - uTime * 0.6)).r;
      float foam = smoothstep(0.74, 0.92, v + nz * 0.3 - 0.1);
      float streaks = 0.5 * smoothstep(0.7, 0.9, texture2D(uNoise, vec2(vUv.x * 14.0, v * 0.8 - uTime * 0.9)).g) * smoothstep(0.3, 0.7, v);
      col = mix(col, vec3(0.85, 0.95, 1.0), max(foam, streaks * 0.45));
      float lam = max(dot(n, L), 0.0) * 0.6 + 0.4;
      vec3 Hh = normalize(L + V);
      float spec = pow(max(dot(n, Hh), 0.0), 60.0) * 0.8;
      float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      col = col * lam * uLit + spec + vec3(0.1, 0.35, 0.4) * fres * 0.5;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  const FLOOD_FRAG = /* glsl */ `
    uniform sampler2D uNoise;
    uniform float uTime;
    uniform float uFront;
    uniform float uA;
    uniform vec3 uO;
    uniform vec3 uDir;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vec2 rel = vW.xz - uO.xz;
      float along = dot(rel, uDir.xz);
      if (along > uFront - 0.4) discard;
      float behind = uFront - along;
      float nz = texture2D(uNoise, vW.xz * 0.06 + vec2(uTime * 0.05, -uTime * 0.03)).r;
      float foam = smoothstep(0.62, 0.85, nz) * 0.6 + (1.0 - smoothstep(0.0, 2.5, behind)) * 0.9;
      float edge = 1.0 - smoothstep(14.0, 20.0, length(rel));
      vec3 col = mix(vec3(0.02, 0.14, 0.18), vec3(0.75, 0.9, 0.95), clamp(foam, 0.0, 1.0));
      float a = uA * edge * (0.62 + 0.3 * foam);
      gl_FragColor = vec4(col * a, a);
    }
  `;

  function waveGeometry() {
    // corte da onda (comprimento, altura) — da encosta de trás até o lábio que enrola para a frente
    const prof = [[-7, -0.35], [-5, 0.06], [-3.2, 0.22], [-2, 0.45], [-1.1, 0.72], [-0.4, 0.93], [0.2, 1.02], [0.75, 0.97], [1.15, 0.82], [1.3, 0.64], [1.18, 0.5], [0.9, 0.44]];
    const W = 36;
    const NX = 90;
    const NP = prof.length;
    const pos = new Float32Array((NX + 1) * NP * 3);
    const uv = new Float32Array((NX + 1) * NP * 2);
    for (let i = 0; i <= NX; i++) {
      const x = -W / 2 + (W * i) / NX;
      const lag = -0.012 * x * x;
      for (let j = 0; j < NP; j++) {
        const o = i * NP + j;
        pos[o * 3] = x;
        pos[o * 3 + 1] = prof[j][1];
        pos[o * 3 + 2] = prof[j][0] + lag;
        uv[o * 2] = i / NX;
        uv[o * 2 + 1] = j / (NP - 1);
      }
    }
    const idx = [];
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NP - 1; j++) {
        const a = i * NP + j, b = (i + 1) * NP + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function buildTsunami(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage } = ctx;
    const { dir, perp } = heading(r);
    const front = (t) => -19 + 3.5 * t;              // posição da crista ao longo de dir (passa no ponto em t ≈ 5,4)
    const height = (t) => (0.7 + 2.9 * smooth(clamp01((t - 0.5) / 4.6))) * (1 - 0.85 * smooth(clamp01((t - 6.3) / 2.6)));
    const waveU = { uNoise: { value: tex.noise }, uTime: { value: 0 }, uLit: { value: 1.5 } };
    const wave = new THREE.Mesh(waveGeometry(), new THREE.ShaderMaterial({ uniforms: waveU, vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG, side: THREE.DoubleSide }));
    wave.rotation.y = Math.atan2(dir.x, dir.z);
    wave.visible = false;
    T.add(piece(wave));
    const floodU = {
      uNoise: { value: tex.noise }, uTime: { value: 0 }, uFront: { value: -99 }, uA: { value: 0 },
      uO: { value: O.clone() }, uDir: { value: dir.clone() },
    };
    const fg = new THREE.PlaneGeometry(44, 44, 1, 1);
    fg.rotateX(-Math.PI / 2);
    const flood = new THREE.Mesh(fg, new THREE.ShaderMaterial({ uniforms: floodU, vertexShader: WAVE_VERT, fragmentShader: FLOOD_FRAG, ...PREMULT }));
    flood.position.set(O.x, O.y + 0.22, O.z);
    flood.renderOrder = 2;
    flood.visible = false;
    T.add(piece(flood));
    const pp = V();
    // espuma e borrifo saindo da crista
    T.particles({
      count: 320, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#f2fbff', 1.6), C('#c8e6ee', 1.2), C('#8ab8c4', 0.9), C('#5a8894', 0.7), C('#3a5a64', 0.5)],
      stops: [0.15, 0.45, 0.75], alpha: [0.06, 0.45, 0.7, 0], occ: [0.2, 0.4, 0.75], sizeEase: 1.5, turb: [0.3, 1.2], lit: 0.6,
      spawn(i, p) {
        const t0 = 0.6 + r() * 8;
        const x = r.range(-16, 16);
        pp.copy(O).addScaledVector(dir, front(t0) + 0.8 - 0.012 * x * x).addScaledVector(perp, x);
        p.x = pp.x; p.y = O.y + height(t0) * r.range(0.8, 1.05); p.z = pp.z;
        const sp = r.range(2, 5);
        p.vx = dir.x * sp + r.range(-0.5, 0.5); p.vy = r.range(1, 3.5); p.vz = dir.z * sp + r.range(-0.5, 0.5);
        p.drag = 1.3; p.ay = -1.5; p.delay = t0; p.life = r.range(1.1, 2);
        p.s0 = r.range(0.4, 0.8); p.s1 = r.range(1.6, 2.8); p.rot = r() * 6.28; p.spin = r.range(-0.5, 0.5);
      },
    });
    // gotas
    T.particles({
      count: 260, texture: tex.spark, streak: true, stretch: 0.06, order: 5,
      colors: [C('#e8fbff', 2), C('#bfe6ee', 1.6), C('#8acbd8', 1.1), C('#5a9aa8', 0.6), C('#2a4a54', 0.2)],
      stops: [0.2, 0.5, 0.8], alpha: [0.02, 0.6, 0.9, 0],
      spawn(i, p) {
        const t0 = 2 + r() * 6.5;
        const x = r.range(-15, 15);
        pp.copy(O).addScaledVector(dir, front(t0) + 1 - 0.012 * x * x).addScaledVector(perp, x);
        p.x = pp.x; p.y = O.y + height(t0); p.z = pp.z;
        const sp = r.range(3, 7);
        p.vx = dir.x * sp + r.range(-1, 1); p.vy = r.range(2, 6); p.vz = dir.z * sp + r.range(-1, 1);
        p.drag = 0.6; p.ay = -9; p.delay = t0; p.life = r.range(0.8, 1.5);
        p.s0 = p.s1 = r.range(0.03, 0.06);
      },
    });
    // a frente da onda arrasta blocos para a frente
    const hits = [];
    for (let t = 3.2; t < 8.6; t += 0.28) {
      for (const x of [-7, 0, 7]) {
        const xx = x + r.range(-2.5, 2.5);
        const s = front(t) + 0.3 - 0.012 * xx * xx;
        hits.push({
          t, dx: dir.x * s + perp.x * xx, dz: dir.z * s + perp.z * xx, k: 0.3, R: 1.5, D: 0.5,
          pull: { dx: dir.x * 6, dz: dir.z * 6, y: 1.2 }, spread: 0.6, dur: 0.8, noSplash: true, cold: true,
        });
      }
    }
    const WATER = C('#5ad2e0');
    return {
      duration: 12,
      hits,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.noise(b, tDet - 1.5, { buf: 'brown', dur: 9, env: [[0, 0.0001], [6.5, 0.6], [7.2, 0.7], [9, 0.0001]], filter: { type: 'lowpass', f0: 140, f1: 700, glide: 7 }, wet: 0.4 });
        a.noise(b, tDet + 1, { dur: 8, env: [[0, 0.0001], [3.8, 0.16], [5, 0.22], [8, 0.0001]], filter: { type: 'bandpass', f0: 1800, f1: 3800, glide: 5, q: 0.8 }, wet: 0.6 });
        a.boom(b, tDet + 5.3, { power: 0.75, bright: 0.55, length: 1.8, crackle: 0.25, rng: r });
        a.noise(b, tDet + 5.4, { dur: 6, env: [[0, 0.0001], [0.3, 0.2], [6, 0.0001]], filter: { type: 'highpass', f0: 2500 }, wet: 0.7 });
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        waveU.uTime.value = t;
        floodU.uTime.value = t;
        const live = t > -1 && t < 10.5;
        wave.visible = live;
        if (live) {
          const h = height(Math.max(t, 0));
          const s = front(Math.max(t, 0));
          wave.position.copy(O).addScaledVector(dir, s);
          wave.position.y = O.y - 0.2;
          wave.scale.set(1, h, 0.75 + 0.3 * h);
        }
        flood.visible = t > 2 && t < 12;
        floodU.uFront.value = front(Math.max(t, 0)) - 0.5;
        floodU.uA.value = smooth(clamp01((t - 2) / 1.5)) * (1 - smooth(clamp01((t - 7.5) / 4)));
        flood.position.y = O.y + 0.1 + 0.35 * floodU.uA.value;
        const near = 1 - clamp01(Math.abs(front(t)) / 9);
        stage.wave(0, O.x - dir.x * 2, O.z - dir.z * 2, Math.max(0.1, front(t) + 19), 0.9 * clamp01(t / 2) * (1 - clamp01((t - 9) / 2)), 0.9, WATER);
        stage.light(0, V(O.x, O.y + 4, O.z).addScaledVector(dir, front(t) - 1), WATER, 3 * near, 10);
        f.dim = 1 - 0.2 * near;
        f.shake = reduced ? 0 : 0.7 * near * near;
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-18 · Vulcão: o chão sobe em montanha, abre a boca e solta lava, cinza e bombas
  // =====================================================================
  function buildVolcano(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const q = Math.max(0.35, ctx.q);
    const RISE = 2.6;
    const ERUPT = 3.2;
    const HM = 5.2;
    const VENT = V(O.x, O.y + HM * 0.72, O.z);
    const d = V();
    // poeira das encostas enquanto a montanha cresce
    T.particles({
      count: 120, texture: tex.puff, atlas: true, order: 2,
      colors: [C('#8a7660', 1), C('#6a5a4a', 0.8), C('#4a4038', 0.6), C('#3a342e', 0.5), C('#2c2826', 0.45)],
      stops: [0.15, 0.45, 0.75], alpha: [0.08, 0.45, 0.5, 0], occ: [0, 0.1, 0.85], sizeEase: 1.6, turb: [0.3, 0.8], lit: 0.7,
      spawn(i, p) {
        const a = r() * Math.PI * 2;
        const rad = r.range(2, 7);
        p.x = O.x + Math.cos(a) * rad; p.y = O.y + 0.3 + (1 - rad / 7) * HM * 0.5; p.z = O.z + Math.sin(a) * rad;
        p.vx = Math.cos(a) * 1.5; p.vy = r.range(0.4, 1.4); p.vz = Math.sin(a) * 1.5;
        p.drag = 1; p.delay = r() * RISE; p.life = r.range(2, 3.4);
        p.s0 = r.range(0.6, 1); p.s1 = r.range(2, 3); p.rot = r() * 6.28;
      },
    });
    // coluna de cinza
    const ash = T.particles({
      count: 260, texture: tex.puff, atlas: true, order: 3, swirl: 0.35,
      colors: [C('#ff8a3a', 2.4), C('#5a3a2e', 0.8), C('#2e2a28', 0.5), C('#242322', 0.45), C('#1c1c1c', 0.42)],
      stops: [0.06, 0.25, 0.6], alpha: [0.05, 0.6, 0.85, 0], occ: [0.02, 0.15, 1], sizeEase: 1.3, turb: [0.5, 0.5], lit: 0.8,
      spawn(i, p) {
        r.disk(d, 0.6);
        p.x = VENT.x + d.x; p.y = VENT.y; p.z = VENT.z + d.z;
        p.vx = d.x * 0.6 + r.range(-0.3, 0.3); p.vy = r.range(4, 7); p.vz = d.z * 0.6 + r.range(-0.3, 0.3);
        p.drag = 0.32; p.ay = 0.05; p.delay = ERUPT + Math.pow(r(), 0.8) * 8; p.life = r.range(5, 7.5);
        p.s0 = r.range(0.8, 1.2); p.s1 = r.range(3.5, 5.5); p.rot = r() * 6.28; p.spin = r.range(-0.25, 0.25);
      },
    });
    // fonte de lava
    T.particles({
      count: 420, texture: tex.glow, order: 5,
      colors: [C('#fff2b0', 9), C('#ffb040', 6), C('#ff5a10', 3.5), C('#a0200a', 1.2), C('#2a0a06', 0.2)],
      stops: [0.15, 0.4, 0.75], alpha: [0.02, 0.7, 1, 0], ground: [O.y, 0.1],
      spawn(i, p) {
        r.hemi(d, 0.55, 1.5);
        const sp = r.range(5, 11);
        p.x = VENT.x + d.x * 0.3; p.y = VENT.y + 0.1; p.z = VENT.z + d.z * 0.3;
        p.vx = d.x * sp * 0.45; p.vy = d.y * sp + 2; p.vz = d.z * sp * 0.45;
        p.drag = 0.25; p.ay = -9; p.delay = ERUPT + r() * 8.5; p.life = r.range(1.4, 2.4);
        p.s0 = r.range(0.1, 0.18); p.s1 = 0.06;
      },
    });
    // bombas de lava em cubos (esfriam no ar)
    const bombs = T.add(new B.VoxelBurst({
      count: Math.round(420 * q), rng: r, ground: O.y,
      ramp: [[0, C('#fff0a0', 8)], [0.25, C('#ff8a20', 4.5)], [0.6, C('#c0300a', 1.6)], [0.85, C('#3a1a12', 0.3)], [1, C('#1a1210', 0.15)]],
      spawn(i, c) {
        r.hemi(d, 0.35, 1.45);
        const sp = r.range(6, 13);
        c.x = VENT.x; c.y = VENT.y + 0.2; c.z = VENT.z;
        c.vx = d.x * sp * 0.6; c.vy = d.y * sp + 3; c.vz = d.z * sp * 0.6;
        c.drag = 0.15; c.g = 9; c.delay = ERUPT + Math.pow(r(), 1.4) * 8; c.life = r.range(2.4, 4);
        c.size = r.range(0.12, 0.36);
      },
    }));
    const glow = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const bolts = T.add(new P.Lightning({ bolts: 3, levels: 4, width: reduced ? 0.03 : 0.04, order: 10 }));
    const boltList = [0, 1, 2].map(() => ({ a: V(), b: V(), gain: 0, jag: 0.4, taper: 0.5 }));
    const strikes = [5.2, 6.9, 8.3, 10.1].map((t) => ({ t: t + r() * 0.5, done: false }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const LAVA = C('#ff6a1a');
    const HOT = C('#ffd27a');
    const BOLT = C('#d8c8ff');
    return {
      duration: 14,
      hits: [{ t: 0, dx: 0, dz: 0, k: 1, R: 7.5, raise: HM, dur: RISE }],
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.noise(b, tDet - 0.5, { buf: 'brown', dur: 14, env: [[0, 0.0001], [2.5, 0.55], [12, 0.5], [14, 0.0001]], filter: { type: 'lowpass', f0: 80, f1: 160, glide: 10 }, wet: 0.3 });
        a.tone(b, tDet, { f0: 34, f1: 28, glide: 3, dur: 3.4, gain: 0.5, attack: 0.6, hold: 2, tau: 0.4, wet: 0.2 });
        a.boom(b, tDet + ERUPT, { power: 1.1, bright: 0.7, length: 1.6, crackle: 2.5, rng: r });
        a.rattle(b, tDet + ERUPT + 0.4, 8, 70, r);
        for (const s of strikes) a.boom(b, tDet + s.t + 0.1, { power: 0.35, bright: 0.5, length: 0.9, crackle: 0.4, rng: r });
      },
      update(t) {
        T.tick(t);
        bombs.update(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { glow.hide(); bolts.hide(); if (flare) flare.hide(); return f; }
        const er = t - ERUPT;
        const on = er > 0 ? smooth(clamp01(er / 0.4)) * (1 - smooth(clamp01((t - 12) / 2))) : 0;
        const I = on * (16 + 6 * noise1(t * 7)) + (er > 0 ? keys([[0, 40], [0.5, 10], [2, 0]], er) : 0);
        stage.light(0, V(VENT.x, VENT.y + 1.2, VENT.z), LAVA, I, 12);
        stage.light(1, V(O.x, O.y + 0.5, O.z), LAVA, 6 * on, 9);
        stage.setHeat(O.x, O.z, 5.5, 1.6 * on + 0.6 * smooth(clamp01(t / RISE)), LAVA);
        glow.set(VENT, 3 + 3 * on, 3 + 3 * on, 1.4 * on + (er > 0 ? 6 * envelope(er, 0.05, 0.4) : 0), HOT);
        if (flare) flare.set(VENT, er > 0 ? 1.1 * envelope(er, 0.05, 0.5) : 0);
        const wt = clamp01(er / 2.4);
        if (er > 0) stage.wave(0, O.x, O.z, 16 * easeOutCubic(wt), 2 * Math.pow(1 - wt, 1.5), 0.3 + 0.6 * wt, LAVA);
        // raios na nuvem de cinza
        let fl = 0;
        for (const s of strikes) {
          const dt = t - s.t;
          if (dt < 0 || dt > 0.3) continue;
          if (!s.done) {
            s.done = true;
            for (const bl of boltList) {
              bl.a.set(VENT.x + r.range(-2, 2), VENT.y + r.range(5, 9), VENT.z + r.range(-2, 2));
              bl.b.set(bl.a.x + r.range(-3, 3), bl.a.y - r.range(2, 4), bl.a.z + r.range(-3, 3));
              bl.gain = 0.5 + r() * 0.5;
            }
            bolts.regen(boltList, r);
          }
          fl = dt < 0.07 || (dt > 0.12 && dt < 0.17) ? 1 : 0.3;
        }
        bolts.set(fl * 3, BOLT);
        if (fl > 0) stage.light(2, V(VENT.x, VENT.y + 7, VENT.z), BOLT, 18 * fl, 18);
        f.dim = 1 - 0.3 * on;
        f.flash = er > 0 ? (reduced ? 0.15 : 0.45) * envelope(er, 0.04, 0.3) : 0;
        f.flashColor.copy(HOT);
        f.flashPos.copy(VENT);
        f.shake = reduced ? 0 : 0.35 * smooth(clamp01(t / 0.6)) * (t < RISE ? 1 : 0.5) + (er > 0 ? 1.3 * Math.exp(-er * 2.2) : 0);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-19 · Terremoto: o chão treme, fendas se abrem em linhas e blocos pulam
  // =====================================================================
  function buildQuake(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage } = ctx;
    const d = V();
    const hits = [];
    const cracks = [];
    // 3 falhas principais saindo do ponto, cada uma com um galho
    const a0 = r() * Math.PI * 2;
    for (let f = 0; f < 3; f++) {
      const a = a0 + (f * Math.PI * 2) / 3 + r.range(-0.4, 0.4);
      const len = r.range(9, 15);
      let x = 0, z = 0, ang = a;
      for (let s = 0; s < len; s += 0.45) {
        ang += r.range(-0.18, 0.18);
        x += Math.cos(ang) * 0.45;
        z += Math.sin(ang) * 0.45;
        const t = 0.25 + s / 8.5;
        hits.push({ t, dx: x, dz: z, k: 0.4, R: 0.55, D: 1.2 + r() * 1.4, dur: 0.35, noSplash: true, cold: true, lift: 0.5 });
        cracks.push({ t, x, z });
        if (s > 3 && r() < 0.06) {
          // galho curto
          let bx = x, bz = z, ba = ang + (r() < 0.5 ? 1 : -1) * r.range(0.6, 1.1);
          for (let k = 0; k < 7; k++) {
            bx += Math.cos(ba) * 0.45; bz += Math.sin(ba) * 0.45; ba += r.range(-0.2, 0.2);
            hits.push({ t: t + k * 0.05, dx: bx, dz: bz, k: 0.3, R: 0.42, D: 0.7 + r() * 0.8, dur: 0.3, noSplash: true, cold: true, lift: 0.5 });
          }
        }
        // degrau: um lado da falha sobe um pouco
        if (r() < 0.12) hits.push({ t: t + 0.1, dx: x - Math.sin(ang) * 1.1, dz: z + Math.cos(ang) * 1.1, k: 0.3, R: 1.1, raise: 0.55, dur: 0.6 });
      }
    }
    // poeira saindo das fendas
    T.particles({
      count: 300, texture: tex.puff, atlas: true, order: 3,
      colors: [C('#9a8466', 1.1), C('#6d5c4a', 0.85), C('#4a4038', 0.62), C('#3a342e', 0.52), C('#2c2826', 0.45)],
      stops: [0.12, 0.4, 0.75], alpha: [0.06, 0.45, 0.55, 0], occ: [0, 0.1, 0.85], sizeEase: 1.6, turb: [0.35, 0.8], lit: 0.75,
      spawn(i, p) {
        const c = cracks[Math.floor(r() * cracks.length)];
        p.x = O.x + c.x + r.range(-0.2, 0.2); p.y = O.y + 0.1; p.z = O.z + c.z + r.range(-0.2, 0.2);
        p.vx = r.range(-0.6, 0.6); p.vy = r.range(1.2, 3.2); p.vz = r.range(-0.6, 0.6);
        p.drag = 1.1; p.ay = 0.3; p.delay = c.t + r() * 1.2; p.life = r.range(2, 3.6);
        p.s0 = r.range(0.3, 0.6); p.s1 = r.range(1.4, 2.4); p.rot = r() * 6.28; p.spin = r.range(-0.4, 0.4);
      },
    });
    // pedrinhas pulando
    T.particles({
      count: 260, texture: tex.spark, streak: true, stretch: 0.05, order: 5,
      colors: [C('#d8c0a0', 1.4), C('#a08a70', 1.1), C('#7a6a58', 0.8), C('#5a4e44', 0.5), C('#2a2622', 0.2)],
      stops: [0.2, 0.5, 0.8], alpha: [0.02, 0.6, 0.9, 0], ground: [O.y, 0.05],
      spawn(i, p) {
        const c = cracks[Math.floor(r() * cracks.length)];
        r.hemi(d, 0.5, 1.5);
        p.x = O.x + c.x; p.y = O.y + 0.15; p.z = O.z + c.z;
        p.vx = d.x * 2; p.vy = r.range(2, 5); p.vz = d.z * 2;
        p.drag = 0.4; p.ay = -9; p.delay = c.t + r() * 0.3; p.life = r.range(0.8, 1.4);
        p.s0 = p.s1 = r.range(0.03, 0.06);
      },
    });
    const DUST = C('#d8a060');
    const shakeAt = (t) => (t < 0 ? 0 : keys([[0, 0.4], [0.3, 2.2], [3, 1.8], [6, 0.7], [8.5, 0]], t));
    return {
      duration: 10,
      hits,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.noise(b, tDet - 0.3, { buf: 'brown', dur: 9.5, env: [[0, 0.0001], [0.6, 0.85], [3.5, 0.75], [7, 0.3], [9.5, 0.0001]], filter: { type: 'lowpass', f0: 70, f1: 140, glide: 6 }, wet: 0.25 });
        a.tone(b, tDet, { f0: 38, f1: 30, glide: 6, dur: 7, gain: 0.45, attack: 0.3, hold: 3, tau: 1.2, vib: { rate: 7, depth: 3 }, wet: 0.2 });
        a.rattle(b, tDet + 0.3, 6.5, 90, r);
        for (let i = 0; i < 12; i++) {
          a.noise(b, tDet + 0.3 + r() * 2.2, { dur: 0.12, gain: 0.2 + r() * 0.2, attack: 0.001, tau: 0.03, filter: { type: 'bandpass', f0: 900 + r() * 2200, q: 1.3 }, pan: r() * 1.6 - 0.8, wet: 0.35 });
        }
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.dim = 1;
        const sh = shakeAt(t);
        // ondas sísmicas saindo do ponto, uma atrás da outra
        for (let i = 0; i < 3; i++) {
          const ph = t - i * 1.1;
          if (ph < 0) continue;
          const u = clamp01(ph / 2.6);
          stage.wave(i, O.x, O.z, 20 * easeOutCubic(u), 1.1 * Math.pow(1 - u, 1.4) * (1 - i * 0.2), 0.5 + 0.6 * u, DUST);
        }
        stage.light(0, V(O.x, O.y + 3, O.z), DUST, 2.5 * Math.min(1, sh), 12);
        f.shake = reduced ? 0 : sh * (0.75 + 0.25 * Math.sin(t * 23));
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-20 · Ataque alienígena: nave-mãe desce, puxa blocos com o raio trator e as naves menores atiram
  // =====================================================================
  const SHIP_VERT = /* glsl */ `
    varying vec3 vN;
    varying vec3 vW;
    varying vec3 vL;
    void main() {
      vL = position;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const SHIP_FRAG = /* glsl */ `
    uniform float uTime;
    uniform vec3 uGlow;
    uniform float uOn;
    uniform float uBeam;
    varying vec3 vN;
    varying vec3 vW;
    varying vec3 vL;
    void main() {
      vec3 n = normalize(vN);
      vec3 L = normalize(vec3(0.35, 1.0, 0.25));
      vec3 V = normalize(cameraPosition - vW);
      vec3 col = vec3(0.045, 0.05, 0.06) * (0.35 + 0.9 * max(dot(n, L), 0.0));
      col += vec3(0.3, 0.34, 0.4) * pow(max(dot(reflect(-L, n), V), 0.0), 28.0) * 0.5;
      // anéis de painéis
      float rr = length(vL.xz);
      col *= 0.85 + 0.15 * step(0.5, fract(rr * 9.0));
      float ang = atan(vL.z, vL.x + 1e-5);
      float band = 1.0 - smoothstep(0.06, 0.16, abs(vL.y));
      float dots = step(0.55, fract(ang * 24.0 / 6.2831853 + uTime * 0.8));
      float blink = 0.6 + 0.4 * sin(uTime * 6.0 + ang * 3.0);
      col += uGlow * band * dots * blink * 3.0 * uOn;
      float under = step(vL.y, 0.0) * (1.0 - smoothstep(0.1, 0.5, rr));
      col += uGlow * under * (1.5 + 3.0 * uBeam) * uOn;
      float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      col += vec3(0.1, 0.5, 0.4) * fres * 0.4 * uOn;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  const DOME_FRAG = /* glsl */ `
    uniform float uTime;
    uniform float uOn;
    varying vec3 vN;
    varying vec3 vW;
    varying vec3 vL;
    void main() {
      vec3 n = normalize(vN);
      vec3 V = normalize(cameraPosition - vW);
      float fres = pow(1.0 - max(dot(n, V), 0.0), 2.0);
      vec3 col = vec3(0.05, 0.4, 0.35) * (0.4 + 1.6 * fres) * (0.8 + 0.2 * sin(uTime * 3.0)) * uOn + vec3(0.01, 0.03, 0.03);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function buildAliens(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const shipU = { uTime: { value: 0 }, uGlow: { value: C('#5dffb0', 1) }, uOn: { value: 0 }, uBeam: { value: 0 } };
    const shipMat = new THREE.ShaderMaterial({ uniforms: shipU, vertexShader: SHIP_VERT, fragmentShader: SHIP_FRAG });
    const domeMat = new THREE.ShaderMaterial({ uniforms: shipU, vertexShader: SHIP_VERT, fragmentShader: DOME_FRAG });
    const discGeo = new THREE.SphereGeometry(1, 64, 24);
    const domeGeo = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const makeShip = (s) => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(discGeo, shipMat);
      disc.scale.set(s, s * 0.17, s);
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.scale.set(s * 0.34, s * 0.22, s * 0.34);
      dome.position.y = s * 0.09;
      g.add(disc, dome);
      g.visible = false;
      return g;
    };
    const mother = makeShip(5.5);
    const escorts = [0, 1, 2].map(() => makeShip(1.1));
    T.add({ mesh: mother, dispose() { mother.removeFromParent(); } });
    for (const e of escorts) T.add({ mesh: e, dispose() { e.removeFromParent(); } });
    T.add({ mesh: new THREE.Group(), dispose() { discGeo.dispose(); domeGeo.dispose(); shipMat.dispose(); domeMat.dispose(); } });

    const SH = 10;
    const ARRIVE = 2.4;
    const LEAVE = 12.6;
    const shipPos = (t, out = V()) => {
      const down = 1 - easeOutCubic(clamp01((t + 1.5) / (ARRIVE + 1.5)));
      const up = Math.pow(clamp01((t - LEAVE) / 1.4), 2);
      return out.set(O.x + Math.sin(t * 0.4) * 0.4, O.y + SH + 26 * down + 40 * up + Math.sin(t * 1.3) * 0.15, O.z + Math.cos(t * 0.35) * 0.4);
    };
    const escortPos = (i, t, out = V()) => {
      shipPos(t, out);
      const a = t * 0.9 + (i * Math.PI * 2) / 3;
      return out.set(out.x + Math.cos(a) * 9, out.y - 3 + Math.sin(t * 2 + i) * 0.4, out.z + Math.sin(a) * 9);
    };
    // raio trator puxa os blocos para dentro da nave
    const TR0 = 3.0;
    const TR1 = 7.4;
    const beam = T.add(new P.Beam({ order: 7 }));
    const beamCore = T.add(new P.Beam({ order: 7 }));
    const hits = [{ t: TR0 + 0.2, dx: 0, dz: 0, k: 1, R: 3.4, D: 2.4, pull: { y: SH - 1, abs: true }, spread: TR1 - TR0 - 1.3, dur: TR1 - TR0 - 0.6 }];
    // tiros: pontos ao redor, cada um com cratera
    const shots = [];
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2;
      const rad = r.range(4, 13);
      const t = 7.8 + i * 0.38 + r() * 0.15;
      shots.push({ t, x: Math.cos(a) * rad, z: Math.sin(a) * rad, from: i % 4 });
      hits.push({ t: t + 0.04, dx: Math.cos(a) * rad, dz: Math.sin(a) * rad, k: 0.6 });
    }
    const lasers = [0, 1, 2, 3].map(() => T.add(new P.Beam({ order: 9 })));
    const blasts = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const d = V();
    // fogo e faíscas onde cada tiro acerta
    T.particles({
      count: shots.length * 16, texture: tex.puff, atlas: true, order: 4,
      colors: [C('#fff2d6', 3), C('#9dffb8', 1.8), C('#ff6a1e', 1.1), C('#2a1d17', 0.9), C('#161413', 0.8)],
      stops: [0.1, 0.28, 0.55], alpha: [0.03, 0.55, 0.95, 0], occ: [0.1, 0.4, 0.95], sizeEase: 2.2, turb: [0.25, 1.4], lit: 0.5,
      spawn(i, p) {
        const s = shots[Math.floor(i / 16)];
        r.hemi(d, 0.05, 1.45);
        const sp = r.range(1.5, 4.5);
        p.x = O.x + s.x; p.y = O.y + 0.2; p.z = O.z + s.z;
        p.vx = d.x * sp; p.vy = d.y * sp + 1; p.vz = d.z * sp;
        p.drag = 2.6; p.ay = 1.2; p.delay = s.t + 0.04 + r() * 0.08; p.life = r.range(1.2, 2.2);
        p.s0 = r.range(0.25, 0.5); p.s1 = r.range(1, 1.7); p.rot = r() * 6.28; p.spin = r.range(-0.7, 0.7);
      },
    });
    T.particles({
      count: shots.length * 22, texture: tex.spark, streak: true, stretch: 0.07, order: 6,
      colors: [C('#e8fff0', 3.5), C('#7dffb0', 2.5), C('#3ad08a', 1.4), C('#1a6a4a', 0.6), C('#0a1a14', 0.1)],
      stops: [0.15, 0.4, 0.75], alpha: [0.01, 0.7, 1, 0], ground: [O.y - 0.02, 0.06],
      spawn(i, p) {
        const s = shots[Math.floor(i / 22)];
        r.hemi(d, 0.2, 1.5);
        const sp = r.range(4, 10);
        p.x = O.x + s.x; p.y = O.y + 0.2; p.z = O.z + s.z;
        p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
        p.drag = 0.9; p.ay = -9; p.delay = s.t + 0.04 + r() * 0.05; p.life = r.range(0.6, 1.4);
        p.s0 = p.s1 = r.range(0.025, 0.045);
      },
    });
    const GREEN = C('#5dffb0');
    const LASER = C('#9dffc8');
    const sp = V();
    const ep = V();
    const tgt = V();
    const ax = V();
    const UPV = V(0, 1, 0);
    return {
      duration: 14.5,
      hits,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.tone(b, tDet - 1.5, { type: 'sawtooth', f0: 55, dur: 15.5, gain: 0.13, attack: 2, hold: 11, tau: 1, filter: { type: 'lowpass', f0: 220 }, wet: 0.3 });
        a.tone(b, tDet - 1.2, { f0: 520, f1: 760, glide: 3, dur: 5, gain: 0.05, attack: 0.6, hold: 3, tau: 0.6, vib: { rate: 5.5, depth: 28 }, wet: 0.7 });
        a.tone(b, tDet + 4.5, { f0: 700, f1: 430, glide: 3, dur: 4, gain: 0.045, attack: 0.5, hold: 2.5, tau: 0.6, vib: { rate: 6.5, depth: 34 }, wet: 0.7 });
        a.noise(b, tDet + TR0, { dur: TR1 - TR0, env: [[0, 0.0001], [0.5, 0.14], [TR1 - TR0 - 0.4, 0.2], [TR1 - TR0, 0.0001]], filter: { type: 'bandpass', f0: 300, f1: 2400, glide: TR1 - TR0, q: 2 }, wet: 0.6 });
        a.tone(b, tDet + TR0, { type: 'triangle', f0: 90, f1: 180, glide: TR1 - TR0, dur: TR1 - TR0, gain: 0.12, attack: 0.4, hold: TR1 - TR0 - 1, tau: 0.3, wet: 0.4 });
        for (const s of shots) {
          a.tone(b, tDet + s.t - 0.05, { type: 'square', f0: 2400, f1: 260, glide: 0.18, dur: 0.24, gain: 0.07, attack: 0.002, tau: 0.08, filter: { type: 'lowpass', f0: 4000 }, wet: 0.35 });
          a.boom(b, tDet + s.t + 0.05, { power: 0.35, bright: 1.2, length: 0.45, crackle: 0.5, rng: r });
        }
      },
      update(t) {
        T.tick(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0;
        shipU.uTime.value = t;
        const on = smooth(clamp01((t + 1.5) / 1.5)) * (1 - smooth(clamp01((t - LEAVE - 1) / 1)));
        shipU.uOn.value = on;
        const vis = t > -1.5 && t < LEAVE + 2;
        mother.visible = vis;
        shipPos(t, sp);
        mother.position.copy(sp);
        mother.rotation.y = t * 0.25;
        mother.rotation.z = Math.sin(t * 0.7) * 0.04;
        escorts.forEach((e, i) => {
          e.visible = vis && t > 0.5;
          escortPos(i, t, ep);
          e.position.copy(ep);
          e.rotation.y = -t * 2;
          e.rotation.z = 0.2;
        });
        // raio trator
        const tb = smooth(clamp01((t - TR0) / 0.5)) * (1 - smooth(clamp01((t - TR1) / 0.5)));
        shipU.uBeam.value = tb;
        const groundP = V(O.x, O.y, O.z);
        const len = Math.max(0.1, sp.y - O.y - 0.7);
        beam.set(groundP, UPV, len, 3.2, 1.4, 1.1 * tb * (0.85 + 0.15 * Math.sin(t * 9)), GREEN);
        beamCore.set(groundP, UPV, len, 0.9, 0.5, 2.2 * tb, LASER);
        // tiros
        let lastHit = null;
        let li = 0;
        for (const s of shots) {
          const dt = t - s.t;
          if (dt < -0.08 || dt > 0.25) continue;
          if (li >= lasers.length) break;
          if (s.from === 3) shipPos(s.t, ep); else escortPos(s.from, s.t, ep);
          tgt.set(O.x + s.x, O.y + 0.1, O.z + s.z);
          ax.copy(ep).sub(tgt);
          const dist = ax.length();
          lasers[li++].set(tgt, ax, dist, 0.1, 0.04, 4 * (1 - clamp01(dt / 0.25)), LASER);
          if (dt >= 0) lastHit = { p: tgt.clone(), k: 1 - clamp01(dt / 0.25) };
        }
        for (; li < lasers.length; li++) lasers[li].hide();
        if (lastHit) {
          blasts.set(lastHit.p, 2.5 * lastHit.k + 0.5, 2.5 * lastHit.k + 0.5, 2.5 * lastHit.k, LASER);
          stage.light(2, V(lastHit.p.x, lastHit.p.y + 1, lastHit.p.z), LASER, 10 * lastHit.k, 7);
          f.shake = reduced ? 0 : 0.6 * lastHit.k;
          f.flash = (reduced ? 0.02 : 0.06) * lastHit.k;
          f.flashColor.copy(LASER);
          f.flashPos.copy(lastHit.p);
        } else blasts.hide();
        stage.light(0, V(sp.x, sp.y - 1.5, sp.z), GREEN, (6 + 18 * tb) * on, 14);
        if (tb > 0.01) stage.setHeat(O.x, O.z, 3.2, 1.4 * tb, GREEN);
        f.dim = 1 - 0.35 * on;
        f.shake = Math.max(f.shake, reduced ? 0 : 0.12 * on);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  B.EFFECTS.push(
    {
      id: 'tornado', code: 'FX-16', name: 'Tornado',
      desc: 'Nuvem de tempestade com raios e um funil de vento que anda pelo chão sugando os blocos.',
      swatch: ['#c8c0b4', '#6a6460', '#2a2c31'], build: buildTornado, aimY: 4.6, frameK: 1.6, event: true,
    },
    {
      id: 'tsunami', code: 'FX-17', name: 'Tsunami',
      desc: 'Uma parede de água vem do mar, quebra sobre o ponto, alaga tudo e arrasta blocos.',
      swatch: ['#e8fbff', '#2a9aa8', '#082a3a'], build: buildTsunami, aimY: 1.6, frameK: 1.7, event: true,
    },
    {
      id: 'vulcao', code: 'FX-18', name: 'Vulcão',
      desc: 'O chão sobe numa montanha que entra em erupção: lava, bombas em cubos, cinza e raios.',
      swatch: ['#fff0a0', '#ff6a1a', '#2e2a28'], build: buildVolcano, aimY: 4.2, frameK: 1.75, event: true,
    },
    {
      id: 'terremoto', code: 'FX-19', name: 'Terremoto',
      desc: 'Tremor forte, ondas sísmicas e fendas que se abrem em linhas, fazendo blocos pularem.',
      swatch: ['#d8c0a0', '#9a8466', '#3a342e'], build: buildQuake, aimY: 0.8, frameK: 1.65, event: true,
    },
    {
      id: 'aliens', code: 'FX-20', name: 'Ataque alienígena',
      desc: 'Uma nave-mãe desce, puxa blocos com o raio trator e as naves menores atiram lasers verdes.',
      swatch: ['#e8fff0', '#5dffb0', '#101418'], build: buildAliens, aimY: 4.8, frameK: 1.8, event: true,
    },
  );
})();
