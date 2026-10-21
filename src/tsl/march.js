// The march: for every pixel, a ray through the cloud layer. Empty space is skipped by the
// distance to the nearest tower, the lobe shell is crossed with coarse detail, and only inside
// the clouds is the full detail evaluated and lit: sun through the cloud (with per-channel
// absorption, so deep light goes red), sky from above, haze toward the sky colour with distance.
import * as THREE from 'three/webgpu';
import { Fn, If, Loop, Break, Continue, uv, float, vec2, vec3, vec4, normalize, mix, max, min, clamp, exp, log2, floor, smoothstep, select, fract, dot, screenCoordinate } from 'three/tsl';
import { CELL, TOP, BASE, SIGMA, MAX_OCT, heaps, lobes, puff, bumps, sunDepth, skyDepth, hg, fogged } from './clouds.js';
import { skyColour } from './sky.js';

const FOG = 0.025; // distance haze
const AMB = 0.8; // sky ambient scale
const MS = 0.25; // multiple-scattering scale
const SUNK = 2.2; // direct + scattered sun gain
const ABSORB = [0.02, 0.12, 0.3]; // absorption per channel, as a fraction of SIGMA: blue goes first
const STEPS = 500;

// interleaved gradient noise: a different start for every pixel, so the steps do not band
export const jitter = (px) => fract(fract(dot(px, vec2(0.06711056, 0.00583715))).mul(52.9829189));

export function marchMaterial(u) {
  const m = new THREE.NodeMaterial();
  m.depthTest = false;
  m.depthWrite = false;
  m.fragmentNode = Fn(() => {
    const q = uv();
    const aspect = u.res.x.div(u.res.y);
    const screen = vec2(q.x.sub(0.5).mul(aspect), float(0.5).sub(q.y));
    const L = normalize(u.sun).toVar();
    const ro = u.cam.toVar();
    const rd = normalize(u.right.mul(screen.x).add(u.up.mul(screen.y)).add(u.fw.mul(1.3))).toVar();

    // forward-scattering phase, with a little back-scatter: the silver lining
    const cosSun = dot(rd, L);
    const ph = mix(hg(cosSun, -0.2), hg(cosSun, 0.6), 0.3).toVar();
    const haze = skyColour(rd, L, u.sunCol, u.day).toVar();
    const sigT = vec3(...ABSORB.map((a) => SIGMA * (1 + a))); // extinction: grey scattering plus absorption
    const albedo = vec3(...ABSORB.map((a) => 1 / (1 + a))); // the share of extinction that scatters
    const tEnd = min(120.0, select(rd.y.greaterThan(0.0), float(TOP).sub(ro.y).div(rd.y), float(BASE).sub(ro.y).div(rd.y))).toVar();
    const t = float(0.0).toVar();
    If(ro.y.greaterThan(TOP), () => {
      t.assign(float(TOP).sub(ro.y).div(rd.y));
    });
    const T = vec3(1.0).toVar();
    const S = vec3(0.0).toVar();
    const jit = jitter(screenCoordinate.xy).toVar();
    const px = float(1.0).div(u.res.y.mul(1.3)).toVar(); // pixel footprint per unit of distance

    Loop(STEPS, () => {
      If(t.greaterThanEqual(tEnd).or(T.r.lessThanEqual(0.02)), () => {
        Break(); // red has the least extinction, so it is the last to go
      });
      const dt = t.mul(0.003).add(0.03).toVar(); // under SOFT out to the haze, so the ramp does not band
      const p = ro.add(rd.mul(t.add(jit.mul(dt)))).toVar();
      const hd = heaps(p).toVar();
      If(hd.greaterThan(2.0), () => {
        // no lobe of the 3x3 block can be near: skip by the tower distance, or to the next cell
        const f = p.xz.sub(floor(p.xz.div(CELL)).mul(CELL));
        const edge = min(min(f.x, float(CELL).sub(f.x)), min(f.y, float(CELL).sub(f.y)));
        t.addAssign(max(min(hd.sub(1.9), edge.add(CELL - 3.9)), dt));
        Continue();
      });
      // two octaves bound the distance cheaply while crossing the lobe shell
      const dc = lobes(p, hd, 2.0).sub(0.25).toVar();
      If(dc.greaterThan(0.0), () => {
        t.addAssign(max(dc.mul(0.5), dt));
        Continue();
      });
      // octaves from the footprint: keep the lobes that are at least two pixels across
      const lod = clamp(log2(float(0.6).div(px.mul(max(t, 0.1)))).div(1.07).add(1.0), 2.0, MAX_OCT).toVar();
      const d = lobes(p, hd, lod).toVar();
      If(d.greaterThan(0.45), () => {
        t.addAssign(max(d.sub(0.45).mul(0.5), dt)); // the billows push out by 0.3 at most
        Continue();
      });
      const foct = clamp(log2(float(0.33).div(px.mul(2.0).mul(max(t, 0.1)))).add(1.0), 1.0, 4.0);
      d.subAssign(bumps(p, foct, u.time));
      const dens = puff(d).toVar();
      If(dens.lessThanEqual(0.0), () => {
        t.addAssign(dt);
        Continue();
      });
      const od = sunDepth(p, L, lod, u.time).toVar();
      // direct sun with its phase, plus two softer multiple-scattering octaves
      const sun = exp(sigT.mul(od).negate()).mul(ph).add(exp(sigT.mul(od).mul(-0.25)).mul(0.5).add(exp(sigT.mul(od).mul(-0.06)).mul(0.25)).mul(MS).mul(mix(ph, 1.0, 0.6)));
      const hy = smoothstep(-4.0, 8.0, p.y);
      const amb = u.amb.mul(AMB).mul(hy.mul(0.25).add(0.1)).mul(exp(skyDepth(p).mul(-1.5)));
      const lum = mix(u.sunCol.mul(SUNK).mul(sun).add(amb), haze, fogged(t, FOG));
      const tr = exp(sigT.mul(dens).mul(dt).negate());
      S.addAssign(T.mul(albedo).mul(tr.oneMinus()).mul(lum));
      T.mulAssign(tr);
      t.addAssign(dt);
    });
    return vec4(S.add(T.mul(haze)), 1.0);
  })();
  return m;
}
