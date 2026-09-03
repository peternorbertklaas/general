import { useEffect } from "react";
import { type RiskReport } from "@deriva/pricing-core";
import { useStore } from "../state/store.js";

/**
 * Risk report of a trade for rendering: reads the store cache via a selector
 * and fills it in an effect – never writes to the store during render
 * (N-26 / arch N-09). Returns undefined until the first effect has run.
 */
export function useRisk(tradeId: string | undefined): RiskReport | undefined {
  const cached = useStore((s) => (tradeId ? s.riskCache[tradeId] : undefined));
  const market = useStore((s) => s.market);
  const ccy = useStore((s) => s.reportingCurrency);
  const results = useStore((s) => s.results);
  useEffect(() => {
    if (tradeId && !cached) useStore.getState().ensureRisk(tradeId);
  }, [tradeId, cached, market, ccy, results]);
  return cached;
}

/** Risk reports of several trades (compare view). */
export function useRisks(tradeIds: string[]): (RiskReport | undefined)[] {
  const key = tradeIds.join("|");
  const cache = useStore((s) => s.riskCache);
  const market = useStore((s) => s.market);
  const ccy = useStore((s) => s.reportingCurrency);
  const results = useStore((s) => s.results);
  useEffect(() => {
    const st = useStore.getState();
    for (const id of key.split("|").filter(Boolean)) if (!st.riskCache[id]) st.ensureRisk(id);
  }, [key, cache, market, ccy, results]);
  return tradeIds.map((id) => cache[id]);
}
