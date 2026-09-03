export type InterpolationMethod =
  | "linear"
  | "logLinear"
  | "linearZero"
  | "cubicSplineZero"
  | "flatForward";

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
    u[i] =
      (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!) - (ys[i]! - ys[i - 1]!) / (xs[i]! - xs[i - 1]!);
    u[i] = ((6 * u[i]!) / (xs[i + 1]! - xs[i - 1]!) - sig * u[i - 1]!) / p;
  }
  for (let k = n - 2; k >= 0; k--) {
    y2[k] = y2[k]! * y2[k + 1]! + u[k]!;
  }
  return y2;
}

export function cubicSplineInterp(
  xs: readonly number[],
  ys: readonly number[],
  y2: readonly number[],
  x: number,
): number {
  const n = xs.length;
  if (n < 3) return linearInterp(xs, ys, x);
  // Linear extrapolation beyond ends (keeps forwards sane).
  if (x <= xs[0]! || x >= xs[n - 1]!) return linearInterp(xs, ys, x);
  const i = locate(xs, x);
  const h = xs[i + 1]! - xs[i]!;
  const a = (xs[i + 1]! - x) / h;
  const b = (x - xs[i]!) / h;
  return (
    a * ys[i]! + b * ys[i + 1]! + ((a * a * a - a) * y2[i]! + (b * b * b - b) * y2[i + 1]!) * (h * h) / 6
  );
}
