// From the march's linear light to the screen: a hue-preserving shoulder on the brightest
// channel (so red highlights stay red instead of going yellow), sRGB, and a little dither.
// The shoulder rolls off toward PEAK times white, as it would on an HDR display; on this SDR
// canvas the top of it clips, which is what gives the sunlit faces their punch.
import * as THREE from 'three/webgpu';
import { Fn, uv, texture, float, vec3, vec4, max, exp, mix, pow, step, clamp, screenCoordinate } from 'three/tsl';
import { jitter } from './march.js';

const PEAK = 3.0;
const toSrgb = (c) => mix(c.mul(12.92), pow(c, vec3(1.0 / 2.4)).mul(1.055).sub(0.055), step(0.0031308, c));

export function finalMaterial(lightTexture, u) {
  const m = new THREE.NodeMaterial();
  m.depthTest = false;
  m.depthWrite = false;
  m.fragmentNode = Fn(() => {
    const l = texture(lightTexture, uv()).rgb;
    const brightest = max(max(l.r, l.g), max(l.b, 1e-6));
    const y = clamp(l.mul(exp(brightest.mul(u.exposure).div(-PEAK)).oneMinus().mul(PEAK).div(brightest)), 0.0, 1.0);
    const dither = jitter(screenCoordinate.xy).sub(0.5).div(255.0);
    return vec4(toSrgb(y).add(dither), 1.0);
  })();
  return m;
}
