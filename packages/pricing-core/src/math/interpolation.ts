export type InterpolationMethod =
  | "linear"
  | "logLinear"
  | "linearZero"
  | "cubicSplineZero"
  | "flatForward"
  /** Monotone convex (Hagan–West 2006) on the instantaneous forwards. */
  | "monotoneConvex";

/**
 * Interpolation methods whose result between two pillars depends on pillars
 * further away (splines, monotone convex). A sequential bootstrap needs a few
 * global re-solve sweeps for these so every instrument reprices on the final
 * curve.
 */
export function isNonLocalInterpolation(m: InterpolationMethod): boolean {
  return m === "cubicSplineZero" || m === "monotoneConvex";
}

// ---------------------------------------------------------------------------
// Monotone convex (Hagan & West, "Interpolation Methods for Curve
// Construction", Applied Mathematical Finance 2006; "Methods for Constructing a
// Yield Curve", Wilmott 2008)
// ---------------------------------------------------------------------------

export interface MonotoneConvexCoefficients {
  /** Discrete forwards f^d_i of the intervals (t_{i-1}, t_i], index i = 1..n (index 0 unused). */
  fd: number[];
  /** Instantaneous forwards at the nodes t_0..t_n. */
  f: number[];
}

/**
 * Node forwards of the monotone convex scheme from times `xs` (t_0 may be 0)
 * and continuously compounded zero rates `zs` (r(t)·t = −ln DF(t)).
 * Positivity of the forwards is enforced (the "ameliorated" bounds of Hagan–
 * West) when every discrete forward is positive; with negative rates the
 * unconstrained estimates are kept.
 */
export function monotoneConvexCoefficients(xs: readonly number[], zs: readonly number[]): MonotoneConvexCoefficients {
  const n = xs.length - 1;
  const fd = new Array<number>(n + 1).fill(0);
  const f = new Array<number>(n + 1).fill(0);
  if (n < 1) return { fd, f };
  const rt = (i: number) => zs[i]! * xs[i]!;
  for (let i = 1; i <= n; i++) fd[i] = (rt(i) - rt(i - 1)) / (xs[i]! - xs[i - 1]!);
  if (n === 1) {
    f[0] = fd[1]!;
    f[1] = fd[1]!;
    return { fd, f };
  }
  for (let i = 1; i < n; i++) {
    const h0 = xs[i]! - xs[i - 1]!;
    const h1 = xs[i + 1]! - xs[i]!;
    f[i] = (h0 / (h0 + h1)) * fd[i + 1]! + (h1 / (h0 + h1)) * fd[i]!;
  }
  f[0] = fd[1]! - 0.5 * (f[1]! - fd[1]!);
  f[n] = fd[n]! - 0.5 * (f[n - 1]! - fd[n]!);
  const allPositive = fd.slice(1).every((x) => x > 0);
  if (allPositive) {
    const bound = (lo: number, x: number, hi: number) => Math.min(Math.max(x, lo), hi);
    f[0] = bound(0, f[0]!, 2 * fd[1]!);
    f[n] = bound(0, f[n]!, 2 * fd[n]!);
    for (let i = 1; i < n; i++) f[i] = bound(0, f[i]!, 2 * Math.min(fd[i]!, fd[i + 1]!));
  }
  return { fd, f };
}

/**
 * Value g(x) and integral G(x) = ∫₀ˣ g of the monotone convex correction in
 * one interval, with g(0) = g0, g(1) = g1 and G(1) = 0 (so the interval's
 * average forward equals the discrete forward). The four zones of Hagan–West.
 */
