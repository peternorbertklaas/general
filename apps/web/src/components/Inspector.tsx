import { useMemo } from "react";
import { fmtBp, fmtDate, fmtMoney, fmtNum, fmtPct, signClass } from "../lib/format.js";
import { tradeMaturity, tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { selectedTrade, useStore } from "../state/store.js";

const PCT_KEYS = new Set(["parRate", "fairSpread", "fixedRate", "forwardSwapRate", "strike", "volatility", "forwardRate", "rd", "rf", "floorStrike"]);
const SKIP = new Set(["maturity", "model", "kind", "ndf", "mtmReset", "d1", "d2"]);

export function analyticsRows(analytics: Record<string, number | string | undefined>, type: string): { k: string; v: string }[] {
  const rows: { k: string; v: string }[] = [];
  for (const [k, v] of Object.entries(analytics)) {
    if (v === undefined || SKIP.has(k)) continue;
    if (typeof v === "string") {
      rows.push({ k, v });
      continue;
    }
    if (PCT_KEYS.has(k) && !(type.startsWith("Fx") && (k === "strike" || k === "forward"))) rows.push({ k, v: k === "volatility" && Math.abs(v) < 0.05 ? fmtBp(v, 1) : fmtPct(v, 4) });
    else if (k.toLowerCase().includes("years")) rows.push({ k, v: `${v.toFixed(2)} J` });
    else if (["spot", "forward", "fairForward", "contractRate", "nearFairForward", "farFairForward"].includes(k)) rows.push({ k, v: fmtNum(v, 4) });
    else if (["premiumPct", "premiumPctBase", "marginPct"].includes(k)) rows.push({ k, v: `${v.toFixed(3)} %` });
    else if (["premiumBp", "forwardPoints", "swapPoints", "premiumPipsQuote"].includes(k)) rows.push({ k, v: v.toFixed(1) });
    else if (k === "accrualFactor") rows.push({ k, v: v.toFixed(6) });
    else rows.push({ k, v: fmtMoney(v, undefined, 0) });
  }
  return rows;
}

export const LABELS: Record<string, string> = {
  parRate: "Par-Satz",
  fairSpread: "Fairer Spread",
  fixedRate: "Festsatz",
  annuity: "Annuität",
  pvFixed: "PV Festzins",
  pvFloat: "PV Variabel",
  remainingYears: "Restlaufzeit",
  forwardSwapRate: "Forward-Swapsatz",
  strike: "Strike",
  volatility: "Volatilität",
  expiryYears: "Zeit bis Verfall",
  tenorYears: "Swap-Laufzeit",
  premiumBp: "Prämie (bp)",
  delta: "Delta",
  gamma: "Gamma",
  vega: "Vega",
  thetaPerDay: "Theta / Tag",
  underlyingPv: "PV Underlying",
  contractRate: "Kontraktkurs",
  fairForward: "Fairer Forward",
  forwardPoints: "Forward-Punkte",
  spot: "Spot",
  fxDelta: "FX-Delta (1%)",
  forward: "Forward",
  rd: "Zins Quote-Ccy",
  rf: "Zins Basis-Ccy",
  premiumQuotePerUnit: "Prämie / Einheit",
  premiumPctBase: "Prämie % Basis",
  premiumPipsQuote: "Prämie (Pips)",
  deltaBase: "Delta (Basis-Ccy)",
  deltaPct: "Delta (1% Spot)",
  rhoDomestic: "Rho Quote",
  rhoForeign: "Rho Basis",
  premiumPct: "Prämie % Nominal",
  floorStrike: "Floor-Strike",
  forwardRate: "Forward-Satz",
  accrualFactor: "Tagefaktor",
  nearFairForward: "Fair Near",
  farFairForward: "Fair Far",
  swapPoints: "Swap-Punkte",
  nearPv: "PV Near",
  farPv: "PV Far",
};

export function Inspector() {
  const trade = useStore(selectedTrade);
  const results = useStore((s) => s.results);
  const ccy = useStore((s) => s.reportingCurrency);
  const risk = useStore((s) => s.risk);
  const r = trade ? results[trade.id] : undefined;
  const rk = useMemo(() => (trade ? risk(trade.id) : undefined), [trade, risk, results]);
  if (!trade) return <div className="empty">Kein Trade ausgewählt</div>;
  const badge = tradeTypeBadge(trade.type);
  const n = tradeNotional(trade);
  return (
    <div className="stack">
      <div>
        <div className="row">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          <span className="mono small">{trade.id}</span>
        </div>
        <div style={{ fontWeight: 600, marginTop: 6 }}>{trade.name ?? trade.id}</div>
        <div className="muted small">
          {fmtMoney(n.amount, n.currency)} · bis {fmtDate(tradeMaturity(trade))} {trade.counterparty && `· ${trade.counterparty}`}
        </div>
      </div>
      <div className="kpi big">
        <span className="label">Barwert ({ccy})</span>
        <span className={`value ${signClass(r?.result?.pv)}`}>{fmtMoney(r?.result?.pv, undefined, 0)}</span>
        {r?.result?.accrued !== undefined && Math.abs(r.result.accrued) > 0.005 && <span className="sub">Stückzinsen {fmtMoney(r.result.accrued)}</span>}
      </div>
      {r?.error && <div className="warning">Fehler: {r.error}</div>}
      {r?.result?.warnings.map((w) => (
        <div key={w} className="warning">
          {w}
        </div>
      ))}
      {rk && (
        <div className="grid cols-2">
          <div className="kpi">
            <span className="label">DV01</span>
            <span className={`value ${signClass(rk.dv01)}`} style={{ fontSize: 16 }}>
              {fmtMoney(rk.dv01)}
            </span>
          </div>
          <div className="kpi">
            <span className="label">Theta 1D</span>
            <span className={`value ${signClass(rk.theta)}`} style={{ fontSize: 16 }}>
              {fmtMoney(rk.theta)}
            </span>
          </div>
          {Object.entries(rk.vega).slice(0, 1).map(([k, v]) => (
            <div className="kpi" key={k}>
              <span className="label">Vega</span>
              <span className={`value ${signClass(v)}`} style={{ fontSize: 16 }}>
                {fmtMoney(v)}
              </span>
            </div>
          ))}
          {Object.entries(rk.fxDelta).slice(0, 1).map(([k, v]) => (
            <div className="kpi" key={k}>
              <span className="label">FX Δ 1% {k.slice(0, 3)}</span>
              <span className={`value ${signClass(v)}`} style={{ fontSize: 16 }}>
                {fmtMoney(v)}
              </span>
            </div>
          ))}
        </div>
      )}
      {r?.result && (
        <table className="grid-table">
          <tbody>
            {analyticsRows(r.result.analytics, trade.type).map((row) => (
              <tr key={row.k}>
                <td className="muted">{LABELS[row.k] ?? row.k}</td>
                <td className="num">{row.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="muted xs">
        <kbd>↵</kbd> öffnen · <kbd>d</kbd> duplizieren · <kbd>f</kbd> Richtung tauschen · <kbd>⇧P</kbd> Par übernehmen
      </div>
    </div>
  );
}
