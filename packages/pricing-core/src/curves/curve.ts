import { type SerialDate, parseISO, toISO } from "../dates/date.js";
import { type DayCountConvention, yearFraction } from "../dates/daycount.js";
import {
  type InterpolationMethod,
  type MonotoneConvexCoefficients,
  cubicSplineCoefficients,
  cubicSplineInterp,
  linearInterp,
  locate,
  monotoneConvexCoefficients,
  monotoneConvexZero,
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
  /**
   * Simple forward rate between two dates with the given accrual day count.
   * Dates before the reference date are handled by flat extrapolation of the
   * curve's first forward (short end), so a period that started in the past
   * yields the first available forward instead of a rate diluted by df = 1.
   */
  forwardRate(start: SerialDate, end: SerialDate, accrualDayCount: DayCountConvention): number;
  /** Time (in years) from reference date. */
  time(d: SerialDate): number;
  /** Node dates (pillars) – used for bucketed risk. */
  readonly nodeDates: readonly SerialDate[];
  /**
   * Return a copy with node i's continuously compounded zero rate shifted by
   * `shift`, an absolute rate shift in decimal (1 bp = 1e-4). All shift
   * arguments of this interface are decimal rates, never bp.
   */
  shiftedNode(i: number, shift: number): Curve;
  /** Return a copy with every node's zero rate shifted in parallel by `shift` (decimal, 1 bp = 1e-4). */
  shiftedParallel(shift: number): Curve;
  /** Return a copy with a custom per-node shift vector (decimal rate shifts). */
  shiftedNodes(shifts: readonly number[]): Curve;
  /** Return a copy re-anchored at `newReferenceDate` with the same zero rates per tenor (constant-curve roll). */
  rolledTo(newReferenceDate: SerialDate): Curve;
  /**
   * Return a copy re-anchored at `newReferenceDate` along the forward curve
   * (df'(d) = df(d)/df(newReferenceDate)); used for the carry component of
   * theta. Optional for backwards compatibility of external implementations.
   */
  forwardRolledTo?(newReferenceDate: SerialDate): Curve;
}

export interface CurveNode {
  date: SerialDate;
  /** Discount factor at node. */
  df: number;
}

/**
 * Extrapolation beyond the last pillar: "flatForward" keeps the last
 * instantaneous forward constant (QuantLib default for log-linear discount
 * interpolation), "flatZero" keeps the last zero rate constant.
 */
export type CurveExtrapolation = "flatForward" | "flatZero";

/**
 * Jump of the instantaneous forward over a short window (turn-of-year effect):
 * between `date` and `date + days` (default 1 calendar day) the instantaneous
 * forward is raised by `bp` basis points on top of the interpolated curve.
 * Discount factors after the window carry the accumulated adjustment
 * exp(−bp·1e-4·days/365).
 */
export interface ForwardJump {
  date: SerialDate;
  bp: number;
  /** Length of the window in calendar days (default 1). */
  days?: number;
}

export interface InterpolatedCurveOptions {
  id: string;
  currency: string;
  referenceDate: SerialDate;
  /** Interpolation nodes (base curve, i.e. before `forwardJumps`). */
  nodes: CurveNode[];
  interpolation?: InterpolationMethod;
  /** Default: "flatForward" for df-based interpolations, "flatZero" for zero-rate interpolations. */
  extrapolation?: CurveExtrapolation;
  dayCount?: DayCountConvention;
  /** Optional metadata like index name, collateral. */
  meta?: Record<string, string>;
  /** Turn-of-year (or other) forward jumps layered on the interpolated curve. */
  forwardJumps?: ForwardJump[];
}

export class InterpolatedCurve implements Curve {
  readonly id: string;
  readonly currency: string;
  readonly referenceDate: SerialDate;
  readonly dayCount: DayCountConvention;
  readonly interpolation: InterpolationMethod;
  readonly extrapolation: CurveExtrapolation;
  readonly nodeDates: readonly SerialDate[];
  readonly meta: Record<string, string>;
  /** Forward jumps (turn-of-year) layered on the interpolated base curve; empty when none. */
  readonly forwardJumps: readonly ForwardJump[];
  /** Times including a t = 0 anchor (when the first node is after the reference date). */
  private readonly times: number[];
  private readonly dfs: number[];
  private readonly logDfs: number[];
  private readonly zeros: number[];
  /** 1 when a t = 0 anchor was prepended (times/dfs/zeros are offset by one against nodeDates). */
  private readonly anchorOffset: number;
  private splineCoeffs: number[] | null = null;
  private mcCoeffs: MonotoneConvexCoefficients | null = null;
  /** Jump windows in curve time: [start, end, rate shift]. */
  private readonly jumpWindows: { t0: number; t1: number; shift: number }[];

