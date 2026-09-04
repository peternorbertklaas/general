# Tools

## `gen-version.mjs`

Generates `src/version.ts` from `package.json` (`prebuild` / `pretest` hook) so the
engine version embedded in every report has a single source.

## `quantlib-golden.py` – golden-master reference values

Writes `test-data/golden/*.json`. Every `expected` value is derived **independently
of the TypeScript engine** with the Python standard library (closed forms on flat
curves; for the sample-market bootstrap an independent re-implementation of the
€STR OIS par conditions with the TARGET calendar, see the `derivation` field of the
JSON). `src/testing/golden.test.ts` reproduces every case with the engine at 1e-6
relative tolerance.

```sh
cd packages/pricing-core
python3 tools/quantlib-golden.py          # regenerates all JSON files
npx vitest run src/testing/golden.test.ts
```

### QuantLib cross-check (optional, currently pending)

When the QuantLib Python bindings are importable the script adds a `quantlib`
block with the vendor values next to the closed-form `expected` values (the
TypeScript test compares against `expected` only, so CI never needs QuantLib).
QuantLib was **not** installed when the checked-in files were generated; the
blocks are therefore absent (flat-curve cases) or marked `"status": "pending"`
(`sample-market-bootstrap.json`). To fill them in:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install QuantLib            # wheels for CPython 3.9–3.13 on Linux/macOS/Windows
python3 tools/quantlib-golden.py
git diff test-data/golden       # review the quantlib blocks, commit
```

What the cross-check computes:

| Case                      | QuantLib objects                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `swap-flat-curve`         | `VanillaSwap` on `FlatForward(0.03, Actual365Fixed, Continuous)`, `NullCalendar`, `Unadjusted` → `NPV`, `fairRate`, leg NPVs |
| `black76-bachelier`       | `blackFormula`, `bachelierBlackFormula`                                                                                      |
| `sample-market-bootstrap` | `PiecewiseLogLinearDiscount` from `OISRateHelper`s on an `OvernightIndex` (TARGET, spot lag 2, payment lag 1, `Annual`)      |

Expected agreement: flat-curve cases to ~1e-12 (identical formulas); the sample
bootstrap to ~1e-9 in the discount factors as long as QuantLib's OIS helper uses
the same schedule conventions (annual fixed/float legs with a short front stub for
the 18M quote, telescoping €STR compounding, pillar on the last payment date).
Differences beyond that point to a convention mismatch (payment lag, stub or
end-of-month rule), not to a numerical problem – document them in
`test-data/golden/README.md` instead of loosening the tolerance.
