# Tools

## `gen-version.mjs`

Generates `src/version.ts` from `package.json` (`prebuild` / `pretest` hook) so the
engine version embedded in every report has a single source.

## `gen-index.mjs` – curated public surface (ADR-024)

Prints `src/index.ts` with every `export * from "<module>"` expanded into an explicit
named export list (values first, then `type` exports) using the TypeScript compiler
API. Since round 5 (N4-03) `index.ts` contains no wildcard re-export any more; run
the script after adding a module or an export to get the list to paste and curate:

```sh
cd packages/pricing-core
node tools/gen-index.mjs > /tmp/index.ts && diff src/index.ts /tmp/index.ts
```

Lines that are already explicit are kept verbatim, so the script is idempotent on
a curated file; a name exported by two modules (e.g. `addDays`, re-exported by
`dates/calendar.ts`) must be listed once only.

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

| Case                      | QuantLib objects                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `swap-flat-curve`         | `VanillaSwap` on `FlatForward(0.03, Actual365Fixed, Continuous)`, `NullCalendar`, `Unadjusted` → `NPV`, `fairRate`, leg NPVs |
| `black76-bachelier`       | `blackFormula`, `bachelierBlackFormula`                                                                                      |
| `sample-market-bootstrap` | `PiecewiseLogLinearDiscount` from `OISRateHelper`s on an `OvernightIndex` (TARGET, spot lag 2, payment lag 1, `Annual`)      |
| `cds-hazard-bootstrap`    | `PiecewiseFlatHazardRate` from `SpreadCdsHelper`s (ISDA engine, `Quarterly`, `Actual360` premium, flat 2 % discount, R 40 %) |

Expected (and asserted) agreement:

- flat-curve swap, Black-76, Bachelier: 1e-13 relative (identical formulas);
- CDS hazard bootstrap (N5-5): **survival probabilities within 3e-4, hazards within
  3e-3 relative** at the 1Y/3Y/5Y/10Y pillars. The engine accrues the premium
  ACT/360 on a quarterly ACT/365F grid with accrual-on-default and protection at
  the period midpoint; QuantLib's ISDA engine integrates the default leg daily on
  the business-day-adjusted coupon schedule. Largest difference at 1Y: QuantLib
  168.10 bp vs engine 168.56 bp for 100 bp / R 40 % (QuantLib's own later pillars of
  a flat 100 bp curve are 168.57 bp); the round-4 ACT/365F accrual gave 166.67 bp;
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
