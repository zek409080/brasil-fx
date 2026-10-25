/* Mapa 3D do Brasil: estados extrudados (malha do IBGE), fronteiras, siglas impressas,
   oceano com graticulado (linha do Equador e Trópico de Capricórnio), céu estrelado,
   marcador do ponto escolhido e o "palco" de luzes/ondas que os efeitos controlam. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE) return;
  const THREE = window.THREE;
  const NL = 4;

  const lin = (hex, k = 1) => {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r * k, c.g * k, c.b * k);
  };

  // ------------------------------------------------ GLSL compartilhado (luzes, ondas, marcador)
  const SCENE_GLSL = /* glsl */ `
    #define NL ${NL}
    uniform vec3 uLightPos[NL];
    uniform vec3 uLightCol[NL];
    uniform float uLightRange[NL];
    uniform vec4 uWave[NL];
    uniform vec3 uWaveCol[NL];
    uniform float uWaveWidth[NL];
    uniform vec4 uHeat;
    uniform vec3 uHeatCol;
    uniform vec4 uMarker;
    uniform vec3 uMarkerCol;
    uniform float uTime;
    uniform float uDim;
    uniform vec3 uAmbient;
    uniform vec3 uKeyDir;
    uniform vec3 uKeyCol;
    uniform vec3 uFogCol;
    uniform vec2 uFog;
    uniform vec4 uHole;   // x, z, meia largura, ativo: a cratera em blocos substitui o chão aqui

    bool inHole(vec2 xz) {
      return uHole.w > 0.5 && abs(xz.x - uHole.x) < uHole.z && abs(xz.y - uHole.y) < uHole.z;
    }

    void sceneLights(vec3 p, vec3 n, vec3 V, float shine, out vec3 diff, out vec3 spec) {
      diff = vec3(0.0);
      spec = vec3(0.0);
      for (int i = 0; i < NL; i++) {
        vec3 d = uLightPos[i] - p;
        float dist = max(length(d), 1e-3);
        vec3 L = d / dist;
        float q = dist / max(uLightRange[i], 1e-3);
        float att = 1.0 / (1.0 + q * q);
        float lam = max(dot(n, L), 0.0) * 0.8 + 0.2;
        diff += uLightCol[i] * att * lam;
        vec3 H = normalize(L + V + vec3(0.0, 1e-4, 0.0));
        spec += uLightCol[i] * att * pow(max(dot(n, H), 0.0), shine);
      }
    }

    vec3 groundFx(vec2 xz) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < NL; i++) {
        vec4 w = uWave[i];
        if (w.w > 0.0) {
          float r = length(xz - w.xy);
          float x = (r - w.z) / max(uWaveWidth[i], 1e-3);
          float ring = exp(-x * x);
          float wake = smoothstep(0.0, max(w.z, 1e-3), r) * step(r, w.z) * 0.16;
          acc += uWaveCol[i] * w.w * (ring + wake);
        }
      }
      if (uHeat.w > 0.0) {
        vec2 hd = (xz - uHeat.xy) / max(uHeat.z, 1e-3);
        acc += uHeatCol * uHeat.w * exp(-dot(hd, hd) * 2.0);
      }
      return acc;
    }

    vec3 markerFx(vec2 xz) {
      vec2 d = xz - uMarker.xy;
      float r = length(d);
      float aa = fwidth(r) * 1.2 + 0.004;
      if (uMarker.z <= 0.001) return vec3(0.0);
      float cd = uMarker.w;
      float pulse = 0.5 + 0.5 * sin(uTime * (3.0 + cd * 14.0));
      float R = mix(0.62, 0.26, cd);
      float ring = 1.0 - smoothstep(0.012, 0.032 + aa, abs(r - R));
      float ring2 = (1.0 - smoothstep(0.006, 0.018 + aa, abs(r - R * 0.45))) * 0.6;
      float ang = atan(d.y, d.x + 1e-5) + uTime * (0.8 + cd * 3.0);
      float arcs = (1.0 - smoothstep(0.01, 0.025 + aa, abs(r - R * 1.55))) * step(0.55, cos(ang * 3.0));
      float dotc = 1.0 - smoothstep(0.02, 0.05 + aa, r);
      float halo = exp(-r * r * 5.0) * 0.35 * (0.5 + 0.5 * pulse);
      return uMarkerCol * uMarker.z * (ring * (0.7 + 0.6 * pulse) + ring2 + arcs * 0.8 + dotc + halo);
    }
  `;

  const LAND_VERT = /* glsl */ `
    attribute float aState;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vState;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      vState = aState;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  // terreno em blocos: cada instância é uma coluna (caixa de base 0..1 em y)
  const VOXEL_VERT = /* glsl */ `
    attribute float aState;
    attribute vec4 aEdge;
    attribute float aScorch;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vState;
    varying vec4 vEdge;
    varying vec2 vCellUv;
    varying float vScorch;
    void main() {
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      vState = aState;
      vEdge = aEdge;
      vCellUv = position.xz + 0.5;
      vScorch = aScorch;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  const LAND_FRAG = SCENE_GLSL + /* glsl */ `
    uniform float uHover;
    uniform float uSel;
    uniform vec3 uLandA;
    uniform vec3 uLandB;
    uniform vec3 uSide;
    uniform vec3 uRim;
    uniform vec3 uHoverCol;
    uniform sampler2D uLabels;
    uniform vec4 uLabelRect;
    uniform float uH;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vState;
  #ifdef VOXEL
    varying vec4 vEdge;
    varying vec2 vCellUv;
    varying float vScorch;
  #endif

    float hash1(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

    void main() {
      if (inHole(vWorld.xz)) discard;
      vec3 n = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorld);
      float top = step(0.5, n.y);
      vec3 diff;
      vec3 spec;
      sceneLights(vWorld, n, V, 60.0, diff, spec);
      vec3 base = mix(uLandA, uLandB, hash1(vState + 3.0));
      vec3 col;
      vec2 luv = vec2((vWorld.x - uLabelRect.x) / uLabelRect.z, 1.0 - (vWorld.z - uLabelRect.y) / uLabelRect.w);
      float lab = texture2D(uLabels, luv).r;
      vec2 g = fract(vWorld.xz * 2.0) - 0.5;
      float dots = 1.0 - smoothstep(0.035, 0.07, length(g));
      if (top > 0.5) {
        vec3 L = (uAmbient + uKeyCol * max(dot(n, uKeyDir), 0.0)) * uDim + diff;
      #ifdef VOXEL
        col = base * L + spec * 0.02;
        vec2 cu = vCellUv;
        float edgeD = min(min(cu.x, 1.0 - cu.x), min(cu.y, 1.0 - cu.y));
        col *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.09, edgeD));
        // divisas (1) e litoral (2) desenhados na borda de cada bloco
        vec4 ed = vEdge;
        vec4 dist = vec4(cu.x, 1.0 - cu.x, cu.y, 1.0 - cu.y);
        vec4 on = (1.0 - smoothstep(0.05, 0.16, dist)) * step(0.5, ed);
        vec4 coast = step(1.5, ed);
        float bState = max(max(on.x * (1.0 - coast.x), on.y * (1.0 - coast.y)), max(on.z * (1.0 - coast.z), on.w * (1.0 - coast.w)));
        float bCoast = max(max(on.x * coast.x, on.y * coast.y), max(on.z * coast.z, on.w * coast.w));
        col += uRim * (bState * 0.35 + bCoast * 1.3) * (0.4 + 0.6 * uDim);
        col = mix(col, vec3(0.006, 0.005, 0.005) * L, vScorch * 0.85);
      #else
        col = (base * (1.0 + dots * 0.35)) * L + spec * 0.02;
      #endif
        col += uRim * lab * 0.22 * (0.4 + 0.6 * uDim);
      } else {
        float h = clamp(vWorld.y / uH, 0.0, 1.0);
        vec3 L = (uAmbient * 0.8 + uKeyCol * max(dot(n, uKeyDir), 0.0) * 0.6) * uDim + diff;
      #ifdef VOXEL
        col = mix(uSide, base, 0.5) * L * (0.35 + 0.65 * h);
        col = mix(col, vec3(0.004) * L, vScorch * 0.7);
      #else
        col = uSide * L * (0.45 + 0.55 * h);
        col += uRim * (pow(h, 10.0) * 0.9 + (1.0 - h) * 0.05) * uDim;
      #endif
      }
      float hov = 1.0 - step(0.5, abs(vState - uHover));
      float sel = 1.0 - step(0.5, abs(vState - uSel));
      col += uHoverCol * (hov * 0.55 + sel * 0.3) * (0.4 + 0.6 * top);
      col += groundFx(vWorld.xz) * (0.55 + 0.45 * top);
      col += markerFx(vWorld.xz) * top;
      float fd = distance(vWorld, cameraPosition);
      col = mix(col, uFogCol, smoothstep(uFog.x, uFog.y, fd));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const OCEAN_VERT = /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  const OCEAN_FRAG = SCENE_GLSL + /* glsl */ `
    uniform vec3 uOcean;
    uniform vec3 uOceanDeep;
    uniform vec3 uGrid;
    uniform vec3 uGridHi;
    uniform vec3 uHaloCol;
    uniform sampler2D uHalo;
    uniform vec4 uHaloRect;
    uniform vec4 uGeo;   // lon0, lat0, kx * escala, escala
    uniform sampler2D uLandMask;
    uniform vec4 uMaskRect;
    varying vec3 vWorld;

    void main() {
      vec2 xz = vWorld.xz;
      if (inHole(xz)) discard;
      vec2 muv = (xz - uMaskRect.xy) / uMaskRect.zw;
      if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0 && texture2D(uLandMask, muv).r > 0.5) discard;
      float rc = length(xz) / uGeo.w;
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 n = vec3(0.0, 1.0, 0.0);
      vec3 diff;
      vec3 spec;
      sceneLights(vWorld, n, V, 400.0, diff, spec);
      vec2 ll = vec2(xz.x / uGeo.z + uGeo.x, -xz.y / uGeo.w + uGeo.y);
      vec2 fw = fwidth(ll) * 1.25;
      vec2 cell = abs(fract(ll / 5.0 + 0.5) - 0.5) * 5.0;
      float line = max(1.0 - smoothstep(0.0, fw.x, cell.x), 1.0 - smoothstep(0.0, fw.y, cell.y));
      float eq = 1.0 - smoothstep(0.0, fw.y * 1.6, abs(ll.y));
      float trop = (1.0 - smoothstep(0.0, fw.y * 1.6, abs(ll.y + 23.44))) * step(0.45, fract(ll.x * 0.6));
      float gridFade = 1.0 - smoothstep(22.0, 75.0, rc);
      vec3 base = mix(uOcean, uOceanDeep, smoothstep(12.0, 70.0, rc));
      vec3 col = base * ((uAmbient + uKeyCol * 0.3) * uDim + diff * 0.9) + spec * 0.06;
      col += (uGrid * line + uGridHi * (eq + trop)) * gridFade * (0.35 + 0.65 * uDim);
      vec2 huv = vec2((xz.x - uHaloRect.x) / uHaloRect.z, 1.0 - (xz.y - uHaloRect.y) / uHaloRect.w);
      float halo = texture2D(uHalo, huv).r;
      float sweep = fract(uTime / 11.0) * 80.0;
      float scan = exp(-pow((rc - sweep) / 1.6, 2.0)) * (1.0 - smoothstep(20.0, 78.0, sweep)) * 0.5;
      col += uHaloCol * (halo * (0.8 + 0.2 * sin(uTime * 0.8)) + scan * 0.2) * uDim;
      col += groundFx(xz) * 0.8;
      col += markerFx(xz);
      float fd = distance(vWorld, cameraPosition);
      col = mix(col, uFogCol, smoothstep(uFog.x, uFog.y, fd));
      col = mix(col, uFogCol, smoothstep(60.0, 150.0, rc));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const STAR_VERT = /* glsl */ `
    attribute float aSize;
    attribute float aSeed;
    uniform float uTime;
    uniform float uPR;
    varying float vTw;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPR;
      vTw = 0.55 + 0.45 * sin(uTime * (0.4 + aSeed * 1.8) + aSeed * 50.0);
    }
  `;
  const STAR_FRAG = /* glsl */ `
    uniform vec3 uStarCol;
    uniform float uDim;
    varying float vTw;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = 1.0 - smoothstep(0.1, 0.5, d);
      gl_FragColor = vec4(uStarCol * a * vTw * (0.4 + 0.6 * uDim), 0.0);
    }
  `;

  function makeSceneUniforms() {
    const v3s = () => Array.from({ length: NL }, () => new THREE.Vector3());
    return {
      uLightPos: { value: v3s() },
      uLightCol: { value: v3s() },
      uLightRange: { value: new Array(NL).fill(1) },
      uWave: { value: Array.from({ length: NL }, () => new THREE.Vector4()) },
      uWaveCol: { value: v3s() },
      uWaveWidth: { value: new Array(NL).fill(1) },
      uHeat: { value: new THREE.Vector4() },
      uHeatCol: { value: new THREE.Vector3() },
      uMarker: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMarkerCol: { value: lin('#45c7b5', 2.2) },
      uTime: { value: 0 },
      uDim: { value: 1 },
      uAmbient: { value: new THREE.Vector3(0.62, 0.7, 0.86) },
      uKeyDir: { value: new THREE.Vector3(-0.35, 1, 0.3).normalize() },
      uKeyCol: { value: new THREE.Vector3(0.95, 1.0, 1.12) },
      uFogCol: { value: lin('#05090e') },
      uFog: { value: new THREE.Vector2(75, 190) },
      uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
  }

  /** O palco que os efeitos controlam: 4 luzes pontuais, 4 ondas no chão, calor e escurecimento. */
  class Stage {
    constructor(u) {
      this.u = u;
      this.lights = Array.from({ length: NL }, () => ({ pos: new THREE.Vector3(), col: new THREE.Vector3(), range: 5 }));
      this.waves = Array.from({ length: NL }, () => ({ x: 0, z: 0, r: 0, s: 0, w: 0.5, col: new THREE.Vector3() }));
      this.heat = { x: 0, z: 0, r: 1, s: 0, col: new THREE.Vector3() };
      this.dim = 1;
      this.gain = 1;
    }
    light(i, pos, color, intensity, range) {
      const l = this.lights[i];
      l.pos.copy(pos);
      l.col.copy(color).multiplyScalar(Math.max(0, intensity));
      l.range = range;
    }
    wave(i, x, z, r, s, w, color) {
      const q = this.waves[i];
      q.x = x; q.z = z; q.r = r; q.s = Math.max(0, s); q.w = w;
      q.col.copy(color);
    }
    setHeat(x, z, r, s, color) {
      const h = this.heat;
      h.x = x; h.z = z; h.r = r; h.s = Math.max(0, s);
      h.col.copy(color);
    }
    reset() {
      for (const l of this.lights) l.col.set(0, 0, 0);
      for (const w of this.waves) w.s = 0;
      this.heat.s = 0;
      this.dim = 1;
    }
    apply() {
      const u = this.u;
      for (let i = 0; i < NL; i++) {
        const l = this.lights[i];
        u.uLightPos.value[i].copy(l.pos);
        u.uLightCol.value[i].copy(l.col).multiplyScalar(this.gain);
        u.uLightRange.value[i] = l.range;
        const w = this.waves[i];
        u.uWave.value[i].set(w.x, w.z, w.r, w.s);
        u.uWaveCol.value[i].copy(w.col);
        u.uWaveWidth.value[i] = w.w;
      }
      const h = this.heat;
      u.uHeat.value.set(h.x, h.z, h.r, h.s);
      u.uHeatCol.value.copy(h.col);
      u.uDim.value = this.dim;
    }
  }

  function pip(ring, x, z) {
    let c = false;
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2];
      const zi = ring[i * 2 + 1];
      const xj = ring[j * 2];
      const zj = ring[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  class BrazilMap {
    constructor(geo, sceneU, opts = {}) {
      this.geo = geo;
      this.u = sceneU;
      this.S = opts.scale || 2;   // unidades por grau
      this.H = 1.3;               // altura base da terra (blocos)
      this.FLOOR = 10;            // as colunas descem até aqui: crateras podem passar do nível do mar
      this.DEEP = -9;             // fundo máximo de uma cratera
      this.lon0 = geo.center[0];
      this.lat0 = geo.center[1];
      this.kx = Math.cos((this.lat0 * Math.PI) / 180);
      this.group = new THREE.Group();
      this.labelRes = opts.labelRes || 2048;
      this._prepare();
      this.labelTex = this._labelTexture();
      this._buildVoxels(opts.cell || 0.34, opts.debris || 1600);
      this._buildOcean();
      this.u.uFog.value.set(75 * this.S, 190 * this.S);
      this._buildStars(opts.starCount || 1400);
      this.beam = new B.parts.Beam({ order: 6 });
      this.group.add(this.beam.mesh);
    }

    px(lon) { return (lon - this.lon0) * this.kx * this.S; }
    pz(lat) { return -(lat - this.lat0) * this.S; }
    lonOf(x) { return x / (this.kx * this.S) + this.lon0; }
    latOf(z) { return -z / this.S + this.lat0; }

    _prepare() {
      const g = this.geo;
      this.minX = this.px(g.bbox[0]);
      this.maxX = this.px(g.bbox[2]);
      this.minZ = this.pz(g.bbox[3]);
      this.maxZ = this.pz(g.bbox[1]);
      this.states = g.states.map((s) => {
        const rings = [];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const poly of s.polys) {
          const outer = poly[0];
          const ring = new Float32Array(outer.length);
          for (let k = 0; k < outer.length; k += 2) {
            const x = this.px(outer[k]);
            const z = this.pz(outer[k + 1]);
            ring[k] = x;
            ring[k + 1] = z;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
          }
          rings.push(ring);
        }
        return {
          uf: s.uf, nome: s.nome, regiao: s.regiao, area: s.area, rings, minX, maxX, minZ, maxZ,
          lx: this.px(s.label[0]), lz: this.pz(s.label[1]), labelR: s.labelR * this.S,
        };
      });
    }

    _buildLand() {
      const parts = [];
      let total = 0;
      this.geo.states.forEach((s, i) => {
        for (const poly of s.polys) {
          const toVec = (ring) => {
            const pts = [];
            for (let k = 0; k < ring.length; k += 2) pts.push(new THREE.Vector2(this.px(ring[k]), ring[k + 1] - this.lat0));
            return pts;
          };
          const shape = new THREE.Shape(toVec(poly[0]));
          for (let h = 1; h < poly.length; h++) shape.holes.push(new THREE.Path(toVec(poly[h])));
          let g = new THREE.ExtrudeGeometry(shape, { depth: this.H, bevelEnabled: false, steps: 1, curveSegments: 1 });
          if (g.index) g = g.toNonIndexed();
          g.rotateX(-Math.PI / 2);
          parts.push({ g, i });
          total += g.attributes.position.count;
        }
      });
      const pos = new Float32Array(total * 3);
      const nor = new Float32Array(total * 3);
      const st = new Float32Array(total);
      let off = 0;
      for (const { g, i } of parts) {
        const c = g.attributes.position.count;
        pos.set(g.attributes.position.array, off * 3);
        nor.set(g.attributes.normal.array, off * 3);
        st.fill(i, off, off + c);
        off += c;
        g.dispose();
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geom.setAttribute('aState', new THREE.BufferAttribute(st, 1));
      geom.computeBoundingSphere();

      this.labelTex = this._labelTexture();
      this.landU = Object.assign({}, this.u, {
        uHover: { value: -1 },
        uSel: { value: -1 },
        uLandA: { value: lin('#1a2931') },
        uLandB: { value: lin('#22363f') },
        uSide: { value: lin('#0f2027') },
        uRim: { value: lin('#45c7b5', 1.0) },
        uHoverCol: { value: lin('#45c7b5', 0.16) },
        uLabels: { value: this.labelTex },
        uLabelRect: { value: this.labelRect },
        uH: { value: this.H },
      });
      this.land = new THREE.Mesh(geom, new THREE.ShaderMaterial({
        uniforms: this.landU,
        vertexShader: LAND_VERT,
        fragmentShader: LAND_FRAG,
      }));
      this.land.renderOrder = 0;
      this.group.add(this.land);
    }

    _labelTexture() {
      const N = this.labelRes;
      const pad = 1;
      const minX = this.minX - pad;
      const minZ = this.minZ - pad;
      const size = Math.max(this.maxX - this.minX, this.maxZ - this.minZ) + pad * 2;
      this.labelRect = new THREE.Vector4(minX, minZ, size, size);
      const c = document.createElement('canvas');
      c.width = c.height = N;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, N, N);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const toPx = (w) => (w / size) * N;
      for (const s of this.states) {
        const fsW = Math.min(1.15 * this.S, Math.max(0.26 * this.S, s.labelR * 0.62));
        const x = toPx(s.lx - minX);
        const y = toPx(s.lz - minZ);
        ctx.font = `700 ${Math.round(toPx(fsW))}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(toPx(fsW) * 0.08)}px`;
        ctx.globalAlpha = 1;
        ctx.fillText(s.uf, x, y);
        if (s.labelR > 1.3 * this.S) {
          const small = Math.max(0.2, fsW * 0.3);
          ctx.font = `500 ${Math.round(toPx(small))}px "JetBrains Mono", ui-monospace, monospace`;
          if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(toPx(small) * 0.18)}px`;
          ctx.globalAlpha = 0.55;
          ctx.fillText(s.nome.toUpperCase(), x, y + toPx(fsW * 0.72));
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      return t;
    }

    _haloTexture() {
      const N = 512;
      const pad = 12 * this.S;
      const minX = this.minX - pad;
      const minZ = this.minZ - pad;
      const size = Math.max(this.maxX - this.minX, this.maxZ - this.minZ) + pad * 2;
      this.haloRect = new THREE.Vector4(minX, minZ, size, size);
      const mask = document.createElement('canvas');
      mask.width = mask.height = N;
      const m = mask.getContext('2d');
      m.fillStyle = '#fff';
      for (const s of this.states) {
        for (const ring of s.rings) {
          m.beginPath();
          for (let k = 0; k < ring.length; k += 2) {
            const x = ((ring[k] - minX) / size) * N;
            const y = ((ring[k + 1] - minZ) / size) * N;
            if (k === 0) m.moveTo(x, y);
            else m.lineTo(x, y);
          }
          m.closePath();
          m.fill();
        }
      }
      const shrink = (w) => {
        const c = document.createElement('canvas');
        c.width = c.height = w;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.drawImage(mask, 0, 0, w, w);
        return c;
      };
      const mid = shrink(96);
      const tiny = shrink(28);
      const out = document.createElement('canvas');
      out.width = out.height = N;
      const o = out.getContext('2d');
      o.imageSmoothingEnabled = true;
      o.imageSmoothingQuality = 'high';
      o.fillStyle = '#000';
      o.fillRect(0, 0, N, N);
      o.globalCompositeOperation = 'lighter';
      o.globalAlpha = 0.55;
      o.drawImage(mid, 0, 0, N, N);
      o.globalAlpha = 0.5;
      o.drawImage(tiny, 0, 0, N, N);
      const t = new THREE.CanvasTexture(out);
      t.colorSpace = THREE.NoColorSpace;
      return t;
    }

    _buildBorders() {
      const count = new Map();
      const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
      for (const s of this.geo.states) {
        for (const poly of s.polys) {
          for (const ring of poly) {
            const n = ring.length / 2;
            for (let i = 0; i < n; i++) {
              const j = (i + 1) % n;
              const a = ring[i * 2] + ',' + ring[i * 2 + 1];
              const b = ring[j * 2] + ',' + ring[j * 2 + 1];
              const k = key(a, b);
              count.set(k, (count.get(k) || 0) + 1);
            }
          }
        }
      }
      const inner = [];
      const coast = [];
      const y = this.H + 0.004;
      for (const [k, c] of count) {
        const [a, b] = k.split('|');
        const [alon, alat] = a.split(',').map(Number);
        const [blon, blat] = b.split(',').map(Number);
        const arr = c > 1 ? inner : coast;
        arr.push(this.px(alon), y, this.pz(alat), this.px(blon), y, this.pz(blat));
      }
      const mk = (arr, color, opacity) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
        const l = new THREE.LineSegments(g, m);
        l.renderOrder = 1;
        this.group.add(l);
        return l;
      };
      const tealDim = new THREE.Color('#45c7b5').multiplyScalar(0.55);
      const tealHot = new THREE.Color('#5fe0cf').multiplyScalar(1.6);
      this.innerLines = mk(inner, tealDim, 0.55);
      this.coastLines = mk(coast, tealHot, 0.95);
    }

    _buildOcean() {
      this.haloTex = this._haloTexture();
      this.oceanU = Object.assign({}, this.u, {
        uOcean: { value: lin('#0a1824') },
        uOceanDeep: { value: lin('#04080d') },
        uGrid: { value: lin('#2c6f78', 0.05) },
        uGridHi: { value: lin('#ffae42', 0.07) },
        uHaloCol: { value: lin('#27a597', 0.55) },
        uHalo: { value: this.haloTex },
        uHaloRect: { value: this.haloRect },
        uGeo: { value: new THREE.Vector4(this.lon0, this.lat0, this.kx * this.S, this.S) },
        uLandMask: { value: this.landMask },
        uMaskRect: { value: this.maskRect },
      });
      const g = new THREE.PlaneGeometry(420 * this.S, 420 * this.S, 1, 1);
      g.rotateX(-Math.PI / 2);
      this.ocean = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: this.oceanU,
        vertexShader: OCEAN_VERT,
        fragmentShader: OCEAN_FRAG,
      }));
      this.ocean.position.y = -0.001;
      this.group.add(this.ocean);
    }

    _buildStars(n) {
      const pos = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const seed = new Float32Array(n);
      const r = B.util.rng(20260927);
      for (let i = 0; i < n; i++) {
        const el = Math.asin(0.05 + 0.95 * r());
        const th = r() * Math.PI * 2;
        const R = 330 * this.S;
        pos[i * 3] = Math.cos(el) * Math.cos(th) * R;
        pos[i * 3 + 1] = Math.sin(el) * R;
        pos[i * 3 + 2] = Math.cos(el) * Math.sin(th) * R;
        size[i] = 0.8 + Math.pow(r(), 5) * 2.6;
        seed[i] = r();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      this.starU = {
        uTime: this.u.uTime,
        uDim: this.u.uDim,
        uPR: { value: 1 },
        uStarCol: { value: new THREE.Vector3(0.75, 0.85, 1.0) },
      };
      this.stars = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: this.starU,
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }));
      this.stars.frustumCulled = false;
      this.group.add(this.stars);
    }

    _buildVoxels(c, debrisMax) {
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3();
      this._s = new THREE.Vector3();
      this._col = new THREE.Color();
      const pad = c * 2;
      const x0 = this.minX - pad;
      const z0 = this.minZ - pad;
      const nx = Math.ceil((this.maxX - this.minX + pad * 2) / c);
      const nz = Math.ceil((this.maxZ - this.minZ + pad * 2) / c);
      const grid = new Int16Array(nx * nz).fill(-1);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) grid[j * nx + i] = this.pick(x0 + (i + 0.5) * c, z0 + (j + 0.5) * c);
      }
      const cells = [];
      const index = new Int32Array(nx * nz).fill(-1);
      const fbm = B.noiseUtil.fbm;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const s = grid[j * nx + i];
          if (s < 0) continue;
          const x = x0 + (i + 0.5) * c;
          const z = z0 + (j + 0.5) * c;
          const n = fbm(x * 0.045 + 50, z * 0.045 + 50, 4096, 7, 4);
          const relief = Math.round(Math.max(0, n - 0.42) * 4) * 0.12;
          index[j * nx + i] = cells.length;
          cells.push({ i, j, x, z, s, base: this.H + relief });
        }
      }
      const N = cells.length;
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      const aState = new Float32Array(N);
      const aEdge = new Float32Array(N * 4);
      const aScorch = new Float32Array(N);
      const flag = (i, j, s) => {
        if (i < 0 || j < 0 || i >= nx || j >= nz) return 2;
        const o = grid[j * nx + i];
        return o < 0 ? 2 : o !== s ? 1 : 0;
      };
      cells.forEach((q, k) => {
        aState[k] = q.s;
        aEdge[k * 4] = flag(q.i - 1, q.j, q.s);
        aEdge[k * 4 + 1] = flag(q.i + 1, q.j, q.s);
        aEdge[k * 4 + 2] = flag(q.i, q.j - 1, q.s);
        aEdge[k * 4 + 3] = flag(q.i, q.j + 1, q.s);
      });
      box.setAttribute('aState', new THREE.InstancedBufferAttribute(aState, 1));
      box.setAttribute('aEdge', new THREE.InstancedBufferAttribute(aEdge, 4));
      const scorchAttr = new THREE.InstancedBufferAttribute(aScorch, 1);
      scorchAttr.setUsage(THREE.DynamicDrawUsage);
      box.setAttribute('aScorch', scorchAttr);
      this.landU = Object.assign({}, this.u, {
        uHover: { value: -1 },
        uSel: { value: -1 },
        uLandA: { value: lin('#1a2931') },
        uLandB: { value: lin('#22363f') },
        uSide: { value: lin('#0f2027') },
        uRim: { value: lin('#45c7b5', 1.0) },
        uHoverCol: { value: lin('#45c7b5', 0.16) },
        uLabels: { value: this.labelTex },
        uLabelRect: { value: this.labelRect },
        uH: { value: this.H + 0.5 },
      });
      const mat = new THREE.ShaderMaterial({ uniforms: this.landU, vertexShader: VOXEL_VERT, fragmentShader: LAND_FRAG, defines: { VOXEL: '' } });
      this.land = new THREE.InstancedMesh(box, mat, N);
      this.land.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.land.frustumCulled = false;
      this.vox = { c, x0, z0, nx, nz, grid, index, cells, top: new Float32Array(N), scorch: aScorch, scorchAttr, blasts: [] };
      for (let k = 0; k < N; k++) this.vox.top[k] = cells[k].base;
      this._writeColumns(null);
      this.group.add(this.land);

      const md = new Uint8Array(nx * nz * 4);
      for (let k = 0; k < nx * nz; k++) if (index[k] >= 0) md[k * 4] = 255;
      this.landMask = new THREE.DataTexture(md, nx, nz, THREE.RGBAFormat);
      this.landMask.magFilter = THREE.NearestFilter;
      this.landMask.minFilter = THREE.NearestFilter;
      this.landMask.needsUpdate = true;
      this.maskRect = new THREE.Vector4(x0, z0, nx * c, nz * c);

      // blocos voadores (reaproveitados em anel)
      this.debris = new B.parts.DebrisField(this.u, debrisMax);
      this.debrisMesh = this.debris.mesh;
      this.group.add(this.debrisMesh);
      this.history = [];
      this.innerLines = null;
      this.coastLines = null;
    }

    _writeColumns(list) {
      const v = this.vox;
      const m = this._m;
      const ids = list || v.cells.keys();
      for (const k of ids) {
        const q = v.cells[k];
        const h = Math.max(0.03, v.top[k] + this.FLOOR);
        m.makeScale(v.c, h, v.c);
        m.setPosition(q.x, -this.FLOOR, q.z);
        this.land.setMatrixAt(k, m);
      }
      this.land.instanceMatrix.needsUpdate = true;
    }

    /** altura do chão (topo dos blocos) em (x, z); 0 no mar */
    groundAt(x, z) {
      const v = this.vox;
      const i = Math.floor((x - v.x0) / v.c);
      const j = Math.floor((z - v.z0) / v.c);
      if (i < 0 || j < 0 || i >= v.nx || j >= v.nz) return 0;
      const k = v.index[j * v.nx + i];
      return k < 0 ? 0 : v.top[k];
    }

    /** Abre uma cratera em (x, z). k = intensidade artística; t0 = tempo da tomada na detonação.
        opts.pull = ponto que suga os blocos (buraco negro); opts.instant = aplica já, sem destroços
        (usado ao refazer crateras salvas). Profundidade e raio são só visuais.
        Devolve a profundidade no centro, em blocos abaixo do chão original. */
    blast(x, z, k, t0, rng, opts = {}) {
      if (k <= 0.02) return 0;
      const v = this.vox;
      const R = opts.R || (1.1 + 2.1 * k) * (this.S / 2) * 1.25;
      const D = opts.D || 0.4 + 0.9 * k;
      const rr = Math.ceil((R * 1.4) / v.c);
      const ci = Math.floor((x - v.x0) / v.c);
      const cj = Math.floor((z - v.z0) / v.c);
      const aff = [];
      const batch = [];
      const pull = opts.pull || null;
      const spread = opts.spread || 2.5;
      const lA = this.landU.uLandA.value;
      const lB = this.landU.uLandB.value;
      let depth = 0;
      for (let j = cj - rr; j <= cj + rr; j++) {
        for (let i = ci - rr; i <= ci + rr; i++) {
          if (i < 0 || j < 0 || i >= v.nx || j >= v.nz) continue;
          const id = v.index[j * v.nx + i];
          if (id < 0) continue;
          const q = v.cells[id];
          const r = Math.hypot(q.x - x, q.z - z) / R;
          if (r > 1.4) continue;
          if (opts.raise && r >= 1) continue;
          const target = opts.raise
            ? B.parts.raiseProfile(v.top[id], r, opts.raise, q.base)
            : B.parts.craterProfile(v.top[id], r, D, this.DEEP, q.base + 2.4);
          if (r < 0.25) depth = Math.max(depth, (q.base - target) / v.c);
          const sc = opts.raise ? (r < 1 ? 0.5 + 0.4 * (1 - r) : 0) : r < 1.1 ? Math.min(1, (1.1 - r) * 1.3) : 0;
          aff.push({ id, r, from: v.top[id], to: target, scorch: Math.max(v.scorch[id], sc) });
          if (opts.instant || opts.raise) continue;
          // blocos arrancados voam (ou são sugados)
          const removed = v.top[id] - target;
          const n = Math.min(4, Math.floor(removed / (v.c * 0.9)));
          const kk = ((Math.sin((q.s + 3) * 91.3458) * 47453.5453) % 1 + 1) % 1;
          for (let b = 0; b < n; b++) {
            const a = Math.atan2(q.z - z, q.x - x) + (rng() - 0.5) * 0.9;
            const out = (1.5 + rng() * 5.5) * (0.6 + 0.6 * Math.min(k, 3)) * (1.15 - r) * (opts.lift || 1);
            const d = {
              x: q.x, y: v.top[id] - b * v.c, z: q.z,
              vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: (3 + rng() * 7) * (0.6 + 0.5 * Math.min(k, 4)) * (1.2 - r) * (opts.lift || 1),
              ax: rng() - 0.5, ay: rng() - 0.5, az: rng() - 0.5, w: 3 + rng() * 10,
              size: v.c * (0.8 + rng() * 0.2), t0: t0 + r * 0.06,
              cr: (lA.x + (lB.x - lA.x) * kk) * 1.6, cg: (lA.y + (lB.y - lA.y) * kk) * 1.6, cb: (lA.z + (lB.z - lA.z) * kk) * 1.6,
              heat: !opts.cold && r < 0.55 && rng() < 0.6 ? 1 - r : 0,
            };
            if (pull) { d.pull = pull; d.dur = 1.1 + rng() * 1.4; d.t0 = t0 + (1 - r) * 0.3 + rng() * spread; d.heat = 0; }
            batch.push(d);
          }
        }
      }
      if (opts.instant) {
        const ids = [];
        for (const a of aff) { v.top[a.id] = a.to; v.scorch[a.id] = Math.max(v.scorch[a.id], a.scorch); ids.push(a.id); }
        this._writeColumns(ids);
        v.scorchAttr.needsUpdate = true;
      } else {
        this.debris.add(batch, rng);
        v.blasts.push({ t0, aff, dur: opts.dur || (pull ? spread + 1 : 0.45) });
      }
      this.history.push(Object.assign({ x: +x.toFixed(3), z: +z.toFixed(3), k: +k.toFixed(3) }, B.parts.shapeOpts(opts)));
      return depth;
    }

    /** anima crateras e blocos voadores no tempo t da tomada */
    updateBlocks(t) {
      const v = this.vox;
      let changed = null;
      for (const bl of v.blasts) {
        const tt = t - bl.t0;
        if (bl.done || tt < 0) continue;
        const e = Math.min(1, tt / bl.dur);
        const dig = 1 - Math.pow(1 - e, 3);
        changed = changed || [];
        for (const a of bl.aff) {
          v.top[a.id] = a.from + (a.to - a.from) * dig;
          v.scorch[a.id] = Math.max(v.scorch[a.id], a.scorch * dig);
          changed.push(a.id);
        }
        if (e >= 1) bl.done = true;
      }
      if (changed) {
        this._writeColumns(changed);
        v.scorchAttr.needsUpdate = true;
      }
      this.debris.update(t, (px, pz) => this.groundAt(px, pz));
    }

    /** refaz crateras salvas (sem animação) */
    restore(list) {
      const r = () => 0.5;
      for (const h of list || []) {
        if (h && isFinite(h.x) && isFinite(h.z) && isFinite(h.k)) this.blast(h.x, h.z, h.k, 0, r, Object.assign(B.parts.shapeOpts(h), { instant: true }));
      }
    }

    /** esconde blocos voadores (mudança de tomada) */
    clearDebris() {
      this.debris.clear();
      const v = this.vox;
      for (const bl of v.blasts) {
        if (bl.done) continue;
        // termina a cratera na forma final
        for (const a of bl.aff) { v.top[a.id] = a.to; v.scorch[a.id] = Math.max(v.scorch[a.id], a.scorch); }
        this._writeColumns(bl.aff.map((a) => a.id));
        v.scorchAttr.needsUpdate = true;
        bl.done = true;
      }
    }

    /** volta o terreno ao original */
    resetBlocks() {
      const v = this.vox;
      this.clearDebris();
      v.blasts = [];
      this.history = [];
      for (let k = 0; k < v.cells.length; k++) v.top[k] = v.cells[k].base;
      v.scorch.fill(0);
      v.scorchAttr.needsUpdate = true;
      this._writeColumns(null);
    }

    /** índice do estado sob o ponto (x, z) do mapa, ou -1 */
    pick(x, z) {
      for (let i = 0; i < this.states.length; i++) {
        const s = this.states[i];
        if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
        for (const ring of s.rings) if (pip(ring, x, z)) return i;
      }
      return -1;
    }

    randomPoint(r) {
      for (let k = 0; k < 400; k++) {
        const x = this.minX + (this.maxX - this.minX) * r();
        const z = this.minZ + (this.maxZ - this.minZ) * r();
        const i = this.pick(x, z);
        if (i < 0) continue;
        // evita a beirada: exige terra também um pouco ao redor
        let ok = true;
        for (let a = 0; a < 6 && ok; a++) {
          const ang = (a / 6) * Math.PI * 2;
          if (this.pick(x + Math.cos(ang) * 0.8, z + Math.sin(ang) * 0.8) < 0) ok = false;
        }
        if (ok) return { x, z, state: i };
      }
      return { x: 0, z: 0, state: this.pick(0, 0) };
    }

    /** escurece também as linhas de fronteira (usado pelo "Apagão" e pela Supernova) */
    setDim(d) {
      this._dim = d;
    }

    /** mostra/esconde o mapa (as estrelas continuam para o modo globo) */
    setMapVisible(v) {
      for (const o of [this.land, this.ocean, this.debrisMesh]) o.visible = v;
      if (!v) this.beam.hide();
    }

    /** cor de superfície (linear) no ponto, para os blocos da cratera */
    surfaceColor(x, z, out) {
      const s = this.pick(x, z);
      if (s < 0) return out.copy(this.oceanU.uOcean.value).multiplyScalar(1.6), false;
      const k = ((Math.sin((s + 3) * 91.3458) * 47453.5453) % 1 + 1) % 1;
      return out.copy(this.landU.uLandA.value).lerp(this.landU.uLandB.value, k), true;
    }

    setHover(i) { this.landU.uHover.value = i; }
    setSelected(i) { this.landU.uSel.value = i; }
  }

  B.SCENE_GLSL = SCENE_GLSL;
  B.makeSceneUniforms = makeSceneUniforms;
  B.Stage = Stage;
  B.BrazilMap = BrazilMap;
})();
