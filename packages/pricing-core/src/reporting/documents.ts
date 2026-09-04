import { yearFraction } from "../dates/daycount.js";
import { formatDateDe, formatDateTimeDe, formatDe, formatPctDe } from "../format.js";
import { tradeMaturityDate } from "../instruments/trade-dates.js";
import { type FixedLeg, type FloatLeg, type PricingResult, type SwapLeg, type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { scheduleDates } from "../pricing/leg-pricer.js";
import { STANDARD_SCENARIOS, type ScenarioResult, runScenarios } from "../risk/scenarios.js";
import { type ReportPerspective, type ValuationReport, costTransparencyFor } from "./valuation-report.js";

/**
 * Client-facing documents generated from the trade and its valuation:
 * - Termsheet (indikatives Termsheet / Produktbeschreibung)
 * - Geeignetheitserklärung nach § 64 Abs. 4 WpHG mit Ex-ante-Kostenausweis
 *   (Art. 24 MiFID II / Art. 50 DelVO 2017/565) und Szenariodarstellung.
 * - Confirmation (Geschäftsbestätigung unter DRV / ISDA Master Agreement)
 * - Basisinformationsblatt (PRIIPs-KID, VO (EU) 1286/2014, DelVO 2017/653)
 * Documents are returned as structured sections plus a Markdown rendering so
 * the UI can print them and a backend can convert them to PDF/DOCX.
 */
export interface DocumentSection {
  heading: string;
  /** Key/value rows or free text paragraphs. */
  rows?: [string, string][];
  paragraphs?: string[];
  table?: { header: string[]; rows: string[][] };
}

export type GeneratedDocumentKind = "Termsheet" | "Geeignetheitserklaerung" | "Confirmation" | "KID";

export interface GeneratedDocument {
  kind: GeneratedDocumentKind;
  title: string;
  subtitle: string;
  generatedAt: string;
  sections: DocumentSection[];
  disclaimer: string;
  markdown: string;
}

// Deterministic German formatting (no Intl / ICU dependency in the core): no
// ISO dates, no decimal points and no English trade-type identifiers in the text.
const money = (v: number, ccy?: string) => `${formatDe(v, 0)}${ccy ? " " + ccy : ""}`;
const pct = (v: number, d = 3) => formatPctDe(v, d);
const date = (d: number) => formatDateDe(d);
const bp = (decimal: number, d = 1) => `${decimal >= 0 ? "+" : ""}${formatDe(decimal * 1e4, d)} bp`;
const fxRate = (v: number) => formatDe(v, 4);

function productName(t: Trade): string {
  switch (t.type) {
    case "InterestRateSwap": {
      const fixed = t.legs.find((l): l is FixedLeg => l.type === "Fixed");
      const floats = t.legs.filter((l): l is FloatLeg => l.type === "Float");
      if (fixed) return `${fixed.payReceive === "Pay" ? "Payer" : "Receiver"}-Zinsswap (${fixed.currency})`;
      return `Basis-Swap ${floats.map((f) => f.index).join(" / ")}`;
    }
    case "CrossCurrencySwap":
      return "Zins-Währungs-Swap (Cross-Currency-Swap)";
    case "FRA":
      return "Forward Rate Agreement";
    case "CapFloor":
      return t.capFloor === "Cap" ? "Zinscap" : t.capFloor === "Floor" ? "Zinsfloor" : "Zinscollar";
    case "Swaption":
      return `${t.payerReceiver}-Swaption`;
    case "FxForward":
      return t.ndf ? "Devisentermingeschäft (NDF)" : "Devisentermingeschäft";
    case "FxSwap":
      return "Devisenswap";
    case "FxOption":
      return t.barrier ? `Devisenoption mit Barriere (${t.barrier.type})` : t.digital ? "Digitale Devisenoption" : "Devisenoption (Plain Vanilla)";
  }
}

function termsRows(t: Trade): [string, string][] {
  const rows: [string, string][] = [
    ["Produkt", productName(t)],
    ["Referenz", t.id],
  ];
  if (t.counterparty) rows.push(["Kontrahent", t.counterparty]);
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      for (const [i, l] of t.legs.entries()) {
        const dir = l.payReceive === "Pay" ? "Kunde zahlt" : "Kunde erhält";
        const steps =
          l.type === "Fixed" && l.rateSchedule?.length ? ` (Staffel: ${l.rateSchedule.map((s) => `${pct(s.rate, 2)} ab ${date(s.date)}`).join(", ")})` : "";
        const spreadSteps =
          l.type === "Float" && l.spreadSchedule?.length
            ? ` (Spread-Staffel: ${l.spreadSchedule.map((s) => `${bp(s.spread)} ab ${date(s.date)}`).join(", ")})`
            : "";
        const rate =
          l.type === "Fixed"
            ? `Festsatz ${pct(l.rate)}${steps}`
            : `${l.index}${l.spread ? ` ${bp(l.spread)}` : ""}${spreadSteps}${l.capRate !== undefined ? `, Cap ${pct(l.capRate, 2)}` : ""}${l.floorRate !== undefined ? `, Floor ${pct(l.floorRate, 2)}` : ""}`;
        rows.push([
          `Leg ${i + 1}`,
          `${dir} ${rate}, ${l.frequency}, ${l.dayCount}, Nominal ${money(l.notional, l.currency)}${l.notionalSchedule ? " (amortisierend)" : ""}${l.notionalExchange?.initial || l.notionalExchange?.final ? ", Nominalaustausch" : ""}`,
        ]);
      }
      if (t.type === "CrossCurrencySwap" && t.mtmReset) rows.push(["MtM-Reset", `Leg ${t.mtmReset.resettingLegIndex + 1}`]);
      rows.push(["Laufzeit", `${date(t.legs[0]!.effectiveDate)} – ${date(Math.max(...t.legs.map((l) => l.terminationDate)))}`]);
      break;
    case "FRA":
      rows.push(
        ["Nominal", money(t.notional, t.currency)],
        ["Periode", `${date(t.startDate)} – ${date(t.endDate)}`],
        ["Festsatz", pct(t.fixedRate)],
        ["Referenzzins", t.index],
      );
      break;
    case "CapFloor":
      rows.push(
        ["Nominal", money(t.notional, t.currency)],
        ["Referenzzins", t.index],
        ["Laufzeit", `${date(t.effectiveDate)} – ${date(t.terminationDate)}`],
        ["Strike", pct(t.strike, 2)],
      );
      if (t.floorStrike !== undefined) rows.push(["Floor-Strike", pct(t.floorStrike, 2)]);
      if (t.notionalSchedule?.length) rows.push(["Nominalverlauf", `amortisierend (${t.notionalSchedule.length} Stufen)`]);
      rows.push(["Position", t.payReceive === "Receive" ? "Kunde ist Käufer" : "Kunde ist Verkäufer"]);
      break;
    case "Swaption": {
      const fixed = t.underlying.legs.find((l): l is FixedLeg => l.type === "Fixed")!;
      rows.push(
        ["Nominal", money(fixed.notional, fixed.currency)],
        ["Ausübung", date(t.expiryDate)],
        ["Zugrunde liegender Swap", `${date(fixed.effectiveDate)} – ${date(fixed.terminationDate)}`],
        ["Strike", pct(fixed.rate)],
        ["Settlement", t.settlement === "Physical" ? "physische Lieferung des Swaps" : "Barausgleich (Cash Settlement)"],
        ["Position", t.payReceive === "Receive" ? "Kunde ist Käufer" : "Kunde ist Verkäufer"],
      );
      break;
    }
    case "FxForward":
      rows.push(
        ["Kunde kauft", money(t.buyAmount, t.buyCurrency)],
        ["Kunde verkauft", money(t.sellAmount, t.sellCurrency)],
        ["Terminkurs", fxRate(t.sellAmount / t.buyAmount)],
        ["Valuta", date(t.deliveryDate)],
      );
      break;
    case "FxSwap":
      rows.push(
        [
          "Near Leg",
          `${money(t.nearLeg.buyAmount, t.nearLeg.buyCurrency)} gegen ${money(t.nearLeg.sellAmount, t.nearLeg.sellCurrency)} per ${date(t.nearLeg.deliveryDate)}`,
        ],
        [
          "Far Leg",
          `${money(t.farLeg.buyAmount, t.farLeg.buyCurrency)} gegen ${money(t.farLeg.sellAmount, t.farLeg.sellCurrency)} per ${date(t.farLeg.deliveryDate)}`,
        ],
      );
      break;
    case "FxOption":
      rows.push(
        ["Währungspaar", t.pair],
        ["Typ", `${t.optionType} auf ${t.pair.slice(0, 3)}`],
        ["Nominal", money(t.notional, t.pair.slice(0, 3))],
        ["Strike", fxRate(t.strike)],
        ["Verfall / Lieferung", `${date(t.expiryDate)} / ${date(t.deliveryDate)}`],
        ["Position", t.payReceive === "Receive" ? "Kunde ist Käufer" : "Kunde ist Verkäufer"],
      );
      if (t.barrier) rows.push(["Barriere", `${t.barrier.type} bei ${fxRate(t.barrier.level)}`]);
      break;
  }
  return rows;
}

