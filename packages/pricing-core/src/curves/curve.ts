import { type SerialDate } from "../dates/date.js";
import { type DayCountConvention, yearFraction } from "../dates/daycount.js";
import {
  type InterpolationMethod,
  cubicSplineCoefficients,
  cubicSplineInterp,
  linearInterp,
  locate,
} from "../math/interpolation.js";

/**
 * Discount / zero curve abstraction. All curves are anchored at a reference
 * date and expose discount factors as function of a date; time is measured
 * with the curve's own day count (ACT/365F by default, market standard for
 * zero curves).
 */
export interface Curve {
  readonly id: string;
  readonly referenceDate: SerialDate;
  readonly dayCount: DayCountConvention;
  readonly currency: string;
  /** Discount factor from reference date to `d` (1.0 for d <= reference). */
  df(d: SerialDate): number;
  /** Continuously compounded zero rate to `d`. */
  zeroRate(d: SerialDate): number;
  /** Simple forward rate between two dates with the given accrual day count. */
  forwardRate(start: SerialDate, end: SerialDate, accrualDayCount: DayCountConvention): number;
  /** Time (in years) from reference date. */
  time(d: SerialDate): number;
  /** Node dates (pillars) – used for bucketed risk. */
  readonly nodeDates: readonly SerialDate[];
  /** Return a copy with node i's zero rate shifted (absolute, decimal). */
  shiftedNode(i: number, bpShift: number): Curve;
  /** Return a copy with every node shifted in parallel. */
  shiftedParallel(bpShift: number): Curve;
  /** Return a copy with a custom per-node shift vector (decimal). */
  shiftedNodes(shifts: readonly number[]): Curve;
  /** Return a copy re-anchored at `newReferenceDate` with the same zero rates per tenor (constant-curve roll). */
  rolledTo(newReferenceDate: SerialDate): Curve;
}

export interface CurveNode {
  date: SerialDate;
  /** Discount factor at node. */
  df: number;
}

export interface InterpolatedCurveOptions {
  id: string;
  currency: string;
  referenceDate: SerialDate;
  nodes: CurveNode[];
  interpolation?: InterpolationMethod;
  dayCount?: DayCountConvention;
  /** Optional metadata like index name, collateral. */
  meta?: Record<string, string>;
}

export class InterpolatedCurve implements Curve {
  readonly id: string;
  readonly currency: string;
  readonly referenceDate: SerialDate;
  readonly dayCount: DayCountConvention;
  readonly interpolation: InterpolationMethod;
  readonly nodeDates: readonly SerialDate[];
  readonly meta: Record<string, string>;
  private readonly times: number[];
  private readonly dfs: number[];
  private readonly logDfs: number[];
  private readonly zeros: number[];
  private splineCoeffs: number[] | null = null;

  constructor(opts: InterpolatedCurveOptions) {
    if (opts.nodes.length === 0) throw new Error("Curve needs at least one node");
    const nodes = [...opts.nodes].sort((a, b) => a.date - b.date);
    this.id = opts.id;
    this.currency = opts.currency;
    this.referenceDate = opts.referenceDate;
    this.dayCount = opts.dayCount ?? "ACT/365F";
    this.interpolation = opts.interpolation ?? "logLinear";
    this.meta = opts.meta ?? {};
    this.nodeDates = nodes.map((n) => n.date);
    this.times = nodes.map((n) => yearFraction(opts.referenceDate, n.date, this.dayCount));
    this.dfs = nodes.map((n) => n.df);
    this.logDfs = this.dfs.map((x) => Math.log(x));
    this.zeros = this.times.map((t, i) => (t > 0 ? -this.logDfs[i]! / t : this.firstZero(nodes)));
    // Ensure a t=0 anchor for interpolation.
    if (this.times[0]! > 0) {
      this.times.unshift(0);
      this.dfs.unshift(1);
      this.logDfs.unshift(0);
      this.zeros.unshift(this.zeros[0]!);
    }
  }

  private firstZero(nodes: CurveNode[]): number {
    // Zero rate of first node with positive time.
    for (const n of nodes) {
      const t = yearFraction(this.referenceDate, n.date, this.dayCount);
      if (t > 0) return -Math.log(n.df) / t;
    }
    return 0;
  }

  time(d: SerialDate): number {
    return yearFraction(this.referenceDate, d, this.dayCount);
  }

  dfAtTime(t: number): number {
    if (t <= 0) return 1;
    const n = this.times.length;
    switch (this.interpolation) {
      case "logLinear": {
        if (t >= this.times[n - 1]!) {
          // Flat-forward extrapolation using last zero rate.
          const zl = this.zeros[n - 1]!;
          return Math.exp(-zl * t);
        }
        return Math.exp(linearInterp(this.times, this.logDfs, t));
      }
      case "linear":
        if (t >= this.times[n - 1]!) return Math.exp(-this.zeros[n - 1]! * t);
        return linearInterp(this.times, this.dfs, t);
      case "linearZero": {
        const z = t >= this.times[n - 1]! ? this.zeros[n - 1]! : linearInterp(this.times, this.zeros, t);
        return Math.exp(-z * t);
      }
      case "cubicSplineZero": {
        if (!this.splineCoeffs) this.splineCoeffs = cubicSplineCoefficients(this.times, this.zeros);
        const z =
          t >= this.times[n - 1]!
            ? this.zeros[n - 1]!
            : cubicSplineInterp(this.times, this.zeros, this.splineCoeffs, t);
        return Math.exp(-z * t);
      }
      case "flatForward": {
        // Piecewise constant instantaneous forward = log-linear DF within intervals.
        if (t >= this.times[n - 1]!) return Math.exp(-this.zeros[n - 1]! * t);
        const i = locate(this.times, t);
        const t0 = this.times[i]!;
        const t1 = this.times[i + 1]!;
        const f = -(this.logDfs[i + 1]! - this.logDfs[i]!) / (t1 - t0);
        return this.dfs[i]! * Math.exp(-f * (t - t0));
      }
    }
  }

