#!/usr/bin/env python3
"""
Golden-master reference values for @deriva/pricing-core.

Writes ../test-data/golden/*.json. Every reference value is derived
INDEPENDENTLY of the TypeScript engine:

* analytically (closed forms evaluated here with the Python standard library:
  flat-curve swap annuity and par rate, OIS compounding telescoping, Black-76,
  Bachelier, Garman-Kohlhagen, covered interest parity with spot-date anchor),
* and – when the QuantLib Python bindings are importable – cross-checked
  against QuantLib (VanillaSwap / OvernightIndexedSwap / blackFormula /
  bachelierBlackFormula / GarmanKohlhagen). QuantLib is OPTIONAL: the script
  runs without it and the CI never executes this script; the JSON files are
  checked in and read by `src/testing/golden.test.ts`.

Run:  python3 tools/quantlib-golden.py        (from packages/pricing-core)
With QuantLib (the checked-in files were generated with QuantLib 1.43):
      pip install --target /some/dir QuantLib && PYTHONPATH=/some/dir python3 tools/quantlib-golden.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "test-data", "golden")

try:  # optional cross-check
    import QuantLib as ql  # type: ignore

    HAVE_QL = True
except Exception:  # pragma: no cover
    ql = None
    HAVE_QL = False


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def d(y: int, m: int, day: int) -> dt.date:
    return dt.date(y, m, day)


def days(a: dt.date, b: dt.date) -> int:
    return (b - a).days


def df_flat(rate: float, t_years: float) -> float:
    """Continuously compounded flat curve, ACT/365F time."""
    return math.exp(-rate * t_years)


def black76(kind: str, f: float, k: float, vol: float, t: float) -> float:
    sd = vol * math.sqrt(t)
    d1 = (math.log(f / k) + 0.5 * sd * sd) / sd
    d2 = d1 - sd
    s = 1.0 if kind == "Call" else -1.0
    return s * (f * ncdf(s * d1) - k * ncdf(s * d2))


def bachelier(kind: str, f: float, k: float, vol: float, t: float) -> float:
    sd = vol * math.sqrt(t)
    dd = (f - k) / sd
    s = 1.0 if kind == "Call" else -1.0
    return s * (f - k) * ncdf(s * dd) + sd * npdf(dd)


def garman_kohlhagen(kind: str, spot: float, k: float, vol: float, t_exp: float, t_del: float, rd: float, rf: float) -> dict:
    fwd = spot * math.exp((rd - rf) * t_del)
    dfd = math.exp(-rd * t_del)
    sd = vol * math.sqrt(t_exp)
    d1 = (math.log(fwd / k) + 0.5 * sd * sd) / sd
    d2 = d1 - sd
    s = 1.0 if kind == "Call" else -1.0
    prem = dfd * s * (fwd * ncdf(s * d1) - k * ncdf(s * d2))
    return {"forward": fwd, "premium": prem, "d1": d1, "d2": d2}


def write(name: str, payload: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("wrote", os.path.relpath(path, os.path.join(HERE, "..")))


VAL = d(2026, 9, 3)


# --------------------------------------------------------------------------
# A. Vanilla swap on a flat 3 % curve (single curve, unadjusted annual dates)
# --------------------------------------------------------------------------
def golden_swap() -> None:
    rate = 0.03
    notional = 10_000_000.0
    fixed_rate = 0.03
    dates = [d(2026 + i, 9, 3) for i in range(0, 6)]  # 2026-09-03 … 2031-09-03
    dfs = [df_flat(rate, days(VAL, x) / 365.0) for x in dates]
    # fixed leg 30E/360, 03 → 03 of the following year = 360 days = τ 1.0 exactly
    annuity = notional * sum(dfs[1:])
    par = (dfs[0] - dfs[-1]) / sum(dfs[1:])
    fixed_cfs = []
    float_cfs = []
    pv_fixed = 0.0
    pv_float = 0.0
    for i in range(1, 6):
        tau_fix = 1.0
        amt_fix = -notional * fixed_rate * tau_fix  # payer swap: we pay fixed
        pv_fixed += amt_fix * dfs[i]
        fixed_cfs.append({"paymentDate": dates[i].isoformat(), "accrualFactor": tau_fix, "amount": amt_fix, "discountFactor": dfs[i], "presentValue": amt_fix * dfs[i]})
        tau_flt = days(dates[i - 1], dates[i]) / 360.0
        fwd = (dfs[i - 1] / dfs[i] - 1.0) / tau_flt
        amt_flt = notional * fwd * tau_flt  # = N (DF_{i-1}/DF_i − 1)
        pv_float += amt_flt * dfs[i]
        float_cfs.append({"paymentDate": dates[i].isoformat(), "rate": fwd, "accrualFactor": tau_flt, "amount": amt_flt, "discountFactor": dfs[i], "presentValue": amt_flt * dfs[i]})
    pv = pv_fixed + pv_float
    assert abs(pv_float - notional * (dfs[0] - dfs[-1])) < 1e-6  # telescoping check
    payload = {
        "case": "swap-flat-curve",
        "description": "5Y EUR payer swap, flat 3 % continuously compounded curve (ACT/365F) used for discounting and projection (single curve), annual unadjusted periods 2026-09-03 → 2031-09-03, fixed 30E/360 (τ = 1), float EURIBOR-12M ACT/360 with fixing lag 0.",
        "derivation": "DF_i = exp(−0.03·days(2026-09-03, d_i)/365); par = (DF_0 − DF_5)/Σ_{i=1..5} DF_i (τ_fix = 1); float coupon_i = N·(DF_{i−1}/DF_i − 1) (forward × ACT/360 accrual telescopes), PV_float = N·(1 − DF_5); PV = PV_float − 0.03·N·Σ DF_i. Pure closed form, no QuantLib needed.",
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "curveId": "EUR-EURIBOR-12M",
            "flatZeroRate": rate,
            "curveDayCount": "ACT/365F",
            "notional": notional,
            "fixedRate": fixed_rate,
            "payReceiveFixed": "Pay",
            "effectiveDate": dates[0].isoformat(),
            "terminationDate": dates[-1].isoformat(),
            "fixedDayCount": "30E/360",
            "floatIndex": "EURIBOR-12M",
            "floatDayCount": "ACT/360",
            "frequency": "12M",
            "calendar": "NONE",
            "businessDayConvention": "Unadjusted",
        },
        "expected": {
            "discountFactors": [{"date": x.isoformat(), "df": f} for x, f in zip(dates, dfs)],
            "parRate": par,
            "annuity": annuity,
            "pvFixed": pv_fixed,
            "pvFloat": pv_float,
            "pv": pv,
            "fixedCashflows": fixed_cfs,
            "floatCashflows": float_cfs,
        },
    }
    if HAVE_QL:
        payload["quantlib"] = ql_swap_check(rate, notional, fixed_rate, dates)
    write("swap-flat-curve.json", payload)


def ql_swap_check(rate, notional, fixed_rate, dates):  # pragma: no cover
    ql.Settings.instance().evaluationDate = ql.Date(3, 9, 2026)
    curve = ql.YieldTermStructureHandle(ql.FlatForward(ql.Date(3, 9, 2026), rate, ql.Actual365Fixed(), ql.Continuous))
    cal = ql.NullCalendar()
    sched = ql.Schedule(ql.Date(3, 9, 2026), ql.Date(3, 9, 2031), ql.Period("1Y"), cal, ql.Unadjusted, ql.Unadjusted, ql.DateGeneration.Backward, False)
    index = ql.IborIndex("EURIBOR12M", ql.Period("12M"), 0, ql.EURCurrency(), cal, ql.Unadjusted, False, ql.Actual360(), curve)
    swap = ql.VanillaSwap(ql.VanillaSwap.Payer, notional, sched, fixed_rate, ql.Thirty360(ql.Thirty360.European), sched, index, 0.0, ql.Actual360())
    swap.setPricingEngine(ql.DiscountingSwapEngine(curve))
    return {"version": ql.__version__, "npv": swap.NPV(), "fairRate": swap.fairRate(), "fixedLegNPV": swap.fixedLegNPV(), "floatingLegNPV": swap.floatingLegNPV()}


# --------------------------------------------------------------------------
# B. €STR OIS on a flat 2.5 % curve – daily compounding telescopes to DF ratios
# --------------------------------------------------------------------------
def golden_ois() -> None:
    rate = 0.025
    notional = 10_000_000.0
    dates = [d(2026, 9, 3), d(2027, 9, 3), d(2028, 9, 3)]
    dfs = [df_flat(rate, days(VAL, x) / 365.0) for x in dates]
    taus = [days(dates[i - 1], dates[i]) / 360.0 for i in range(1, 3)]
    annuity = notional * sum(t * f for t, f in zip(taus, dfs[1:]))
    par = (dfs[0] - dfs[-1]) / sum(t * f for t, f in zip(taus, dfs[1:]))
    compounded = [(dfs[i - 1] / dfs[i] - 1.0) / taus[i - 1] for i in range(1, 3)]
    float_amounts = [notional * (dfs[i - 1] / dfs[i] - 1.0) for i in range(1, 3)]
    pv_float = sum(a * f for a, f in zip(float_amounts, dfs[1:]))
    fixed_rate = 0.025
    pv_fixed = -notional * fixed_rate * sum(t * f for t, f in zip(taus, dfs[1:]))
    payload = {
        "case": "ois-flat-curve",
        "description": "2Y EUR €STR OIS (payer), flat 2.5 % continuously compounded €STR curve, annual unadjusted periods, fixed ACT/360 vs. €STR compounded in arrears ACT/360, payment lag 0.",
        "derivation": "Daily compounding Π(1 + f_j·τ_j) with f_j = (DF_j/DF_{j+1} − 1)/τ_j telescopes to DF_{start}/DF_{end}, so the compounded rate of period i is (DF_{i−1}/DF_i − 1)/τ_i independent of the business-day grid; float coupon = N·(DF_{i−1}/DF_i − 1); par = (1 − DF_2)/Σ τ_i·DF_i. Closed form.",
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "curveId": "EUR-ESTR",
            "flatZeroRate": rate,
            "notional": notional,
            "fixedRate": fixed_rate,
            "payReceiveFixed": "Pay",
            "effectiveDate": dates[0].isoformat(),
            "terminationDate": dates[-1].isoformat(),
            "index": "ESTR",
            "frequency": "12M",
            "dayCount": "ACT/360",
            "calendar": "NONE",
            "businessDayConvention": "Unadjusted",
            "paymentLag": 0,
        },
        "expected": {
            "parRate": par,
            "annuity": annuity,
            "compoundedRates": compounded,
            "floatAmounts": float_amounts,
            "pvFloat": pv_float,
            "pvFixed": pv_fixed,
            "pv": pv_fixed + pv_float,
        },
    }
    write("ois-flat-curve.json", payload)


# --------------------------------------------------------------------------
# C. Black-76 caplet (Hull) and Bachelier ATM swaption closed forms
# --------------------------------------------------------------------------
def golden_black_bachelier() -> None:
    # Hull, Options, Futures and Other Derivatives – caplet example
    f, k, vol, t = 0.07, 0.08, 0.20, 1.0
    notional, tau, zero15m = 10_000_000.0, 0.25, 0.065
    sd = vol * math.sqrt(t)
    d1 = (math.log(f / k) + 0.5 * sd * sd) / sd
    d2 = d1 - sd
    undisc = black76("Call", f, k, vol, t)
    caplet = notional * tau * math.exp(-zero15m * 1.25) * undisc
    # Bachelier ATM: A·σ√T/√(2π)
    fb, volb, tb, annuity = 0.025, 0.008, 1.0, 4.5
    atm = annuity * bachelier("Call", fb, fb, volb, tb)
    payload = {
        "case": "black76-bachelier",
        "description": "Closed-form option values: Hull caplet (F 7 %, K 8 %, σ 20 %, T 1, τ 0.25, N 10m, 15M zero 6.5 % cont.) and an ATM Bachelier payer swaption (F = K = 2.5 %, σ_N 80 bp, T 1, annuity 4.5).",
        "derivation": "Black-76: d1 = (ln(F/K) + σ²T/2)/(σ√T), d2 = d1 − σ√T, C = F·N(d1) − K·N(d2); caplet = N·τ·e^{−0.065·1.25}·C. Bachelier ATM: A·σ√T/√(2π) = 4.5·0.008/√(2π) = 0.014362; the general Bachelier formula (F−K)·N(d) + σ√T·φ(d) is used so the two must agree. Reference values from math.erf.",
        "inputs": {
            "black76": {"forward": f, "strike": k, "vol": vol, "timeToExpiry": t, "notional": notional, "accrualFactor": tau, "zeroRate15M": zero15m},
            "bachelier": {"forward": fb, "strike": fb, "normalVol": volb, "timeToExpiry": tb, "annuity": annuity},
        },
        "expected": {
            "black76": {"d1": d1, "d2": d2, "undiscountedCall": undisc, "capletValue": caplet, "put": black76("Put", f, k, vol, t)},
            "bachelier": {"atmPayer": atm, "atmClosedForm": annuity * volb * math.sqrt(tb) / math.sqrt(2 * math.pi), "delta": 0.5, "vega": annuity * math.sqrt(tb) * npdf(0.0)},
        },
    }
    if HAVE_QL:  # pragma: no cover
        payload["quantlib"] = {
            "version": ql.__version__,
            "black76Call": ql.blackFormula(ql.Option.Call, k, f, sd),
            "bachelierAtm": annuity * ql.bachelierBlackFormula(ql.Option.Call, fb, fb, volb * math.sqrt(tb)),
        }
    write("black76-bachelier.json", payload)


# --------------------------------------------------------------------------
# D. Garman-Kohlhagen (domain briefing T2) incl. delivery lag
# --------------------------------------------------------------------------
def golden_gk() -> None:
    spot, k, t, rd, rf, vol = 1.10, 1.10, 1.0, 0.04, 0.02, 0.08
    call = garman_kohlhagen("Call", spot, k, vol, t, t, rd, rf)
    put = garman_kohlhagen("Put", spot, k, vol, t, t, rd, rf)
    t_del = t + 5.0 / 365.0
    call_lag = garman_kohlhagen("Call", spot, k, vol, t, t_del, rd, rf)
    put_lag = garman_kohlhagen("Put", spot, k, vol, t, t_del, rd, rf)
    payload = {
        "case": "garman-kohlhagen",
        "description": "EUR/USD vanilla: S 1.10, K 1.10, T 1Y, r_USD 4 %, r_EUR 2 % (continuous), σ 8 %; second set with a 5-day delivery lag (discount and forward to T+5d, vol time to expiry).",
        "derivation": "F = S·e^{(r_d − r_f)·T_del}; C = e^{−r_d T_del}[F·N(d1) − K·N(d2)], P = e^{−r_d T_del}[K·N(−d2) − F·N(−d1)] with d1 = (ln(F/K) + σ²T/2)/(σ√T); put-call parity C − P = e^{−r_d T_del}(F − K). Reference from math.erf (domain briefing T2: C = 0.045795, P = 0.024445, F = 1.122221).",
        "inputs": {"spot": spot, "strike": k, "timeToExpiry": t, "rd": rd, "rf": rf, "vol": vol, "timeToDeliveryLag": t_del},
        "expected": {
            "forward": call["forward"],
            "call": call["premium"],
            "put": put["premium"],
            "parity": math.exp(-rd * t) * (call["forward"] - k),
            "withDeliveryLag": {"forward": call_lag["forward"], "call": call_lag["premium"], "put": put_lag["premium"]},
        },
    }
    write("garman-kohlhagen.json", payload)


# --------------------------------------------------------------------------
# E. FX forward with spot-date anchor on flat curves
# --------------------------------------------------------------------------
def golden_fx_forward() -> None:
    r_eur, r_usd, spot = 0.02, 0.04, 1.10
    spot_date = d(2026, 9, 8)  # T+2 on TARGET+US: 4.9. (Fri) → 7.9. Labor Day → 8.9.
    delivery = d(2027, 9, 8)
    k = 1.12
    eur_amount = 1_000_000.0
    t_s = days(VAL, spot_date) / 365.0
    t_d = days(VAL, delivery) / 365.0
    df_eur_s, df_eur_d = df_flat(r_eur, t_s), df_flat(r_eur, t_d)
    df_usd_s, df_usd_d = df_flat(r_usd, t_s), df_flat(r_usd, t_d)
    fwd = spot * (df_eur_d / df_eur_s) / (df_usd_d / df_usd_s)
    today_rate = spot * df_usd_s / df_eur_s
    pv_usd = eur_amount * df_usd_d * (fwd - k)
    pv_eur = pv_usd / today_rate
    payload = {
        "case": "fx-forward-spot-date",
        "description": "Buy 1m EUR / sell USD at 1.12 for 2027-09-08; flat EUR 2 % and USD 4 % curves (continuous, ACT/365F), spot 1.10 quoted for the spot date 2026-09-08 (T+2 on the joint TARGET+US calendar; 2026-09-07 is Labor Day).",
        "derivation": "Covered interest parity anchored at the spot date: F = S·[DF_EUR(T)/DF_EUR(t_s)]/[DF_USD(T)/DF_USD(t_s)] = 1.10·e^{(0.04−0.02)·365/365}; PV_USD = N_EUR·DF_USD(T)·(F − K); today rate S_0 = S·DF_USD(t_s)/DF_EUR(t_s); PV_EUR = PV_USD/S_0. Closed form.",
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "spot": spot,
            "rEur": r_eur,
            "rUsd": r_usd,
            "eurAmount": eur_amount,
            "contractRate": k,
            "deliveryDate": delivery.isoformat(),
        },
        "expected": {"spotDate": spot_date.isoformat(), "fairForward": fwd, "spotAtValuationDate": today_rate, "pvUsd": pv_usd, "pvEur": pv_eur},
    }
    write("fx-forward-spot-date.json", payload)


# --------------------------------------------------------------------------
# F. ATM payer swaption on the flat 3 % curve – physical, cash CCP, cash IRR
# --------------------------------------------------------------------------
def golden_swaption() -> None:
    rate = 0.03
    notional = 10_000_000.0
    vol = 0.008
    expiry = d(2027, 9, 3)
    dates = [d(2027 + i, 9, 3) for i in range(0, 6)]  # swap 2027-09-03 … 2032-09-03
    dfs = [df_flat(rate, days(VAL, x) / 365.0) for x in dates]
    t_exp = days(VAL, expiry) / 365.0
    forward = (dfs[0] - dfs[-1]) / sum(dfs[1:])
    annuity = sum(dfs[1:])  # per unit notional, τ = 1 (30E/360)
    price_phys = notional * annuity * bachelier("Call", forward, forward, vol, t_exp)
    cash_annuity = sum(1.0 / (1.0 + forward) ** i for i in range(1, 6)) * dfs[0]
    price_irr = notional * cash_annuity * bachelier("Call", forward, forward, vol, t_exp)
    payload = {
        "case": "swaption-flat-curve",
        "description": "1Y × 5Y ATM payer swaption (N 10m) on the flat 3 % single curve; underlying annual unadjusted swap 2027-09-03 → 2032-09-03 (fixed 30E/360, float EURIBOR-12M ACT/360); flat normal vol 80 bp.",
        "derivation": "Forward swap rate F = (DF_1 − DF_6)/Σ_{i=2..6} DF_i, annuity A = Σ_{i=2..6} DF_i (discounted to today); physical and cash 'Collateralised Cash Price' = N·A·Bachelier(F, K=F, σ, T) = N·A·σ√T/√(2π); legacy IRR cash settlement = N·DF(settlement)·Σ_{i=1..5} (1+F)^{−i}·Bachelier(...). Closed form.",
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "curveId": "EUR-EURIBOR-12M",
            "flatZeroRate": rate,
            "notional": notional,
            "expiryDate": expiry.isoformat(),
            "swapStart": dates[0].isoformat(),
            "swapEnd": dates[-1].isoformat(),
            "strike": forward,
            "normalVol": vol,
        },
        "expected": {"forwardSwapRate": forward, "annuity": notional * annuity, "physical": price_phys, "cashCollateralisedCashPrice": price_phys, "cashIrr": price_irr, "expiryYears": t_exp},
    }
    write("swaption-flat-curve.json", payload)


# --------------------------------------------------------------------------
# G. 3Y cap on the flat 3 % curve, Bachelier with flat 70 bp vol
# --------------------------------------------------------------------------
def minus_weekdays(x: dt.date, n: int) -> dt.date:
    """Step back n Mon–Fri business days (no TARGET holidays fall into the early-September fixing windows used here)."""
    while n > 0:
        x -= dt.timedelta(days=1)
        if x.weekday() < 5:
            n -= 1
    return x


def golden_cap() -> None:
    rate = 0.03
    notional = 10_000_000.0
    strike = 0.03
    vol = 0.007
    dates = [d(2027 + i, 9, 3) for i in range(0, 4)]  # forward-starting cap 2027-09-03 … 2030-09-03
    dfs = [df_flat(rate, days(VAL, x) / 365.0) for x in dates]
    caplets = []
    total = 0.0
    for i in range(1, 4):
        tau = days(dates[i - 1], dates[i]) / 360.0
        fwd = (dfs[i - 1] / dfs[i] - 1.0) / tau
        fixing = minus_weekdays(dates[i - 1], 2)  # EURIBOR fixing lag 2 TARGET business days
        t_exp = days(VAL, fixing) / 365.0
        undisc = bachelier("Call", fwd, strike, vol, t_exp)
        pv = notional * tau * undisc * dfs[i]
        total += pv
        caplets.append({"fixingDate": fixing.isoformat(), "paymentDate": dates[i].isoformat(), "forward": fwd, "accrualFactor": tau, "expiryYears": t_exp, "presentValue": pv})
    payload = {
        "case": "cap-flat-curve",
        "description": "Forward-starting 3Y cap 2027-09-03 → 2030-09-03 (long, N 10m, K 3 %) on EURIBOR-12M, flat 3 % single curve, annual unadjusted periods, EURIBOR fixing lag 2 TARGET business days, Bachelier with a flat 70 bp normal vol.",
        "derivation": "Caplet_i = N·τ_i·DF(pay_i)·Bachelier(F_i, K, σ_N, T_i) with F_i = (DF_{i−1}/DF_i − 1)/τ_i (ACT/360) and T_i = ACT/365F time to the fixing date = accrual start − 2 business days (unadjusted accrual starts may fall on weekends; the fixing steps back over them). Closed form.",
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "curveId": "EUR-EURIBOR-12M",
            "flatZeroRate": rate,
            "notional": notional,
            "strike": strike,
            "normalVol": vol,
            "effectiveDate": dates[0].isoformat(),
            "terminationDate": dates[-1].isoformat(),
            "index": "EURIBOR-12M",
            "frequency": "12M",
            "dayCount": "ACT/360",
            "calendar": "NONE",
            "businessDayConvention": "Unadjusted",
        },
        "expected": {"caplets": caplets, "pv": total},
    }
    write("cap-flat-curve.json", payload)


# --------------------------------------------------------------------------
# H. Sample-market €STR OIS bootstrap (TARGET calendar, ModifiedFollowing,
#    payment lag 1, log-linear discount factors) – independent re-derivation
# --------------------------------------------------------------------------
def easter_sunday(year: int) -> dt.date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher), as in dates/calendar.ts."""
    a = year % 19
    b = year // 100
    c = year % 100
    d_ = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d_ - g + 15) % 30
    i = c // 4
    k = c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = ((h + l_ - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def target_holidays(year: int) -> set:
    e = easter_sunday(year)
    return {dt.date(year, 1, 1), e - dt.timedelta(days=2), e + dt.timedelta(days=1), dt.date(year, 5, 1), dt.date(year, 12, 25), dt.date(year, 12, 26)}


def is_target_bd(x: dt.date) -> bool:
    return x.weekday() < 5 and x not in target_holidays(x.year)


def add_bd(x: dt.date, n: int) -> dt.date:
    step = 1 if n >= 0 else -1
    remaining = abs(n)
    while remaining > 0:
        x += dt.timedelta(days=step)
        if is_target_bd(x):
            remaining -= 1
    return x


def adjust_mf(x: dt.date) -> dt.date:
    """ModifiedFollowing on TARGET."""
    y = x
    while not is_target_bd(y):
        y += dt.timedelta(days=1)
    if y.month != x.month:
        y = x
        while not is_target_bd(y):
            y -= dt.timedelta(days=1)
    return y


def days_in_month(y: int, m: int) -> int:
    return [31, 29 if (y % 4 == 0 and y % 100 != 0) or y % 400 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]


def add_months(x: dt.date, n: int) -> dt.date:
    total = x.year * 12 + (x.month - 1) + n
    y, m = divmod(total, 12)
    return dt.date(y, m + 1, min(x.day, days_in_month(y, m + 1)))


def add_tenor(x: dt.date, tenor: str) -> dt.date:
    n, unit = int(tenor[:-1]), tenor[-1].upper()
    if unit == "D":
        return x + dt.timedelta(days=n)
    if unit == "W":
        return x + dt.timedelta(days=7 * n)
    if unit == "M":
        return add_months(x, n)
    return add_months(x, 12 * n)


# The sample €STR OIS quotes (market/sample-market.ts SAMPLE_QUOTES.eurOis); the TypeScript test asserts equality.
SAMPLE_EUR_OIS = [
    ("1W", 0.0201), ("1M", 0.0202), ("3M", 0.0203), ("6M", 0.0205), ("9M", 0.0207), ("1Y", 0.021), ("18M", 0.0215), ("2Y", 0.0221), ("3Y", 0.0231),
    ("4Y", 0.0239), ("5Y", 0.0246), ("7Y", 0.0258), ("10Y", 0.0272), ("12Y", 0.0279), ("15Y", 0.0286), ("20Y", 0.0287), ("25Y", 0.0281), ("30Y", 0.0273),
]


def golden_sample_bootstrap() -> None:
    """
    Re-derive the sample €STR OIS discount curve independently of the engine.

    Conventions (curves/bootstrap.ts, index-definitions.ts): spot = valuation + 2 TARGET business days;
    accrual end = spot + tenor, ModifiedFollowing on TARGET; pillar = last payment date = accrual end + 1 TARGET
    business day (€STR payment lag 1); quotes ≤ 1Y are single-period (zero-coupon) OIS, longer quotes pay annually
    (fixed ACT/360 vs €STR compounded in arrears, short front stub, both legs on the same schedule); the first
    node is the spot date with DF = 1/(1 + r_1W·τ_spot); discount factors are interpolated log-linearly in ACT/365F
    time. Daily compounding telescopes to DF ratios, so the par conditions are algebraic in the pillar DFs:

      ≤ 1Y:  DF(accEnd) = DF(spot) / (1 + r·τ)  (closed form; the pillar DF follows from the log-linear segment
             between the previous node and the pillar, as the accrual end lies inside that segment),
      > 1Y:  Σ_i DF(pay_i)·[DF(acc_{i−1})/DF(acc_i) − 1 − r·τ_i] = 0 solved by bisection in the pillar DF
             (earlier DFs interpolated from the already solved nodes).
    """
    t = lambda x: (x - VAL).days / 365.0  # noqa: E731 – curve time ACT/365F
    spot = add_bd(VAL, 2)
    tau_spot = (spot - VAL).days / 360.0
    nodes = [(spot, 1.0 / (1.0 + SAMPLE_EUR_OIS[0][1] * tau_spot))]

    def df_at(curve, x: dt.date) -> float:
        tx = t(x)
        if tx <= 0:
            return 1.0
        times = [0.0] + [t(d_) for d_, _ in curve]
        logs = [0.0] + [math.log(f) for _, f in curve]
        if tx >= times[-1]:
            fwd = -(logs[-1] - logs[-2]) / (times[-1] - times[-2])
            return math.exp(logs[-1] - fwd * (tx - times[-1]))
        i = max(j for j in range(len(times) - 1) if times[j] <= tx)
        w = (tx - times[i]) / (times[i + 1] - times[i])
        return math.exp(logs[i] + w * (logs[i + 1] - logs[i]))

    pillars = []
    items = []
    for tenor, rate in SAMPLE_EUR_OIS:
        end_unadj = add_tenor(spot, tenor)
        acc_end = adjust_mf(end_unadj)
        pay = add_bd(acc_end, 1)
        items.append((pay, tenor, rate, end_unadj, acc_end))
    items.sort(key=lambda it: it[0])
    for pay, tenor, rate, end_unadj, acc_end in items:
        years = (end_unadj - spot).days / 365.0
        prev_date, prev_df = nodes[-1]
        if years <= 1.01:
            tau = (acc_end - spot).days / 360.0
            df_acc = nodes[0][1] / (1.0 + rate * tau)
            # log-linear segment through (prev, df_prev) and (acc_end, df_acc) evaluated at the pillar
            slope = (math.log(df_acc) - math.log(prev_df)) / (t(acc_end) - t(prev_date))
            df_pay = math.exp(math.log(prev_df) + slope * (t(pay) - t(prev_date)))
            method = "closed-form"
        else:
            # annual schedule rolled back from the unadjusted end (short front stub), ModifiedFollowing, pay lag 1
            dates = [end_unadj]
            i = 1
            while True:
                d_ = add_months(end_unadj, -12 * i)
                if d_ <= spot:
                    break
                dates.append(d_)
                i += 1
            dates.append(spot)
            dates.reverse()
            accs = [adjust_mf(d_) for d_ in dates]
            pays = [add_bd(a, 1) for a in accs[1:]]
            assert pays[-1] == pay

            def npv(df_pay_trial: float) -> float:
                curve = nodes + [(pay, df_pay_trial)]
                total = 0.0
                for j in range(1, len(accs)):
                    tau = (accs[j] - accs[j - 1]).days / 360.0
                    total += df_at(curve, pays[j - 1]) * (df_at(curve, accs[j - 1]) / df_at(curve, accs[j]) - 1.0 - rate * tau)
                return total

            lo, hi = prev_df * 0.2, min(1.0, prev_df * 1.05)
            f_lo, f_hi = npv(lo), npv(hi)
            assert f_lo * f_hi < 0, (tenor, f_lo, f_hi)
            for _ in range(200):
                mid = 0.5 * (lo + hi)
                f_mid = npv(mid)
                if f_lo * f_mid <= 0:
                    hi, f_hi = mid, f_mid
                else:
                    lo, f_lo = mid, f_mid
                if hi - lo < 1e-16:
                    break
            df_pay = 0.5 * (lo + hi)
            method = "bisection"
        nodes.append((pay, df_pay))
        pillars.append({
            "tenor": tenor,
            "rate": rate,
            "accrualEnd": acc_end.isoformat(),
            "date": pay.isoformat(),
            "time": t(pay),
            "df": df_pay,
            "zero": -math.log(df_pay) / t(pay),
            "method": method,
        })
    payload = {
        "case": "sample-market-bootstrap",
        "description": "Sample-market €STR OIS discount curve (EUR-ESTR) bootstrapped independently: TARGET calendar, spot T+2, ModifiedFollowing, €STR payment lag 1 business day, log-linear discount factors in ACT/365F time; 18 OIS quotes 1W … 30Y, valuation 2026-09-03.",
        "derivation": golden_sample_bootstrap.__doc__.strip(),
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "curveId": "EUR-ESTR",
            "index": "ESTR",
            "calendar": "TARGET",
            "spotLag": 2,
            "paymentLag": 1,
            "interpolation": "logLinear",
            "dayCount": "ACT/365F",
            "quotes": [{"type": "OIS", "tenor": tn, "rate": r} for tn, r in SAMPLE_EUR_OIS],
        },
        "expected": {
            "spotDate": spot.isoformat(),
            "spotDf": nodes[0][1],
            "pillars": pillars,
            "closedFormPillars": [p["tenor"] for p in pillars if p["method"] == "closed-form"],
        },
        "quantlib": ql_sample_bootstrap_check() if HAVE_QL else None,
    }
    if payload["quantlib"] is None:
        # Not executed in this environment: see tools/README.md for the regeneration recipe.
        payload["quantlib"] = {"status": "pending", "note": "QuantLib not installed when the file was generated; run tools/quantlib-golden.py with the QuantLib Python bindings to fill in the cross-check."}
    write("sample-market-bootstrap.json", payload)


def ql_sample_bootstrap_check():  # pragma: no cover
    """QuantLib cross-check: PiecewiseLogLinearDiscount from OISRateHelpers on an €STR-like index (TARGET, pay lag 1)."""
    ql.Settings.instance().evaluationDate = ql.Date(3, 9, 2026)
    cal = ql.TARGET()
    estr = ql.OvernightIndex("ESTR", 0, ql.EURCurrency(), cal, ql.Actual360())
    helpers = []
    for tenor, rate in SAMPLE_EUR_OIS:
        h = ql.OISRateHelper(2, ql.Period(tenor), ql.QuoteHandle(ql.SimpleQuote(rate)), estr, ql.YieldTermStructureHandle(), False, 1, ql.ModifiedFollowing, ql.Annual)
        helpers.append(h)
    curve = ql.PiecewiseLogLinearDiscount(ql.Date(3, 9, 2026), helpers, ql.Actual365Fixed())
    curve.enableExtrapolation()
    return {
        "status": "done",
        "version": ql.__version__,
        "engine": "PiecewiseLogLinearDiscount / OISRateHelper (paymentLag 1, Annual, ModifiedFollowing, TARGET)",
        # QuantLib has no spot node: the 0→spot stub is the log-linear segment 0 → 1W pillar (continuous at the 1W
        # zero), the engine's spot node is 1/(1 + r_1W·τ_spot) (simple interest) – a uniform factor 1 + 1.87e-8 on
        # every pillar DF, DF ratios between pillars identical (see test-data/golden/README.md).
        "stubConvention": "no spot node; DF(spot) log-linear between t=0 and the 1W pillar",
        "pillars": [{"date": ql.Date.to_date(d_).isoformat(), "df": curve.discount(d_)} for d_ in curve.dates()],
    }


# --------------------------------------------------------------------------
# I. CDS hazard bootstrap (N5-5): quarterly ACT/360 premium leg on ACT/365F
#    hazard time, accrual on default and protection at the period midpoint,
#    flat 2 % discount curve, R 40 % – independent re-implementation + QuantLib
# --------------------------------------------------------------------------
CDS_QUOTES = [("1Y", 0.01), ("3Y", 0.015), ("5Y", 0.02), ("10Y", 0.025)]
CDS_RECOVERY = 0.4
CDS_DISC_RATE = 0.02


def golden_cds() -> None:
    """Sequential bootstrap of a piecewise-constant hazard curve from par CDS
    spreads. Pillar times T_i are ACT/365F year fractions of the tenor dates
    (calendar months from the valuation date, no business-day adjustment). For
    each pillar the hazard λ_i on (T_{i−1}, T_i] solves premium = protection on a
    quarterly grid t_j = 0.25·j (ACT/365F years, last stub to T_i):
      premium    = s · Σ_j (t_j − t_{j−1})·(365/360) · [DF(t_j)·Q(t_j) + DF(t_j^m)·½·(Q(t_{j−1}) − Q(t_j))]
      protection = (1 − R) · Σ_j DF(t_j^m) · (Q(t_{j−1}) − Q(t_j)),   t_j^m = ½(t_{j−1} + t_j)
    with Q(t) = exp(−∫λ) (piecewise constant, earlier pillars fixed) and the
    discount factor read off a flat 2 % continuously compounded curve at the
    integer day nearest to the grid time (half up), DF(t) = exp(−r·⌊365·t + ½⌋/365)
    (the engine's curves live on integer serial dates). Solved by bisection to 1e-14.
    Without discounting (DF ≡ 1) a flat spread reproduces λ = s·(365/360)/(1 − R)
    up to the quarterly discretisation."""
    val = VAL
    # JS Math.round (half up), not Python's banker's rounding: the 6M grid point 182.5 days → 183.
    disc = lambda t: df_flat(CDS_DISC_RATE, math.floor(365 * t + 0.5) / 365.0)  # noqa: E731

    def pillar_time(tenor: str) -> float:
        return days(val, add_tenor(val, tenor)) / 365.0

    def survival(times, hazards, t):
        integral = 0.0
        prev = 0.0
        for T, h in zip(times, hazards):
            if t <= T:
                return math.exp(-(integral + h * (t - prev)))
            integral += h * (T - prev)
            prev = T
        return math.exp(-(integral + hazards[-1] * (t - prev)))

    def legs(times, hazards, T, s, dfn):
        premium = 0.0
        protection = 0.0
        prev = 0.0
        q_prev = 1.0
        grid = []
        t = 0.25
        while t < T + 1e-9:
            grid.append(min(t, T))
            t += 0.25
        if not grid or grid[-1] < T - 1e-9:
            grid.append(T)
        for tj in grid:
            q = survival(times, hazards, tj)
            d_end = dfn(tj)
            d_mid = dfn(0.5 * (prev + tj))
            premium += (tj - prev) * (365.0 / 360.0) * (d_end * q + d_mid * 0.5 * (q_prev - q))
            protection += d_mid * (q_prev - q)
            prev, q_prev = tj, q
        return s * premium - (1.0 - CDS_RECOVERY) * protection

    def bootstrap(quotes, dfn):
        times, hazards = [], []
        for tenor, s in quotes:
            T = pillar_time(tenor)
            lo, hi = 0.0, 5.0
            for _ in range(200):
                mid = 0.5 * (lo + hi)
                f = legs(times + [T], hazards + [mid], T, s, dfn)
                # premium − protection decreases in λ (more default → more protection)
                if f > 0:
                    lo = mid
                else:
                    hi = mid
            times.append(T)
            hazards.append(0.5 * (lo + hi))
        return times, hazards

    times, hazards = bootstrap(CDS_QUOTES, disc)
    flat_times, flat_hazards = bootstrap([("5Y", 0.01)], lambda t: 1.0)
    payload = {
        "case": "cds-hazard-bootstrap",
        "description": "Piecewise-constant hazard curve from par CDS spreads 100/150/200/250 bp at 1Y/3Y/5Y/10Y, recovery 40 %, flat 2 % continuously compounded discount curve, valuation 2026-09-03: quarterly ACT/360 premium accrual (ISDA standard CDS convention) on ACT/365F hazard time, accrual on default and protection at the period midpoint (N5-5).",
        "derivation": golden_cds.__doc__.strip(),
        "inputs": {
            "valuationDate": val.isoformat(),
            "recovery": CDS_RECOVERY,
            "discountRate": CDS_DISC_RATE,
            "discountDayCount": "ACT/365F",
            "premiumDayCount": "ACT/360",
            "premiumFrequency": "3M",
            "quotes": [{"tenor": tn, "spread": s} for tn, s in CDS_QUOTES],
        },
        "expected": {
            "pillars": [
                {"tenor": tn, "spread": s, "time": T, "hazard": h, "survival": survival(times, hazards, T)}
                for (tn, s), T, h in zip(CDS_QUOTES, times, hazards)
            ],
            "flatUndiscounted": {
                "tenor": "5Y",
                "spread": 0.01,
                "hazard": flat_hazards[0],
                "closedForm": 0.01 * 365.0 / 360.0 / (1.0 - CDS_RECOVERY),
                "note": "DF ≡ 1: bootstrap vs λ = s·(365/360)/(1 − R); the difference is the quarterly discretisation (≈ (λΔ)²/12).",
            },
        },
        "quantlib": ql_cds_check() if HAVE_QL else {"status": "pending", "note": "QuantLib not installed when the file was generated; run tools/quantlib-golden.py with the QuantLib Python bindings to fill in the cross-check."},
    }
    write("cds-hazard-bootstrap.json", payload)


def ql_cds_check():  # pragma: no cover
    """QuantLib cross-check: PiecewiseFlatHazardRate from SpreadCdsHelpers (ISDA engine, quarterly ACT/360, flat 2 % discount)."""
    today = ql.Date(VAL.day, VAL.month, VAL.year)
    ql.Settings.instance().evaluationDate = today
    disc = ql.YieldTermStructureHandle(ql.FlatForward(today, CDS_DISC_RATE, ql.Actual365Fixed()))
    helpers = []
    for tenor, s in CDS_QUOTES:
        helpers.append(
            ql.SpreadCdsHelper(
                ql.QuoteHandle(ql.SimpleQuote(s)), ql.Period(tenor), 0, ql.WeekendsOnly(), ql.Quarterly, ql.Following, ql.DateGeneration.Forward,
                ql.Actual360(), CDS_RECOVERY, disc, True, True, ql.Date(), ql.Actual360(), True, ql.CreditDefaultSwap.ISDA,
            )
        )
    hz = ql.PiecewiseFlatHazardRate(today, helpers, ql.Actual365Fixed())
    hz.enableExtrapolation()
    pillars = []
    for tenor, s in CDS_QUOTES:
        d_ = today + ql.Period(tenor)
        pillars.append({"tenor": tenor, "date": ql.Date.to_date(d_).isoformat(), "time": ql.Actual365Fixed().yearFraction(today, d_), "hazard": hz.hazardRate(d_ - 1), "survival": hz.survivalProbability(d_)})
    return {
        "status": "done",
        "version": ql.__version__,
        "engine": "PiecewiseFlatHazardRate / SpreadCdsHelper (ISDA engine, Quarterly, Actual360 premium, Following on WeekendsOnly, DateGeneration.Forward, settlesAccrual, paysAtDefaultTime)",
        # QuantLib integrates the default leg daily on the exact (business-day adjusted) coupon schedule; the engine's
        # quarterly grid with midpoint accrual / protection agrees to ≈ 3e-4 in survival and ≈ 3e-3 relative in the
        # hazards (the 1Y pillar carries the largest difference: QuantLib 168.10 bp vs engine 168.56 bp, QuantLib's own
        # later pillars of a flat 100 bp curve are 168.57 bp) – see test-data/golden/README.md.
        "pillars": pillars,
    }


# --------------------------------------------------------------------------
# J. Calendar cross-check (Quant R7, N7-4): weekday holidays of the rule-based
#    engine calendars vs QuantLib's calendars, 2024–2032. Pure vendor data –
#    there is no closed form; the file is only meaningful with QuantLib.
# --------------------------------------------------------------------------
CALENDAR_YEARS = list(range(2024, 2033))
# engine calendar id → QuantLib constructor ("Class" or "Class(Market)"); R8 (N8-4 / N8-5) adds US, US-SIFMA, UK, CH, JP
CALENDARS_QL = {
    "TARGET": "TARGET",
    "US": "UnitedStates(Settlement)",
    "US-SIFMA": "UnitedStates(SOFR)",
    "UK": "UnitedKingdom(Settlement)",
    "CH": "Switzerland",
    "JP": "Japan",
    "NO": "Norway",
    "SE": "Sweden",
    "DK": "Denmark",
    "PL": "Poland",
}


def ql_calendar(spec: str):  # pragma: no cover
    """Instantiate a QuantLib calendar from "Class" or "Class(Market)"."""
    if "(" in spec:
        cls, market = spec[:-1].split("(")
        klass = getattr(ql, cls)
        return klass(getattr(klass, market))
    return getattr(ql, spec)()
# Documented, intentional differences (engine right, vendor lagging): the engine keeps these holidays.
KNOWN_ENGINE_ONLY = {
    "PL": {
        "reason": "Christmas Eve (24.12.) is a statutory public holiday in Poland from 2025 (Act of 6 December 2024, Dz.U. 2024 poz. 1965); QuantLib 1.43 `Poland` does not include it yet.",
        "dates": [dt.date(y, 12, 24).isoformat() for y in CALENDAR_YEARS if y >= 2025 and dt.date(y, 12, 24).weekday() < 5],
    }
}


def golden_calendars() -> None:
    """Weekday holidays per calendar and year from QuantLib
    (`Calendar.holidayList(from, to, includeWeekends=False)`), ISO dates. The engine
    test (`src/testing/golden.test.ts`) lists every weekday holiday of its rule-based
    calendar over the same years and requires set equality except for the
    `knownEngineOnly` dates (engine ahead of the vendor: PL 24.12. from 2025).
    US-SIFMA = QuantLib `UnitedStates(SOFR)`: Settlement plus Good Friday, without
    the Friday observance of a Saturday New Year's Day / Veterans Day."""
    holidays = {}
    if HAVE_QL:
        for cal_id, ctor in CALENDARS_QL.items():
            cal = ql_calendar(ctor)
            per_year = {}
            for y in CALENDAR_YEARS:
                lst = ql.Calendar.holidayList(cal, ql.Date(1, 1, y), ql.Date(31, 12, y), False)
                per_year[str(y)] = [x.ISO() for x in lst]
            holidays[cal_id] = per_year
    payload = {
        "case": "calendars-quantlib",
        "description": "Weekday holidays 2024–2032 of the rule-based engine calendars TARGET / US (New York settlement) / US-SIFMA (SOFR fixing calendar) / UK / CH / JP / NO (Oslo) / SE (Stockholm) / DK (Copenhagen) / PL (Warsaw) cross-checked against QuantLib's TARGET / UnitedStates(Settlement) / UnitedStates(SOFR) / UnitedKingdom / Switzerland / Japan / Norway / Sweden / Denmark / Poland calendars (Quant R7, N7-4: DK Friday after Ascension, NO Christmas Eve; R8, N8-4: SOFR Good Friday, N8-5: JP substitute / citizens' holidays and equinox formula).",
        "derivation": golden_calendars.__doc__.strip(),
        "inputs": {"years": CALENDAR_YEARS, "calendars": CALENDARS_QL},
        "knownEngineOnly": KNOWN_ENGINE_ONLY,
        "quantlib": (
            {"status": "done", "version": ql.__version__, "engine": "Calendar.holidayList(includeWeekends=False)", "holidays": holidays}
            if HAVE_QL
            else {"status": "pending", "note": "QuantLib not installed when the file was generated; run tools/quantlib-golden.py with the QuantLib Python bindings to fill in the holiday lists."}
        ),
    }
    write("calendars-quantlib.json", payload)


# --------------------------------------------------------------------------
# K. RFR lockout / lookback compounding (Quant R8 N8-7, R9 N9-1): the last k
#    fixings of a SOFR period are replaced by the fixing of the business day
#    before the lockout window (ISDA 2021 "Compounded with Lockout"); the
#    reference is a closed-form manual compounding over the SIFMA business days
#    and – with QuantLib – `OvernightIndexedCoupon(lockoutDays = k)`.
# --------------------------------------------------------------------------
LOCKOUT_START = d(2026, 6, 1)
LOCKOUT_END = d(2026, 8, 3)
# US-SIFMA (SOFR publication) weekday holidays inside the window: Juneteenth, Independence Day observed (04.07. is a Saturday).
SIFMA_HOLIDAYS_2026 = {d(2026, 6, 19), d(2026, 7, 3)}
# Holidays before the window that a lookback of up to two days may reach (Memorial Day 25.05.2026).
SIFMA_HOLIDAYS_BEFORE = {d(2026, 5, 25)}


def sifma_bd(x: dt.date) -> bool:
    return x.weekday() < 5 and x not in SIFMA_HOLIDAYS_2026 and x not in SIFMA_HOLIDAYS_BEFORE


def lockout_fixing(x: dt.date) -> float:
    """Synthetic SOFR fixing: 4.00 % + 0.02 %·((d − start) mod 7), non-negative modulus."""
    return 0.04 + 0.0002 * (((x - LOCKOUT_START).days % 7 + 7) % 7)


def compounded_rate(fixing_day_of) -> float:
    """Π(1 + r(fixing_day_of(d))·τ_d) − 1 over the SIFMA business days of [start, end), divided by the ACT/360 period."""
    bdays = [x for x in (LOCKOUT_START + dt.timedelta(n) for n in range(days(LOCKOUT_START, LOCKOUT_END))) if sifma_bd(x)]
    acc = 1.0
    for i, x in enumerate(bdays):
        nxt = bdays[i + 1] if i + 1 < len(bdays) else LOCKOUT_END
        acc *= 1.0 + lockout_fixing(fixing_day_of(x, i, bdays)) * days(x, nxt) / 360.0
    return (acc - 1.0) / (days(LOCKOUT_START, LOCKOUT_END) / 360.0)


def prev_bd(x: dt.date, n: int) -> dt.date:
    while n > 0:
        x -= dt.timedelta(1)
        if sifma_bd(x):
            n -= 1
    return x


def golden_lockout() -> None:
    """SOFR period 01.06.–03.08.2026 (ACT/360, τ = 63/360), fixings 4.00 % + 0.02 %·((d − start) mod 7)
    on the SIFMA business days (Juneteenth 19.06. and 03.07.2026 are no publication days).
    Lockout k: the last k business days of the period carry the fixing of the business day
    before the window (`bdays[-k-1]`), every other day its own fixing. Lookback n: day d
    carries the fixing of the n-th SIFMA business day before d, weights from the accrual
    period (no observation shift). Compounded rate = (Π(1 + r_i·τ_i) − 1)/τ. QuantLib:
    `OvernightIndexedCoupon(…, Sofr with the same fixings, Actual360, lookbackDays, lockoutDays)`
    with `CompoundingOvernightIndexedCouponPricer`."""
    cases = []
    for k in range(0, 4):
        def fixing_day(x, i, bdays, k=k):
            return bdays[-k - 1] if k > 0 and i >= len(bdays) - k else x
        cases.append({"lockoutDays": k, "lookbackDays": 0, "rate": compounded_rate(fixing_day)})
    for n in (1, 2):
        cases.append({"lockoutDays": 0, "lookbackDays": n, "rate": compounded_rate(lambda x, i, bdays, n=n: prev_bd(x, n))})
    ql_block = {"status": "pending", "note": "QuantLib not installed when the file was generated; run tools/quantlib-golden.py with the QuantLib Python bindings."}
    if HAVE_QL:
        cal = ql.UnitedStates(ql.UnitedStates.SOFR)
        start = ql.Date(LOCKOUT_START.day, LOCKOUT_START.month, LOCKOUT_START.year)
        end = ql.Date(LOCKOUT_END.day, LOCKOUT_END.month, LOCKOUT_END.year)
        saved = ql.Settings.instance().evaluationDate
        ql.Settings.instance().evaluationDate = ql.Date(VAL.day, VAL.month, VAL.year)
        # the engine's holiday assumptions must match the vendor calendar
        for x in (LOCKOUT_START + dt.timedelta(n) for n in range(-10, days(LOCKOUT_START, LOCKOUT_END) + 1)):
            assert cal.isBusinessDay(ql.Date(x.day, x.month, x.year)) == sifma_bd(x), x
        ql_cases = []
        for c in cases:
            idx = ql.Sofr()
            idx.clearFixings()
            x = LOCKOUT_START - dt.timedelta(10)
            while x <= LOCKOUT_END:
                if sifma_bd(x):
                    idx.addFixing(ql.Date(x.day, x.month, x.year), lockout_fixing(x))
                x += dt.timedelta(1)
            cpn = ql.OvernightIndexedCoupon(end, 1.0, start, end, idx, 1.0, 0.0, ql.Date(), ql.Date(), ql.Actual360(), False, ql.RateAveraging.Compound, c["lookbackDays"], c["lockoutDays"], False)
            cpn.setPricer(ql.CompoundingOvernightIndexedCouponPricer())
            ql_cases.append({"lockoutDays": c["lockoutDays"], "lookbackDays": c["lookbackDays"], "rate": cpn.rate(), "lastFixingDates": [y.ISO() for y in cpn.fixingDates()][-5:]})
        ql.Settings.instance().evaluationDate = saved
        ql_block = {"status": "done", "version": ql.__version__, "engine": "OvernightIndexedCoupon + CompoundingOvernightIndexedCouponPricer, Sofr() with the synthetic fixings", "cases": ql_cases}
    payload = {
        "case": "rfr-lockout-quantlib",
        "description": "Compounded SOFR rate of the period 2026-06-01 → 2026-08-03 (ACT/360) with lockout k = 0…3 and lookback 1/2 on the US-SIFMA fixing calendar, fixings 4.00 % + 0.02 %·((d − start) mod 7) (Quant R8 N8-7, R9 N9-1: the last k fixings are replaced by the fixing of the business day before the lockout window – lockoutDays 1 must change the rate).",
        "derivation": golden_lockout.__doc__.strip(),
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "index": "SOFR",
            "fixingCalendar": "US-SIFMA",
            "accrualStart": LOCKOUT_START.isoformat(),
            "accrualEnd": LOCKOUT_END.isoformat(),
            "dayCount": "ACT/360",
            "fixingRule": "0.04 + 0.0002 * (((d - start) mod 7) + 7 mod 7), d and start as serial dates, on every SIFMA business day from start − 10 to end",
            "fixingHolidays": sorted(x.isoformat() for x in SIFMA_HOLIDAYS_2026 | SIFMA_HOLIDAYS_BEFORE),
        },
        "expected": {"cases": cases},
        "quantlib": ql_block,
    }
    write("rfr-lockout-quantlib.json", payload)


