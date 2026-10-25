/* Efeitos extras: Bomba Ridícula, Explosão de Pixels e Buraco Negro.
   Tudo ficção visual: tamanhos, cores e tempos são escolhas artísticas, sem cálculo real. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE || !B.fxKit) return;
  const THREE = window.THREE;
  const U = B.util;
  const P = B.parts;
  const { Take, V, C } = B.fxKit;
  const { clamp01, smooth, easeOutCubic, envelope, keys, noise1 } = U;

  // ------------------------------------------------------------ cubos que brilham (pixels 3D)
  const VOX_VERT = /* glsl */ `
    attribute vec3 aCol;
    varying vec3 vCol;
    varying vec3 vN;
    void main() {
      vCol = aCol;
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `;
  const VOX_FRAG = /* glsl */ `
    varying vec3 vCol;
    varying vec3 vN;
    void main() {
      // faces com tons diferentes: lê-se como cubo mesmo brilhando
      vec3 n = normalize(vN);
      float shade = 0.62 + 0.38 * max(dot(n, normalize(vec3(0.35, 1.0, 0.25))), 0.0);
      gl_FragColor = vec4(vCol * shade, 1.0);
    }
  `;

  /**
   * Explosão de cubos emissivos. spawn(i, c) define x,y,z, vx,vy,vz, drag, g, delay, life, size.
   * ramp: [[idade 0–1, cor HDR], ...] — a cor de cada cubo segue a rampa pela idade.
   */
  class VoxelBurst {
    constructor({ count, spawn, rng, ramp, ground = -1e9, order = 5 }) {
      this.n = Math.max(1, count);
      this.ramp = ramp;
      this.ground = ground;
      const n = this.n;
      this.d = new Float32Array(n * 14);
      const c = {};
      for (let i = 0; i < n; i++) {
        c.x = 0; c.y = 0; c.z = 0; c.vx = 0; c.vy = 0; c.vz = 0;
        c.drag = 1; c.g = 0; c.delay = 0; c.life = 1; c.size = 0.2; c.heat = 1;
        spawn(i, c, n);
        this.d.set([c.x, c.y, c.z, c.vx, c.vy, c.vz, Math.max(0.01, c.drag), c.g, c.delay, c.life, c.size,
          rng() - 0.5, rng() - 0.5, 2 + rng() * 9], i * 14);
      }
      this.col = new Float32Array(n * 3);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      this.colAttr = new THREE.InstancedBufferAttribute(this.col, 3);
      this.colAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aCol', this.colAttr);
      this.material = new THREE.ShaderMaterial({ vertexShader: VOX_VERT, fragmentShader: VOX_FRAG });
      this.mesh = new THREE.InstancedMesh(geo, this.material, n);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = order;
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3();
      this._s = new THREE.Vector3();
      this._a = new THREE.Vector3();
      this._c = new THREE.Vector3();
      this.update(-1);
    }

    _rampAt(age, out) {
      const R = this.ramp;
      if (age <= R[0][0]) return out.copy(R[0][1]);
      for (let i = 1; i < R.length; i++) {
        if (age <= R[i][0]) return out.copy(R[i - 1][1]).lerp(R[i][1], (age - R[i - 1][0]) / (R[i][0] - R[i - 1][0]));
      }
      return out.copy(R[R.length - 1][1]);
    }

    update(t) {
      const D = this.d;
      const m = this._m;
      let any = false;
      for (let i = 0; i < this.n; i++) {
        const o = i * 14;
        const tt = t - D[o + 8];
        const life = D[o + 9];
        if (tt < 0 || tt >= life) {
          m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, m);
          continue;
        }
        any = true;
        const k = D[o + 6];
        const e = (1 - Math.exp(-k * tt)) / k;
        const x = D[o] + D[o + 3] * e;
        const z = D[o + 2] + D[o + 5] * e;
        let y = D[o + 1] + D[o + 4] * e - 0.5 * D[o + 7] * tt * tt;
        const size = D[o + 10];
        if (y < this.ground + size * 0.5) y = this.ground + size * 0.5;
        const age = tt / life;
        const sc = size * (1 - Math.pow(age, 4));
        this._q.setFromAxisAngle(this._a.set(D[o + 11], 0.4, D[o + 12]).normalize(), D[o + 13] * tt);
        this._p.set(x, y, z);
        this._s.setScalar(sc);
        m.compose(this._p, this._q, this._s);
        this.mesh.setMatrixAt(i, m);
        this._rampAt(age, this._c);
        this.col[i * 3] = this._c.x;
        this.col[i * 3 + 1] = this._c.y;
        this.col[i * 3 + 2] = this._c.z;
      }
      this.mesh.visible = any;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }

    hide() { this.mesh.visible = false; }
    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }
  B.VoxelBurst = VoxelBurst;

  // =====================================================================
  // FX-14 · Explosão de pixels: a bola de fogo inteira é feita de cubos
  // =====================================================================
  function buildPixels(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const d = V();
    const q = Math.max(0.35, ctx.q);
    const fireRamp = [[0, C('#ffffff', 10)], [0.12, C('#fff1a8', 7)], [0.35, C('#ff9a2a', 3.6)], [0.65, C('#e0401a', 1.4)], [0.85, C('#3a1c14', 0.25)], [1, C('#151212', 0.12)]];
    const core = T.add(new VoxelBurst({
      count: Math.round(1600 * q), rng: r, ramp: fireRamp, ground: O.y,
      spawn(i, c) {
        r.hemi(d, 0.05, 1.45);
        const sp = r.range(2.5, 12);
        c.x = O.x + d.x * 0.3; c.y = O.y + 0.25; c.z = O.z + d.z * 0.3;
        c.vx = d.x * sp; c.vy = d.y * sp + 1.5; c.vz = d.z * sp;
        c.drag = 2.2; c.g = 1.2; c.delay = r() * 0.12; c.life = r.range(1.4, 3.6);
        c.size = r.range(0.14, 0.34);
      },
    }));
    // coluna de pixels que sobe (cogumelo quadrado)
    const column = T.add(new VoxelBurst({
      count: Math.round(700 * q), rng: r, ground: O.y,
      ramp: [[0, C('#ffd27a', 5)], [0.3, C('#ff7a2a', 2.2)], [0.7, C('#5a2a1a', 0.5)], [1, C('#1c1a1a', 0.15)]],
      spawn(i, c) {
        const top = r() < 0.55;
        r.disk(d, top ? 1 : 0.35);
        c.x = O.x + d.x; c.y = O.y + 0.3; c.z = O.z + d.z;
        c.vx = d.x * (top ? 3.2 : 0.4); c.vy = top ? r.range(5, 7.5) : r.range(1.5, 5.5); c.vz = d.z * (top ? 3.2 : 0.4);
        c.drag = 0.7; c.g = 0; c.delay = 0.2 + r() * 1.4; c.life = r.range(3, 5.5);
        c.size = r.range(0.16, 0.4);
      },
    }));
    // anel de choque de pixels ciano no chão
    const ring = T.add(new VoxelBurst({
      count: Math.round(520 * q), rng: r, ground: O.y,
      ramp: [[0, C('#e8ffff', 7)], [0.3, C('#3de0ff', 3.5)], [0.75, C('#1a5a8a', 0.8)], [1, C('#0a1420', 0.1)]],
      spawn(i, c, n) {
        const a = (i / n) * Math.PI * 2 + r() * 0.05;
        const sp = r.range(9, 14);
        c.x = O.x + Math.cos(a) * 0.4; c.y = O.y + 0.1 + r() * 0.2; c.z = O.z + Math.sin(a) * 0.4;
        c.vx = Math.cos(a) * sp; c.vy = r.range(0.3, 1.6); c.vz = Math.sin(a) * sp;
        c.drag = 1.5; c.g = 2; c.delay = 0.04 + r() * 0.06; c.life = r.range(1.3, 2.3);
        c.size = r.range(0.1, 0.22);
      },
    }));
    const flash = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));
    const center = V(O.x, O.y + 0.7, O.z);
    const lpos = V();
    const lcol = V();
    const WHITE = C('#fff6e0');
    const ORANGE = C('#ff8a30');
    const CYAN = C('#3de0ff');
    return {
      duration: 8,
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        a.boom(b, tDet, { power: 0.9, bright: 1.3, length: 1, crackle: 2.4, rng: r });
        // "bits": bipes curtos quadrados, como um jogo antigo
        for (let i = 0; i < 26; i++) {
          a.tone(b, tDet + 0.05 + Math.pow(r(), 1.5) * 2.4, { type: 'square', f0: 300 + r() * 1400, f1: 120 + r() * 300, glide: 0.12, dur: 0.14, gain: 0.03 + r() * 0.03, attack: 0.002, tau: 0.04, pan: r() * 1.6 - 0.8, wet: 0.4 });
        }
      },
      update(t) {
        core.update(t);
        column.update(t);
        ring.update(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        if (t < 0) { flash.hide(); if (flare) flare.hide(); return f; }
        const I = keys([[0, 0], [0.05, 46], [0.5, 20], [2.5, 8], [6, 0]], t) * (1 + 0.25 * noise1(t * 13));
        lcol.copy(WHITE).lerp(ORANGE, smooth(t / 1.2));
        lpos.set(O.x, O.y + 1.2 + Math.min(t, 3) * 0.6, O.z);
        stage.light(0, lpos, lcol, I, 9);
        stage.light(1, V(O.x, O.y + 0.3, O.z), CYAN, 14 * envelope(t, 0.05, 1.4), 10);
        const fl = envelope(t, 0.04, 0.16);
        // clarão "pixelado": dois quadrados girados em vez de um círculo
        flash.set(center, 9 * fl + 1, 9 * fl + 1, 9 * fl, WHITE, Math.PI / 4);
        const wt = clamp01(t / 1.8);
        stage.wave(0, O.x, O.z, 13 * easeOutCubic(wt), 3 * Math.pow(1 - wt, 1.5), 0.25 + 0.6 * wt, CYAN);
        stage.setHeat(O.x, O.z, 3, 2.6 * envelope(t, 0.1, 3), ORANGE);
        if (flare) flare.set(center, 1.2 * envelope(t, 0.04, 0.4));
        f.flash = (reduced ? 0.2 : 0.85) * envelope(t, 0.03, 0.14);
        f.flashColor.copy(WHITE);
        f.flashPos.copy(center);
        f.shake = reduced ? 0 : 1.3 * Math.exp(-t * 2.4) * smooth(t / 0.03);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-15 · Buraco negro: um núcleo escuro com disco de luz suga poeira e blocos do chão,
  // depois colapsa num estouro violeta. Pura fantasia visual.
  // =====================================================================
  const DISK_VERT = /* glsl */ `
    varying vec3 vLocal;
    varying vec3 vWorld;
    void main() {
      vLocal = position;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const DISK_FRAG = /* glsl */ `
    uniform sampler2D uNoise;
    uniform float uTime;
    uniform float uInner;
    uniform float uI;
    uniform vec3 uHot;
    uniform vec3 uWarm;
    uniform vec3 uCool;
    varying vec3 vLocal;
    varying vec3 vWorld;
    void main() {
      float r = length(vLocal.xz);
      float u = clamp((r - uInner) / (1.0 - uInner), 0.0, 1.0);
      float ang = atan(vLocal.z, vLocal.x + 1e-5);
      // gira mais rápido perto do centro
      float spin = uTime * (1.6 / (0.25 + u));
      vec2 nuv = vec2(ang / 6.2831853 * 3.0 + spin * 0.15, u * 1.7 - uTime * 0.05);
      float nz = texture2D(uNoise, nuv).r * 0.65 + texture2D(uNoise, nuv * 2.3 + 0.31).g * 0.5;
      float streak = 0.45 + 0.9 * pow(nz, 1.6);
      vec3 col = mix(uHot, uWarm, smoothstep(0.0, 0.35, u));
      col = mix(col, uCool, smoothstep(0.45, 1.0, u));
      float fall = pow(1.0 - u, 1.8) * smoothstep(0.0, 0.04, u);
      // lado que "vem" na direção da câmera fica mais forte (efeito Doppler de cinema)
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 tang = normalize(vec3(-vLocal.z, 0.0, vLocal.x));
      float dop = 1.0 + 0.7 * dot(tang, V);
      gl_FragColor = vec4(col * streak * fall * dop * uI, 0.0);
    }
  `;

  function buildBlackHole(ctx) {
    const T = new Take(ctx);
    const { origin: O, r, tex, reduced, stage, camera } = ctx;
    const d = V();
    const q = Math.max(0.35, ctx.q);
    const HB = 4.6;      // altura do núcleo acima do chão
    const RB = 1.25;     // raio do núcleo
    const TC = 8.2;      // colapso
    const HP = V(O.x, O.y + HB, O.z);

    // núcleo: esfera preta que esconde o que está atrás
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), coreMat);
    coreMesh.position.copy(HP);
    coreMesh.visible = false;
    coreMesh.renderOrder = 1;
    T.add({ mesh: coreMesh, dispose() { coreMesh.removeFromParent(); coreMesh.geometry.dispose(); coreMat.dispose(); } });

    // disco de acreção
    const diskU = {
      uNoise: { value: tex.noise }, uTime: { value: 0 }, uInner: { value: 0.24 }, uI: { value: 0 },
      uHot: { value: C('#ffe0a8', 0.8) }, uWarm: { value: C('#ff9a3a', 0.6) }, uCool: { value: C('#9a2e22', 0.35) },
    };
    const diskMat = new THREE.ShaderMaterial({
      uniforms: diskU, vertexShader: DISK_VERT, fragmentShader: DISK_FRAG, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const diskGeo = new THREE.RingGeometry(0.24, 1, 160, 1);
    diskGeo.rotateX(-Math.PI / 2);
    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.position.copy(HP);
    disk.rotation.set(0.22, 0, 0.12);
    disk.renderOrder = 6;
    disk.visible = false;
    T.add({ mesh: disk, dispose() { disk.removeFromParent(); diskGeo.dispose(); diskMat.dispose(); } });

    const photon = T.add(new P.Ring({ camera, billboard: true, order: 8 }));
    const halo = T.add(new P.Glow({ tex: tex.glow, depthTest: true, order: 5 }));
    const burst = T.add(new P.Glow({ tex: tex.glow, order: 12 }));
    const dome = T.add(new P.Dome({ tex: tex.noise, hemisphere: false, colorA: C('#e6d8ff', 1.4), colorB: C('#7a3cff', 0.8), noise: 0.4, core: 0.03, power: 3.4 }));
    const flare = reduced ? null : T.add(new P.LensFlare({ camera, glowTex: tex.glow, hexTex: tex.hex }));

    // poeira sugada em espiral até o núcleo (move de forma analítica: converge para o ponto)
    const kD = 0.95;
    T.particles({
      count: 260, texture: tex.puff, atlas: true, order: 3, swirl: 3.2,
      colors: [C('#6a5a4c', 0.8), C('#8a5a3a', 1.0), C('#ff9a4a', 1.8), C('#ffc070', 2.2), C('#ffb060', 2.2)],
      stops: [0.3, 0.6, 0.85], alpha: [0.1, 0.5, 0.7, 0], occ: [0.0, 0.1, 0.6],
      sizeEase: 0.7, turb: [0.15, 1.2], lit: 0.3,
      spawn(i, p) {
        const a = r() * Math.PI * 2;
        const rad = r.range(2.5, 15);
        p.x = O.x + Math.cos(a) * rad; p.y = O.y + 0.2 + r() * 0.5; p.z = O.z + Math.sin(a) * rad;
        p.vx = (HP.x - p.x) * kD * 1.02; p.vy = (HP.y - p.y) * kD * 1.02; p.vz = (HP.z - p.z) * kD * 1.02;
        p.drag = kD; p.delay = 0.4 + r() * (TC - 3.2); p.life = r.range(2.6, 3.4);
        p.s0 = r.range(0.7, 1.3); p.s1 = r.range(0.08, 0.2); p.rot = r() * 6.28; p.spin = r.range(-2, 2);
      },
    });
    // faíscas quentes caindo no disco
    T.particles({
      count: 320, texture: tex.spark, streak: true, stretch: 0.12, order: 6, swirl: 5,
      colors: [C('#ffd08a', 2), C('#ffb04a', 3), C('#ffe0b0', 3.5), C('#ffe0b0', 3), C('#ffd0a0', 1)],
      stops: [0.3, 0.6, 0.9], alpha: [0.1, 0.6, 1, 0],
      spawn(i, p) {
        const a = r() * Math.PI * 2;
        const rad = r.range(4, 9);
        p.x = HP.x + Math.cos(a) * rad; p.y = HP.y + r.range(-1.2, 1.2); p.z = HP.z + Math.sin(a) * rad;
        p.vx = (HP.x - p.x) * 1.4; p.vy = (HP.y - p.y) * 1.4; p.vz = (HP.z - p.z) * 1.4;
        p.drag = 1.35; p.delay = 0.6 + r() * (TC - 1.8); p.life = r.range(1.4, 2.2);
        p.s0 = p.s1 = r.range(0.03, 0.06);
      },
    });
    // estouro final: cubos violeta e brancos
    const pix = T.add(new VoxelBurst({
      count: Math.round(1300 * q), rng: r, ground: O.y,
      ramp: [[0, C('#ffffff', 10)], [0.2, C('#d8c4ff', 6)], [0.5, C('#8a4dff', 2.6)], [0.8, C('#2a1450', 0.5)], [1, C('#0a0814', 0.1)]],
      spawn(i, c) {
        r.sphere(d);
        const sp = r.range(5, 18);
        c.x = HP.x; c.y = HP.y; c.z = HP.z;
        c.vx = d.x * sp; c.vy = d.y * sp * 0.7 + 1; c.vz = d.z * sp;
        c.drag = 1.6; c.g = 1.5; c.delay = TC + 0.45 + r() * 0.1; c.life = r.range(1.6, 3.4);
        c.size = r.range(0.12, 0.32);
      },
    }));

    const ORANGE = C('#ffa040');
    const VIOLET = C('#9a5cff');
    const WHITE = C('#f4ecff');
    const lpos = V();
    return {
      duration: 12,
      pull: { y: HB, spread: TC - 1.5 },
      sound(tDet) {
        const a = ctx.audio;
        const b = ctx.bus;
        const L = TC + 0.4;
        a.tone(b, tDet, { f0: 46, f1: 31, glide: L, dur: L, gain: 0.55, attack: 1.2, hold: L - 2, tau: 0.6, wet: 0.3 });
        a.tone(b, tDet, { type: 'triangle', f0: 69, f1: 47, glide: L, dur: L, gain: 0.12, attack: 1.5, hold: L - 2.5, tau: 0.6, detune: 9, wet: 0.5 });
        a.noise(b, tDet, { buf: 'brown', dur: L, env: [[0, 0.0001], [1.5, 0.3], [L - 0.6, 0.45], [L, 0.0001]], filter: { type: 'lowpass', f0: 90, f1: 260, glide: L }, wet: 0.4 });
        // ar sendo puxado: chiado que sobe até o colapso
        a.noise(b, tDet + 1, { dur: L - 1, env: [[0, 0.0001], [L - 2, 0.06], [L - 1.05, 0.22], [L - 1, 0.0001]], filter: { type: 'bandpass', f0: 600, f1: 5000, glide: L - 1, q: 1.2 }, wet: 0.7 });
        a.boom(b, tDet + TC + 0.45, { power: 1.15, bright: 0.7, length: 1.5, crackle: 1, rng: r });
      },
      update(t) {
        T.tick(t);
        pix.update(t);
        const f = T.frame;
        f.flash = 0; f.shake = 0; f.dim = 1;
        diskU.uTime.value = t;
        if (t < 0) {
          coreMesh.visible = false; disk.visible = false; photon.hide(); halo.hide(); burst.hide(); dome.hide(); if (flare) flare.hide();
          f.dim = 1 - 0.2 * clamp01(1 + t / 3);
          return f;
        }
        const form = easeOutCubic(clamp01(t / 1.4));
        const col = 1 - smooth(clamp01((t - TC) / 0.45));        // encolhe no colapso
        const live = form * col;
        coreMesh.visible = live > 0.01;
        coreMesh.scale.setScalar(Math.max(0.001, RB * live));
        disk.visible = live > 0.01;
        const wob = 1 + 0.03 * Math.sin(t * 7);
        disk.scale.setScalar(Math.max(0.001, 6.5 * live * wob));
        diskU.uI.value = (1.2 + 0.9 * smooth(clamp01((t - TC + 1.5) / 1.5))) * form;
        photon.set(HP, RB * 1.2 * live, 0.035, 1.5 * live, WHITE);
        halo.set(HP, 9 * live, 9 * live, 0.35 * live, VIOLET);
        disk.rotation.y = t * 0.15;

        // luz do disco e escuridão em volta
        lpos.set(HP.x, HP.y - 0.6, HP.z);
        stage.light(0, lpos, ORANGE, 18 * live * (1 + 0.15 * noise1(t * 9)), 11);
        stage.light(1, V(O.x, O.y + 0.4, O.z), VIOLET, 5 * live, 9);
        stage.setHeat(O.x, O.z, 5, 1.1 * live, ORANGE);
        // ondas que andam PARA DENTRO (o chão sendo puxado)
        for (let i = 0; i < 2; i++) {
          const ph = ((t * 0.7 + i * 0.5) % 1);
          stage.wave(i, O.x, O.z, 14 * (1 - ph), 1.2 * live * smooth(ph * 3), 0.5, VIOLET);
        }
        f.dim = 1 - 0.55 * live;

        // colapso e estouro
        const tb = t - TC - 0.45;
        if (tb >= 0) {
          const bI = keys([[0, 38], [0.4, 16], [2.5, 5], [4, 0]], tb);
          stage.light(2, HP, WHITE, bI, 16);
          const fl = envelope(tb, 0.03, 0.25);
          burst.set(HP, 10 * fl + 2, 10 * fl + 2, 5 * fl, WHITE);
          const dt01 = clamp01(tb / 1.1);
          dome.set(HP, 13 * easeOutCubic(dt01), 0.45 * Math.pow(1 - dt01, 2), t);
          const wt = clamp01(tb / 2.2);
          stage.wave(2, O.x, O.z, 20 * easeOutCubic(wt), 3 * Math.pow(1 - wt, 1.5), 0.3 + 0.8 * wt, VIOLET);
          if (flare) flare.set(HP, 1.5 * envelope(tb, 0.04, 0.5));
          f.flash = (reduced ? 0.2 : 0.55) * envelope(tb, 0.03, 0.2);
          f.flashColor.copy(WHITE);
          f.flashPos.copy(HP);
          f.dim = Math.max(f.dim, 1 - 0.55 * live);
        } else {
          burst.hide(); dome.hide(); if (flare) flare.hide();
        }
        f.shake = reduced ? 0 : 0.22 * live + (tb >= 0 ? 1.6 * Math.exp(-tb * 2.2) : 0);
        return f;
      },
      dispose() { T.dispose(); },
    };
  }

  // =====================================================================
  // FX-13 · Bomba Ridícula: o editor com tudo no máximo e potência ×1000
  // =====================================================================
  const ridicula = B.makeCustomEffect({
    id: 'ridicula', core: '#ffffff', mid: '#ffb040', smoke: '#3a2a26',
    size: 1, fire: 1, smokeAmt: 0.9, sparks: 1, wave: 1, flash: 1, shake: 1, height: 0.8, power: 1, sound: 'estrondo',
  });
  Object.assign(ridicula, {
    code: 'FX-13', name: 'Bomba Ridícula', custom: false,
    desc: 'Potência ×1000 de mentira: clarão gigante, coluna de luz até o céu, chuva de cubos em brasa e uma cratera enorme.',
  });

  B.EFFECTS.push(
    ridicula,
    {
      id: 'pixels', code: 'FX-14', name: 'Explosão de pixels',
      desc: 'A bola de fogo é feita de cubos brilhantes, com anel de pixels ciano e coluna quadrada.',
      swatch: ['#ffffff', '#ff9a2a', '#3de0ff'], build: buildPixels, craterK: 0.9, aimY: 1.6, frameK: 1.2,
    },
    {
      id: 'buraco', code: 'FX-15', name: 'Buraco negro',
      desc: 'Um núcleo escuro com disco de luz suga poeira e blocos do chão e depois colapsa num estouro violeta.',
      swatch: ['#000000', '#ffb04a', '#9a5cff'], build: buildBlackHole, craterK: 1.8, aimY: 3.6, frameK: 1.35,
      pull: { y: 4.6, spread: 6.7 },
    },
  );
})();
