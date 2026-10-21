// The clouds: a field of cumulus towers, one per jittered cell, with cauliflower lobes grown
// out of their surface and fine billows on top; then the light inside them.
//
// Everything is a signed distance to the cloud surface, and density fades in over SOFT units
// inside it: translucent edges, thin enough that the small lumps stay crisp and shade each other.
import { Fn, If, Loop, Break, Continue, float, int, vec2, vec3, ivec2, ivec3, mat3, array, floor, clamp, smoothstep, min, max, abs, length, sin, cos, select, inverseSqrt, exp } from 'three/tsl';
import { hash33, gnoise, worley2, smin, iv3 } from './noise.js';

export const CELL = 4.0; // the field's cell size: one tower per cell at most
export const TOP = 10.5; // the volume's ceiling and floor, where the march starts and stops
export const BASE = -8.0;
export const SIGMA = 12.0; // extinction at full density
export const SOFT = 0.15; // depth over which density fades in below the surface
export const MAX_OCT = 3.0; // lobe octaves at most; the fine detail comes from the billows
export const BUMP = 0.9; // how far the billows push the surface in and out
// cap height / cap radius per lobe octave: soft big lobes, crisp medium ones, flat fine ones
const RELIEF = [1.0, 1.3, 1.0, 0.75, 0.6, 0.5];
// a rotation between octaves, so no two line up
const ROT = () => mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);

// Coarse shape: one tower per jittered 2D cell, wide at the base and narrowing upward, so
// neighbours merge into a bank with turrets. Rows by depth, as in a photograph: a clear
// corridor to fly through, a near row, a gap of haze, a taller middle row, a thinner far field.
export const heaps = Fn(
  ([p]) => {
    const cell = ivec2(floor(p.xz.div(CELL))).toVar();
    const d = float(1e3).toVar();
    Loop({ start: int(-1), end: int(1), condition: '<=' }, { start: int(-1), end: int(1), condition: '<=' }, ({ i: dz, j: dx }) => {
      const c = ivec3(cell.x.add(dx), int(0), cell.y.add(dz)).toVar();
      const h = hash33(c).toVar();
      const cz = c.z;
      const cover = select(cz.lessThan(int(2)), 0.0, select(cz.lessThan(int(5)), 0.45, select(cz.lessThan(int(7)), 0.08, select(cz.lessThan(int(11)), 0.4, 0.3))));
      If(h.z.greaterThanEqual(cover), () => {
        Continue();
      });
      const g = hash33(c.add(iv3(0, 1, 0))).toVar();
      const r = g.x.mul(0.16).add(0.24).mul(CELL).toVar();
      const top = select(cz.lessThan(int(5)), g.y.mul(2.0).add(1.5), select(cz.lessThan(int(11)), g.y.mul(3.0).add(4.5), g.y.mul(3.5).add(1.5))).toVar();
      const centre = vec2(c.xz).add(0.3).add(h.xy.mul(0.4)).mul(CELL);
      const q = p.sub(vec3(centre.x, 0.0, centre.y)).toVar();
      // a wobbling column from BASE up to the top: narrow at the rounded top, widening below
      const y = clamp(q.y, BASE, top).toVar();
      const wob = vec2(sin(y.mul(0.7).add(g.z.mul(6.28))), cos(y.mul(0.6).add(h.x.mul(6.28)))).mul(r.mul(0.35));
      const rad = r.mul(smoothstep(top.sub(6.0), top, y).oneMinus().mul(1.2).add(0.65));
      const tower = length(q.sub(vec3(wob.x, y, wob.y))).sub(rad).mul(0.7);
      d.assign(smin(d, tower, 0.2 * CELL));
    });
    return d;
  },
  { p: 'vec3', return: 'float' }
);