function risksFor(t: Trade): string[] {
  const common = [
    "Marktpreisrisiko: Der Marktwert des Geschäfts schwankt mit Zinsen, Wechselkursen und Volatilitäten; eine vorzeitige Auflösung kann zu Ausgleichszahlungen führen.",
    "Kontrahentenrisiko: Ausfall der Bank bzw. des Kunden (bilaterales OTC-Geschäft, ggf. Besicherung nach CSA).",
  ];
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return [
        ...common,
        "Bei fallenden Zinsen entsteht für den Zahler des Festsatzes ein negativer Marktwert; das Grundgeschäft (Kredit) sollte in Laufzeit und Nominal passen (Konnexität).",
        "Kein Zugang zu sinkenden Zinsen für den Festsatzzahler.",
      ];
    case "CapFloor":
      return [
        ...common,
        "Der Käufer eines Caps zahlt eine Prämie, die bei Nichtausübung verloren ist; der Verkäufer eines Floors (Collar) verzichtet auf Vorteile fallender Zinsen unterhalb des Floor-Strikes.",
      ];
    case "Swaption":
      return [...common, "Der Käufer verliert maximal die Prämie; der Verkäufer trägt ein unbegrenztes Marktwertrisiko bei Ausübung."];
    case "FxForward":
    case "FxSwap":
      return [
        ...common,
        "Opportunitätsrisiko: Der Kunde partizipiert nicht an einer für ihn günstigen Kursentwicklung; bei Wegfall des Grundgeschäfts entsteht eine offene Position.",
      ];
    case "FxOption":
      return [
        ...common,
        "Der Käufer verliert maximal die Prämie; bei Barriere-Optionen kann der Schutz durch Erreichen der Barriere entfallen (Knock-out) oder erst entstehen (Knock-in).",
      ];
    case "FRA":
      return [...common, "Zinsdifferenz wird bar ausgeglichen; Wegfall des Grundgeschäfts führt zu offener Position."];
  }
}

export function generateTermsheet(ctx: MarketContext, trade: Trade, pricing: PricingResult, report?: ValuationReport): GeneratedDocument {
  const sections: DocumentSection[] = [
    { heading: "Konditionen", rows: termsRows(trade) },
    {
      heading: "Indikative Bewertung",
      rows: [
        ["Bewertungstag", date(ctx.valuationDate)],
        ["Marktwert (risikofrei, OIS-diskontiert)", money(pricing.pv, pricing.currency)],
        ...(report
          ? ([
              ["Fair Value bilateral (inkl. CVA/DVA)", money(report.fairValue.adjusted, report.reportingCurrency)],
              ["IFRS-13-Hierarchie", `Level ${report.fairValue.ifrs13Level}`],
            ] as [string, string][])
          : []),
        ...Object.entries(pricing.analytics)
          .filter(([k]) => ["parRate", "fairForward", "forwardSwapRate", "premiumPct", "premiumPctBase", "fairSpread"].includes(k))
          .map(
            ([k, v]) =>
              [
                k === "parRate"
                  ? "Par-Satz"
                  : k === "fairForward"
                    ? "Fairer Terminkurs"
                    : k === "forwardSwapRate"
                      ? "Forward-Swapsatz"
                      : k === "fairSpread"
                        ? "Fairer Spread"
                        : "Prämie in %",
                typeof v === "number" ? (k.startsWith("premium") ? `${formatDe(v, 3)} %` : k === "fairForward" ? fxRate(v) : pct(v)) : String(v),
              ] as [string, string],
          ),
      ],
    },
    { heading: "Funktionsweise", paragraphs: [describe(trade)] },
    { heading: "Wesentliche Risiken", paragraphs: risksFor(trade) },
    {
      heading: "Marktdaten und Methodik",
      paragraphs: [`Snapshot: ${ctx.meta?.label ?? "–"} (${ctx.meta?.source ?? "–"}).`, ...(report?.methodology ?? [])],
    },
  ];
  const disclaimer =
    "Indikatives Termsheet. Keine Anlageberatung, kein Angebot. Bewertungen sind modellbasiert und beruhen auf den angegebenen Marktdaten; tatsächliche Handelspreise können abweichen. Die endgültigen Bedingungen ergeben sich aus der Bestätigung (Confirmation) unter dem Rahmenvertrag für Finanztermingeschäfte.";
  const doc: GeneratedDocument = {
    kind: "Termsheet",
    title: `Indikatives Termsheet – ${productName(trade)}`,
    subtitle: `${trade.name ?? trade.id} · Stand ${date(ctx.valuationDate)}`,
    generatedAt: new Date().toISOString(),
    sections,
    disclaimer,
    markdown: "",
  };
  doc.markdown = toMarkdown(doc);
  return doc;
}

