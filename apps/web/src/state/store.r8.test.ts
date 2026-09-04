/**
 * Round-8 store semantics (docs/quality/review-markt-r8.md, review-ui-r8.md):
 * the register envelope of a snapshot reaches the workstation (R8-1), "+ Paar"
 * spots and "+ Fläche" surfaces are structural extras that survive import →
 * leave → reload (R8-F2), the import toast knows what it discards, par risk
 * covers added curves (R8-3) and "+ Währung" registrations are undoable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SwaptionVolSurface,
  type Trade,
  advance,
  getCalendar,
  knownCurrencies,
  knownIndices,
  makeVanillaSwap,
  parRisk,
  sampleBootstrapSpecs,
} from "@deriva/pricing-core";
import { parseQuickEntry } from "../lib/quick-parser.js";
import { exportEnvelope, unregisterEnvelope } from "../lib/register-envelope.js";
import { CZK_ENVELOPE, czkSnapshot, sampleSnapshot, withCurve } from "../test/fixtures-r8.js";
import { PERSIST_KEY, extraCurveSpec, importDiscards, marketModified, useStore, volSurfaceLabel } from "./store.js";

const st = () => useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));
const OIS = [
  { type: "OIS" as const, tenor: "1Y", rate: 0.031 },
  { type: "OIS" as const, tenor: "2Y", rate: 0.0315 },
  { type: "OIS" as const, tenor: "5Y", rate: 0.032 },
  { type: "OIS" as const, tenor: "10Y", rate: 0.033 },
];
const swap = (ccy: string, index: string, id: string): Trade =>
  makeVanillaSwap({
    id,
    currency: ccy,
    notional: 10_000_000,
    payReceiveFixed: "Pay",
    fixedRate: 0.03,
    effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
    maturity: "5Y",
    index,
  });
/** Reload simulation: persist → reset → rehydrate from the persisted slice. */
const reload = async () => {
  await flush();
  const raw = localStorage.getItem(PERSIST_KEY)!;
  st().resetPortfolio();
  localStorage.setItem(PERSIST_KEY, raw);
  await useStore.persist.rehydrate();
};
const quickOpts = () => ({ curveCurrencies: Object.keys(st().baseMarket.discountCurveId), curveIds: Object.keys(st().baseMarket.curves) });

