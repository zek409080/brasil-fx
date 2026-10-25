/* Planeta em blocos: a Terra inteira feita de colunas sobre uma "esfera-cubo" (6 faces × N × N células).
   Países do Natural Earth 1:110m, o Brasil com os estados do IBGE. Qualquer ponto (terra ou mar) pode
   receber uma explosão: o planeta gira até o ponto ficar no topo (+y) e os efeitos rodam ali como no mapa.
   Crateras e blocos voadores são só visuais, sem relação com energia ou danos reais. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE) return;
  const THREE = window.THREE;

  const lin = (hex, k = 1) => {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r * k, c.g * k, c.b * k);
  };

  // eixos das 6 faces: normal, u, v
  const FACES = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ].map((f) => f.map((a) => new THREE.Vector3(a[0], a[1], a[2])));

  const Q4 = Math.PI / 4;

  const LAND_VERT = /* glsl */ `
    attribute float aState;
    attribute vec4 aEdge;
    attribute float aScorch;
    attribute vec3 aCol;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying vec3 vUp;
    varying vec3 vCol;
    varying float vState;
    varying vec4 vEdge;
    varying vec2 vCellUv;
    varying float vScorch;
    varying float vH;
    void main() {
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      mat3 im = mat3(modelMatrix) * mat3(instanceMatrix);
      vNormal = normalize(im * normal);
      vUp = normalize(im * vec3(0.0, 1.0, 0.0));
      vCol = aCol;
      vState = aState;
      vEdge = aEdge;
      vCellUv = position.xz + 0.5;
      vScorch = aScorch;
      vH = position.y;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  // luz do "sol" + terminador dia/noite; ondas e marcador só valem perto do topo (onde fica o ponto)
  const PLANET_GLSL = /* glsl */ `
    uniform float uR;
    float topGate(vec3 p) { return smoothstep(uR * 0.72, uR * 0.9, p.y); }
    vec3 planetLight(vec3 n, vec3 up) {
      float day = smoothstep(-0.35, 0.45, dot(up, uKeyDir));
      return (uAmbient * (0.18 + 0.82 * day) + uKeyCol * max(dot(n, uKeyDir), 0.0) * day) * uDim;
    }
  `;

  const LAND_FRAG = () => B.SCENE_GLSL + PLANET_GLSL + /* glsl */ `
    uniform float uHover;
    uniform float uSel;
    uniform vec3 uRim;
    uniform vec3 uCoast;
    uniform vec3 uHoverCol;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying vec3 vUp;
    varying vec3 vCol;
    varying float vState;
    varying vec4 vEdge;
    varying vec2 vCellUv;
    varying float vScorch;
    varying float vH;

    void main() {
      vec3 n = normalize(vNormal);
      vec3 up = normalize(vUp);
      vec3 V = normalize(cameraPosition - vWorld);
      float top = step(0.5, dot(n, up));
      vec3 diff;
      vec3 spec;
      sceneLights(vWorld, n, V, 60.0, diff, spec);
      vec3 L = planetLight(n, up) + diff;
      float gate = topGate(vWorld);
      vec3 col;
      if (top > 0.5) {
        col = vCol * L + spec * 0.02;
        vec2 cu = vCellUv;
        float edgeD = min(min(cu.x, 1.0 - cu.x), min(cu.y, 1.0 - cu.y));
        col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.1, edgeD));
        vec4 dist = vec4(cu.x, 1.0 - cu.x, cu.y, 1.0 - cu.y);
        vec4 on = (1.0 - smoothstep(0.05, 0.16, dist)) * step(0.5, vEdge);
        vec4 coast = step(1.5, vEdge);
        float bState = max(max(on.x * (1.0 - coast.x), on.y * (1.0 - coast.y)), max(on.z * (1.0 - coast.z), on.w * (1.0 - coast.w)));
        float bCoast = max(max(on.x * coast.x, on.y * coast.y), max(on.z * coast.z, on.w * coast.w));
        float lit = 0.35 + 0.65 * smoothstep(-0.3, 0.4, dot(up, uKeyDir));
        col += (uRim * bState * 0.3 + uCoast * bCoast * 0.9) * (0.4 + 0.6 * uDim) * lit;
        col = mix(col, vec3(0.006, 0.005, 0.005) * L, vScorch * 0.85);
      } else {
        col = vCol * 0.6 * L * (0.3 + 0.7 * clamp(vH, 0.0, 1.0));
        col = mix(col, vec3(0.004) * L, vScorch * 0.7);
      }
      float hov = 1.0 - step(0.5, abs(vState - uHover));
      float sel = 1.0 - step(0.5, abs(vState - uSel));
      col += uHoverCol * (hov * 0.5 + sel * 0.28) * (0.4 + 0.6 * top);
      col += groundFx(vWorld.xz) * (0.55 + 0.45 * top) * gate;
      col += markerFx(vWorld.xz) * top * gate;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const OCEAN_VERT = /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vLocal;
    varying vec3 vNormal;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vLocal = position;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  // mar também "em blocos": a grade da esfera-cubo desenhada na água, com leve variação por célula
  const OCEAN_FRAG = () => B.SCENE_GLSL + PLANET_GLSL + /* glsl */ `
    uniform vec3 uOcean;
    uniform vec3 uOceanHi;
    uniform vec3 uGrid;
    uniform float uN;
    uniform sampler2D uLandMask;
    varying vec3 vWorld;
    varying vec3 vLocal;
    varying vec3 vNormal;

    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec3 n = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 d = normalize(vLocal);
      vec3 a = abs(d);
      vec3 fn; vec3 fu; vec3 fv;
      float face;
      if (a.x >= a.y && a.x >= a.z) {
        if (d.x > 0.0) { face = 0.0; fn = vec3(1.0, 0.0, 0.0); fu = vec3(0.0, 0.0, -1.0); fv = vec3(0.0, 1.0, 0.0); }
        else { face = 1.0; fn = vec3(-1.0, 0.0, 0.0); fu = vec3(0.0, 0.0, 1.0); fv = vec3(0.0, 1.0, 0.0); }
      } else if (a.y >= a.z) {
        if (d.y > 0.0) { face = 2.0; fn = vec3(0.0, 1.0, 0.0); fu = vec3(1.0, 0.0, 0.0); fv = vec3(0.0, 0.0, -1.0); }
        else { face = 3.0; fn = vec3(0.0, -1.0, 0.0); fu = vec3(1.0, 0.0, 0.0); fv = vec3(0.0, 0.0, 1.0); }
      } else {
        if (d.z > 0.0) { face = 4.0; fn = vec3(0.0, 0.0, 1.0); fu = vec3(1.0, 0.0, 0.0); fv = vec3(0.0, 1.0, 0.0); }
        else { face = 5.0; fn = vec3(0.0, 0.0, -1.0); fu = vec3(-1.0, 0.0, 0.0); fv = vec3(0.0, 1.0, 0.0); }
      }
      float kf = 1.0 / dot(d, fn);
      vec2 g = atan(vec2(dot(d, fu), dot(d, fv)) * kf) * (4.0 / 3.14159265);
      vec2 c = (g * 0.5 + 0.5) * uN;
      vec2 ci = clamp(floor(c), 0.0, uN - 1.0);
      if (texture2D(uLandMask, vec2((ci.x + 0.5) / uN, (face * uN + ci.y + 0.5) / (6.0 * uN))).r > 0.5) discard;
      vec2 f = abs(fract(c) - 0.5);
      vec2 fw = fwidth(c);
      float line = max(smoothstep(0.5 - fw.x * 1.3, 0.5, f.x), smoothstep(0.5 - fw.y * 1.3, 0.5, f.y));
      line *= 1.0 - smoothstep(0.12, 0.35, max(fw.x, fw.y));
      float cell = hash2(floor(c) + face * 17.0);
      vec3 diff;
      vec3 spec;
      sceneLights(vWorld, n, V, 300.0, diff, spec);
      vec3 L = planetLight(n, n);
      vec3 base = mix(uOcean, uOceanHi, cell * 0.5);
      vec3 col = base * (L + diff * 0.9) + spec * 0.05;
      float day = smoothstep(-0.2, 0.5, dot(n, uKeyDir));
      vec3 H = normalize(uKeyDir + V);
      col += uKeyCol * pow(max(dot(n, H), 0.0), 90.0) * 0.12 * day * uDim;
      col = mix(col, col * 0.62, line);
      col += uGrid * line * 0.5 * day;
      float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      col += vec3(0.05, 0.25, 0.35) * fres * (0.3 + 0.7 * day) * uDim;
      float gate = topGate(vWorld);
      col += groundFx(vWorld.xz) * 0.8 * gate;
      col += markerFx(vWorld.xz) * gate;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const ATM_VERT = /* glsl */ `
    varying vec3 vN;
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const ATM_FRAG = /* glsl */ `
    uniform vec3 uKeyDir;
    uniform float uDim;
    varying vec3 vN;
    varying vec3 vWorld;
    void main() {
      vec3 n = normalize(vN);
      vec3 V = normalize(cameraPosition - vWorld);
      float f = pow(1.0 - abs(dot(n, V)), 2.6);
      float day = 0.3 + 0.7 * smoothstep(-0.4, 0.4, dot(-n, uKeyDir));
      gl_FragColor = vec4(vec3(0.12, 0.55, 0.8) * f * 1.1 * day * (0.3 + 0.7 * uDim), 0.0);
    }
  `;

  // ruído de valor 3D simples para o relevo
  function hash3(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function vnoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    let r = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      r += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return r;
  }
  function fbm3(x, y, z) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let o = 0; o < 4; o++) {
      s += a * vnoise3(x * f, y * f, z * f);
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }

  function oceanName(lat, lon) {
    if (lat > 66) return 'Oceano Ártico';
    if (lat < -58) return 'Oceano Antártico';
    if (lon > 20 && lon < 147 && lat < 30 && !(lon > 100 && lat > 0)) return 'Oceano Índico';
    if (lon >= -70 && lon <= 20) return 'Oceano Atlântico';
    if (lon > -100 && lon < -70 && lat > 8) return 'Oceano Atlântico';
    return 'Oceano Pacífico';
  }

  class VoxelPlanet {
    constructor(world, brasil, sceneU, opts = {}) {
      this.u = sceneU;
      this.R = opts.R || 70;
      this.N = opts.n || 192;
      this.FLOOR = 14;   // as colunas descem até R - 14: dá para cavar abaixo do mar
      this.DEEP = -12;   // fundo máximo de uma cratera (relativo ao nível do mar)
      this.history = [];
      this.root = new THREE.Group();     // não gira: atmosfera e blocos voadores
      this.group = new THREE.Group();    // gira: terra e mar
      this.root.add(this.group);
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._qi = new THREE.Quaternion();
      this._p = new THREE.Vector3();
      this._s = new THREE.Vector3();
      this._d = new THREE.Vector3();
      this._col = new THREE.Color();
      this.turn = null;
      this.settled = 1;
      this._names(world, brasil);
      this._mask(world, brasil, opts.maskW || 4096);
      this._buildLand();
      this._buildOcean();
      this._buildAtmosphere();
      this._buildDebris(opts.debris || 1600);
      this.mask = null; // libera a memória da rasterização
      this.root.visible = false;
    }

    // ------------------------------------------------------------ nomes
    _names(world, brasil) {
      let dn = null;
      try { dn = new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch (e) { dn = null; }
      this.regions = [];
      world.countries.forEach((c) => {
        let nome = c.name || 'País';
        if (dn && c.a2) { try { nome = dn.of(c.a2) || nome; } catch (e) { /* mantém o nome em inglês */ } }
        this.regions.push({ nome, code: c.a2 || '', brasil: c.id === '076' });
      });
      this.stateBase = 1000;
      this.brStates = brasil.states.map((s) => ({ nome: s.nome, code: s.uf, brasil: true }));
    }

    region(id) {
      if (id >= this.stateBase) return this.brStates[id - this.stateBase];
      return this.regions[id] || null;
    }

    // ------------------------------------------------------------ máscara equiretangular com o id de cada país
    _mask(world, brasil, W) {
      const H = W / 2;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const X = (lon) => ((lon + 180) / 360) * W;
      const Y = (lat) => ((90 - lat) / 180) * H;
      const unwrap = (flat) => {
        const pts = [];
        let prev = null;
        for (let i = 0; i < flat.length; i += 2) {
          let lon = flat[i];
          if (prev !== null) {
            while (lon - prev > 180) lon -= 360;
            while (lon - prev < -180) lon += 360;
          }
          pts.push(lon, flat[i + 1]);
          prev = lon;
        }
        return pts;
      };
      // cor = código do id (1..): r = id & 255, g = id >> 8, b = 255 (pixels de borda misturados perdem o b cheio)
      const fill = (polys, id) => {
        const v = id + 1;
        ctx.fillStyle = `rgb(${v & 255},${v >> 8},255)`;
        for (const poly of polys) {
          const rings = poly.map(unwrap);
          for (const shift of [-360, 0, 360]) {
            ctx.beginPath();
            for (const r of rings) {
              for (let i = 0; i < r.length; i += 2) {
                const x = X(r[i] + shift);
                const y = Y(r[i + 1]);
                if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
              }
              ctx.closePath();
            }
            ctx.fill('evenodd');
          }
        }
      };
      world.countries.forEach((cty, i) => { if (cty.id !== '076') fill(cty.polys, i); });
      brasil.states.forEach((s, i) => fill(s.polys, this.stateBase + i));
      this.mask = { W, H, data: ctx.getImageData(0, 0, W, H).data };
    }

    /** id da região na direção local d (ou -1 = mar) */
    _sample(d) {
      const M = this.mask;
      const lat = Math.asin(Math.max(-1, Math.min(1, d.y)));
      const lon = Math.atan2(d.z, -d.x);
      let x = Math.floor((((lon / Math.PI) * 180 + 180) / 360) * M.W);
      x = ((x % M.W) + M.W) % M.W;
      const y = Math.min(M.H - 1, Math.max(0, Math.floor(((90 - (lat * 180) / Math.PI) / 180) * M.H)));
      const read = (xx, yy) => {
        const o = (yy * M.W + (((xx % M.W) + M.W) % M.W)) * 4;
        const b = M.data[o + 2];
        if (b < 110) return -1;           // mar (ou borda quase toda de mar)
        if (b < 250) return -2;           // divisa: cor misturada, procura um pixel inteiro ao lado
        const id = M.data[o] + M.data[o + 1] * 256 - 1;
        return this.region(id) ? id : -2;
      };
      let id = read(x, y);
      if (id === -2) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const r = read(x + dx, Math.min(M.H - 1, Math.max(0, y + dy)));
          if (r >= 0) { id = r; break; }
        }
        if (id < 0) id = -1;
      }
      return id;
    }

    // ------------------------------------------------------------ esfera-cubo
    /** direção local (unitária) do centro da célula (f, i, j); i/j podem sair da face (vizinhas) */
    dirOf(f, i, j, out = new THREE.Vector3()) {
      const N = this.N;
      const a = -1 + ((i + 0.5) * 2) / N;
      const b = -1 + ((j + 0.5) * 2) / N;
      const [n, u, v] = FACES[f];
      return out.copy(n).addScaledVector(u, Math.tan(a * Q4)).addScaledVector(v, Math.tan(b * Q4)).normalize();
    }

    /** célula (f, i, j) da direção local d */
    cellOf(d) {
      const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
      let f;
      if (ax >= ay && ax >= az) f = d.x > 0 ? 0 : 1;
      else if (ay >= az) f = d.y > 0 ? 2 : 3;
      else f = d.z > 0 ? 4 : 5;
      const [n, u, v] = FACES[f];
      const k = 1 / d.dot(n);
      const a = Math.atan(d.dot(u) * k) / Q4;
      const b = Math.atan(d.dot(v) * k) / Q4;
      const N = this.N;
      const i = Math.min(N - 1, Math.max(0, Math.floor(((a + 1) / 2) * N)));
      const j = Math.min(N - 1, Math.max(0, Math.floor(((b + 1) / 2) * N)));
      return (f * N + j) * N + i;
    }

    _buildLand() {
      const N = this.N;
      const total = 6 * N * N;
      const regionOf = new Int16Array(total);
      const index = new Int32Array(total).fill(-1);
      const cells = [];
      const d = new THREE.Vector3();
      const e = new THREE.Vector3();
      for (let f = 0; f < 6; f++) {
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const key = (f * N + j) * N + i;
            this.dirOf(f, i, j, d);
            const id = this._sample(d);
            regionOf[key] = id;
            if (id < 0) continue;
            index[key] = cells.length;
            cells.push({ f, i, j, key, id, dir: d.clone() });
          }
        }
      }
      this.cellRegion = regionOf;
      const md = new Uint8Array(total * 4);
      for (let k = 0; k < total; k++) if (index[k] >= 0) md[k * 4] = 255;
      this.landMask = new THREE.DataTexture(md, N, 6 * N, THREE.RGBAFormat);
      this.landMask.magFilter = THREE.NearestFilter;
      this.landMask.minFilter = THREE.NearestFilter;
      this.landMask.needsUpdate = true;
      const L = cells.length;
      const aState = new Float32Array(L);
      const aEdge = new Float32Array(L * 4);
      const aScorch = new Float32Array(L);
      const aCol = new Float32Array(L * 3);
      const top = new Float32Array(L);
      const base = new Float32Array(L);
      const dirs = new Float32Array(L * 3);
      const wid = new Float32Array(L * 2);
      const R = this.R;
      const flag = (f, i, j, id) => {
        const o = this._sample(this.dirOf(f, i, j, e));
        return o < 0 ? 2 : o !== id ? 1 : 0;
      };
      const pal = [lin('#2c4a45'), lin('#3a5446'), lin('#34504f'), lin('#4a5a48'), lin('#2f4a52'), lin('#52594a')];
      const brA = lin('#2f6a5f');
      const brB = lin('#3c7a68');
      const ice = lin('#b7c9cf');
      const tmp = new THREE.Vector3();
      cells.forEach((q, k) => {
        const { f, i, j, id } = q;
        aState[k] = id;
        aEdge[k * 4] = flag(f, i - 1, j, id);
        aEdge[k * 4 + 1] = flag(f, i + 1, j, id);
        aEdge[k * 4 + 2] = flag(f, i, j - 1, id);
        aEdge[k * 4 + 3] = flag(f, i, j + 1, id);
        const dd = q.dir;
        dirs.set([dd.x, dd.y, dd.z], k * 3);
        // largura real da célula nos dois eixos da face
        const du = this.dirOf(f, i + 0.5, j, e).distanceTo(this.dirOf(f, i - 0.5, j, tmp)) * R;
        const dv = this.dirOf(f, i, j + 0.5, e).distanceTo(this.dirOf(f, i, j - 0.5, tmp)) * R;
        wid[k * 2] = du * 1.03;
        wid[k * 2 + 1] = dv * 1.03;
        const nz = fbm3(dd.x * 3.2 + 10, dd.y * 3.2 + 10, dd.z * 3.2 + 10);
        const h = 0.9 + Math.round(Math.max(0, nz - 0.45) * 7) * 0.22;
        base[k] = h;
        top[k] = h;
        const reg = this.region(id);
        const r1 = hash3(id * 1.7, 3.1, 5.3);
        let col;
        if (reg && reg.brasil) col = brA.clone().lerp(brB, r1);
        else col = pal[id % pal.length].clone().lerp(pal[(id * 7 + 3) % pal.length], r1);
        const polar = Math.max(0, (Math.abs(dd.y) - 0.86) / 0.1);
        col.lerp(ice, Math.min(1, polar) * 0.55);
        col.multiplyScalar(0.92 + 0.16 * hash3(q.key, 1.3, 2.9));
        aCol.set([col.x, col.y, col.z], k * 3);
      });
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      box.setAttribute('aState', new THREE.InstancedBufferAttribute(aState, 1));
      box.setAttribute('aEdge', new THREE.InstancedBufferAttribute(aEdge, 4));
      box.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
      const scorchAttr = new THREE.InstancedBufferAttribute(aScorch, 1);
      scorchAttr.setUsage(THREE.DynamicDrawUsage);
      box.setAttribute('aScorch', scorchAttr);
      this.landU = Object.assign({}, this.u, {
        uR: { value: R },
        uHover: { value: -9 },
        uSel: { value: -9 },
        uRim: { value: lin('#45c7b5', 1.0) },
        uCoast: { value: lin('#6fe3d2', 1.0) },
        uHoverCol: { value: lin('#45c7b5', 0.16) },
      });
      const mat = new THREE.ShaderMaterial({ uniforms: this.landU, vertexShader: LAND_VERT, fragmentShader: LAND_FRAG() });
      this.land = new THREE.InstancedMesh(box, mat, L);
      this.land.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.land.frustumCulled = false;
      this.vox = { index, cells: L, dirs, wid, top, base, scorch: aScorch, scorchAttr, col: aCol, blasts: [] };
      this._writeColumns(null);
      this.group.add(this.land);
    }

    _writeColumns(list) {
      const v = this.vox;
      const m = this._m;
      const R = this.R;
      const floor = R - this.FLOOR;
      const X = this._p;
      const Y = this._d;
      const Z = this._s;
      const n = list ? list.length : v.cells;
      for (let t = 0; t < n; t++) {
        const k = list ? list[t] : t;
        Y.set(v.dirs[k * 3], v.dirs[k * 3 + 1], v.dirs[k * 3 + 2]);
        // eixo tangente estável: projeta um eixo do mundo que não seja quase paralelo
        if (Math.abs(Y.y) < 0.9) X.set(0, 1, 0); else X.set(1, 0, 0);
        X.cross(Y).normalize();
        Z.crossVectors(X, Y);
        const h = Math.max(0.05, R + v.top[k] - floor);
        m.makeBasis(X.multiplyScalar(v.wid[k * 2]), Y.clone().multiplyScalar(h), Z.multiplyScalar(v.wid[k * 2 + 1]));
        m.setPosition(Y.x * floor, Y.y * floor, Y.z * floor);
        this.land.setMatrixAt(k, m);
      }
      this.land.instanceMatrix.needsUpdate = true;
    }

    _buildOcean() {
      this.oceanU = Object.assign({}, this.u, {
        uR: this.landU.uR,
        uOcean: { value: lin('#071a28') },
        uOceanHi: { value: lin('#0b2638') },
        uGrid: { value: lin('#2b7f8c', 0.25) },
        uN: { value: this.N },
        uLandMask: { value: this.landMask },
      });
      const seg = this.N > 150 ? 192 : 128;
      this.ocean = new THREE.Mesh(
        new THREE.SphereGeometry(this.R, seg, seg / 2),
        new THREE.ShaderMaterial({ uniforms: this.oceanU, vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG() }),
      );
      this.group.add(this.ocean);
    }

    _buildAtmosphere() {
      const atm = new THREE.Mesh(
        new THREE.SphereGeometry(this.R * 1.045, 96, 48),
        new THREE.ShaderMaterial({
          uniforms: { uKeyDir: this.u.uKeyDir, uDim: this.u.uDim },
          vertexShader: ATM_VERT, fragmentShader: ATM_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false,
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        }),
      );
      this.root.add(atm);
    }

    _buildDebris(max) {
      this.debris = new B.parts.DebrisField(this.u, max);
      this.debrisMesh = this.debris.mesh;
      this.root.add(this.debrisMesh);
    }

    // ------------------------------------------------------------ navegação
    setVisible(v) { this.root.visible = v; }

    /** direção local sob o raio (ou null) */
    pickDir(ray, out = new THREE.Vector3()) {
      const s = new THREE.Sphere(new THREE.Vector3(), this.R + 0.6);
      if (!ray.intersectSphere(s, out)) return null;
      this._qi.copy(this.group.quaternion).invert();
      return out.normalize().applyQuaternion(this._qi);
    }

    /** descrição do ponto na direção local d */
    info(d) {
      const key = this.cellOf(d);
      const id = this.cellRegion[key];
      const lat = (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI;
      const lon = (Math.atan2(d.z, -d.x) * 180) / Math.PI;
      if (id < 0) return { id: -1, land: false, nome: oceanName(lat, lon), code: 'MAR', lat, lon };
      const r = this.region(id);
      return { id, land: true, nome: r.nome, code: r.brasil && id < this.stateBase ? 'BR' : r.code, brasil: !!r.brasil, lat, lon };
    }

    /** direção local de uma latitude/longitude */
    dirLatLon(lat, lon, out = new THREE.Vector3()) {
      const la = (lat * Math.PI) / 180;
      const lo = (lon * Math.PI) / 180;
      return out.set(-Math.cos(lo) * Math.cos(la), Math.sin(la), Math.sin(lo) * Math.cos(la));
    }

    /** ponto do mundo (na superfície) de uma direção local */
    worldPoint(d, out = new THREE.Vector3()) {
      const key = this.cellOf(d);
      const k = this.vox.index[key];
      const r = this.R + (k >= 0 ? this.vox.top[k] : 0);
      return out.copy(d).applyQuaternion(this.group.quaternion).multiplyScalar(r);
    }

    /** gira o planeta até a direção local d ficar no topo (+y). dur = 0 salta direto. */
    bringToTop(d, dur = 1.1) {
      const w = this._d.copy(d).applyQuaternion(this.group.quaternion);
      const q = new THREE.Quaternion().setFromUnitVectors(w, new THREE.Vector3(0, 1, 0)).multiply(this.group.quaternion);
      if (dur <= 0) {
        this.group.quaternion.copy(q);
        this.turn = null;
        this.settled = 1;
        return;
      }
      this.turn = { from: this.group.quaternion.clone(), to: q, t: 0, dur };
    }

    finishTurn() {
      if (!this.turn) return;
      this.group.quaternion.copy(this.turn.to);
      this.turn = null;
      this.settled = 1;
    }

    update(dt) {
      const tr = this.turn;
      if (tr) {
        tr.t += dt;
        const e = Math.min(1, tr.t / tr.dur);
        const s = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
        this.group.quaternion.slerpQuaternions(tr.from, tr.to, s);
        this.settled = e >= 1 ? 1 : 0;
        if (e >= 1) this.turn = null;
      }
    }

    /** altura (y do mundo) do chão logo abaixo de (x, z), válido perto do topo */
    groundAt(x, z) {
      const R = this.R;
      const y = Math.sqrt(Math.max(0, R * R - x * x - z * z));
      this._qi.copy(this.group.quaternion).invert();
      const d = this._d.set(x, y, z).normalize().applyQuaternion(this._qi);
      const k = this.vox.index[this.cellOf(d)];
      const r = R + (k >= 0 ? this.vox.top[k] : 0);
      return Math.sqrt(Math.max(0, r * r - x * x - z * z));
    }

    // ------------------------------------------------------------ crateras e blocos voadores
    /** Cratera em (x, z) do mundo (perto do topo). k = intensidade artística; só visual.
        opts.pull = ponto do mundo que suga os blocos; opts.instant = aplica já, sem destroços.
        Devolve a profundidade no centro, em blocos abaixo do chão original. */
    blast(x, z, k, t0, rng, opts = {}) {
      const R = this.R;
      this._qi.copy(this.group.quaternion).invert();
      const c = new THREE.Vector3(x, Math.sqrt(Math.max(0, R * R - x * x - z * z)), z).normalize().applyQuaternion(this._qi);
      return this.blastDir(c, k, t0, rng, opts);
    }

    /** a mesma cratera, pela direção local c (usado também para refazer as salvas) */
    blastDir(c, k, t0, rng, opts = {}) {
      if (k <= 0.02) return 0;
      const v = this.vox;
      const R = this.R;
      const BR = opts.R || (1.1 + 2.1 * k) * 1.25;
      const D = opts.D || 0.4 + 0.9 * k;
      const ang = BR / R;
      const cosMax = Math.cos(ang * 1.4);
      const cellW = (Math.PI / 2 / this.N) * R;
      const q = this.group.quaternion;
      const wp = new THREE.Vector3();
      const cw = c.clone().applyQuaternion(q).multiplyScalar(R);
      const aff = [];
      const batch = [];
      const pull = opts.pull || null;
      const spread = opts.spread || 2.5;
      const onLand = v.index[this.cellOf(c)] >= 0;
      let depth = 0;
      for (let id = 0; id < v.cells; id++) {
        const dx = v.dirs[id * 3], dy = v.dirs[id * 3 + 1], dz = v.dirs[id * 3 + 2];
        const dot = dx * c.x + dy * c.y + dz * c.z;
        if (dot < cosMax) continue;
        const r = Math.acos(Math.min(1, dot)) / ang;
        if (opts.raise && r >= 1) continue;
        const target = opts.raise
          ? B.parts.raiseProfile(v.top[id], r, opts.raise, v.base[id])
          : B.parts.craterProfile(v.top[id], r, D, this.DEEP, v.base[id] + 2.4);
        if (r < 0.25) depth = Math.max(depth, (v.base[id] - target) / cellW);
        const sc = opts.raise ? (r < 1 ? 0.5 + 0.4 * (1 - r) : 0) : r < 1.1 ? Math.min(1, (1.1 - r) * 1.3) : 0;
        aff.push({ id, r, from: v.top[id], to: target, scorch: Math.max(v.scorch[id], sc) });
        if (opts.instant || opts.raise) continue;
        const removed = v.top[id] - target;
        const n = Math.min(4, Math.floor(removed / (cellW * 0.9)));
        if (!n) continue;
        wp.set(dx, dy, dz).applyQuaternion(q).multiplyScalar(R + v.top[id]);
        const a0 = Math.atan2(wp.z - cw.z, wp.x - cw.x);
        for (let b = 0; b < n; b++) {
          const a = a0 + (rng() - 0.5) * 0.9;
          const out = (1.5 + rng() * 5.5) * (0.6 + 0.6 * Math.min(k, 3)) * (1.15 - r) * (opts.lift || 1);
          const d = {
            x: wp.x, y: wp.y - b * cellW, z: wp.z,
            vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: (3 + rng() * 7) * (0.6 + 0.5 * Math.min(k, 4)) * (1.2 - r) * (opts.lift || 1),
            ax: rng() - 0.5, ay: rng() - 0.5, az: rng() - 0.5, w: 3 + rng() * 10,
            size: cellW * (0.8 + rng() * 0.2), t0: t0 + r * 0.06,
            cr: v.col[id * 3] * 1.3, cg: v.col[id * 3 + 1] * 1.3, cb: v.col[id * 3 + 2] * 1.3,
            heat: !opts.cold && r < 0.55 && rng() < 0.6 ? 1 - r : 0,
          };
          if (pull) { d.pull = pull; d.dur = 1.1 + rng() * 1.4; d.t0 = t0 + (1 - r) * 0.3 + rng() * spread; d.heat = 0; }
          batch.push(d);
        }
      }
      // no mar: cubos de água sobem e caem (ou são sugados)
      if (!onLand && !opts.instant && !opts.raise && !opts.noSplash) {
        const cnt = Math.round(30 + 90 * Math.min(k, 4));
        const oc = this.oceanU.uOceanHi.value;
        const y0 = cw.y;
        for (let b = 0; b < cnt; b++) {
          const a = rng() * Math.PI * 2;
          const rr = Math.sqrt(rng()) * BR * 0.7;
          const out = (1 + rng() * 5) * (0.6 + 0.6 * Math.min(k, 3));
          const d = {
            x: cw.x + Math.cos(a) * rr, y: y0, z: cw.z + Math.sin(a) * rr,
            vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: (4 + rng() * 9) * (0.6 + 0.5 * Math.min(k, 4)),
            ax: rng() - 0.5, ay: rng() - 0.5, az: rng() - 0.5, w: 2 + rng() * 8,
            size: cellW * (0.45 + rng() * 0.4), t0: t0 + rng() * 0.15,
            cr: oc.x * 2.4, cg: oc.y * 2.8, cb: oc.z * 3.4, water: true,
          };
          if (pull) { d.pull = pull; d.dur = 1 + rng() * 1.5; d.t0 = t0 + rng() * spread; d.water = false; }
          batch.push(d);
        }
      }
      if (opts.instant) {
        const ids = [];
        for (const a of aff) { v.top[a.id] = a.to; v.scorch[a.id] = Math.max(v.scorch[a.id], a.scorch); ids.push(a.id); }
        if (ids.length) { this._writeColumns(ids); v.scorchAttr.needsUpdate = true; }
      } else {
        this.debris.add(batch, rng);
        if (aff.length) v.blasts.push({ t0, aff, dur: opts.dur || (pull ? spread + 1 : 0.45) });
      }
      if (aff.length) this.history.push(Object.assign({ d: [+c.x.toFixed(5), +c.y.toFixed(5), +c.z.toFixed(5)], k: +k.toFixed(3) }, B.parts.shapeOpts(opts)));
      return depth;
    }

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

    resetBlocks() {
      const v = this.vox;
      this.clearDebris();
      v.blasts = [];
      this.history = [];
      v.top.set(v.base);
      v.scorch.fill(0);
      v.scorchAttr.needsUpdate = true;
      this._writeColumns(null);
    }

    /** refaz crateras salvas (sem animação) */
    restore(list) {
      const r = () => 0.5;
      const d = new THREE.Vector3();
      for (const h of list || []) {
        if (!h || !Array.isArray(h.d) || !isFinite(h.k)) continue;
        d.set(h.d[0], h.d[1], h.d[2]);
        if (!(d.lengthSq() > 0.5)) continue;
        this.blastDir(d.normalize(), h.k, 0, r, Object.assign(B.parts.shapeOpts(h), { instant: true }));
      }
    }

    setHover(id) { this.landU.uHover.value = id; }
    setSelected(id) { this.landU.uSel.value = id; }
  }

  B.VoxelPlanet = VoxelPlanet;
})();
