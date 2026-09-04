import { type Trade } from "@deriva/pricing-core";

export type IssueLevel = "error" | "warn";

export interface TradeIssue {
  /** Field key used by the editor to attach the message (e.g. "notional", "rate:0", "terminationDate"). */
  field: string;
  level: IssueLevel;
  msg: string;
}

/** Plausibility band for fixed rates / strikes (decimal). */
export const RATE_MIN = -0.05;
export const RATE_MAX = 0.25;

function rateCheck(field: string, v: number | undefined, label: string, out: TradeIssue[]): void {
  if (v === undefined) return;
  if (!Number.isFinite(v)) out.push({ field, level: "error", msg: `${label} ist keine gültige Zahl` });
  else if (v < RATE_MIN || v > RATE_MAX) out.push({ field, level: "warn", msg: `${label} außerhalb des Plausibilitätsbereichs (−5 % … 25 %)` });
}

function notionalCheck(field: string, v: number, label: string, out: TradeIssue[]): void {
  if (!Number.isFinite(v)) out.push({ field, level: "error", msg: `${label} ist keine gültige Zahl` });
  else if (v <= 0) out.push({ field, level: "error", msg: `${label} muss größer als 0 sein` });
}

function dateOrder(fieldEnd: string, start: number, end: number, msg: string, out: TradeIssue[], allowEqual = false): void {
  if (allowEqual ? end < start : end <= start) out.push({ field: fieldEnd, level: "error", msg });
}

/**
 * Validation layer between editor and pricer: German messages, per-field,
 * with levels. Errors flag inputs the pricer cannot handle sensibly; warnings
 * flag implausible but computable inputs.
 */