describe("Markt R8-1 – the snapshot envelope registers indices, conventions and calendars in the workstation", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
    unregisterEnvelope(CZK_ENVELOPE);
  });
  afterEach(() => vi.restoreAllMocks());

  it("CZK snapshot with envelope → 'irs czk …' is priceable, the envelope is persisted and re-registered on reload, exported again", async () => {
    expect(knownCurrencies()).not.toContain("CZK");
    // before the import the palette does not know CZK
    expect(parseQuickEntry("irs czk 5y pay 4% 100m", st().valuationDate, quickOpts()).error).toMatch(/Unbekannte Währung „CZK“/);
    const r = st().importSnapshot(czkSnapshot(st().valuationDate));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registered).toBe("2 Indizes CZEONIA, PRIBOR-6M · Konventionen CZK · Kalender CZ");
    expect(knownCurrencies()).toContain("CZK");
    expect(knownIndices("CZK").map((i) => i.name)).toEqual(["CZEONIA", "PRIBOR-6M"]);
    expect(st().baseMarket.discountCurveId.CZK).toBe("CZK-CZEONIA");
    // the quick entry accepts CZK and picks the index with a curve (CZEONIA – PRIBOR-6M has none)
    const q = parseQuickEntry("irs czk 5y pay 4% 100m", st().valuationDate, quickOpts());
    expect(q.ok).toBe(true);
    expect(q.description).toMatch(/CZEONIA \(Kurve vorhanden; PRIBOR-6M ohne Kurve\)/);
    const t = st().addTrade(q.trade!, { select: false });
    expect(st().results[t.id]?.error).toBeUndefined();
    const pv0 = st().results[t.id]!.result!.pv;
    expect(Number.isFinite(pv0)).toBe(true);
    // the persisted snapshot carries the envelope
    expect(st().importedSnapshot?.indices?.map((i) => i.name)).toEqual(["CZEONIA", "PRIBOR-6M"]);
    expect(st().importedSnapshot?.calendars?.[0]?.id).toBe("CZ");
    // reload with an empty register: hydration registers the envelope again before the market is rebuilt
    await flush();
    unregisterEnvelope(CZK_ENVELOPE);
    expect(knownCurrencies()).not.toContain("CZK");
    await reload();
    expect(st().marketSource).toBe("import");
    expect(knownCurrencies()).toContain("CZK");
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().results[t.id]!.result!.pv).toBeCloseTo(pv0, 6);
    // the workstation export carries the same envelope
    const env = exportEnvelope();
    expect(env.conventions?.map((c) => c.currency)).toEqual(["CZK"]);
    expect(env.indices?.map((i) => i.name)).toEqual(expect.arrayContaining(["CZEONIA", "PRIBOR-6M"]));
    expect(env.calendars?.some((c) => c.id === "CZ")).toBe(true);
    // a snapshot whose envelope names a built-in index is refused before anything changes
    const bad = st().importSnapshot({ ...czkSnapshot(st().valuationDate), indices: [{ ...CZK_ENVELOPE.indices[0]!, name: "SOFR" }] });
    expect(bad).toMatchObject({ ok: false, error: /Index „SOFR“ ist im Kern eingebaut/ });
    expect(st().marketSource).toBe("import");
  });

  it("'+ Währung' registers, persists and is undoable; removal is refused while an added curve uses the currency", async () => {
    const r = st().addCurrencyRegistration(CZK_ENVELOPE);
    expect(r).toMatchObject({ ok: true, summary: /CZEONIA, PRIBOR-6M/ });
    expect(knownCurrencies()).toContain("CZK");
    expect(st().extraRegister.conventions?.[0]?.currency).toBe("CZK");
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "register", label: /Registriert/ });
    // a curve in the new currency
    expect(st().addExtraCurve({ id: "CZK-CZEONIA", currency: "CZK", index: "CZEONIA", quotes: OIS }, { fxSpot: { pair: "EURCZK", rate: 24.6 } })).toEqual({
      ok: true,
    });
    const t = st().addTrade(swap("CZK", "CZEONIA", "IRS-CZK"), { select: false });
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().removeCurrencyRegistration("CZK")).toMatchObject({ ok: false, error: /CZK-CZEONIA/ });
    // reload keeps registration, curve and valuation
    await reload();
    expect(knownCurrencies()).toContain("CZK");
    expect(st().extraRegister.indices?.length).toBe(2);
    expect(st().results[t.id]?.error).toBeUndefined();
    // curve away → registration removable, undo brings it back
    expect(st().removeExtraCurve("CZK-CZEONIA")).toBe(true);
    expect(st().removeCurrencyRegistration("CZK")).toEqual({ ok: true });
    expect(knownCurrencies()).not.toContain("CZK");
    expect(st().extraRegister).toEqual({});
    expect(st().undo()).toBe("Registrierung CZK entfernt");
    expect(knownCurrencies()).toContain("CZK");
    // undo of the registration itself
    st().resetPortfolio();
    expect(knownCurrencies()).not.toContain("CZK");
    st().addCurrencyRegistration(CZK_ENVELOPE);
    expect(st().undo()).toMatch(/^Registriert/);
    expect(knownCurrencies()).not.toContain("CZK");
    expect(st().extraRegister).toEqual({});
    // duplicate / invalid registrations are refused with German texts
    expect(st().addCurrencyRegistration({ indices: [{ ...CZK_ENVELOPE.indices[0]!, name: "ESTR" }] })).toMatchObject({ ok: false, error: /ESTR/ });
  });
});