  constructor(opts: InterpolatedCurveOptions) {
    if (opts.nodes.length === 0) throw new Error("Curve needs at least one node");
    const nodes = [...opts.nodes].sort((a, b) => a.date - b.date);
    this.id = opts.id;
    this.currency = opts.currency;
    this.referenceDate = opts.referenceDate;
    this.dayCount = opts.dayCount ?? "ACT/365F";
    this.interpolation = opts.interpolation ?? "logLinear";
    this.extrapolation = opts.extrapolation ?? (this.interpolation === "linearZero" || this.interpolation === "cubicSplineZero" ? "flatZero" : "flatForward");
    this.meta = opts.meta ?? {};
    this.forwardJumps = (opts.forwardJumps ?? []).filter((j) => j.bp !== 0).map((j) => ({ ...j }));
    this.jumpWindows = this.forwardJumps.map((j) => ({
      t0: yearFraction(opts.referenceDate, j.date, this.dayCount),
      t1: yearFraction(opts.referenceDate, j.date + (j.days ?? 1), this.dayCount),
      shift: j.bp * 1e-4,
    }));
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
      this.anchorOffset = 1;
    } else {
      this.anchorOffset = 0;
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

  /** Instantaneous forward of the first interval (t = 0 → first pillar); used for short-end extrapolation. */
  private firstForward(): number {
    const n = this.times.length;
    if (n < 2) return this.zeros[0] ?? 0;
    return -(this.logDfs[1]! - this.logDfs[0]!) / (this.times[1]! - this.times[0]!);
  }

  /** Discount factor beyond the last pillar according to the extrapolation setting. */
  private extrapolatedDf(t: number): number {
    const n = this.times.length;
    if (this.extrapolation === "flatZero" || n < 2) return Math.exp(-this.zeros[n - 1]! * t);
    const f = -(this.logDfs[n - 1]! - this.logDfs[n - 2]!) / (this.times[n - 1]! - this.times[n - 2]!);
    return this.dfs[n - 1]! * Math.exp(-f * (t - this.times[n - 1]!));
  }

  /**
   * Multiplicative discount adjustment of the forward jumps up to time t:
   * exp(−Σ shift_k · overlap([0, t], window_k)).
   */
  private jumpAdjustment(t: number): number {
    if (this.jumpWindows.length === 0) return 1;
    let x = 0;
    for (const w of this.jumpWindows) {
      const overlap = Math.min(t, w.t1) - Math.max(0, w.t0);
      if (overlap > 0) x += w.shift * overlap;
    }
    return x === 0 ? 1 : Math.exp(-x);
  }

  /**
   * Discount factor as function of time. Returns 1 for t <= 0 (a discount
   * factor for a date on or before the reference date); use `dfExtrapolated`
   * for forward computations that reach into the past.
   */
  dfAtTime(t: number): number {
    if (t <= 0) return 1;
    return this.baseDfAtTime(t) * this.jumpAdjustment(t);
  }

  /** Discount factor of the interpolated base curve (without forward jumps). */
  private baseDfAtTime(t: number): number {
    const n = this.times.length;
    if (t >= this.times[n - 1]!) return this.extrapolatedDf(t);
    switch (this.interpolation) {
      case "logLinear":
        return Math.exp(linearInterp(this.times, this.logDfs, t));
      case "linear":
        return linearInterp(this.times, this.dfs, t);
      case "linearZero": {
        const z = linearInterp(this.times, this.zeros, t);
        return Math.exp(-z * t);
      }
      case "cubicSplineZero": {
        if (!this.splineCoeffs) this.splineCoeffs = cubicSplineCoefficients(this.times, this.zeros);
        const z = cubicSplineInterp(this.times, this.zeros, this.splineCoeffs, t);
        return Math.exp(-z * t);
      }
      case "monotoneConvex": {
        if (!this.mcCoeffs) this.mcCoeffs = monotoneConvexCoefficients(this.times, this.zeros);
        const z = monotoneConvexZero(this.times, this.zeros, this.mcCoeffs, t);
        return Math.exp(-z * t);
      }
      case "flatForward": {
        // Piecewise constant instantaneous forward = log-linear DF within intervals.
        const i = locate(this.times, t);
        const t0 = this.times[i]!;
        const t1 = this.times[i + 1]!;
        const f = -(this.logDfs[i + 1]! - this.logDfs[i]!) / (t1 - t0);
        return this.dfs[i]! * Math.exp(-f * (t - t0));
      }
    }
  }

  /**
   * Discount factor with flat-forward extrapolation at the short end: for
   * t < 0 the first forward of the curve is applied (df > 1). Used by
   * `forwardRate` so periods starting before the reference date are projected
   * with the first available forward instead of df = 1.
   */
  dfExtrapolated(t: number): number {
    if (t < 0) return Math.exp(-this.firstForward() * t);
    return this.dfAtTime(t);
  }

  df(d: SerialDate): number {
    return this.dfAtTime(this.time(d));
  }

  zeroRate(d: SerialDate): number {
    const t = this.time(d);
    if (t <= 0) return this.zeros[this.anchorOffset] ?? this.zeros[0]!;
    return -Math.log(this.dfAtTime(t)) / t;
  }

  forwardRate(start: SerialDate, end: SerialDate, accrualDayCount: DayCountConvention): number {
    const tau = yearFraction(start, end, accrualDayCount);
    if (tau <= 0) return 0;
    return (this.dfExtrapolated(this.time(start)) / this.dfExtrapolated(this.time(end)) - 1) / tau;
  }

  /** Instantaneous-ish forward between consecutive times (for charting). */
  forwardAtTimes(t1: number, t2: number): number {
    return (this.dfExtrapolated(t1) / this.dfExtrapolated(t2) - 1) / (t2 - t1);
  }

  nodes(): CurveNode[] {
    return this.nodeDates.map((d, i) => ({ date: d, df: this.dfs[i + this.anchorOffset]! }));
  }

  zeroRates(): { date: SerialDate; time: number; zero: number; df: number }[] {
    const offset = this.anchorOffset;
    return this.nodeDates.map((d, i) => ({
      date: d,
      time: this.times[i + offset]!,
      zero: this.zeros[i + offset]!,
      df: this.dfs[i + offset]!,
    }));
  }

  private rebuild(nodes: CurveNode[], referenceDate = this.referenceDate): InterpolatedCurve {
    const delta = referenceDate - this.referenceDate;
    return new InterpolatedCurve({
      id: this.id,
      currency: this.currency,
      referenceDate,
      nodes,
      interpolation: this.interpolation,
      extrapolation: this.extrapolation,
      dayCount: this.dayCount,
      meta: this.meta,
      // Constant-curve roll moves the jump windows with the curve; a re-anchoring at the same date keeps them.
      forwardJumps: this.forwardJumps.map((j) => ({ ...j, date: j.date + delta })),
    });
  }

  private rebuildWithZeros(newZeros: number[]): InterpolatedCurve {
    const offset = this.anchorOffset;
    const nodes = this.nodeDates.map((d, i) => {
      const t = this.times[i + offset]!;
      return { date: d, df: Math.exp(-newZeros[i]! * t) };
    });
    return this.rebuild(nodes);
  }

  shiftedNode(i: number, shift: number): InterpolatedCurve {
    const offset = this.anchorOffset;
    const zeros = this.nodeDates.map((_, j) => this.zeros[j + offset]! + (j === i ? shift : 0));
    return this.rebuildWithZeros(zeros);
  }

  rolledTo(newReferenceDate: SerialDate): InterpolatedCurve {
    const delta = newReferenceDate - this.referenceDate;
    if (delta === 0) return this;
    const offset = this.anchorOffset;
    const nodes = this.nodeDates.map((d, i) => ({ date: d + delta, df: this.dfs[i + offset]! }));
    return this.rebuild(nodes, newReferenceDate);
  }

  /**
   * Roll along the forward curve: the new curve's discount factors are the
   * forward discount factors df(d)/df(newReferenceDate) on the original node
   * dates (nodes on or before the new reference date are dropped; a node at
   * the new reference date + 1 day carries the short forward if needed).
   */
  forwardRolledTo(newReferenceDate: SerialDate): InterpolatedCurve {
    if (newReferenceDate === this.referenceDate) return this;
    const dfRef = this.dfExtrapolated(this.time(newReferenceDate));
    const nodes: CurveNode[] = this.nodeDates.filter((d) => d > newReferenceDate).map((d) => ({ date: d, df: this.dfExtrapolated(this.time(d)) / dfRef }));
    if (nodes.length === 0) {
      const d = newReferenceDate + 365;
      nodes.push({ date: d, df: this.dfExtrapolated(this.time(d)) / dfRef });
    }
    // The forward roll keeps calendar dates: the total forward dfs already contain the jumps, so the
    // rolled curve carries them as plain nodes and no separate jump layer.
    return new InterpolatedCurve({
      id: this.id,
      currency: this.currency,
      referenceDate: newReferenceDate,
      nodes,
      interpolation: this.interpolation,
      extrapolation: this.extrapolation,
      dayCount: this.dayCount,
      meta: this.meta,
    });
  }

  shiftedParallel(shift: number): InterpolatedCurve {
    const offset = this.anchorOffset;
    return this.rebuildWithZeros(this.nodeDates.map((_, j) => this.zeros[j + offset]! + shift));
  }

  shiftedNodes(shifts: readonly number[]): InterpolatedCurve {
    const offset = this.anchorOffset;
    return this.rebuildWithZeros(this.nodeDates.map((_, j) => this.zeros[j + offset]! + (shifts[j] ?? 0)));
  }

  /** Portable JSON form (ISO dates); `InterpolatedCurve.fromJSON` inverts it. */
  toJSON(): CurveJson {
    return {
      id: this.id,
      currency: this.currency,
      referenceDate: toISO(this.referenceDate),
      dayCount: this.dayCount,
      interpolation: this.interpolation,
      extrapolation: this.extrapolation,
      meta: this.meta,
      nodes: this.zeroRates().map((n) => ({ date: toISO(n.date), time: n.time, zero: n.zero, df: n.df })),
      ...(this.forwardJumps.length ? { forwardJumps: this.forwardJumps.map((j) => ({ date: toISO(j.date), bp: j.bp, days: j.days })) } : {}),
    };
  }

  /** Rebuild a curve from `toJSON()` output (only `date` and `df` of the nodes are needed). */
  static fromJSON(json: CurveJson): InterpolatedCurve {
    return new InterpolatedCurve({
      id: json.id,
      currency: json.currency,
      referenceDate: typeof json.referenceDate === "number" ? json.referenceDate : parseISO(json.referenceDate),
      nodes: json.nodes.map((n) => ({ date: typeof n.date === "number" ? n.date : parseISO(n.date), df: n.df })),
      interpolation: json.interpolation,
      extrapolation: json.extrapolation,
      dayCount: json.dayCount,
      meta: json.meta,
      forwardJumps: json.forwardJumps?.map((j) => ({ date: typeof j.date === "number" ? j.date : parseISO(j.date), bp: j.bp, days: j.days })),
    });
  }
}

/** JSON representation of an `InterpolatedCurve` (dates as ISO strings; serial numbers accepted on input for legacy files). */
export interface CurveJson {
  id: string;
  currency: string;
  referenceDate: string | number;
  dayCount?: DayCountConvention;
  interpolation?: InterpolationMethod;
  extrapolation?: CurveExtrapolation;
  meta?: Record<string, string>;
  /** Base-curve nodes (before forward jumps); `df` at a node date differs from `curve.df(date)` when jumps precede it. */
  nodes: { date: string | number; df: number; time?: number; zero?: number }[];
  forwardJumps?: { date: string | number; bp: number; days?: number }[];
}

/** Build a flat curve at a continuously compounded zero rate (testing / quick what-ifs). */
export function flatCurve(id: string, currency: string, referenceDate: SerialDate, rate: number, dayCount: DayCountConvention = "ACT/365F"): InterpolatedCurve {
  const nodes: CurveNode[] = [1, 2, 5, 10, 20, 30, 50].map((y) => {
    const d = referenceDate + Math.round(y * 365.25);
    const t = yearFraction(referenceDate, d, dayCount);
    return { date: d, df: Math.exp(-rate * t) };
  });
  return new InterpolatedCurve({ id, currency, referenceDate, nodes, interpolation: "logLinear", dayCount });
}
