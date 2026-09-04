/**
 * German UI texts for values that come from the pricing core in English:
 * core warnings/errors (regex templates), `PricingError` codes, leg / cashflow /
 * option labels, builder trade names, hedge summaries and select options.
 */
import { TRADE_TYPE_LABELS_DE, isPricingError } from "@deriva/pricing-core";

type Rule = { re: RegExp; to: (m: RegExpMatchArray) => string };

const CORE_MESSAGES: Rule[] = [
  // structured fixing warnings (prefix MISSING_FIXING:)
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); used (\S+) forward from (\d{4}-\d{2}-\d{2}) \(same-length period starting today\)$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – ${m[3]}-Forward ab ${isoToDe(m[4]!)} verwendet (gleich lange Periode ab heute)`,
  },
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); accrual period starting (\d{4}-\d{2}-\d{2}) projected with the curve's first forward$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – Periode ab ${isoToDe(m[3]!)} mit dem ersten Kurven-Forward projiziert`,
  },
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); caplet valued on the (\S+) forward from (\d{4}-\d{2}-\d{2})$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – Caplet auf dem ${m[3]}-Forward ab ${isoToDe(m[4]!)} bewertet`,
  },
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); FRA settled on the curve forward$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – FRA mit dem Kurven-Forward abgerechnet`,
  },
  { re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); (.+)$/, to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – ${m[3]}` },
  {
    re: /^NEGATIVE_RATE_LOGNORMAL: (\w+) model with non-positive shifted forward\/strike(.*?) – intrinsic value used, no time value$/,
    to: (m) => `${m[1]}-Modell: verschobener Forward/Strike nicht positiv${m[2]} – innerer Wert ohne Zeitwert`,
  },
  { re: /^FRA already settled$/, to: () => "FRA bereits abgerechnet" },
  // Core R5: FX option past expiry (settlement pending) – valued as the settled payoff, no Greeks
  {
    re: /^EXPIRED: FX option expired (\d{4}-\d{2}-\d{2}) – settlement pending until (\d{4}-\d{2}-\d{2}): settled payoff on (.+?) \((exercised.*?|not exercised.*?)\), no vega, gamma or theta$/,
    to: (m) =>
      `FX-Option am ${isoToDe(m[1]!)} verfallen – Lieferung am ${isoToDe(m[2]!)} steht aus: abgerechnete Auszahlung auf ${germanizeText(m[3]!)} (${
        /^exercised/.test(m[4]!) ? "ausgeübt, als Terminposition zum Strike bewertet" : "nicht ausgeübt / ausgeknockt"
      }), kein Vega, Gamma oder Theta`,
  },
  { re: /^EXPIRED: FX option expired (\d{4}-\d{2}-\d{2}) – (.+)$/, to: (m) => `FX-Option am ${isoToDe(m[1]!)} verfallen – ${germanizeText(m[2]!)}` },
  { re: /^EXPIRED: (.+)$/, to: (m) => `Verfallen: ${germanizeText(m[1]!)}` },
  // Market snapshot import (R5-06): schema / structure problems raised by `deserializeMarket`
  {
    re: /^Unsupported market snapshot schema: (.*)$/,
    to: (m) => `Datei ist kein DERIVA-Markt-Snapshot (Schema „${m[1] === "undefined" || m[1] === "" ? "fehlt" : m[1]}“ unbekannt, erwartet deriva.market/1)`,
  },
  {
    re: /^Market snapshot: fxFixings\[(\d+)\]\.pair must be a 6-letter currency pair \(got (.+)\)$/,
    to: (m) => `Snapshot: FX-Fixing ${Number(m[1]) + 1} – Währungspaar ${m[2]} ungültig (erwartet 6 Buchstaben wie EURUSD)`,
  },
  {
    re: /^Market snapshot: fxFixings\[(\d+)\]\.date must be an ISO date \(got (.+)\)$/,
    to: (m) => `Snapshot: FX-Fixing ${Number(m[1]) + 1} – Datum ${m[2]} ungültig (erwartet JJJJ-MM-TT)`,
  },
  {
    re: /^Market snapshot: fxFixings\[(\d+)\]\.rate must be a positive finite number \(got (.+)\)$/,
    to: (m) => `Snapshot: FX-Fixing ${Number(m[1]) + 1} – Kurs ${m[2]} ungültig (erwartet eine positive Zahl)`,
  },
  {
    re: /^Market snapshot: fxFixings must be an array of \{ pair, date, rate \}$/,
    to: () => "Snapshot: „fxFixings“ muss eine Liste aus Paar, Datum und Kurs sein",
  },
  // Structurally unusable vol surface on import (core R5-1, `INVALID_VOL_SURFACE`) – one line per problem, all German
  {
    re: /^(?:Market snapshot|Snapshot): malformed vol surface (\S+): (.+)$/,
    to: (m) => `Vol-Fläche strukturell ungültig – ${m[2]!.split(/;\s*/).map(translateVolProblem).join("; ")}`,
  },
  { re: /^Market snapshot: (.+)$/, to: (m) => `Snapshot: ${m[1]}` },
  {
    re: /^meta\.snapshotTime must be an ISO-8601 date-time \(got (.+)\)$/,
    to: (m) => `Snapshot-Zeitstempel (meta.snapshotTime) ${m[1]} ist kein ISO-8601-Zeitstempel (erwartet JJJJ-MM-TTThh:mm:ssZ)`,
  },
  { re: /^Discount curve (\S+) for (\S+) missing$/, to: (m) => `Diskontkurve ${m[1]} für ${m[2]} fehlt im Snapshot` },
  {
    re: /^Curve (\S+): discount factor (\S+) at (\d{4}-\d{2}-\d{2}) out of range$/,
    to: (m) => `Kurve ${m[1]}: Diskontfaktor ${m[2]!.replace(".", ",")} am ${isoToDe(m[3]!)} außerhalb (0, 1]`,
  },
  {
    re: /^Curve (\S+): discount factors not decreasing at (\d{4}-\d{2}-\d{2}) \(negative forward rate\)$/,
    to: (m) => `Kurve ${m[1]}: Diskontfaktoren steigen am ${isoToDe(m[2]!)} (negativer Forward)`,
  },
  { re: /^FX pair (\S+) malformed$/, to: (m) => `Währungspaar ${m[1]} ungültig (erwartet 6 Buchstaben wie EURUSD)` },
  { re: /^FX spot (\S+) must be positive$/, to: (m) => `FX-Spot ${m[1]} muss positiv sein` },
  { re: /^FX fixing (\S+) on (\d{4}-\d{2}-\d{2}) given twice$/, to: (m) => `FX-Fixing ${pairDe(m[1]!)} vom ${isoToDe(m[2]!)} ist doppelt hinterlegt` },
  {
    re: /^FX fixing (\S+) on (\S+) must be positive$/,
    to: (m) => `FX-Fixing ${pairDe(m[1]!)} vom ${m[2]!.includes("-") ? isoToDe(m[2]!) : m[2]} muss positiv sein`,
  },
  { re: /^FX fixing \[(\d+)\]: pair (\S+) malformed$/, to: (m) => `FX-Fixing ${Number(m[1]) + 1}: Währungspaar ${m[2]} ungültig` },
  {
    re: /^FX fixing \[(\d+)\] \((\S*)\): date must be a serial date$/,
    to: (m) => `FX-Fixing ${Number(m[1]) + 1}${m[2] ? ` (${pairDe(m[2]!)})` : ""}: Datum fehlt oder ungültig`,
  },
  { re: /^meta\.snapshotTime (.+) is not an ISO-8601 date-time$/, to: (m) => `Snapshot-Zeitstempel (meta.snapshotTime) ${m[1]} ist kein ISO-8601-Zeitstempel` },
  // Vol-surface structure problems (core `validateVolSurfaces` / `deserializeMarket`, Markt R5-1) – paths like "swaptionVols.USD.atm[3]"
  { re: /^(\S+): must be a non-empty array of numbers$/, to: (m) => `${volPathDe(m[1]!)}: muss eine nicht leere Zahlenliste sein` },
  { re: /^(\S+): must be an array of numbers$/, to: (m) => `${volPathDe(m[1]!)}: muss eine Zahlenliste sein` },
  { re: /^(\S+): must be a matrix of numbers$/, to: (m) => `${volPathDe(m[1]!)}: muss eine Zahlenmatrix sein` },
  { re: /^(\S+): must be finite$/, to: (m) => `${volPathDe(m[1]!)}: muss eine endliche Zahl sein` },
  { re: /^(\S+): must be ≥ 0$/, to: (m) => `${volPathDe(m[1]!)}: darf nicht negativ sein` },
  { re: /^(\S+): must be > 0 \(years\)$/, to: (m) => `${volPathDe(m[1]!)}: muss > 0 sein (Jahre)` },
  {
    re: /^(\S+): not strictly increasing at index (\d+) \((.+)\)$/,
    to: (m) => `${volPathDe(m[1]!)}: nicht streng steigend an Position ${Number(m[2]) + 1} (${m[3]})`,
  },
  {
    re: /^(\S+)\.volType: unknown vol type (.+)$/,
    to: (m) => `${volPathDe(m[1]!)}: ${volTypeDe(m[2]!)} (erwartet Normal, Lognormal oder ShiftedLognormal)`,
  },
  { re: /^(\S+)\.shift: must be a finite number ≥ 0$/, to: (m) => `${volPathDe(m[1]!)}: Shift muss eine endliche Zahl ≥ 0 sein` },
  { re: /^(\S+)\.shift: ShiftedLognormal needs a shift > 0$/, to: (m) => `${volPathDe(m[1]!)}: ShiftedLognormal benötigt einen Shift > 0` },
  { re: /^(\S+): must be an object$/, to: (m) => `${volPathDe(m[1]!)}: muss ein Objekt sein` },
  {
    re: /^(\S+): key must equal the surface's currency \((.+?)\).*$/,
    to: (m) => `${volPathDe(m[1]!)}: Schlüssel muss der Währung der Fläche entsprechen (${m[2]})`,
  },
  {
    re: /^(\S+): key must equal the surface's pair \((.+?)\).*$/,
    to: (m) => `${volPathDe(m[1]!)}: Schlüssel muss dem Währungspaar der Fläche entsprechen (${m[2]})`,
  },
  {
    re: /^(\S+): key must be "(.+?)" \(currency-index\) or "(.+?)".*$/,
    to: (m) => `${volPathDe(m[1]!)}: Schlüssel muss „${m[2]}“ (Währung-Index) oder „${m[3]}“ lauten`,
  },
  { re: /^(\S+): currency and index must be strings$/, to: (m) => `${volPathDe(m[1]!)}: Währung und Index müssen Texte sein` },
  { re: /^(\S+): rr10 and bf10 must be given together$/, to: (m) => `${volPathDe(m[1]!)}: 10Δ Risk Reversal und Butterfly nur gemeinsam` },
  {
    re: /^(\S+)\.sabr: must be an object keyed "<expiry>x<tenor>"$/,
    to: (m) => `${volPathDe(m[1]!)}: SABR-Parameter müssen je „<Verfall>x<Tenor>“ hinterlegt sein`,
  },
  {
    re: /^(\S+)\.sabr\.(\S+): key must be "<expiry>x<tenor>" in years$/,
    to: (m) => `${volPathDe(m[1]!)}: SABR-Schlüssel „${m[2]}“ muss „<Verfall>x<Tenor>“ in Jahren sein`,
  },
  { re: /^(\S+)\.sabr\.(\S+)\.(\w+): must be a finite number$/, to: (m) => `${volPathDe(m[1]!)}: SABR ${m[2]} – ${m[3]} muss eine endliche Zahl sein` },
  // any other core vol-surface problem line ("swaptionVols.USD.atm has 1 rows, expected 11 (one per expiry)")
  { re: /^(swaptionVols|capletVols|fxVols)\b.*$/, to: (m) => translateVolProblem(m[0]) },
  // Core R6 (N6-5): knock state of a barrier option not recorded on the trade – derived from spot / expiry fixing
  {
    re: /^BARRIER_STATE_UNKNOWN: spot (\S+) is (at or above|at or below) the (\w+) barrier (\S+) – valued as (knocked out \((?:rebate|PV 0)\)|knocked in \(vanilla\)) on today's spot(.*)$/,
    to: (m) =>
      `Barriere-Status unbekannt: Spot ${numDe(m[1]!)} liegt ${m[2] === "at or above" ? "auf oder über" : "auf oder unter"} der ${barrierDe(m[3]!)}-Barriere ${numDe(m[4]!)} – ${
        m[5]!.startsWith("knocked out") ? `als ausgeknockt bewertet (${/rebate/.test(m[5]!) ? "Rebate" : "Barwert 0"})` : "als eingeknockt (Vanilla) bewertet"
      } auf Basis des heutigen Spots${/hit is false/.test(m[6] ?? "") ? " – obwohl „Barriere bereits berührt“ nicht gesetzt ist (kontinuierliche Barriere: ein Spot jenseits des Levels gilt als Berührung)" : "; „Barriere bereits berührt“ im Trade setzen, um den Status festzuhalten"}`,
  },
  {
    re: /^BARRIER_STATE_UNKNOWN: knock state of the (\w+) barrier (\S+) derived from the expiry fixing (\S+) only \((.+?)\) – touch events before the expiry are not observed.*$/,
    to: (m) =>
      `Barriere-Status unbekannt: Knock-Status der ${barrierDe(m[1]!)}-Barriere ${numDe(m[2]!)} nur aus dem Verfallsfixing ${numDe(m[3]!)} abgeleitet (${barrierStateDe(m[4]!)}) – Berührungen vor dem Verfall werden nicht beobachtet; „Barriere bereits berührt“ im Trade setzen, um den Status festzuhalten`,
  },
  { re: /^BARRIER_STATE_UNKNOWN: (.+)$/, to: (m) => `Barriere-Status unbekannt – ${germanizeText(m[1]!)}; „Barriere bereits berührt“ im Trade setzen` },
  // Core R6 (Markt R6-4): vol surface structurally fine but implausible (quotation type vs. numbers, degenerate grid)
  {
    re: /^VOL_IMPLAUSIBLE: (.+?) is degenerate – every vol is 0 \(options are valued at intrinsic value only\)$/,
    to: (m) => `Vol-Fläche unplausibel: ${volSurfaceDe(m[1]!)} ist degeneriert – alle Vols sind 0 (Optionen werden nur zum inneren Wert bewertet)`,
  },
  {
    re: /^VOL_IMPLAUSIBLE: (.+?): median normal vol (.+?) is above (.+?) – the numbers look like lognormal vols; check the volType of the import$/,
    to: (m) =>
      `Vol-Fläche unplausibel: ${volSurfaceDe(m[1]!)} – Median der Normal-Vols ${numDe(m[2]!)} liegt über ${numDe(m[3]!)}; die Zahlen sehen wie Lognormal-Vols aus – volType des Imports prüfen`,
  },
  {
    re: /^VOL_IMPLAUSIBLE: (.+?): median lognormal vol (.+?) is below (.+?) – the numbers look like normal \(bp\) vols; check the volType of the import$/,
    to: (m) =>
      `Vol-Fläche unplausibel: ${volSurfaceDe(m[1]!)} – Median der Lognormal-Vols ${numDe(m[2]!)} liegt unter ${numDe(m[3]!)}; die Zahlen sehen wie Normal-Vols (bp) aus – volType des Imports prüfen`,
  },
  {
    re: /^VOL_IMPLAUSIBLE: (.+?) has (\d+) of (\d+) (normal|lognormal) vols above (.+?) \(max (.+?)\) – check the volType \/ quotation of the import$/,
    to: (m) =>
      `Vol-Fläche unplausibel: ${volSurfaceDe(m[1]!)} – ${m[2]} von ${m[3]} ${quotationDe(m[4]!)}-Vols über ${numDe(m[5]!)} (max ${numDe(m[6]!)}); volType/Quotierung des Imports prüfen`,
  },
  {
    re: /^VOL_IMPLAUSIBLE: (.+?) has (\d+) of (\d+) (normal|lognormal) vols below (.+?) \(min (.+?)\) – (.+)$/,
    to: (m) =>
      `Vol-Fläche unplausibel: ${volSurfaceDe(m[1]!)} – ${m[2]} von ${m[3]} ${quotationDe(m[4]!)}-Vols unter ${numDe(m[5]!)} (min ${numDe(m[6]!)}); ${volHintDe(m[7]!)}`,
  },
  { re: /^VOL_IMPLAUSIBLE: (.+)$/, to: (m) => `Vol-Fläche unplausibel – ${germanizeText(m[1]!)}` },
  // Core R4-1: historical FX fixing for an MtM reset missing
  {
    re: /^MISSING_FX_FIXING: Missing FX fixing for ([A-Z]{6}) on (\d{4}-\d{2}-\d{2}); MtM reset of leg (\d+) valued with today's rate as proxy.*$/,
    to: (m) =>
      `FX-Fixing ${pairDe(m[1]!)} vom ${isoToDe(m[2]!)} fehlt – MtM-Reset von Leg ${Number(m[3]) + 1} mit dem heutigen Kurs genähert (FX-Fixings im Markt hinterlegen)`,
  },
  {
    re: /^MISSING_FX_FIXING: Missing FX fixing for ([A-Z]{6}) on (\d{4}-\d{2}-\d{2}); (.+)$/,
    to: (m) => `FX-Fixing ${pairDe(m[1]!)} vom ${isoToDe(m[2]!)} fehlt – ${m[3]}`,
  },
  { re: /^MISSING_FX_FIXING: (.+)$/, to: (m) => `FX-Fixing fehlt (${m[1]})` },
  // Core R4-2: FX leg delivering on the valuation date (value-today exchange)
  {
    re: /^SETTLES_TODAY: (.+?) settles on the valuation date (\d{4}-\d{2}-\d{2}) – valued as a value-today exchange at the today rate \(not discounted\)$/,
    to: (m) =>
      `${legLabelDe(m[1]!)} wird am Bewertungstag (${isoToDe(m[2]!)}) geliefert – als Value-Today-Geschäft zum Heute-Kurs bewertet (nicht diskontiert)`,
  },
  { re: /^SETTLES_TODAY: (.+)$/, to: (m) => `Lieferung am Bewertungstag – Value-Today-Geschäft zum Heute-Kurs (${m[1]})` },
  {
    re: /^(.+?) already delivered \((\d{4}-\d{2}-\d{2})\) – excluded from the PV$/,
    to: (m) => `${legLabelDe(m[1]!)} bereits geliefert (${isoToDe(m[2]!)}) – nicht im Barwert enthalten`,
  },
  // Markt R4-1: CSA without a collateral curve for one of the currencies
  {
    re: /^COLLATERAL_CURVE_MISSING: no ([A-Z]{3}) discount curve for collateral in ([A-Z]{3}) \(collateralDiscountCurveId "([^"]+)"\); (?:discounted on (\S+)|no discount curve) – cross-currency basis not priced$/,
    to: (m) =>
      `Keine ${m[1]}-Diskontkurve für Besicherung in ${m[2]} (Collateral-Kurve „${m[3]}“ fehlt) – ${m[4] ? `Diskontierung auf ${m[4]}` : "keine Diskontkurve"}, Cross-Currency-Basis nicht gepreist`,
  },
  { re: /^COLLATERAL_CURVE_MISSING: (.+)$/, to: (m) => `Collateral-Kurve fehlt – Diskontierung auf der eigenen OIS-Kurve (${m[1]})` },
  // Validator messages of the core ("Invalid trade X: trade.legs[0]: terminationDate must be after effectiveDate; …", R4-05)
  {
    re: /^Invalid trade (\S+): (.+)$/,
    to: (m) => `Trade ${m[1]!.replace(/:$/, "")}: ${translateTradeIssues(m[2]!)}`,
  },
  // Vol quotation conversion (core R3-1): "VOL_TYPE_CONVERTED: caplet surface X quotes normal vols but model Black was requested – vols converted to lognormal …"
  {
    re: /^VOL_TYPE_CONVERTED: (\w+) surface (\S+) quotes (normal|lognormal(?:, shift [\d.]+%)?) vols but model (\w+) was requested – vols converted to (normal|lognormal(?:, shift [\d.]+%)?) .*$/,
    to: (m) =>
      `Volatilität der ${m[1] === "caplet" ? "Caplet" : m[1] === "swaption" ? "Swaption" : m[1]}-Fläche ${m[2]} von ${quotationDe(m[3]!)}- in ${quotationDe(m[5]!)}-Quotierung umgerechnet (Modell ${m[4]}, preisäquivalent je Forward/Strike/Verfall)`,
  },
  { re: /^VOL_TYPE_CONVERTED: (.+)$/, to: (m) => `Volatilität zwischen Normal- und Lognormal-Quotierung umgerechnet (${m[1]})` },
  {
    re: /^A (shifted )?lognormal model cannot be fed from the (.+?) surface: shifted forward ([-\d.]+%) \/ strike ([-\d.]+%) is not positive.*$/,
    to: (m) =>
      `${m[1] ? "Shifted-" : ""}Lognormal-Modell nicht mit der ${quotationDe(m[2]!)}-Fläche vereinbar: verschobener Forward ${m[3]!.replace(".", ",")} / Strike ${m[4]!.replace(".", ",")} nicht positiv – Bachelier oder größeren Shift verwenden`,
  },
  {
    re: /^Schedule with frequency (\S+) would have (\d+) periods \(limit (\d+)\).*$/,
    to: (m) => `Zahlungsplan mit Frequenz ${m[1]} hätte ${m[2]} Perioden (Grenze ${m[3]}) – Laufzeit verkürzen oder längere Kuponfrequenz wählen`,
  },
  { re: /^Invalid frequency: (\S+) \(expected a tenor like .*\)$/, to: (m) => `Ungültige Frequenz: ${m[1]} (erwartet ein Tenor wie 3M, 6M, 1Y oder ZC)` },
  { re: /^Invalid frequency: (\S+) \(tenor must be positive\)$/, to: (m) => `Ungültige Frequenz: ${m[1]} (Tenor muss positiv sein)` },
  { re: /^bootstrapHazardCurve: at least one CDS quote is required$/, to: () => "CDS-Termstruktur: mindestens eine Quote erforderlich" },
  {
    re: /^bootstrapHazardCurve: recovery ([\d.]+) must be in \[0, 1\)$/,
    to: (m) => `CDS-Termstruktur: Recovery ${m[1]!.replace(".", ",")} muss in [0, 1) liegen`,
  },
  {
    re: /^bootstrapHazardCurve: CDS spread of (\S+) must be a finite, non-negative number$/,
    to: (m) => `CDS-Termstruktur: Spread ${m[1]} muss eine endliche, nicht negative Zahl sein`,
  },
  {
    re: /^bootstrapHazardCurve: pillar (\S+) \(t = ([\d.]+)y\) implies a hazard rate of ([-\d.]+)bp: the survival probability would increase.*$/,
    to: (m) =>
      `CDS-Termstruktur: Pillar ${m[1]} (t = ${m[2]!.replace(".", ",")} J) impliziert eine Hazard-Rate von ${m[3]!.replace(".", ",")} bp – Überlebenswahrscheinlichkeit würde steigen (inverse CDS-Quotes)`,
  },
  {
    re: /^HAZARD_FLOORED: pillar (\S+) \(t = ([\d.]+)y\) implies a hazard rate of ([-\d.]+)bp.*floored at 0, the (\S+) quote does not reprice$/,
    to: (m) =>
      `Hazard-Rate am Pillar ${m[1]} (t = ${m[2]!.replace(".", ",")} J) wäre ${m[3]!.replace(".", ",")} bp (inverse CDS-Quotes) – auf 0 begrenzt, die ${m[4]}-Quote wird nicht exakt reproduziert`,
  },
  { re: /^HAZARD_FLOORED: (.+)$/, to: (m) => `Hazard-Rate auf 0 begrenzt (${m[1]})` },
  {
    re: /^(\S+) (".*"|\S+) is not an ISO-8601 date-time – EMIR field 23 needs YYYY-MM-DDThh:mm:ssZ$/,
    to: (m) => `${m[1]} ${m[2]} ist kein ISO-8601-Zeitstempel – EMIR-Feld 23 erwartet JJJJ-MM-TTThh:mm:ssZ`,
  },
  {
    re: /^Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); used curve forward$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – Kurven-Forward verwendet`,
  },
  { re: /^Missing fixing (\S+) (\d{4}-\d{2}-\d{2})$/, to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt` },
  {
    re: /^No swaption vol surface – (\d+)bp normal vol assumed for exposure$/,
    to: (m) => `Keine Swaption-Vol-Fläche – ${m[1]} bp Normal-Vol für das Exposure angenommen`,
  },
  { re: /^No swaption vol surface – using (\d+)bp normal vol$/, to: (m) => `Keine Swaption-Vol-Fläche – ${m[1]} bp Normal-Vol verwendet` },
  { re: /^No caplet vol surface – using (\d+)bp normal vol$/, to: (m) => `Keine Caplet-Vol-Fläche – ${m[1]} bp Normal-Vol verwendet` },
  {
    re: /^No caplet vol surface for (\S+) – embedded cap\/floor valued intrinsically$/,
    to: (m) => `Keine Caplet-Vol-Fläche für ${m[1]} – eingebetteter Cap/Floor intrinsisch bewertet`,
  },
  { re: /^No FX vol surface – (\d+)% vol assumed$/, to: (m) => `Keine FX-Vol-Fläche – ${m[1]} % Vol angenommen` },
  { re: /^No FX vol surface – using (\d+)% vol$/, to: (m) => `Keine FX-Vol-Fläche – ${m[1]} % Vol verwendet` },
  { re: /^No (\S+) vol surface(.*)$/, to: (m) => `Keine ${m[1]}-Vol-Fläche${m[2]}` },
  { re: /^Swaption expired – intrinsic value shown$/, to: () => "Swaption verfallen – innerer Wert ausgewiesen" },
  { re: /^XVA not implemented for (\w+).*$/, to: (m) => `XVA für ${TRADE_TYPE_DE[m[1]!] ?? m[1]} nicht verfügbar (v1: Zinsswaps und FX-Forwards)` },
  { re: /^terminationDate must be after effectiveDate$/, to: () => "Enddatum muss nach dem Startdatum liegen" },
  { re: /^effectiveDate must be before terminationDate$/, to: () => "Startdatum muss vor dem Enddatum liegen" },
  { re: /^notional must be positive$/, to: () => "Nominal muss positiv sein" },
  { re: /^must be positive$/, to: () => "muss positiv sein" },
  { re: /^must be a finite number$/, to: () => "muss eine endliche Zahl sein" },
  { re: /^expiryDate must be on or before deliveryDate$/, to: () => "Verfall muss vor oder am Lieferdatum liegen" },
  { re: /^Schedule with stub=None does not divide evenly.*$/, to: () => "Laufzeit ist ohne Stub nicht durch die Frequenz teilbar" },
  // Missing market data name the in-app repair path (R7-F1 / R7-F2): "+ Kurve" in the curves view, "+ Paar" in the FX-spot table.
  // (The two curve messages are context-aware – see `curveRepairMessage` / R8-06 – and handled before this table.)
  { re: /^Curve not found in market context: (.+)$/, to: (m) => `Kurve ${m[1]} nicht im Markt-Snapshot – in der Kurvenansicht mit „+ Kurve“ anlegen` },
  {
    re: /^No discount curve configured for (\w+)$/,
    to: (m) => `Keine Diskontkurve für ${m[1]} konfiguriert – in der Kurvenansicht mit „+ Kurve“ eine ${m[1]}-Kurve anlegen`,
  },
  // Register (Markt R8-1): the core's registration errors name the entry – the entry label is added by the caller.
  {
    re: /^register(?:RateIndex|SwapConventions)\(([^)]*)\): (.+)$/,
    to: (m) => `${m[1]}: ${translateRegisterDetail(m[2]!)}`,
  },
  {
    re: /^FX spot not available for (\w+)$/,
    to: (m) => `Kein FX-Spot für ${m[1]} verfügbar – in der Marktansicht unter FX-Spots mit „+ Paar“ ergänzen`,
  },
  { re: /^Invalid FX pair: (.+)$/, to: (m) => `Ungültiges Währungspaar: ${m[1]}` },
  { re: /^Invalid tenor: (.+)$/, to: (m) => `Ungültiger Tenor: ${m[1]}` },
  { re: /^Invalid frequency: (.+)$/, to: (m) => `Ungültige Frequenz: ${m[1]}` },
  { re: /^Invalid (?:ISO )?date: (.+)$/, to: (m) => `Ungültiges Datum: ${m[1]}` },
  { re: /^Unknown rate index: (.+)$/, to: (m) => `Unbekannter Zinsindex: ${m[1]}` },
  // core R8 (Markt R8-1): a floating leg / FRA / cap must be denominated in its index's currency
  {
    re: /^(.*?):? ?currency (\w+) does not match the currency (\w+) of index (\S+) – .*$/,
    to: (m) =>
      `${m[1] ? `${m[1].replace(/^Invalid trade[^:]*:\s*/, "")}: ` : ""}Währung ${m[2]} passt nicht zur Währung ${m[3]} des Index ${m[4]} – ein ${m[2]}-Float-Leg braucht einen ${m[2]}-Index (in der Kurvenansicht mit „+ Währung“ registrieren)`,
  },
  { re: /^Unknown calendar: (.+)$/, to: (m) => `Unbekannter Kalender: ${m[1]}` },
  { re: /^Unknown day count convention: (.+)$/, to: (m) => `Unbekannte Tageszählung: ${m[1]}` },
  { re: /^Swaption underlying must have a fixed leg$/, to: () => "Swaption-Underlying benötigt ein Festzins-Leg" },
  { re: /^Cannot derive forward swap rate$/, to: () => "Forward-Swapsatz nicht ableitbar" },
  { re: /^Curve needs at least one node$/, to: () => "Kurve benötigt mindestens einen Stützpunkt" },
  { re: /^CVA \(swaption approach\) needs a fixed\/float swap$/, to: () => "CVA (Swaption-Replikation) benötigt einen Fest/Variabel-Swap" },
  { re: /^PV not finite$/, to: () => "Barwert nicht berechenbar" },
  { re: /^brent: .*$/, to: () => "Numerische Lösung nicht konvergiert" },
  { re: /^solveBracketed: .*$/, to: () => "Numerische Lösung: Nullstelle nicht eingrenzbar" },
  { re: /^Unsupported trade type: (.+)$/, to: (m) => `Nicht unterstützter Trade-Typ: ${m[1]}` },
  // XVA / exposure method strings (long and short forms, N-07)
  { re: /^Delta-normal \(expired\)$/, to: () => "Delta-Normal (verfallen)" },
  { re: /^Delta-normal exposure\s*\((.*)\)$/, to: (m) => `Delta-Normal-Exposure (${translateFragment(m[1]!)})` },
  { re: /^Delta-normal exposure.*$/, to: () => "Delta-Normal-Exposure (gerollte Sensitivitäten, ATM-Vols)" },
  { re: /^Swaption-replication \(Sorensen–Bollier\), flat hazard$/, to: () => "Swaption-Replikation (Sorensen–Bollier), konstante Hazard-Rate" },
  {
    re: /^Swaption-replication \(Sorensen–Bollier\),\s*(.*),\s*flat hazard$/,
    to: (m) => `Swaption-Replikation (Sorensen–Bollier), ${translateFragment(m[1]!)}, konstante Hazard-Rate`,
  },
  { re: /^Swaption-replication.*flat hazard$/, to: () => "Swaption-Replikation (Sorensen–Bollier), konstante Hazard-Rate" },
];

/** German labels of the curve interpolation methods – single source for curves view, report and documents (R3-06). */
export const INTERPOLATION_DE: Record<string, string> = {
  logLinear: "log-linear (DF)",
  linearZero: "linear (Zero)",
  cubicSplineZero: "kubischer Spline (Zero)",
  flatForward: "flat forward",
  monotoneConvex: "monoton-konvex (Hagan–West)",
};

/** Business-day conventions and stub types as they appear in methodology prose. */
const CONVENTION_DE: Record<string, string> = {
  ModifiedFollowing: "Modified Following",
  ModifiedPreceding: "Modified Preceding",
  ShortFront: "kurzer Stub vorne",
  LongFront: "langer Stub vorne",
  ShortBack: "kurzer Stub hinten",
  LongBack: "langer Stub hinten",
};

/** Short English fragments inside method strings (also applied to document paragraphs, N-07). */
const FRAGMENTS: [RegExp, string][] = [
  [/Swaption-replication/g, "Swaption-Replikation"],
  [/Delta-normal exposure/g, "Delta-Normal-Exposure"],
  [/smile vol at strike/gi, "Smile-Vol am Strike"],
  [/ATM vol(s)?/gi, "ATM-Vols"],
  [/rolled sensitivities/gi, "gerollte Sensitivitäten"],
  [/remaining tenor/gi, "Restlaufzeit"],
  [/flat hazard/gi, "konstante Hazard-Rate"],
  [/\bat \(t, /g, "bei (t, "],
];
/**
 * Code identifiers that leak from analytics / cost-transparency objects into
 * methodology prose ("Barwert (fairValue)", "marginBp/marginPct", "analytics.deltaAmount") – R3-06.
 */
const IDENTIFIERS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\bmarginBp\s*\/\s*marginPct\b/g, "Marge in bp / % des Nominals"],
  [/\bmarginBp\b/g, "Marge in bp"],
  [/\bmarginPct\b/g, "Marge in %"],
  [/\banalytics\.deltaAmount\b/g, "Delta-Betrag (Analytics)"],
  [/\bdeltaAmount\b/g, "Delta-Betrag"],
  [/\bdeltaPct\b/g, "Delta-Quote"],
  [/\(fairValue\)/g, "(Fair Value)"],
  [/\bfairValue\b/g, "Fair Value"],
  [/\bMISSING_FIXING\b/g, "„Fixing fehlt“"],
  [/\bPolicy „/g, "Regel „"],
  [/\bFloat ([A-Z€][A-Z0-9€-]*)/g, "variabel $1"],
  [/\bFix (\d)/g, "fest $1"],
  [/\bStub (ShortFront|LongFront|ShortBack|LongBack)\b/g, (_m: string, s: string) => `Stub: ${CONVENTION_DE[s]}`],
];
function translateFragment(s: string): string {
  let out = s;
  for (const [re, to] of FRAGMENTS) out = out.replace(re, to);
  return out;
}
function translateIdentifiers(s: string): string {
  let out = s;
  for (const [re, to] of IDENTIFIERS) out = typeof to === "string" ? out.replace(re, to) : out.replace(re, to);
  for (const [k, v] of Object.entries(INTERPOLATION_DE)) out = out.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  for (const [k, v] of Object.entries(CONVENTION_DE)) out = out.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  // Defensive fallback: any remaining camelCase identifier is rendered as spaced words ("spotDate" → "Spot Date").
  out = out.replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, (id) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()));
  return out;
}

/** Free text from the core (document paragraphs): English method fragments → German, code identifiers → labels, ISO dates → dd.mm.yyyy. */
export function germanizeParagraph(s: string): string {
  return germanizeText(translateIdentifiers(translateFragment(s)));
}

function isoToDe(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** "swaptionVols.USD.atm[3]" → "Swaption-Cube USD, atm[3]" (paths of the vol-surface validator). */
function volPathDe(path: string): string {
  const m = /^(swaptionVols|capletVols|fxVols)\.([^.[]+)(?:[.[](.*))?$/.exec(path);
  if (!m) return path;
  const kind = m[1] === "swaptionVols" ? "Swaption-Cube" : m[1] === "capletVols" ? "Caplet-Fläche" : "FX-Vol-Fläche";
  const rest = m[3] ? `, ${/^\d/.test(m[3]) ? "[" : ""}${m[3]}` : "";
  return `${kind} ${m[2]}${rest}`;
}

/** "Vol-Typ X unbekannt" – a missing `volType` (`undefined`, `null`, empty) reads "Vol-Typ fehlt", never a raw `undefined` (R6-05). */
function volTypeDe(got: string): string {
  const g = got.trim().replace(/^"(.*)"$/, "$1");
  return g === "undefined" || g === "null" || g === "" ? "Vol-Typ fehlt" : `Vol-Typ ${got.trim()} unbekannt`;
}

const AXIS_DE: Record<string, string> = { expiry: "Verfall", tenor: "Tenor", strike: "Strike", expiries: "Verfälle", tenors: "Tenore", strikes: "Strikes" };
const axisDe = (a: string) => AXIS_DE[a] ?? a;

/**
 * One problem line of the core's `validateVolSurfaces` ("swaptionVols.USD.atm has
 * 1 rows, expected 11 (one per expiry)") → German. Unknown phrasings keep their
 * text behind the translated path.
 */
function translateVolProblem(p: string): string {
  const s = p.trim();
  let m = /^(\S+) has (\d+) rows, expected (\d+) \(one per (\w+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: ${m[2]} Zeilen, erwartet ${m[3]} (eine je ${axisDe(m[4]!)})`;
  m = /^(\S+) has (\d+) entries, expected (\d+) \(one per (\w+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: ${m[2]} Einträge, erwartet ${m[3]} (einer je ${axisDe(m[4]!)})`;
  m = /^(\S+) must be a (\d+)×(\d+) array \((\w+) × (\w+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: muss eine ${m[2]}×${m[3]}-Matrix sein (${axisDe(m[4]!)} × ${axisDe(m[5]!)})`;
  m = /^(\S+) must be an array of (\d+) vols$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: muss eine Liste aus ${m[2]} Vols sein`;
  m = /^(\S+) must be an array of vols \(one per expiry\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: muss eine Liste aus Vols sein (eine je Verfall)`;
  m = /^(\S+) must be a non-empty array of numbers$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: muss eine nicht leere Zahlenliste sein`;
  m = /^(\S+) must be an expiries × (tenors|strikes) array$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: muss eine Matrix Verfälle × ${axisDe(m[2]!)} sein`;
  m = /^(\S+) must be (?:a|an) (swaption|caplet|FX) vol surface object$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: muss ein ${m[2] === "swaption" ? "Swaption-Cube" : m[2] === "caplet" ? "Caplet-Flächen" : "FX-Vol-Flächen"}-Objekt sein`;
  m = /^(\S+)\.(currency|pair) "(.+?)" does not match the key "(.+?)"$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: ${m[2] === "pair" ? "Währungspaar" : "Währung"} „${m[3]}“ passt nicht zum Schlüssel „${m[4]}“`;
  m = /^(\S+)\.pair "(.+?)" must be a 6-letter currency pair$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: Währungspaar „${m[2]}“ muss aus 6 Buchstaben bestehen`;
  m = /^(\S+)\.(id|currency|index|pair) missing$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: Feld „${m[2]}“ fehlt`;
  m = /^(\S+)\.volType must be one of (.+?) \(got (.+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: ${volTypeDe(m[3]!)} (erlaubt ${m[2]})`;
  m = /^(\S+)\.shift must be a finite, non-negative number \(got (.+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: Shift ${m[2]} muss eine endliche Zahl ≥ 0 sein`;
  m = /^(\S+)\.(atmConvention|deltaConvention|smileInterpolation|strangleType) must be (.+?) \(got (.+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: ${m[2]} ${m[4]} ungültig (erwartet ${m[3]})`;
  m = /^(\S+)\[(\d+)\] \((.+?)\) must be greater than \S+\[(\d+)\] \((.+?)\) – axis strictly increasing, no duplicates$/.exec(s);
  if (m)
    return `${volPathDe(m[1]!)}: Achse nicht streng steigend – Position ${Number(m[2]) + 1} (${m[3]}) muss größer als Position ${Number(m[4]) + 1} (${m[5]}) sein`;
  m = /^(\S+)\[(\d+)\] must be a finite(, positive)? number \(got (.+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}[${m[2]}]: muss eine endliche${m[3] ? ", positive" : ""} Zahl sein (${m[4]})`;
  m = /^(\S+)\[(\d+)\] must be non-negative \(got (.+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}[${m[2]}]: darf nicht negativ sein (${m[3]})`;
  m = /^(\S+)\[(\d+)\]\[(\d+)\] must be a finite, non-negative vol \(got (.+)\)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}[${m[2]}][${m[3]}]: Vol muss endlich und ≥ 0 sein (${m[4]})`;
  m = /^(\S+)\[(\d+)\] must be an array of (\d+) vols$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}[${m[2]}]: muss eine Liste aus ${m[3]} Vols sein`;
  m = /^(\S+)\.sabr (.+)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: SABR – ${m[2]}`;
  m = /^(\S+)\.sabr\["(.+?)"\](.*)$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: SABR ${m[2]}${m[3]}`;
  m = /^(\S+): rr10 and bf10 must be given together$/.exec(s);
  if (m) return `${volPathDe(m[1]!)}: 10Δ Risk Reversal und Butterfly nur gemeinsam`;
  m = /^(swaptionVols|capletVols|fxVols) must be an object keyed by (.+)$/.exec(s);
  if (m)
    return `${volPathDe(`${m[1]}.*`).replace(" *", "")}: muss ein Objekt je ${m[2] === "currency pair" ? "Währungspaar" : m[2] === "currency" ? "Währung" : "Währung[-Index]"} sein`;
  m = /^(\S+)[:.]?\s(.*)$/.exec(s);
  return m && /^(swaptionVols|capletVols|fxVols)\./.test(m[1]!) ? `${volPathDe(m[1]!.replace(/:$/, ""))}: ${m[2]}` : s;
}

/**
 * Surface reference of a `VOL_IMPLAUSIBLE:` warning: a market path ("swaptionVols.USD" → "Swaption-Cube USD",
 * `volSurfaceWarnings`) or a pricer label ("swaption surface EUR-SWAPTION-NORMAL" → "Swaption-Fläche EUR-SWAPTION-NORMAL").
 */
function volSurfaceDe(ref: string): string {
  const r = ref.trim();
  if (/^(swaptionVols|capletVols|fxVols)\./.test(r)) return volPathDe(r);
  const m = /^(swaption|caplet|FX vol) surface (\S+)$/i.exec(r);
  if (m) {
    const k = m[1]!.toLowerCase();
    return `${k === "swaption" ? "Swaption" : k === "caplet" ? "Caplet" : "FX-Vol"}-Fläche ${m[2]}`;
  }
  return r;
}
/** Trailing hint of the "vols below" warning. */
function volHintDe(hint: string): string {
  if (/^normal vols are decimals of the rate/.test(hint)) return "Normal-Vols sind Dezimalzahlen des Satzes (0,0070 = 70 bp)";
  if (/^lognormal vols are decimals/.test(hint))
    return "Lognormal-Vols sind Dezimalzahlen (0,20 = 20 %); Normal-Zahlen auf einer Lognormal-Fläche lassen Optionswerte zusammenfallen";
  return germanizeText(hint);
}
/** "UpOut" → "Up-and-Out" (barrier warnings). */
function barrierDe(type: string): string {
  return BARRIER_DE[type] ?? type;
}
/** Barrier state fragment of the core ("knocked out", "not touched", "knocked in") → German. */
function barrierStateDe(state: string): string {
  const st = state.trim().toLowerCase();
  if (/knocked[- ]out/.test(st)) return "ausgeknockt";
  if (/knocked[- ]in/.test(st)) return "eingeknockt";
  if (/not touched|alive|untouched/.test(st)) return "nicht berührt (Option lebt)";
  if (/touched|hit/.test(st)) return "berührt";
  return state;
}

/** Leg labels of the FX pricer ("FX forward", "near leg", "far leg") → German. */
function legLabelDe(label: string): string {
  const l = label.trim();
  if (/^near leg$/i.test(l)) return "Near-Leg";
  if (/^far leg$/i.test(l)) return "Far-Leg";
  if (/^fx forward$/i.test(l)) return "FX-Forward";
  return l.replace(/^leg (\d+)$/i, "Leg $1");
}

/**
 * Semicolon-separated validator issues of the core ("trade.legs[0]: terminationDate
 * must be after effectiveDate; trade.notional: must be positive") → "Leg 1: Enddatum …".
 */
export function translateTradeIssues(issues: string): string {
  return issues
    .split(/;\s*/)
    .filter(Boolean)
    .map((part) => {
      const m = /^(?:trade\.)?(?:legs\[(\d+)\](?:\.(\w+))?|(\w+)):\s*(.+)$/.exec(part.trim());
      if (!m) return translateCoreMessage(part.trim());
      const msg = translateCoreMessage(m[4]!);
      if (m[1] !== undefined) return `Leg ${Number(m[1]) + 1}: ${msg}`;
      return `${FIELD_DE[m[3]!] ?? m[3]}: ${msg}`;
    })
    .join("; ");
}
const FIELD_DE: Record<string, string> = {
  notional: "Nominal",
  strike: "Strike",
  expiryDate: "Verfall",
  deliveryDate: "Lieferdatum",
  effectiveDate: "Startdatum",
  terminationDate: "Enddatum",
  rate: "Satz",
  pair: "Währungspaar",
};

/** "normal" / "lognormal" / "lognormal, shift 3.00%" → German quotation label. */
function quotationDe(q: string): string {
  if (q.startsWith("normal")) return "Normal";
  const shift = /shift ([\d.]+%)/.exec(q);
  return shift ? `Lognormal (Shift ${shift[1]!.replace(".", ",")})` : "Lognormal";
}

/** German detail of a core register / validator problem ("unknown calendar "CZ" (register it with registerCalendar first)"). */
export function translateRegisterDetail(detail: string): string {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [
      /^(?:\w+: )?unknown calendar (".*?")( \(register it with registerCalendar first\))?$/,
      (m) => `unbekannter Kalender ${m[1]} – im Envelope unter „calendars“ mitliefern oder mit „+ Kalender“ anlegen`,
    ],
    [/^(?:\w+: )?unknown day count (.+)$/, (m) => `unbekannte Tageszählung ${m[1]}`],
    [/^definition must be an object$/, () => "Definition muss ein Objekt sein"],
    [/^conventions must be an object$/, () => "Konventionen müssen ein Objekt sein"],
    [/^\w+ must be an object \{ id, holidays\[\] \}$/, () => "Kalender muss ein Objekt { id, holidays[] } sein"],
    [/^\w+\.id must be a non-empty string without whitespace$/, () => "Kalender-ID fehlt oder enthält Leerzeichen"],
    [/^\w+\.id (".*?") is a built-in calendar.*$/, (m) => `Kalender ${m[1]} ist im Kern eingebaut und kann nicht ersetzt werden`],
    [/^\w+\.name must be a string$/, () => "„name“ muss ein Text sein"],
    [/^\w+\.holidays must be an array of ISO dates$/, () => "„holidays“ muss eine Liste von Daten JJJJ-MM-TT sein"],
    [/^\w+\.holidays\[(\d+)\] must be an ISO date \(YYYY-MM-DD\), got (.+)$/, (m) => `Feiertag Nr. ${Number(m[1]) + 1} (${m[2]}) ist kein Datum JJJJ-MM-TT`],
    [/^\w+\.holidays\[(\d+)\] (".*?") is not a valid calendar date$/, (m) => `Feiertag Nr. ${Number(m[1]) + 1} (${m[2]}) ist kein gültiges Datum`],
    [/^\w+\.weekendsAreHolidays must be a boolean$/, () => "„weekendsAreHolidays“ muss true oder false sein"],
    [/^unknown businessDayConvention (.+)$/, (m) => `unbekannte Business-Day-Convention ${m[1]}`],
    [/^endOfMonth must be a boolean$/, () => "„endOfMonth“ muss true oder false sein"],
    [/^type must be "IBOR" or "OIS"$/, () => "„type“ muss „IBOR“ oder „OIS“ sein"],
    [/^currency (\w+) does not match (\w+)$/, (m) => `Währung ${m[1]} passt nicht zu ${m[2]}`],
    [/^(\w+) (".*?") is not a registered index.*$/, (m) => `${m[1]} ${m[2]} ist kein registrierter Index – zuerst registrieren („indices“ / „+ Währung“)`],
    [/^(\w+) (\S+) belongs to (\w+), not (\w+)$/, (m) => `${m[1]} ${m[2]} gehört zu ${m[3]}, nicht zu ${m[4]}`],
    [/^(\w+) (\S+) must be an OIS index$/, (m) => `${m[1]} ${m[2]} muss ein OIS-Index sein`],
    [
      /^(\S+) is a built-in index and cannot be replaced.*$/,
      (m) => `${m[1]} ist im Kern eingebaut und kann nicht ersetzt werden – Variante unter neuem Namen registrieren`,
    ],
    [/^currency must be a 3-letter code$/, () => "Währung muss ein 3-Buchstaben-Code sein"],
    [/^name must be a non-empty string without whitespace$/, () => "Name fehlt oder enthält Leerzeichen"],
    [/^(\w+) must match .* \(got (.+)\)$/, (m) => `${m[1]} ${m[2]} ist keine gültige Frequenz (z. B. 1Y, 6M, ZC)`],
    [/^IBOR tenor must be like "3M" \(got (.+)\)$/, (m) => `IBOR-Tenor ${m[1]} ungültig (z. B. 3M)`],
    [/^overnight indices use tenor "1D"$/, () => "Overnight-Indizes haben den Tenor „1D“"],
    [/^fixingLag must be a non-negative integer$/, () => "Fixing-Lag muss eine ganze Zahl ≥ 0 sein"],
    [/^spotLag and oisPaymentLag must be non-negative integers$/, () => "Spot-Lag und OIS-Zahlungs-Lag müssen ganze Zahlen ≥ 0 sein"],
    [/^curveId missing$/, () => "Kurven-ID fehlt"],
  ];
  for (const [re, to] of rules) {
    const m = detail.match(re);
    if (m) return to(m);
  }
  return detail;
}

/**
 * Context for message translation (R8-06): the repair hint of a missing curve
 * depends on where the market comes from – "+ Kurve" is locked while an imported
 * snapshot is the base market, so the hint names the snapshot instead; a
 * swaption additionally offers the "Underlying-Index" field of its editor.
 */
export interface MessageContext {
  marketSource?: "sample" | "import";
  tradeType?: string;
}

/** Context-aware German text for the two "curve missing" core messages, `undefined` for every other message. */
function curveRepairMessage(s: string, ctx: MessageContext | undefined): string | undefined {
  const curve = /^Curve not found in market context: (.+)$/.exec(s);
  const disc = /^No discount curve configured for (\w+)$/.exec(s);
  if (!curve && !disc) return undefined;
  const ccy = disc ? disc[1]! : /^[A-Z]{3}/.exec(curve![1]!)?.[0];
  const head = curve ? `Kurve ${curve[1]} nicht im Markt-Snapshot` : `Keine Diskontkurve für ${ccy} konfiguriert`;
  if (ctx?.marketSource === "import")
    return `${head} – der importierte Snapshot enthält keine ${ccy ? `${ccy}-` : ""}Kurve – Snapshot mit Kurve importieren oder „Zum Sample-Markt“ wechseln`;
  const swaption = ctx?.tradeType === "Swaption" ? " oder im Editor den Underlying-Index wechseln" : "";
  return curve
    ? `${head} – in der Kurvenansicht mit „+ Kurve“ anlegen${swaption}`
    : `${head} – in der Kurvenansicht mit „+ Kurve“ eine ${ccy}-Kurve anlegen${swaption}`;
}

/** Translate a core (English) warning/error into German; unknown messages are passed through. */
export function translateCoreMessage(msg: string | undefined | null): string {
  return translateCoreMessageIn(msg, undefined);
}

/** `translateCoreMessage` with a context (market source, trade type) – the repair hints of missing curves follow it (R8-06). */
export function translateCoreMessageIn(msg: string | undefined | null, ctx: MessageContext | undefined): string {
  if (!msg) return "";
  const s = msg.trim();
  const repair = curveRepairMessage(s, ctx);
  if (repair) return repair;
  for (const r of CORE_MESSAGES) {
    const m = s.match(r.re);
    if (m) return r.to(m);
  }
  // Unknown structured message: drop the machine-readable code prefix.
  return s.replace(/^[A-Z][A-Z_]+:\s+/, "");
}

/** German headline per `PricingError.code` (the detail message is translated separately). */
export const PRICING_ERROR_CODES_DE: Record<string, string> = {
  INVALID_TRADE: "Ungültige Trade-Daten",
  NON_FINITE_PV: "Barwert nicht berechenbar",
  MISSING_RATE: "Marktsatz fehlt",
  MISSING_FIXING: "Fixing fehlt",
  NO_DISCOUNT_CURVE: "Keine Diskontkurve konfiguriert",
  CURVE_NOT_FOUND: "Kurve nicht im Markt-Snapshot",
  NO_FX_SPOT: "FX-Spot fehlt",
  UNKNOWN_INDEX: "Unbekannter Zinsindex",
  UNKNOWN_CALENDAR: "Unbekannter Kalender",
  UNSUPPORTED_TRADE_TYPE: "Nicht unterstützter Trade-Typ",
  // core round 3
  VOL_MODEL_INCOMPATIBLE: "Volatilitätsquotierung mit dem Modell unvereinbar",
  INVALID_FREQUENCY: "Ungültige Kuponfrequenz",
  UNKNOWN_DAYCOUNT: "Unbekannte Tageszählung",
  TOO_MANY_PERIODS: "Zu viele Zahlungsperioden",
  INVALID_CREDIT_CURVE: "Ungültige CDS-Termstruktur",
  INVALID_TIMESTAMP: "Ungültiger Zeitstempel",
  HAZARD_FLOORED: "Hazard-Rate auf 0 begrenzt",
  VOL_TYPE_CONVERTED: "Volatilitätsquotierung umgerechnet",
  // core round 4: parseISO / parseTenor throw typed errors
  INVALID_DATE: "Ungültiges Datum",
  INVALID_TENOR: "Ungültiger Tenor",
  MISSING_FX_FIXING: "FX-Fixing fehlt",
  COLLATERAL_CURVE_MISSING: "Collateral-Kurve fehlt",
  // core round 5
  INVALID_VOL_SURFACE: "Vol-Fläche strukturell ungültig",
  INVALID_CURVE_SPEC: "Kurvenspezifikation ungültig",
  NUMERICAL_FAILURE: "Numerische Lösung nicht konvergiert",
  EXPIRED: "Verfallen",
  // core round 6
  BARRIER_STATE_UNKNOWN: "Barriere-Status unbekannt",
  VOL_IMPLAUSIBLE: "Vol-Fläche unplausibel",
  UNKNOWN_CURRENCY: "Unbekannte Währung",
};

/** Warning prefixes of the core with their German headline (blotter / inspector badges, R6). */
export const WARNING_PREFIXES_DE: Record<string, string> = {
  MISSING_FIXING: "Fixing fehlt",
  MISSING_FX_FIXING: "FX-Fixing fehlt",
  SETTLES_TODAY: "Lieferung am Bewertungstag",
  COLLATERAL_CURVE_MISSING: "Collateral-Kurve fehlt",
  VOL_TYPE_CONVERTED: "Vol-Quotierung umgerechnet",
  NEGATIVE_RATE_LOGNORMAL: "Lognormal bei negativem Satz",
  HAZARD_FLOORED: "Hazard-Rate begrenzt",
  EXPIRED: "Verfallen",
  EXPIRES_TODAY: "Verfällt heute",
  BARRIER_STATE_UNKNOWN: "Barriere-Status unbekannt",
  VOL_IMPLAUSIBLE: "Vol-Fläche unplausibel",
};

/**
 * German text for any error thrown by the core: `PricingError`s get their
 * code headline plus the translated detail, plain errors are translated by
 * message. A detail that already starts with the headline ("Ungültiges Datum:
 * 2026-13-45" for `INVALID_DATE`) is not prefixed a second time (R5-06).
 */
export function translatePricingError(e: unknown, ctx?: MessageContext): string {
  if (isPricingError(e)) {
    const head = PRICING_ERROR_CODES_DE[e.code] ?? e.code;
    const detail = translateCoreMessageIn(e.message, ctx);
    if (!detail || detail === head) return head;
    if (detail.toLowerCase().startsWith(head.toLowerCase())) return detail;
    return `${head}: ${detail}`;
  }
  if (e instanceof Error) return translateCoreMessageIn(e.message, ctx);
  return translateCoreMessageIn(String(e), ctx);
}

/** German trade-type labels – single source is the core (`TRADE_TYPE_LABELS_DE`), re-exported as a string map for free-text lookups. */
export const TRADE_TYPE_DE: Record<string, string> = { ...TRADE_TYPE_LABELS_DE };

/** Leg type badges in cashflow tables ("Fixed" → "Fest"). */
export const LEG_TYPE_DE: Record<string, string> = {
  Fixed: "Fest",
  Float: "Variabel",
  "FX Buy": "Kauf",
  "FX Sell": "Verkauf",
  Premium: "Prämie",
  // core R6 (N6-1): the upfront premium / fee is its own last leg with one `Premium` cashflow
  "Upfront premium": "Upfront-Prämie",
  Option: "Option",
  Payoff: "Auszahlung",
  Near: "Near",
  Far: "Far",
  "Payer swaption": "Payer-Swaption",
  "Receiver swaption": "Receiver-Swaption",
  Cap: "Cap",
  Floor: "Floor",
  Collar: "Collar",
  Caplet: "Caplet",
  Floorlet: "Floorlet",
  FRA: "FRA",
};

const pairDe = (p: string) => (/^[A-Z]{6}$/.test(p) ? `${p.slice(0, 3)}/${p.slice(3)}` : p);

/**
 * German leg label including patterned core labels such as "Vanilla Put EURUSD",
 * "Digital Call EURUSD" or "Payer swaption" (N-07).
 */
export function legTypeLabel(legType: string | undefined | null): string {
  if (!legType) return "";
  const known = LEG_TYPE_DE[legType];
  if (known) return known;
  // "Float EURIBOR-6M" / "Float USD-SOFR" / "Fixed 3.10%" – leg badges of the cashflow table (R4-10)
  const fl = /^Float\s+(\S+)$/i.exec(legType);
  if (fl) return `Variabel ${fl[1]}`;
  const fx = /^Fixed\s+(.+)$/i.exec(legType);
  if (fx) return `Fest ${fx[1]!.replace(/(\d)\.(\d+)%/, "$1,$2 %")}`;
  const opt = /^(Vanilla|Digital|Barrier|Knock-?in|Knock-?out)?\s*(Put|Call)\s+([A-Z]{6})$/i.exec(legType);
  if (opt) {
    const style = (opt[1] ?? "").toLowerCase();
    const styleDe = style === "" || style === "vanilla" ? "" : style === "digital" ? "Digital-" : style === "barrier" ? "Barriere-" : `${opt[1]}-`;
    return `${styleDe}${opt[2]!.charAt(0).toUpperCase()}${opt[2]!.slice(1).toLowerCase()} ${pairDe(opt[3]!.toUpperCase())}`;
  }
  const sw = /^(Payer|Receiver)\s+swaption$/i.exec(legType);
  if (sw) return `${sw[1]}-Swaption`;
  return legType;
}

export const CASHFLOW_KIND_DE: Record<string, string> = {
  Interest: "Zins",
  Notional: "Nominal",
  Premium: "Prämie",
  OptionPayoff: "Optionsauszahlung",
  Settlement: "Ausgleich",
};

export const SETTLEMENT_DE: Record<string, string> = { Physical: "Physisch", Cash: "Barausgleich" };
export const CASH_CONVENTION_DE: Record<string, string> = {
  CollateralisedCashPrice: "Collateralised Cash Price (ICE Swap Rate, Standard)",
  IRR: "IRR (Yield-basiert, Altbestand)",
};
export const BARRIER_DE: Record<string, string> = { None: "Keine", UpOut: "Up-and-Out", UpIn: "Up-and-In", DownOut: "Down-and-Out", DownIn: "Down-and-In" };
export const OPTION_TYPE_DE: Record<string, string> = { Call: "Call (Kauf Basis)", Put: "Put (Verkauf Basis)" };
export const CAPFLOOR_DE: Record<string, string> = { Cap: "Cap", Floor: "Floor", Collar: "Collar" };
export const PAYER_RECEIVER_DE: Record<string, string> = { Payer: "Payer (Fest zahlen)", Receiver: "Receiver (Fest erhalten)" };
export const MODEL_DE: Record<string, string> = { Bachelier: "Bachelier (Normal)", Black: "Black (Lognormal)", ShiftedBlack: "Shifted Black" };
export const PERSPECTIVE_DE: Record<string, string> = { Bank: "Bank", Kunde: "Kunde" };
export const SNAPSHOT_STATUS_DE: Record<string, string> = { indicative: "indikativ", approved: "freigegeben" };

/** Generic label lookup with pass-through. */
export function t(map: Record<string, string>, key: string | undefined | null): string {
  if (key === undefined || key === null) return "";
  return map[key] ?? key;
}

/** Options for `<Select>` from a value → label map. */
export function optionsFrom<T extends string>(values: readonly T[], map: Record<string, string>): { v: T; l: string }[] {
  return values.map((v) => ({ v, l: map[v] ?? v }));
}

/* ---------- Number / date germanisation of core-generated strings ---------- */

/** "3.100" → "3,100"; "1.1725" → "1,1725" (the caller knows the token is a decimal, not a grouped integer). */
function deDecimal(num: string): string {
  return num.replace(/\.(\d+)$/, ",$1");
}
/** Every decimal point between digits → comma ("0.97 %" → "0,97 %", "1.25" → "1,25") – for core numbers inside warning texts. */
function numDe(s: string): string {
  return s.replace(/(\d)\.(\d)/g, "$1,$2");
}

/** ISO dates → dd.mm.yyyy and English trade-type identifiers → German inside free text (hedge summaries, N-07). */
export function germanizeText(s: string): string {
  let out = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y: string, mo: string, d: string) => `${d}.${mo}.${y}`);
  for (const [k, v] of Object.entries(TRADE_TYPE_DE)) out = out.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  return out;
}

/**
 * Core builder names are English with decimal points ("Sell EURUSD 2.000.000 @ 1.1725",
 * "Payer swaption 1Yx5Y @ 3.000%", "Payer EUR 10Y @ 3.100%", "Cap EUR 5Y @ 3.00%").
 * Returns the German display name for exactly these patterns; anything else is returned as is.
 */
export function germanTradeName(name: string | undefined): string | undefined {
  if (!name) return name;
  let m = /^(Buy|Sell) ([A-Z]{6}) ([\d.]+) @ ([\d.]+)$/.exec(name);
  if (m) return `${m[1] === "Buy" ? "Kauf" : "Verkauf"} ${pairDe(m[2]!)} ${m[3]} @ ${deDecimal(m[4]!)}`;
  m = /^(Put|Call) ([A-Z]{6}) ([\d.]+) @ ([\d.]+)$/.exec(name);
  if (m) return `${m[1]} ${pairDe(m[2]!)} ${m[3]} @ ${deDecimal(m[4]!)}`;
  m = /^(Payer|Receiver) swaption (\S+)x(\S+) @ ([\d.]+)%$/.exec(name);
  if (m) return `${m[1]}-Swaption ${m[2]}×${m[3]} @ ${deDecimal(m[4]!)} %`;
  m = /^(Payer|Receiver) ([A-Z]{3}) (\S+) @ ([\d.]+)%( \(amortisierend\))?$/.exec(name);
  if (m) return `${m[1]}-Swap ${m[2]} ${m[3]} @ ${deDecimal(m[4]!)} %${m[5] ?? ""}`;
  m = /^(Cap|Floor|Collar) ([A-Z]{3}) (\S+) @ ([\d.]+)%$/.exec(name);
  if (m) return `${m[1]} ${m[2]} ${m[3]} @ ${deDecimal(m[4]!)} %`;
  m = /^IMM ([A-Z]{3}) (\S+) @ ([\d.]+)%$/.exec(name);
  if (m) return `IMM-Swap ${m[1]} ${m[2]} @ ${deDecimal(m[3]!)} %`;
  m = /^Basis (\S+) \+([\d.]+)bp vs (\S+) (\S+)$/.exec(name);
  if (m) return `Basis-Swap ${m[1]} +${deDecimal(m[2]!)} bp vs ${m[3]} ${m[4]}`;
  m = /^FX-Swap ([A-Z]{6}) ([\d.]+) ([+-]?[\d.]+) Pkt$/.exec(name);
  if (m) return `FX-Swap ${pairDe(m[1]!)} ${m[2]} ${deDecimal(m[3]!)} Pkt`;
  // "FRA EUR 3x6 Pay @ 2.200%" (core `makeFra`)
  m = /^FRA ([A-Z]{3}) (\S+) (Pay|Receive) @ ([-\d.]+)%$/.exec(name);
  if (m) return `FRA ${m[1]} ${m[2]} ${m[3] === "Pay" ? "Zahler" : "Empfänger"} @ ${deDecimal(m[4]!)} %`;
  // "CCS EURUSD 5Y ESTR -20.0bp vs SOFR" (core `makeCrossCurrencySwap`)
  m = /^CCS ([A-Z]{6}) (\S+) (\S+) ([+-]?[\d.]+)bp vs (\S+)$/.exec(name);
  if (m) return `CCS ${pairDe(m[1]!)} ${m[2]} ${m[3]} ${deDecimal(m[4]!).replace(/^-/, "−")} bp vs ${m[5]}`;
  return name;
}

/**
 * Decimal-point numbers inside document cells ("1.216 %", "Terminkurs 1.1725")
 * → German decimal comma (N-07). Dotted dates and grouped integers
 * ("10.000.000 EUR") stay; a lone "x.yyy" is only converted when followed by
 * " %", when it has ≠ 3 decimals, or when the row label names a rate / price.
 */
export function germanizeDocValue(v: string, label = ""): string {
  const rateLike = /kurs|strike|barriere|preis|satz|prämie|vol/i.test(label);
  return v.replace(/(?<![\d.,])(-?\d+\.\d+)(?![\d.])( %)?/g, (whole, num: string, pct: string | undefined) => {
    const decimals = num.split(".")[1]!.length;
    if (pct || decimals !== 3 || rateLike) return `${deDecimal(num)}${pct ?? ""}`;
    return whole;
  });
}
