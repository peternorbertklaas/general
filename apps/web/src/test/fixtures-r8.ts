/**
 * Shared round-8 fixtures: the CZK register envelope the API probe used
 * (docs/quality/review-markt-r8.md, R8-1 / R8-2) and snapshot builders that add
 * curves the sample market does not carry.
 */
import { type MarketSnapshotJson, type RateIndex, type SwapConventions, SAMPLE_QUOTES, buildSampleMarket, serializeMarket } from "@deriva/pricing-core";
import { type RegisterEnvelope, type WorkstationSnapshotJson } from "../lib/register-envelope.js";

export const CZK_ENVELOPE: Required<RegisterEnvelope> = {
  calendars: [{ id: "CZ", name: "Prag", holidays: ["2027-07-05", "2027-07-06", "2027-09-28", "2027-10-28", "2027-11-17"] }],
  indices: [
    {
      name: "CZEONIA",
      currency: "CZK",
      type: "OIS",
      tenor: "1D",
      dayCount: "ACT/360",
      fixingCalendar: "CZ",
      fixingLag: 0,
      businessDayConvention: "ModifiedFollowing",
      endOfMonth: false,
      curveId: "CZK-CZEONIA",
    },
    {
      name: "PRIBOR-6M",
      currency: "CZK",
      type: "IBOR",
      tenor: "6M",
      dayCount: "ACT/360",
      fixingCalendar: "CZ",
      fixingLag: 2,
      businessDayConvention: "ModifiedFollowing",
      endOfMonth: true,
      curveId: "CZK-PRIBOR-6M",
    },
  ] as RateIndex[],
  conventions: [
    {
      currency: "CZK",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      floatIndex: "PRIBOR-6M",
      floatFrequency: "6M",
      calendar: "CZ",
      spotLag: 2,
      oisIndex: "CZEONIA",
      oisFixedFrequency: "1Y",
      oisFixedDayCount: "ACT/360",
      oisPaymentLag: 2,
    },
  ] as SwapConventions[],
};

/** A snapshot of the *sample* market at `valuationDate` – the auditor's file without any extra curve. */
export function sampleSnapshot(valuationDate: number): MarketSnapshotJson {
  return JSON.parse(JSON.stringify(serializeMarket(buildSampleMarket(valuationDate, JSON.parse(JSON.stringify(SAMPLE_QUOTES)))))) as MarketSnapshotJson;
}

/**
 * The sample snapshot plus a curve the sample set does not carry, cloned from
 * the EUR-ESTR nodes (`id`, `currency`), as that currency's discount curve with
 * an EUR spot – e.g. `withCurve(snap, "CZK-CZEONIA", "CZK", 24.6)`.
 */
export function withCurve(snap: MarketSnapshotJson, id: string, currency: string, eurSpot: number): MarketSnapshotJson {
  const estr = snap.curves.find((c) => c.id === "EUR-ESTR")!;
  return {
    ...snap,
    curves: [...snap.curves, { ...JSON.parse(JSON.stringify(estr)), id, currency, meta: { ...(estr.meta ?? {}), source: "fixture" } }],
    discountCurveId: { ...snap.discountCurveId, [currency]: id },
    fxSpots: { ...snap.fxSpots, [`EUR${currency}`]: eurSpot },
  };
}

/** The API's CZK snapshot of round 8: sample curves + CZK-CZEONIA + EUR/CZK spot + the register envelope. */
export function czkSnapshot(valuationDate: number): WorkstationSnapshotJson {
  return { ...withCurve(sampleSnapshot(valuationDate), "CZK-CZEONIA", "CZK", 24.6), ...JSON.parse(JSON.stringify(CZK_ENVELOPE)) };
}
