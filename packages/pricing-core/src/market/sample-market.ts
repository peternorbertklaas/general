import { type CurveBuildSpec, type CurveQuote, bootstrapCurves } from "../curves/bootstrap.js";
import { type Curve } from "../curves/curve.js";
import { type SerialDate, parseISO } from "../dates/date.js";
import { type MarketContext } from "./market-context.js";
import { type SwaptionVolSurface, type CapletVolSurface } from "../models/vol-surfaces.js";
import { type FxVolSurface } from "../models/fx-vol-surface.js";

/**
 * Deterministic sample market (indicative levels, not live data) used for
 * demos, tests and the offline mode of the UI.
 */
export interface SampleMarketQuotes {
  eurOis: CurveQuote[];
  eur6m: CurveQuote[];
  eur3m: CurveQuote[];
  usdSofr: CurveQuote[];
  gbpSonia: CurveQuote[];
  chfSaron: CurveQuote[];
  /**
   * EUR/USD cross-currency basis (€STR + spread vs SOFR) used to build the
   * USD-collateral EUR discount curve "EUR-ESTR-USDCSA". Optional so older
   * quote sets keep working (the curve is then omitted).
   */
  eurUsdXccy?: CurveQuote[];
  /** JPY TONA OIS quotes (curve "JPY-TONA", discount curve for JPY). Optional for older quote sets. */
  jpyTona?: CurveQuote[];
  fxSpots: Record<string, number>;
}

/** Curve ids produced by `buildSampleMarket`. */
export const SAMPLE_CURVE_IDS = {
  eurOis: "EUR-ESTR",
  eur6m: "EUR-EURIBOR-6M",
  eur3m: "EUR-EURIBOR-3M",
  usdSofr: "USD-SOFR",
  gbpSonia: "GBP-SONIA",
  chfSaron: "CHF-SARON",
  eurUsdXccy: "EUR-ESTR-USDCSA",
  jpyTona: "JPY-TONA",
} as const;