function monotoneConvexZone(g0: number, g1: number, x: number): { g: number; G: number } {
  if (g0 === 0 && g1 === 0) return { g: 0, G: 0 };
  if ((g0 < 0 && -0.5 * g0 <= g1 && g1 <= -2 * g0) || (g0 > 0 && -0.5 * g0 >= g1 && g1 >= -2 * g0)) {
    // zone (i): quadratic through both ends
    return { g: g0 * (1 - 4 * x + 3 * x * x) + g1 * (-2 * x + 3 * x * x), G: g0 * (x - 2 * x * x + x * x * x) + g1 * (-x * x + x * x * x) };
  }
  if ((g0 < 0 && g1 > -2 * g0) || (g0 > 0 && g1 < -2 * g0)) {
    // zone (ii): flat at g0, then quadratic
    const eta = (g1 + 2 * g0) / (g1 - g0);
    if (x <= eta) return { g: g0, G: g0 * x };
    const d = (x - eta) / (1 - eta);
    return { g: g0 + (g1 - g0) * d * d, G: g0 * x + ((g1 - g0) * Math.pow(x - eta, 3)) / (3 * (1 - eta) * (1 - eta)) };
  }
  if ((g0 > 0 && 0 > g1 && g1 > -0.5 * g0) || (g0 < 0 && 0 < g1 && g1 < -0.5 * g0)) {
    // zone (iii): quadratic, then flat at g1
    const eta = (3 * g1) / (g1 - g0);
    const Geta = g1 * eta + ((g0 - g1) * eta) / 3;
    if (x < eta) {
      const d = (eta - x) / eta;
      return { g: g1 + (g0 - g1) * d * d, G: g1 * x + ((g0 - g1) * (Math.pow(eta, 3) - Math.pow(eta - x, 3))) / (3 * eta * eta) };
    }
    return { g: g1, G: Geta + g1 * (x - eta) };
  }
  // zone (iv): same sign (or one zero) – two quadratics meeting at eta with value A
  const eta = g1 / (g1 + g0);
  const A = (-g0 * g1) / (g0 + g1);
  if (!(eta > 0 && eta < 1) || !Number.isFinite(A)) return { g: 0, G: 0 }; // limiting case g0 = 0 or g1 = 0
  const Geta = A * eta + ((g0 - A) * eta) / 3;
  if (x <= eta) {
    const d = (eta - x) / eta;
    return { g: A + (g0 - A) * d * d, G: A * x + ((g0 - A) * (Math.pow(eta, 3) - Math.pow(eta - x, 3))) / (3 * eta * eta) };
  }
  const d = (x - eta) / (1 - eta);
  return { g: A + (g1 - A) * d * d, G: Geta + A * (x - eta) + ((g1 - A) * Math.pow(x - eta, 3)) / (3 * (1 - eta) * (1 - eta)) };
}

/** Continuously compounded zero rate r(t) of the monotone convex curve (flat r beyond the ends). */
export function monotoneConvexZero(xs: readonly number[], zs: readonly number[], c: MonotoneConvexCoefficients, t: number): number {
  const n = xs.length - 1;
  if (n < 1 || t <= xs[0]!) return zs[0]!;
  if (t >= xs[n]!) return zs[n]!;
  const i = locate(xs, t) + 1; // interval (t_{i-1}, t_i]
  const h = xs[i]! - xs[i - 1]!;
  const x = (t - xs[i - 1]!) / h;
  const { G } = monotoneConvexZone(c.f[i - 1]! - c.fd[i]!, c.f[i]! - c.fd[i]!, x);
  const rt = zs[i - 1]! * xs[i - 1]! + h * (c.fd[i]! * x + G);
  return t > 0 ? rt / t : c.f[0]!;
}

