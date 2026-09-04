/**
 * Internal entry point of `@deriva/pricing-core` (`@deriva/pricing-core/internal`,
 * ADR-024 step (2)/(3), round 6 N6-01). Everything here is implementation
 * detail that the pricers, curve builders and reports share – root finding,
 * interpolation coefficients, leg-pricing helpers, vol-quotation conversion,
 * exposure engines, the module counter behind the builders' default ids and the
 * indicative sample vol surfaces. It is exported for tests, tooling and
 * experiments and is **not** covered by the SemVer promise of the main entry
 * point: names may change or disappear in a minor release. No name is exported
 * by both entry points (`node tools/gen-index.mjs --check`).
 */
// Math
export { bivariateNormCdf, normCdf, normInv, normPdf } from "./math/normal.js";
export { brent, newton, solveBracketed, type RootFindOptions } from "./math/rootfind.js";
export {
  cubicSplineCoefficients,
  cubicSplineInterp,
  isNonLocalInterpolation,
  linearInterp,
  locate,
  monotoneConvexCoefficients,
  monotoneConvexForward,
  monotoneConvexZero,
  monotoneCubicInterp,
  type MonotoneConvexCoefficients,
} from "./math/interpolation.js";
// Curves & market internals
export { curveDependencies, futureImpliedForward, orderCurveSpecs, resolveFutureStart, turnOfYearWindow } from "./curves/bootstrap.js";
export { pipFactor } from "./market/fx-spot.js";
export {
  SAMPLE_CHFJPY_VOLS,
  SAMPLE_CHF_CAPLET_VOLS,
  SAMPLE_CHF_SWAPTION_VOLS,
  SAMPLE_EURCHF_VOLS,
  SAMPLE_EURGBP_VOLS,
  SAMPLE_EURJPY_VOLS,
  SAMPLE_EURUSD_VOLS,
  SAMPLE_EUR_CAPLET_VOLS,
  SAMPLE_EUR_SWAPTION_VOLS,
  SAMPLE_GBPCHF_VOLS,
  SAMPLE_GBPJPY_VOLS,
  SAMPLE_GBPUSD_VOLS,
  SAMPLE_GBP_CAPLET_VOLS,
  SAMPLE_GBP_SWAPTION_VOLS,
  SAMPLE_JPY_CAPLET_VOLS,
  SAMPLE_JPY_SWAPTION_VOLS,
  SAMPLE_USDCHF_VOLS,
  SAMPLE_USDJPY_VOLS,
  SAMPLE_USD_CAPLET_VOLS,
  SAMPLE_USD_SWAPTION_VOLS,
} from "./market/sample-market.js";
export { isIsoDateTime, serializeCurve } from "./market/snapshot.js";
export {
  assertCapletSurface,
  assertFxSurface,
  assertSwaptionSurface,
  capletSurfaceProblems,
  fxSurfaceProblems,
  surfaceVolWarnings,
  swaptionSurfaceProblems,
} from "./market/vol-validation.js";
// Models
export { bilinear } from "./models/vol-surfaces.js";
// Instruments & pricer helpers
export { nextTradeId } from "./instruments/builders.js";
export {
  estimateMissingIborRate,
  expectedCollaredRate,
  fixedRateAt,
  floatSpreadAt,
  fxToReporting,
  legAccrued,
  legPeriods,
  missingFixingMessage,
  priceLeg,
  projectFloatingRate,
  scheduleDates,
  type FloatingRateProjection,
  type LegPricingOptions,
} from "./pricing/leg-pricer.js";
export { missingFxFixingMessage, mtmResetNotionalSchedule } from "./pricing/swap-pricer.js";
export {
  convertSurfaceVol,
  modelForVolType,
  modelQuotation,
  quotationLabel,
  sameQuotation,
  surfaceQuotation,
  volTypeConvertedWarning,
  type CapFloorModel,
} from "./pricing/capfloor-pricer.js";
export { linearFxDeltaAmount } from "./pricing/fx-pricer.js";
export { upfrontPremiumLeg } from "./pricing/upfront.js";
// Risk & XVA internals
export { capletSurfaceKeysFor, cashflowsPaidWithin, fxSurfaceKeysFor, tenorLabel } from "./risk/sensitivities.js";
export { BASIS_SPREAD_VOL_FRACTION, cvaBasisSwap, cvaFxForward, cvaGeneric, cvaSwap } from "./xva/cva.js";
// Reporting & hedge internals
export { csvCell } from "./reporting/valuation-report.js";
export {
  basisCurvesFor,
  basisScenarios,
  designationVol,
  hasOnlyParallelCurveShocks,
  hedgedItemNotionalSchedule,
  olsRegression,
  regressionScenarios,
  type RegressionScenarioOptions,
} from "./hedge/hedge.js";
