// The scene and its frame loop: a flight along a field of cumulus while the sun goes up and
// comes back down.
//
// Each frame:
//   1. the march, at a modest size (the clouds are soft; the cost is in the steps, not the pixels)
//   2. the step to the screen: tonemap, sRGB, dither
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { marchMaterial } from './tsl/march.js';
import { finalMaterial } from './tsl/post.js';
import { hour } from './tsl/sky.js';

export const DAY = 150; // seconds for the sun to rise and set again
export const LOWEST = -2; // the sun's height in degrees at the turn of the cycle: just set
export const HIGHEST = 16; // late afternoon at the top of the cycle: the gold stays
// the cycle starts a little past its lowest point: the sun a degree up, as the reference has it
export const SUNSET = (Math.acos(1 - (2 * (1 - LOWEST)) / (HIGHEST - LOWEST)) / (2 * Math.PI)) * DAY;

async function makeRenderer(canvas, forceWebGL) {
  const make = (gl) => new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', forceWebGL: gl });
  let renderer = make(forceWebGL);
  try {
    await renderer.init();
    return renderer;
  } catch (e) {
    console.warn('cloud-sea: the renderer did not start', e);
    if (forceWebGL) return null;
  }
  renderer.dispose();
  renderer = make(true);
  try {
    await renderer.init();
    return renderer;
  } catch (e) {
    console.warn('cloud-sea: WebGL 2 did not start either', e);
    renderer.dispose();
    return null;
  }
}

export async function createScene(host, hooks = {}) {
  const { onFail, forceWebGL = false } = hooks;
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  host.appendChild(canvas);
  const renderer = await makeRenderer(canvas, forceWebGL);
  if (!renderer) {
    canvas.remove();
    onFail?.();
    return null;
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the last pass writes display values itself
  renderer.toneMapping = THREE.NoToneMapping;

  /* ---------------------------------------------------------------- uniforms */
  const u = {
    time: uniform(0),
    res: uniform(new THREE.Vector2(1, 1)),
    cam: uniform(new THREE.Vector3(0, 6, 0)),
    right: uniform(new THREE.Vector3(1, 0, 0)),
    up: uniform(new THREE.Vector3(0, 1, 0)),
    fw: uniform(new THREE.Vector3(0, 0, 1)),
    sun: uniform(new THREE.Vector3(0, 0, 1)),
    sunCol: uniform(new THREE.Vector3(1, 0.3, 0.02)),
    amb: uniform(new THREE.Vector3(0.25, 0.38, 0.85)),
    day: uniform(0),
    exposure: uniform(1.0),
  };

  /* ---------------------------------------------------------------- passes */
  const lightRT = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const quad = new THREE.QuadMesh();
  const march = marchMaterial(u);
  const final = finalMaterial(lightRT.texture, u);
  const pass = (material, target) => {
    renderer.setRenderTarget(target);
    quad.material = material;
    quad.render(renderer);
  };

  /* ---------------------------------------------------------------- size */
  // The march runs at about 480 rows, as the reference does, scaled up or down by `quality`,
  // which follows the frame time: a phone marches fewer pixels, a desktop GPU more.
  const quality = { value: coarse ? 0.75 : 1.0, min: 0.45, max: coarse ? 1.0 : 1.5 };
  const ROWS = 480;
  const buffer = new THREE.Vector2();
  function fit() {
    renderer.getDrawingBufferSize(buffer);
    const h = Math.min(Math.round(ROWS * quality.value), buffer.y) || 1;
    const w = Math.max(1, Math.round((h * buffer.x) / buffer.y));
    if (lightRT.width !== w || lightRT.height !== h) {
      lightRT.setSize(w, h);
      u.res.value.set(w, h);
    }
  }
  function resize() {
    renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
    fit();
  }
  const watcher = new ResizeObserver(resize);
  watcher.observe(host);
  resize();

  /* ---------------------------------------------------------------- the look */
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onMove = (e) => {
    const b = host.getBoundingClientRect();
    pointer.x = ((e.clientX - b.left) / b.width) * 2 - 1;
    pointer.y = ((e.clientY - b.top) / b.height) * 2 - 1;
    hooks.onLook?.();
  };
  window.addEventListener('pointermove', onMove);

  const look = { yaw: 0, pitch: -0.12 };
  function aim() {
    // the pointer turns the head a little: a glance left and right, up and down
    const yaw = pointer.sx * 0.42 + look.yaw;
    const pitch = look.pitch - pointer.sy * 0.14;
    const cp = Math.cos(pitch);
    u.fw.value.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    u.right.value.set(Math.cos(yaw), 0, -Math.sin(yaw));
    u.up.value.crossVectors(u.fw.value, u.right.value).normalize();
  }

  /* ---------------------------------------------------------------- a frame */
  let raf = 0;
  let before = 0;
  let t = 0;
  let frozen = false;
  let timeScale = 1;
  const cost = { sum: 0, n: 0 };
  function tick(dt) {
    t += dt * timeScale;
    u.time.value = t;
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-2.5 * dt));
    pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-2.5 * dt));
    aim();
    u.cam.value.set(t * 0.8, 6.0, 0.0);
    // the hour: the sun climbs from just below the horizon and sets again over one cycle
    const deg = LOWEST + (HIGHEST - LOWEST) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (t + SUNSET)) / DAY));
    const h = hour(deg);
    u.sun.value.fromArray(h.dir);
    u.sunCol.value.fromArray(h.sun);
    u.amb.value.fromArray(h.amb);
    u.day.value = h.day;
    // a camera's exposure: the brighter the sun, the shorter; the clouds stay cloud-white, the sky deepens
    u.exposure.value = Math.min(Math.max(0.95 / Math.max(...h.sun), 0.5), 1.2);
    pass(march, lightRT);
    pass(final, null);
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = before ? Math.min((now - before) / 1000, 0.05) : 1 / 60;
    // the frame time steers the march's size: slower than 30 fps, fewer rows; faster than 70, more
    if (before) {
      cost.sum += now - before;
      cost.n++;
      if (cost.n >= 40) {
        const avg = cost.sum / cost.n;
        if (avg > 33 && quality.value > quality.min) quality.value = Math.max(quality.min, quality.value * 0.8);
        else if (avg < 14 && quality.value < quality.max) quality.value = Math.min(quality.max, quality.value * 1.15);
        fit();
        cost.sum = cost.n = 0;
      }
    }
    before = now;
    if (!frozen) tick(dt);
  }
  tick(0);
  raf = requestAnimationFrame(loop);

  return {
    debug: {
      renderer,
      backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl',
      quad,
      march,
      uniforms: u,
      quality,
      look,
      get time() {
        return t;
      },
      set time(v) {
        t = v;
      },
      set speed(v) {
        timeScale = v;
      },
      run(seconds, step = 1 / 60) {
        frozen = true;
        for (let s = 0; s < seconds; s += step) tick(step);
      },
      resume() {
        frozen = false;
      },
    },
    dispose() {
      cancelAnimationFrame(raf);
      watcher.disconnect();
      window.removeEventListener('pointermove', onMove);
      lightRT.dispose();
      march.dispose();
      final.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
