import { type FastifyInstance } from "fastify";
import {
  type BootstrapSpec,
  type Curve,
  type Fixing,
  type FxFixing,
  type InterpolatedCurve,
  type MarketContext,
  bootstrapCurve,
  parseISO,
  toISO,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { sendError } from "../lib/errors.js";
import { arrayResponse, bootstrapBodySchema, marketPutSchema, objectResponse, responses } from "../schemas.js";

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

const curveSummarySchema = {
  type: "object",
  description: "Curve with pillars (date, years, zero, df) and a 6M-forward grid for charting.",
  properties: {
    id: { type: "string" },
    currency: { type: "string" },
    dayCount: { type: "string" },
    interpolation: { type: "string" },
    meta: objectResponse("Curve metadata (source, quotes …)"),
    referenceDate: { type: "string" },
    nodes: arrayResponse("{ date, years, zero, df }[]"),
    forwards: arrayResponse("{ date, years, forward6M }[]"),
  },
  additionalProperties: true,
} as const;

const curveIdParams = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 64 } } } as const;

type BootstrapBody = {
  valuationDate?: string;
  spec: Omit<BootstrapSpec, "discountCurve" | "referenceCurves" | "turnOfYear"> & {
    discountCurveId?: string;
    referenceCurveIds?: string[];
    turnOfYear?: { date: string; bp: number; days?: number }[];
  };
};

/**
 * Resolve an API bootstrap body against the market: curve ids → curve objects
 * (all market curves are offered as references unless `referenceCurveIds`
 * narrows them, so BasisSwap/XccyBasis/FxSwapPoints quotes find their curves)
 * and ISO turn-of-year dates → serial dates. Quotes are passed through
 * untouched: a Future `start` may be an ISO date string the core resolves itself.
 */
function resolveBootstrap(m: MarketContext, body: BootstrapBody): { valuationDate: number; spec: BootstrapSpec } {
  const valuationDate = body.valuationDate ? parseISO(body.valuationDate) : m.valuationDate;
  const { discountCurveId, referenceCurveIds, turnOfYear, ...rest } = body.spec;
  const discountCurve = discountCurveId ? (m.curves[discountCurveId] as InterpolatedCurve | undefined) : undefined;
  const referenceCurves = Object.fromEntries((referenceCurveIds ?? Object.keys(m.curves)).filter((id) => m.curves[id]).map((id) => [id, m.curves[id]!]));
  return {
    valuationDate,
    spec: {
      ...rest,
      discountCurve,
      referenceCurves,
      ...(turnOfYear ? { turnOfYear: turnOfYear.map((j) => ({ ...j, date: parseISO(j.date) })) } : {}),
    },
  };
}