export interface SuitabilityInputs {
  clientName: string;
  clientClassification: "Privatkunde" | "Professioneller Kunde" | "Geeignete Gegenpartei";
  /** Hedging purpose / underlying exposure described by the client. */
  hedgingPurpose: string;
  knowledgeExperience: string;
  financialSituation: string;
  riskTolerance: "niedrig" | "mittel" | "hoch";
  investmentHorizonYears: number;
  advisorName: string;
  /** Bank's transaction price (upfront the client pays, + = client pays). */
  transactionPrice: number;
  /** Optional: alternatives considered. */
  alternativesConsidered?: string[];
  /**
   * Structured cost statements (Art. 50 DelVO 2017/565): ongoing costs and the
   * early-termination policy. Defaults describe a plain OTC derivative
   * without ongoing fees and a close-out at market value plus bid/offer.
   */
  costs?: { ongoing?: string; exitPolicy?: string };
  /** Target market statement (MiFID II product governance); derived from the client data when omitted. */
  targetMarket?: string;
}

const DEFAULT_ONGOING_COSTS = "keine (OTC-Derivat ohne laufende Gebühren)";
const DEFAULT_EXIT_POLICY = "Ausgleichszahlung in Höhe des dann gültigen Marktwerts zzgl. marktüblicher Geld-Brief-Spanne";

function defaultTargetMarket(inputs: SuitabilityInputs): string {
  return `${inputs.clientClassification}n mit Absicherungsbedarf für ein bestehendes Grundgeschäft (${inputs.hedgingPurpose}), Risikotoleranz mindestens „${inputs.riskTolerance}“, Anlagehorizont bis ${inputs.investmentHorizonYears} Jahre, Kenntnisse im Umgang mit OTC-Derivaten; nicht für Kunden mit spekulativer Zielsetzung ohne Grundgeschäft.`;
}

export function generateSuitabilityStatement(
  ctx: MarketContext,
  trade: Trade,
  // Kept in the signature for API stability; the statement reads fair value and costs from `report`.
  _pricing: PricingResult,
  report: ValuationReport,
  inputs: SuitabilityInputs,
  scenarios?: ScenarioResult[],
): GeneratedDocument {
  const cost = report.costTransparency;
  const notional = notionalOf(trade);
  const sections: DocumentSection[] = [
    {
      heading: "Angaben zum Kunden",
      rows: [
        ["Kunde", inputs.clientName],
        ["Einstufung nach § 67 WpHG", inputs.clientClassification],
        ["Kenntnisse und Erfahrungen", inputs.knowledgeExperience],
        ["Finanzielle Verhältnisse", inputs.financialSituation],
        ["Risikotoleranz", inputs.riskTolerance],
        ["Anlagehorizont", `${inputs.investmentHorizonYears} Jahre`],
      ],
    },
    { heading: "Absicherungszweck und Grundgeschäft", paragraphs: [inputs.hedgingPurpose] },
    { heading: "Empfohlenes Geschäft", rows: termsRows(trade) },
    {
      heading: "Begründung der Geeignetheit",
      paragraphs: [
        `Das Geschäft dient der Absicherung des beschriebenen Grundgeschäfts und entspricht mit einer Laufzeit bis ${date(maturityOf(trade))} dem Anlagehorizont von ${inputs.investmentHorizonYears} Jahren.`,
        `Die Risikotoleranz „${inputs.riskTolerance}" ist mit dem Produkt vereinbar: ${risksFor(trade)[2] ?? risksFor(trade)[0]}`,
        ...(inputs.alternativesConsidered?.length ? [`Geprüfte Alternativen: ${inputs.alternativesConsidered.join("; ")}.`] : []),
      ],
    },
    {
      heading: "Kostenausweis (ex ante, Art. 24 Abs. 4 MiFID II / Art. 50 DelVO 2017/565)",
      rows: [
        ["Fair Value (bilateral)", money(report.fairValue.adjusted, report.reportingCurrency)],
        ["Transaktionspreis / Upfront", money(inputs.transactionPrice, report.reportingCurrency)],
        [
          "Anfänglicher Marktwert aus Kundensicht",
          cost
            ? `${money(cost.initialMarketValue, report.reportingCurrency)} (${formatPctDe(notional ? cost.initialMarketValue / notional : 0, 3)} des Nominals)`
            : "–",
        ],
        [
          "Darin enthaltene Marge der Bank",
          cost
            ? `${money(cost.bankMargin, report.reportingCurrency)} (${formatDe(cost.marginBp, 1)} bp bzw. ${formatDe(cost.marginPct, 3)} % des Nominals ${money(notional)}${inputs.transactionPrice ? `; ${formatPctDe(cost.bankMargin / Math.abs(inputs.transactionPrice), 2)} des Transaktionspreises` : ""})`
            : "–",
        ],
        ["Laufende Kosten", inputs.costs?.ongoing ?? DEFAULT_ONGOING_COSTS],
        ["Kosten bei vorzeitiger Auflösung", inputs.costs?.exitPolicy ?? DEFAULT_EXIT_POLICY],
        ["Zielmarkt (MiFID II Product Governance)", inputs.targetMarket ?? defaultTargetMarket(inputs)],
      ],
      paragraphs: [
        "Kosten und Nebenkosten werden als Betrag in der Reporting-Währung und in Prozent (des Nominals bzw. des Transaktionspreises) ausgewiesen (Art. 50 Abs. 2 DelVO 2017/565).",
        "Hinweis gemäß BGH-Rechtsprechung (XI ZR 33/10, XI ZR 378/13): Das Geschäft weist zum Abschlusszeitpunkt den oben ausgewiesenen anfänglichen negativen Marktwert aus Kundensicht auf. Dieser entspricht der einstrukturierten Marge der Bank und wird hiermit einschließlich seiner Höhe offengelegt.",
      ],
    },
  ];
  if (scenarios?.length) {
    sections.push({
      heading: "Szenariobetrachtung (Marktwertänderung des Geschäfts)",
      table: {
        header: ["Szenario", "Marktwert", "Veränderung"],
        rows: scenarios.map((s) => [
          s.scenario.name,
          money(s.total, report.reportingCurrency),
          `${s.pnl >= 0 ? "+" : ""}${money(s.pnl, report.reportingCurrency)}`,
        ]),
      },
    });
  }
  sections.push({
    heading: "Erklärung",
    paragraphs: [
      `Auf Grundlage der vorstehenden Angaben wurde geprüft, ob das empfohlene Geschäft für den Kunden geeignet ist (§ 64 Abs. 3 und 4 WpHG). Die Empfehlung entspricht den Anlagezielen, der Risikotoleranz sowie den Kenntnissen und Erfahrungen des Kunden und ist finanziell tragbar.`,
      `Berater: ${inputs.advisorName} · Datum: ${date(ctx.valuationDate)} · Referenz-Snapshot: ${report.audit.snapshotId} · Report-Hash: ${report.audit.reportHash}`,
    ],
  });
  const doc: GeneratedDocument = {
    kind: "Geeignetheitserklaerung",
    title: "Geeignetheitserklärung nach § 64 Abs. 4 WpHG",
    subtitle: `${inputs.clientName} · ${productName(trade)} · ${trade.id}`,
    generatedAt: new Date().toISOString(),
    sections,
    disclaimer:
      "Diese Erklärung wurde vor Abschluss des Geschäfts erstellt und dem Kunden auf einem dauerhaften Datenträger zur Verfügung gestellt. Die Bewertung ist modellbasiert (siehe Methodik im Bewertungsreport).",
    markdown: "",
  };
  doc.markdown = toMarkdown(doc);
  return doc;
}