describe("R8-F2 – '+ Paar' spots and '+ Fläche' surfaces are structural extras", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });

  const sekCube = (): SwaptionVolSurface => {
    const eur = st().baseMarket.swaptionVols!.EUR!;
    return { ...eur, id: "SEK-SWAPTION-NORMAL", currency: "SEK", atm: eur.atm.map((r) => r.map(() => 0.006)) };
  };

  it("they reach the market, count as modifiziert, are undoable and survive import → leave → reload without a Level-3 fallback", async () => {
    // SEK curve without a spot, then "+ Paar" and "+ Fläche"
    expect(st().addExtraCurve({ id: "SEK-SWESTR", currency: "SEK", index: "SWESTR", quotes: OIS })).toEqual({ ok: true });
    const t = st().addTrade(swap("SEK", "SWESTR", "IRS-SEK"), { select: false });
    expect(st().results[t.id]?.error).toMatch(/„\+ Paar“/);
    expect(st().addExtraSpot("eursek", 11.2)).toBe(true);
    expect(st().extraSpots.EURSEK).toBe(11.2);
    expect(st().baseMarket.fxSpots.EURSEK).toBe(11.2);
    expect(st().quotes.fxSpots.EURSEK).toBeUndefined();
    expect(st().results[t.id]?.error).toBeUndefined();
    const pv0 = st().results[t.id]!.result!.pv;
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "extras", label: "Spot EUR/SEK 11,2 angelegt" });
    expect(st().setExtraVolSurface("swaptionVols", "SEK", sekCube(), "Swaption-Cube SEK angelegt")).toBe(true);
    expect(st().baseMarket.swaptionVols?.SEK?.currency).toBe("SEK");
    expect(st().volSurfaces.swaptionVols?.SEK).toBeUndefined();
    const sw = parseQuickEntry("swpt sek 1y5y payer 3% 10m", st().valuationDate, {
      ...quickOpts(),
      swaptionVolCurrencies: Object.keys(st().baseMarket.swaptionVols ?? {}),
    });
    expect(sw.ok).toBe(true);
    expect(sw.description).not.toMatch(/⚠/);
    const swpt = st().addTrade(sw.trade!, { select: false });
    expect(st().results[swpt.id]?.error).toBeUndefined();
    expect(st().results[swpt.id]!.result!.warnings.some((w) => /vol surface|fallback/i.test(w))).toBe(false);
    expect(marketModified(st())).toBe(true);
    // the import keeps the extras (not applied) and names them; nothing "discarded" – there were no edits
    const r = st().importSnapshot(sampleSnapshot(st().valuationDate));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.discarded).toEqual([]);
    expect(r.discardedEdits).toBe(false);
    expect(r.kept).toEqual(["Kurve SEK-SWESTR", "Spot EUR/SEK", "Swaption-Cube SEK"]);
    expect(st().extraSpots.EURSEK).toBe(11.2);
    expect(st().extraVolSurfaces.swaptionVols?.SEK).toBeDefined();
    expect(st().baseMarket.fxSpots.EURSEK).toBeUndefined();
    expect(st().results[t.id]?.error).toMatch(/Zum Sample-Markt/);
    // reload while imported, then leave: everything is back
    await reload();
    expect(st().marketSource).toBe("import");
    expect(st().extraSpots.EURSEK).toBe(11.2);
    st().leaveImport();
    expect(st().baseMarket.fxSpots.EURSEK).toBe(11.2);
    expect(st().baseMarket.swaptionVols?.SEK).toBeDefined();
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().results[t.id]!.result!.pv).toBeCloseTo(pv0, 6);
    expect(st().results[swpt.id]!.result!.warnings.some((w) => /vol surface|fallback/i.test(w))).toBe(false);
    // reload in sample mode
    await reload();
    expect(st().baseMarket.fxSpots.EURSEK).toBe(11.2);
    expect(st().baseMarket.swaptionVols?.SEK).toBeDefined();
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().results[swpt.id]!.result!.warnings.some((w) => /vol surface|fallback/i.test(w))).toBe(false);
    // removal and undo
    expect(st().removeExtraSpot("EURSEK")).toBe(true);
    expect(st().baseMarket.fxSpots.EURSEK).toBeUndefined();
    expect(st().undo()).toBe("Spot EUR/SEK entfernt");
    expect(st().baseMarket.fxSpots.EURSEK).toBe(11.2);
    expect(st().setExtraVolSurface("swaptionVols", "SEK", undefined, "Swaption-Vols SEK entfernt")).toBe(true);
    expect(st().baseMarket.swaptionVols?.SEK).toBeUndefined();
    expect(st().undo()).toBe("Swaption-Vols SEK entfernt");
    expect(st().baseMarket.swaptionVols?.SEK).toBeDefined();
    // a cell edit on a structural surface updates the extra (no override layer); "Markt zurücksetzen" clears everything
    const edited = { ...st().baseMarket.swaptionVols!.SEK!, atm: st().baseMarket.swaptionVols!.SEK!.atm.map((r) => r.map(() => 0.0065)) };
    expect(st().setExtraVolSurface("swaptionVols", "SEK", edited, "Swaption-Vol SEK geändert")).toBe(true);
    expect(st().extraVolSurfaces.swaptionVols?.SEK?.atm[0]?.[0]).toBe(0.0065);
    st().resetMarketOverrides();
    expect(st().extraSpots).toEqual({});
    expect(st().extraVolSurfaces).toEqual({});
    expect(st().extraCurves).toEqual({});
    expect(marketModified(st())).toBe(false);
    // quote-set spots win over an extra of the same pair; import mode refuses structural extras (overrides apply there)
    expect(st().addExtraSpot("EURUSD", 2)).toBe(true);
    expect(st().baseMarket.fxSpots.EURUSD).not.toBe(2);
    st().importSnapshot(sampleSnapshot(st().valuationDate));
    expect(st().addExtraSpot("EURNOK", 11.7)).toBe(false);
    expect(st().setExtraVolSurface("swaptionVols", "NOK", sekCube(), "x")).toBe(false);
  });

  it("importDiscards names edits concretely and lists the kept extras", () => {
    expect(importDiscards(st())).toEqual({ discarded: [], kept: [] });
    st().setQuotes({ ...st().quotes, fxSpots: { ...st().quotes.fxSpots, EURUSD: 1.25 } }, "Spot");
    st().setInterpolation("EUR-ESTR", "monotoneConvex");
    st().setVolSurface("swaptionVols", "EUR", { ...st().baseMarket.swaptionVols!.EUR! }, "Vol");
    st().setFxFixings([{ pair: "EURUSD", date: st().valuationDate, rate: 1.17 }], "fx");
    st().setFixings([{ index: "EURIBOR-6M", date: st().valuationDate, value: 0.02 }], "fix");
    st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
    st().addExtraSpot("EURSEK", 11.2);
    const d = importDiscards(st());
    expect(d.discarded).toEqual(["Quote-Änderungen", "Interpolation EUR-ESTR", "Vol-Änderungen Swaption-Cube EUR", "1 FX-Fixing", "Fixings-Override"]);
    expect(d.kept).toEqual(["Kurve DKK-DESTR", "Spot EUR/SEK"]);
    expect(volSurfaceLabel("fxVols", "EURUSD")).toBe("FX-Fläche EUR/USD");
    expect(volSurfaceLabel("capletVols", "EUR-EURIBOR-6M")).toBe("Caplet-Fläche EUR-EURIBOR-6M");
    // in import mode: overrides on the snapshot
    const r = st().importSnapshot(sampleSnapshot(st().valuationDate));
    expect(r.ok && r.discarded.length).toBe(5);
    st().setFxSpot("EURUSD", 1.3);
    expect(importDiscards(st()).discarded).toEqual(["Spot-Overrides EUR/USD"]);
  });
});