# --------------------------------------------------------------------------
# L. RFR lookback with observation shift and lookback on holiday-start periods
#    (Quant R10 N10-1 / N10-3): with `observationShift` the daily weights AND the
#    divisor come from the observation period (ISDA 2021 "Compounded with
#    Observation Period Shift"), a period starting on a fixing holiday looks
#    back from the business day whose rate is in effect on the start
#    (`obs(inEffect(start))`, QuantLib `advance(adjust(start, Preceding), -n)`).
#    Reference: closed-form manual compounding over the SIFMA business days and,
#    with QuantLib, `OvernightIndexedCoupon(lookbackDays, 0, applyObservationShift)`.
# --------------------------------------------------------------------------
# SIFMA (SOFR publication) weekday holidays that the periods below or their lookback windows touch:
# Presidents' Day, Good Friday, Memorial Day 2026 for the realised periods; the 2Y swap window (Aug 2026 – Sep 2028)
# per QuantLib `UnitedStates(SOFR)` (asserted against the vendor calendar below; no Friday observance of the
# Saturday New Year 01.01.2028, so 31.12.2027 is a publication day).
OBS_SIFMA_HOLIDAYS = {d(2026, 2, 16), d(2026, 4, 3), d(2026, 5, 25)} | {
    dt.date.fromisoformat(s)
    for s in (
        "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
        "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24", "2028-01-17",
        "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04",
    )
}
OBS_PERIODS = [
    (d(2026, 5, 1), d(2026, 6, 1), "monthly period, 31 accrual vs 28 observation days at lookback 5 (N10-1 reviewer case)"),
    (d(2026, 4, 3), d(2026, 5, 4), "starts on Good Friday 03.04.2026 – a SIFMA holiday (N10-3 reviewer case)"),
    (d(2026, 3, 3), d(2026, 4, 3), "ends on Good Friday 03.04.2026"),
    (d(2026, 3, 19), d(2026, 4, 20), "regular period (business-day start and end)"),
    (d(2026, 3, 2), d(2026, 6, 2), "quarterly period with equally long accrual and observation periods (92/92 days)"),
]
OBS_LOOKBACKS = (1, 2, 5)
# Projected 2Y SOFR swap (quarterly, 100 Mio.) on a flat 4 % curve: evaluation date before the first observation day.
OBS_SWAP_EVAL = d(2026, 8, 28)
OBS_SWAP_START = d(2026, 9, 8)
OBS_SWAP_END = d(2028, 9, 8)
OBS_SWAP_FLAT_RATE = 0.04
OBS_SWAP_NOTIONAL = 100e6


