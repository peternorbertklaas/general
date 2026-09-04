import { useMemo, useState } from "react";
import {
  type ConfirmationParties,
  type GeneratedDocument,
  type KidOptions,
  type MasterAgreementRef,
  type PricingResult,
  type SuitabilityInputs,
  type Trade,
  type ValuationReport,
  STANDARD_SCENARIOS,
  generateConfirmation,
  generateKid,
  generateSuitabilityStatement,
  generateTermsheet,
  parseISO,
  runScenarios,
  toMarkdown,
} from "@deriva/pricing-core";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { germanizeDocValue, germanizeParagraph, translatePricingError } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { tradeMaturity } from "../lib/trade-ops.js";
import { type DocKind, reportInputsFor, useStore } from "../state/store.js";
import { DateInput } from "./DateInput.js";
import { Modal } from "./Modal.js";
import { NumInput } from "./NumInput.js";

export type { DocKind };

const INTERNAL_ROW = /marge|margin|ertrag der bank|bankmarge|deckungsbeitrag|interne/i;
const REQUIRED_ROW = /anfänglicher (negativer )?marktwert|initial market value|kosten|einstiegskosten/i;

/** Customer mode: drop internal margin lines but keep the legally required initial market value / cost figures. */
export function filterForCustomer(doc: GeneratedDocument, customer: boolean): GeneratedDocument {
  if (!customer) return doc;
  const sections = doc.sections
    .map((sec) => ({
      ...sec,
      rows: sec.rows?.filter(([k]) => REQUIRED_ROW.test(k) || !INTERNAL_ROW.test(k)),
      table: sec.table ? { ...sec.table, rows: sec.table.rows.filter((r) => REQUIRED_ROW.test(r[0] ?? "") || !INTERNAL_ROW.test(r[0] ?? "")) } : undefined,
      paragraphs: sec.paragraphs?.filter((p) => REQUIRED_ROW.test(p) || !INTERNAL_ROW.test(p)),
    }))
    .filter((sec) => !INTERNAL_ROW.test(sec.heading) || sec.rows?.length || sec.paragraphs?.length || sec.table?.rows.length);
  return { ...doc, sections, markdown: toMarkdown({ ...doc, sections }) };
}

/**
 * UI-side polish of core documents (N-07 / N-22): German decimal commas in
 * every cell and – for termsheets – the legally required initial market value
 * (BGH XI ZR 33/10) in the "Indikative Bewertung" section when the report
 * carries a cost-transparency block. The Markdown is regenerated accordingly.
 */
export function polishDocument(doc: GeneratedDocument, kind: DocKind, report: ValuationReport): GeneratedDocument {
  const ct = report.costTransparency;
  const sections = doc.sections.map((sec) => {
    let rows = sec.rows?.map(([k, v]) => [k, germanizeDocValue(v, k)] as [string, string]);
    if (kind === "Termsheet" && ct && /indikative bewertung/i.test(sec.heading) && rows && !rows.some(([k]) => REQUIRED_ROW.test(k))) {
      rows = [
        ...rows,
        [
          "Anfänglicher Marktwert (Kundensicht)",
          `${fmtMoney(ct.initialMarketValue, report.reportingCurrency)} · Bewertungstag ${fmtDate(parseISO(report.valuationDate))}`,
        ],
      ];
    }
    return {
      ...sec,
      rows,
      paragraphs: sec.paragraphs?.map(germanizeParagraph),
      table: sec.table ? { ...sec.table, rows: sec.table.rows.map((r) => r.map((c, j) => (j === 0 ? c : germanizeDocValue(c, r[0] ?? "")))) } : undefined,
    };
  });
  const out = { ...doc, sections };
  return { ...out, markdown: toMarkdown(out) };
}

const DEFAULT_INPUTS: SuitabilityInputs = {
  clientName: "",
  clientClassification: "Privatkunde",
  hedgingPurpose: "Absicherung des variabel verzinsten Betriebsmittelkredits gegen steigende Zinsen",
  knowledgeExperience: "Erfahrung mit Zinsderivaten seit 2018, mehrere Swaps abgeschlossen",
  financialSituation: "Kredit­volumen gedeckt durch laufende Erträge; keine Liquiditätsengpässe",
  riskTolerance: "mittel",
  investmentHorizonYears: 5,
  advisorName: "",
  transactionPrice: 0,
  alternativesConsidered: ["Cap", "Festzinskredit"],
};

