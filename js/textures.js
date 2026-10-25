/* Texturas procedurais geradas em canvas na abertura (nenhuma imagem externa):
   brilho radial, atlas de baforadas de fumaça, faísca alongada, estrela de 4 pontas,
   hexágono para reflexos de lente e ruído contínuo (tileable) para os shaders. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE) return;
  const THREE = window.THREE;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function hash2(ix, iy, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 144665)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  function vnoise(x, y, period, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const p = period;
    const x0 = ((ix % p) + p) % p;
    const y0 = ((iy % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const a = hash2(x0, y0, seed);
    const b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed);
    const d = hash2(x1, y1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function fbm(x, y, period, seed, oct) {
    let s = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * vnoise(x * f, y * f, period * f, seed + o * 17);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / norm;
  }

  function toTexture(c, opts = {}) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 1;
    if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  function glow() {
    const N = 128;
    const c = canvas(N, N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N * 2 - 1;
        const dy = (y + 0.5) / N * 2 - 1;
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const core = Math.exp(-r * r * 18);
        const halo = Math.pow(1 - r, 2.6);
        const a = Math.min(1, core * 0.75 + halo * 0.6) * (1 - r * r * r);
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  }

  /** Atlas 2x2 de baforadas: máscara radial deformada por fbm + sombreamento interno. */
  function puff() {
    const N = 128;
    const c = canvas(N * 2, N * 2);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N * 2, N * 2);
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * N;
      const oy = Math.floor(cell / 2) * N;
      const seed = 11 + cell * 101;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const u = (x + 0.5) / N;
          const v = (y + 0.5) / N;
          const dx = u * 2 - 1;
          const dy = v * 2 - 1;
          const r = Math.sqrt(dx * dx + dy * dy);
          const n = fbm(u * 5, v * 5, 64, seed, 5);
          const n2 = fbm(u * 9 + 3.1, v * 9 + 7.7, 64, seed + 7, 4);
          const edge = r + (n - 0.5) * 0.55;
          let a = 1 - smoothstep(0.35, 0.95, edge);
          a *= 0.55 + 0.9 * n;
          a = Math.max(0, Math.min(1, a)) * (1 - smoothstep(0.88, 1.0, r));
          const shade = 0.62 + 0.38 * n2 - dy * 0.12;
          const i = ((oy + y) * N * 2 + (ox + x)) * 4;
          const s = Math.max(0, Math.min(1, shade));
          img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(s * 255);
          img.data[i + 3] = Math.round(a * 255);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  }

  /** Faísca: cabeça brilhante no topo (v = 1), cauda que some para baixo. */
  function spark() {
    const W = 32;
    const H = 128;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5) / W * 2 - 1;
        const v = 1 - (y + 0.5) / H; // 1 no topo do canvas
        const across = Math.exp(-dx * dx * 7);
        const along = Math.pow(v, 1.6) * (1 - smoothstep(0.9, 1.0, v)) + Math.exp(-Math.pow((v - 0.9) * 14, 2));
        const a = Math.min(1, across * along);
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  }

  function star() {
    const N = 64;
    const c = canvas(N, N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N * 2 - 1;
        const dy = (y + 0.5) / N * 2 - 1;
        const r = Math.sqrt(dx * dx + dy * dy);
        const rays = Math.exp(-Math.abs(dx) * 26) * Math.pow(1 - Math.min(1, Math.abs(dy)), 3) +
          Math.exp(-Math.abs(dy) * 26) * Math.pow(1 - Math.min(1, Math.abs(dx)), 3);
        const core = Math.exp(-r * r * 30);
        const a = Math.min(1, rays * 0.9 + core) * (1 - smoothstep(0.85, 1, r));
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  }

  function hex() {
    const N = 64;
    const c = canvas(N, N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = Math.abs((x + 0.5) / N * 2 - 1);
        const py = Math.abs((y + 0.5) / N * 2 - 1);
        const d = Math.max(px * 0.866 + py * 0.5, py); // distância hexagonal
        const body = 1 - smoothstep(0.72, 0.8, d);
        const rim = Math.exp(-Math.pow((d - 0.76) * 22, 2));
        const a = Math.min(1, body * 0.35 + rim * 0.5);
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  }

  /** Ruído contínuo nas bordas (tileable), usado nas esferas de energia e na onda de choque. */
  function noise() {
    const N = 128;
    const c = canvas(N, N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const n = fbm(x / N * 4, y / N * 4, 4, 5, 5);
        const n2 = fbm(x / N * 8, y / N * 8, 8, 91, 4);
        const i = (y * N + x) * 4;
        img.data[i] = Math.round(n * 255);
        img.data[i + 1] = Math.round(n2 * 255);
        img.data[i + 2] = Math.round((1 - Math.abs(n * 2 - 1)) * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { repeat: true });
  }

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  B.makeTextures = function () {
    return { glow: glow(), puff: puff(), spark: spark(), star: star(), hex: hex(), noise: noise() };
  };
  B.noiseUtil = { fbm, vnoise };
})();
