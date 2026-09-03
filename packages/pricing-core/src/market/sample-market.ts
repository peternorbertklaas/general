import { bootstrapCurve, type CurveQuote } from "../curves/bootstrap.js";
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
  fxSpots: Record<string, number>;
}

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

export const SAMPLE_EURUSD_VOLS: FxVolSurface = {
  id: "EURUSD-VOL",
  pair: "EURUSD",
  expiries: [1 / 52, 1 / 12, 0.25, 0.5, 1, 2, 3, 5],
  atm: [0.071, 0.0725, 0.074, 0.0755, 0.077, 0.079, 0.0805, 0.082],
  rr25: [0.002, 0.0025, 0.003, 0.0035, 0.004, 0.0045, 0.005, 0.005],
  bf25: [0.0015, 0.0017, 0.002, 0.0022, 0.0025, 0.0027, 0.003, 0.003],
  rr10: [0.0035, 0.0045, 0.0055, 0.0065, 0.0075, 0.008, 0.0085, 0.0085],
  bf10: [0.005, 0.0055, 0.0065, 0.0072, 0.008, 0.0085, 0.009, 0.009],
};

export const SAMPLE_EURGBP_VOLS: FxVolSurface = {
  id: "EURGBP-VOL",
  pair: "EURGBP",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.055, 0.057, 0.059, 0.061, 0.063, 0.066],
  rr25: [0.001, 0.0015, 0.002, 0.0025, 0.003, 0.003],
  bf25: [0.0012, 0.0015, 0.0018, 0.002, 0.0022, 0.0025],
};

export const SAMPLE_EURCHF_VOLS: FxVolSurface = {
  id: "EURCHF-VOL",
  pair: "EURCHF",
  expiries: [1 / 12, 0.25, 0.5, 1, 2, 5],
  atm: [0.05, 0.052, 0.054, 0.056, 0.058, 0.061],
  rr25: [-0.004, -0.0045, -0.005, -0.0055, -0.006, -0.006],
  bf25: [0.0015, 0.0018, 0.002, 0.0022, 0.0025, 0.0027],
};

export function buildSampleMarket(valuationDate: SerialDate = parseISO("2026-09-03"), quotes: SampleMarketQuotes = SAMPLE_QUOTES): MarketContext {
  const eurOis = bootstrapCurve(valuationDate, { id: "EUR-ESTR", currency: "EUR", index: "ESTR", quotes: quotes.eurOis });
  const eur6m = bootstrapCurve(valuationDate, { id: "EUR-EURIBOR-6M", currency: "EUR", index: "EURIBOR-6M", quotes: quotes.eur6m, discountCurve: eurOis.curve });
  const eur3m = bootstrapCurve(valuationDate, { id: "EUR-EURIBOR-3M", currency: "EUR", index: "EURIBOR-3M", quotes: quotes.eur3m, discountCurve: eurOis.curve });
  const usd = bootstrapCurve(valuationDate, { id: "USD-SOFR", currency: "USD", index: "SOFR", quotes: quotes.usdSofr });
  const gbp = bootstrapCurve(valuationDate, { id: "GBP-SONIA", currency: "GBP", index: "SONIA", quotes: quotes.gbpSonia });
  const chf = bootstrapCurve(valuationDate, { id: "CHF-SARON", currency: "CHF", index: "SARON", quotes: quotes.chfSaron });
  return {
    valuationDate,
    curves: {
      [eurOis.curve.id]: eurOis.curve,
      [eur6m.curve.id]: eur6m.curve,
      [eur3m.curve.id]: eur3m.curve,
      [usd.curve.id]: usd.curve,
      [gbp.curve.id]: gbp.curve,
      [chf.curve.id]: chf.curve,
    },
    discountCurveId: { EUR: "EUR-ESTR", USD: "USD-SOFR", GBP: "GBP-SONIA", CHF: "CHF-SARON" },
    fxSpots: { ...quotes.fxSpots },
    fixings: [],
    swaptionVols: { EUR: SAMPLE_EUR_SWAPTION_VOLS },
    capletVols: { "EUR-EURIBOR-6M": SAMPLE_EUR_CAPLET_VOLS },
    fxVols: { EURUSD: SAMPLE_EURUSD_VOLS, EURGBP: SAMPLE_EURGBP_VOLS, EURCHF: SAMPLE_EURCHF_VOLS },
    credit: {
      "CPTY-A": { hazardRate: 0.01, recovery: 0.4 },
      "CPTY-B": { hazardRate: 0.025, recovery: 0.4 },
      OWN: { hazardRate: 0.008, recovery: 0.4 },
    },
    meta: { source: "DERIVA sample market (indicative)", label: "Sample EoD" },
  };
}