export async function registerMarketRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/api/market",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getMarket",
        tags: ["market"],
        summary: "Marktdaten-Übersicht (Bewertungstag, Kurven, Spots, Vol-Flächen, Fixings, Credit)",
        response: responses({
          200: {
            type: "object",
            properties: {
              valuationDate: { type: "string" },
              snapshotId: { type: "string" },
              meta: objectResponse("Snapshot metadata"),
              discountCurveId: objectResponse("Discount curve id per currency"),
              curves: arrayResponse("{ id, currency, nodes }[]"),
              fxSpots: objectResponse("Spot per pair"),
              swaptionVols: { type: "array", items: { type: "string" } },
              capletVols: { type: "array", items: { type: "string" } },
              fxVols: { type: "array", items: { type: "string" } },
              fixings: { type: "integer" },
              credit: objectResponse("Hazard/recovery per counterparty"),
            },
            additionalProperties: true,
          },
        }),
      },
    },
    async () => {
      const m = ctx.market.get();
      return {
        valuationDate: toISO(m.valuationDate),
        snapshotId: ctx.market.snapshotId(),
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
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/market/curves/:id",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getCurve",
        tags: ["market"],
        summary: "Kurve mit Pillars, Zero-Rates und Forwards",
        params: curveIdParams,
        response: responses({ 200: curveSummarySchema }, 400, 404),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const c = m.curves[req.params.id];
      if (!c) return sendError(reply, req, 404, "NOT_FOUND", `Curve ${req.params.id} not found`);
      return curveSummary(c, m.valuationDate);
    },
  );

  app.get(
    "/api/market/curves",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "listCurves",
        tags: ["market"],
        summary: "Alle Kurven",
        response: responses({ 200: { type: "array", items: curveSummarySchema } }),
      },
    },
    async () => {
      const m = ctx.market.get();
      return Object.values(m.curves).map((c) => curveSummary(c, m.valuationDate));
    },
  );

  app.get(
    "/api/market/vols",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getVols",
        tags: ["market"],
        summary: "Volatilitätsflächen",
        response: responses({
          200: {
            type: "object",
            properties: {
              swaption: objectResponse("SwaptionVolSurface per id"),
              caplet: objectResponse("CapletVolSurface per id"),
              fx: objectResponse("FxVolSurface per id"),
            },
            additionalProperties: true,
          },
        }),
      },
    },
    async () => {
      const m = ctx.market.get();
      return { swaption: m.swaptionVols ?? {}, caplet: m.capletVols ?? {}, fx: m.fxVols ?? {} };
    },
  );

  app.post<{ Body: BootstrapBody }>(
    "/api/market/bootstrap",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "bootstrapCurve",
        tags: ["market"],
        summary: "Kurve aus Quotes bootstrappen (ohne Speichern)",
        body: bootstrapBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              properties: {
                curve: curveSummarySchema,
                residuals: arrayResponse("Repricing residuals per quote { quote, maturity, residual }"),
                mergedQuotes: arrayResponse("Quotes dropped by pillarMergeToleranceDays { quote, maturity, mergedInto, residual }"),
              },
              additionalProperties: true,
            },
          },
          400,
          422,
        ),
      },
    },
    async (req) => {
      const { valuationDate, spec } = resolveBootstrap(ctx.market.get(), req.body);
      const res = bootstrapCurve(valuationDate, spec);
      return {
        curve: curveSummary(res.curve, valuationDate),
        residuals: datesToIso(res.residuals),
        mergedQuotes: datesToIso(res.mergedQuotes ?? []),
      };
    },
  );

  app.post<{ Body: BootstrapBody }>(
    "/api/market/curves",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "replaceCurve",
        tags: ["market"],
        summary: "Kurve bootstrappen und im Snapshot ersetzen",
        body: bootstrapBodySchema,
        response: responses(
          {
            200: {
              ...curveSummarySchema,
              properties: { ...curveSummarySchema.properties, mergedQuotes: arrayResponse("Quotes dropped by pillarMergeToleranceDays") },
            },
          },
          400,
          422,
        ),
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const { valuationDate, spec } = resolveBootstrap(m, req.body);
      const res = bootstrapCurve(valuationDate, spec);
      ctx.market.set({ ...m, curves: { ...m.curves, [res.curve.id]: res.curve } });
      const tracked = ctx.market.setCurveQuotes(res.curve.id, spec.quotes);
      ctx.audit.append({
        actor: "api",
        action: "curve.replace",
        subject: res.curve.id,
        details: { quotes: spec.quotes.length, merged: res.mergedQuotes?.length ?? 0, parRiskTracked: tracked, snapshotId: ctx.market.snapshotId() },
      });
      return { ...curveSummary(res.curve, valuationDate), mergedQuotes: datesToIso(res.mergedQuotes ?? []) };
    },
  );

  app.put<{
    Body: {
      fxSpots?: Record<string, number>;
      fixings?: { index: string; date: string; value: number }[];
      fxFixings?: { pair: string; date: string; rate: number }[];
      valuationDate?: string;
      fxSpotDates?: Record<string, string>;
      missingFixingPolicy?: "curve" | "throw";
      swaptionVols?: MarketContext["swaptionVols"];
      capletVols?: MarketContext["capletVols"];
      fxVols?: MarketContext["fxVols"];
    };
  }>(
    "/api/market",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "updateMarket",
        tags: ["market"],
        summary:
          "Spots/Fixings/FX-Fixings/Spot-Daten/Fixing-Policy/Vol-Flächen setzen oder Bewertungstag wechseln (Sample-Markt wird neu aufgebaut; Vol-Flächen je Key ersetzt, ohne kompletten Snapshot)",
        body: marketPutSchema,
        response: responses(
          {
            200: {
              type: "object",
              properties: {
                valuationDate: { type: "string" },
                snapshotId: { type: "string" },
                fxSpots: objectResponse("Spot per pair"),
                fixings: arrayResponse("{ index, date, value }[]"),
                fxFixings: arrayResponse("{ pair, date, rate }[] – FX fixings for MtM-reset notionals"),
                fxSpotDates: objectResponse("ISO spot date per pair"),
                missingFixingPolicy: { type: "string", enum: ["curve", "throw"] },
                swaptionVols: { type: "array", items: { type: "string" }, description: "Keys of the swaption vol cubes now in the market" },
                capletVols: { type: "array", items: { type: "string" }, description: "Keys of the caplet vol surfaces now in the market" },
                fxVols: { type: "array", items: { type: "string" }, description: "Keys of the FX vol surfaces now in the market" },
              },
              additionalProperties: true,
            },
          },
          400,
          422,
        ),
      },
    },
    async (req) => {
      let m = ctx.market.get();
      if (req.body.valuationDate) m = ctx.market.rebuild(parseISO(req.body.valuationDate));
      if (req.body.fxSpots) m = { ...m, fxSpots: { ...m.fxSpots, ...req.body.fxSpots } };
      if (req.body.fxSpotDates) {
        const fxSpotDates = Object.fromEntries(Object.entries(req.body.fxSpotDates).map(([k, v]) => [k, parseISO(v)]));
        m = { ...m, fxSpotDates: { ...(m.fxSpotDates ?? {}), ...fxSpotDates } };
      }
      if (req.body.missingFixingPolicy) m = { ...m, missingFixingPolicy: req.body.missingFixingPolicy };
      if (req.body.fixings) {
        const fixings = datesToSerial(req.body.fixings) as unknown as Fixing[];
        m = { ...m, fixings: [...(m.fixings ?? []), ...fixings] };
      }
      if (req.body.fxFixings) {
        // Append; a fixing for the same pair and date replaces the stored one (the snapshot validation rejects duplicates).
        const incoming = datesToSerial(req.body.fxFixings) as unknown as FxFixing[];
        const key = (f: FxFixing) => `${f.pair.toUpperCase()}@${f.date}`;
        const replaced = new Set(incoming.map(key));
        m = { ...m, fxFixings: [...(m.fxFixings ?? []).filter((f) => !replaced.has(key(f))), ...incoming] };
      }
      // Vol surfaces are plain data in the snapshot format – replace per key (R4-5: IPV pushes one broker surface, not the whole snapshot).
      const vols = {
        swaption: Object.keys(req.body.swaptionVols ?? {}),
        caplet: Object.keys(req.body.capletVols ?? {}),
        fx: Object.keys(req.body.fxVols ?? {}),
      };
      if (req.body.swaptionVols) m = { ...m, swaptionVols: { ...(m.swaptionVols ?? {}), ...req.body.swaptionVols } };
      if (req.body.capletVols) m = { ...m, capletVols: { ...(m.capletVols ?? {}), ...req.body.capletVols } };
      if (req.body.fxVols) m = { ...m, fxVols: { ...(m.fxVols ?? {}), ...req.body.fxVols } };
      ctx.market.set(m);
      const snapshotId = ctx.market.snapshotId();
      ctx.audit.append({
        actor: "api",
        action: "market.update",
        subject: "market",
        details: {
          valuationDate: toISO(m.valuationDate),
          spots: Object.keys(req.body.fxSpots ?? {}),
          fixings: req.body.fixings?.length ?? 0,
          fxFixings: req.body.fxFixings?.length ?? 0,
          snapshotId,
        },
      });
      if (vols.swaption.length + vols.caplet.length + vols.fx.length > 0) {
        ctx.audit.append({ actor: "api", action: "market.vols", subject: "market", details: { ...vols, snapshotId } });
      }
      return {
        valuationDate: toISO(m.valuationDate),
        snapshotId,
        fxSpots: m.fxSpots,
        fixings: datesToIso(m.fixings),
        fxFixings: datesToIso(m.fxFixings ?? []),
        fxSpotDates: Object.fromEntries(Object.entries(m.fxSpotDates ?? {}).map(([k, v]) => [k, toISO(v)])),
        missingFixingPolicy: m.missingFixingPolicy ?? "curve",
        swaptionVols: Object.keys(m.swaptionVols ?? {}),
        capletVols: Object.keys(m.capletVols ?? {}),
        fxVols: Object.keys(m.fxVols ?? {}),
      };
    },
  );
}