function describe(t: Trade): string {
  switch (t.type) {
    case "InterestRateSwap": {
      const fixed = t.legs.find((l): l is FixedLeg => l.type === "Fixed");
      const fl = t.legs.find((l): l is FloatLeg => l.type === "Float");
      if (fixed && fl) {
        return fixed.payReceive === "Pay"
          ? `Der Kunde zahlt einen festen Zinssatz von ${pct(fixed.rate)} und erhält den variablen Referenzzins ${fl.index}. In Verbindung mit einem variabel verzinsten Kredit ergibt sich eine feste Gesamtverzinsung; steigende Referenzzinsen werden ausgeglichen, fallende Zinsen kommen nicht zugute.`
          : `Der Kunde erhält einen festen Zinssatz von ${pct(fixed.rate)} und zahlt den variablen Referenzzins ${fl.index}. Steigende Zinsen führen zu einem negativen Marktwert.`;
      }
      return "Austausch zweier variabler Zinszahlungsströme mit Spread (Basis-Swap).";
    }
    case "CrossCurrencySwap":
      return "Austausch von Zins- und Nominalzahlungen in zwei Währungen; zum Laufzeitbeginn und -ende werden die Nominalbeträge zum vereinbarten Kurs getauscht.";
    case "FRA":
      return "Fixierung eines zukünftigen Zinssatzes für eine Periode; Ausgleich der Zinsdifferenz zu Periodenbeginn.";
    case "CapFloor":
      return t.capFloor === "Cap"
        ? `Gegen Zahlung einer Prämie erhält der Kunde in jeder Periode die Differenz, um die der Referenzzins ${t.index} den Strike von ${pct(t.strike, 2)} übersteigt – eine Zinsobergrenze bei voller Partizipation an fallenden Zinsen.`
        : t.capFloor === "Floor"
          ? `Der Kunde erhält die Differenz, um die der Referenzzins unter ${pct(t.strike, 2)} fällt.`
          : `Kombination aus gekauftem Cap (${pct(t.strike, 2)}) und verkauftem Floor (${pct(t.floorStrike ?? 0, 2)}): Der Zins bewegt sich in einem Korridor; die Prämie des Caps wird durch den Floor (teilweise) finanziert.`;
    case "Swaption":
      return `Recht, zum ${date(t.expiryDate)} in einen ${t.payerReceiver === "Payer" ? "Payer" : "Receiver"}-Swap mit Festsatz einzutreten. Absicherung eines zukünftigen Zinsniveaus bei Erhalt der Flexibilität.`;
    case "FxForward":
      return `Verbindlicher Kauf von ${money(t.buyAmount, t.buyCurrency)} gegen ${money(t.sellAmount, t.sellCurrency)} zum ${date(t.deliveryDate)} zum heute fixierten Terminkurs.`;
    case "FxSwap":
      return "Kombination aus Kassa- und Termingeschäft in entgegengesetzter Richtung zur Liquiditäts- bzw. Laufzeitsteuerung von Fremdwährungspositionen.";
    case "FxOption":
      return `Recht (keine Pflicht), ${money(t.notional, t.pair.slice(0, 3))} zum Kurs ${fxRate(t.strike)} am ${date(t.expiryDate)} zu ${t.optionType === "Call" ? "kaufen" : "verkaufen"}; Absicherung eines Worst-Case-Kurses bei Partizipation an günstigen Kursen.`;
  }
}

function notionalOf(t: Trade): number {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return t.legs[0]!.notional;
    case "Swaption":
      return t.underlying.legs[0]!.notional;
    case "FRA":
    case "CapFloor":
    case "FxOption":
      return t.notional;
    case "FxForward":
      return t.buyAmount;
    case "FxSwap":
      return t.nearLeg.buyAmount;
  }
}

function maturityOf(t: Trade): number {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return Math.max(...t.legs.map((l) => l.terminationDate));
    case "Swaption":
      return Math.max(...t.underlying.legs.map((l) => l.terminationDate));
    case "FRA":
      return t.endDate;
    case "CapFloor":
      return t.terminationDate;
    case "FxForward":
      return t.deliveryDate;
    case "FxSwap":
      return t.farLeg.deliveryDate;
    case "FxOption":
      return t.deliveryDate;
  }
}