export const SAMPLE_QUOTES: SampleMarketQuotes = {
  eurOis: [
    { type: "OIS", tenor: "1W", rate: 0.0201 },
    { type: "OIS", tenor: "1M", rate: 0.0202 },
    { type: "OIS", tenor: "3M", rate: 0.0203 },
    { type: "OIS", tenor: "6M", rate: 0.0205 },
    { type: "OIS", tenor: "9M", rate: 0.0207 },
    { type: "OIS", tenor: "1Y", rate: 0.021 },
    { type: "OIS", tenor: "18M", rate: 0.0215 },
    { type: "OIS", tenor: "2Y", rate: 0.0221 },
    { type: "OIS", tenor: "3Y", rate: 0.0231 },
    { type: "OIS", tenor: "4Y", rate: 0.0239 },
    { type: "OIS", tenor: "5Y", rate: 0.0246 },
    { type: "OIS", tenor: "7Y", rate: 0.0258 },
    { type: "OIS", tenor: "10Y", rate: 0.0272 },
    { type: "OIS", tenor: "12Y", rate: 0.0279 },
    { type: "OIS", tenor: "15Y", rate: 0.0286 },
    { type: "OIS", tenor: "20Y", rate: 0.0287 },
    { type: "OIS", tenor: "25Y", rate: 0.0281 },
    { type: "OIS", tenor: "30Y", rate: 0.0273 },
  ],
  eur6m: [
    { type: "Deposit", tenor: "6M", rate: 0.0221 },
    { type: "FRA", start: "6M", end: "12M", rate: 0.0226 },
    { type: "FRA", start: "12M", end: "18M", rate: 0.0233 },
    { type: "Swap", tenor: "2Y", rate: 0.0238 },
    { type: "Swap", tenor: "3Y", rate: 0.0247 },
    { type: "Swap", tenor: "4Y", rate: 0.0255 },
    { type: "Swap", tenor: "5Y", rate: 0.0262 },
    { type: "Swap", tenor: "6Y", rate: 0.0268 },
    { type: "Swap", tenor: "7Y", rate: 0.0274 },
    { type: "Swap", tenor: "8Y", rate: 0.0279 },
    { type: "Swap", tenor: "9Y", rate: 0.0284 },
    { type: "Swap", tenor: "10Y", rate: 0.0288 },
    { type: "Swap", tenor: "12Y", rate: 0.0295 },
    { type: "Swap", tenor: "15Y", rate: 0.0302 },
    { type: "Swap", tenor: "20Y", rate: 0.0303 },
    { type: "Swap", tenor: "25Y", rate: 0.0297 },
    { type: "Swap", tenor: "30Y", rate: 0.0289 },
  ],
  eur3m: [
    { type: "Deposit", tenor: "3M", rate: 0.0212 },
    // 3M EURIBOR futures on the first two quarterly IMM dates after spot+3M / spot+6M
    // (tenor form keeps the sample valid for any valuation date). Prices are set
    // consistent with the FRA strip (~2.15% / ~2.18%); 0.5bp convexity.
    { type: "Future", start: "3M", price: 97.84, convexityBp: 0.5 },
    { type: "Future", start: "6M", price: 97.81, convexityBp: 0.5 },
    { type: "FRA", start: "3M", end: "6M", rate: 0.0215 },
    { type: "FRA", start: "6M", end: "9M", rate: 0.0218 },
    { type: "FRA", start: "9M", end: "12M", rate: 0.0222 },
    { type: "Swap", tenor: "2Y", rate: 0.023 },
    { type: "Swap", tenor: "3Y", rate: 0.0239 },
    { type: "Swap", tenor: "5Y", rate: 0.0254 },
    { type: "Swap", tenor: "7Y", rate: 0.0266 },
    { type: "Swap", tenor: "10Y", rate: 0.028 },
    { type: "Swap", tenor: "15Y", rate: 0.0294 },
    { type: "Swap", tenor: "20Y", rate: 0.0295 },
    { type: "Swap", tenor: "30Y", rate: 0.0281 },
  ],
  usdSofr: [
    { type: "OIS", tenor: "1M", rate: 0.0355 },
    { type: "OIS", tenor: "3M", rate: 0.0351 },
    { type: "OIS", tenor: "6M", rate: 0.0345 },
    { type: "OIS", tenor: "1Y", rate: 0.0336 },
    { type: "OIS", tenor: "2Y", rate: 0.0328 },
    { type: "OIS", tenor: "3Y", rate: 0.0327 },
    { type: "OIS", tenor: "5Y", rate: 0.0333 },
    { type: "OIS", tenor: "7Y", rate: 0.0342 },
    { type: "OIS", tenor: "10Y", rate: 0.0355 },
    { type: "OIS", tenor: "15Y", rate: 0.0368 },
    { type: "OIS", tenor: "20Y", rate: 0.0372 },
    { type: "OIS", tenor: "30Y", rate: 0.0362 },
  ],
  gbpSonia: [
    { type: "OIS", tenor: "1M", rate: 0.0385 },
    { type: "OIS", tenor: "3M", rate: 0.0381 },
    { type: "OIS", tenor: "6M", rate: 0.0375 },
    { type: "OIS", tenor: "1Y", rate: 0.0366 },
    { type: "OIS", tenor: "2Y", rate: 0.0358 },
    { type: "OIS", tenor: "3Y", rate: 0.0356 },
    { type: "OIS", tenor: "5Y", rate: 0.0361 },
    { type: "OIS", tenor: "7Y", rate: 0.0369 },
    { type: "OIS", tenor: "10Y", rate: 0.0381 },
    { type: "OIS", tenor: "15Y", rate: 0.0395 },
    { type: "OIS", tenor: "20Y", rate: 0.0398 },
    { type: "OIS", tenor: "30Y", rate: 0.0385 },
  ],
  chfSaron: [
    { type: "OIS", tenor: "1M", rate: 0.0002 },
    { type: "OIS", tenor: "3M", rate: 0.0003 },
    { type: "OIS", tenor: "6M", rate: 0.0005 },
    { type: "OIS", tenor: "1Y", rate: 0.001 },
    { type: "OIS", tenor: "2Y", rate: 0.002 },
    { type: "OIS", tenor: "3Y", rate: 0.0031 },
    { type: "OIS", tenor: "5Y", rate: 0.0052 },
    { type: "OIS", tenor: "7Y", rate: 0.0068 },
    { type: "OIS", tenor: "10Y", rate: 0.0085 },
    { type: "OIS", tenor: "15Y", rate: 0.0101 },
    { type: "OIS", tenor: "20Y", rate: 0.0106 },
    { type: "OIS", tenor: "30Y", rate: 0.0102 },
  ],
  // JPY TONA OIS (indicative levels: BoJ normalisation, ~0.5–1.6%).
  jpyTona: [
    { type: "OIS", tenor: "1M", rate: 0.0048 },
    { type: "OIS", tenor: "3M", rate: 0.0052 },
    { type: "OIS", tenor: "6M", rate: 0.0058 },
    { type: "OIS", tenor: "1Y", rate: 0.0068 },
    { type: "OIS", tenor: "2Y", rate: 0.0085 },
    { type: "OIS", tenor: "3Y", rate: 0.0098 },
    { type: "OIS", tenor: "5Y", rate: 0.0118 },
    { type: "OIS", tenor: "7Y", rate: 0.0133 },
    { type: "OIS", tenor: "10Y", rate: 0.0152 },
    { type: "OIS", tenor: "15Y", rate: 0.0175 },
    { type: "OIS", tenor: "20Y", rate: 0.0188 },
    { type: "OIS", tenor: "30Y", rate: 0.0195 },
  ],
  // EUR/USD basis: €STR + spread vs SOFR flat, quarterly, notional exchange.
  // `fxSpot` is overridden with `fxSpots.EURUSD` when the market is built.
  eurUsdXccy: [
    {
      type: "XccyBasis",
      tenor: "1Y",
      spread: -0.0015,
      foreignCurrency: "USD",
      foreignDiscountCurveId: "USD-SOFR",
      foreignProjectionCurveId: "USD-SOFR",
      domesticProjectionCurveId: "EUR-ESTR",
      fxSpot: 1.1625,
    },
    {
      type: "XccyBasis",
      tenor: "2Y",
      spread: -0.0017,
      foreignCurrency: "USD",
      foreignDiscountCurveId: "USD-SOFR",
      foreignProjectionCurveId: "USD-SOFR",
      domesticProjectionCurveId: "EUR-ESTR",
      fxSpot: 1.1625,
    },
    {
      type: "XccyBasis",
      tenor: "3Y",
      spread: -0.0019,
      foreignCurrency: "USD",
      foreignDiscountCurveId: "USD-SOFR",
      foreignProjectionCurveId: "USD-SOFR",
      domesticProjectionCurveId: "EUR-ESTR",
      fxSpot: 1.1625,
    },
    {
      type: "XccyBasis",
      tenor: "5Y",
      spread: -0.0022,
      foreignCurrency: "USD",
      foreignDiscountCurveId: "USD-SOFR",
      foreignProjectionCurveId: "USD-SOFR",
      domesticProjectionCurveId: "EUR-ESTR",
      fxSpot: 1.1625,
    },
    {
      type: "XccyBasis",
      tenor: "10Y",
      spread: -0.0025,
      foreignCurrency: "USD",
      foreignDiscountCurveId: "USD-SOFR",
      foreignProjectionCurveId: "USD-SOFR",
      domesticProjectionCurveId: "EUR-ESTR",
      fxSpot: 1.1625,
    },
  ],
  fxSpots: {
    EURUSD: 1.1625,
    EURGBP: 0.8615,
    EURCHF: 0.9345,
    EURJPY: 171.4,
    USDJPY: 147.45,
  },
};

