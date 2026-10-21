// Integer-cell hashing and the two noises the clouds are built from. Each is a real shader
// function (a Fn with a layout), since the march calls them thousands of times per pixel.
import { Fn, Loop, float, int, uint, vec3, uvec3, ivec3, floor, fract, mix, dot, min, max, abs, step } from 'three/tsl';

export const iv3 = (x, y, z) => ivec3(int(x), int(y), int(z));

// three hashes from an integer cell: PCG3D (Jarzynski & Olano 2020), one round
export const hash33 = Fn(
  ([c]) => {
    const v = uvec3(c).mul(uint(1664525)).add(uint(1013904223)).toVar();
    const x = v.x.add(v.y.mul(v.z)).toVar();
    const y = v.y.add(v.z.mul(x)).toVar();
    const z = v.z.add(x.mul(y)).toVar();
    v.assign(uvec3(x, y, z));
    v.assign(v.bitXor(v.shiftRight(uvec3(uint(16), uint(16), uint(16))))); // WGSL shifts vectors by vectors
    const x2 = v.x.add(v.y.mul(v.z)).toVar();
    const y2 = v.y.add(v.z.mul(x2)).toVar();
    const z2 = v.z.add(x2.mul(y2)).toVar();
    return vec3(uvec3(x2, y2, z2).shiftRight(uvec3(uint(8), uint(8), uint(8)))).div(16777215.0);
  },
  { c: 'ivec3', return: 'vec3' }
);

const grad = Fn(([c, r]) => dot(hash33(c).mul(2.0).sub(1.0), r), { c: 'ivec3', r: 'vec3', return: 'float' });

// gradient noise, about -1..1, with a quintic fade
export const gnoise = Fn(
  ([p]) => {
    const i = ivec3(floor(p)).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
    const g = (x, y, z) => grad(i.add(iv3(x, y, z)), f.sub(vec3(x, y, z)));
    return mix(
      mix(mix(g(0, 0, 0), g(1, 0, 0), u.x), mix(g(0, 1, 0), g(1, 1, 0), u.x), u.y),
      mix(mix(g(0, 0, 1), g(1, 0, 1), u.x), mix(g(0, 1, 1), g(1, 1, 1), u.x), u.y),
      u.z
    );
  },
  { p: 'vec3', return: 'float' }
);

// Squared distance to the nearest jittered feature point (Worley F1^2). Feature points sit in
// 0.15..0.85 of their cell, so only this cell and the nearer neighbour on each axis can hold
// the nearest one as long as it is within 0.6: eight cells, not twenty-seven.
export const worley2 = Fn(
  ([p]) => {
    const cell = ivec3(floor(p)).toVar();
    const f = fract(p).toVar();
    const n = ivec3(step(0.5, f)).mul(int(2)).sub(int(1)).toVar();
    const m = float(9.0).toVar();
    Loop({ start: int(0), end: int(8) }, ({ i: k }) => {
      const o = ivec3(k.bitAnd(int(1)), k.shiftRight(int(1)).bitAnd(int(1)), k.shiftRight(int(2))).mul(n);
      const r = vec3(o).add(0.15).add(hash33(cell.add(o)).mul(0.7)).sub(f);
      m.assign(min(m, dot(r, r)));
    });
    return m;
  },
  { p: 'vec3', return: 'float' }
);

// a smooth minimum, so towers merge into banks
export const smin = (a, b, k) => {
  const h = max(float(k).sub(abs(a.sub(b))), 0.0).div(k);
  return min(a, b).sub(h.mul(h).mul(k).mul(0.25));
};
