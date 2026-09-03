export interface RootFindOptions {
  tolerance?: number;
  maxIterations?: number;
}

/**
 * Brent's method on a bracketed root. Throws when the bracket is invalid.
 */
export function brent(
  f: (x: number) => number,
  lower: number,
  upper: number,
  opts: RootFindOptions = {},
): number {
  const tol = opts.tolerance ?? 1e-12;
  const maxIter = opts.maxIterations ?? 200;
  let a = lower;
  let b = upper;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) {
    throw new Error(`brent: root not bracketed on [${a}, ${b}] (f(a)=${fa}, f(b)=${fb})`);
  }
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let iter = 0; iter < maxIter; iter++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      const min1 = 3 * xm * q - Math.abs(tol1 * q);
      const min2 = Math.abs(e * q);
      if (2 * p < Math.min(min1, min2)) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    if (Math.abs(d) > tol1) b += d;
    else b += xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  throw new Error("brent: maximum iterations exceeded");
}

/**
 * Expand a bracket around an initial guess until the sign changes, then run Brent.
 */
export function solveBracketed(
  f: (x: number) => number,
  guess: number,
  step: number,
  opts: RootFindOptions & { minX?: number; maxX?: number; maxExpansions?: number } = {},
): number {
  const minX = opts.minX ?? -Infinity;
  const maxX = opts.maxX ?? Infinity;
  const maxExp = opts.maxExpansions ?? 60;
  let lo = Math.max(minX, guess - step);
  let hi = Math.min(maxX, guess + step);
  let flo = f(lo);
  let fhi = f(hi);
  let n = 0;
  while (flo * fhi > 0 && n < maxExp) {
    step *= 1.6;
    if (Math.abs(flo) < Math.abs(fhi)) {
      lo = Math.max(minX, lo - step);
      flo = f(lo);
    } else {
      hi = Math.min(maxX, hi + step);
      fhi = f(hi);
    }
    n++;
  }
  if (flo * fhi > 0) throw new Error("solveBracketed: unable to bracket root");
  return brent(f, lo, hi, opts);
}

/** Newton–Raphson with numerical derivative and Brent fallback. */
export function newton(
  f: (x: number) => number,
  guess: number,
  opts: RootFindOptions & { derivative?: (x: number) => number; bracketStep?: number } = {},
): number {
  const tol = opts.tolerance ?? 1e-12;
  const maxIter = opts.maxIterations ?? 50;
  let x = guess;
  for (let i = 0; i < maxIter; i++) {
    const fx = f(x);
    if (Math.abs(fx) < tol) return x;
    const h = 1e-6 * Math.max(1, Math.abs(x));
    const dfx = opts.derivative ? opts.derivative(x) : (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(dfx) || dfx === 0) break;
    const nx = x - fx / dfx;
    if (Math.abs(nx - x) < tol) return nx;
    x = nx;
  }
  return solveBracketed(f, guess, opts.bracketStep ?? 0.01, opts);
}