export const SAMPLE_EUR_SWAPTION_VOLS: SwaptionVolSurface = {
  id: "EUR-SWAPTION-NORMAL",
  currency: "EUR",
  volType: "Normal",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  tenors: [1, 2, 3, 5, 7, 10, 15, 20, 30],
  // normal vols in decimal (e.g. 0.0068 = 68bp); shape: shorter expiry x shorter tenor higher
  atm: [
    [0.0072, 0.0075, 0.0077, 0.0078, 0.0077, 0.0075, 0.0072, 0.007, 0.0066],
    [0.0074, 0.0077, 0.0079, 0.0079, 0.0078, 0.0076, 0.0073, 0.007, 0.0066],
    [0.0076, 0.0079, 0.008, 0.008, 0.0079, 0.0077, 0.0073, 0.007, 0.0066],
    [0.0079, 0.0081, 0.0082, 0.0081, 0.0079, 0.0077, 0.0073, 0.007, 0.0065],
    [0.0081, 0.0082, 0.0082, 0.008, 0.0078, 0.0076, 0.0072, 0.0069, 0.0064],
    [0.0081, 0.0081, 0.0081, 0.0079, 0.0077, 0.0075, 0.0071, 0.0068, 0.0063],
    [0.0079, 0.0079, 0.0078, 0.0076, 0.0074, 0.0072, 0.0068, 0.0065, 0.006],
    [0.0076, 0.0076, 0.0075, 0.0073, 0.0071, 0.0069, 0.0065, 0.0062, 0.0058],
    [0.0072, 0.0072, 0.0071, 0.0069, 0.0067, 0.0065, 0.0061, 0.0059, 0.0055],
    [0.0066, 0.0066, 0.0065, 0.0063, 0.0061, 0.0059, 0.0056, 0.0054, 0.0051],
    [0.0061, 0.0061, 0.006, 0.0058, 0.0056, 0.0054, 0.0052, 0.005, 0.0048],
  ],
  sabr: {
    "1x5": { beta: 0.5, rho: -0.2, nu: 0.35, shift: 0.03 },
    "5x5": { beta: 0.5, rho: -0.25, nu: 0.3, shift: 0.03 },
    "10x10": { beta: 0.5, rho: -0.3, nu: 0.25, shift: 0.03 },
  },
};

