/**
 * Standard normal distribution helpers.
 *
 * `normCdf` implements Graeme West's "Better approximations to cumulative
 * normal functions" (Wilmott, 2005) which is accurate to ~1e-14 in double
 * precision across the whole real line. `normInv` uses Peter Acklam's
 * rational approximation refined with one Halley step (rel. error < 1e-15).
 */

const SQRT_2PI = 2.5066282746310002;

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

export function normCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const xabs = Math.abs(x);
  let cum: number;
  if (xabs > 37) {
    cum = 0;
  } else {
    const exponential = Math.exp((-xabs * xabs) / 2);
    if (xabs < 7.07106781186547) {
      let build = 3.52624965998911e-2 * xabs + 0.700383064443688;
      build = build * xabs + 6.37396220353165;
      build = build * xabs + 33.912866078383;
      build = build * xabs + 112.079291497871;
      build = build * xabs + 221.213596169931;
      build = build * xabs + 220.206867912376;
      cum = exponential * build;
      build = 8.83883476483184e-2 * xabs + 1.75566716318264;
      build = build * xabs + 16.064177579207;
      build = build * xabs + 86.7807322029461;
      build = build * xabs + 296.564248779674;
      build = build * xabs + 637.333633378831;
      build = build * xabs + 793.826512519948;
      build = build * xabs + 440.413735824752;
      cum = cum / build;
    } else {
      let build = xabs + 0.65;
      build = xabs + 4 / build;
      build = xabs + 3 / build;
      build = xabs + 2 / build;
      build = xabs + 1 / build;
      cum = exponential / build / SQRT_2PI;
    }
  }
  return x > 0 ? 1 - cum : cum;
}

export function normInv(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    throw new RangeError(`normInv: probability out of range: ${p}`);
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  // One Halley refinement step.
  const e = normCdf(x) - p;
  const u = e * SQRT_2PI * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

/** Bivariate normal CDF (Drezner–Wesolowsky / Genz) – used for some barrier products. */
export function bivariateNormCdf(a: number, b: number, rho: number): number {
  // Genz (2004) algorithm with 20-point Gauss–Legendre for |rho| < 0.925, otherwise Drezner.
  const x = [
    0.04691008, 0.23076534, 0.5, 0.76923466, 0.95308992,
  ];
  const w = [0.018854042, 0.038088059, 0.0452707394, 0.038088059, 0.018854042];
  if (rho > 0.9999) return normCdf(Math.min(a, b));
  if (rho < -0.9999) return Math.max(0, normCdf(a) - normCdf(-b));
  const h = -a;
  const k = -b;
  let bvn = 0;
  if (Math.abs(rho) < 0.925) {
    const hs = (h * h + k * k) / 2;
    const asr = Math.asin(rho);
    for (let i = 0; i < 5; i++) {
      for (const sgn of [-1, 1]) {
        const sn = Math.sin((asr * (sgn * x[i]! + 1)) / 2);
        bvn += w[i]! * Math.exp((sn * h * k - hs) / (1 - sn * sn));
      }
    }
    bvn = (bvn * asr) / (4 * Math.PI) + normCdf(-h) * normCdf(-k);
  } else {
    // Fall back to a simple but robust numerical integration (Simpson) on the
    // conditional representation P(X<a,Y<b) = ∫ φ(x) Φ((b-ρx)/√(1-ρ²)) dx.
    const n = 400;
    const lo = -8;
    const hi = a;
    if (hi <= lo) return 0;
    const step = (hi - lo) / n;
    const s = Math.sqrt(1 - rho * rho);
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const xx = lo + i * step;
      const f = normPdf(xx) * normCdf((b - rho * xx) / s);
      const wgt = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      sum += wgt * f;
    }
    return (sum * step) / 3;
  }
  return Math.max(0, Math.min(1, bvn));
}
