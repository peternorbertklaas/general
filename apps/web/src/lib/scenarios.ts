import { type CurveShift, type ScenarioDefinition } from "@deriva/pricing-core";

/** Form model of the "Eigenes Szenario" editor (all shifts in market units). */
export interface CustomScenarioForm {
  name: string;
  /** Parallel shift of all curves in bp. */
  parallelBp: number;
  /** Short-end shift (0y) in bp – linearly interpolated to `longBp` at 30y. */
  shortBp: number;
  /** Long-end shift (30y) in bp. */
  longBp: number;
  /** EUR appreciation vs. all other currencies in %. */
  fxPct: number;
  /** IR normal vol shift in bp. */
  irVolBp: number;
  /** Roll forward in calendar days. */
  daysForward: number;
}

export const EMPTY_SCENARIO_FORM: CustomScenarioForm = { name: "", parallelBp: 0, shortBp: 0, longBp: 0, fxPct: 0, irVolBp: 0, daysForward: 0 };

/** Build a core `ScenarioDefinition` from the editor form; zero fields are omitted. */
export function buildCustomScenario(
  f: CustomScenarioForm,
  id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
): ScenarioDefinition {
  const curveShifts: CurveShift[] = [];
  if (f.parallelBp) curveShifts.push({ target: "*", parallelBp: f.parallelBp });
  if (f.shortBp || f.longBp)
    curveShifts.push({
      target: "*",
      tenorBp: [
        { years: 0, bp: f.shortBp },
        { years: 30, bp: f.longBp },
      ],
    });
  const sc: ScenarioDefinition = { id, name: f.name.trim() || "Eigenes Szenario", description: describeScenario(f), curveShifts };
  if (f.fxPct) sc.fxShiftsPct = { EUR: f.fxPct };
  if (f.irVolBp) sc.irVolShiftBp = f.irVolBp;
  if (f.daysForward) sc.daysForward = f.daysForward;
  return sc;
}

export function describeScenario(f: CustomScenarioForm): string {
  const sign = (v: number) => `${v > 0 ? "+" : ""}${v}`;
  const parts: string[] = [];
  if (f.parallelBp) parts.push(`parallel ${sign(f.parallelBp)} bp`);
  if (f.shortBp || f.longBp) parts.push(`0y ${sign(f.shortBp)} bp → 30y ${sign(f.longBp)} bp`);
  if (f.fxPct) parts.push(`EUR ${sign(f.fxPct)} %`);
  if (f.irVolBp) parts.push(`IR-Vol ${sign(f.irVolBp)} bp`);
  if (f.daysForward) parts.push(`+${f.daysForward} Tage`);
  return parts.length ? parts.join(" · ") : "keine Verschiebung";
}
