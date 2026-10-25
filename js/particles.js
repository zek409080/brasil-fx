/* Sistema de partículas na GPU.
   Cada partícula tem posição, velocidade, atraso, vida, arrasto e aceleração vertical.
   A posição em qualquer instante é calculada de forma analítica no vertex shader
   (movimento com arrasto + gravidade/empuxo), então a CPU não faz nada por quadro:
   pausar é congelar um uniform, e "repetir" produz exatamente a mesma tomada. */
(function () {
  'use strict';
  const B = (window.BFX = window.BFX || {});
  if (!window.THREE) return;
  const THREE = window.THREE;

  const VERT = /* glsl */ `
    uniform float uTime;
    uniform vec2 uTurb;
    uniform float uSwirl;
    uniform vec3 uOrigin;
    uniform float uSizeEase;
    uniform float uStretch;
    attribute vec3 aPos;
    attribute vec3 aVel;
    attribute vec4 aTime;   // atraso, vida, arrasto, aceleração vertical
    attribute vec4 aSize;   // tamanho inicial, final, rotação, giro
    attribute vec4 aColor;  // tinta rgb, semente
    varying vec2 vUv;
    varying float vAge;
    varying vec4 vColor;
    varying vec3 vWorld;

    void main() {
      float t = uTime - aTime.x;
      float age = t / aTime.y;
      vUv = uv;
      vColor = aColor;
      vAge = age;
      vWorld = vec3(0.0, -1000.0, 0.0);
      if (t < 0.0 || age >= 1.0) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
      }
      float k = max(aTime.z, 0.001);
      float e = exp(-k * t);
      vec3 term = vec3(0.0, aTime.w / k, 0.0);
      vec3 vel = (aVel - term) * e + term;
      vec3 p = aPos + term * t + (aVel - term) * (1.0 - e) / k;
      float seed = aColor.w;
      if (uSwirl != 0.0) {
        vec2 rel = p.xz - uOrigin.xz;
        float ang = uSwirl * (1.0 - exp(-1.2 * t)) * (0.5 + seed);
        float cs = cos(ang);
        float sn = sin(ang);
        p.xz = uOrigin.xz + vec2(cs * rel.x - sn * rel.y, sn * rel.x + cs * rel.y);
      }
      if (uTurb.x > 0.0) {
        float ph = seed * 6.2831;
        p += uTurb.x * age * vec3(
          sin(uTurb.y * t + ph),
          0.4 * sin(uTurb.y * 0.73 * t + ph * 1.7),
          cos(uTurb.y * 0.87 * t + ph * 1.3));
      }
      float size = mix(aSize.x, aSize.y, 1.0 - pow(1.0 - clamp(age, 0.0, 1.0), uSizeEase));
      vec4 mv = viewMatrix * vec4(p, 1.0);
    #ifdef STREAK
      vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
      float sp = length(vv.xy);
      vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
      // (dir.y, -dir.x) mantém a base (perp, dir) com determinante +1: o quad continua
      // voltado para a câmera e não é descartado pelo culling de faces traseiras
      vec2 perp = vec2(dir.y, -dir.x);
      float len = size * 2.0 + sp * uStretch;
      mv.xy += dir * (position.y - 0.5) * len + perp * position.x * size;
      vWorld = p;
    #else
      float rot = aSize.z + aSize.w * t;
      float cs2 = cos(rot);
      float sn2 = sin(rot);
      vec2 c = vec2(cs2 * position.x - sn2 * position.y, sn2 * position.x + cs2 * position.y) * size;
      mv.xy += c;
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vWorld = p + right * c.x + up * c.y;
    #endif
      gl_Position = projectionMatrix * mv;
    }
  `;

  const FRAG = /* glsl */ `
    uniform sampler2D uMap;
    uniform vec3 uC0;
    uniform vec3 uC1;
    uniform vec3 uC2;
    uniform vec3 uC3;
    uniform vec3 uC4;
    uniform vec3 uStops;
    uniform vec4 uAlpha;   // fim do fade-in, início do fade-out, alfa máximo, cintilação
    uniform vec3 uOcc;     // oclusão: início, fim, máximo (0 = luz aditiva, 1 = fumaça que cobre)
    uniform float uColorMix;
    uniform float uOpacity;
    uniform vec3 uLitPos;
    uniform vec3 uLitCol;
    uniform float uLit;
    uniform vec2 uGround;  // altura do chão, faixa de suavização
    uniform float uClock;
    varying vec2 vUv;
    varying float vAge;
    varying vec4 vColor;
    varying vec3 vWorld;

    vec3 ramp(float x) {
      if (x < uStops.x) return mix(uC0, uC1, x / uStops.x);
      if (x < uStops.y) return mix(uC1, uC2, (x - uStops.x) / (uStops.y - uStops.x));
      if (x < uStops.z) return mix(uC2, uC3, (x - uStops.y) / (uStops.z - uStops.y));
      return mix(uC3, uC4, (x - uStops.z) / max(1.0 - uStops.z, 1e-4));
    }

    void main() {
      float age = clamp(vAge, 0.0, 1.0);
      vec2 uv = vUv;
    #ifdef ATLAS
      float cell = floor(vColor.w * 3.999);
      uv = (uv + vec2(mod(cell, 2.0), floor(cell / 2.0))) * 0.5;
    #endif
      vec4 tex = texture2D(uMap, uv);
      vec3 col = ramp(age) * mix(vec3(1.0), vColor.rgb, uColorMix);
      float a = smoothstep(0.0, uAlpha.x, age) * (1.0 - smoothstep(uAlpha.y, 1.0, age)) * uAlpha.z;
      if (uAlpha.w > 0.0) {
        a *= 1.0 - uAlpha.w * (0.5 + 0.5 * sin(uClock * (9.0 + 23.0 * vColor.w) + vColor.w * 61.0));
      }
      a *= smoothstep(uGround.x, uGround.x + uGround.y, vWorld.y);
      if (uLit > 0.0) {
        vec3 d = vWorld - uLitPos;
        col += uLitCol * (uLit / (1.0 + dot(d, d) * 0.4));
      }
      float alpha = tex.a * a * uOpacity;
      float occ = smoothstep(uOcc.x, uOcc.y, age) * uOcc.z;
      gl_FragColor = vec4(col * tex.rgb * alpha, alpha * occ);
    }
  `;

  const v3 = (a) => (a && a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

  class Particles {
    /**
     * opts: count, texture, spawn(i, p, n), origin, rng, t0 (início em tempo de simulação),
     * colors[5], stops[3], alpha[4], occ[3], streak, stretch, atlas, sizeEase, turb[2], swirl,
     * colorMix, lit, ground[2], order, opacity
     */
    constructor(o) {
      const n = Math.max(1, Math.round(o.count));
      this.count = n;
      this.t0 = o.t0 || 0;
      const aPos = new Float32Array(n * 3);
      const aVel = new Float32Array(n * 3);
      const aTime = new Float32Array(n * 4);
      const aSize = new Float32Array(n * 4);
      const aColor = new Float32Array(n * 4);
      const rnd = o.rng || Math.random;
      const org = o.origin || new THREE.Vector3();
      const p = {};
      let maxEnd = 0;
      for (let i = 0; i < n; i++) {
        p.x = org.x; p.y = org.y; p.z = org.z;
        p.vx = 0; p.vy = 0; p.vz = 0;
        p.delay = 0; p.life = 1; p.drag = 1; p.ay = 0;
        p.s0 = 0.2; p.s1 = 0.2; p.rot = 0; p.spin = 0;
        p.r = 1; p.g = 1; p.b = 1; p.seed = rnd();
        o.spawn(i, p, n);
        aPos[i * 3] = p.x; aPos[i * 3 + 1] = p.y; aPos[i * 3 + 2] = p.z;
        aVel[i * 3] = p.vx; aVel[i * 3 + 1] = p.vy; aVel[i * 3 + 2] = p.vz;
        aTime[i * 4] = p.delay; aTime[i * 4 + 1] = Math.max(p.life, 0.02); aTime[i * 4 + 2] = p.drag; aTime[i * 4 + 3] = p.ay;
        aSize[i * 4] = p.s0; aSize[i * 4 + 1] = p.s1; aSize[i * 4 + 2] = p.rot; aSize[i * 4 + 3] = p.spin;
        aColor[i * 4] = p.r; aColor[i * 4 + 1] = p.g; aColor[i * 4 + 2] = p.b; aColor[i * 4 + 3] = p.seed;
        maxEnd = Math.max(maxEnd, p.delay + p.life);
      }
      this.end = this.t0 + maxEnd;

      const base = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('uv', base.getAttribute('uv'));
      geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
      geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(aVel, 3));
      geo.setAttribute('aTime', new THREE.InstancedBufferAttribute(aTime, 4));
      geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 4));
      geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 4));
      geo.instanceCount = n;

      const cols = (o.colors || [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]).map(v3);
      const stops = o.stops || [0.25, 0.5, 0.75];
      const al = o.alpha || [0.1, 0.7, 1, 0];
      const oc = o.occ || [0, 1, 0];
      const g = o.ground || [-100, 0.001];
      this.u = {
        uTime: { value: 0 },
        uClock: { value: 0 },
        uTurb: { value: new THREE.Vector2(o.turb ? o.turb[0] : 0, o.turb ? o.turb[1] : 1) },
        uSwirl: { value: o.swirl || 0 },
        uOrigin: { value: org.clone() },
        uSizeEase: { value: o.sizeEase || 1.5 },
        uStretch: { value: o.stretch || 0 },
        uMap: { value: o.texture },
        uC0: { value: cols[0] }, uC1: { value: cols[1] }, uC2: { value: cols[2] }, uC3: { value: cols[3] }, uC4: { value: cols[4] },
        uStops: { value: new THREE.Vector3(Math.max(stops[0], 1e-3), Math.max(stops[1], stops[0] + 1e-3), Math.max(stops[2], stops[1] + 1e-3)) },
        uAlpha: { value: new THREE.Vector4(Math.max(al[0], 1e-3), Math.min(al[1], 0.999), al[2], al[3] || 0) },
        uOcc: { value: new THREE.Vector3(oc[0], Math.max(oc[1], oc[0] + 1e-3), oc[2]) },
        uColorMix: { value: o.colorMix || 0 },
        uOpacity: { value: o.opacity ?? 1 },
        uLitPos: { value: new THREE.Vector3() },
        uLitCol: { value: new THREE.Vector3() },
        uLit: { value: o.lit || 0 },
        uGround: { value: new THREE.Vector2(g[0], Math.max(g[1], 1e-3)) },
      };
      const defines = {};
      if (o.streak) defines.STREAK = '';
      if (o.atlas) defines.ATLAS = '';
      this.material = new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = o.order || 10;
      this.litGain = o.lit || 0;
    }

    /** Ilumina a fumaça por dentro com a luz da explosão. */
    light(pos, colTimesIntensity) {
      this.u.uLitPos.value.copy(pos);
      this.u.uLitCol.value.copy(colTimesIntensity);
    }

    update(t) {
      this.u.uTime.value = t - this.t0;
      this.u.uClock.value = t;
      this.mesh.visible = t >= this.t0 - 0.02 && t <= this.end + 0.02;
    }

    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  B.Particles = Particles;
})();