def obs_sifma_bd(x: dt.date) -> bool:
    return x.weekday() < 5 and x not in OBS_SIFMA_HOLIDAYS


def obs_prev_bd(x: dt.date, n: int) -> dt.date:
    while n > 0:
        x -= dt.timedelta(1)
        if obs_sifma_bd(x):
            n -= 1
    return x


def obs_in_effect(x: dt.date) -> dt.date:
    """Business day whose SOFR fixing is in effect on x (x itself, or the last business day before a holiday)."""
    return x if obs_sifma_bd(x) else obs_prev_bd(x, 1)


def obs_accrual_days(start: dt.date, end: dt.date) -> list:
    """Accrual day starts: the period start (even on a holiday) and every SIFMA business day strictly inside."""
    return [start] + [start + dt.timedelta(n) for n in range(1, days(start, end)) if obs_sifma_bd(start + dt.timedelta(n))]


def obs_shift_rate(start: dt.date, end: dt.date, lookback: int, shift: bool, fixing) -> float:
    """Compounded rate with lookback n (fixing of day d = obs(inEffect(d)) = n-th SIFMA business day before the
    business day in effect on d) and optionally observation shift (weights and divisor from the observation
    period [obs(inEffect(start)), obs(end)) instead of the accrual period [start, end))."""
    def obs(x):
        return obs_prev_bd(x, lookback) if lookback else x
    starts = obs_accrual_days(start, end)
    stops = starts[1:] + [end]
    acc = 1.0
    for x, stop in zip(starts, stops):
        od = obs(obs_in_effect(x))
        tau = days(od, obs(stop)) / 360.0 if shift else days(x, stop) / 360.0
        acc *= 1.0 + fixing(od) * tau
    divisor = days(obs(obs_in_effect(start)), obs(end)) / 360.0 if shift else days(start, end) / 360.0
    return (acc - 1.0) / divisor


