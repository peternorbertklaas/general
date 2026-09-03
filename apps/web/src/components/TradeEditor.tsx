import { type FixedLeg, type FloatLeg, type SwapLeg, type Trade, parseISO, toISO } from "@deriva/pricing-core";

interface Props {
  trade: Trade;
  onChange: (t: Trade) => void;
}

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={`field ${span2 ? "span-2" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, step, pct, digits }: { value: number; onChange: (v: number) => void; step?: number; pct?: boolean; digits?: number }) {
  const shown = pct ? Number((value * 100).toFixed(digits ?? 4)) : value;
  return (
    <input
      type="number"
      step={step ?? (pct ? 0.01 : 1)}
      value={Number.isFinite(shown) ? shown : ""}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        onChange(pct ? v / 100 : v);
      }}
    />
  );
}

function DateInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="date" value={toISO(value)} onChange={(e) => e.target.value && onChange(parseISO(e.target.value))} />;
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: readonly T[] | readonly { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.v;
        const l = typeof o === "string" ? o : o.l;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

const DAYCOUNTS = ["ACT/360", "ACT/365F", "30E/360", "30/360", "ACT/ACT ISDA"] as const;
const FREQS = ["1M", "3M", "6M", "1Y", "ZC"] as const;
const INDICES = ["EURIBOR-3M", "EURIBOR-6M", "ESTR", "SOFR", "SONIA", "SARON"] as const;
const CCYS = ["EUR", "USD", "GBP", "CHF"] as const;
const PAIRS = ["EURUSD", "EURGBP", "EURCHF", "EURJPY", "USDJPY"] as const;

export function TradeEditor({ trade, onChange }: Props) {
  const upd = (patch: Partial<Trade>) => onChange({ ...trade, ...patch } as Trade);
  const common = (
    <>
      <Field label="Bezeichnung" span2>
        <input value={trade.name ?? ""} onChange={(e) => upd({ name: e.target.value })} />
      </Field>
      <Field label="Kontrahent">
        <input value={trade.counterparty ?? ""} onChange={(e) => upd({ counterparty: e.target.value })} />
      </Field>
    </>
  );

  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      const setLeg = (i: number, patch: Partial<SwapLeg>) => onChange({ ...trade, legs: trade.legs.map((l, j) => (j === i ? ({ ...l, ...patch } as SwapLeg) : l)) } as Trade);
      const setBoth = (patch: Partial<SwapLeg>) => onChange({ ...trade, legs: trade.legs.map((l) => ({ ...l, ...patch }) as SwapLeg) } as Trade);
      const leg0 = trade.legs[0]!;
      return (
        <div className="stack">
          <div className="form">
            {common}
            {trade.type === "InterestRateSwap" && (
              <>
                <Field label="Währung">
                  <Select value={leg0.currency} options={CCYS} onChange={(v) => setBoth({ currency: v })} />
                </Field>
                <Field label="Nominal">
                  <NumInput value={leg0.notional} step={100000} onChange={(v) => setBoth({ notional: v })} />
                </Field>
              </>
            )}
            <Field label="Startdatum">
              <DateInput value={leg0.effectiveDate} onChange={(v) => setBoth({ effectiveDate: v })} />
            </Field>
            <Field label="Enddatum">
              <DateInput value={leg0.terminationDate} onChange={(v) => setBoth({ terminationDate: v })} />
            </Field>
            <Field label="Collateral (CSA)">
              <Select value={(trade.collateralCurrency ?? "") as string} options={["", ...CCYS]} onChange={(v) => upd({ collateralCurrency: v || undefined })} />
            </Field>
          </div>
          {trade.legs.map((leg, i) => (
            <div key={i} className="card" style={{ padding: 10 }}>
              <h3>
                Leg {i + 1} · {leg.type === "Fixed" ? "Festzins" : `Variabel ${(leg as FloatLeg).index}`}
                <span className="right">
                  <div className="seg">
                    {(["Pay", "Receive"] as const).map((p) => (
                      <button key={p} className={leg.payReceive === p ? "active" : ""} onClick={() => setLeg(i, { payReceive: p })}>
                        {p === "Pay" ? "Zahlen" : "Erhalten"}
                      </button>
                    ))}
                  </div>
                </span>
              </h3>
              <div className="form">
                {trade.type === "CrossCurrencySwap" && (
                  <>
                    <Field label="Währung">
                      <Select value={leg.currency} options={CCYS} onChange={(v) => setLeg(i, { currency: v })} />
                    </Field>
                    <Field label="Nominal">
                      <NumInput value={leg.notional} step={100000} onChange={(v) => setLeg(i, { notional: v })} />
                    </Field>
                  </>
                )}
                {leg.type === "Fixed" ? (
                  <Field label="Festsatz %">
                    <NumInput value={(leg as FixedLeg).rate} pct step={0.005} onChange={(v) => setLeg(i, { rate: v } as Partial<FixedLeg>)} />
                  </Field>
                ) : (
                  <>
                    <Field label="Index">
                      <Select value={(leg as FloatLeg).index} options={INDICES} onChange={(v) => setLeg(i, { index: v } as Partial<FloatLeg>)} />
                    </Field>
                    <Field label="Spread bp">
                      <NumInput value={((leg as FloatLeg).spread ?? 0) * 1e4} step={1} onChange={(v) => setLeg(i, { spread: v / 1e4 } as Partial<FloatLeg>)} />
                    </Field>
                  </>
                )}
                <Field label="Frequenz">
                  <Select value={leg.frequency} options={FREQS} onChange={(v) => setLeg(i, { frequency: v })} />
                </Field>
                <Field label="Tageszählung">
                  <Select value={leg.dayCount} options={DAYCOUNTS} onChange={(v) => setLeg(i, { dayCount: v })} />
                </Field>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "CapFloor":
      return (
        <div className="form">
          {common}
          <Field label="Art">
            <Select value={trade.capFloor} options={["Cap", "Floor", "Collar"] as const} onChange={(v) => upd({ capFloor: v })} />
          </Field>
          <Field label="Position">
            <Select value={trade.payReceive} options={[{ v: "Receive" as const, l: "Long (Käufer)" }, { v: "Pay" as const, l: "Short (Verkäufer)" }]} onChange={(v) => upd({ payReceive: v })} />
          </Field>
          <Field label="Währung">
            <Select value={trade.currency} options={CCYS} onChange={(v) => upd({ currency: v })} />
          </Field>
          <Field label="Index">
            <Select value={trade.index} options={INDICES} onChange={(v) => upd({ index: v })} />
          </Field>
          <Field label="Nominal">
            <NumInput value={trade.notional} step={100000} onChange={(v) => upd({ notional: v })} />
          </Field>
          <Field label={trade.capFloor === "Floor" ? "Floor-Strike %" : "Cap-Strike %"}>
            <NumInput value={trade.strike} pct step={0.05} onChange={(v) => upd({ strike: v })} />
          </Field>
          {trade.capFloor === "Collar" && (
            <Field label="Floor-Strike %">
              <NumInput value={trade.floorStrike ?? 0} pct step={0.05} onChange={(v) => upd({ floorStrike: v })} />
            </Field>
          )}
          <Field label="Start">
            <DateInput value={trade.effectiveDate} onChange={(v) => upd({ effectiveDate: v })} />
          </Field>
          <Field label="Ende">
            <DateInput value={trade.terminationDate} onChange={(v) => upd({ terminationDate: v })} />
          </Field>
          <Field label="Frequenz">
            <Select value={trade.frequency} options={FREQS} onChange={(v) => upd({ frequency: v })} />
          </Field>
          <Field label="Modell">
            <Select value={trade.model ?? "Bachelier"} options={["Bachelier", "Black", "ShiftedBlack"] as const} onChange={(v) => upd({ model: v })} />
          </Field>
          <Field label="Vol-Override (bp, leer=Fläche)">
            <input type="number" value={trade.volOverride !== undefined ? trade.volOverride * 1e4 : ""} onChange={(e) => upd({ volOverride: e.target.value === "" ? undefined : Number(e.target.value) / 1e4 })} />
          </Field>
        </div>
      );
    case "Swaption": {
      const fixed = trade.underlying.legs.find((l): l is FixedLeg => l.type === "Fixed")!;
      const setUnderlying = (patch: Partial<SwapLeg>) => onChange({ ...trade, underlying: { ...trade.underlying, legs: trade.underlying.legs.map((l) => ({ ...l, ...patch }) as SwapLeg) } });
      return (
        <div className="form">
          {common}
          <Field label="Typ">
            <Select value={trade.payerReceiver} options={["Payer", "Receiver"] as const} onChange={(v) => onChange({ ...trade, payerReceiver: v, underlying: { ...trade.underlying, legs: trade.underlying.legs.map((l) => ({ ...l, payReceive: l.type === "Fixed" ? (v === "Payer" ? "Pay" : "Receive") : v === "Payer" ? "Receive" : "Pay" }) as SwapLeg) } })} />
          </Field>
          <Field label="Position">
            <Select value={trade.payReceive} options={[{ v: "Receive" as const, l: "Long" }, { v: "Pay" as const, l: "Short" }]} onChange={(v) => upd({ payReceive: v })} />
          </Field>
          <Field label="Verfall">
            <DateInput value={trade.expiryDate} onChange={(v) => upd({ expiryDate: v })} />
          </Field>
          <Field label="Settlement">
            <Select value={trade.settlement} options={["Physical", "Cash"] as const} onChange={(v) => upd({ settlement: v })} />
          </Field>
          <Field label="Strike %">
            <NumInput value={fixed.rate} pct step={0.005} onChange={(v) => setUnderlying({ rate: v } as Partial<FixedLeg>)} />
          </Field>
          <Field label="Nominal">
            <NumInput value={fixed.notional} step={100000} onChange={(v) => setUnderlying({ notional: v })} />
          </Field>
          <Field label="Swap-Start">
            <DateInput value={fixed.effectiveDate} onChange={(v) => setUnderlying({ effectiveDate: v })} />
          </Field>
          <Field label="Swap-Ende">
            <DateInput value={fixed.terminationDate} onChange={(v) => setUnderlying({ terminationDate: v })} />
          </Field>
          <Field label="Modell">
            <Select value={trade.model ?? "Bachelier"} options={["Bachelier", "Black", "ShiftedBlack"] as const} onChange={(v) => upd({ model: v })} />
          </Field>
          <Field label="Vol-Override (bp)">
            <input type="number" value={trade.volOverride !== undefined ? trade.volOverride * 1e4 : ""} onChange={(e) => upd({ volOverride: e.target.value === "" ? undefined : Number(e.target.value) / 1e4 })} />
          </Field>
        </div>
      );
    }
    case "FxForward":
      return (
        <div className="form">
          {common}
          <Field label="Kaufen">
            <Select value={trade.buyCurrency} options={CCYS} onChange={(v) => upd({ buyCurrency: v })} />
          </Field>
          <Field label="Betrag kaufen">
            <NumInput value={trade.buyAmount} step={10000} onChange={(v) => upd({ buyAmount: v })} />
          </Field>
          <Field label="Verkaufen">
            <Select value={trade.sellCurrency} options={CCYS} onChange={(v) => upd({ sellCurrency: v })} />
          </Field>
          <Field label="Betrag verkaufen">
            <NumInput value={trade.sellAmount} step={10000} onChange={(v) => upd({ sellAmount: v })} />
          </Field>
          <Field label="Kontraktkurs (verk./kauf)">
            <NumInput value={trade.sellAmount / trade.buyAmount} step={0.0001} onChange={(v) => upd({ sellAmount: trade.buyAmount * v })} />
          </Field>
          <Field label="Lieferung">
            <DateInput value={trade.deliveryDate} onChange={(v) => upd({ deliveryDate: v })} />
          </Field>
        </div>
      );
    case "FxOption":
      return (
        <div className="form">
          {common}
          <Field label="Paar">
            <Select value={trade.pair} options={PAIRS} onChange={(v) => upd({ pair: v })} />
          </Field>
          <Field label="Typ (auf Basis-Ccy)">
            <Select value={trade.optionType} options={["Call", "Put"] as const} onChange={(v) => upd({ optionType: v })} />
          </Field>
          <Field label="Position">
            <Select value={trade.payReceive} options={[{ v: "Receive" as const, l: "Long" }, { v: "Pay" as const, l: "Short" }]} onChange={(v) => upd({ payReceive: v })} />
          </Field>
          <Field label="Nominal (Basis)">
            <NumInput value={trade.notional} step={10000} onChange={(v) => upd({ notional: v })} />
          </Field>
          <Field label="Strike">
            <NumInput value={trade.strike} step={0.0025} onChange={(v) => upd({ strike: v })} />
          </Field>
          <Field label="Verfall">
            <DateInput value={trade.expiryDate} onChange={(v) => upd({ expiryDate: v, deliveryDate: Math.max(trade.deliveryDate, v + 2) })} />
          </Field>
          <Field label="Lieferung">
            <DateInput value={trade.deliveryDate} onChange={(v) => upd({ deliveryDate: v })} />
          </Field>
          <Field label="Barriere">
            <Select
              value={trade.barrier?.type ?? "None"}
              options={["None", "UpOut", "UpIn", "DownOut", "DownIn"] as const}
              onChange={(v) => upd({ barrier: v === "None" ? undefined : { type: v, level: trade.barrier?.level ?? Math.round(trade.strike * (v.startsWith("Up") ? 1.06 : 0.94) * 10000) / 10000 } })}
            />
          </Field>
          {trade.barrier && (
            <Field label="Barriere-Level">
              <NumInput value={trade.barrier.level} step={0.0025} onChange={(v) => upd({ barrier: { ...trade.barrier!, level: v } })} />
            </Field>
          )}
          <Field label="Vol-Override % (leer=Smile)">
            <input type="number" step={0.1} value={trade.volOverride !== undefined ? trade.volOverride * 100 : ""} onChange={(e) => upd({ volOverride: e.target.value === "" ? undefined : Number(e.target.value) / 100 })} />
          </Field>
        </div>
      );
    case "FRA":
      return (
        <div className="form">
          {common}
          <Field label="Richtung">
            <Select value={trade.payReceive} options={[{ v: "Pay" as const, l: "Fest zahlen" }, { v: "Receive" as const, l: "Fest erhalten" }]} onChange={(v) => upd({ payReceive: v })} />
          </Field>
          <Field label="Nominal">
            <NumInput value={trade.notional} step={100000} onChange={(v) => upd({ notional: v })} />
          </Field>
          <Field label="Festsatz %">
            <NumInput value={trade.fixedRate} pct step={0.005} onChange={(v) => upd({ fixedRate: v })} />
          </Field>
          <Field label="Start">
            <DateInput value={trade.startDate} onChange={(v) => upd({ startDate: v })} />
          </Field>
          <Field label="Ende">
            <DateInput value={trade.endDate} onChange={(v) => upd({ endDate: v })} />
          </Field>
        </div>
      );
    case "FxSwap":
      return <div className="muted small">FX-Swap-Editor: bitte Near-/Far-Leg als einzelne Forwards bearbeiten (v1).</div>;
  }
}