// ---------------------------------------------------------------------------
// Confirmation (Geschäftsbestätigung)
// ---------------------------------------------------------------------------

export interface ConfirmationParties {
  /** Bank / dealer (Partei A), e.g. legal name, LEI, address. */
  bank: { name: string; lei?: string; address?: string; contact?: string };
  /** Client (Partei B). */
  client: { name: string; lei?: string; address?: string; contact?: string };
}

export interface MasterAgreementRef {
  /** Deutscher Rahmenvertrag für Finanztermingeschäfte (DRV) or ISDA Master Agreement. */
  type: "DRV" | "ISDA";
  /** Date of the master agreement (serial date). */
  date?: number;
  /** Reference / contract number, CSA / Besicherungsanhang reference. */
  reference?: string;
  csaReference?: string;
}

function legPaymentSchedule(t: Trade): { header: string[]; rows: string[][] } | undefined {
  const legs: SwapLeg[] = t.type === "InterestRateSwap" || t.type === "CrossCurrencySwap" ? t.legs : [];
  if (legs.length === 0) return undefined;
  const rows: string[][] = [];
  legs.forEach((l, i) => {
    for (const d of scheduleDates(l)) {
      rows.push([
        String(i + 1),
        l.payReceive === "Pay" ? "Kunde zahlt" : "Kunde erhält",
        date(d),
        l.type === "Fixed" ? `Festsatz ${pct(l.rate)}` : `${l.index} (Fixing)`,
        l.currency,
      ]);
    }
  });
  rows.sort((a, b) => a[2]!.split(".").reverse().join("").localeCompare(b[2]!.split(".").reverse().join("")));
  return { header: ["Leg", "Richtung", "Zahltag", "Basis", "Währung"], rows };
}

function pricedPaymentSchedule(pricing: PricingResult): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  for (const leg of pricing.legs) {
    for (const cf of leg.cashflows) {
      rows.push([
        String(cf.legIndex + 1),
        cf.amount >= 0 ? "Kunde erhält" : "Kunde zahlt",
        date(cf.paymentDate),
        cf.accrualStart !== undefined && cf.accrualEnd !== undefined ? `${date(cf.accrualStart)} – ${date(cf.accrualEnd)}` : "",
        cf.rate !== undefined && cf.kind === "Interest"
          ? `${pct(cf.rate, 4)}${cf.isFixed === false ? " (indikativ)" : ""}`
          : cf.kind === "Notional"
            ? "Nominal"
            : cf.kind,
        `${money(Math.abs(cf.amount), cf.currency)}`,
      ]);
    }
  }
  return { header: ["Leg", "Richtung", "Zahltag", "Periode", "Satz / Art", "Betrag"], rows };
}

/**
 * Confirmation (Einzelabschluss unter dem Rahmenvertrag): parties, master
 * agreement reference, economic terms (from `termsRows`) and the payment
 * schedule (from the pricing cashflows when given, else the leg schedules).
 * Indicative floating amounts are marked as such.
 */
export function generateConfirmation(
  trade: Trade,
  parties: ConfirmationParties,
  masterAgreement: MasterAgreementRef,
  ctx?: MarketContext,
  pricing?: PricingResult,
  opts: { tradeDate?: number; confirmationDate?: number; reference?: string } = {},
): GeneratedDocument {
  const party = (p: ConfirmationParties["bank"]) => [p.name, p.lei ? `LEI ${p.lei}` : "", p.address ?? "", p.contact ?? ""].filter(Boolean).join(", ");
  const maName = masterAgreement.type === "DRV" ? "Rahmenvertrag für Finanztermingeschäfte (DRV)" : "ISDA Master Agreement";
  const tradeDate = opts.tradeDate ?? trade.tradeDate ?? ctx?.valuationDate;
  const schedule = pricing ? pricedPaymentSchedule(pricing) : legPaymentSchedule(trade);
  const sections: DocumentSection[] = [
    {
      heading: "Parteien",
      rows: [
        ["Partei A (Bank)", party(parties.bank)],
        ["Partei B (Kunde)", party(parties.client)],
      ],
    },
    {
      heading: "Rahmenvertrag",
      rows: [
        ["Rahmenvertrag", `${maName}${masterAgreement.date !== undefined ? ` vom ${date(masterAgreement.date)}` : ""}`],
        ...(masterAgreement.reference ? ([["Vertragsnummer", masterAgreement.reference]] as [string, string][]) : []),
        ...(masterAgreement.csaReference
          ? ([[masterAgreement.type === "DRV" ? "Besicherungsanhang" : "Credit Support Annex", masterAgreement.csaReference]] as [string, string][])
          : []),
        ...(trade.collateralCurrency ? ([["Besicherungswährung", trade.collateralCurrency]] as [string, string][]) : []),
      ],
      paragraphs: [
        masterAgreement.type === "DRV"
          ? "Dieser Einzelabschluss unterliegt dem genannten Rahmenvertrag für Finanztermingeschäfte einschließlich seiner Anhänge; Begriffe haben die dort festgelegte Bedeutung. Alle Einzelabschlüsse bilden einen einheitlichen Vertrag (Nr. 1 Abs. 2 DRV)."
          : "This Confirmation supplements, forms part of and is subject to the ISDA Master Agreement referenced above; capitalised terms have the meaning given in the 2006 ISDA Definitions (or the 2021 ISDA Interest Rate Derivatives Definitions, as applicable).",
      ],
    },
    {
      heading: "Wirtschaftliche Bedingungen",
      rows: [
        ...(opts.reference ? ([["Referenz Bestätigung", opts.reference]] as [string, string][]) : []),
        ...(tradeDate !== undefined ? ([["Handelstag", date(tradeDate)]] as [string, string][]) : []),
        ...(trade.uti ? ([["UTI", trade.uti]] as [string, string][]) : []),
        ...termsRows(trade),
        ...(trade.upfront
          ? ([
              [
                "Prämie / Upfront",
                `${money(Math.abs(trade.upfront.amount), trade.upfront.currency)} ${trade.upfront.amount >= 0 ? "zahlbar vom Kunden" : "zahlbar an den Kunden"} am ${date(trade.upfront.date)}`,
              ],
            ] as [string, string][])
          : []),
        ["Geschäftstagekonvention / Kalender", conventionSummary(trade)],
      ],
    },
  ];
  if (schedule && schedule.rows.length) {
    sections.push({
      heading: pricing ? "Zahlungsplan (variable Beträge indikativ auf Basis der Forwards)" : "Zahlungsplan (Zahltage)",
      table: schedule,
    });
  }
  sections.push({
    heading: "Bestätigung",
    paragraphs: [
      "Bitte prüfen Sie diese Bestätigung sorgfältig und teilen Sie uns Abweichungen unverzüglich mit. Ohne Widerspruch innerhalb der im Rahmenvertrag vorgesehenen Frist gilt der Inhalt als bestätigt.",
      `Die Bestätigung wurde am ${opts.confirmationDate !== undefined ? date(opts.confirmationDate) : ctx ? date(ctx.valuationDate) : "–"} erstellt. Für Partei A: ______________________ · Für Partei B: ______________________`,
    ],
  });
  const doc: GeneratedDocument = {
    kind: "Confirmation",
    title: `Bestätigung (Confirmation) – ${productName(trade)}`,
    subtitle: `${trade.name ?? trade.id} · ${parties.bank.name} / ${parties.client.name} · ${maName}`,
    generatedAt: new Date().toISOString(),
    sections,
    disclaimer:
      "Diese Bestätigung dokumentiert die wirtschaftlichen Bedingungen des Einzelabschlusses unter dem Rahmenvertrag. Variable Beträge sind bis zum Fixing indikativ. Bei Widersprüchen zwischen dieser Bestätigung und dem Rahmenvertrag gehen die Regelungen dieser Bestätigung für den Einzelabschluss vor.",
    markdown: "",
  };
  doc.markdown = toMarkdown(doc);
  return doc;
}