export const SAMPLE_EUR_CAPLET_VOLS: CapletVolSurface = {
  id: "EUR-EURIBOR-6M-CAPLET-NORMAL",
  currency: "EUR",
  index: "EURIBOR-6M",
  volType: "Normal",
  expiries: [0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  strikes: [0.0, 0.01, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06],
  vols: [
    [0.0062, 0.006, 0.0058, 0.0058, 0.0059, 0.0063, 0.0068, 0.0074],
    [0.0068, 0.0066, 0.0064, 0.0064, 0.0065, 0.0068, 0.0073, 0.0079],
    [0.0074, 0.0072, 0.007, 0.007, 0.0071, 0.0074, 0.0078, 0.0083],
    [0.0076, 0.0074, 0.0072, 0.0072, 0.0073, 0.0075, 0.0079, 0.0084],
    [0.0075, 0.0073, 0.0071, 0.0071, 0.0072, 0.0074, 0.0077, 0.0081],
    [0.0072, 0.007, 0.0068, 0.0068, 0.0069, 0.0071, 0.0074, 0.0078],
    [0.0068, 0.0066, 0.0064, 0.0064, 0.0065, 0.0067, 0.007, 0.0073],
    [0.0062, 0.006, 0.0058, 0.0058, 0.0059, 0.0061, 0.0064, 0.0067],
    [0.0057, 0.0055, 0.0053, 0.0053, 0.0054, 0.0056, 0.0059, 0.0062],
  ],
};

/**
 * USD SOFR swaption cube (normal vols, indicative). Keyed `USD` in
 * `MarketContext.swaptionVols` – the swaption pricer, CVA and vega buckets look
 * surfaces up by the fixed leg's currency.
 */
export const SAMPLE_USD_SWAPTION_VOLS: SwaptionVolSurface = {
  id: "USD-SWAPTION-NORMAL",
  currency: "USD",
  volType: "Normal",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  tenors: [1, 2, 3, 5, 7, 10, 15, 20, 30],
  // USD normal vols run 10–20 bp above EUR (higher rate level); short expiry × short tenor highest.
  atm: [
    [0.0092, 0.0095, 0.0096, 0.0095, 0.0093, 0.009, 0.0086, 0.0083, 0.0078],
    [0.0094, 0.0097, 0.0098, 0.0096, 0.0094, 0.0091, 0.0086, 0.0083, 0.0078],
    [0.0096, 0.0098, 0.0099, 0.0097, 0.0095, 0.0092, 0.0087, 0.0083, 0.0078],
    [0.0098, 0.0099, 0.0099, 0.0097, 0.0095, 0.0092, 0.0087, 0.0083, 0.0077],
    [0.0098, 0.0098, 0.0098, 0.0096, 0.0094, 0.0091, 0.0086, 0.0082, 0.0076],
    [0.0097, 0.0097, 0.0096, 0.0094, 0.0092, 0.0089, 0.0084, 0.008, 0.0075],
    [0.0093, 0.0093, 0.0092, 0.009, 0.0088, 0.0085, 0.008, 0.0077, 0.0072],
    [0.0089, 0.0089, 0.0088, 0.0086, 0.0084, 0.0081, 0.0077, 0.0074, 0.0069],
    [0.0084, 0.0084, 0.0083, 0.0081, 0.0079, 0.0077, 0.0073, 0.007, 0.0066],
    [0.0077, 0.0077, 0.0076, 0.0074, 0.0072, 0.007, 0.0067, 0.0064, 0.0061],
    [0.0071, 0.0071, 0.007, 0.0068, 0.0066, 0.0064, 0.0062, 0.006, 0.0057],
  ],
  sabr: {
    "1x5": { beta: 0.5, rho: -0.15, nu: 0.3, shift: 0.03 },
    "5x5": { beta: 0.5, rho: -0.2, nu: 0.27, shift: 0.03 },
    "10x10": { beta: 0.5, rho: -0.25, nu: 0.22, shift: 0.03 },
  },
};

/** GBP SONIA swaption cube (normal vols, indicative), keyed `GBP`. */
export const SAMPLE_GBP_SWAPTION_VOLS: SwaptionVolSurface = {
  id: "GBP-SWAPTION-NORMAL",
  currency: "GBP",
  volType: "Normal",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  tenors: [1, 2, 3, 5, 7, 10, 15, 20, 30],
  atm: [
    [0.0088, 0.009, 0.0091, 0.009, 0.0088, 0.0085, 0.0081, 0.0078, 0.0073],
    [0.009, 0.0092, 0.0093, 0.0091, 0.0089, 0.0086, 0.0081, 0.0078, 0.0073],
    [0.0092, 0.0093, 0.0094, 0.0092, 0.009, 0.0087, 0.0082, 0.0078, 0.0073],
    [0.0093, 0.0094, 0.0094, 0.0092, 0.009, 0.0087, 0.0082, 0.0078, 0.0072],
    [0.0093, 0.0093, 0.0093, 0.0091, 0.0089, 0.0086, 0.0081, 0.0077, 0.0071],
    [0.0092, 0.0092, 0.0091, 0.0089, 0.0087, 0.0084, 0.0079, 0.0075, 0.007],
    [0.0088, 0.0088, 0.0087, 0.0085, 0.0083, 0.008, 0.0075, 0.0072, 0.0067],
    [0.0084, 0.0084, 0.0083, 0.0081, 0.0079, 0.0076, 0.0072, 0.0069, 0.0064],
    [0.0079, 0.0079, 0.0078, 0.0076, 0.0074, 0.0072, 0.0068, 0.0065, 0.0061],
    [0.0072, 0.0072, 0.0071, 0.0069, 0.0067, 0.0065, 0.0062, 0.0059, 0.0056],
    [0.0066, 0.0066, 0.0065, 0.0063, 0.0061, 0.0059, 0.0057, 0.0055, 0.0052],
  ],
  sabr: {
    "1x5": { beta: 0.5, rho: -0.15, nu: 0.3, shift: 0.03 },
    "5x5": { beta: 0.5, rho: -0.2, nu: 0.27, shift: 0.03 },
    "10x10": { beta: 0.5, rho: -0.25, nu: 0.22, shift: 0.03 },
  },
};

/**
 * USD SOFR caplet surface (normal vols on the 3M compounded SOFR forward,
 * indicative). Keyed `USD-SOFR` (`${currency}-${index}`) – the cap/floor and
 * leg pricers look up `${ccy}-${index}` first and fall back to `${ccy}`.
 */
export const SAMPLE_USD_CAPLET_VOLS: CapletVolSurface = {
  id: "USD-SOFR-CAPLET-NORMAL",
  currency: "USD",
  index: "SOFR",
  volType: "Normal",
  expiries: [0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  strikes: [0.01, 0.02, 0.03, 0.035, 0.04, 0.05, 0.06, 0.07],
  vols: [
    [0.0078, 0.0075, 0.0072, 0.0072, 0.0073, 0.0077, 0.0082, 0.0088],
    [0.0084, 0.0081, 0.0078, 0.0078, 0.0079, 0.0082, 0.0087, 0.0093],
    [0.009, 0.0087, 0.0084, 0.0084, 0.0085, 0.0088, 0.0092, 0.0097],
    [0.0092, 0.0089, 0.0086, 0.0086, 0.0087, 0.0089, 0.0093, 0.0098],
    [0.009, 0.0087, 0.0084, 0.0084, 0.0085, 0.0087, 0.009, 0.0094],
    [0.0086, 0.0083, 0.008, 0.008, 0.0081, 0.0083, 0.0086, 0.009],
    [0.008, 0.0077, 0.0074, 0.0074, 0.0075, 0.0077, 0.008, 0.0083],
    [0.0072, 0.0069, 0.0066, 0.0066, 0.0067, 0.0069, 0.0072, 0.0075],
    [0.0066, 0.0063, 0.006, 0.006, 0.0061, 0.0063, 0.0066, 0.0069],
  ],
};

/** GBP SONIA caplet surface (normal vols, indicative), keyed `GBP-SONIA`. */
export const SAMPLE_GBP_CAPLET_VOLS: CapletVolSurface = {
  id: "GBP-SONIA-CAPLET-NORMAL",
  currency: "GBP",
  index: "SONIA",
  volType: "Normal",
  expiries: [0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  strikes: [0.01, 0.02, 0.03, 0.035, 0.04, 0.05, 0.06, 0.07],
  vols: [
    [0.0074, 0.0071, 0.0068, 0.0068, 0.0069, 0.0073, 0.0078, 0.0084],
    [0.008, 0.0077, 0.0074, 0.0074, 0.0075, 0.0078, 0.0083, 0.0089],
    [0.0086, 0.0083, 0.008, 0.008, 0.0081, 0.0084, 0.0088, 0.0093],
    [0.0088, 0.0085, 0.0082, 0.0082, 0.0083, 0.0085, 0.0089, 0.0094],
    [0.0086, 0.0083, 0.008, 0.008, 0.0081, 0.0083, 0.0086, 0.009],
    [0.0082, 0.0079, 0.0076, 0.0076, 0.0077, 0.0079, 0.0082, 0.0086],
    [0.0076, 0.0073, 0.007, 0.007, 0.0071, 0.0073, 0.0076, 0.0079],
    [0.0068, 0.0065, 0.0062, 0.0062, 0.0063, 0.0065, 0.0068, 0.0071],
    [0.0062, 0.0059, 0.0056, 0.0056, 0.0057, 0.0059, 0.0062, 0.0065],
  ],
};

/** Scale a vol matrix by `k`, rounded to 0.1 bp (indicative surfaces derived from a reference cube). */
function scaleVols(m: readonly (readonly number[])[], k: number): number[][] {
  return m.map((row) => row.map((v) => Math.round(v * k * 1e5) / 1e5));
}

/**
 * CHF SARON swaption cube (normal vols, indicative; Markt R4-4). CHF normal
 * vols run well below GBP/USD (lower rate level, SNB regime) – the cube is the
 * GBP shape scaled to ≈ 55–65 bp; SABR smile parameters with a 2 % shift
 * (negative-rate history). Keyed `CHF`.
 */
export const SAMPLE_CHF_SWAPTION_VOLS: SwaptionVolSurface = {
  id: "CHF-SWAPTION-NORMAL",
  currency: "CHF",
  volType: "Normal",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  tenors: [1, 2, 3, 5, 7, 10, 15, 20, 30],
  atm: scaleVols(SAMPLE_GBP_SWAPTION_VOLS.atm, 0.7),
  sabr: {
    "1x5": { beta: 0.5, rho: -0.1, nu: 0.35, shift: 0.02 },
    "5x5": { beta: 0.5, rho: -0.15, nu: 0.3, shift: 0.02 },
    "10x10": { beta: 0.5, rho: -0.2, nu: 0.25, shift: 0.02 },
  },
};

/**
 * JPY TONA swaption cube (normal vols, indicative; Markt R4-4): the lowest
 * normal vols of the G5 (≈ 40–50 bp), GBP shape scaled; 2 % SABR shift. Keyed `JPY`.
 */
export const SAMPLE_JPY_SWAPTION_VOLS: SwaptionVolSurface = {
  id: "JPY-SWAPTION-NORMAL",
  currency: "JPY",
  volType: "Normal",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  tenors: [1, 2, 3, 5, 7, 10, 15, 20, 30],
  atm: scaleVols(SAMPLE_GBP_SWAPTION_VOLS.atm, 0.52),
  sabr: {
    "1x5": { beta: 0.5, rho: -0.1, nu: 0.4, shift: 0.02 },
    "5x5": { beta: 0.5, rho: -0.15, nu: 0.33, shift: 0.02 },
    "10x10": { beta: 0.5, rho: -0.2, nu: 0.28, shift: 0.02 },
  },
};

/**
 * CHF SARON caplet surface (normal vols on the 3M compounded SARON forward,
 * indicative; Markt R4-4). Strike grid around the low CHF rate level (0–3 %),
 * vols ≈ 45–65 bp. Keyed `CHF-SARON`.
 */
export const SAMPLE_CHF_CAPLET_VOLS: CapletVolSurface = {
  id: "CHF-SARON-CAPLET-NORMAL",
  currency: "CHF",
  index: "SARON",
  volType: "Normal",
  expiries: [0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  strikes: [0.0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04],
  vols: scaleVols(SAMPLE_GBP_CAPLET_VOLS.vols, 0.7),
};

/** JPY TONA caplet surface (normal vols, indicative; Markt R4-4), strikes 0–3 %, vols ≈ 35–50 bp. Keyed `JPY-TONA`. */
export const SAMPLE_JPY_CAPLET_VOLS: CapletVolSurface = {
  id: "JPY-TONA-CAPLET-NORMAL",
  currency: "JPY",
  index: "TONA",
  volType: "Normal",
  expiries: [0.5, 1, 2, 3, 5, 7, 10, 15, 20],
  strikes: [0.0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04],
  vols: scaleVols(SAMPLE_GBP_CAPLET_VOLS.vols, 0.52),
};

/**
 * Sample FX surfaces (R3-8): every surface declares its ATM and delta
 * convention explicitly. Market convention (Reiswich–Wystup 2010, Clark 2011,
 * Bloomberg OVML) is a spot delta for expiries ≤ 1Y and a forward delta
 * beyond, ATM delta-neutral straddle; the surface type carries one delta
 * convention per surface, so the sample surfaces are quoted in spot delta
 * throughout (the 2Y–5Y rows are therefore an approximation of the forward-
 * delta market quotes – indicative data). The interbank convention for EUR
 * crosses (EURGBP, EURCHF, EURJPY) and USDJPY is a *premium-adjusted* spot
 * delta (premium in the base currency); the sample surfaces keep the
 * unadjusted spot delta for simplicity – switch `deltaConvention` to
 * "PremiumAdjustedSpot" when loading real quotes.
 */
export const SAMPLE_EURUSD_VOLS: FxVolSurface = {
  id: "EURUSD-VOL",
  pair: "EURUSD",
  expiries: [1 / 52, 1 / 12, 0.25, 0.5, 1, 2, 3, 5],
  atm: [0.071, 0.0725, 0.074, 0.0755, 0.077, 0.079, 0.0805, 0.082],
  rr25: [0.002, 0.0025, 0.003, 0.0035, 0.004, 0.0045, 0.005, 0.005],
  bf25: [0.0015, 0.0017, 0.002, 0.0022, 0.0025, 0.0027, 0.003, 0.003],
  rr10: [0.0035, 0.0045, 0.0055, 0.0065, 0.0075, 0.008, 0.0085, 0.0085],
  bf10: [0.005, 0.0055, 0.0065, 0.0072, 0.008, 0.0085, 0.009, 0.009],
  // EURUSD: unadjusted spot delta ≤ 1Y (premium in USD), delta-neutral ATM.
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

export const SAMPLE_EURGBP_VOLS: FxVolSurface = {
  id: "EURGBP-VOL",
  pair: "EURGBP",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.055, 0.057, 0.059, 0.061, 0.063, 0.066],
  rr25: [0.001, 0.0015, 0.002, 0.0025, 0.003, 0.003],
  bf25: [0.0012, 0.0015, 0.0018, 0.002, 0.0022, 0.0025],
  // Spot delta (interbank: premium-adjusted spot – see the note above).
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

export const SAMPLE_EURCHF_VOLS: FxVolSurface = {
  id: "EURCHF-VOL",
  pair: "EURCHF",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.05, 0.052, 0.054, 0.056, 0.058, 0.061],
  rr25: [-0.004, -0.0045, -0.005, -0.0055, -0.006, -0.006],
  bf25: [0.0015, 0.0018, 0.002, 0.0022, 0.0025, 0.0027],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/** GBPUSD (cable): unadjusted spot delta ≤ 1Y, premium in USD; positive RR (GBP calls bid). */
export const SAMPLE_GBPUSD_VOLS: FxVolSurface = {
  id: "GBPUSD-VOL",
  pair: "GBPUSD",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.078, 0.079, 0.08, 0.081, 0.083, 0.086],
  rr25: [-0.004, -0.0045, -0.005, -0.0055, -0.006, -0.006],
  bf25: [0.0018, 0.002, 0.0022, 0.0025, 0.0028, 0.003],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/** USDJPY: JPY calls bid (negative RR), pronounced smile; spot delta (interbank: premium-adjusted). */
export const SAMPLE_USDJPY_VOLS: FxVolSurface = {
  id: "USDJPY-VOL",
  pair: "USDJPY",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.095, 0.097, 0.099, 0.101, 0.103, 0.105],
  rr25: [-0.012, -0.013, -0.014, -0.015, -0.015, -0.015],
  bf25: [0.0025, 0.0028, 0.003, 0.0033, 0.0035, 0.0035],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/** EURJPY: negative RR (JPY calls bid), spot delta (interbank: premium-adjusted). */
export const SAMPLE_EURJPY_VOLS: FxVolSurface = {
  id: "EURJPY-VOL",
  pair: "EURJPY",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.088, 0.09, 0.092, 0.094, 0.096, 0.099],
  rr25: [-0.009, -0.01, -0.011, -0.012, -0.012, -0.012],
  bf25: [0.0022, 0.0025, 0.0027, 0.003, 0.0032, 0.0032],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/**
 * Cross-pair FX surfaces (Markt R5-2): every pair of the sample market's five
 * currencies whose spot is quoted or triangulable has a surface, so no sample
 * pair falls back to the 8 % flat vol (Level 3). The cross vols are
 * **indicative**: ATM levels derived from the EUR / USD legs with a
 * correlation-consistent cross-vol relation σ²ₓ ≈ σ₁² + σ₂² − 2ρσ₁σ₂ (ρ ≈ 0.4
 * for USDCHF from EURUSD/EURCHF, ≈ 0.3 for the JPY crosses) and smile quotes
 * in the direction the market shows (CHF calls / JPY calls bid), spot delta
 * throughout like the other sample surfaces.
 */
export const SAMPLE_USDCHF_VOLS: FxVolSurface = {
  id: "USDCHF-VOL",
  pair: "USDCHF",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.072, 0.074, 0.076, 0.078, 0.08, 0.083],
  rr25: [-0.006, -0.0065, -0.007, -0.0075, -0.008, -0.008],
  bf25: [0.0018, 0.002, 0.0022, 0.0025, 0.0028, 0.003],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/** GBPJPY: high-beta cross, JPY calls bid (negative RR). Indicative, see `SAMPLE_USDCHF_VOLS`. */
export const SAMPLE_GBPJPY_VOLS: FxVolSurface = {
  id: "GBPJPY-VOL",
  pair: "GBPJPY",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.105, 0.107, 0.109, 0.111, 0.113, 0.116],
  rr25: [-0.014, -0.015, -0.016, -0.017, -0.017, -0.017],
  bf25: [0.0028, 0.003, 0.0032, 0.0035, 0.0037, 0.0037],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/** CHFJPY: two safe-haven currencies, JPY calls bid. Indicative, see `SAMPLE_USDCHF_VOLS`. */
export const SAMPLE_CHFJPY_VOLS: FxVolSurface = {
  id: "CHFJPY-VOL",
  pair: "CHFJPY",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.09, 0.092, 0.094, 0.096, 0.098, 0.101],
  rr25: [-0.009, -0.01, -0.011, -0.012, -0.012, -0.012],
  bf25: [0.0024, 0.0027, 0.0029, 0.0032, 0.0034, 0.0034],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/** GBPCHF: CHF calls bid (negative RR). Indicative, see `SAMPLE_USDCHF_VOLS`. */
export const SAMPLE_GBPCHF_VOLS: FxVolSurface = {
  id: "GBPCHF-VOL",
  pair: "GBPCHF",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.068, 0.07, 0.072, 0.074, 0.076, 0.079],
  rr25: [-0.005, -0.0055, -0.006, -0.0065, -0.007, -0.007],
  bf25: [0.0016, 0.0018, 0.002, 0.0022, 0.0025, 0.0027],
  deltaConvention: "Spot",
  atmConvention: "DeltaNeutral",
};

/**
 * Curve build specifications used by `buildSampleMarket`, keyed by curve id
 * and in build order. Exposed so the UI / API can run par-rate risk
 * (`parRisk`) or rebuild single curves without duplicating the quote lists.
 * The specs themselves are valuation-date independent (futures use tenor
 * starts); the parameter is accepted for a stable call signature.
 */
export function sampleBootstrapSpecs(
  _valuationDate: SerialDate = parseISO("2026-09-03"),
  quotes: SampleMarketQuotes = SAMPLE_QUOTES,
): Record<string, CurveBuildSpec> {
  const ids = SAMPLE_CURVE_IDS;
  const specs: Record<string, CurveBuildSpec> = {
    [ids.eurOis]: { id: ids.eurOis, currency: "EUR", index: "ESTR", quotes: quotes.eurOis },
    [ids.eur6m]: { id: ids.eur6m, currency: "EUR", index: "EURIBOR-6M", quotes: quotes.eur6m, discountCurveId: ids.eurOis },
    // FRA 3x6 / 6x9 and the Dec/Mar futures end 8–10 days apart: merge each pair
    // to one pillar (the future wins) instead of two pillars with a forward kink.
    [ids.eur3m]: { id: ids.eur3m, currency: "EUR", index: "EURIBOR-3M", quotes: quotes.eur3m, discountCurveId: ids.eurOis, pillarMergeToleranceDays: 10 },
    [ids.usdSofr]: { id: ids.usdSofr, currency: "USD", index: "SOFR", quotes: quotes.usdSofr },
    [ids.gbpSonia]: { id: ids.gbpSonia, currency: "GBP", index: "SONIA", quotes: quotes.gbpSonia },
    [ids.chfSaron]: { id: ids.chfSaron, currency: "CHF", index: "SARON", quotes: quotes.chfSaron },
  };
  if (quotes.jpyTona && quotes.jpyTona.length > 0) {
    specs[ids.jpyTona] = { id: ids.jpyTona, currency: "JPY", index: "TONA", quotes: quotes.jpyTona };
  }
  if (quotes.eurUsdXccy && quotes.eurUsdXccy.length > 0) {
    const fx = quotes.fxSpots.EURUSD;
    specs[ids.eurUsdXccy] = {
      id: ids.eurUsdXccy,
      currency: "EUR",
      index: "ESTR",
      quotes: quotes.eurUsdXccy.map((q) => (q.type === "XccyBasis" && fx !== undefined ? { ...q, fxSpot: fx } : q)),
    };
  }
  return specs;
}

export function buildSampleMarket(valuationDate: SerialDate = parseISO("2026-09-03"), quotes: SampleMarketQuotes = SAMPLE_QUOTES): MarketContext {
  const specs = sampleBootstrapSpecs(valuationDate, quotes);
  const built = bootstrapCurves(valuationDate, Object.values(specs));
  const curves: Record<string, Curve> = {};
  for (const id of Object.keys(specs)) curves[id] = built.curves[id]!;
  const hasXccy = SAMPLE_CURVE_IDS.eurUsdXccy in curves;
  const hasJpy = SAMPLE_CURVE_IDS.jpyTona in curves;
  return {
    valuationDate,
    curves,
    discountCurveId: { EUR: "EUR-ESTR", USD: "USD-SOFR", GBP: "GBP-SONIA", CHF: "CHF-SARON", ...(hasJpy ? { JPY: SAMPLE_CURVE_IDS.jpyTona } : {}) },
    ...(hasXccy ? { collateralDiscountCurveId: { "EUR|USD": SAMPLE_CURVE_IDS.eurUsdXccy } } : {}),
    fxSpots: { ...quotes.fxSpots },
    fixings: [],
    // Surfaces keyed the way the pricers look them up: swaption cubes by currency, caplet
    // surfaces by `${ccy}-${index}` (fallback `${ccy}`), FX surfaces by pair (either quotation).
    // Every currency with a discount curve has an IR vol cube and a caplet surface (Markt R4-4: CHF/JPY at Level 2).
    swaptionVols: {
      EUR: SAMPLE_EUR_SWAPTION_VOLS,
      USD: SAMPLE_USD_SWAPTION_VOLS,
      GBP: SAMPLE_GBP_SWAPTION_VOLS,
      CHF: SAMPLE_CHF_SWAPTION_VOLS,
      ...(hasJpy ? { JPY: SAMPLE_JPY_SWAPTION_VOLS } : {}),
    },
    capletVols: {
      "EUR-EURIBOR-6M": SAMPLE_EUR_CAPLET_VOLS,
      "USD-SOFR": SAMPLE_USD_CAPLET_VOLS,
      "GBP-SONIA": SAMPLE_GBP_CAPLET_VOLS,
      "CHF-SARON": SAMPLE_CHF_CAPLET_VOLS,
      ...(hasJpy ? { "JPY-TONA": SAMPLE_JPY_CAPLET_VOLS } : {}),
    },
    // Every pair of the five sample currencies (all ten) has a surface – the four crosses are indicative (Markt R5-2).
    fxVols: {
      EURUSD: SAMPLE_EURUSD_VOLS,
      EURGBP: SAMPLE_EURGBP_VOLS,
      EURCHF: SAMPLE_EURCHF_VOLS,
      GBPUSD: SAMPLE_GBPUSD_VOLS,
      USDJPY: SAMPLE_USDJPY_VOLS,
      EURJPY: SAMPLE_EURJPY_VOLS,
      USDCHF: SAMPLE_USDCHF_VOLS,
      GBPJPY: SAMPLE_GBPJPY_VOLS,
      CHFJPY: SAMPLE_CHFJPY_VOLS,
      GBPCHF: SAMPLE_GBPCHF_VOLS,
    },
    credit: {
      "CPTY-A": { hazardRate: 0.01, recovery: 0.4 },
      "CPTY-B": { hazardRate: 0.025, recovery: 0.4 },
      OWN: { hazardRate: 0.008, recovery: 0.4 },
    },
    meta: { source: "DERIVA sample market (indicative)", label: "Sample EoD" },
  };
}
