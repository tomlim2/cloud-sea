// The sky, and what the sun looks like at a given height. The JavaScript side chooses the
// hour (the sun's height) and hands the shader the three colours that follow from it.
import { vec3, float, mix, smoothstep, max, dot, normalize, pow, exp } from 'three/tsl';

export const AZIMUTH = -Math.atan2(0.75, 1.0); // the sun sits this far left of straight ahead

// Rayleigh-like optical depth per channel, so low sun goes orange then red
const TAU = [0.04, 0.1, 0.23];

// how many zenith air masses a ray from the sun crosses at this elevation (Kasten & Young)
function airMass(deg) {
  const e = Math.max(deg, -1.5);
  return 1 / (Math.sin((e * Math.PI) / 180) + 0.50572 * Math.pow(e + 6.08, -1.6364));
}

// the sun's direction, colour and the sky's ambient light for a sun `deg` above the horizon
export function hour(deg) {
  const e = (deg * Math.PI) / 180;
  const dir = [Math.sin(AZIMUTH) * Math.cos(e), Math.sin(e), Math.cos(AZIMUTH) * Math.cos(e)];
  const am = Math.min(airMass(deg) * 0.76, 30); // scaled so a sun one degree up crosses about 20 air masses
  const sun = TAU.map((t) => 2.2 * Math.exp(-t * am));
  // the higher the sun, the brighter and paler the sky light on the shadowed sides
  const day = Math.min(Math.max((deg - 1) / 14, 0), 1);
  const amb = [0.25 + 0.3 * day, 0.38 + 0.3 * day, 0.85 + 0.1 * day];
  return { dir, sun, amb, day };
}

// Sky in linear light: blue, deep at the zenith and paler at the horizon; a warm band hugging
// the horizon on the sun's side; purple-grey haze below the horizon; the glow round the sun.
// `day` (0 sunset .. 1 high sun) pales the blue and takes the warm band away.
export function skyColour(rd, L, sunCol, day) {
  const c = max(dot(rd, L), 0.0);
  const zenith = mix(vec3(0.08, 0.16, 0.45), vec3(0.16, 0.3, 0.68), day);
  const horizon = mix(vec3(0.38, 0.5, 0.8), vec3(0.62, 0.72, 0.9), day);
  const col = mix(horizon, zenith, smoothstep(0.0, 0.5, rd.y)).toVar();
  const side = max(dot(normalize(rd.xz.add(1e-6)), normalize(L.xz)), 0.0);
  const warm = side.mul(side).mul(exp(max(rd.y, 0.0).mul(-8.0))).mul(float(1.0).sub(day).mul(0.85).add(0.15));
  col.assign(mix(col, mix(vec3(1.0, 0.4, 0.15), vec3(0.95, 0.82, 0.66), day), warm));
  col.assign(mix(mix(vec3(0.26, 0.26, 0.42), vec3(0.5, 0.52, 0.62), day), col, smoothstep(-0.2, 0.0, rd.y)));
  return col.add(sunCol.mul(pow(c, 4.0).mul(0.5).add(pow(c, 48.0).mul(2.5))));
}