describe("Markt R8-3 – par risk covers added curves", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [] });
  });

  it("a NOK swap on a '+ Kurve' curve has a non-zero par DV01 with the extra spec, a silent zero without it", () => {
    st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS }, { fxSpot: { pair: "EURNOK", rate: 11.62 } });
    const t = st().addTrade(swap("NOK", "NOWA", "IRS-NOK"), { select: false });
    expect(st().results[t.id]?.error).toBeUndefined();
    const sampleOnly = parRisk(st().market, t, "EUR", sampleBootstrapSpecs(st().valuationDate, st().quotes));
    expect(sampleOnly.curves).toEqual([]);
    expect(sampleOnly.total).toBe(0);
    const specs = {
      ...sampleBootstrapSpecs(st().valuationDate, st().quotes),
      "NOK-NOWA": extraCurveSpec(st().extraCurves["NOK-NOWA"]!, st().market.discountCurveId),
    };
    const full = parRisk(st().market, t, "EUR", specs);
    expect(full.curves.map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    expect(Math.abs(full.total)).toBeGreaterThan(1);
    // ≈ the zero DV01 of a 5Y payer on 10 m NOK (a few hundred EUR)
    const dv01 = st().risk(t.id)!.dv01;
    expect(Math.sign(full.total)).toBe(Math.sign(dv01));
    expect(Math.abs(full.total - dv01) / Math.abs(dv01)).toBeLessThan(0.15);
  });
});

describe("Markt R8-5 – a snapshot curve outside the sample set is part of the base market", () => {
  it("the curve of an imported snapshot is priced against and its currency reported", () => {
    localStorage.clear();
    st().resetPortfolio();
    const r = st().importSnapshot(withCurve(sampleSnapshot(st().valuationDate), "NOK-NOWA", "NOK", 11.62));
    expect(r.ok).toBe(true);
    expect(st().baseMarket.curves["NOK-NOWA"]?.currency).toBe("NOK");
    const t = st().addTrade(swap("NOK", "NOWA", "IRS-NOK-SNAP"), { select: false });
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().extraCurves["NOK-NOWA"]).toBeUndefined();
  });
});
