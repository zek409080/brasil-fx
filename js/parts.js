/* Peças reutilizáveis dos efeitos: brilho (billboard), domo de choque / esfera de energia,
   anel, feixe de pulsar, raios elétricos e reflexos de lente. Todas desenham em HDR linear;
   o passe final aplica tone mapping e converte para sRGB. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE) return;
  const THREE = window.THREE;

  const ADDITIVE = {
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  };

  // ---------------------------------------------------------------- brilho
  const GLOW_VERT = /* glsl */ `
    uniform vec3 uCenter;
    uniform vec2 uScale;
    uniform float uRot;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 mv = viewMatrix * vec4(uCenter, 1.0);
      float c = cos(uRot);
      float s = sin(uRot);
      mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * uScale;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const GLOW_FRAG = /* glsl */ `
    uniform sampler2D uMap;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      vec4 t = texture2D(uMap, vUv);
      gl_FragColor = vec4(uColor * t.rgb * t.a, 0.0);
    }
  `;

  class Glow {
    constructor({ tex, depthTest = false, order = 8 }) {
      this.u = {
        uCenter: { value: new THREE.Vector3() },
        uScale: { value: new THREE.Vector2(1, 1) },
        uRot: { value: 0 },
        uMap: { value: tex },
        uColor: { value: new THREE.Vector3() },
      };
      this.material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, depthTest, ...ADDITIVE });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = order;
      this.mesh.visible = false;
    }
    /** color: Vector3 linear (multiplicado por intensity) */
    set(center, sx, sy, intensity, color, rot = 0) {
      const on = intensity > 0.0005 && sx > 0 && sy > 0;
      this.mesh.visible = on;
      if (!on) return;
      this.u.uCenter.value.copy(center);
      this.u.uScale.value.set(sx, sy);
      this.u.uRot.value = rot;
      this.u.uColor.value.copy(color).multiplyScalar(intensity);
    }
    hide() { this.mesh.visible = false; }
    update() {}
    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  // ---------------------------------------------------------------- domo / esfera
  const DOME_VERT = /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vLocal;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vLocal = position;
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const DOME_FRAG = /* glsl */ `
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uNoiseAmt;
    uniform float uCore;
    uniform float uPower;
    uniform sampler2D uNoise;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vLocal;
    void main() {
      vec3 n = normalize(vN);
      float f = 1.0 - abs(dot(n, normalize(vV)));
      float rim = pow(f, uPower);
      // +1e-5 evita atan(0, 0) nos polos da esfera (indefinido: pode gerar NaN)
      vec2 nuv = vec2(atan(vLocal.z, vLocal.x + 1e-5) / 6.2831853 + uTime * 0.04, vLocal.y * 0.45 - uTime * 0.11);
      vec4 nz = texture2D(uNoise, nuv * 2.0);
      vec4 nz2 = texture2D(uNoise, nuv * 3.7 + vec2(0.37, uTime * 0.07));
      float flow = mix(1.0, (nz.r * 0.7 + nz2.g * 0.6) * 1.7, uNoiseAmt);
      float band = pow(nz2.b, 3.0) * uNoiseAmt;
      vec3 col = mix(uColorB, uColorA, rim) * (rim * 1.25 + uCore) * flow + uColorA * band * 0.8;
      gl_FragColor = vec4(col * uOpacity, 0.0);
    }
  `;

  class Dome {
    constructor({ tex, hemisphere = true, colorA, colorB, noise = 0.5, core = 0.06, power = 2.6, order = 7 }) {
      this.u = {
        uColorA: { value: (colorA || new THREE.Vector3(1, 0.9, 0.8)).clone() },
        uColorB: { value: (colorB || new THREE.Vector3(1, 0.5, 0.2)).clone() },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uNoiseAmt: { value: noise },
        uCore: { value: core },
        uPower: { value: power },
        uNoise: { value: tex },
      };
      this.material = new THREE.ShaderMaterial({
        uniforms: this.u, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.DoubleSide, ...ADDITIVE,
      });
      const geo = hemisphere
        ? new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2)
        : new THREE.SphereGeometry(1, 48, 32);
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.renderOrder = order;
      this.mesh.visible = false;
    }
    set(center, radius, opacity, time, yScale = 1) {
      const on = opacity > 0.002 && radius > 0.01;
      this.mesh.visible = on;
      if (!on) return;
      this.mesh.position.copy(center);
      this.mesh.scale.set(radius, radius * yScale, radius);
      this.u.uOpacity.value = opacity;
      this.u.uTime.value = time;
    }
    hide() { this.mesh.visible = false; }
    update() {}
    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  // ---------------------------------------------------------------- anel
  const RING_VERT = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const RING_FRAG = /* glsl */ `
    uniform vec3 uColor;
    uniform float uThick;
    uniform float uFill;
    varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      float d = abs(r - (1.0 - uThick));
      float ring = 1.0 - smoothstep(0.0, uThick, d);
      ring *= ring;
      float fill = smoothstep(0.2, 1.0 - uThick, r) * step(r, 1.0 - uThick) * uFill;
      gl_FragColor = vec4(uColor * (ring + fill), 0.0);
    }
  `;

  class Ring {
    constructor({ camera, billboard = true, order = 7, depthTest = true }) {
      this.camera = camera;
      this.billboard = billboard;
      this.u = { uColor: { value: new THREE.Vector3() }, uThick: { value: 0.08 }, uFill: { value: 0.0 } };
      this.material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, depthTest, ...ADDITIVE });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
      this.mesh.renderOrder = order;
      this.mesh.visible = false;
    }
    /** quat: orientação no mundo quando não é billboard */
    set(center, radius, thick, intensity, color, quat, fill = 0) {
      const on = intensity > 0.001 && radius > 0.01;
      this.mesh.visible = on;
      if (!on) return;
      this.mesh.position.copy(center);
      this.mesh.scale.setScalar(radius);
      if (this.billboard) this.mesh.quaternion.copy(this.camera.quaternion);
      else if (quat) this.mesh.quaternion.copy(quat);
      this.u.uThick.value = thick;
      this.u.uFill.value = fill;
      this.u.uColor.value.copy(color).multiplyScalar(intensity);
    }
    hide() { this.mesh.visible = false; }
    update() {}
    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  // ---------------------------------------------------------------- feixe (pulsar)
  const BEAM_VERT = /* glsl */ `
    uniform vec3 uStart;
    uniform vec3 uAxis;
    uniform float uLen;
    uniform vec2 uWidth;
    varying vec2 vUv;
    void main() {
      float s = position.y + 0.5;
      vec3 p = uStart + uAxis * s * uLen;
      vec3 toCam = normalize(cameraPosition - p);
      vec3 side = cross(uAxis, toCam);
      side /= max(length(side), 1e-4);
      p += side * position.x * 2.0 * mix(uWidth.x, uWidth.y, s);
      vUv = vec2(position.x * 2.0, s);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }
  `;
  const BEAM_FRAG = /* glsl */ `
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      float across = exp(-vUv.x * vUv.x * 4.0);
      float core = exp(-vUv.x * vUv.x * 40.0);
      float along = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.04, vUv.y);
      gl_FragColor = vec4(uColor * (across * 0.6 + core) * along, 0.0);
    }
  `;

  class Beam {
    constructor({ order = 7 } = {}) {
      this.u = {
        uStart: { value: new THREE.Vector3() },
        uAxis: { value: new THREE.Vector3(0, 1, 0) },
        uLen: { value: 1 },
        uWidth: { value: new THREE.Vector2(0.05, 0.4) },
        uColor: { value: new THREE.Vector3() },
      };
      this.material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide, ...ADDITIVE });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 12), this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = order;
      this.mesh.visible = false;
    }
    set(start, axis, len, w0, w1, intensity, color) {
      const on = intensity > 0.001;
      this.mesh.visible = on;
      if (!on) return;
      this.u.uStart.value.copy(start);
      this.u.uAxis.value.copy(axis).normalize();
      this.u.uLen.value = len;
      this.u.uWidth.value.set(w0, w1);
      this.u.uColor.value.copy(color).multiplyScalar(intensity);
    }
    hide() { this.mesh.visible = false; }
    update() {}
    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  // ---------------------------------------------------------------- raios
  const BOLT_VERT = /* glsl */ `
    attribute vec3 aOther;
    attribute float aSide;
    attribute float aDir;
    attribute float aGain;
    uniform float uWidth;
    varying float vSide;
    varying float vGain;
    void main() {
      vec4 a = viewMatrix * vec4(position, 1.0);
      vec4 b = viewMatrix * vec4(aOther, 1.0);
      vec2 d = (b.xy - a.xy) * aDir;
      float l = length(d);
      d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
      a.xy += vec2(-d.y, d.x) * aSide * uWidth * (0.35 + aGain);
      vSide = aSide;
      vGain = aGain;
      gl_Position = projectionMatrix * a;
    }
  `;
  const BOLT_FRAG = /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uCore;
    varying float vSide;
    varying float vGain;
    void main() {
      float x = vSide;
      float glow = exp(-x * x * 3.0);
      float core = exp(-x * x * 26.0);
      gl_FragColor = vec4((uColor * glow + uCore * core) * vGain, 0.0);
    }
  `;

  class Lightning {
    constructor({ bolts = 6, levels = 4, width = 0.05, order = 7 }) {
      this.bolts = bolts;
      this.segs = 1 << levels;
      this.levels = levels;
      const nSeg = bolts * this.segs;
      const nV = nSeg * 4;
      this.pos = new Float32Array(nV * 3);
      this.other = new Float32Array(nV * 3);
      this.gain = new Float32Array(nV);
      const side = new Float32Array(nV);
      const dir = new Float32Array(nV);
      const index = [];
      for (let s = 0; s < nSeg; s++) {
        const v = s * 4;
        side[v] = -1; side[v + 1] = 1; side[v + 2] = -1; side[v + 3] = 1;
        dir[v] = 1; dir[v + 1] = 1; dir[v + 2] = -1; dir[v + 3] = -1;
        index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aOther', new THREE.BufferAttribute(this.other, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aGain', new THREE.BufferAttribute(this.gain, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 1));
      geo.setIndex(index);
      this.u = { uWidth: { value: width }, uColor: { value: new THREE.Vector3() }, uCore: { value: new THREE.Vector3() } };
      this.material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG, side: THREE.DoubleSide, ...ADDITIVE });
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = order;
      this.mesh.visible = false;
      this.pts = [];
      for (let i = 0; i <= this.segs; i++) this.pts.push(new THREE.Vector3());
      this._tmp = new THREE.Vector3();
      this._perp = new THREE.Vector3();
    }

    /** Recria as linhas: list = [{a, b, gain, jag}] com a/b Vector3; r = rng */
    regen(list, r) {
      const segs = this.segs;
      const pts = this.pts;
      for (let bi = 0; bi < this.bolts; bi++) {
        const item = list[bi];
        const base = bi * segs * 4;
        if (!item || item.gain <= 0) {
          for (let k = 0; k < segs * 4; k++) this.gain[base + k] = 0;
          continue;
        }
        pts[0].copy(item.a);
        pts[segs].copy(item.b);
        const jag = item.jag ?? 0.3;
        // deslocamento do ponto médio, nível a nível
        for (let step = segs; step > 1; step >>= 1) {
          const half = step >> 1;
          for (let i = half; i < segs; i += step) {
            const p0 = pts[i - half];
            const p1 = pts[i + half];
            const len = p0.distanceTo(p1);
            this._tmp.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).multiplyScalar(len * jag);
            pts[i].copy(p0).add(p1).multiplyScalar(0.5).add(this._tmp);
          }
        }
        for (let s = 0; s < segs; s++) {
          const a = pts[s];
          const b = pts[s + 1];
          const v = base + s * 4;
          const g = item.gain * (1 - (s / segs) * (item.taper ?? 0.6));
          for (let k = 0; k < 4; k++) {
            const self = k < 2 ? a : b;
            const oth = k < 2 ? b : a;
            this.pos[(v + k) * 3] = self.x; this.pos[(v + k) * 3 + 1] = self.y; this.pos[(v + k) * 3 + 2] = self.z;
            this.other[(v + k) * 3] = oth.x; this.other[(v + k) * 3 + 1] = oth.y; this.other[(v + k) * 3 + 2] = oth.z;
            this.gain[v + k] = g;
          }
        }
      }
      const g = this.mesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.aOther.needsUpdate = true;
      g.attributes.aGain.needsUpdate = true;
    }

    set(intensity, color, core) {
      const on = intensity > 0.001;
      this.mesh.visible = on;
      if (!on) return;
      this.u.uColor.value.copy(color).multiplyScalar(intensity);
      this.u.uCore.value.copy(core || color).multiplyScalar(intensity);
    }
    hide() { this.mesh.visible = false; }
    update() {}
    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  // ---------------------------------------------------------------- reflexos de lente
  class LensFlare {
    constructor({ camera, glowTex, hexTex }) {
      this.camera = camera;
      this.group = new THREE.Group();
      this.mesh = this.group;
      this.ghosts = [
        { k: 0.55, size: 0.10, tex: hexTex, col: new THREE.Vector3(0.35, 0.55, 1.0), gain: 0.5 },
        { k: 0.1, size: 0.05, tex: glowTex, col: new THREE.Vector3(1.0, 0.7, 0.35), gain: 0.6 },
        { k: -0.35, size: 0.16, tex: hexTex, col: new THREE.Vector3(0.6, 0.35, 1.0), gain: 0.35 },
        { k: -0.75, size: 0.07, tex: glowTex, col: new THREE.Vector3(0.3, 1.0, 0.8), gain: 0.5 },
        { k: -1.15, size: 0.24, tex: hexTex, col: new THREE.Vector3(1.0, 0.5, 0.3), gain: 0.25 },
      ];
      this.glows = this.ghosts.map((g) => {
        const gl = new Glow({ tex: g.tex, depthTest: false, order: 20 });
        this.group.add(gl.mesh);
        return gl;
      });
      this._v = new THREE.Vector3();
      this._w = new THREE.Vector3();
      this._c = new THREE.Vector3();
    }
    set(world, intensity, tint) {
      const cam = this.camera;
      const v = this._v.copy(world).project(cam);
      const edge = Math.max(Math.abs(v.x), Math.abs(v.y));
      const vis = intensity * (v.z < 1 ? 1 : 0) * (1 - Math.min(1, Math.max(0, (edge - 0.9) / 0.4)));
      if (vis <= 0.002) { this.hide(); return; }
      const d = 2;
      const tanH = Math.tan((cam.fov * Math.PI) / 360);
      // profundidade NDC de um ponto a d unidades da câmera (vale também com setViewOffset)
      const zN = this._c.set(0, 0, -d).applyMatrix4(cam.projectionMatrix).z;
      for (let i = 0; i < this.ghosts.length; i++) {
        const g = this.ghosts[i];
        this._w.set(v.x * g.k, v.y * g.k, zN).unproject(cam);
        const s = g.size * d * tanH * 2;
        this._c.copy(g.col);
        if (tint) this._c.multiply(tint);
        this.glows[i].set(this._w, s, s, vis * g.gain, this._c);
      }
    }
    hide() { for (const g of this.glows) g.hide(); }
    update() {}
    dispose() {
      this.group.removeFromParent();
      for (const g of this.glows) g.dispose();
    }
  }

  // ---------------------------------------------------------------- cratera em blocos
  // O chão num quadrado ao redor do ponto vira colunas de blocos. Na detonação, os blocos
  // do centro voam em arco e as colunas afundam num perfil de cratera com borda levantada.
  // A profundidade é só visual (proporcional à "intensidade" do efeito), sem física real.
  const BLOCK_VERT = /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying vec3 vCol;
    void main() {
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vCol = instanceColor;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const blockFrag = () => B.SCENE_GLSL + /* glsl */ `
    uniform vec4 uGlow;     // x, z, raio, intensidade (fundo incandescente)
    uniform vec3 uGlowCol;
    uniform float uFade;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying vec3 vCol;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 diff;
      vec3 spec;
      sceneLights(vWorld, n, V, 40.0, diff, spec);
      float top = step(0.5, n.y);
      vec3 L = (uAmbient * (0.75 + 0.25 * top) + uKeyCol * max(dot(n, uKeyDir), 0.0)) * uDim + diff;
      vec3 col = min(vCol, vec3(1.0)) * L * (0.72 + 0.28 * top);
      // cor acima de 1 = brasa: brilha sem depender da luz (o bloom espalha)
      col += max(vCol - vec3(1.0), vec3(0.0)) * (0.7 + 0.3 * top);
      // arestas escuras: leem-se como blocos
      col += groundFx(vWorld.xz) * 0.5 * top;
      float r = length(vWorld.xz - uGlow.xy) / max(uGlow.z, 1e-3);
      col += uGlowCol * uGlow.w * exp(-r * r * 3.0) * (0.4 + 0.6 * top);
      float fd = distance(vWorld, cameraPosition);
      col = mix(col, uFogCol, smoothstep(uFog.x, uFog.y, fd));
      gl_FragColor = vec4(col * uFade, 1.0);
    }
  `;

  class BlockCrater {
    constructor({ map, sceneU, origin, k, rng }) {
      this.map = map;
      this.u = sceneU;
      this.k = k;
      const c = 0.26;
      const N = 28;
      this.c = c;
      this.half = (N * c) / 2;
      this.R = Math.min(this.half * 0.8, 1.3 + 1.6 * k);
      this.D = 0.45 + 1.9 * k;
      this.bottom = -4.5;
      this.center = new THREE.Vector3(origin.x, 0, origin.z);
      const cells = [];
      const col = new THREE.Color();
      const v = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const x = origin.x - this.half + (i + 0.5) * c;
          const z = origin.z - this.half + (j + 0.5) * c;
          const land = map.surfaceColor(x, z, v);
          const jitter = 0.9 + rng() * 0.2;
          const baseTop = land ? map.H : 0;
          const r = Math.hypot(x - origin.x, z - origin.z) / this.R;
          cells.push({ x, z, r, baseTop, color: v.clone().multiplyScalar(jitter), land, seed: rng() });
        }
      }
      this.cells = cells;
      this.uniforms = Object.assign({}, sceneU, {
        uGlow: { value: new THREE.Vector4(origin.x, origin.z, this.R * 0.7, 0) },
        uGlowCol: { value: new THREE.Vector3(3.2, 0.9, 0.2) },
        uFade: { value: 1 },
      });
      const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BLOCK_VERT, fragmentShader: blockFrag() });
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      this.columns = new THREE.InstancedMesh(box, mat, cells.length);
      this.columns.frustumCulled = false;
      const scorch = new THREE.Color(0.02, 0.018, 0.016);
      for (let i = 0; i < cells.length; i++) {
        col.setRGB(cells[i].color.x, cells[i].color.y, cells[i].color.z);
        this.columns.setColorAt(i, col);
        const s = Math.max(0, 1 - cells[i].r * 0.85);
        cells[i].scorched = col.clone().lerp(scorch, Math.min(1, s * 1.4));
      }
      // fragmentos que voam: um por célula de dentro da cratera
      const flying = cells.filter((q) => q.r < 0.8);
      this.debris = flying.map((q) => {
        const a = Math.atan2(q.z - origin.z, q.x - origin.x) + (rng() - 0.5) * 0.6;
        const out = (2 + rng() * 5) * (0.6 + 0.6 * k) * (1.1 - q.r);
        return {
          x: q.x, z: q.z, y: q.baseTop,
          vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: (4 + rng() * 6) * (0.6 + 0.5 * k) * (1.2 - q.r),
          spin: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), w: 4 + rng() * 10,
          size: c * (0.55 + rng() * 0.4), delay: q.r * 0.08, color: q.color,
        };
      });
      this.flying = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, this.debris.length));
      this.flying.frustumCulled = false;
      this.debris.forEach((d, i) => {
        col.setRGB(d.color.x * 0.7, d.color.y * 0.7, d.color.z * 0.7);
        this.flying.setColorAt(i, col);
      });
      this.mesh = new THREE.Group();
      this.mesh.add(this.columns, this.flying);
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3();
      this._s = new THREE.Vector3();
      this.u.uHole.value.set(origin.x, origin.z, this.half - 0.001, 1);
      this.lastT = null;
      this.update(-10);
    }

    update(t) {
      if (t === this.lastT) return;
      this.lastT = t;
      const dig = t <= 0 ? 0 : easeOutC(Math.min(1, t / 0.45));
      const m = this._m;
      const col = new THREE.Color();
      for (let i = 0; i < this.cells.length; i++) {
        const q = this.cells[i];
        let top = q.baseTop;
        if (q.r < 1) top -= this.D * (1 - q.r * q.r) * dig;
        else if (q.r < 1.4) top += this.D * 0.22 * Math.sin(((q.r - 1) / 0.4) * Math.PI) * dig;
        top = Math.max(this.bottom + 0.05, top);
        const h = top - this.bottom;
        m.makeScale(this.c * 0.985, h, this.c * 0.985);
        m.setPosition(q.x, this.bottom, q.z);
        this.columns.setMatrixAt(i, m);
        if (q.r < 1.15) {
          col.setRGB(q.color.x, q.color.y, q.color.z).lerp(q.scorched, dig);
          this.columns.setColorAt(i, col);
        }
      }
      this.columns.instanceMatrix.needsUpdate = true;
      this.columns.instanceColor.needsUpdate = true;
      const g = 9;
      for (let i = 0; i < this.debris.length; i++) {
        const d = this.debris[i];
        const tt = t - d.delay;
        if (tt <= 0) {
          m.makeScale(0, 0, 0);
        } else {
          const y = d.y + d.vy * tt - 0.5 * g * tt * tt;
          const s = y < this.bottom + 1 ? 0 : d.size * Math.max(0, 1 - Math.max(0, tt - 1.8) / 1.2);
          this._q.setFromAxisAngle(d.spin, d.w * tt);
          this._p.set(d.x + d.vx * tt, y, d.z + d.vz * tt);
          this._s.setScalar(s);
          m.compose(this._p, this._q, this._s);
        }
        this.flying.setMatrixAt(i, m);
      }
      this.flying.instanceMatrix.needsUpdate = true;
      // fundo incandescente que esfria
      this.uniforms.uGlow.value.w = t > 0 ? 1.6 * Math.exp(-t / 2.5) * Math.min(1, t / 0.2) : 0;
    }

    dispose() {
      this.u.uHole.value.w = 0;
      this.mesh.removeFromParent();
      this.columns.geometry.dispose();
      this.flying.geometry.dispose();
      this.columns.material.dispose();
      this.columns.dispose();
      this.flying.dispose();
    }
  }
  const easeOutC = (x) => 1 - Math.pow(1 - x, 3);

  /** material dos blocos soltos, com a mesma luz do mapa */
  function blockMaterial(sceneU) {
    const uniforms = Object.assign({}, sceneU, {
      uGlow: { value: new THREE.Vector4(0, 0, 1, 0) },
      uGlowCol: { value: new THREE.Vector3(3.2, 0.9, 0.2) },
      uFade: { value: 1 },
    });
    return new THREE.ShaderMaterial({ uniforms, vertexShader: BLOCK_VERT, fragmentShader: blockFrag() });
  }

  /**
   * Blocos arrancados do chão (mapa e planeta). Anel de instâncias reaproveitadas.
   * Cada bloco: x,y,z, vx,vy,vz, ax,ay,az (eixo de giro), w (giro), size, t0, cr,cg,cb (cor),
   * heat (0–1: começa em brasa e esfria), water (some ao tocar o chão),
   * pull {x,y,z} + dur (sugado em espiral até o ponto, como pelo buraco negro).
   */
  class DebrisField {
    constructor(sceneU, max) {
      this.max = max;
      this.list = [];
      this.next = 0;
      this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blockMaterial(sceneU), max);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const col = new THREE.Color(0.02, 0.03, 0.035);
      for (let k = 0; k < max; k++) {
        this.mesh.setMatrixAt(k, zero);
        this.mesh.setColorAt(k, col);
      }
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3();
      this._s = new THREE.Vector3();
      this._a = new THREE.Vector3();
      this._c = new THREE.Color();
    }

    /** adiciona uma leva respeitando o tamanho do anel (sorteia quem fica quando passa do limite) */
    add(batch, rng) {
      const cap = this.max * 0.92;
      const keep = batch.length > cap ? cap / batch.length : 1;
      for (const d of batch) {
        if (keep < 1 && rng() > keep) continue;
        if (keep < 1) d.size *= 1 + (1 - keep) * 0.35;
        this._spawn(d);
      }
      this.mesh.instanceColor.needsUpdate = true;
    }

    _spawn(d) {
      const slot = this.next;
      this.next = (this.next + 1) % this.max;
      d.slot = slot;
      this._color(d, 0);
      this.mesh.setColorAt(slot, this._c);
      this.list = this.list.filter((o) => o.slot !== slot);
      this.list.push(d);
    }

    _color(d, tt) {
      const h = d.heat ? d.heat * (1 - smooth01(tt / 2.4)) : 0;
      this._c.setRGB(d.cr + (6.5 - d.cr) * h, d.cg + (2.1 - d.cg) * h, d.cb + (0.5 - d.cb) * h);
    }

    update(t, groundAt) {
      if (!this.list.length) return;
      const g = 9;
      const m = this._m;
      const keep = [];
      let recolor = false;
      for (const d of this.list) {
        const tt = t - d.t0;
        if (tt < 0) { this.mesh.setMatrixAt(d.slot, m.makeScale(0, 0, 0)); keep.push(d); continue; }
        let px, y, pz, sc;
        let spin = d.w * tt;
        if (d.pull) {
          const u = Math.min(1, tt / d.dur);
          if (u >= 1) { this.mesh.setMatrixAt(d.slot, m.makeScale(0, 0, 0)); continue; }
          const e = u * u * (3 - 2 * u);
          const ee = Math.pow(e, 1.35);
          const P = d.pull;
          let rx = (d.x - P.x) * (1 - ee);
          let rz = (d.z - P.z) * (1 - ee);
          const ang = e * (4 + d.w * 0.3);
          const cs = Math.cos(ang), sn = Math.sin(ang);
          px = P.x + cs * rx - sn * rz;
          pz = P.z + sn * rx + cs * rz;
          y = d.y + (P.y - d.y) * ee + Math.sin(u * Math.PI) * 0.6;
          sc = d.size * (1 - Math.pow(u, 3));
          spin *= 1 + 3 * u;
        } else {
          y = d.y + d.vy * tt - 0.5 * g * tt * tt;
          px = d.x + d.vx * tt;
          pz = d.z + d.vz * tt;
          const ground = groundAt(px, pz);
          if (y < ground + d.size * 0.5 && tt > 0.1) {
            if (d.water) { this.mesh.setMatrixAt(d.slot, m.makeScale(0, 0, 0)); continue; }
            y = ground + d.size * 0.5;
            spin = d.w * Math.max(0.1, (d.vy / g) * 2);
          }
          const life = d.water ? 1.6 : 3.4;
          const fade = Math.max(0, 1 - Math.max(0, tt - life) / 1.2);
          if (fade <= 0) { this.mesh.setMatrixAt(d.slot, m.makeScale(0, 0, 0)); continue; }
          sc = d.size * fade;
        }
        if (d.heat) {
          this._color(d, tt);
          this.mesh.setColorAt(d.slot, this._c);
          recolor = true;
        }
        this._q.setFromAxisAngle(this._a.set(d.ax, d.ay, d.az).normalize(), spin);
        this._p.set(px, y, pz);
        this._s.setScalar(sc);
        m.compose(this._p, this._q, this._s);
        this.mesh.setMatrixAt(d.slot, m);
        keep.push(d);
      }
      this.list = keep;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (recolor) this.mesh.instanceColor.needsUpdate = true;
    }

    clear() {
      const z = this._m.makeScale(0, 0, 0);
      for (const d of this.list) this.mesh.setMatrixAt(d.slot, z);
      this.list = [];
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  const smooth01 = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

  /**
   * Crateras com memória: lê/escreve a altura das colunas pelas funções do terreno e guarda
   * cada explosão para refazer o terreno ao abrir a página (salvo no navegador).
   */
  function craterProfile(top, r, D, floor, cap) {
    if (r < 1) return top - Math.min(D, Math.max(0, top - floor)) * Math.pow(1 - r * r, 0.85);
    // borda levantada, sem passar do teto (várias explosões no mesmo lugar não viram muralha)
    return Math.max(top, Math.min(cap, top + D * 0.22 * Math.sin(((r - 1) / 0.4) * Math.PI)));
  }

  /** levanta o chão num cone (vulcão) com uma cratera pequena no cume; nunca abaixa */
  function raiseProfile(top, r, H, base) {
    if (r >= 1) return top;
    let h = H * Math.pow(1 - r, 1.15);
    if (r < 0.16) h -= H * 0.38 * (1 - r / 0.16);
    return Math.max(top, Math.min(base + H * 1.05, base + h));
  }
  /** opções extras que mudam a forma (e por isso são salvas junto da cratera) */
  function shapeOpts(o) {
    const out = {};
    for (const k of ['R', 'D', 'raise']) if (isFinite(o[k]) && o[k] > 0) out[k] = +(+o[k]).toFixed(3);
    return out;
  }

  B.parts = { Glow, Dome, Ring, Beam, Lightning, LensFlare, BlockCrater, blockMaterial, DebrisField, craterProfile, raiseProfile, shapeOpts };
})();
