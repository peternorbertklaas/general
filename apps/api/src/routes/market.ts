import { type FastifyInstance } from "fastify";
import {
  type BootstrapSpec,
  type Curve,
  type Fixing,
  type InterpolatedCurve,
  bootstrapCurve,
  parseISO,
  toISO,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";

function curveSummary(c: Curve, valuationDate: number) {
  const ic = c as InterpolatedCurve;
  const nodes = c.nodeDates.map((d) => ({
    date: toISO(d),
    years: (d - valuationDate) / 365.25,
    zero: c.zeroRate(d),
    df: c.df(d),
  }));
  // 6M forward rates on an annual grid for charting
  const forwards: { date: string; years: number; forward6M: number }[] = [];
  for (let y = 0.5; y <= 30; y += 0.5) {
    const d = valuationDate + Math.round(y * 365.25);
    const d2 = d + 182;
    forwards.push({ date: toISO(d), years: y, forward6M: c.forwardRate(d, d2, "ACT/360") });
  }
  return {
    id: c.id,
    currency: c.currency,
    dayCount: c.dayCount,
    interpolation: ic.interpolation,
    meta: ic.meta,
    referenceDate: toISO(c.referenceDate),
    nodes,
    forwards,
  };
}

export async function registerMarketRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/market", { schema: { tags: ["market"], summary: "Marktdaten-Snapshot" } }, async () => {
    const m = ctx.market.get();
    return {
      valuationDate: toISO(m.valuationDate),
      meta: m.meta,
      discountCurveId: m.discountCurveId,
      curves: Object.values(m.curves).map((c) => ({ id: c.id, currency: c.currency, nodes: c.nodeDates.length })),
      fxSpots: m.fxSpots,
      swaptionVols: Object.keys(m.swaptionVols ?? {}),
      capletVols: Object.keys(m.capletVols ?? {}),
      fxVols: Object.keys(m.fxVols ?? {}),
      fixings: m.fixings?.length ?? 0,
      credit: m.credit,
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/market/curves/:id",
    { schema: { tags: ["market"], summary: "Kurve mit Pillars, Zero-Rates und Forwards" } },
    async (req, reply) => {
      const m = ctx.market.get();
      const c = m.curves[req.params.id];
      if (!c) return reply.status(404).send({ error: `Curve ${req.params.id} not found` });
      return curveSummary(c, m.valuationDate);
    },
  );

  app.get("/api/market/curves", { schema: { tags: ["market"], summary: "Alle Kurven" } }, async () => {
    const m = ctx.market.get();
    return Object.values(m.curves).map((c) => curveSummary(c, m.valuationDate));
  });

  app.get("/api/market/vols", { schema: { tags: ["market"], summary: "Volatilitätsflächen" } }, async () => {
    const m = ctx.market.get();
    return { swaption: m.swaptionVols ?? {}, caplet: m.capletVols ?? {}, fx: m.fxVols ?? {} };
  });

  app.post<{ Body: { valuationDate?: string; spec: Omit<BootstrapSpec, "discountCurve"> & { discountCurveId?: string } } }>(
    "/api/market/bootstrap",
    { schema: { tags: ["market"], summary: "Kurve aus Quotes bootstrappen (ohne Speichern)" } },
    async (req) => {
      const m = ctx.market.get();
      const val = req.body.valuationDate ? parseISO(req.body.valuationDate) : m.valuationDate;
      const { discountCurveId, ...rest } = req.body.spec;
      const disc = discountCurveId ? (m.curves[discountCurveId] as InterpolatedCurve | undefined) : undefined;
      const res = bootstrapCurve(val, { ...rest, discountCurve: disc });
      return {
        curve: curveSummary(res.curve, val),
        residuals: datesToIso(res.residuals.map((r) => ({ ...r, maturity: r.maturity }))),
      };
    },
  );

  app.post<{ Body: { valuationDate?: string; spec: Omit<BootstrapSpec, "discountCurve"> & { discountCurveId?: string } } }>(
    "/api/market/curves",
    { schema: { tags: ["market"], summary: "Kurve bootstrappen und im Snapshot ersetzen" } },
    async (req) => {
      const m = ctx.market.get();
      const val = req.body.valuationDate ? parseISO(req.body.valuationDate) : m.valuationDate;
      const { discountCurveId, ...rest } = req.body.spec;
      const disc = discountCurveId ? (m.curves[discountCurveId] as InterpolatedCurve | undefined) : undefined;
      const res = bootstrapCurve(val, { ...rest, discountCurve: disc });
      ctx.market.set({ ...m, curves: { ...m.curves, [res.curve.id]: res.curve } });
      return curveSummary(res.curve, val);
    },
  );

  app.put<{ Body: { fxSpots?: Record<string, number>; fixings?: { index: string; date: string; value: number }[]; valuationDate?: string } }>(
    "/api/market",
    { schema: { tags: ["market"], summary: "Spots/Fixings setzen oder Bewertungstag wechseln (Sample-Markt wird neu aufgebaut)" } },
    async (req) => {
      let m = ctx.market.get();
      if (req.body.valuationDate) m = ctx.market.rebuild(parseISO(req.body.valuationDate));
      if (req.body.fxSpots) m = { ...m, fxSpots: { ...m.fxSpots, ...req.body.fxSpots } };
      if (req.body.fixings) {
        const fixings = datesToSerial(req.body.fixings) as unknown as Fixing[];
        m = { ...m, fixings: [...(m.fixings ?? []), ...fixings] };
      }
      ctx.market.set(m);
      return { valuationDate: toISO(m.valuationDate), fxSpots: m.fxSpots, fixings: datesToIso(m.fixings) };
    },
  );
}
