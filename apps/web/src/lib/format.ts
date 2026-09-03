import { toISO } from "@deriva/pricing-core";

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf4 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function fmtMoney(v: number | undefined | null, ccy?: string, digits: 0 | 2 = 0): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  const s = (digits === 0 ? nf0 : nf2).format(v);
  return ccy ? `${s} ${ccy}` : s;
}

export function fmtPct(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return `${(v * 100).toFixed(digits).replace(".", ",")} %`;
}

export function fmtBp(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return `${(v * 1e4).toFixed(digits).replace(".", ",")} bp`;
}

export function fmtNum(v: number | undefined | null, digits = 4): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return digits === 4 ? nf4.format(v) : v.toFixed(digits).replace(".", ",");
}

export function fmtDate(d: number | undefined): string {
  if (d === undefined) return "–";
  const iso = toISO(d);
  const [y, m, day] = iso.split("-");
  return `${day}.${m}.${y}`;
}

export function fmtCompact(v: number, ccy?: string): string {
  if (!Number.isFinite(v)) return "–";
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1e9) s = `${(v / 1e9).toFixed(2)} Mrd`;
  else if (abs >= 1e6) s = `${(v / 1e6).toFixed(2)} Mio`;
  else if (abs >= 1e3) s = `${(v / 1e3).toFixed(1)} Tsd`;
  else s = v.toFixed(0);
  return ccy ? `${s.replace(".", ",")} ${ccy}` : s.replace(".", ",");
}

export function signClass(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v) || Math.abs(v) < 1e-9) return "";
  return v > 0 ? "pos" : "neg";
}