  df(d: SerialDate): number {
    return this.dfAtTime(this.time(d));
  }

  zeroRate(d: SerialDate): number {
    const t = this.time(d);
    if (t <= 0) return this.zeros[1] ?? this.zeros[0]!;
    return -Math.log(this.dfAtTime(t)) / t;
  }

  forwardRate(start: SerialDate, end: SerialDate, accrualDayCount: DayCountConvention): number {
    const tau = yearFraction(start, end, accrualDayCount);
    if (tau <= 0) return 0;
    return (this.df(start) / this.df(end) - 1) / tau;
  }

  /** Instantaneous-ish forward between consecutive times (for charting). */
  forwardAtTimes(t1: number, t2: number): number {
    return (this.dfAtTime(t1) / this.dfAtTime(t2) - 1) / (t2 - t1);
  }

  nodes(): CurveNode[] {
    return this.nodeDates.map((d, i) => ({ date: d, df: this.dfs[this.times[0] === 0 && this.nodeDates.length < this.times.length ? i + 1 : i]! }));
  }

  zeroRates(): { date: SerialDate; time: number; zero: number; df: number }[] {
    const offset = this.times.length > this.nodeDates.length ? 1 : 0;
    return this.nodeDates.map((d, i) => ({
      date: d,
      time: this.times[i + offset]!,
      zero: this.zeros[i + offset]!,
      df: this.dfs[i + offset]!,
    }));
  }

  private rebuildWithZeros(newZeros: number[]): InterpolatedCurve {
    const offset = this.times.length > this.nodeDates.length ? 1 : 0;
    const nodes = this.nodeDates.map((d, i) => {
      const t = this.times[i + offset]!;
      return { date: d, df: Math.exp(-newZeros[i]! * t) };
    });
    return new InterpolatedCurve({
      id: this.id,
      currency: this.currency,
      referenceDate: this.referenceDate,
      nodes,
      interpolation: this.interpolation,
      dayCount: this.dayCount,
      meta: this.meta,
    });
  }

  shiftedNode(i: number, shift: number): InterpolatedCurve {
    const offset = this.times.length > this.nodeDates.length ? 1 : 0;
    const zeros = this.nodeDates.map((_, j) => this.zeros[j + offset]! + (j === i ? shift : 0));
    return this.rebuildWithZeros(zeros);
  }

  rolledTo(newReferenceDate: SerialDate): InterpolatedCurve {
    const delta = newReferenceDate - this.referenceDate;
    if (delta === 0) return this;
    const offset = this.times.length > this.nodeDates.length ? 1 : 0;
    const nodes = this.nodeDates.map((d, i) => ({ date: d + delta, df: this.dfs[i + offset]! }));
    return new InterpolatedCurve({
      id: this.id,
      currency: this.currency,
      referenceDate: newReferenceDate,
      nodes,
      interpolation: this.interpolation,
      dayCount: this.dayCount,
      meta: this.meta,
    });
  }

  shiftedParallel(shift: number): InterpolatedCurve {
    const offset = this.times.length > this.nodeDates.length ? 1 : 0;
    return this.rebuildWithZeros(this.nodeDates.map((_, j) => this.zeros[j + offset]! + shift));
  }

  shiftedNodes(shifts: readonly number[]): InterpolatedCurve {
    const offset = this.times.length > this.nodeDates.length ? 1 : 0;
    return this.rebuildWithZeros(
      this.nodeDates.map((_, j) => this.zeros[j + offset]! + (shifts[j] ?? 0)),
    );
  }

  toJSON() {
    return {
      id: this.id,
      currency: this.currency,
      referenceDate: this.referenceDate,
      dayCount: this.dayCount,
      interpolation: this.interpolation,
      meta: this.meta,
      nodes: this.zeroRates(),
    };
  }
}

/** Build a flat curve at a continuously compounded zero rate (testing / quick what-ifs). */
export function flatCurve(
  id: string,
  currency: string,
  referenceDate: SerialDate,
  rate: number,
  dayCount: DayCountConvention = "ACT/365F",
): InterpolatedCurve {
  const nodes: CurveNode[] = [1, 2, 5, 10, 20, 30, 50].map((y) => {
    const d = referenceDate + Math.round(y * 365.25);
    const t = yearFraction(referenceDate, d, dayCount);
    return { date: d, df: Math.exp(-rate * t) };
  });
  return new InterpolatedCurve({ id, currency, referenceDate, nodes, interpolation: "logLinear", dayCount });
}