export function validateTrade(t: Trade): TradeIssue[] {
  const out: TradeIssue[] = [];
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      t.legs.forEach((leg, i) => {
        notionalCheck(`notional:${i}`, leg.notional, "Nominal", out);
        if (leg.type === "Fixed") rateCheck(`rate:${i}`, leg.rate, "Festsatz", out);
        else if (leg.spread !== undefined && Math.abs(leg.spread) > 0.05)
          out.push({ field: `spread:${i}`, level: "warn", msg: "Spread über 500 bp – bitte prüfen" });
        dateOrder(`terminationDate:${i}`, leg.effectiveDate, leg.terminationDate, "Enddatum muss nach dem Startdatum liegen", out);
        for (const e of leg.notionalSchedule ?? []) {
          if (!Number.isFinite(e.notional) || e.notional < 0) {
            out.push({ field: `notionalSchedule:${i}`, level: "error", msg: "Nominalplan enthält ungültige Beträge" });
            break;
          }
        }
      });
      if (t.legs.length === 0) out.push({ field: "legs", level: "error", msg: "Mindestens ein Leg erforderlich" });
      // Both legs on the same side make no economic sense.
      if (t.legs.length === 2 && t.legs[0]!.payReceive === t.legs[1]!.payReceive)
        out.push({ field: "payReceive", level: "warn", msg: "Beide Legs haben dieselbe Richtung" });
      break;
    }
    case "FRA":
      notionalCheck("notional", t.notional, "Nominal", out);
      rateCheck("fixedRate", t.fixedRate, "Festsatz", out);
      dateOrder("endDate", t.startDate, t.endDate, "Ende muss nach dem Start liegen", out);
      break;
    case "CapFloor":
      notionalCheck("notional", t.notional, "Nominal", out);
      rateCheck("strike", t.strike, t.capFloor === "Floor" ? "Floor-Strike" : "Cap-Strike", out);
      if (t.capFloor === "Collar") {
        rateCheck("floorStrike", t.floorStrike, "Floor-Strike", out);
        if (t.floorStrike !== undefined && t.floorStrike >= t.strike)
          out.push({ field: "floorStrike", level: "error", msg: "Floor-Strike muss unter dem Cap-Strike liegen" });
      }
      dateOrder("terminationDate", t.effectiveDate, t.terminationDate, "Ende muss nach dem Start liegen", out);
      if (t.volOverride !== undefined && (t.volOverride <= 0 || t.volOverride > 0.05))
        out.push({ field: "volOverride", level: "warn", msg: "Vol-Override außerhalb 0 … 500 bp" });
      break;
    case "Swaption": {
      const fixed = t.underlying.legs.find((l) => l.type === "Fixed");
      if (!fixed) out.push({ field: "underlying", level: "error", msg: "Underlying benötigt ein Festzins-Leg" });
      else {
        notionalCheck("notional", fixed.notional, "Nominal", out);
        if (fixed.type === "Fixed") rateCheck("strike", fixed.rate, "Strike", out);
        dateOrder("swapEnd", fixed.effectiveDate, fixed.terminationDate, "Swap-Ende muss nach dem Swap-Start liegen", out);
        if (t.expiryDate > fixed.effectiveDate) out.push({ field: "expiryDate", level: "warn", msg: "Verfall liegt nach dem Swap-Start" });
      }
      if (t.volOverride !== undefined && (t.volOverride <= 0 || t.volOverride > 0.05))
        out.push({ field: "volOverride", level: "warn", msg: "Vol-Override außerhalb 0 … 500 bp" });
      break;
    }
    case "FxForward":
      notionalCheck("buyAmount", t.buyAmount, "Kaufbetrag", out);
      notionalCheck("sellAmount", t.sellAmount, "Verkaufsbetrag", out);
      if (t.buyCurrency === t.sellCurrency) out.push({ field: "sellCurrency", level: "error", msg: "Kauf- und Verkaufswährung müssen sich unterscheiden" });
      break;
    case "FxSwap":
      for (const [k, leg] of [
        ["nearLeg", t.nearLeg],
        ["farLeg", t.farLeg],
      ] as const) {
        notionalCheck(`${k}.buyAmount`, leg.buyAmount, "Kaufbetrag", out);
        notionalCheck(`${k}.sellAmount`, leg.sellAmount, "Verkaufsbetrag", out);
        if (leg.buyCurrency === leg.sellCurrency)
          out.push({ field: `${k}.sellCurrency`, level: "error", msg: "Kauf- und Verkaufswährung müssen sich unterscheiden" });
      }
      dateOrder("farLeg.deliveryDate", t.nearLeg.deliveryDate, t.farLeg.deliveryDate, "Far-Valuta muss nach der Near-Valuta liegen", out);
      break;
    case "FxOption":
      notionalCheck("notional", t.notional, "Nominal", out);
      if (!Number.isFinite(t.strike) || t.strike <= 0) out.push({ field: "strike", level: "error", msg: "Strike muss größer als 0 sein" });
      dateOrder("deliveryDate", t.expiryDate, t.deliveryDate, "Lieferung darf nicht vor dem Verfall liegen", out, true);
      if (t.barrier && (!Number.isFinite(t.barrier.level) || t.barrier.level <= 0))
        out.push({ field: "barrierLevel", level: "error", msg: "Barriere-Level muss größer als 0 sein" });
      if (t.volOverride !== undefined && (t.volOverride <= 0 || t.volOverride > 1))
        out.push({ field: "volOverride", level: "warn", msg: "Vol-Override außerhalb 0 … 100 %" });
      break;
  }
  if (!t.counterparty || !t.counterparty.trim()) out.push({ field: "counterparty", level: "warn", msg: "Kontrahent fehlt (offen)" });
  if (t.uti !== undefined && !utiValid(t.uti)) out.push({ field: "uti", level: "warn", msg: UTI_MSG });
  return out;
}

/** UTI format (EMIR Refit / ISO 23897): 1–52 characters A–Z, 0–9, no separators (R3-12). */
export const UTI_RE = /^[A-Z0-9]{1,52}$/;
export const UTI_MSG = "UTI: 1–52 Zeichen A–Z / 0–9 ohne Leer- und Sonderzeichen (ISO 23897, i. d. R. LEI-Präfix)";
export function utiValid(uti: string | undefined): boolean {
  return uti === undefined || UTI_RE.test(uti.trim());
}

export function hasErrors(issues: TradeIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** Lookup helper for the editor. */
export function issueFor(issues: TradeIssue[], field: string): TradeIssue | undefined {
  return issues.find((i) => i.field === field);
}