/** Instantaneous forward f(t) of the monotone convex curve (flat beyond the ends). */
export function monotoneConvexForward(xs: readonly number[], c: MonotoneConvexCoefficients, t: number): number {
  const n = xs.length - 1;
  if (n < 1) return 0;
  if (t <= xs[0]!) return c.f[0]!;
  if (t >= xs[n]!) return c.f[n]!;
  const i = locate(xs, t) + 1;
  const x = (t - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  const { g } = monotoneConvexZone(c.f[i - 1]! - c.fd[i]!, c.f[i]! - c.fd[i]!, x);
  return c.fd[i]! + g;
}

/** Locate the interval index i such that xs[i] <= x < xs[i+1]. Clamped to [0, n-2]. */
export function locate(xs: readonly number[], x: number): number {
  const n = xs.length;
  if (n < 2) return 0;
  if (x <= xs[0]!) return 0;
  if (x >= xs[n - 1]!) return n - 2;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function linearInterp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (xs.length === 1) return ys[0]!;
  const i = locate(xs, x);
  const x0 = xs[i]!;
  const x1 = xs[i + 1]!;
  const y0 = ys[i]!;
  const y1 = ys[i + 1]!;
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson 1980): C¹, shape
 * preserving (no overshoot between pillars), flat beyond the ends. Used for
 * smile interpolation in the delta coordinate where a natural spline can
 * produce spurious wiggles with only 3–5 pillars.
 */
export function monotoneCubicInterp(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (n === 1 || x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  if (n === 2) return linearInterp(xs, ys, x);
  // Secant slopes and Fritsch–Carlson tangents.
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1]! - xs[i]!);
    delta.push((ys[i + 1]! - ys[i]!) / h[i]!);
  }
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const d0 = delta[i - 1]!;
    const d1 = delta[i]!;
    if (d0 * d1 <= 0) m[i] = 0;
    else {
      // Weighted harmonic mean (Fritsch–Butland), guarantees monotonicity.
      const w1 = 2 * h[i]! + h[i - 1]!;
      const w2 = h[i]! + 2 * h[i - 1]!;
      m[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }
  // End tangents: one-sided three-point estimate, limited to keep monotonicity.
  const endSlope = (d0: number, d1: number, h0: number, h1: number): number => {
    let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (s * d0 <= 0) s = 0;
    else if (d0 * d1 <= 0 && Math.abs(s) > 3 * Math.abs(d0)) s = 3 * d0;
    return s;
  };
  m[0] = endSlope(delta[0]!, delta[1]!, h[0]!, h[1]!);
  m[n - 1] = endSlope(delta[n - 2]!, delta[n - 3]!, h[n - 2]!, h[n - 3]!);
  const i = locate(xs, x);
  const hi = h[i]!;
  const t = (x - xs[i]!) / hi;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * ys[i]! + h10 * hi * m[i]! + h01 * ys[i + 1]! + h11 * hi * m[i + 1]!;
}

/** Natural cubic spline second derivatives (Numerical Recipes `spline`). */
export function cubicSplineCoefficients(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const y2 = new Array<number>(n).fill(0);
  if (n < 3) return y2;
  const u = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const sig = (xs[i]! - xs[i - 1]!) / (xs[i + 1]! - xs[i - 1]!);
    const p = sig * y2[i - 1]! + 2;
    y2[i] = (sig - 1) / p;
    u[i] = (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!) - (ys[i]! - ys[i - 1]!) / (xs[i]! - xs[i - 1]!);
    u[i] = ((6 * u[i]!) / (xs[i + 1]! - xs[i - 1]!) - sig * u[i - 1]!) / p;
  }
  for (let k = n - 2; k >= 0; k--) {
    y2[k] = y2[k]! * y2[k + 1]! + u[k]!;
  }
  return y2;
}

export function cubicSplineInterp(xs: readonly number[], ys: readonly number[], y2: readonly number[], x: number): number {
  const n = xs.length;
  if (n < 3) return linearInterp(xs, ys, x);
  // Linear extrapolation beyond ends (keeps forwards sane).
  if (x <= xs[0]! || x >= xs[n - 1]!) return linearInterp(xs, ys, x);
  const i = locate(xs, x);
  const h = xs[i + 1]! - xs[i]!;
  const a = (xs[i + 1]! - x) / h;
  const b = (x - xs[i]!) / h;
  return a * ys[i]! + b * ys[i + 1]! + (((a * a * a - a) * y2[i]! + (b * b * b - b) * y2[i + 1]!) * (h * h)) / 6;
}