function conventionSummary(t: Trade): string {
  const legs: SwapLeg[] = t.type === "InterestRateSwap" || t.type === "CrossCurrencySwap" ? t.legs : t.type === "Swaption" ? t.underlying.legs : [];
  if (legs.length === 0) {
    if (t.type === "CapFloor") return `${t.businessDayConvention ?? "ModifiedFollowing"}, Kalender ${t.calendar}, ${t.dayCount}`;
    return "Geschäftstage gemäß Rahmenvertrag / Marktusance des Währungspaars";
  }
  return legs
    .map(
      (l, i) =>
        `Leg ${i + 1}: ${l.businessDayConvention ?? "ModifiedFollowing"}, ${l.calendar}, Stub ${l.stub ?? "ShortFront"}${l.paymentLag ? `, Zahlungsverzug ${l.paymentLag} GT` : ""}`,
    )
    .join("; ");
}

// ---------------------------------------------------------------------------
// PRIIPs KID (Basisinformationsblatt)
// ---------------------------------------------------------------------------

export interface KidOptions {
  /** PRIIP manufacturer (Hersteller) – bank name. */
  manufacturer: string;
  /** Competent authority (default BaFin). */
  competentAuthority?: string;
  /** Product name override (default: product name + trade name). */
  productName?: string;
  /** Recommended holding period in years (default: time to maturity). */
  holdingPeriodYears?: number;
  /** Target market statement (default: hedging clients with a matching underlying exposure). */
  targetMarket?: string;
  /** Transaction price paid by the client (positive = client pays) for the cost section. */
  transactionPrice?: number;
  /** Perspective of `pricing.pv` / `transactionPrice` (default "Bank"). */
  perspective?: ReportPerspective;
  /** Valuation report – supplies cost transparency and fair value when present. */
  report?: ValuationReport;
  /** Notional for percentage figures (default inferred from the trade). */
  notional?: number;
  /** Website / contact for complaints. */
  contact?: string;
  /** Scenario set for the performance scenarios when `scenarios` is not supplied (default `STANDARD_SCENARIOS`). */
  scenarioSet?: typeof STANDARD_SCENARIOS;
}

/**
 * Summary risk indicator (1–7) – **heuristic**, not the DelVO (EU) 2017/653
 * Annex II calculation. The market risk measure is approximated by the
 * worst-case loss of the deterministic scenario set relative to the notional
 * (used in place of the VaR-equivalent volatility, VEV) and mapped to the
 * MRM classes with the Annex II VEV thresholds: < 0.5 % → 1, 0.5–5 % → 2,
 * 5–12 % → 3, 12–20 % → 4, 20–30 % → 5, 30–80 % → 6, > 80 % → 7. Bought
 * options are capped at the premium (max loss = premium, MRM ≤ 6), sold
 * options and linear derivatives use the scenario loss; a floor of class 2
 * applies to OTC derivatives (credit risk class of a bank counterparty, CRM).
 * The prescribed Annex II method for category-3 PRIIPs – bootstrapped /
 * Cornish-Fisher VaR at 97.5 % over the recommended holding period from
 * simulated (Monte-Carlo) price paths and the CRM from the manufacturer's
 * credit assessment – is roadmap; see `generateKid` ("Herleitung").
 */