// Cauliflower lobes grown out of the tower surface: hemispherical caps around Worley feature
// points, octave by octave. The last octave fades in by `lod`, so detail never pops; each cap
// shrinks with how far the point already is outside the surface, so caps never float free.
export const lobes = Fn(
  ([p, d0, lod]) => {
    const relief = array(RELIEF);
    const q = vec3(p).toVar();
    const d = float(d0).toVar();
    const fr = float(0.5).toVar();
    const fine = smoothstep(-5.0, 3.0, p.y).mul(0.65).add(0.35).toVar(); // smoother, broader lower bodies
    Loop({ start: int(0), end: int(6) }, ({ i: o }) => {
      const wgt = clamp(lod.sub(float(o)), 0.0, 1.0).toVar();
      If(wgt.lessThanEqual(0.0), () => {
        Break();
      });
      const x = max(float(1.0).sub(worley2(q.mul(fr)).div(0.36)), 0.0).toVar();
      const h = float(0.6).div(fr).mul(relief.element(o)).mul(select(o.equal(int(0)), 1.0, fine)).mul(wgt).toVar();
      d.subAssign(h.mul(x).mul(inverseSqrt(x.add(0.04))).mul(clamp(float(1.0).sub(d.div(h.mul(1.5))), 0.0, 1.0)));
      q.assign(ROT().mul(q).add(3.1));
      fr.mulAssign(2.1);
    });
    return d;
  },
  { p: 'vec3', d0: 'float', lod: 'float', return: 'float' }
);

// towers plus lobes; far from any tower the lobes are not worth computing
export const cloud = Fn(
  ([p, lod]) => {
    const d = heaps(p).toVar();
    const out = float(0.0).toVar();
    If(d.greaterThan(2.0), () => {
      out.assign(d.sub(1.9));
    }).Else(() => {
      out.assign(lobes(p, d, lod));
    });
    return out;
  },
  { p: 'vec3', lod: 'float', return: 'float' }
);

// soft density from the distance to the lobed surface
export const puff = (d) => smoothstep(0.0, SOFT, d.negate());
// for lighting lookups, with a ramp of width w: coarse lookups use wide ramps so the light
// varies smoothly instead of printing sharp lobe rims into the shadows
export const puffL = (d, w) => smoothstep(float(w).mul(-0.3), w, d.negate());

// Billowed gradient noise (|n| octaves: rounded bumps, creases at the zero crossings) as an
// outward push of the surface. It drifts upward, so the fine detail boils.
export const bumps = Fn(
  ([p0, oct, time]) => {
    const p = p0.mul(3.0).add(vec3(0.0, time.mul(-0.1), 0.0)).toVar();
    const n = float(0.0).toVar();
    const a = float(1.0).toVar();
    Loop({ start: int(0), end: int(4) }, ({ i: o }) => {
      const w = clamp(oct.sub(float(o)), 0.0, 1.0).toVar();
      If(w.lessThanEqual(0.0), () => {
        Break();
      });
      n.addAssign(a.mul(w).mul(abs(gnoise(p))));
      p.assign(ROT().mul(p).mul(2.03));
      a.mulAssign(0.5);
    });
    return n.sub(0.28).mul(BUMP);
  },
  { p0: 'vec3', oct: 'float', time: 'float', return: 'float' }
);

// Optical depth toward the sun: a few growing steps. The first short ones look at full detail
// so lobes shadow each other; the long ones only need the big shapes.
export const sunDepth = Fn(
  ([p0, L, lod, time]) => {
    const p = vec3(p0).toVar();
    const od = float(0.0).toVar();
    const s = float(0.08).toVar();
    Loop({ start: int(0), end: int(6) }, ({ i: k }) => {
      p.addAssign(L.mul(s));
      const level = select(k.equal(int(0)), min(lod, 4.0), select(k.lessThan(int(3)), 2.0, 1.0));
      const d = cloud(p, level).toVar();
      If(k.lessThan(int(2)).and(d.lessThan(0.45)), () => {
        d.subAssign(bumps(p, 2.0, time)); // the fine lumps shade each other
      });
      od.addAssign(puffL(d, float(SOFT).mul(float(k).mul(2.0).add(1.0))).mul(s));
      s.mulAssign(1.6);
    });
    return od;
  },
  { p0: 'vec3', L: 'vec3', lod: 'float', time: 'float', return: 'float' }
);

// Optical depth straight up: how much sky the point can see. Coarse shape and a soft ramp,
// so overhangs give a broad gradient instead of a sharp silhouette.
export const skyDepth = Fn(
  ([p]) => {
    return puffL(cloud(p.add(vec3(0.0, 0.5, 0.0)), 2.0), 0.8).mul(0.6).add(puffL(cloud(p.add(vec3(0.0, 1.5, 0.0)), 1.0), 0.8));
  },
  { p: 'vec3', return: 'float' }
);

// Henyey-Greenstein phase, scaled so isotropic is 1
export const hg = (c, g) => float(1.0).sub(g * g).div(float(1.0 + g * g).sub(c.mul(2.0 * g)).pow(1.5));
export const fogged = (t, fog) => exp(max(t.sub(8.0), 0.0).mul(-fog)).oneMinus();
