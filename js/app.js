/* Brasil FX — orquestração: renderizador, câmera, interface, tomadas e qualidade adaptativa. */
(function () {
  'use strict';
  const B = window.BFX || {};
  const $ = (id) => document.getElementById(id);
  const loadingEl = $('loading');
  const loadingText = $('loadingText');

  function fail(msg) {
    loadingEl.classList.remove('is-done');
    loadingEl.classList.add('is-error');
    loadingText.textContent = msg;
  }

  if (!window.THREE || !window.THREE_ADDONS || !B.BrazilMap || !B.EFFECTS || !B.Particles) {
    fail('Não foi possível carregar o motor 3D. O three.js vem de cdn.jsdelivr.net: verifique a conexão com a internet e recarregue a página.');
    return;
  }
  if (!window.BRASIL_GEO) {
    fail('Os dados do mapa não foram encontrados (js/brasil-geo.js).');
    return;
  }

  const THREE = window.THREE;
  const { OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass } = window.THREE_ADDONS;
  const U = B.util;
  const { Spring, clamp, clamp01, lerp, smooth } = U;

  // ------------------------------------------------------------ dispositivo e preferências
  const coarse = matchMedia('(pointer: coarse)').matches;
  const isMobile = coarse && Math.min(screen.width, screen.height) < 900;
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saved = U.store.read();
  // efeitos criados pelo usuário (guardados só neste navegador)
  const customStore = {
    key: 'brasil-fx:custom',
    read() {
      try { const a = JSON.parse(localStorage.getItem(this.key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    },
    write(list) {
      try { localStorage.setItem(this.key, JSON.stringify(list)); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
    },
  };
  let customParams = customStore.read().filter((p) => p && typeof p.id === 'string');
  const BUILTIN = B.EFFECTS.length;
  function syncCustomEffects() {
    B.EFFECTS.length = BUILTIN;
    customParams.forEach((p, i) => B.EFFECTS.push(B.makeCustomEffect(Object.assign({}, p, { code: 'MEU-' + String(i + 1).padStart(2, '0') }))));
  }
  syncCustomEffects();
  const settings = {
    volume: typeof saved.volume === 'number' ? clamp01(saved.volume) : 0.75,
    muted: !!saved.muted,
    reduced: typeof saved.reduced === 'boolean' ? saved.reduced : prefersReduced,
    cinematic: typeof saved.cinematic === 'boolean' ? saved.cinematic : !prefersReduced,
    crater: typeof saved.crater === 'boolean' ? saved.crater : true,
    missile: !!saved.missile,
    light: typeof saved.light === 'number' ? Math.min(2.5, Math.max(0.5, saved.light)) : 1.3,
    fx: B.EFFECTS.some((f) => f.id === saved.fx) ? saved.fx : B.EFFECTS[0].id,
  };
  const persist = () => U.store.write(settings);

  const Q = {
    dprMax: Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 2),
    dprMin: isMobile ? 0.7 : 0.85,
    dpr: 1,
    particles: 1,
    autoNoBloom: false,
  };
  Q.dpr = Q.dprMax;

  // ------------------------------------------------------------ passe final (tone mapping, lente, grão, clarão)
  const FinalShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uCA: { value: 0.0045 },
      uGrain: { value: 0.02 },
      uVignette: { value: 0.34 },
      uExposure: { value: 1.25 },
      uAspect: { value: 1 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Vector3(1, 1, 1) },
      uFlashPos: { value: new THREE.Vector2(0.5, 0.5) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uCA;
      uniform float uGrain;
      uniform float uVignette;
      uniform float uExposure;
      uniform float uAspect;
      uniform float uFlash;
      uniform vec3 uFlashColor;
      uniform vec2 uFlashPos;
      varying vec2 vUv;

      vec3 rrtOdt(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 acesFilmic(vec3 c) {
        const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c = inM * (c / 0.6);
        c = rrtOdt(c);
        return clamp(outM * c, 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) {
        return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
      }
      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec2 d = vUv - 0.5;
        vec2 da = d * vec2(uAspect, 1.0);
        float r2 = dot(da, da);
        vec2 off = d * r2 * uCA;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
        col = clamp(col, 0.0, 256.0);
        if (uFlash > 0.0) {
          vec2 fd = (vUv - uFlashPos) * vec2(uAspect, 1.0);
          float g = exp(-dot(fd, fd) * 3.0);
          col += uFlashColor * uFlash * (0.3 + 1.7 * g);
        }
        col = acesFilmic(col * uExposure);
        col = toSRGB(col);
        float v = smoothstep(0.45, 1.25, length(da) * 1.35);
        col *= 1.0 - uVignette * v;
        col += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 431.0) - 0.5) * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };

  // ------------------------------------------------------------ renderizador
  const canvas = $('stage');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' });
  } catch (e) {
    fail('Este navegador não conseguiu iniciar o WebGL 2. Atualize o navegador ou ative a aceleração por hardware nas configurações.');
    return;
  }
  renderer.setClearColor(new THREE.Color('#05090e'), 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Q.dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 2000);

  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: isMobile ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 1.2);
  // Entrada do bloom: descarta NaN/Inf e limita o HDR. Um único pixel inválido, espalhado
  // pelo desfoque, apagaria a tela inteira; valores altos demais "lavariam" o quadro.
  bloomPass.highPassUniforms.uClampMax = { value: 14 };
  bloomPass.materialHighPassFilter.fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 defaultColor;
    uniform float defaultOpacity;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    uniform float uClampMax;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      c = clamp(c, 0.0, uClampMax);
      float v = luminance(c);
      vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);
      float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
      gl_FragColor = mix(outputColor, vec4(c, texel.a), alpha);
    }
  `;
  bloomPass.materialHighPassFilter.needsUpdate = true;
  if (isMobile) {
    const setSize = bloomPass.setSize.bind(bloomPass);
    bloomPass.setSize = (w, h) => setSize(Math.max(2, Math.round(w * 0.6)), Math.max(2, Math.round(h * 0.6)));
  }
  composer.addPass(bloomPass);
  const finalPass = new ShaderPass(FinalShader);
  composer.addPass(finalPass);
  const FU = finalPass.uniforms;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    toast('O WebGL foi reiniciado pelo navegador. Se a cena não voltar, recarregue a página.', 6000);
  });

  // ------------------------------------------------------------ controles de câmera
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 95;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = 1.3;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.zoomToCursor = !coarse;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(0, 0, 1.5);
  camera.position.setFromSpherical(new THREE.Spherical(130, 0.2, 0)).add(controls.target);

  const ui = {
    body: document.body,
    rack: $('rack'), rackHandle: $('rackHandle'), fxList: $('fxList'), fxIndicator: $('fxIndicator'),
    pointInfo: $('pointInfo'), btnRandom: $('btnRandom'), btnStart: $('btnStart'),
    btnPause: $('btnPause'), btnRepeat: $('btnRepeat'), btnClear: $('btnClear'),
    btnMute: $('btnMute'), volume: $('volume'), btnSettings: $('btnSettings'), settings: $('settings'),
    optReduced: $('optReduced'), optCinematic: $('optCinematic'),
    timelineFill: $('timelineFill'), timelineLabel: $('timelineLabel'),
    timecode: $('timecode'), takeLabel: $('takeLabel'),
    countdown: $('countdown'), leaderNum: $('leaderNum'), leaderSweep: $('leaderSweep'),
    pausedTag: $('pausedTag'), tooltip: $('tooltip'), toast: $('toast'),
    intro: $('intro'), introReduced: $('introReduced'), btnEnter: $('btnEnter'),
  };

  // ------------------------------------------------------------ estado
  const COUNT = 3;
  const audio = new B.SoundEngine();
  audio.volume = settings.volume;
  audio.muted = settings.muted;

  let tex = null;
  let map = null;
  let planet = null; // planeta em blocos (vista "Globo")
  let view = 'map';
  let stage = null;
  let sceneU = null;
  let point = null; // { x, z, state, lon, lat }
  let take = null;  // tomada em andamento
  let lastTake = null;
  let takeNo = 0;
  let phase = 'idle'; // idle | countdown | running | done
  let entered = false;
  let clock = 0;
  const markerPos = new THREE.Vector3();

  const TEAL = new THREE.Color('#45c7b5');
  const TUNG = new THREE.Color('#ffae42');
  const markerVis = new Spring(0, { stiffness: 120, damping: 18 });
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const beamDir = new THREE.Vector3(0, 1, 0);

  // ------------------------------------------------------------ enquadramento
  function fitRadius() {
    let aspect = camera.aspect;
    if (!isMobileLayout()) {
      const r = ui.rack.getBoundingClientRect();
      const free = Math.max(320, Math.min(window.innerWidth, r.left));
      aspect = free / window.innerHeight;
    }
    const halfV = (camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    return (20.5 * (map ? map.S : 2)) / Math.sin(Math.min(halfV, halfH));
  }
  function takeRadius() { return camera.aspect < 0.8 ? 27 : 21; }

  // centro óptico deslocado: o mapa fica centrado na área livre (fora do painel/gaveta)
  const viewOff = {
    x: new Spring(0, { stiffness: 140, damping: 24, onUpdate: () => applyViewOffset() }),
    y: new Spring(0, { stiffness: 140, damping: 24, onUpdate: () => applyViewOffset() }),
  };
  function applyViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return;
    camera.setViewOffset(w, h, viewOff.x.value, viewOff.y.value, w, h);
  }
  function updateViewOffsetTarget(jump) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let x = 0;
    let y = 0;
    if (isMobileLayout()) {
      const sh = Math.min(ui.rack.getBoundingClientRect().height, h * 0.7);
      y = (sh - 70) / 2;
    } else {
      const r = ui.rack.getBoundingClientRect();
      x = Math.max(0, w - r.left) / 2;
    }
    if (jump) { viewOff.x.jump(x); viewOff.y.jump(y); } else { viewOff.x.set(x); viewOff.y.set(y); }
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return; // aba oculta ou minimizada: mantém o tamanho anterior
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 52 : 40;
    camera.updateProjectionMatrix();
    updateViewOffsetTarget(true);
    renderer.setPixelRatio(Q.dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Q.dpr);
    composer.setSize(w, h);
    FU.uAspect.value = w / h;
    if (view !== 'globe') controls.maxDistance = Math.max(95, fitRadius() * 1.2);
    if (map) map.starU.uPR.value = Q.dpr;
    placeIndicator(true);
  }

  // ------------------------------------------------------------ voo de câmera (mola criticamente amortecida)
  const sph = new THREE.Spherical();
  const fly = {
    active: false, target: new THREE.Vector3(), radius: 60, phi: 0.72, theta: null, time: 0.9,
    v: { tx: 0, ty: 0, tz: 0, r: 0, p: 0, th: 0 },
  };
  const orbit = { active: false, speed: 0.05, push: 0 };

  function smoothDamp(cur, target, vel, key, time, dt) {
    const omega = 2 / Math.max(0.0001, time);
    const x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = cur - target;
    const temp = (vel[key] + omega * change) * dt;
    vel[key] = (vel[key] - omega * temp) * e;
    return target + (change + temp) * e;
  }

  function flyTo(target, radius, phi, theta = null, time = 0.9) {
    fly.active = true;
    fly.target.copy(target);
    fly.radius = clamp(radius, controls.minDistance, controls.maxDistance);
    fly.phi = clamp(phi, controls.minPolarAngle, controls.maxPolarAngle);
    fly.theta = theta;
    fly.time = time;
  }

  function updateCamera(dt) {
    if (fly.active || orbit.active) {
      sph.setFromVector3(tmpV.copy(camera.position).sub(controls.target));
      if (fly.active) {
        const t = controls.target;
        t.x = smoothDamp(t.x, fly.target.x, fly.v, 'tx', fly.time, dt);
        t.y = smoothDamp(t.y, fly.target.y, fly.v, 'ty', fly.time, dt);
        t.z = smoothDamp(t.z, fly.target.z, fly.v, 'tz', fly.time, dt);
        sph.radius = smoothDamp(sph.radius, fly.radius, fly.v, 'r', fly.time * 1.1, dt);
        sph.phi = smoothDamp(sph.phi, fly.phi, fly.v, 'p', fly.time, dt);
        if (fly.theta !== null) {
          let dth = fly.theta - sph.theta;
          dth = Math.atan2(Math.sin(dth), Math.cos(dth));
          sph.theta = smoothDamp(sph.theta, sph.theta + dth, fly.v, 'th', fly.time * 1.2, dt);
        }
        const done = t.distanceTo(fly.target) < 0.01 && Math.abs(sph.radius - fly.radius) < 0.02 && Math.abs(sph.phi - fly.phi) < 0.002;
        if (done) fly.active = false;
      }
      if (orbit.active) {
        sph.theta += orbit.speed * dt;
        if (orbit.push > 0 && !fly.active) sph.radius = Math.max(controls.minDistance + 1, sph.radius - orbit.push * dt);
      }
      sph.makeSafe();
      camera.position.setFromSpherical(sph).add(controls.target);
    }
    const t = controls.target;
    if (view === 'globe' && planet) {
      if (t.length() > planet.R + 12) t.setLength(planet.R + 12);
    } else {
      if (map) {
        t.x = clamp(t.x, map.minX - 4, map.maxX + 4);
        t.z = clamp(t.z, map.minZ - 4, map.maxZ + 4);
      }
      t.y = clamp(t.y, 0, 4);
    }
    controls.update(dt);
  }

  controls.addEventListener('start', () => {
    fly.active = false;
    orbit.active = false;
    canvas.classList.add('is-dragging');
  });
  controls.addEventListener('end', () => canvas.classList.remove('is-dragging'));

  // ------------------------------------------------------------ cartões de efeito
  function hexA(hex, a) {
    const c = new THREE.Color(hex);
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`;
  }
  const hexToCss = (hex) => {
    const c = new THREE.Color(hex);
    return '#' + c.getHexString();
  };
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  let cards = [];
  function renderCards() {
    for (const c of cards) c.remove();
    cards = B.EFFECTS.map(makeCard);
  }
  function makeCard(fx, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fx-card';
    b.id = 'fx-' + fx.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.tabIndex = -1;
    b.dataset.fx = fx.id;
    b.style.setProperty('--sw', `radial-gradient(circle at 34% 30%, ${hexToCss(fx.swatch[0])} 0%, ${hexToCss(fx.swatch[1])} 45%, ${hexToCss(fx.swatch[2])} 100%)`);
    b.style.setProperty('--sw-glow', hexA(fx.swatch[1], 0.45));
    b.innerHTML =
      '<span class="fx-swatch" aria-hidden="true"></span>' +
      `<span class="fx-code mono">${fx.code}${i < 9 ? `<span class="fx-key"> · tecla ${i + 1}</span>` : ''}${fx.event ? '<span class="fx-tag">evento</span>' : ''}</span>` +
      `<span class="fx-name">${esc(fx.name)}</span>` +
      `<span class="fx-desc">${esc(fx.desc)}</span>`;
    b.addEventListener('click', () => selectFx(fx.id, true));
    b.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowLeft') {
        e.preventDefault();
        const dir = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
        const next = B.EFFECTS[(i + dir + B.EFFECTS.length) % B.EFFECTS.length];
        selectFx(next.id, true);
        $('fx-' + next.id).focus();
      }
    });
    if (fx.custom) b.classList.add('is-custom');
    ui.fxList.appendChild(b);
    return b;
  }
  renderCards();

  const ind = {
    x: new Spring(0, { onUpdate: () => drawIndicator() }),
    y: new Spring(0, { onUpdate: () => drawIndicator() }),
    w: new Spring(0, { onUpdate: () => drawIndicator() }),
    h: new Spring(0, { onUpdate: () => drawIndicator() }),
    shown: false,
  };
  function drawIndicator() {
    const s = ui.fxIndicator.style;
    s.transform = `translate3d(${ind.x.value}px, ${ind.y.value}px, 0)`;
    s.width = ind.w.value + 'px';
    s.height = ind.h.value + 'px';
  }
  function placeIndicator(jump) {
    const card = $('fx-' + settings.fx);
    if (!card || !card.offsetParent) return;
    const x = card.offsetLeft;
    const y = card.offsetTop;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    if (jump || !ind.shown) {
      ind.x.jump(x); ind.y.jump(y); ind.w.jump(w); ind.h.jump(h);
      ind.shown = true;
      ui.fxIndicator.style.opacity = '1';
    } else {
      ind.x.set(x); ind.y.set(y); ind.w.set(w); ind.h.set(h);
    }
  }

  function selectFx(id, user) {
    settings.fx = id;
    persist();
    for (const c of cards) {
      const on = c.dataset.fx === id;
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    }
    placeIndicator(false);
    const sel = B.EFFECTS.find((f) => f.id === id);
    $('btnEdit').hidden = !(sel && sel.custom);
    const card = $('fx-' + id);
    if (user && card && isMobileLayout()) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    if (user) audio.uiBlip('select');
    syncUI();
  }

  const isMobileLayout = () => window.matchMedia('(max-width: 760px)').matches;

  // ------------------------------------------------------------ avisos
  let toastTimer = 0;
  function toast(msg, ms = 2800) {
    ui.toast.textContent = msg;
    ui.toast.hidden = false;
    ui.toast.style.animation = 'none';
    void ui.toast.offsetWidth;
    ui.toast.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
  }

  // ------------------------------------------------------------ ponto da cena
  function setPoint(x, z, state, opts = {}) {
    const s = state >= 0 ? map.states[state] : { nome: 'Mar', uf: 'OCEANO' };
    point = { kind: 'map', x, z, state, lon: map.lonOf(x), lat: map.latOf(z) };
    markerPos.set(x, map.groundAt(x, z), z);
    sceneU.uMarker.value.x = x;
    sceneU.uMarker.value.y = z;
    map.setSelected(state);
    if (phase !== 'running' && phase !== 'countdown') markerVis.set(1);
    ui.pointInfo.classList.add('is-set');
    ui.pointInfo.innerHTML =
      `<span class="point-name">${s.nome} <span class="mono" style="color:var(--paper-3)">${s.uf}</span></span>` +
      `<span class="point-coords mono">${U.fmtLat(point.lat)} · ${U.fmtLon(point.lon)}</span>`;
    ui.pointInfo.closest('.step').classList.add('is-done');
    ui.toast.hidden = true;
    if (!opts.silent) {
      audio.uiBlip('point');
      if (!take) {
        sph.setFromVector3(tmpV.copy(camera.position).sub(controls.target));
        flyTo(tmpV2.set(x, map.groundAt(x, z), z), clamp(sph.radius, 16, 34), clamp(sph.phi, 0.55, 0.95), null, 0.8);
      }
    }
    syncUI();
  }

  // ponto em qualquer lugar do planeta em blocos (terra ou mar); o planeta gira até ele ficar no topo
  function setPlanetPoint(d, opts = {}) {
    const inf = planet.info(d);
    point = { kind: 'planet', dir: d.clone(), state: inf.id, lat: inf.lat, lon: inf.lon, x: 0, z: 0 };
    planet.setSelected(inf.id);
    planet.bringToTop(d, opts.instant ? 0 : 1.1);
    sceneU.uMarker.value.x = 0;
    sceneU.uMarker.value.y = 0;
    if (phase !== 'running' && phase !== 'countdown') markerVis.set(1);
    ui.pointInfo.classList.add('is-set');
    ui.pointInfo.innerHTML =
      `<span class="point-name">${esc(inf.nome)} <span class="mono" style="color:var(--paper-3)">${esc(inf.code)}</span></span>` +
      `<span class="point-coords mono">${U.fmtLat(point.lat)} · ${U.fmtLon(point.lon)}</span>`;
    ui.pointInfo.closest('.step').classList.add('is-done');
    ui.toast.hidden = true;
    if (!opts.silent) {
      audio.uiBlip('point');
      if (!take) {
        const top = planet.R + 1.5;
        sph.setFromVector3(tmpV.copy(camera.position).sub(controls.target));
        flyTo(tmpV2.set(0, top, 0), clamp(sph.radius, 18, 40), clamp(sph.phi, 0.55, 0.95), null, 1.2);
      }
      if (isMobileLayout()) setSheet(true);
    }
    syncUI();
  }
  const samePoint = (a, b) => a && b && a.kind === b.kind && (a.kind === 'planet' ? a.dir.equals(b.dir) : a.x === b.x && a.z === b.z);

  function clearPoint() {
    point = null;
    markerVis.set(0);
    map.setSelected(-1);
    if (planet) planet.setSelected(-9);
    ui.pointInfo.classList.remove('is-set');
    ui.pointInfo.innerHTML = `<span class="point-name">Nenhum ponto</span><span class="point-coords mono">${coarse ? 'Toque' : 'Clique'} no mapa</span>`;
    ui.pointInfo.closest('.step').classList.remove('is-done');
  }

  // ------------------------------------------------------------ tomadas
  function endTake() {
    if (!take) return;
    if (take.missile) take.missile.dispose();
    take.fx.dispose();
    take.root.removeFromParent();
    audio.killBus(take.bus, 0.12);
    stage.reset();
    stage.apply();
    FU.uFlash.value = 0;
    take = null;
  }

  const terr = () => (view === 'globe' && planet ? planet : map);
  function clearCrater() {
    map.resetBlocks();
    if (planet) planet.resetBlocks();
    saveCraters();
  }
  // crateras salvas no navegador: refeitas ao abrir a página
  const CRATER_KEY = 'brasil-fx:crateras';
  const MAX_SAVED = 400;
  function saveCraters() {
    try {
      const data = { v: 1, map: map.history.slice(-MAX_SAVED), planet: planet ? planet.history.slice(-MAX_SAVED) : [] };
      localStorage.setItem(CRATER_KEY, JSON.stringify(data));
    } catch (e) { /* sem armazenamento: as crateras valem só nesta visita */ }
  }
  function loadCraters() {
    try {
      const data = JSON.parse(localStorage.getItem(CRATER_KEY) || 'null');
      if (!data || data.v !== 1) return 0;
      if (Array.isArray(data.map)) map.restore(data.map);
      if (planet && Array.isArray(data.planet)) planet.restore(data.planet);
      return (data.map ? data.map.length : 0) + (data.planet ? data.planet.length : 0);
    } catch (e) { return 0; }
  }

  function startTake(repeat, override) {
    if (repeat && !lastTake) return;
    if (!repeat && !point) {
      toast(`${coarse ? 'Toque' : 'Clique'} no mapa para escolher o ponto da cena`);
      audio.uiBlip('error');
      return;
    }
    audio.unlock();
    audio.resume();
    if (repeat && lastTake.point.kind !== (view === 'globe' ? 'planet' : 'map')) setView(lastTake.point.kind === 'planet' ? 'globe' : 'map', true);
    endTake();
    map.clearDebris();
    if (planet) planet.clearDebris();
    closeSettings();

    let def;
    let seed;
    let origin;
    if (repeat) {
      def = lastTake.def;
      seed = lastTake.seed;
      if (!samePoint(point, lastTake.point)) {
        if (lastTake.point.kind === 'planet') setPlanetPoint(lastTake.point.dir, { silent: true, instant: true });
        else setPoint(lastTake.point.x, lastTake.point.z, lastTake.point.state, { silent: true });
      }
      if (lastTake.point.kind === 'planet') planet.finishTurn();
      origin = lastTake.point.kind === 'planet' ? new THREE.Vector3(0, planet.groundAt(0, 0), 0) : lastTake.origin.clone();
      if (!def.draft && settings.fx !== def.id) selectFx(def.id, false);
    } else {
      def = override || B.EFFECTS.find((f) => f.id === settings.fx);
      seed = (Math.random() * 4294967295) >>> 0;
      if (point.kind === 'planet') {
        planet.finishTurn();
        origin = new THREE.Vector3(0, planet.groundAt(0, 0), 0);
      } else {
        origin = new THREE.Vector3(point.x, map.groundAt(point.x, point.z), point.z);
      }
      lastTake = { def, seed, origin: origin.clone(), point: { ...point, dir: point.dir ? point.dir.clone() : null } };
    }

    const root = new THREE.Group();
    scene.add(root);
    const bus = audio.bus();
    camera.updateMatrixWorld();
    const fx = def.build({
      root, origin, H: map.H, q: Q.particles, reduced: settings.reduced, r: U.rng(seed),
      tex, stage, camera, audio, bus,
    });
    const missile = settings.missile
      ? B.buildMissile({ root, origin, H: map.H, q: Q.particles, reduced: settings.reduced, r: U.rng(seed ^ 0x51ed), tex, stage, camera, audio, bus })
      : null;
    take = {
      def, fx, missile, seed, origin: origin.clone(), root, bus, t: -COUNT, paused: false, detonated: false, count: 0, audioDet: null,
      hits: (fx.hits || []).map((h, i) => Object.assign({ done: false, i }, h)),
    };
    if (audio.ready && bus) {
      const tDet = audio.now() + COUNT + 0.03;
      take.audioDet = tDet;
      for (let k = 0; k < COUNT; k++) audio.leaderBeep(bus, tDet - COUNT + k);
      fx.sound(tDet);
      if (missile) missile.sound(tDet);
    }
    takeNo += 1;
    ui.takeLabel.textContent = 'Tomada ' + String(takeNo).padStart(2, '0');
    phase = 'countdown';
    setPaused(false);
    ui.countdown.hidden = false;
    ui.body.classList.add('is-filming');
    if (isMobileLayout()) setSheet(false);

    const aim = tmpV2.copy(origin);
    aim.y += def.aimY ?? 1.3;
    sph.setFromVector3(tmpV.copy(camera.position).sub(controls.target));
    const r0 = takeRadius() * (def.frameK ?? 1);
    if (view !== 'globe') controls.maxDistance = Math.max(controls.maxDistance, r0 * 1.5);
    if (settings.cinematic) {
      flyTo(aim, r0, 0.98, null, 0.9);
      orbit.active = true;
      orbit.speed = 0.055;
      orbit.push = 0;
    } else {
      flyTo(aim, Math.min(Math.max(sph.radius, r0 * 0.9), r0 * 1.6), clamp(sph.phi, 0.6, 1.1), null, 0.9);
      orbit.active = false;
    }
    syncUI();
  }

  function clearAll() {
    endTake();
    map.clearDebris();
    if (planet) planet.clearDebris();
    phase = 'idle';
    setPaused(false);
    ui.countdown.hidden = true;
    ui.body.classList.remove('is-filming');
    orbit.active = false;
    clearPoint();
    setSheet(true);
    ui.timelineFill.style.transform = 'scaleX(0)';
    ui.timecode.textContent = U.timecode(0);
    syncUI();
  }

  function setPaused(p) {
    if (take) take.paused = p;
    ui.body.classList.toggle('is-paused', p);
    ui.pausedTag.hidden = !p;
    ui.btnPause.setAttribute('aria-label', p ? 'Continuar' : 'Pausar');
    ui.btnPause.title = p ? 'Continuar (Espaço)' : 'Pausar (Espaço)';
    if (p) audio.pause();
    else audio.resume();
  }

  function togglePause() {
    if (!take) return;
    setPaused(!take.paused);
    syncUI();
  }

  /** marcas no terreno dos eventos (fendas, montanha, rastro do tornado...), cada uma no seu tempo */
  function applyHits(t) {
    let dirty = false;
    const o = take.origin;
    const ground = terr();
    for (const h of take.hits) {
      if (h.done || t < h.t) continue;
      h.done = true;
      if (!settings.crater) continue;
      const x = o.x + (h.dx || 0);
      const z = o.z + (h.dz || 0);
      const opts = { R: h.R, D: h.D, raise: h.raise, dur: h.dur, spread: h.spread, noSplash: h.noSplash, cold: h.cold, lift: h.lift };
      if (h.pull) {
        const by = h.pull.abs ? o.y : ground.groundAt(x, z);
        opts.pull = new THREE.Vector3(x + (h.pull.dx || 0), by + h.pull.y, z + (h.pull.dz || 0));
      }
      const dep = ground.blast(x, z, h.k ?? 0.5, h.t, U.rng((take.seed + h.i * 7919) >>> 0), opts);
      if (!h.raise) take.depth = Math.max(take.depth || 0, dep);
      dirty = true;
    }
    if (dirty) saveCraters();
  }

  function finishTake() {
    const depth = take && take.depth;
    endTake();
    if (depth > 0.5) toast(`Cratera com ${depth.toFixed(1)} blocos de fundo · fica salva · exploda de novo para cavar mais (só visual)`, 4200);
    phase = 'done';
    ui.body.classList.remove('is-filming');
    orbit.active = false;
    if (point) markerVis.set(1);
    setSheet(true);
    syncUI();
  }

  function updateTake(dt) {
    if (!take) return;
    if (!take.paused) {
      take.t += dt;
      if (take.audioDet !== null && audio.running()) {
        const drift = audio.now() - take.audioDet - take.t;
        if (Math.abs(drift) > 0.03 && Math.abs(drift) < 0.75) take.t += drift * 0.2;
      }
    }
    const t = take.t;
    if (t < 0) {
      const n = Math.ceil(-t - 1e-6);
      if (n !== take.count) {
        take.count = n;
        ui.leaderNum.textContent = String(n);
        numSpring.value = 1.45;
        numSpring.set(1);
      }
      const frac = 1 - (-t - (n - 1));
      ui.leaderSweep.style.setProperty('--sweep', (clamp01(frac) * 360).toFixed(1) + 'deg');
      sceneU.uMarker.value.w = clamp01(1 + t / COUNT);
    } else if (!take.detonated) {
      take.detonated = true;
      if (settings.crater && (take.def.craterK || 0) > 0.02) {
        const pl = take.def.pull;
        const opts = pl ? { pull: new THREE.Vector3(take.origin.x, take.origin.y + pl.y, take.origin.z), spread: pl.spread } : {};
        take.depth = terr().blast(take.origin.x, take.origin.z, take.def.craterK, 0, U.rng(take.seed ^ 0x9e3779b9), opts);
        saveCraters();
      }
      phase = 'running';
      ui.countdown.hidden = true;
      markerVis.set(0);
      sceneU.uMarker.value.w = 0;
      if (orbit.active) orbit.push = 0.18;
      syncUI();
    }

    stage.reset();
    if (take.missile) take.missile.update(t);
    if (t >= 0 && take.hits.length) applyHits(t);
    const f = take.fx.update(t);
    terr().updateBlocks(t);
    stage.dim = f.dim;
    stage.gain = settings.light;
    stage.apply();

    let flash = f.flash * Math.min(1.6, 0.4 + 0.6 * settings.light);
    if (settings.reduced) flash = Math.min(flash, 0.3);
    FU.uFlash.value = flash;
    if (flash > 0.001) {
      tmpV.copy(f.flashPos).project(camera);
      FU.uFlashPos.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
      FU.uFlashColor.value.copy(f.flashColor);
    }
    shakeAmp = settings.reduced ? 0 : f.shake;

    const dur = take.fx.duration;
    ui.timelineFill.style.transform = `scaleX(${clamp01((t + COUNT) / (dur + COUNT)).toFixed(4)})`;
    const tc = U.timecode(t);
    if (tc !== lastTc) {
      lastTc = tc;
      ui.timecode.textContent = tc;
    }
    if (t > dur) finishTake();
  }
  let lastTc = '';
  let shakeAmp = 0;

  const numSpring = new Spring(1, { onUpdate: (v) => { ui.leaderNum.style.transform = `scale(${v.toFixed(4)})`; } });

  // ------------------------------------------------------------ interface: estado dos botões e rótulos
  function syncUI() {
    const busy = phase === 'countdown' || phase === 'running';
    ui.btnStart.disabled = !point || busy;
    ui.btnPause.disabled = !busy;
    ui.btnRepeat.disabled = !lastTake;
    ui.btnClear.disabled = !(take || point || phase === 'done');
    ui.btnRandom.disabled = phase === 'countdown';
    const fxDef = B.EFFECTS.find((f) => f.id === settings.fx) || B.EFFECTS[0];
    let label;
    if (take && take.paused) label = 'Pausado';
    else if (phase === 'countdown') label = 'Contagem · ' + take.def.code;
    else if (phase === 'running') label = take.def.code + ' · ' + take.def.name;
    else if (phase === 'done') label = 'Tomada concluída';
    else label = point ? 'Pronto · ' + fxDef.code : 'Marque um ponto';
    ui.timelineLabel.textContent = label;
    const startLabel = ui.btnStart.querySelector('.btn-primary-label');
    startLabel.textContent = phase === 'done' ? 'Nova simulação' : 'Iniciar simulação';
  }

  // ------------------------------------------------------------ gaveta no celular
  function setSheet(open) {
    ui.rack.classList.toggle('is-collapsed', !open);
    ui.rackHandle.setAttribute('aria-expanded', open ? 'true' : 'false');
    requestAnimationFrame(() => placeIndicator(true));
  }
  ui.rackHandle.addEventListener('click', () => setSheet(ui.rack.classList.contains('is-collapsed')));
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const h = isMobileLayout() ? ui.rack.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty('--sheet-h', Math.round(h) + 'px');
      updateViewOffsetTarget(false);
    }).observe(ui.rack);
  }

  // ------------------------------------------------------------ ajustes e áudio
  function syncSettingsUI() {
    ui.optReduced.checked = settings.reduced;
    ui.optCinematic.checked = settings.cinematic;
    $('optCrater').checked = settings.crater;
    $('optMissile').checked = settings.missile;
    const lv = Math.round(settings.light * 100);
    $('optLight').value = String(lv);
    $('optLight').style.setProperty('--pct', ((lv - 50) / 2) + '%');
    $('optLightOut').textContent = lv + '%';
    bloomPass.strength = 0.6 * Math.pow(settings.light, 0.55);
    ui.volume.value = String(Math.round(settings.volume * 100));
    ui.volume.style.setProperty('--pct', Math.round(settings.volume * 100) + '%');
    ui.btnMute.setAttribute('aria-pressed', settings.muted ? 'true' : 'false');
    ui.btnMute.setAttribute('aria-label', settings.muted ? 'Ativar som' : 'Silenciar');
  }

  function applyQuality() {
    const red = settings.reduced;
    Q.particles = (isMobile ? 0.6 : 1) * (red ? 0.4 : 1);
    bloomPass.enabled = !red && !Q.autoNoBloom;
    FU.uGrain.value = red ? 0 : 0.02;
    FU.uCA.value = red ? 0 : 0.0045;
    ui.body.classList.toggle('low-glass', red || Q.lowGlass === true);
  }

  function closeSettings() {
    ui.settings.hidden = true;
    ui.btnSettings.setAttribute('aria-expanded', 'false');
  }
  ui.btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = ui.settings.hidden;
    ui.settings.hidden = !open;
    ui.btnSettings.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!ui.settings.hidden && !ui.settings.contains(e.target) && !ui.btnSettings.contains(e.target)) closeSettings();
  });
  ui.optReduced.addEventListener('change', () => {
    settings.reduced = ui.optReduced.checked;
    persist();
    applyQuality();
    toast(settings.reduced ? 'Efeitos reduzidos: menos partículas, sem clarões fortes ou tremores' : 'Efeitos completos ativados');
  });
  ui.optCinematic.addEventListener('change', () => {
    settings.cinematic = ui.optCinematic.checked;
    persist();
    if (!settings.cinematic) orbit.active = false;
  });
  ui.volume.addEventListener('input', () => {
    settings.volume = Number(ui.volume.value) / 100;
    ui.volume.style.setProperty('--pct', ui.volume.value + '%');
    if (settings.muted && settings.volume > 0) {
      settings.muted = false;
      audio.setMuted(false);
    }
    audio.setVolume(settings.volume);
    syncSettingsUI();
    persist();
  });
  function toggleMute() {
    settings.muted = !settings.muted;
    audio.unlock();
    audio.setMuted(settings.muted);
    syncSettingsUI();
    persist();
  }
  ui.btnMute.addEventListener('click', toggleMute);

  ui.btnStart.addEventListener('click', () => startTake(false));
  ui.btnRepeat.addEventListener('click', () => startTake(true));
  ui.btnClear.addEventListener('click', clearAll);
  ui.btnPause.addEventListener('click', togglePause);
  ui.btnRandom.addEventListener('click', () => {
    if (phase === 'countdown') return;
    audio.unlock();
    if (view === 'globe') {
      if (take) { toast('Espere a explosão terminar para marcar outro ponto no planeta'); return; }
      const d = new THREE.Vector3();
      for (let k = 0; k < 60; k++) {
        const z = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        d.set(Math.sqrt(1 - z * z) * Math.cos(a), z, Math.sqrt(1 - z * z) * Math.sin(a));
        if (planet.info(d).land && Math.abs(d.y) < 0.85) break;
      }
      orbit.active = false;
      setPlanetPoint(d);
      return;
    }
    const p = map.randomPoint(Math.random);
    setPoint(p.x, p.z, p.state);
  });

  // botão principal "magnético" (só com mouse)
  if (!coarse) {
    const mx = new Spring(0, { onUpdate: (v) => ui.btnStart.style.setProperty('--mx', v.toFixed(2) + 'px') });
    const my = new Spring(0, { onUpdate: (v) => ui.btnStart.style.setProperty('--my', v.toFixed(2) + 'px') });
    ui.btnStart.addEventListener('pointermove', (e) => {
      if (ui.btnStart.disabled) return;
      const r = ui.btnStart.getBoundingClientRect();
      mx.set((e.clientX - (r.left + r.width / 2)) * 0.1);
      my.set((e.clientY - (r.top + r.height / 2)) * 0.1);
    });
    ui.btnStart.addEventListener('pointerleave', () => { mx.set(0); my.set(0); });
  }

  // ------------------------------------------------------------ ponteiro: toque/clique marca ponto; mouse mostra o estado
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function groundAt(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -map.H;
    return ray.ray.intersectPlane(plane, hit);
  }

  let down = null;
  let multi = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.isPrimary) {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      multi = false;
    } else {
      multi = true;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!e.isPrimary || !down || multi || !map || !entered) { down = null; return; }
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const quick = performance.now() - down.t < 500;
    down = null;
    if (dx * dx + dy * dy > 64 || !quick) return;
    if (phase === 'countdown') {
      toast('Aguarde a contagem ou use Limpar para trocar o ponto');
      return;
    }
    if (view === 'globe') { planetClick(e.clientX, e.clientY); return; }
    if (!groundAt(e.clientX, e.clientY)) return;
    const s = map.pick(hit.x, hit.z);
    if (s < 0 && !nearMap(hit.x, hit.z)) {
      toast('Muito longe: escolha um ponto no Brasil ou no mar perto dele');
      audio.uiBlip('error');
      return;
    }
    setPoint(hit.x, hit.z, s);
  });

  const nearMap = (x, z) => x > map.minX - 8 * map.S && x < map.maxX + 8 * map.S && z > map.minZ - 8 * map.S && z < map.maxZ + 8 * map.S;

  let hover = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    hover = { x: e.clientX, y: e.clientY, buttons: e.buttons };
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    ui.tooltip.hidden = true;
    if (map) map.setHover(-1);
    if (planet) planet.setHover(-9);
  });
  let lastHoverState = -2;
  function updateHover() {
    if (!hover || !map || !entered) return;
    const h = hover;
    hover = null;
    if (h.buttons) {
      ui.tooltip.hidden = true;
      return;
    }
    if (view === 'globe') {
      const d = planetDirAt(h.x, h.y);
      const inf = d ? planet.info(d) : null;
      planet.setHover(inf && inf.land ? inf.id : -9);
      if (!inf) { ui.tooltip.hidden = true; return; }
      ui.tooltip.innerHTML = `<b>${esc(inf.code)}</b>${esc(inf.nome)}`;
      ui.tooltip.hidden = false;
      ui.tooltip.style.transform = `translate3d(${h.x + 16}px, ${h.y + 16}px, 0)`;
      return;
    }
    let s = -1;
    if (groundAt(h.x, h.y)) s = map.pick(hit.x, hit.z);
    map.setHover(s);
    if (s < 0) {
      ui.tooltip.hidden = true;
    } else {
      if (s !== lastHoverState) ui.tooltip.innerHTML = `<b>${map.states[s].uf}</b>${map.states[s].nome}`;
      ui.tooltip.hidden = false;
      ui.tooltip.style.transform = `translate3d(${h.x + 16}px, ${h.y + 16}px, 0)`;
    }
    lastHoverState = s;
  }

  // ------------------------------------------------------------ editor: "Criar meu efeito"
  const ed = {
    el: $('editor'), name: $('edName'), core: $('edCore'), mid: $('edMid'), smoke: $('edSmoke'),
    sliders: $('edSliders'), del: $('edDelete'), test: $('edTest'), save: $('edSave'), close: $('edClose'),
    title: $('editorTitle'), editingId: null, draft: null, draftFor: undefined, confirmDel: false,
  };
  const SLIDERS = [
    ['size', 'Tamanho'], ['fire', 'Fogo'], ['smokeAmt', 'Fumaça'], ['sparks', 'Faíscas'],
    ['wave', 'Onda de choque'], ['flash', 'Clarão'], ['shake', 'Tremor'], ['height', 'Altura'],
    ['power', 'Potência'],
  ];
  // a potência mostra o multiplicador fictício (×1 a ×1000) e o nome da faixa
  const sliderText = (key, v) => {
    if (key !== 'power') return String(v);
    return '×' + B.powerInfo(v / 100).m;
  };
  const sliderLabel = (key, label, v) => (key === 'power' ? `${label} · ${B.powerInfo(v / 100).nome}` : label);
  const MAX_CUSTOM = 12;
  const sliderEls = {};
  for (const [key, label] of SLIDERS) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    const id = 'ed-' + key;
    row.innerHTML = `<label for="${id}">${label}</label><input class="range" id="${id}" type="range" min="0" max="100" step="1"><output for="${id}"></output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const lab = row.querySelector('label');
    if (key === 'power') row.classList.add('slider-row--power');
    input.addEventListener('input', () => {
      out.textContent = sliderText(key, input.value);
      lab.textContent = sliderLabel(key, label, input.value);
      input.style.setProperty('--pct', input.value + '%');
    });
    sliderEls[key] = { input, out, lab, label };
    ed.sliders.appendChild(row);
  }
  function edRead() {
    const p = {
      id: ed.editingId || ('meu-' + Date.now().toString(36)),
      name: ed.name.value.trim().slice(0, 24) || 'Meu efeito',
      core: ed.core.value, mid: ed.mid.value, smoke: ed.smoke.value,
    };
    for (const [key] of SLIDERS) p[key] = Number(sliderEls[key].input.value) / 100;
    const snd = document.querySelector('input[name="edSound"]:checked');
    p.sound = snd ? snd.value : 'estrondo';
    return p;
  }
  function edFill(p) {
    ed.name.value = p.name;
    ed.core.value = p.core;
    ed.mid.value = p.mid;
    ed.smoke.value = p.smoke;
    for (const [key] of SLIDERS) {
      const v = Math.round((p[key] ?? B.CUSTOM_DEFAULTS[key] ?? 0.5) * 100);
      const el = sliderEls[key];
      el.input.value = v;
      el.out.textContent = sliderText(key, v);
      el.lab.textContent = sliderLabel(key, el.label, v);
      el.input.style.setProperty('--pct', v + '%');
    }
    const r = document.querySelector(`input[name="edSound"][value="${p.sound}"]`);
    if (r) r.checked = true;
  }
  function openEditor(id) {
    if (phase === 'countdown' || phase === 'running') { toast('Espere a tomada terminar para abrir o editor'); return; }
    closeSettings();
    const existing = id ? customParams.find((p) => p.id === id) : null;
    if (!existing && customParams.length >= MAX_CUSTOM) { toast(`Limite de ${MAX_CUSTOM} efeitos próprios. Apague um para criar outro.`); return; }
    ed.editingId = existing ? existing.id : null;
    let p;
    if (ed.draft && ed.draftFor === ed.editingId) p = ed.draft;
    else if (existing) p = existing;
    else p = Object.assign({}, B.CUSTOM_DEFAULTS, { name: 'Meu efeito ' + (customParams.length + 1) });
    edFill(p);
    ed.title.textContent = existing ? 'Editar meu efeito' : 'Criar meu efeito';
    ed.del.hidden = !existing;
    ed.confirmDel = false;
    ed.del.textContent = 'Apagar';
    ed.el.hidden = false;
    setTimeout(() => ed.name.focus({ preventScroll: true }), 60);
  }
  function closeEditor() {
    ed.el.hidden = true;
  }
  function edTest() {
    const p = edRead();
    ed.draft = p;
    ed.draftFor = ed.editingId;
    if (!point) {
      toast(`${coarse ? 'Toque' : 'Clique'} no mapa para marcar um ponto e teste de novo`);
      closeEditor();
      return;
    }
    const def = B.makeCustomEffect(Object.assign({}, p, { code: 'TESTE' }));
    def.draft = true;
    closeEditor();
    startTake(false, def);
  }
  function edSave() {
    const p = edRead();
    const i = customParams.findIndex((q) => q.id === p.id);
    if (i >= 0) customParams[i] = p; else customParams.push(p);
    customStore.write(customParams);
    syncCustomEffects();
    renderCards();
    ed.draft = null;
    ed.draftFor = undefined;
    closeEditor();
    selectFx(p.id, true);
    toast(`Efeito salvo: ${p.name}`);
  }
  function edDelete() {
    if (!ed.editingId) return;
    if (!ed.confirmDel) {
      ed.confirmDel = true;
      ed.del.textContent = 'Confirmar exclusão';
      return;
    }
    customParams = customParams.filter((q) => q.id !== ed.editingId);
    customStore.write(customParams);
    syncCustomEffects();
    renderCards();
    ed.draft = null;
    ed.draftFor = undefined;
    closeEditor();
    selectFx(B.EFFECTS.some((f) => f.id === settings.fx) ? settings.fx : B.EFFECTS[0].id, false);
    toast('Efeito apagado');
  }
  $('btnCreate').addEventListener('click', () => openEditor(null));
  $('btnEdit').addEventListener('click', () => openEditor(settings.fx));
  ed.close.addEventListener('click', closeEditor);
  ed.test.addEventListener('click', edTest);
  ed.save.addEventListener('click', edSave);
  ed.del.addEventListener('click', edDelete);
  ed.el.addEventListener('pointerdown', (e) => { if (e.target === ed.el) closeEditor(); });

  // ------------------------------------------------------------ globo
  const MAP_FOG = new THREE.Vector2();
  function planetOverview(dur = 1.2) {
    const halfV = (camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    flyTo(new THREE.Vector3(0, 0, 0), (planet.R * 1.12) / Math.sin(Math.min(halfV, halfH)), 1.15, null, dur);
  }
  function setView(v, quiet) {
    if (!planet) return;
    if (v === view) {
      if (v === 'globe' && !take) { orbit.active = false; planetOverview(); }
      return;
    }
    if (phase === 'countdown' || phase === 'running') { toast('Espere a tomada terminar para trocar a vista'); return; }
    view = v;
    const g = v === 'globe';
    $('viewMap').setAttribute('aria-pressed', String(!g));
    $('viewGlobe').setAttribute('aria-pressed', String(g));
    ui.body.classList.toggle('is-globe', g);
    map.setMapVisible(!g);
    planet.setVisible(g);
    map.clearDebris();
    planet.clearDebris();
    ui.tooltip.hidden = true;
    fly.active = false;
    if (point && point.kind !== (g ? 'planet' : 'map')) clearPoint();
    if (phase === 'done') phase = 'idle';
    if (g) {
      MAP_FOG.copy(sceneU.uFog.value);
      sceneU.uFog.value.set(planet.R * 6, planet.R * 12);
      controls.enablePan = false;
      controls.minDistance = 5;
      controls.maxDistance = planet.R * 6;
      controls.maxPolarAngle = Math.PI - 0.05;
      controls.zoomToCursor = false;
      if (point) {
        controls.target.set(0, planet.R + 1.5, 0);
      } else {
        controls.target.set(0, 0, 0);
        camera.position.set(0, planet.R * 1.2, planet.R * 4.5);
        planetOverview(quiet ? 0.6 : 1.4);
        orbit.active = true;
        orbit.speed = 0.04;
        orbit.push = 0;
      }
      if (!quiet) toast(`Gire o planeta e ${coarse ? 'toque' : 'clique'} em qualquer lugar (terra ou mar) para marcar o ponto`, 3800);
    } else {
      if (MAP_FOG.x > 0) sceneU.uFog.value.copy(MAP_FOG);
      controls.enablePan = true;
      controls.minDistance = 5;
      controls.maxPolarAngle = 1.3;
      controls.zoomToCursor = !coarse;
      controls.maxDistance = Math.max(95, fitRadius() * 1.2);
      orbit.active = false;
      controls.target.set(0, 0, 1.5);
      camera.position.setFromSpherical(new THREE.Spherical(fitRadius(), 0.3, 0)).add(controls.target);
      flyTo(new THREE.Vector3(0, 0, 1.5), fitRadius(), 0.74, 0, 1.2);
    }
    syncUI();
  }
  const pdir = new THREE.Vector3();
  function planetDirAt(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return planet.pickDir(ray.ray, pdir);
  }
  function planetClick(cx, cy) {
    const d = planetDirAt(cx, cy);
    if (!d) return;
    if (take) { toast('Espere a explosão terminar para marcar outro ponto no planeta'); return; }
    orbit.active = false;
    setPlanetPoint(d);
  }
  $('viewMap').addEventListener('click', () => setView('map'));
  $('viewGlobe').addEventListener('click', () => setView('globe'));
  $('optMissile').addEventListener('change', () => {
    settings.missile = $('optMissile').checked;
    persist();
  });
  $('optLight').addEventListener('input', () => {
    settings.light = Number($('optLight').value) / 100;
    persist();
    syncSettingsUI();
  });
  // resetar o mapa: pede um segundo clique (apaga o que ficou salvo), depois volta tudo ao original
  let resetArmed = -Infinity;
  const btnResetMap = $('btnResetMap');
  function resetMap(confirmed) {
    if (phase === 'countdown' || phase === 'running') { toast('Espere a tomada terminar para resetar o mapa'); return; }
    if (!confirmed && performance.now() - resetArmed > 3500) {
      resetArmed = performance.now();
      btnResetMap.classList.add('is-armed');
      setTimeout(() => { if (performance.now() - resetArmed >= 3400) btnResetMap.classList.remove('is-armed'); }, 3500);
      toast('Clique de novo para resetar: apaga todas as crateras, montanhas e fendas salvas', 3400);
      audio.uiBlip('select');
      return;
    }
    resetArmed = -Infinity;
    btnResetMap.classList.remove('is-armed');
    clearAll();
    clearCrater();
    phase = 'idle';
    if (view === 'globe') {
      setView('globe');
    } else {
      fly.active = false;
      flyTo(new THREE.Vector3(0, 0, 1.5), fitRadius(), 0.74, 0, 1.2);
    }
    syncUI();
    audio.uiBlip('point');
    toast('Mapa resetado: terreno de volta ao original');
  }
  btnResetMap.addEventListener('click', () => resetMap(false));
  $('btnResetCraters').addEventListener('click', () => resetMap(true));
  $('optCrater').addEventListener('change', () => {
    settings.crater = $('optCrater').checked;
    persist();
    if (!settings.crater) clearCrater();
  });

  // ------------------------------------------------------------ teclado
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tgt = e.target;
    const inText = tgt && (tgt.tagName === 'INPUT' && tgt.type !== 'range' && tgt.type !== 'checkbox');
    if (!ed.el.hidden) {
      if (e.key === 'Escape') closeEditor();
      return;
    }
    if (inText) return;
    if (!ui.intro.hidden) {
      if (e.key === 'Enter' && tgt !== ui.btnEnter) { e.preventDefault(); enterSet(); }
      return;
    }
    const onControl = tgt && (tgt.tagName === 'BUTTON' || tgt.tagName === 'INPUT');
    switch (e.key) {
      case ' ':
        if (onControl) return;
        e.preventDefault();
        togglePause();
        break;
      case 'Enter':
        if (onControl) return;
        e.preventDefault();
        if (!ui.btnStart.disabled) startTake(false);
        break;
      case 'g': case 'G':
        setView(view === 'globe' ? 'map' : 'globe');
        break;
      case 'r': case 'R':
        if (lastTake) startTake(true);
        break;
      case 'Backspace': case 'Delete':
        if (!ui.btnClear.disabled) { e.preventDefault(); clearAll(); }
        break;
      case 'm': case 'M':
        toggleMute();
        break;
      case 't': case 'T':
        resetMap(false);
        break;
      case 'Escape':
        closeSettings();
        break;
      default:
        if (/^[1-9]$/.test(e.key)) {
          const fx = B.EFFECTS[Number(e.key) - 1];
          if (fx) selectFx(fx.id, true);
        }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && take && !take.paused) {
      setPaused(true);
      syncUI();
      toast('Tomada pausada ao sair da aba');
    }
  });

  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  });

  // ------------------------------------------------------------ qualidade adaptativa
  const perf = { acc: 0, frames: 0, slow: 0, fast: 0 };
  function perfSample(dtRaw) {
    if (dtRaw > 0.25 || !entered || manual) return;
    perf.acc += dtRaw;
    perf.frames += 1;
    if (perf.acc < 1) return;
    const fps = perf.frames / perf.acc;
    perf.acc = 0;
    perf.frames = 0;
    if (fps < 45) { perf.slow += 1; perf.fast = 0; } else if (fps > 57) { perf.fast += 1; perf.slow = 0; } else { perf.slow = 0; perf.fast = 0; }
    if (perf.slow >= 2 && Q.dpr > Q.dprMin + 0.01) {
      Q.dpr = Math.max(Q.dprMin, Q.dpr - 0.2);
      perf.slow = 0;
      resize();
    } else if (perf.slow >= 3 && !take && bloomPass.enabled) {
      Q.autoNoBloom = true;
      Q.lowGlass = true;
      applyQuality();
      perf.slow = 0;
      toast('Qualidade ajustada para manter a animação fluida');
    }
    if (perf.fast >= 5 && Q.dpr < Q.dprMax - 0.01) {
      Q.dpr = Math.min(Q.dprMax, Q.dpr + 0.1);
      perf.fast = 0;
      resize();
    }
  }

  // ------------------------------------------------------------ laço principal
  let last = performance.now();
  const shakeEuler = new THREE.Euler();
  let manual = false;
  function frame(now) {
    requestAnimationFrame(frame);
    if (manual) { last = now; return; }
    tick(now);
  }
  function tick(now) {
    const dtRaw = (now - last) / 1000;
    last = now;
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    perfSample(dtRaw);
    Spring.tick(dt);
    clock += dt;
    sceneU.uTime.value = clock;
    FU.uTime.value = clock;

    updateCamera(dt);
    camera.updateMatrixWorld();
    if (take) {
      updateTake(dt);
    } else {
      FU.uFlash.value = 0;
      shakeAmp = 0;
    }

    if (shakeAmp > 0.001) {
      const a = shakeAmp * 0.011;
      const tt = clock * 1.0;
      shakeEuler.set(U.noise1(tt * 23) * a, U.noise1(tt * 19 + 7) * a, U.noise1(tt * 13 + 3) * a * 0.6);
      camera.rotation.x += shakeEuler.x;
      camera.rotation.y += shakeEuler.y;
      camera.rotation.z += shakeEuler.z;
      camera.updateMatrixWorld();
    }

    // marcador
    if (planet && view === 'globe') {
      planet.update(dt);
      if (point && point.kind === 'planet') {
        planet.worldPoint(point.dir, markerPos);
        beamDir.copy(markerPos).normalize();
      }
    } else {
      beamDir.copy(UP);
    }
    const mv = markerVis.value * (view === 'globe' ? planet.settled : 1);
    sceneU.uMarker.value.z = mv;
    const cd = sceneU.uMarker.value.w;
    tmpV.set(TEAL.r, TEAL.g, TEAL.b).lerp(tmpV2.set(TUNG.r, TUNG.g, TUNG.b), cd).multiplyScalar(2.2 + cd * 0.8);
    sceneU.uMarkerCol.value.copy(tmpV);
    if (markerVis.value > 0.01 && point) map.beam.set(markerPos, beamDir, 3.4, 0.07, 0.012, markerVis.value * (1.1 + 0.3 * Math.sin(clock * (3 + cd * 12))), tmpV);
    else map.beam.hide();

    map.setDim(sceneU.uDim.value);
    updateHover();
    composer.render(dt);
  }

  // ------------------------------------------------------------ abertura
  function enterSet() {
    if (entered) return;
    entered = true;
    audio.unlock();
    audio.setVolume(settings.volume);
    audio.setMuted(settings.muted);
    settings.reduced = ui.introReduced.checked;
    persist();
    applyQuality();
    syncSettingsUI();
    ui.intro.classList.add('is-leaving');
    setTimeout(() => { ui.intro.hidden = true; }, 520);
    orbit.active = false;
    flyTo(new THREE.Vector3(0, 0, 1.5), fitRadius(), 0.74, 0, 1.6);
    setTimeout(() => {
      if (!point) toast(`${coarse ? 'Toque' : 'Clique'} no mapa para marcar o ponto da cena`, 3600);
    }, 900);
    placeIndicator(true);
  }
  ui.btnEnter.addEventListener('click', enterSet);

  // cede a vez ao navegador (pinta o texto de carregamento) sem depender de requestAnimationFrame,
  // que fica parado em abas em segundo plano
  const nextFrame = () => new Promise((res) => setTimeout(res, 16));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  function warmUp() {
    // compila todos os shaders antes da primeira tomada para não travar no clímax
    const o = new THREE.Vector3(0, map.groundAt(0, 0), 0);
    const built = [];
    camera.updateMatrixWorld();
    for (const def of B.EFFECTS) {
      const root = new THREE.Group();
      scene.add(root);
      const fx = def.build({ root, origin: o, H: map.H, q: 0.15, reduced: false, r: U.rng(1), tex, stage, camera, audio, bus: null });
      fx.update(0.3);
      built.push({ fx, root });
    }
    if (planet) planet.setVisible(true);
    composer.render(0.016);
    if (planet) planet.setVisible(false);
    for (const b of built) {
      b.fx.dispose();
      b.root.removeFromParent();
    }
    stage.reset();
    stage.apply();
  }

  async function boot() {
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.race([
          Promise.all([
            document.fonts.load('700 64px "Big Shoulders Display"'),
            document.fonts.load('500 32px "JetBrains Mono"'),
          ]),
          sleep(2500),
        ]);
      }
    } catch (e) { /* segue com fontes do sistema */ }
    loadingText.textContent = 'Montando o mapa do Brasil…';
    await nextFrame();
    tex = B.makeTextures();
    sceneU = B.makeSceneUniforms();
    map = new B.BrazilMap(window.BRASIL_GEO, sceneU, { labelRes: isMobile ? 1024 : 2048, starCount: isMobile ? 800 : 1400, cell: isMobile ? 0.42 : 0.27, debris: isMobile ? 2200 : 7000 });
    scene.add(map.group);
    if (window.MUNDO_GEO && B.VoxelPlanet) {
      loadingText.textContent = 'Montando o planeta em blocos…';
      await nextFrame();
      planet = new B.VoxelPlanet(window.MUNDO_GEO, window.BRASIL_GEO, sceneU, isMobile ? { R: 60, n: 136, maskW: 2048, debris: 2200 } : { R: 70, n: 256, maskW: 4096, debris: 7000 });
      scene.add(planet.root);
    } else {
      document.querySelector('.viewswitch').hidden = true;
    }
    stage = new B.Stage(sceneU);
    const restored = loadCraters();
    if (restored) setTimeout(() => toast(`${restored} cratera${restored > 1 ? 's' : ''} salva${restored > 1 ? 's' : ''} recuperada${restored > 1 ? 's' : ''}`, 3000), 1600);
    resize();
    applyQuality();
    syncSettingsUI();
    selectFx(settings.fx, false);
    clearPoint();
    loadingText.textContent = 'Aquecendo os efeitos…';
    await nextFrame();
    try {
      warmUp();
    } catch (e) {
      console.error(e);
    }
    orbit.active = true;
    orbit.speed = 0.035;
    requestAnimationFrame((t) => { last = t; frame(t); });
    ui.introReduced.checked = settings.reduced;
    ui.intro.hidden = false;
    loadingEl.classList.add('is-done');
    setTimeout(() => ui.btnEnter.focus({ preventScroll: true }), 50);
    syncUI();
  }

  boot().catch((e) => {
    console.error(e);
    fail('Algo deu errado ao montar a cena 3D. Recarregue a página para tentar de novo.');
  });

  // acesso para depuração no console
  window.BRASIL_FX = {
    get phase() { return phase; },
    get take() { return take; },
    get quality() { return { ...Q, bloom: bloomPass.enabled }; },
    get map() { return map; },
    renderer, scene, camera, controls,
    /** avança n quadros manualmente (depuração com a aba oculta) */
    step(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) tick(last + dt * 1000);
    },
    /** congela o laço em tempo real para inspeção quadro a quadro */
    manual(on = true) { manual = on; },
    /** salta a tomada para o instante t (os efeitos são funções do tempo) */
    seek(t) {
      if (!take) return;
      take.audioDet = null;
      take.t = t;
      tick(last + 16);
    },
    enter: () => enterSet(),
    start: () => startTake(false),
    point: (lon, lat) => {
      const x = map.px(lon);
      const z = map.pz(lat);
      const s = map.pick(x, z);
      if (s >= 0) setPoint(x, z, s);
      return s;
    },
    fx: (id) => selectFx(id, false),
    view: (v) => setView(v),
    get planet() { return planet; },
    planetPoint: (lat, lon) => {
      if (view !== 'globe') setView('globe', true);
      setPlanetPoint(planet.dirLatLon(lat, lon));
      return planet.info(planet.dirLatLon(lat, lon));
    },
    editor: (id) => openEditor(id || null),
  };
})();