/** Form model of the confirmation dialog (parties, master agreement, reference). */
export interface ConfirmationForm {
  bankName: string;
  bankLei: string;
  clientName: string;
  clientLei: string;
  masterAgreement: MasterAgreementRef["type"];
  masterAgreementDate: number;
  masterAgreementRef: string;
  csaRef: string;
  confirmationDate: number;
  reference: string;
}

/** Form model of the KID dialog. */
export interface KidForm {
  manufacturer: string;
  holdingPeriodYears: number;
  contact: string;
}

export const DOC_TITLES: Record<DocKind, string> = {
  Termsheet: "Termsheet",
  Geeignetheitserklaerung: "Geeignetheitserklärung (§ 64 Abs. 4 WpHG)",
  Confirmation: "Confirmation (Geschäftsbestätigung unter Rahmenvertrag)",
  KID: "Basisinformationsblatt (PRIIPs-KID)",
};

const LEI_RE = /^[A-Z0-9]{18}[0-9]{2}$/;

/** Years from the valuation date to the trade's maturity, at least one month, rounded to two decimals. */
export function defaultHoldingPeriod(trade: Trade, valuationDate: number): number {
  const years = (tradeMaturity(trade) - valuationDate) / 365.25;
  return Math.max(1 / 12, Math.round(years * 100) / 100);
}

interface Props {
  kind: DocKind;
  trade: Trade;
  pricing: PricingResult;
  report: ValuationReport;
  onClose: () => void;
}

