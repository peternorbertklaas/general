import { METRIC_DEFINITIONS } from "../lib/metrics.js";

/**
 * Small Ⓘ marker with a definition tooltip (hover + keyboard focus). Uses
 * `data-tip` + CSS so it works without JavaScript and inside table headers.
 */
export function InfoTip({ text, id }: { text?: string; id?: keyof typeof METRIC_DEFINITIONS | string }) {
  const tip = text ?? (id ? METRIC_DEFINITIONS[id] : undefined);
  if (!tip) return null;
  return (
    <span className="infotip" tabIndex={0} role="note" aria-label={tip} data-tip={tip}>
      ⓘ
    </span>
  );
}

/** Label with definition tooltip, for KPI cards and table headers. */
export function Term({ children, id, text }: { children: React.ReactNode; id?: string; text?: string }) {
  return (
    <span className="term">
      {children} <InfoTip id={id} text={text} />
    </span>
  );
}
