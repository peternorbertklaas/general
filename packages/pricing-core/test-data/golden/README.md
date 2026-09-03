# Golden master (independent reference values)

Each JSON file in this folder pins reference values for one valuation case.
The values are **not** produced by the TypeScript engine: they are derived
independently by `tools/quantlib-golden.py` (Python standard library, closed
forms; QuantLib cross-check when the bindings are installed – optional, never
required in CI) and checked in. `src/testing/golden.test.ts` reproduces every
case with the engine and compares at **1e-6 relative tolerance**.

Regenerate with `python3 tools/quantlib-golden.py` (from `packages/pricing-core`).
Every file carries `description`, `derivation` (how the numbers were obtained),
`inputs` and `expected`; when QuantLib was available at generation time a
`quantlib` block with its cross-check values is added.

| File                        | Case                                                                                                                                                                                                          | Reference derivation                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swap-flat-curve.json`      | 5Y EUR payer swap, flat 3 % continuous single curve (`EUR-EURIBOR-12M` discounts and projects), annual unadjusted periods 2026-09-03 → 2031-09-03, fixed 30E/360, float EURIBOR-12M ACT/360 with fixing lag 0 | DF_i = e^{−0.03·days/365}; par = (DF₀ − DF₅)/ΣDF_i (τ_fix = 1 exactly under 30E/360); float coupon_i = N·(DF_{i−1}/DF_i − 1) because forward × ACT/360 accrual telescopes; PV_float = N·(1 − DF₅). Cashflow table (amount, DF, PV) per leg. QuantLib equivalent: `VanillaSwap` on `FlatForward(0.03, Actual365Fixed, Continuous)`, `NullCalendar`, `Unadjusted`. |
| `ois-flat-curve.json`       | 2Y €STR OIS (payer), flat 2.5 % €STR curve, annual unadjusted periods, ACT/360 both legs, payment lag 0                                                                                                       | Daily compounding Π(1 + f_j τ_j) with curve forwards telescopes to DF_{start}/DF_{end}, hence compounded rate_i = (DF_{i−1}/DF_i − 1)/τ_i independent of the business-day grid; par = (1 − DF₂)/Σ τ_i DF_i.                                                                                                                                                      |
| `black76-bachelier.json`    | Hull caplet (F 7 %, K 8 %, σ 20 %, T 1, τ 0.25, N 10m, 15M zero 6.5 %) and ATM Bachelier payer swaption (F = K = 2.5 %, σ_N 80 bp, T 1, A 4.5)                                                                | Black-76 with `math.erf`: d₁ = −0.567657, d₂ = −0.767657, caplet 5 190.05; Bachelier ATM = A·σ√T/√(2π) = 0.014362 (domain briefing T1/T3).                                                                                                                                                                                                                       |
| `garman-kohlhagen.json`     | EUR/USD vanilla S 1.10, K 1.10, T 1, r_d 4 %, r_f 2 %, σ 8 %; second set with a 5-day delivery lag                                                                                                            | F = S·e^{(r_d−r_f)T_del} = 1.122221; C = 0.045795, P = 0.024445 (domain briefing T2); with lag the discount factor and forward use T_del, the vol time T.                                                                                                                                                                                                        |
| `fx-forward-spot-date.json` | Buy 1m EUR / sell USD at 1.12 for 2027-09-08, flat EUR 2 % / USD 4 %, spot 1.10 for the spot date 2026-09-08 (T+2 on TARGET+US, Labor Day 2026-09-07 skipped)                                                 | Spot-date-anchored interest parity F = S·[DF_EUR(T)/DF_EUR(t_s)]/[DF_USD(T)/DF_USD(t_s)]; PV_USD = N·DF_USD(T)·(F − K); today rate S₀ = S·DF_USD(t_s)/DF_EUR(t_s); PV_EUR = PV_USD/S₀.                                                                                                                                                                           |
| `swaption-flat-curve.json`  | 1Y × 5Y ATM payer swaption, N 10m, flat 3 % single curve, flat normal vol 80 bp; physical, cash "Collateralised Cash Price", cash IRR                                                                         | F = (DF₁ − DF₆)/Σ_{2..6} DF_i; A = Σ_{2..6} DF_i; physical = CCP cash = N·A·σ√T/√(2π); IRR cash = N·DF(settlement)·Σ_{i=1..5}(1+F)^{−i}·Bachelier.                                                                                                                                                                                                               |
| `cap-flat-curve.json`       | Forward-starting 3Y cap 2027-09-03 → 2030-09-03 on EURIBOR-12M, N 10m, K 3 %, flat 3 % single curve, flat normal vol 70 bp                                                                                    | Caplet_i = N·τ_i·DF(pay_i)·Bachelier(F_i, K, σ_N, T_i) with F_i = (DF_{i−1}/DF_i − 1)/τ_i and T_i = time to fixing (accrual start − 2 business days).                                                                                                                                                                                                            |

Design notes

- Flat continuously compounded curves and unadjusted annual schedules are
  used so that every reference is a closed form – no calendar or
  interpolation model has to be re-implemented on the Python side. The
  engine's `flatCurve` interpolates log-linearly between nodes of e^{−rt}, i.e.
  it is exact at every date.
- The cases exercise the engine end to end (schedules, day counts, leg pricer,
  curve lookup, spot-date logic, settlement conventions, model formulas), not
  the models in isolation. Sample-market cases are covered by the invariants and
  literature values in the regular test suites; they cannot be pinned
  independently without a vendor system.
- When QuantLib is installed (`pip install QuantLib`) the script additionally
  writes a `quantlib` block; the TypeScript test compares against `expected`
  only, so CI does not depend on QuantLib.