export function DocumentsModal({ kind, trade, pricing, report, onClose }: Props) {
  const market = useStore((s) => s.market);
  const customer = useStore((s) => s.customerMode);
  const reportingCurrency = useStore((s) => s.reportingCurrency);
  const valuationDate = useStore((s) => s.valuationDate);
  const perspective = useStore((s) => reportInputsFor(s, trade.id).perspective);
  const [inputs, setInputs] = useState<SuitabilityInputs>({ ...DEFAULT_INPUTS, transactionPrice: report.costTransparency?.transactionPrice ?? 0 });
  const [generated, setGenerated] = useState<{ doc: GeneratedDocument | null; error: string | null }>({ doc: null, error: null });
  const set = (patch: Partial<SuitabilityInputs>) => setInputs((i) => ({ ...i, ...patch }));
  // Confirmation: under the client perspective the counterparty is the bank (Partei A), otherwise the client (Partei B).
  const [conf, setConf] = useState<ConfirmationForm>({
    bankName: perspective === "Kunde" ? (trade.counterparty ?? "") : "",
    bankLei: "",
    clientName: perspective === "Kunde" ? "" : (trade.counterparty ?? ""),
    clientLei: "",
    masterAgreement: "DRV",
    masterAgreementDate: trade.tradeDate ?? valuationDate,
    masterAgreementRef: "",
    csaRef: "",
    confirmationDate: valuationDate,
    reference: `CONF-${trade.id}`,
  });
  const setC = (patch: Partial<ConfirmationForm>) => setConf((c) => ({ ...c, ...patch }));
  const [kid, setKid] = useState<KidForm>({
    manufacturer: perspective === "Kunde" ? (trade.counterparty ?? "") : "",
    holdingPeriodYears: defaultHoldingPeriod(trade, valuationDate),
    contact: "",
  });
  const setK = (patch: Partial<KidForm>) => setKid((k) => ({ ...k, ...patch }));

  // Pure derivations – errors are part of the memo result, no setState during render (N-26).
  const termsheet = useMemo<{ doc: GeneratedDocument | null; error: string | null }>(() => {
    if (kind !== "Termsheet") return { doc: null, error: null };
    try {
      return { doc: polishDocument(filterForCustomer(generateTermsheet(market, trade, pricing, report), customer), kind, report), error: null };
    } catch (e) {
      return { doc: null, error: translatePricingError(e) };
    }
  }, [kind, market, trade, pricing, report, customer]);

  const confirmation = useMemo<{ doc: GeneratedDocument | null; error: string | null }>(() => {
    if (kind !== "Confirmation") return { doc: null, error: null };
    try {
      const parties: ConfirmationParties = {
        bank: { name: conf.bankName.trim() || "Bank (Partei A)", lei: conf.bankLei.trim() || undefined },
        client: { name: conf.clientName.trim() || "Kunde (Partei B)", lei: conf.clientLei.trim() || undefined },
      };
      const ma: MasterAgreementRef = {
        type: conf.masterAgreement,
        date: conf.masterAgreementDate,
        reference: conf.masterAgreementRef.trim() || undefined,
        csaReference: conf.csaRef.trim() || undefined,
      };
      const doc = generateConfirmation(trade, parties, ma, market, pricing, {
        tradeDate: trade.tradeDate,
        confirmationDate: conf.confirmationDate,
        reference: conf.reference.trim() || undefined,
      });
      return { doc: polishDocument(filterForCustomer(doc, customer), kind, report), error: null };
    } catch (e) {
      return { doc: null, error: translatePricingError(e) };
    }
  }, [kind, conf, market, trade, pricing, report, customer]);

  const kidDoc = useMemo<{ doc: GeneratedDocument | null; error: string | null }>(() => {
    if (kind !== "KID") return { doc: null, error: null };
    try {
      const scen = runScenarios(market, [trade], STANDARD_SCENARIOS, reportingCurrency).results;
      const opts: KidOptions = {
        manufacturer: kid.manufacturer.trim() || "Hersteller (Bank)",
        holdingPeriodYears: kid.holdingPeriodYears > 0 ? kid.holdingPeriodYears : undefined,
        contact: kid.contact.trim() || undefined,
        report,
        transactionPrice: report.costTransparency?.transactionPrice,
        perspective: report.costTransparency?.perspective ?? perspective,
        scenarioSet: STANDARD_SCENARIOS,
      };
      return { doc: polishDocument(filterForCustomer(generateKid(market, trade, pricing, scen, opts), customer), kind, report), error: null };
    } catch (e) {
      return { doc: null, error: translatePricingError(e) };
    }
  }, [kind, kid, market, trade, pricing, report, reportingCurrency, customer, perspective]);

  const current = kind === "Termsheet" ? termsheet : kind === "Confirmation" ? confirmation : kind === "KID" ? kidDoc : generated;
  const doc = current.doc;
  const error = current.error;

  const generate = () => {
    try {
      const scen = runScenarios(market, [trade], STANDARD_SCENARIOS, reportingCurrency).results;
      setGenerated({
        doc: polishDocument(filterForCustomer(generateSuitabilityStatement(market, trade, pricing, report, inputs, scen), customer), kind, report),
        error: null,
      });
    } catch (e) {
      setGenerated({ doc: null, error: translatePricingError(e) });
    }
  };
  const print = () => {
    document.body.classList.add("print-doc");
    const done = () => {
      document.body.classList.remove("print-doc");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    window.setTimeout(done, 2000);
  };
  const title = DOC_TITLES[kind];
  const leiIssue = (lei: string) => (lei.trim() && !LEI_RE.test(lei.trim()) ? "LEI hat 20 Zeichen (ISO 17442)" : undefined);

  return (
    <Modal
      title={title}
      onClose={onClose}
      className="doc-modal"
      width="min(960px, 94vw)"
      testId="documents-modal"
      footer={
        <div className="row" style={{ width: "100%" }}>
          <span className="muted xs">
            {doc ? `erstellt ${new Date(doc.generatedAt).toLocaleString("de-DE")}` : ""} {customer && "· Kundenansicht: interne Margen ausgeblendet"}
          </span>
          <span className="grow" />
          {doc && (
            <>
              <button className="btn" onClick={() => downloadText(`${trade.id}-${kind.toLowerCase()}.md`, doc.markdown, "text/markdown;charset=utf-8")}>
                ⤓ Markdown
              </button>
              <button className="btn primary" onClick={print} data-testid="doc-print">
                ⎙ Drucken
              </button>
            </>
          )}
        </div>
      }
    >
      {kind === "Geeignetheitserklaerung" && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Angaben zum Kunden</h3>
          <div className="form">
            <div className="field span-2">
              <label htmlFor="su-client">Kunde</label>
              <input id="su-client" value={inputs.clientName} onChange={(e) => set({ clientName: e.target.value })} placeholder="Firma / Name" />
            </div>
            <div className="field">
              <label htmlFor="su-class">Kundenklassifizierung</label>
              <select
                id="su-class"
                value={inputs.clientClassification}
                onChange={(e) => set({ clientClassification: e.target.value as SuitabilityInputs["clientClassification"] })}
              >
                {["Privatkunde", "Professioneller Kunde", "Geeignete Gegenpartei"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="su-risk">Risikotoleranz</label>
              <select id="su-risk" value={inputs.riskTolerance} onChange={(e) => set({ riskTolerance: e.target.value as SuitabilityInputs["riskTolerance"] })}>
                {["niedrig", "mittel", "hoch"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field span-2">
              <label htmlFor="su-purpose">Sicherungszweck</label>
              <input id="su-purpose" value={inputs.hedgingPurpose} onChange={(e) => set({ hedgingPurpose: e.target.value })} />
            </div>
            <div className="field span-2">
              <label htmlFor="su-know">Kenntnisse & Erfahrungen</label>
              <input id="su-know" value={inputs.knowledgeExperience} onChange={(e) => set({ knowledgeExperience: e.target.value })} />
            </div>
            <div className="field span-2">
              <label htmlFor="su-fin">Finanzielle Verhältnisse</label>
              <input id="su-fin" value={inputs.financialSituation} onChange={(e) => set({ financialSituation: e.target.value })} />
            </div>
            <div className="field">
              <label>Anlagehorizont</label>
              <NumInput
                value={inputs.investmentHorizonYears}
                step={1}
                min={0}
                unit="Jahre"
                ariaLabel="Anlagehorizont"
                onChange={(v) => set({ investmentHorizonYears: v })}
              />
            </div>
            <div className="field">
              <label htmlFor="su-adv">Berater</label>
              <input id="su-adv" value={inputs.advisorName} onChange={(e) => set({ advisorName: e.target.value })} />
            </div>
            <div className="field">
              <label>Transaktionspreis (Kunde zahlt +)</label>
              <NumInput
                value={inputs.transactionPrice}
                step={1000}
                unit={reportingCurrency}
                ariaLabel="Transaktionspreis"
                onChange={(v) => set({ transactionPrice: v })}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="su-alt">Geprüfte Alternativen (Komma-getrennt)</label>
              <input
                id="su-alt"
                value={(inputs.alternativesConsidered ?? []).join(", ")}
                onChange={(e) =>
                  set({
                    alternativesConsidered: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn primary" onClick={generate} data-testid="suitability-generate">
                Erklärung erzeugen
              </button>
            </div>
          </div>
        </div>
      )}
      {kind === "Confirmation" && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="confirmation-form">
          <h3>Parteien und Rahmenvertrag</h3>
          <div className="form">
            <div className="field">
              <label htmlFor="cf-bank">Bank (Partei A)</label>
              <input id="cf-bank" value={conf.bankName} placeholder="Firma" onChange={(e) => setC({ bankName: e.target.value })} />
            </div>
            <div className={`field ${leiIssue(conf.bankLei) ? "invalid" : ""}`}>
              <label htmlFor="cf-bank-lei">LEI Bank</label>
              <input
                id="cf-bank-lei"
                className="mono"
                value={conf.bankLei}
                placeholder="20 Zeichen"
                spellCheck={false}
                onChange={(e) => setC({ bankLei: e.target.value.toUpperCase() })}
              />
              {leiIssue(conf.bankLei) && <span className="field-msg error">{leiIssue(conf.bankLei)}</span>}
            </div>
            <div className="field">
              <label htmlFor="cf-client">Kunde (Partei B)</label>
              <input id="cf-client" value={conf.clientName} placeholder="Firma / Name" onChange={(e) => setC({ clientName: e.target.value })} />
            </div>
            <div className={`field ${leiIssue(conf.clientLei) ? "invalid" : ""}`}>
              <label htmlFor="cf-client-lei">LEI Kunde</label>
              <input
                id="cf-client-lei"
                className="mono"
                value={conf.clientLei}
                placeholder="20 Zeichen"
                spellCheck={false}
                onChange={(e) => setC({ clientLei: e.target.value.toUpperCase() })}
              />
              {leiIssue(conf.clientLei) && <span className="field-msg error">{leiIssue(conf.clientLei)}</span>}
            </div>
            <div className="field">
              <label htmlFor="cf-ma">Rahmenvertrag</label>
              <select id="cf-ma" value={conf.masterAgreement} onChange={(e) => setC({ masterAgreement: e.target.value as MasterAgreementRef["type"] })}>
                <option value="DRV">DRV (Deutscher Rahmenvertrag für Finanztermingeschäfte)</option>
                <option value="ISDA">ISDA Master Agreement</option>
              </select>
            </div>
            <div className="field">
              <label>Datum Rahmenvertrag</label>
              <DateInput value={conf.masterAgreementDate} ariaLabel="Datum Rahmenvertrag" onChange={(v) => setC({ masterAgreementDate: v })} />
            </div>
            <div className="field">
              <label htmlFor="cf-ma-ref">Referenz Rahmenvertrag</label>
              <input
                id="cf-ma-ref"
                value={conf.masterAgreementRef}
                placeholder="Vertragsnummer"
                onChange={(e) => setC({ masterAgreementRef: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="cf-csa">Besicherungsanhang / CSA</label>
              <input id="cf-csa" value={conf.csaRef} placeholder="optional" onChange={(e) => setC({ csaRef: e.target.value })} />
            </div>
            <div className="field">
              <label>Datum der Bestätigung</label>
              <DateInput value={conf.confirmationDate} ariaLabel="Datum der Bestätigung" onChange={(v) => setC({ confirmationDate: v })} />
            </div>
            <div className="field">
              <label htmlFor="cf-ref">Referenz der Bestätigung</label>
              <input id="cf-ref" className="mono" value={conf.reference} onChange={(e) => setC({ reference: e.target.value })} />
            </div>
          </div>
          <div className="muted xs" style={{ marginTop: 6 }}>
            Variable Beträge im Zahlungsplan sind indikativ (Forwards am Bewertungstag). Die Bestätigung wird live aus den Eingaben erzeugt.
          </div>
        </div>
      )}
      {kind === "KID" && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="kid-form">
          <h3>Angaben zum Basisinformationsblatt</h3>
          <div className="form">
            <div className="field span-2">
              <label htmlFor="kid-man">Hersteller (PRIIP-Hersteller)</label>
              <input id="kid-man" value={kid.manufacturer} placeholder="Bank" onChange={(e) => setK({ manufacturer: e.target.value })} />
            </div>
            <div className="field">
              <label>Empfohlene Haltedauer</label>
              <NumInput
                value={kid.holdingPeriodYears}
                step={0.5}
                min={1 / 12}
                max={50}
                digits={2}
                unit="Jahre"
                ariaLabel="Empfohlene Haltedauer"
                testId="kid-holding-period"
                onChange={(v) => setK({ holdingPeriodYears: v })}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="kid-contact">Kontakt für Beschwerden</label>
              <input id="kid-contact" value={kid.contact} placeholder="Website / E-Mail" onChange={(e) => setK({ contact: e.target.value })} />
            </div>
          </div>
          <div className="muted xs" style={{ marginTop: 6 }}>
            Performance-Szenarien (ungünstig / moderat / günstig / Stress) und Gesamtrisikoindikator aus dem Standard-Szenarioset; Kosten aus der
            Kostentransparenz des Reports (Transaktionspreis {fmtMoney(report.costTransparency?.transactionPrice ?? 0, report.reportingCurrency)}).
          </div>
        </div>
      )}
      {error && (
        <div className="warning error" role="alert">
          {error}
        </div>
      )}
      {doc && <DocumentBody doc={doc} />}
      {!doc && !error && kind === "Geeignetheitserklaerung" && <div className="empty">Angaben ausfüllen und „Erklärung erzeugen“ klicken.</div>}
    </Modal>
  );
}

/** Sections → cards; printable. */
export function DocumentBody({ doc }: { doc: GeneratedDocument }) {
  return (
    <div className="doc" data-testid="document-body">
      <div className="doc-head">
        <h1>{doc.title}</h1>
        <div className="muted small">{doc.subtitle}</div>
      </div>
      {doc.sections.map((sec) => (
        <div key={sec.heading} className="card doc-section">
          <h3>{sec.heading}</h3>
          {sec.paragraphs?.map((p, i) => (
            <p key={i} className="small">
              {p}
            </p>
          ))}
          {sec.rows && sec.rows.length > 0 && (
            <table className="grid-table">
              <tbody>
                {sec.rows.map(([k, v], i) => (
                  <tr key={`${k}-${i}`} style={{ cursor: "default" }}>
                    <td className="muted">{k}</td>
                    <td className="num">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sec.table && (
            <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    {sec.table.header.map((h, i) => (
                      <th key={`${h}-${i}`} className={i > 0 ? "num" : ""}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.table.rows.map((r, i) => (
                    <tr key={i} style={{ cursor: "default" }}>
                      {r.map((c, j) => (
                        <td key={j} className={j > 0 ? "num" : ""}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <p className="muted xs doc-disclaimer">{doc.disclaimer}</p>
    </div>
  );
}
