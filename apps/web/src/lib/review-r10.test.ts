/**
 * Round-10 library findings (docs/quality/review-ui-r10.md R10-02 / R10-05 /
 * R10-F2 / R10-F3, review-markt-r10.md R10-3): the `[index]` slot of cap /
 * floor / collar / swaption in the quick entry, the API alias `tenor` for every
 * rate product, the column signature beating a bare file-name token, the
 * neighbour-row focus with reused row nodes and the import-aware registration
 * toast when the snapshot already holds the currency's curve.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Trade, parseISO } from "@deriva/pricing-core";
import { CZK_ENVELOPE, sampleSnapshot, withCurve } from "../test/fixtures-r8.js";
import { registrationToast, snapshotCurveOf } from "../views/AddCurrencyForm.js";
import { focusNeighbourAfterRemoval } from "./focus.js";
import { csvTypeFromFileName, csvTypeHintFromFileName, detectCsvType, tradesFromCsv } from "./portfolio-io.js";
import { parseQuickEntry } from "./quick-parser.js";
import { registerEnvelope, unregisterEnvelope } from "./register-envelope.js";

const VAL = parseISO("2026-09-03");
const capIndex = (t: Trade | undefined) => (t?.type === "CapFloor" ? t.index : undefined);
const capNotional = (t: Trade | undefined) => (t?.type === "CapFloor" ? t.notional : undefined);
const underlyingIndex = (t: Trade | undefined) =>
  t?.type === "Swaption" ? t.underlying.legs.map((l) => (l.type === "Float" ? l.index : "")).filter(Boolean)[0] : undefined;
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("Markt R10-3 – cap|floor|collar and swpt take an [index] token like irs / fra", () => {
  afterEach(() => unregisterEnvelope(CZK_ENVELOPE));

  it("'cap 2y 3% 10m euribor3m' → caplet index EURIBOR-3M, preview „· EURIBOR-3M“; floor / collar likewise", () => {
    const cap = parseQuickEntry("cap 2y 3% 10m euribor3m", VAL);
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;
    expect(capIndex(cap.trade)).toBe("EURIBOR-3M");
    expect(cap.description).toMatch(/· EURIBOR-3M$/);
    expect(capNotional(cap.trade)).toBe(10_000_000);
    const floor = parseQuickEntry("floor 5y 2% 10m estr", VAL);
    expect(floor.ok && capIndex(floor.trade)).toBe("ESTR");
    const collar = parseQuickEntry("collar 7y 3.5/1.5 6m euribor3m", VAL);
    expect(collar.ok && capIndex(collar.trade)).toBe("EURIBOR-3M");
    expect(collar.ok && capNotional(collar.trade)).toBe(6_000_000);
    // without the token the default rule stays (no index note in the preview)
    const plain = parseQuickEntry("cap 2y 3% 10m", VAL);
    expect(plain.ok && capIndex(plain.trade)).toBe("EURIBOR-6M");
    expect(plain.ok && plain.description).not.toMatch(/EURIBOR/);
    // the curve check still applies to a typed index
    const noCurve = parseQuickEntry("cap 2y 3% 10m euribor3m", VAL, { curveIds: ["EUR-ESTR", "EUR-EURIBOR-6M"], curveCurrencies: ["EUR"] });
    expect(noCurve.ok && noCurve.description).toMatch(/⚠ Kurve EUR-EURIBOR-3M fehlt/);
  });

  it("'swpt czk 1y5y payer 4% 50m czeonia' → underlying index CZEONIA, preview „Underlying CZEONIA“", () => {
    expect(registerEnvelope(CZK_ENVELOPE).ok).toBe(true);
    const r = parseQuickEntry("swpt czk 1y5y payer 4% 50m czeonia", VAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trade?.type).toBe("Swaption");
    expect(underlyingIndex(r.trade)).toBe("CZEONIA");
    expect(r.description).toMatch(/Payer-Swaption CZK 1Yx5Y @ 4,000 % · Nominal 50\.000\.000/);
    expect(r.description).toMatch(/· Underlying CZEONIA/);
    // EUR: the built-in token works as well; the default stays the conventional index
    const eur = parseQuickEntry("swpt 1y5y payer 3% 10m euribor3m", VAL);
    expect(eur.ok && underlyingIndex(eur.trade)).toBe("EURIBOR-3M");
    const plain = parseQuickEntry("swpt 1y5y payer 3% 10m", VAL);
    expect(plain.ok && underlyingIndex(plain.trade)).toBe("EURIBOR-6M");
  });

  it("an unknown index token names the currency's indices; the grammar texts advertise [index]", () => {
    expect(registerEnvelope(CZK_ENVELOPE).ok).toBe(true);
    const bad = parseQuickEntry("cap czk 2y 3% 10m pribor3m", VAL);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/Unbekannter Index „pribor3m“ – für CZK registriert: CZEONIA, PRIBOR-6M/);
    const badSwpt = parseQuickEntry("swpt czk 1y5y payer 4% 50m pribor3m", VAL);
    expect(!badSwpt.ok && badSwpt.error).toMatch(/Unbekannter Index „pribor3m“/);
    const unknown = parseQuickEntry("cap 2y 3% 10m foo", VAL);
    expect(!unknown.ok && unknown.error).toMatch(/\[notional\] \[index\] \[@Kontrahent\]/);
    const unknownSwpt = parseQuickEntry("swpt 1y5y payer 3% 10m foo", VAL);
    expect(!unknownSwpt.ok && unknownSwpt.error).toMatch(/\[notional\] \[index\] \[cash\|physical\]/);
  });
});

describe("R10-F2 – the API alias `tenor` is accepted as maturity for IRS / AMORT / BASIS / CAP", () => {
  const read = (text: string, fileName?: string) => tradesFromCsv(text, { valuationDate: VAL, fileName });

  it("the API IRS row with `tenor` imports with and without a type column", () => {
    const api = "id;currency;notional;payReceive;fixedRate;effectiveDate;tenor;index\nIRS-API-1;EUR;10000000;Pay;3,1 %;2026-09-07;10Y;EURIBOR-6M\n";
    const r = read(api, "bestand.csv");
    expect(r.errors).toEqual([]);
    expect(r.trades.length).toBe(1);
    expect(r.typeSource).toEqual({ type: "IRS", from: "columns" });
    const typed = read(`type;${api.replace("\nIRS-API-1", "\nIRS;IRS-API-1")}`);
    expect(typed.errors).toEqual([]);
    expect(typed.trades.length).toBe(1);
  });

  it("AMORT, BASIS and CAP read `tenor` too; a row without both columns names both", () => {
    const amort = read("type;id;currency;notional;rate;start;tenor;finalNotional\nAMORT;AM-1;EUR;10000000;3 %;2026-09-07;10Y;0\n");
    expect(amort.errors).toEqual([]);
    expect(amort.trades.length).toBe(1);
    const basis = read("type;id;currency;notional;receiveIndex;payIndex;start;tenor\nBASIS;BS-1;EUR;10000000;EURIBOR-3M;EURIBOR-6M;2026-09-07;5Y\n");
    expect(basis.errors).toEqual([]);
    expect(basis.trades.length).toBe(1);
    const cap = read("type;id;currency;notional;strike;start;tenor\nCAP;CAP-1;EUR;10000000;3 %;2026-09-07;5Y\n");
    expect(cap.errors).toEqual([]);
    expect(cap.trades.length).toBe(1);
    const none = read("type;id;currency;notional;rate;start\nIRS;IRS-X;EUR;10000000;3 %;2026-09-07\n");
    expect(none.trades).toEqual([]);
    expect(none.errors[0]!.msg).toBe("Laufzeit/Enddatum fehlt (Spalte „maturity“ oder „tenor“)");
  });
});

describe("R10-F3 – the column signature beats a bare file-name token; templates and API names stay authoritative", () => {
  const IRS_HEADER = ["id", "currency", "notional", "direction", "rate", "start", "maturity", "index"];
  const IRS_ROW = ["IRS-1", "EUR", "10000000", "Pay", "3 %", "2026-09-07", "10Y", "EURIBOR-6M"];
  const IRS_TEXT = `${IRS_HEADER.join(";")}\n${IRS_ROW.join(";")}\n`;

  it("csvTypeHintFromFileName distinguishes template / API names from bare tokens", () => {
    expect(csvTypeHintFromFileName("deriva-import-vorlage-cap.csv")).toEqual({ type: "CAP", bare: false });
    expect(csvTypeHintFromFileName("CrossCurrencySwap.csv")).toEqual({ type: "CCS", bare: false });
    expect(csvTypeHintFromFileName("kredit-cap-2026.csv")).toEqual({ type: "CAP", bare: true });
    expect(csvTypeHintFromFileName("IRS.csv")).toEqual({ type: "IRS", bare: true });
    expect(csvTypeHintFromFileName("bestand.csv")).toBeUndefined();
    // the plain accessor is unchanged
    expect(csvTypeFromFileName("kredit-cap-2026.csv")).toBe("CAP");
  });

  it("IRS rows in „kredit-cap-2026.csv“ are read as IRS from the column set – a template name still wins", () => {
    expect(detectCsvType(IRS_HEADER, IRS_ROW, "kredit-cap-2026.csv")).toEqual({ type: "IRS", from: "columns" });
    expect(detectCsvType(IRS_HEADER, IRS_ROW, "irs-2026.csv")).toEqual({ type: "IRS", from: "file" }); // agreeing token: file
    expect(detectCsvType(["id", "name"], ["a", "b"], "kredit-cap-2026.csv")).toEqual({ type: "CAP", from: "file" }); // columns say nothing
    expect(detectCsvType(IRS_HEADER, IRS_ROW, "deriva-import-vorlage-cap.csv")).toEqual({ type: "CAP", from: "file" });
    expect(detectCsvType(IRS_HEADER, IRS_ROW, "InterestRateSwap.csv")).toEqual({ type: "IRS", from: "file" });
    const r = tradesFromCsv(IRS_TEXT, { valuationDate: VAL, fileName: "kredit-cap-2026.csv" });
    expect(r.errors).toEqual([]);
    expect(r.trades.length).toBe(1);
    expect(r.typeSource).toEqual({ type: "IRS", from: "columns" });
  });

  it("`forcedType` (the error dialog's „Anderen Produkttyp wählen …“) beats file name and columns", () => {
    const wrong = tradesFromCsv(IRS_TEXT, { valuationDate: VAL, fileName: "deriva-import-vorlage-cap.csv" });
    expect(wrong.typeSource).toEqual({ type: "CAP", from: "file" });
    expect(wrong.errors.map((e) => e.msg)).toEqual(["Strike fehlt"]);
    const forced = tradesFromCsv(IRS_TEXT, { valuationDate: VAL, fileName: "deriva-import-vorlage-cap.csv", forcedType: "IRS" });
    expect(forced.typeSource).toEqual({ type: "IRS", from: "dialog" });
    expect(forced.errors).toEqual([]);
    expect(forced.trades.length).toBe(1);
  });
});

describe("R10-02 – focusNeighbourAfterRemoval picks the neighbour by DOM position (reused row nodes)", () => {
  const table = (texts: string[]) => {
    const tb = document.createElement("tbody");
    for (const t of texts) {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.textContent = t;
      tb.appendChild(tr);
    }
    const tab = document.createElement("table");
    tab.appendChild(tb);
    document.body.appendChild(tab);
    return { tab, tb, rows: () => Array.from(tb.querySelectorAll("tr")) };
  };
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("two rows, the first removed – React reuses the first node for the survivor: the focus lands on it, not on „+ Zeile“", async () => {
    const { tab, tb, rows } = table(["A", "B"]);
    const add = document.createElement("button");
    add.dataset.testid = "add";
    document.body.appendChild(add);
    const [first, second] = rows();
    first!.focus();
    focusNeighbourAfterRemoval(first as HTMLTableRowElement, '[data-testid="add"]');
    // positional keys: React keeps node 0 (now showing "B") and drops node 1
    first!.textContent = "B";
    tb.removeChild(second!);
    await flush();
    expect(document.activeElement).toBe(first);
    expect(tab.contains(document.activeElement)).toBe(true);
    // the last row removed → the fallback control
    focusNeighbourAfterRemoval(first as HTMLTableRowElement, '[data-testid="add"]');
    tab.remove();
    await flush();
    expect(document.activeElement).toBe(add);
  });

  it("three rows, the first removed – the focus shows the text of the former second row, not the third", async () => {
    const { tb, rows } = table(["1Y 150 bp", "3Y 169 bp", "5Y 168 bp"]);
    const [r0, r1, r2] = rows();
    r0!.focus();
    focusNeighbourAfterRemoval(r0 as HTMLTableRowElement, '[data-testid="none"]');
    r0!.textContent = "3Y 169 bp";
    r1!.textContent = "5Y 168 bp";
    tb.removeChild(r2!);
    await flush();
    expect(document.activeElement).toBe(r0);
    expect(document.activeElement!.textContent).toBe("3Y 169 bp");
    // stable keys (the fixings table): the removed node is gone, the same position rule holds
    const t2 = table(["a", "b", "c"]);
    const [s0, s1] = t2.rows();
    focusNeighbourAfterRemoval(s1 as HTMLTableRowElement, '[data-testid="none"]');
    t2.tb.removeChild(s1!);
    await flush();
    expect(document.activeElement!.textContent).toBe("c");
    expect(s0!.textContent).toBe("a");
  });
});

describe("R10-05 – „+ Währung“ under a snapshot that already holds the currency's curve", () => {
  it("the toast says the snapshot curve is usable at once and never sends the user to „Zum Sample-Markt“", () => {
    const summary = "2 Indizes HUFONIA, BUBOR-6M · Konventionen HUF";
    const withCurveToast = registrationToast(summary, "HUF", "import", "HUF-HUFONIA");
    expect(withCurveToast).toBe(
      "Registriert: 2 Indizes HUFONIA, BUBOR-6M · Konventionen HUF – die Snapshot-Kurve HUF-HUFONIA ist sofort nutzbar (Schnelleingabe „irs huf …“)",
    );
    expect(withCurveToast).not.toMatch(/„\+ Kurve“|Zum Sample-Markt/);
    // without a curve the R9-03 text stays; in sample mode the curve id is ignored
    expect(registrationToast(summary, "HUF", "import")).toMatch(/im Import-Modus ist „\+ Kurve“ gesperrt/);
    expect(registrationToast(summary, "HUF", "sample", "HUF-HUFONIA")).toMatch(/jetzt mit „\+ Kurve“ eine HUF-Kurve anlegen/);
  });

  it("snapshotCurveOf prefers the discount curve, falls back to any curve of the currency", () => {
    const snap = withCurve(sampleSnapshot(VAL), "HUF-HUFONIA", "HUF", 395);
    const curves = Object.fromEntries(snap.curves.map((c) => [c.id, { id: c.id, currency: c.currency }])) as never;
    expect(snapshotCurveOf({ curves, discountCurveId: snap.discountCurveId }, "HUF")).toBe("HUF-HUFONIA");
    expect(snapshotCurveOf({ curves, discountCurveId: {} }, "HUF")).toBe("HUF-HUFONIA");
    expect(snapshotCurveOf({ curves, discountCurveId: snap.discountCurveId }, "RON")).toBeUndefined();
    vi.restoreAllMocks();
  });
});