def obs_swap_periods() -> list:
    """Quarterly accrual periods of the 2Y swap, ModifiedFollowing on the US settlement calendar (QuantLib when available,
    otherwise the checked-in dates)."""
    if HAVE_QL:
        cal = ql.UnitedStates(ql.UnitedStates.Settlement)
        sch = ql.Schedule(ql.Date(OBS_SWAP_START.day, OBS_SWAP_START.month, OBS_SWAP_START.year),
                          ql.Date(OBS_SWAP_END.day, OBS_SWAP_END.month, OBS_SWAP_END.year),
                          ql.Period(3, ql.Months), cal, ql.ModifiedFollowing, ql.ModifiedFollowing, ql.DateGeneration.Forward, False)
        ds = [dt.date(x.year(), x.month(), x.dayOfMonth()) for x in sch.dates()]
        return list(zip(ds[:-1], ds[1:]))
    ds = [d(2026, 9, 8), d(2026, 12, 8), d(2027, 3, 8), d(2027, 6, 8), d(2027, 9, 8), d(2027, 12, 8), d(2028, 3, 8), d(2028, 6, 8), d(2028, 9, 8)]
    return list(zip(ds[:-1], ds[1:]))


def golden_obs_shift() -> None:
    """Realised SOFR periods (ACT/360, SIFMA fixing calendar, fixings 4.00 % + 0.02 %·((d − start) mod 7) relative to
    each period's start) with lookback n = 1, 2, 5 – without and with observation shift. Fixing of accrual day d =
    the n-th SIFMA business day before the business day whose rate is in effect on d (`obs(inEffect(d))`, N10-3: a
    period starting on Good Friday looks back from the Thursday). Without shift the weights are the accrual days
    and the divisor is the accrual period; with shift the weights are the observation days
    [obs(inEffect(d)), obs(stop)) and the divisor is the observation period [obs(inEffect(start)), obs(end)) –
    ISDA 2021 "Compounded with Observation Period Shift" (N10-1: 01.05.–01.06.2026 has 31 accrual but 28
    observation days at lookback 5). Projected block: 2Y SOFR swap (quarterly, 100 Mio., ModifiedFollowing on the
    US settlement calendar) on a flat 4 % continuously compounded ACT/365F curve as of 2026-08-28 – coupon rate =
    (DF(obs(inEffect(start)))/DF(obs(end)) − 1)/τ_obs with shift, (DF(start)/DF(end) − 1)/τ_acc without lookback;
    coupon = N·rate·τ_acc. QuantLib: `OvernightIndexedCoupon(…, Sofr, Actual360, lookbackDays, 0,
    applyObservationShift)` with `CompoundingOvernightIndexedCouponPricer`; the flat curve as `FlatForward`."""
    cases = []
    for start, end, note in OBS_PERIODS:
        def fixing(x, start=start):
            return 0.04 + 0.0002 * (((x - start).days % 7 + 7) % 7)
        for n in OBS_LOOKBACKS:
            for shift in (False, True):
                cases.append({
                    "accrualStart": start.isoformat(),
                    "accrualEnd": end.isoformat(),
                    "note": note,
                    "lookbackDays": n,
                    "observationShift": shift,
                    "observationStart": obs_prev_bd(obs_in_effect(start), n).isoformat(),
                    "observationEnd": obs_prev_bd(end, n).isoformat(),
                    "rate": obs_shift_rate(start, end, n, shift, fixing),
                })
    # projected swap coupons on the flat curve
    def df(x):
        return math.exp(-OBS_SWAP_FLAT_RATE * days(OBS_SWAP_EVAL, x) / 365.0)
    swap_cases = []
    for start, end in obs_swap_periods():
        tau_acc = days(start, end) / 360.0
        plain = (df(start) / df(end) - 1.0) / tau_acc
        o_start = obs_prev_bd(obs_in_effect(start), 5)
        o_end = obs_prev_bd(end, 5)
        tau_obs = days(o_start, o_end) / 360.0
        shifted = (df(o_start) / df(o_end) - 1.0) / tau_obs
        swap_cases.append({
            "accrualStart": start.isoformat(),
            "accrualEnd": end.isoformat(),
            "accrualDays": days(start, end),
            "observationStart": o_start.isoformat(),
            "observationEnd": o_end.isoformat(),
            "observationDays": days(o_start, o_end),
            "rateLookback0": plain,
            "couponLookback0": OBS_SWAP_NOTIONAL * plain * tau_acc,
            "rateLookback5Shift": shifted,
            "couponLookback5Shift": OBS_SWAP_NOTIONAL * shifted * tau_acc,
        })
    ql_block = {"status": "pending", "note": "QuantLib not installed when the file was generated; run tools/quantlib-golden.py with the QuantLib Python bindings."}
    if HAVE_QL:
        cal = ql.UnitedStates(ql.UnitedStates.SOFR)
        saved = ql.Settings.instance().evaluationDate
        ql.Settings.instance().evaluationDate = ql.Date(VAL.day, VAL.month, VAL.year)
        # the file's holiday assumptions must match the vendor calendar over every period and lookback window
        for x in (d(2026, 2, 9) + dt.timedelta(n) for n in range(days(d(2026, 2, 9), d(2026, 6, 3)))):
            assert cal.isBusinessDay(ql.Date(x.day, x.month, x.year)) == obs_sifma_bd(x), x
        for x in (d(2026, 8, 1) + dt.timedelta(n) for n in range(days(d(2026, 8, 1), d(2028, 10, 1)))):
            assert cal.isBusinessDay(ql.Date(x.day, x.month, x.year)) == obs_sifma_bd(x), x
        ql_cases = []
        for c in cases:
            start = dt.date.fromisoformat(c["accrualStart"])
            end = dt.date.fromisoformat(c["accrualEnd"])
            idx = ql.Sofr()
            idx.clearFixings()
            x = start - dt.timedelta(15)
            while x <= end:
                if obs_sifma_bd(x):
                    idx.addFixing(ql.Date(x.day, x.month, x.year), 0.04 + 0.0002 * (((x - start).days % 7 + 7) % 7))
                x += dt.timedelta(1)
            cpn = ql.OvernightIndexedCoupon(ql.Date(end.day, end.month, end.year), 1.0, ql.Date(start.day, start.month, start.year),
                                            ql.Date(end.day, end.month, end.year), idx, 1.0, 0.0, ql.Date(), ql.Date(), ql.Actual360(), False,
                                            ql.RateAveraging.Compound, c["lookbackDays"], 0, c["observationShift"])
            cpn.setPricer(ql.CompoundingOvernightIndexedCouponPricer())
            vd = cpn.valueDates()
            ql_cases.append({
                "accrualStart": c["accrualStart"], "accrualEnd": c["accrualEnd"], "lookbackDays": c["lookbackDays"],
                "observationShift": c["observationShift"], "rate": cpn.rate(),
                "firstValueDate": vd[0].ISO(), "lastValueDate": vd[-1].ISO(),
                "firstFixingDates": [y.ISO() for y in cpn.fixingDates()][:3],
                "sumDt": sum(cpn.dt()),
            })
        # projected swap on the flat curve
        ql.Settings.instance().evaluationDate = ql.Date(OBS_SWAP_EVAL.day, OBS_SWAP_EVAL.month, OBS_SWAP_EVAL.year)
        flat = ql.FlatForward(ql.Date(OBS_SWAP_EVAL.day, OBS_SWAP_EVAL.month, OBS_SWAP_EVAL.year), OBS_SWAP_FLAT_RATE, ql.Actual365Fixed(), ql.Continuous)
        sofr = ql.Sofr(ql.YieldTermStructureHandle(flat))
        ql_swap = []
        for start, end in obs_swap_periods():
            row = {"accrualStart": start.isoformat(), "accrualEnd": end.isoformat()}
            for key, (n, shift) in {"rateLookback0": (0, False), "rateLookback5Shift": (5, True), "rateLookback5NoShift": (5, False)}.items():
                cpn = ql.OvernightIndexedCoupon(ql.Date(end.day, end.month, end.year), OBS_SWAP_NOTIONAL, ql.Date(start.day, start.month, start.year),
                                                ql.Date(end.day, end.month, end.year), sofr, 1.0, 0.0, ql.Date(), ql.Date(), ql.Actual360(), False,
                                                ql.RateAveraging.Compound, n, 0, shift)
                cpn.setPricer(ql.CompoundingOvernightIndexedCouponPricer())
                row[key] = cpn.rate()
                row[key.replace("rate", "coupon")] = cpn.amount()
            ql_swap.append(row)
        ql.Settings.instance().evaluationDate = saved
        ql_block = {
            "status": "done", "version": ql.__version__,
            "engine": "OvernightIndexedCoupon + CompoundingOvernightIndexedCouponPricer, Sofr() with the synthetic fixings; swap: Sofr on FlatForward(4 %, Actual365Fixed, Continuous)",
            "cases": ql_cases,
            "swap": ql_swap,
        }
    payload = {
        "case": "rfr-observation-shift-quantlib",
        "description": "Compounded SOFR rates with lookback 1/2/5 without and with observation shift on five periods (monthly 01.05.–01.06.2026 with 31 vs 28 days, start on Good Friday, end on Good Friday, regular, quarterly 92/92) plus the projected coupons of a 2Y SOFR swap (lookback 5 + observation shift) on a flat curve (Quant R10 N10-1: divisor = observation period; N10-3: lookback from the business day in effect on a holiday start).",
        "derivation": golden_obs_shift.__doc__.strip(),
        "inputs": {
            "valuationDate": VAL.isoformat(),
            "index": "SOFR",
            "fixingCalendar": "US-SIFMA",
            "dayCount": "ACT/360",
            "fixingRule": "0.04 + 0.0002 * (((d - accrualStart) mod 7) + 7 mod 7) on every SIFMA business day from accrualStart − 15 to accrualEnd, per period",
            "fixingHolidays": sorted(x.isoformat() for x in OBS_SIFMA_HOLIDAYS),
            "swap": {
                "evaluationDate": OBS_SWAP_EVAL.isoformat(),
                "flatRate": OBS_SWAP_FLAT_RATE,
                "flatCurveDayCount": "ACT/365F",
                "compounding": "continuous",
                "notional": OBS_SWAP_NOTIONAL,
                "lookbackDays": 5,
                "scheduleCalendar": "US",
                "frequency": "3M",
            },
        },
        "expected": {"cases": cases, "swap": swap_cases},
        "quantlib": ql_block,
    }
    write("rfr-observation-shift-quantlib.json", payload)


if __name__ == "__main__":
    print("QuantLib available:", HAVE_QL)
    golden_swap()
    golden_ois()
    golden_black_bachelier()
    golden_gk()
    golden_fx_forward()
    golden_swaption()
    golden_cap()
    golden_sample_bootstrap()
    golden_cds()
    golden_calendars()
    golden_lockout()
    golden_obs_shift()
    sys.exit(0)
