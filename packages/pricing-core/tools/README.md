# Tools

## `gen-version.mjs`

Generates `src/version.ts` from `package.json` (`prebuild` / `pretest` hook) so the
engine version embedded in every report has a single source.

## `gen-index.mjs` – curated public surface and `./internal` entry point (ADR-024)

Two entry points exist since round 6 (N6-01): `src/index.ts` is the public,
SemVer-covered surface (`@deriva/pricing-core`), `src/internal.ts` the
implementation helpers (`@deriva/pricing-core/internal`, no SemVer promise – root
finding, interpolation coefficients, leg-pricing helpers, vol-quotation conversion,
exposure engines, `nextTradeId`, sample vol surfaces). Both are explicit name lists,
no `export *`.

```sh
cd packages/pricing-core
node tools/gen-index.mjs > /tmp/index.ts && diff src/index.ts /tmp/index.ts       # expand `export *` lines (default: src/index.ts)
node tools/gen-index.mjs src/internal.ts > /tmp/internal.ts                        # same for the internal entry
node tools/gen-index.mjs --check                                                   # verify both entry points
```

`--check` fails (exit 1) when a module export is reachable from neither entry point,
when a name is exported by both, or when a name imported from `@deriva/pricing-core`
anywhere under `apps/*/src` (tests included) is not public. `src/surface.test.ts`
runs the check as part of the suite, so adding an export without listing it – or
moving a name the API/Web still imports into `internal.ts` – breaks the build.
Lines that are already explicit are kept verbatim by the expansion, so the script is
idempotent on a curated file; a name exported by two modules (e.g. `addDays`,
re-exported by `dates/calendar.ts`) must be listed once only.

## `quantlib-golden.py` – golden-master reference values

Writes `test-data/golden/*.json`. Every `expected` value is derived **independently
of the TypeScript engine** with the Python standard library (closed forms on flat
curves; for the sample-market bootstrap an independent re-implementation of the
€STR OIS par conditions with the TARGET calendar, see the `derivation` field of the
JSON). `src/testing/golden.test.ts` reproduces every case with the engine at 1e-6
relative tolerance (tighter for the bootstrap) and asserts the `quantlib` blocks.

```sh
cd packages/pricing-core
python3 tools/quantlib-golden.py          # regenerates all JSON files (quantlib blocks only with the bindings)
npx prettier --write test-data            # the script writes plain json.dump output
npx vitest run src/testing/golden.test.ts
```

### QuantLib cross-check (done – QuantLib 1.43)

When the QuantLib Python bindings are importable the script adds a `quantlib`
block with the vendor values (and the QuantLib `version`) next to the closed-form
`expected` values. The checked-in files were generated **with QuantLib 1.43**
(review R4-4); `golden.test.ts` asserts the blocks, CI itself never needs QuantLib.
To refresh them (no virtualenv needed – install into a scratch directory):

```sh
pip install --target /tmp/pyql QuantLib          # wheels for CPython 3.9–3.13 on Linux/macOS/Windows
PYTHONPATH=/tmp/pyql python3 tools/quantlib-golden.py
npx prettier --write test-data
git diff test-data/golden                        # review the quantlib blocks, commit
```

What the cross-check computes:

| Case                      | QuantLib objects                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swap-flat-curve`         | `VanillaSwap` on `FlatForward(0.03, Actual365Fixed, Continuous)`, `NullCalendar`, `Unadjusted` → `NPV`, `fairRate`, leg NPVs                                                                                                                                                              |
| `black76-bachelier`       | `blackFormula`, `bachelierBlackFormula`                                                                                                                                                                                                                                                   |
| `sample-market-bootstrap` | `PiecewiseLogLinearDiscount` from `OISRateHelper`s on an `OvernightIndex` (TARGET, spot lag 2, payment lag 1, `Annual`)                                                                                                                                                                   |
| `cds-hazard-bootstrap`    | `PiecewiseFlatHazardRate` from `SpreadCdsHelper`s (ISDA engine, `Quarterly`, `Actual360` premium, flat 2 % discount, R 40 %)                                                                                                                                                              |
| `calendars-quantlib`      | `TARGET()`, `Norway()`, `Sweden()`, `Denmark()`, `Poland()` → `Calendar.holidayList(1.1.–31.12., includeWeekends=False)` for 2024–2032 (N7-4; the file has no `expected` block – it is vendor data only)                                                                                  |
| `rfr-lockout-quantlib`    | `OvernightIndexedCoupon(…, Sofr(), Actual360, lookbackDays, lockoutDays)` + `CompoundingOvernightIndexedCouponPricer` on the SIFMA calendar with synthetic fixings – lockout 0…3, lookback 1/2 (N8-7 / N9-1); `expected` is the closed-form manual compounding, bit-identical to QuantLib |

Expected (and asserted) agreement:

- flat-curve swap, Black-76, Bachelier: 1e-13 relative (identical formulas);
- CDS hazard bootstrap (N5-5): **survival probabilities within 3e-4, hazards within
  3e-3 relative** at the 1Y/3Y/5Y/10Y pillars. The engine accrues the premium
  ACT/360 on a quarterly ACT/365F grid with accrual-on-default and protection at
  the period midpoint; QuantLib's ISDA engine integrates the default leg daily on
  the business-day-adjusted coupon schedule. Largest difference at 1Y: QuantLib
  168.10 bp vs engine 168.56 bp for 100 bp / R 40 % (QuantLib's own later pillars of
  a flat 100 bp curve are 168.57 bp); the round-4 ACT/365F accrual gave 166.67 bp;
- calendars (N7-4): **weekday holidays identical per calendar and year** 2024–2032
  for TARGET / NO / SE / DK / PL, except the documented `knownEngineOnly` dates
  (PL 24.12. from 2025, a statutory holiday QuantLib 1.43 does not have yet);
- sample bootstrap: **DF ratios between neighbouring pillars 1e-12** (identical
  schedules, calendar, stub rule, payment lag and interpolation), **absolute pillar
  DFs within 5e-8 – uniformly +1.87·10⁻⁸** on every pillar. The uniform factor is
  the 0→spot stub convention, not a numerical or convention problem: the engine
  has an explicit spot node DF = 1/(1 + r_1W·τ_spot) (simple interest over the 4
  days to spot), QuantLib has no spot node and interpolates log-linearly from
  t = 0 to the 1W pillar (continuous compounding at the 1W zero);
  ln DF_QL − ln DF_engine = ln(1 + r·τ_s) − (τ_s/τ_1W)·ln(1 + r·τ_1W) ≈ (r²/2)·τ_s·(τ_1W − τ_s).
  The test checks this identity to 1e-10 (details in `test-data/golden/README.md`).

A pillar-dependent difference would point to a convention mismatch (payment lag,
stub or end-of-month rule) – document it in `test-data/golden/README.md` instead of
loosening the tolerance.
