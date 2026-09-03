import { useMemo, useState } from "react";
import {
  type GeneratedDocument,
  type PricingResult,
  type SuitabilityInputs,
  type Trade,
  type ValuationReport,
  STANDARD_SCENARIOS,
  generateSuitabilityStatement,
  generateTermsheet,
  parseISO,
  runScenarios,
  toMarkdown,
} from "@deriva/pricing-core";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { germanizeDocValue, germanizeParagraph, translatePricingError } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { type DocKind, useStore } from "../state/store.js";
import { Modal } from "./Modal.js";
import { NumInput } from "./NumInput.js";

export type { DocKind };

const INTERNAL_ROW = /marge|margin|ertrag der bank|bankmarge|deckungsbeitrag|interne/i;
const REQUIRED_ROW = /anfänglicher (negativer )?marktwert|initial market value/i;

/** Customer mode: drop internal margin lines but keep the legally required initial market value. */
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
  const [inputs, setInputs] = useState<SuitabilityInputs>({ ...DEFAULT_INPUTS, transactionPrice: report.costTransparency?.transactionPrice ?? 0 });
  const [generated, setGenerated] = useState<{ doc: GeneratedDocument | null; error: string | null }>({ doc: null, error: null });
  const set = (patch: Partial<SuitabilityInputs>) => setInputs((i) => ({ ...i, ...patch }));

  // Pure derivation – errors are part of the memo result, no setState during render (N-26).
  const termsheet = useMemo<{ doc: GeneratedDocument | null; error: string | null }>(() => {
    if (kind !== "Termsheet") return { doc: null, error: null };
    try {
      return { doc: polishDocument(filterForCustomer(generateTermsheet(market, trade, pricing, report), customer), kind, report), error: null };
    } catch (e) {
      return { doc: null, error: translatePricingError(e) };
    }
  }, [kind, market, trade, pricing, report, customer]);

  const doc = kind === "Termsheet" ? termsheet.doc : generated.doc;
  const error = kind === "Termsheet" ? termsheet.error : generated.error;

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
  const title = kind === "Termsheet" ? "Termsheet" : "Geeignetheitserklärung (§ 64 Abs. 4 WpHG)";

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
                {sec.rows.map(([k, v]) => (
                  <tr key={k} style={{ cursor: "default" }}>
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
                      <th key={h} className={i > 0 ? "num" : ""}>
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