export function summaryRiskIndicator(lossFraction: number, opts: { isBoughtOption?: boolean } = {}): { sri: 1 | 2 | 3 | 4 | 5 | 6 | 7; vevProxy: number } {
  const vev = Math.max(0, lossFraction);
  let mrm: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  if (vev < 0.005) mrm = 1;
  else if (vev < 0.05) mrm = 2;
  else if (vev < 0.12) mrm = 3;
  else if (vev < 0.2) mrm = 4;
  else if (vev < 0.3) mrm = 5;
  else if (vev < 0.8) mrm = 6;
  else mrm = 7;
  // Derivatives are at least class 2 (credit risk of the counterparty); PRIIPs assigns derivatives without a fixed capital at risk to class 7 in the strict reading – the heuristic keeps the MRM scale but never below 2.
  const sri = Math.max(2, opts.isBoughtOption ? Math.min(mrm, 6) : mrm) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return { sri, vevProxy: vev };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * PRIIPs-style key information document (Basisinformationsblatt, VO (EU)
 * 1286/2014 / DelVO 2017/653): product description, summary risk indicator
 * (heuristic from the scenario P&L, see `summaryRiskIndicator`), performance
 * scenarios ungünstig / moderat / günstig / Stress from the scenario set
 * (10th / 50th / 90th percentile and worst case of the P&L), costs from the
 * cost transparency block and the recommended holding period. Scenarios are
 * computed with `runScenarios` on `STANDARD_SCENARIOS` when none are given.
 */
export function generateKid(
  ctx: MarketContext,
  trade: Trade,
  pricing: PricingResult,
  scenarios: ScenarioResult[] | undefined,
  opts: KidOptions,
): GeneratedDocument {
  const notional = opts.notional ?? notionalOf(trade);
  const ccy = pricing.currency;
  const perspective = opts.perspective ?? "Bank";
  // Client's view of the value: sign flip when the pricing is the bank's.
  const clientSign = perspective === "Kunde" ? 1 : -1;
  const results =
    scenarios ??
    runScenarios(
      ctx,
      [trade],
      (opts.scenarioSet ?? STANDARD_SCENARIOS).filter((s) => s.id !== "base"),
      ccy,
    ).results;
  const pnls = results.map((r) => clientSign * r.pnl).filter((x) => Number.isFinite(x));
  const sorted = [...pnls].sort((a, b) => a - b);
  const worst = sorted[0] ?? 0;
  const isOption = trade.type === "CapFloor" || trade.type === "Swaption" || trade.type === "FxOption";
  const isBought = isOption && "payReceive" in trade && (perspective === "Kunde" ? trade.payReceive === "Receive" : trade.payReceive === "Pay");
  const premium = Math.abs(clientSign * pricing.pv);
  const lossFraction = notional ? Math.min(Math.abs(Math.min(worst, 0)), isBought ? premium : Infinity) / Math.abs(notional) : 0;
  const { sri, vevProxy } = summaryRiskIndicator(lossFraction, { isBoughtOption: isBought });
  const holding = opts.holdingPeriodYears ?? Math.max(1 / 12, yearFraction(ctx.valuationDate, tradeMaturityDate(trade), "ACT/365F"));
  const cost =
    opts.report?.costTransparency ??
    (opts.transactionPrice !== undefined
      ? costTransparencyFor(perspective, opts.report?.fairValue.adjusted ?? pricing.pv, opts.transactionPrice, notional)
      : undefined);
  const scenarioRows: string[][] = [
    [
      "Stressszenario",
      `${money(clientSign * pricing.pv + worst, ccy)}`,
      `${worst >= 0 ? "+" : ""}${money(worst, ccy)}`,
      results[sorted.indexOf(worst)] !== undefined ? (results.find((r) => clientSign * r.pnl === worst)?.scenario.name ?? "") : "",
    ],
    [
      "Pessimistisches Szenario",
      money(clientSign * pricing.pv + percentile(sorted, 0.1), ccy),
      `${percentile(sorted, 0.1) >= 0 ? "+" : ""}${money(percentile(sorted, 0.1), ccy)}`,
      "10 %-Quantil der Szenarien",
    ],
    [
      "Mittleres Szenario",
      money(clientSign * pricing.pv + percentile(sorted, 0.5), ccy),
      `${percentile(sorted, 0.5) >= 0 ? "+" : ""}${money(percentile(sorted, 0.5), ccy)}`,
      "Median der Szenarien",
    ],
    [
      "Optimistisches Szenario",
      money(clientSign * pricing.pv + percentile(sorted, 0.9), ccy),
      `${percentile(sorted, 0.9) >= 0 ? "+" : ""}${money(percentile(sorted, 0.9), ccy)}`,
      "90 %-Quantil der Szenarien",
    ],
  ];
  const name = opts.productName ?? `${productName(trade)} – ${trade.name ?? trade.id}`;
  const sections: DocumentSection[] = [
    {
      heading: "Zweck",
      paragraphs: [
        "Dieses Informationsblatt stellt Ihnen wesentliche Informationen über dieses Anlageprodukt zur Verfügung. Es handelt sich nicht um Werbematerial. Diese Informationen sind gesetzlich vorgeschrieben, um Ihnen dabei zu helfen, die Art, das Risiko, die Kosten sowie die möglichen Gewinne und Verluste dieses Produkts zu verstehen, und Ihnen dabei zu helfen, es mit anderen Produkten zu vergleichen.",
      ],
    },
    {
      heading: "Produkt",
      rows: [
        ["Produktname", name],
        ["Hersteller", opts.manufacturer],
        ["Referenz", trade.id],
        ["Zuständige Behörde", opts.competentAuthority ?? "Bundesanstalt für Finanzdienstleistungsaufsicht (BaFin)"],
        ["Erstellungsdatum", date(ctx.valuationDate)],
        ...(opts.contact ? ([["Kontakt", opts.contact]] as [string, string][]) : []),
      ],
      paragraphs: ["Sie sind im Begriff, ein Produkt zu erwerben, das nicht einfach ist und schwer zu verstehen sein kann."],
    },
    {
      heading: "Um welche Art von Produkt handelt es sich?",
      rows: [
        ["Art", `${productName(trade)} (OTC-Derivat, bilateral unter Rahmenvertrag)`],
        ["Laufzeit", `${date(tradeMaturityDate(trade))} (${formatDe(holding, 1)} Jahre)`],
        ["Nominal", money(notional, notionalCurrency(trade))],
        [
          "Zielmarkt",
          opts.targetMarket ??
            "Kunden mit einem Grundgeschäft (Kredit, Fremdwährungszahlung), das dem Produkt in Laufzeit, Nominal und Referenzgröße entspricht, und Kenntnissen im Umgang mit Derivaten; nicht für Anleger mit spekulativer Zielsetzung ohne Grundgeschäft.",
        ],
      ],
      paragraphs: [
        `Ziele: ${describe(trade)}`,
        "Das Produkt hat keine Kündigungsmöglichkeit des Herstellers; eine vorzeitige Auflösung erfolgt zum dann gültigen Marktwert.",
      ],
    },
    {
      heading: "Welche Risiken bestehen und was könnte ich im Gegenzug dafür bekommen?",
      rows: [
        ["Gesamtrisikoindikator (SRI)", `${sri} von 7 (1 = niedrigstes, 7 = höchstes Risiko)`],
        [
          "Herleitung",
          `Heuristik (keine Berechnung nach Anhang II DelVO (EU) 2017/653): Marktrisikomaß = maximaler Szenarioverlust ${formatPctDe(vevProxy, 2)} des Nominals über ${results.length} Szenarien (deterministische Marktszenarien des Bewertungskerns)${isBought ? ", begrenzt auf die gezahlte Prämie (Klasse höchstens 6)" : ""}, eingeordnet nach den VEV-Klassengrenzen des Anhangs II (unter 0,5 % Klasse 1; 0,5–5 % Klasse 2; 5–12 % Klasse 3; 12–20 % Klasse 4; 20–30 % Klasse 5; 30–80 % Klasse 6; über 80 % Klasse 7); Kreditrisikomaß pauschal als Bankkontrahent (mind. Klasse 2). Die vorgeschriebene Monte-Carlo-/Cornish-Fisher-VaR-Simulation über die empfohlene Haltedauer (Kategorie 3, Anhang II Nr. 19 ff.) ist als Weiterentwicklung vorgesehen.`,
        ],
        ["Empfohlene Haltedauer", `${formatDe(holding, 1)} Jahre (bis Fälligkeit)`],
      ],
      paragraphs: [
        isOption && isBought
          ? "Der Verlust ist auf die gezahlte Prämie begrenzt; der Marktwert des Rechts kann zwischenzeitlich stark schwanken."
          : "Dieses Produkt beinhaltet keinen Schutz vor künftigen Marktentwicklungen, sodass Sie einen Teil oder den gesamten eingesetzten Betrag verlieren können; bei einer vorzeitigen Auflösung können erhebliche Ausgleichszahlungen anfallen.",
        ...risksFor(trade),
      ],
      table: {
        header: ["Szenario", "Marktwert aus Kundensicht", "Veränderung", "Grundlage"],
        rows: scenarioRows,
      },
    },
    {
      heading: "Was geschieht, wenn der Hersteller nicht in der Lage ist, die Auszahlung vorzunehmen?",
      paragraphs: [
        `Sie sind dem Ausfallrisiko der ${opts.manufacturer} ausgesetzt. Bei Insolvenz der Bank können Ansprüche aus dem Derivat ganz oder teilweise ausfallen; eine Einlagensicherung besteht nicht.${trade.collateralCurrency ? ` Das Geschäft ist unter einem Besicherungsanhang (CSA, ${trade.collateralCurrency}) besichert, was das Ausfallrisiko reduziert.` : ""}`,
      ],
    },
    {
      heading: "Welche Kosten entstehen?",
      rows: cost
        ? [
            [
              "Einstiegskosten (Marge der Bank)",
              `${money(cost.bankMargin, ccy)} (${formatDe(cost.marginBp, 1)} bp bzw. ${formatDe(cost.marginPct, 3)} % des Nominals)`,
            ],
            ["Anfänglicher Marktwert aus Kundensicht", money(cost.initialMarketValue, ccy)],
            ["Laufende Kosten", "keine (OTC-Derivat ohne laufende Gebühren)"],
            ["Ausstiegskosten", "Ausgleichszahlung zum Marktwert zzgl. marktüblicher Geld-Brief-Spanne bei vorzeitiger Auflösung"],
            [
              "Auswirkung auf die Rendite (RIY) p. a.",
              `${formatDe(holding > 0 ? cost.marginPct / holding : cost.marginPct, 3)} % p. a. über die empfohlene Haltedauer`,
            ],
          ]
        : [["Einstiegskosten", "Kein Transaktionspreis angegeben – Kosten werden im Ex-ante-Kostenausweis (Geeignetheitserklärung) ausgewiesen."]],
    },
    {
      heading: "Wie lange sollte ich die Anlage halten, und kann ich vorzeitig Geld entnehmen?",
      paragraphs: [
        `Empfohlene Haltedauer: bis zur Fälligkeit am ${date(tradeMaturityDate(trade))}. Eine vorzeitige Auflösung ist nur im Einvernehmen mit der Bank zum dann gültigen Marktwert möglich; dieser kann negativ sein.`,
      ],
    },
    {
      heading: "Wie kann ich mich beschweren?",
      paragraphs: [
        `Beschwerden richten Sie an ${opts.contact ?? `die Beschwerdestelle der ${opts.manufacturer}`}. Unabhängig davon steht Ihnen der Weg zur Schlichtungsstelle und zur BaFin offen.`,
      ],
    },
    {
      heading: "Sonstige zweckdienliche Angaben",
      paragraphs: [
        `Bewertung: Marktwert ${money(clientSign * pricing.pv, ccy)} aus Kundensicht am ${date(ctx.valuationDate)}; Marktdaten ${ctx.meta?.label ?? "–"} (${ctx.meta?.source ?? "–"}).${opts.report ? ` Referenz-Snapshot ${opts.report.audit.snapshotId}, Report-Hash ${opts.report.audit.reportHash}.` : ""}`,
        "Weitere Unterlagen: Termsheet, Geeignetheitserklärung (§ 64 Abs. 4 WpHG), Rahmenvertrag und Bestätigung des Einzelabschlusses.",
      ],
    },
  ];
  const doc: GeneratedDocument = {
    kind: "KID",
    title: "Basisinformationsblatt",
    subtitle: `${name} · ${opts.manufacturer}`,
    generatedAt: new Date().toISOString(),
    sections,
    disclaimer:
      "Basisinformationsblatt nach VO (EU) 1286/2014 (PRIIPs). Risikoindikator und Performance-Szenarien sind Näherungen aus deterministischen Marktszenarien des Bewertungskerns und ersetzen nicht die Berechnung nach Anhang II–V der DelVO (EU) 2017/653.",
    markdown: "",
  };
  doc.markdown = toMarkdown(doc);
  return doc;
}

function notionalCurrency(t: Trade): string {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return t.legs[0]!.currency;
    case "Swaption":
      return t.underlying.legs[0]!.currency;
    case "FRA":
    case "CapFloor":
      return t.currency;
    case "FxOption":
      return t.pair.slice(0, 3).toUpperCase();
    case "FxForward":
      return t.buyCurrency;
    case "FxSwap":
      return t.nearLeg.buyCurrency;
  }
}

export function toMarkdown(doc: GeneratedDocument): string {
  const out: string[] = [`# ${doc.title}`, `_${doc.subtitle}_`, ""];
  for (const s of doc.sections) {
    out.push(`## ${s.heading}`, "");
    if (s.rows) {
      out.push("| | |", "|---|---|");
      for (const [k, v] of s.rows) out.push(`| **${k}** | ${v} |`);
      out.push("");
    }
    if (s.table) {
      out.push(`| ${s.table.header.join(" | ")} |`, `|${s.table.header.map(() => "---").join("|")}|`);
      for (const r of s.table.rows) out.push(`| ${r.join(" | ")} |`);
      out.push("");
    }
    for (const p of s.paragraphs ?? []) out.push(p, "");
  }
  out.push("---", `_${doc.disclaimer}_`, "", `Erstellt: ${formatDateTimeDe(doc.generatedAt)}`);
  return out.join("\n");
}
