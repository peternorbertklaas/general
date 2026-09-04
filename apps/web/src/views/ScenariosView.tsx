import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { HISTORICAL_SCENARIOS, STANDARD_SCENARIOS, runScenarios, scenarioGrid } from "@deriva/pricing-core";
import { EChart, negColor, posColor } from "../components/EChart.js";
import { NumInput } from "../components/NumInput.js";
import { navRowProps, useTableNav } from "../hooks/useTableNav.js";
import { fmtCompact, fmtMoney, fmtNum, fmtSigned, signClass } from "../lib/format.js";
import { EMPTY_SCENARIO_FORM, buildCustomScenario, describeScenario, type CustomScenarioForm } from "../lib/scenarios.js";
import { LS_KEYS, readLocal, useStore, writeLocal } from "../state/store.js";

const HISTORICAL_IDS = new Set(HISTORICAL_SCENARIOS.map((s) => s.id));
import { heatBg, heatGridKeyNav } from "./MarketView.js";

const RATES = [-200, -100, -50, -25, 0, 25, 50, 100, 200];
const FX = [-10, -5, -2.5, 0, 2.5, 5, 10];

/** "Eigenes Szenario" editor – adds a ScenarioDefinition to the persisted custom list. */
function ScenarioEditor() {
  const customScenarios = useStore((s) => s.customScenarios);
  const [form, setForm] = useState<CustomScenarioForm>({ ...EMPTY_SCENARIO_FORM, name: "" });
  const set = (patch: Partial<CustomScenarioForm>) => setForm((f) => ({ ...f, ...patch }));
  const add = () => {
    const sc = buildCustomScenario(form);
    useStore.getState().addScenario(sc);
    useStore.getState().showToast(`Szenario „${sc.name}“ hinzugefügt`);
    setForm({ ...EMPTY_SCENARIO_FORM });
  };
  return (
    <div className="card" data-testid="scenario-editor">
      <h3>
        Eigenes Szenario <span className="right muted xs">{describeScenario(form)}</span>
      </h3>
      <div className="form">
        <div className="field span-2">
          <label htmlFor="sc-name">Name</label>
          <input id="sc-name" value={form.name} placeholder="z.B. Zinsschock Q4" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>Parallel</label>
          <NumInput value={form.parallelBp} unit="bp" step={5} digits={0} ariaLabel="Parallelshift" onChange={(v) => set({ parallelBp: v })} />
        </div>
        <div className="field">
          <label>Kurzes Ende (0y)</label>
          <NumInput value={form.shortBp} unit="bp" step={5} digits={0} ariaLabel="Kurzes Ende" onChange={(v) => set({ shortBp: v })} />
        </div>
        <div className="field">
          <label>Langes Ende (30y)</label>
          <NumInput value={form.longBp} unit="bp" step={5} digits={0} ariaLabel="Langes Ende" onChange={(v) => set({ longBp: v })} />
        </div>
        <div className="field">
          <label>EUR FX</label>
          <NumInput value={form.fxPct} unit="%" step={0.5} digits={1} ariaLabel="EUR FX Shift" onChange={(v) => set({ fxPct: v })} />
        </div>
        <div className="field">
          <label>IR-Vol</label>
          <NumInput value={form.irVolBp} unit="bp" step={1} digits={0} ariaLabel="IR-Vol Shift" onChange={(v) => set({ irVolBp: v })} />
        </div>
        <div className="field">
          <label>Zeit vorwärts</label>
          <NumInput
            value={form.daysForward}
            unit="Tage"
            step={1}
            min={0}
            digits={0}
            ariaLabel="Tage vorwärts"
            onChange={(v) => set({ daysForward: Math.max(0, Math.round(v)) })}
          />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn primary" onClick={add}>
            + Szenario hinzufügen
          </button>
        </div>
      </div>
      {customScenarios.length > 0 && (
        <table className="grid-table" style={{ marginTop: 10 }}>
          <tbody>
            {customScenarios.map((sc) => (
              <tr key={sc.id} style={{ cursor: "default" }}>
                <td>{sc.name}</td>
                <td className="muted xs">{sc.description}</td>
                <td className="num">
                  <button
                    className="btn ghost danger"
                    title="Szenario löschen"
                    aria-label={`Szenario ${sc.name} löschen`}
                    onClick={() => useStore.getState().removeScenario(sc.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ScenariosView() {
  const s = useStore(
    useShallow((st) => ({
      trades: st.trades,
      selectedId: st.selectedId,
      customScenarios: st.customScenarios,
      market: st.market,
      reportingCurrency: st.reportingCurrency,
      whatIf: st.whatIf,
    })),
  );
  const act = useStore.getState;
  const [scope, setScope] = useState<"portfolio" | "selected">("portfolio");
  const [fxCcy, setFxCcy] = useState("USD");
  // Historical stress episodes (core `HISTORICAL_SCENARIOS`) are opt-in and remembered locally.
  const [historical, setHistorical] = useState(() => readLocal(LS_KEYS.scenariosHistorical) === "1");
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleHistorical = () => {
    const next = !historical;
    setHistorical(next);
    writeLocal(LS_KEYS.scenariosHistorical, next ? "1" : "0");
  };
  const trades = useMemo(() => (scope === "portfolio" ? s.trades : s.trades.filter((t) => t.id === s.selectedId)), [scope, s.trades, s.selectedId]);
  const scenarios = useMemo(() => [...STANDARD_SCENARIOS, ...(historical ? HISTORICAL_SCENARIOS : []), ...s.customScenarios], [s.customScenarios, historical]);

  const out = useMemo(() => runScenarios(s.market, trades, scenarios, s.reportingCurrency), [s.market, trades, scenarios, s.reportingCurrency]);
  const grid = useMemo(() => scenarioGrid(s.market, trades, s.reportingCurrency, RATES, FX, fxCcy), [s.market, trades, s.reportingCurrency, fxCcy]);
  const maxAbs = Math.max(1, ...grid.pv.flat().map((v) => Math.abs(v - grid.base)));
  const nonBase = out.results.filter((r) => r.scenario.id !== "base");
  const isCustom = (id: string) => s.customScenarios.some((c) => c.id === id);
  const isHist = (id: string) => HISTORICAL_IDS.has(id);
  const tableNav = useTableNav({ onCopied: () => act().showToast("Zeile kopiert") });
  const tradeNav = useTableNav({
    onCopied: () => act().showToast("Zeile kopiert"),
    onFocusRow: (i) => trades[i] && act().select(trades[i]!.id),
    onEnter: (i) => {
      if (trades[i]) {
        act().select(trades[i]!.id);
        act().setView("pricing");
      }
    },
  });

  const scopeSeg = (
    <div className="seg" role="group" aria-label="Umfang">
      <button className={scope === "portfolio" ? "active" : ""} aria-pressed={scope === "portfolio"} onClick={() => setScope("portfolio")}>
        Portfolio
      </button>
      <button className={scope === "selected" ? "active" : ""} aria-pressed={scope === "selected"} onClick={() => setScope("selected")}>
        Ausgewählter Trade
      </button>
    </div>
  );

  if (s.trades.length === 0 || trades.length === 0) {
    return (
      <div className="stack">
        <div className="row">{scopeSeg}</div>
        <div className="card empty-state" data-testid="scenarios-empty">
          <div className="icon">⊞</div>
          <div className="title">{s.trades.length === 0 ? "Keine Trades im Portfolio" : "Kein Trade ausgewählt"}</div>
          <div className="muted small">
            {s.trades.length === 0 ? (
              <>
                <kbd>n</kbd> <kbd>s</kbd> legt einen Swap an, <kbd>Ctrl</kbd>+<kbd>K</kbd> öffnet die Schnelleingabe.
              </>
            ) : (
              <>
                Im Blotter (<kbd>g</kbd> <kbd>b</kbd>) mit <kbd>j</kbd>/<kbd>k</kbd> einen Trade wählen.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row wrap toolbar">
        {scopeSeg}
        <span className="muted small">FX-Schock-Währung:</span>
        <div className="seg" role="group" aria-label="FX-Schock-Währung">
          {["USD", "GBP", "CHF", "EUR"].map((c) => (
            <button key={c} className={fxCcy === c ? "active" : ""} aria-pressed={fxCcy === c} onClick={() => setFxCcy(c)}>
              {c}
            </button>
          ))}
        </div>
        <button
          className={`chip ${historical ? "active" : ""}`}
          aria-pressed={historical}
          onClick={toggleHistorical}
          data-testid="historical-toggle"
          title="Historische Stress-Episoden (Lehman 2008, Euro-Krise 2011, Covid 2020, Zinswende 2022, SNB 2015, Brexit 2016) als Szenarien ergänzen"
        >
          {historical ? "✓ " : ""}historische Stress-Tage ({HISTORICAL_SCENARIOS.length})
        </button>
        <div className="grow" />
        <span className="muted xs">Basis-PV {fmtMoney(out.base, s.reportingCurrency)}</span>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Standard- & eigene Szenarien · P&L vs. Basis</h3>
          <EChart
            className="chart tall"
            ariaLabel="P&L je Szenario"
            option={{
              grid: { left: 70, right: 20, top: 10, bottom: 60 },
              xAxis: { type: "category", data: nonBase.map((r) => r.scenario.name), axisLabel: { rotate: 35, interval: 0, hideOverlap: true } },
              yAxis: { type: "value", axisLabel: { formatter: (v: number) => fmtCompact(v) } },
              tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number, s.reportingCurrency) },
              series: [{ type: "bar", data: nonBase.map((r) => ({ value: Math.round(r.pnl), itemStyle: { color: r.pnl >= 0 ? posColor() : negColor() } })) }],
            }}
          />
        </div>
        <div className="card">
          <h3>
            Szenario-Tabelle{" "}
            <span className="right muted xs">
              <kbd>↑</kbd>/<kbd>↓</kbd> · <kbd>y</kbd> kopieren
            </span>
          </h3>
          <div className="table-scroll" style={{ maxHeight: 400 }}>
            <table className="grid-table" data-testid="scenario-table">
              <thead>
                <tr>
                  <th>Szenario</th>
                  <th className="num">PV</th>
                  <th className="num">P&L</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody onKeyDown={tableNav.onKeyDown}>
                {out.results.flatMap((r) => {
                  const hist = isHist(r.scenario.id);
                  const open = expanded === r.scenario.id;
                  const rows = [
                    <tr key={r.scenario.id} {...navRowProps()} style={{ cursor: "default" }} title={r.scenario.description} data-hist={hist || undefined}>
                      <td>
                        {hist && r.scenario.description && (
                          <button
                            type="button"
                            className="btn ghost xs"
                            aria-expanded={open}
                            aria-label={`Beschreibung ${r.scenario.name} ${open ? "ausblenden" : "anzeigen"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded(open ? null : r.scenario.id);
                            }}
                            style={{ marginRight: 4 }}
                          >
                            {open ? "▾" : "▸"}
                          </button>
                        )}
                        {r.scenario.name} {isCustom(r.scenario.id) && <span className="badge">eigen</span>}
                        {hist && (
                          <span className="badge warn" title={r.scenario.description}>
                            historisch
                          </span>
                        )}
                      </td>
                      <td className={`num ${signClass(r.total)}`}>{fmtMoney(r.total)}</td>
                      <td className={`num ${signClass(r.pnl)}`}>{fmtMoney(r.pnl)}</td>
                      <td className="num muted">{out.base !== 0 ? `${fmtNum((r.pnl / Math.abs(out.base)) * 100, 1)} %` : "–"}</td>
                    </tr>,
                  ];
                  if (open && r.scenario.description)
                    rows.push(
                      <tr key={`${r.scenario.id}-desc`} className="scenario-desc" style={{ cursor: "default" }} data-testid="scenario-description">
                        <td colSpan={4} className="muted xs">
                          {r.scenario.description}
                        </td>
                      </tr>,
                    );
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ScenarioEditor />

      <div className="card">
        <h3>
          What-if-Matrix: Zinsen (parallel) × {fxCcy}-Kurs{" "}
          <span className="right muted xs">
            Zelle = P&L vs. Basis in {s.reportingCurrency} · Klick oder <kbd>↵</kbd> setzt das What-if · Pfeiltasten navigieren
          </span>
        </h3>
        <div
          className="heat"
          style={{ gridTemplateColumns: `80px repeat(${FX.length}, 1fr)` }}
          role="grid"
          aria-label="What-if-Matrix"
          aria-rowcount={RATES.length + 1}
          aria-colcount={FX.length + 1}
          onKeyDown={heatGridKeyNav}
        >
          <div role="row" style={{ display: "contents" }}>
            <div className="head" role="columnheader" aria-label="Zinsen ↓ / FX →" />
            {FX.map((f) => (
              <div key={f} className="head mono" role="columnheader">
                {fxCcy} {fmtSigned(f, 1, "%")}
              </div>
            ))}
          </div>
          {RATES.map((r, i) => (
            <div key={r} role="row" style={{ display: "contents" }}>
              <div className="head mono" role="rowheader" style={{ textAlign: "right" }}>
                {fmtSigned(r, 0, "bp")}
              </div>
              {FX.map((f, j) => {
                const pnl = grid.pv[i]![j]! - grid.base;
                const a = Math.min(1, Math.abs(pnl) / maxAbs);
                const active = s.whatIf.ratesBp === r && s.whatIf.fxPct === (fxCcy === "EUR" ? f : -f) && r !== 0;
                return (
                  <button
                    key={f}
                    role="gridcell"
                    tabIndex={i === 0 && j === 0 ? 0 : -1}
                    aria-selected={active || undefined}
                    className={`cell ${r === 0 && f === 0 ? "base" : ""} ${active ? "active" : ""}`}
                    style={{ background: heatBg(pnl >= 0 ? "--pos" : "--neg", a) }}
                    title={`PV ${fmtMoney(grid.pv[i]![j]!, s.reportingCurrency)} · Klick: What-if Zinsen ${fmtSigned(r, 0, "bp")}, EUR ${fmtSigned(fxCcy === "EUR" ? f : -f, 1, "%")}`}
                    aria-label={`Zinsen ${fmtSigned(r, 0, "bp")}, ${fxCcy} ${fmtSigned(f, 1, "%")}: P&L ${fmtMoney(pnl, s.reportingCurrency)}`}
                    onClick={() => {
                      // The what-if FX slider shifts EUR vs. everything else; a +x % USD move ≙ −x % EUR.
                      const fxPct = fxCcy === "EUR" ? f : -f;
                      act().setWhatIf({ ratesBp: r, fxPct });
                      act().showToast(
                        r === 0 && f === 0 ? "What-if zurückgesetzt" : `What-if gesetzt: Zinsen ${fmtSigned(r, 0, "bp")}, EUR ${fmtSigned(fxPct, 1, "%")}`,
                        { action: { label: "Zurücksetzen", run: () => act().resetWhatIf() } },
                      );
                    }}
                  >
                    {fmtCompact(pnl)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>P&L je Trade (alle Szenarien)</h3>
        <div className="table-scroll" style={{ maxHeight: 360 }}>
          <table className="grid-table" role="grid" aria-label="P&L je Trade">
            <thead>
              <tr>
                <th>Trade</th>
                {nonBase.map((r) => (
                  <th key={r.scenario.id} className="num">
                    {r.scenario.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody onKeyDown={tradeNav.onKeyDown}>
              {trades.map((t, ti) => (
                <tr key={t.id} onClick={() => act().select(t.id)} className={t.id === s.selectedId ? "selected" : ""} {...navRowProps(t.id === s.selectedId)}>
                  <td className="mono ellipsis" title={t.id} style={{ maxWidth: 160 }}>
                    {t.id}
                  </td>
                  {nonBase.map((r) => {
                    const v = r.byTrade[ti]?.pnl ?? 0;
                    return (
                      <td key={r.scenario.id} className={`num ${signClass(v)}`}>
                        {fmtCompact(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
