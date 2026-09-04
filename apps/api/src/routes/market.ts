import { type FastifyInstance } from "fastify";
import {
  type Curve,
  type Fixing,
  type FxFixing,
  type InterpolatedCurve,
  type MarketContext,
  type RateIndex,
  type SwapConventions,
  bootstrapCurve,
  getSwapConventions,
  isBuiltInIndex,
  isPricingError,
  knownCurrencies,
  knownIndices,
  parseISO,
  toISO,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { type BootstrapBody, resolveBootstrap } from "../lib/curve-specs.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { apiErrorCode, sendError } from "../lib/errors.js";
import { withCalendarHint } from "../lib/register-validation.js";
import { type CustomCalendarJson, builtInCalendarIds } from "../lib/store.js";
import { volSurfacePlausibilityWarnings, volSurfaceProblems } from "../lib/vol-surfaces.js";
import {
  arrayResponse,
  bootstrapBodySchema,
  customCalendarRef,
  marketPutSchema,
  objectResponse,
  rateIndexRef,
  registerResponseSchema,
  responses,
  responsesWithoutBody,
  swapConventionsRef,
} from "../schemas.js";

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

/** Registered swap conventions per currency (`GET /api/market` `conventions`). */
function conventionsByCurrency(): Record<string, SwapConventions> {
  return Object.fromEntries(knownCurrencies().map((ccy) => [ccy, getSwapConventions(ccy)]));
}

/**
 * Core `INVALID_CURVE_SPEC` (or another `PricingError`) of a register call → 400 with the catalogued code; anything else
 * is re-thrown. The core's calendar hint ("register it with registerCalendar first") is rewritten to name the endpoint
 * (`POST /api/market/calendars`, Markt R8-2).
 */
function registerFailure(reply: Parameters<typeof sendError>[0], req: { id: string }, e: unknown) {
  if (!isPricingError(e)) throw e;
  return sendError(reply, req, 400, apiErrorCode(e.code, "INVALID_CURVE_SPEC"), withCalendarHint(e.message), e.details ? { details: e.details } : {});
}

/** `GET /api/market` `calendars`: built-in ids (probed against the core) plus the calendars registered through this API. */
function calendarList(ctx: AppContext): { id: string; builtIn: boolean; name?: string; holidays?: number; weekendsAreHolidays?: boolean }[] {
  return [
    ...builtInCalendarIds().map((id) => ({ id, builtIn: true })),
    ...ctx.registry.listCalendars().map((c) => ({
      id: c.id,
      builtIn: false,
      ...(c.name ? { name: c.name } : {}),
      holidays: c.holidays.length,
      weekendsAreHolidays: c.weekendsAreHolidays ?? true,
    })),
  ];
}

export async function registerMarketRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/api/market",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getMarket",
        tags: ["market"],
        summary:
          "Marktdaten-Übersicht (Bewertungstag, Herkunft, Kurven, Spots, Vol-Flächen, Fixings, Credit, registrierte Währungen/Indizes/Konventionen/Kalender)",
        response: responsesWithoutBody({
          200: {
            type: "object",
            properties: {
              valuationDate: { type: "string" },
              snapshotId: { type: "string" },
              source: {
                type: "string",
                enum: ["sample", "import"],
                description:
                  "Origin of the active market: the built-in sample market (rebuilt on a valuation-date change, runtime curves and overrides carried over) or an imported snapshot (`PUT /api/market/snapshot`; a valuation-date change rolls it – `PUT /api/market { discardImport: true }` returns to the sample market)",
              },
              meta: objectResponse("Snapshot metadata"),
              discountCurveId: objectResponse("Discount curve id per currency"),
              curves: arrayResponse("{ id, currency, nodes }[]"),
              fxSpots: objectResponse("Spot per pair"),
              swaptionVols: { type: "array", items: { type: "string" } },
              capletVols: { type: "array", items: { type: "string" } },
              fxVols: { type: "array", items: { type: "string" } },
              fixings: { type: "integer" },
              credit: objectResponse("Hazard/recovery per counterparty"),
              currencies: {
                type: "array",
                items: { type: "string" },
                description:
                  "Currencies with registered swap conventions (`knownCurrencies()` of the core: G5 plus NOK/SEK/DKK/PLN, Markt R6-5) – a curve can be bootstrapped and a swap built in each of them; a discount curve exists only for those listed in `discountCurveId`",
              },
              indices: arrayResponse(
                "Registered floating-rate indices `{ name, currency, type, tenor, dayCount, fixingCalendar, curveId }` (`knownIndices()` – built-in plus those registered with `POST /api/market/indices`)",
              ),
              conventions: objectResponse(
                "Registered swap conventions per currency (`SwapConventions`: fixed / float leg, calendar, spot lag, OIS conventions) – built-in plus those registered with `POST /api/market/conventions`",
              ),
              calendars: arrayResponse(
                "Holiday calendars an index or convention may reference: the built-in rule-based ones `{ id, builtIn: true }` (`TARGET`, `DE`, `US`, `UK`, `CH`, `JP`, `NO`, `SE`, `DK`, `PL`, `WEEKEND`; aliases such as `EUR`/`USNY`/`GBLO` resolve too) and those registered with `POST /api/market/calendars` `{ id, builtIn: false, name?, holidays: <count>, weekendsAreHolidays }`",
              ),
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
        source: ctx.market.source(),
        meta: m.meta,
        discountCurveId: m.discountCurveId,
        curves: Object.values(m.curves).map((c) => ({ id: c.id, currency: c.currency, nodes: c.nodeDates.length })),
        fxSpots: m.fxSpots,
        swaptionVols: Object.keys(m.swaptionVols ?? {}),
        capletVols: Object.keys(m.capletVols ?? {}),
        fxVols: Object.keys(m.fxVols ?? {}),
        fixings: m.fixings?.length ?? 0,
        credit: m.credit,
        currencies: knownCurrencies(),
        indices: knownIndices().map((ix) => ({
          name: ix.name,
          currency: ix.currency,
          type: ix.type,
          tenor: ix.tenor,
          dayCount: ix.dayCount,
          fixingCalendar: ix.fixingCalendar,
          curveId: ix.curveId,
        })),
        conventions: conventionsByCurrency(),
        calendars: calendarList(ctx),
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
        response: responsesWithoutBody({ 200: curveSummarySchema }, 400, 404),
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
        response: responsesWithoutBody({ 200: { type: "array", items: curveSummarySchema } }),
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
        response: responsesWithoutBody({
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
        description:
          "Bootstraps `spec` (component `CurveBuildSpec`: id, currency, projected index, quotes, optional interpolation / day count / dual-curve `discountCurveId` / `referenceCurveIds` / `turnOfYear` / `globalSweeps` / `pillarMergeToleranceDays`) against the active market and returns the curve without storing it. `spec.index` must be a registered index (`GET /api/market` lists `currencies` and `indices`; further indices are registered with `POST /api/market/indices`, further currencies with `POST /api/market/conventions`) – an unregistered name answers 422 `UNKNOWN_INDEX`. Curve ids in the spec (`discountCurveId`, `referenceCurveIds`, `otherCurveId` of basis quotes) are resolved against the market's curves.",
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
        summary: "Kurve bootstrappen und im Snapshot ersetzen (erste Kurve einer Währung wird deren Diskontkurve, `isDiscountCurve` steuert es explizit)",
        description:
          "Bootstraps the curve (`spec` = component `CurveBuildSpec`, as for `POST /api/market/bootstrap`; `spec.index` must be registered – `GET /api/market` lists `indices`, `POST /api/market/indices` registers more – else 422 `UNKNOWN_INDEX`) and stores it under `spec.id`. Discount-curve mapping (Markt R7-3, same rule as the workstation's \"+ Kurve\"): when the curve's currency has no `discountCurveId` yet – a newly registered currency such as NOK or CZK – the new curve becomes its discount curve, so swaps in that currency price without `NO_DISCOUNT_CURVE`; `isDiscountCurve: true` forces the mapping (also over an existing one), `false` suppresses it. The response reports `discountCurveSet`; `PUT /api/market { discountCurveId }` changes the mapping later. " +
          "The store remembers the spec with its quotes (`parRiskTracked: true`): `POST /api/risk/par` bumps the curve's quotes (Markt R8-3), a valuation-date change (`PUT /api/market { valuationDate }`) re-bootstraps the curve for the new date instead of dropping it (N8-01, with the discount-curve rule above re-applied – N9-03) and `GET /api/market/snapshot` exports the spec in the envelope's `quotes` so a re-import keeps par risk complete (R9-1); a sample curve id replaces that curve's quote set.",
        body: bootstrapBodySchema,
        response: responses(
          {
            200: {
              ...curveSummarySchema,
              properties: {
                ...curveSummarySchema.properties,
                mergedQuotes: arrayResponse("Quotes dropped by pillarMergeToleranceDays"),
                discountCurveSet: { type: "boolean", description: "`true` when this call set `discountCurveId[currency]` to the new curve" },
                discountCurveId: {
                  type: "string",
                  description: "Discount curve of the curve's currency after the call (absent when the currency still has none)",
                },
                parRiskTracked: {
                  type: "boolean",
                  description:
                    "`true`: the quotes are kept in the store – par risk bumps them and a valuation-date change re-bootstraps the curve (always `true` since round 8; sample and runtime curves alike)",
                },
              },
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
      const ccy = res.curve.currency;
      const setDiscount = req.body.isDiscountCurve ?? m.discountCurveId[ccy] === undefined;
      const discountCurveId = setDiscount ? { ...m.discountCurveId, [ccy]: res.curve.id } : m.discountCurveId;
      ctx.market.set({ ...m, curves: { ...m.curves, [res.curve.id]: res.curve }, discountCurveId });
      // Sample curve: quote set replaced; any other id: runtime curve remembered for rebuilds and par risk (R8-3 / N8-01).
      ctx.market.rememberCurve({ spec: req.body.spec, ...(req.body.isDiscountCurve !== undefined ? { isDiscountCurve: req.body.isDiscountCurve } : {}) });
      ctx.audit.append({
        actor: "api",
        action: "curve.replace",
        subject: res.curve.id,
        details: {
          quotes: spec.quotes.length,
          merged: res.mergedQuotes?.length ?? 0,
          parRiskTracked: true,
          discountCurveSet: setDiscount,
          snapshotId: ctx.market.snapshotId(),
        },
      });
      return {
        ...curveSummary(res.curve, valuationDate),
        mergedQuotes: datesToIso(res.mergedQuotes ?? []),
        discountCurveSet: setDiscount,
        ...(discountCurveId[ccy] ? { discountCurveId: discountCurveId[ccy] } : {}),
        parRiskTracked: true,
      };
    },
  );

  app.post<{ Body: CustomCalendarJson }>(
    "/api/market/calendars",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "registerCalendar",
        tags: ["market"],
        summary:
          "Feiertagskalender zur Laufzeit registrieren (explizite Feiertagsliste; Voraussetzung für Indizes/Konventionen einer neuen Währung mit eigenem Kalender)",
        description:
          "Registers a custom holiday calendar in the core's calendar registry (`registerCalendar(new CustomCalendar(id, holidays, weekendsAreHolidays))`, Markt R8-2) so that `POST /api/market/indices` (`fixingCalendar`) and `POST /api/market/conventions` (`calendar`) of a new currency – CZK with the Prague holidays, HUF with Budapest – can reference it instead of borrowing `TARGET`; composite ids (`CZ+TARGET`) work as for built-in calendars – at the register endpoints and in the snapshot envelope, whose pre-check substitutes pending calendars per component (N9-01), so an export with joint calendars re-imports into a fresh process. 201 for a new id, 200 when a runtime-registered calendar of the same id is replaced (indices and conventions referencing it pick the new list up on their next schedule build). Built-in calendars and their aliases (`TARGET`/`EUR`, `US`/`USNY`, `UK`/`GBLO`, `CH`, `JP`, `DE`, `NO`, `SE`, `DK`, `PL`, `WEEKEND`/`NONE`) cannot be replaced – 400 `INVALID_CURVE_SPEC` with `details.builtIn: true` – because a redefined `TARGET` would move every EUR schedule without a trace in the snapshot id; a holiday that is not a valid date (`2027-02-30`) answers 400 `INVALID_CALENDAR` with `details.problems[]` (core `validateCustomCalendar`). The register is process-wide and not part of the snapshot id; registrations are audited (`register.calendar`), listed in `GET /api/market` `calendars` and exported in the API snapshot envelope (`calendars`, ADR-027).",
        body: customCalendarRef,
        response: responses(
          {
            201: { ...registerResponseSchema("calendar"), description: "Calendar registered (new id)" },
            200: { ...registerResponseSchema("calendar"), description: "Runtime-registered calendar of the same id replaced" },
          },
          400,
        ),
      },
    },
    async (req, reply) => {
      const id = req.body.id.trim().toUpperCase();
      if (ctx.registry.isBuiltInCalendar(id)) {
        return sendError(
          reply,
          req,
          400,
          "INVALID_CURVE_SPEC",
          `${id} is a built-in calendar and cannot be replaced (every schedule on it would move without a trace in the snapshot id) – register the variant under its own id, e.g. ${id}-DESK`,
          { details: { calendar: id, builtIn: true } },
        );
      }
      let result: { calendar: CustomCalendarJson; replaced: boolean };
      try {
        result = ctx.registry.registerCalendar(req.body);
      } catch (e) {
        if (!isPricingError(e)) throw e;
        // `INVALID_CALENDAR` (core `validateCustomCalendar`: malformed holiday list) is a client input error – 400 with the catalogued code.
        return sendError(reply, req, 400, apiErrorCode(e.code, "INVALID_CURVE_SPEC"), e.message, e.details ? { details: e.details } : {});
      }
      ctx.audit.append({
        actor: "api",
        action: "register.calendar",
        subject: result.calendar.id,
        details: {
          replaced: result.replaced,
          holidays: result.calendar.holidays.length,
          definition: result.calendar as unknown as Record<string, unknown>,
          snapshotId: ctx.market.snapshotId(),
        },
      });
      return reply
        .status(result.replaced ? 200 : 201)
        .send({ registered: true, replaced: result.replaced, calendar: result.calendar, currencies: knownCurrencies(), snapshotId: ctx.market.snapshotId() });
    },
  );

  app.post<{ Body: RateIndex }>(
    "/api/market/indices",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "registerIndex",
        tags: ["market"],
        summary: "Floating-Rate-Index zur Laufzeit registrieren (weitere Währungen/Indizes ohne Codeänderung; eingebaute Indizes nicht ersetzbar)",
        description:
          "Registers a floating-rate index in the core's register (`registerRateIndex`, validated: 3-letter currency, `type`, tenor `<n>M|W|Y` for IBOR / `1D` for OIS, known day count, registered calendar, non-negative fixing lag, curve id) so that `POST /api/market/bootstrap|curves`, swap legs, builders and CSV imports accept it. 201 for a new name, 200 when a runtime-registered index of the same name is replaced. A built-in index (`isBuiltInIndex`) cannot be replaced – 400 `INVALID_CURVE_SPEC` with `details.builtIn: true` – because its definition enters every valuation without appearing in the snapshot id; register a desk variant under its own name. Invalid definitions answer 400 `INVALID_CURVE_SPEC`. The register is process-wide and not part of the snapshot id; registrations are audited (`register.index`) and exported in the API snapshot envelope (`indices`, ADR-027).",
        body: rateIndexRef,
        response: responses(
          {
            201: { ...registerResponseSchema("index"), description: "Index registered (new name)" },
            200: { ...registerResponseSchema("index"), description: "Runtime-registered index of the same name replaced" },
          },
          400,
        ),
      },
    },
    async (req, reply) => {
      if (isBuiltInIndex(req.body.name)) {
        return sendError(
          reply,
          req,
          400,
          "INVALID_CURVE_SPEC",
          `${req.body.name.toUpperCase()} is a built-in index and cannot be replaced (its definition enters every valuation without a trace in the snapshot id) – register the variant under its own name, e.g. ${req.body.name.toUpperCase()}-DESK`,
          { details: { index: req.body.name.toUpperCase(), builtIn: true } },
        );
      }
      let result: { index: RateIndex; replaced: boolean };
      try {
        result = ctx.registry.registerIndex(req.body);
      } catch (e) {
        return registerFailure(reply, req, e);
      }
      ctx.audit.append({
        actor: "api",
        action: "register.index",
        subject: result.index.name,
        details: { replaced: result.replaced, definition: result.index as unknown as Record<string, unknown>, snapshotId: ctx.market.snapshotId() },
      });
      return reply
        .status(result.replaced ? 200 : 201)
        .send({ registered: true, replaced: result.replaced, index: result.index, currencies: knownCurrencies(), snapshotId: ctx.market.snapshotId() });
    },
  );

  app.post<{ Body: SwapConventions }>(
    "/api/market/conventions",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "registerConventions",
        tags: ["market"],
        summary: "Swap-/OIS-Konventionen einer Währung registrieren (macht eine neue Währung bootstrap- und handelbar)",
        description:
          "Registers the vanilla-swap and OIS conventions of a currency (`registerSwapConventions`): afterwards the currency is listed in `GET /api/market` `currencies`, curves can be bootstrapped (`POST /api/market/curves` – the first one becomes the discount curve) and swaps, FRAs and FX trades built in it (builders, CSV import). Both indices must be registered (`POST /api/market/indices`) and belong to the currency, frequencies follow the leg pattern, day counts and calendar must be known – otherwise 400 `INVALID_CURVE_SPEC`. 201 for a new currency, 200 when existing conventions (runtime-registered or built-in) are replaced – built-in conventions may be overridden because they only shape builder defaults and bootstrap schedules, both visible in the trade / the curve nodes. Audited (`register.conventions`), exported in the API snapshot envelope (`conventions`, ADR-027).",
        body: swapConventionsRef,
        response: responses(
          {
            201: { ...registerResponseSchema("conventions"), description: "Conventions registered (new currency)" },
            200: { ...registerResponseSchema("conventions"), description: "Existing conventions of the currency replaced" },
          },
          400,
        ),
      },
    },
    async (req, reply) => {
      let result: { conventions: SwapConventions; replaced: boolean };
      try {
        result = ctx.registry.registerConventions(req.body);
      } catch (e) {
        return registerFailure(reply, req, e);
      }
      ctx.audit.append({
        actor: "api",
        action: "register.conventions",
        subject: result.conventions.currency,
        details: { replaced: result.replaced, definition: result.conventions as unknown as Record<string, unknown>, snapshotId: ctx.market.snapshotId() },
      });
      return reply.status(result.replaced ? 200 : 201).send({
        registered: true,
        replaced: result.replaced,
        conventions: result.conventions,
        currencies: knownCurrencies(),
        snapshotId: ctx.market.snapshotId(),
      });
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
      discountCurveId?: Record<string, string>;
      collateralDiscountCurveId?: Record<string, string>;
      discardImport?: boolean;
    };
  }>(
    "/api/market",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "updateMarket",
        tags: ["market"],
        summary:
          "Spots/Fixings/FX-Fixings/Spot-Daten/Fixing-Policy/Vol-Flächen/Diskontkurven-Zuordnung setzen oder Bewertungstag wechseln (Sample-Markt neu aufgebaut, Laufzeitkurven/Zuordnungen/Vol-Overrides bleiben, Beispiel-Fixings folgen dem Stichtag; importierter Snapshot wird gerollt oder mit `discardImport` verworfen; Vol-Flächen je Key ersetzt; strukturell geprüft → 400 VOL_SURFACE_INVALID)",
        description:
          "Vol surfaces are validated structurally before the market is touched (Markt R5-1): grid rows = expiries, row length = tenors / strikes, FX vectors = expiries, axes strictly increasing, finite non-negative quotes, key = `currency` / `currency-index` / `pair`. A malformed surface answers 400 `VOL_SURFACE_INVALID` with `problems[]` and leaves the market unchanged – it can no longer be stored and fail every later swaption valuation. " +
          "Structurally sound but implausible surfaces (numbers that do not fit the declared `volType` – a Lognormal cube of normal-sized numbers, a Normal surface of lognormal-sized ones – or degenerate all-zero / constant grids, Markt R6-4) are stored and answered 200 with `warnings[]` (`VOL_IMPLAUSIBLE:` per surface); every valuation reading such a surface repeats the warning. " +
          "`discountCurveId` / `collateralDiscountCurveId` (Markt R7-3) merge into the snapshot's mappings after the curves are checked: a curve id that is not in the market answers 422 `CURVE_NOT_FOUND`, a curve in another currency than its key – the currency for `discountCurveId`, the first currency of `ccy|csa` for `collateralDiscountCurveId` (N8-02) – 400 `INVALID_REQUEST`; nothing is applied on a failed check. " +
          '`valuationDate` (N8-01): in sample mode the sample market is rebuilt for the new date and the user state carried over – curves loaded through `POST /api/market/curves` are re-bootstrapped from their remembered quotes (in load order, so dependent curves find their references), `discountCurveId` / `collateralDiscountCurveId` mappings and vol surfaces set through this route are re-applied, FX fixings, spots, spot dates, credit data and the fixing policy survive, the sample fixings follow the date (`sampleFixings(valuationDate)` up to the day before, as in the workstation – Markt R7-4) while loaded fixings are kept and win per index and date. Runtime curves re-bootstrapped by the rebuild get the discount-curve rule of `POST /api/market/curves` again (N9-03): their remembered `isDiscountCurve`, or – unset – "first curve of a currency without a discount curve", so a book whose imported discount curve is discarded keeps a discount curve when a runtime curve of that currency exists (the `MARKET_STATE_DROPPED:` entry of the lost mapping names the replacement). In import mode (`GET /api/market` `source: "import"`) the imported market is rolled to the new date (`rollMarket`: constant zero curves; spots, fixings, FX fixings, vol surfaces, discount / collateral mappings, credit and the remembered `quotes` stay as imported) unless `discardImport: true` asks for the sample market; the roll drops `meta.snapshotTime` – it timestamped the imported state and would have dated EMIR field 23 before the new valuation date – and marks `meta.label` `(rolled to <date>)` (N9-02), so `GET /api/emir/valuations` reports 17:00 UTC of the new date unless `timestamp`/`asOf` say otherwise. Whatever a rebuild cannot carry over – a runtime curve that no longer bootstraps, a mapping whose curve is gone, a discarded import – is named in `warnings[]` with the prefix `MARKET_STATE_DROPPED:`; a plain date change of a sample market with runtime curves and mappings answers `warnings: []`.',
        body: marketPutSchema,
        response: responses(
          {
            200: {
              type: "object",
              properties: {
                valuationDate: { type: "string" },
                snapshotId: { type: "string" },
                source: { type: "string", enum: ["sample", "import"], description: "Origin of the market after the update (see `GET /api/market`)" },
                discountCurveId: objectResponse("Discount curve id per currency after the update"),
                collateralDiscountCurveId: objectResponse("Collateral discount curve ids keyed `${ccy}|${collateralCcy}` after the update"),
                fxSpots: objectResponse("Spot per pair"),
                fixings: arrayResponse("{ index, date, value }[]"),
                fxFixings: arrayResponse("{ pair, date, rate }[] – FX fixings for MtM-reset notionals"),
                fxSpotDates: objectResponse("ISO spot date per pair"),
                missingFixingPolicy: { type: "string", enum: ["curve", "throw"] },
                swaptionVols: { type: "array", items: { type: "string" }, description: "Keys of the swaption vol cubes now in the market" },
                capletVols: { type: "array", items: { type: "string" }, description: "Keys of the caplet vol surfaces now in the market" },
                fxVols: { type: "array", items: { type: "string" }, description: "Keys of the FX vol surfaces now in the market" },
                warnings: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "`VOL_IMPLAUSIBLE:` plausibility warnings of the surfaces just stored (empty when plausible; structural problems are a 400) and `MARKET_STATE_DROPPED:` entries of a valuation-date change / `discardImport` naming state that could not be carried over (N8-01)",
                },
              },
              additionalProperties: true,
            },
          },
          400,
          422,
        ),
      },
    },
    async (req, reply) => {
      // Structural check of the incoming surfaces first – nothing (not even a valuation-date rebuild) is applied on a bad surface.
      const problems = volSurfaceProblems(req.body);
      if (problems.length) {
        return sendError(reply, req, 400, "VOL_SURFACE_INVALID", `Vol surface(s) structurally invalid (${problems.length} problem(s)) – market unchanged`, {
          problems,
        });
      }
      // Plausibility (R6-4) is a warning, not a rejection: the surface is stored, the response and every valuation say so.
      const warnings = volSurfacePlausibilityWarnings(req.body);
      let m = ctx.market.get();
      // Discount-curve mappings (R7-3) are checked against the market *before* anything is applied.
      for (const [ccy, curveId] of Object.entries(req.body.discountCurveId ?? {})) {
        const curve = m.curves[curveId];
        if (!curve)
          return sendError(reply, req, 422, "CURVE_NOT_FOUND", `discountCurveId.${ccy}: curve ${curveId} is not in the market`, {
            details: { currency: ccy, curveId },
          });
        if (curve.currency !== ccy) {
          return sendError(reply, req, 400, "INVALID_REQUEST", `discountCurveId.${ccy}: curve ${curveId} is denominated in ${curve.currency}, not ${ccy}`, {
            details: { currency: ccy, curveId, curveCurrency: curve.currency },
          });
        }
      }
      for (const [key, curveId] of Object.entries(req.body.collateralDiscountCurveId ?? {})) {
        const curve = m.curves[curveId];
        if (!curve) {
          return sendError(reply, req, 422, "CURVE_NOT_FOUND", `collateralDiscountCurveId.${key}: curve ${curveId} is not in the market`, {
            details: { key, curveId },
          });
        }
        // N8-02: the collateral curve discounts cash flows of the key's first currency – it must be denominated in it.
        const ccy = key.split("|")[0]!;
        if (curve.currency !== ccy) {
          return sendError(
            reply,
            req,
            400,
            "INVALID_REQUEST",
            `collateralDiscountCurveId.${key}: curve ${curveId} is denominated in ${curve.currency}, not ${ccy} – a collateral discount curve must be in the currency of the cash flows it discounts`,
            { details: { key, curveId, currency: ccy, curveCurrency: curve.currency } },
          );
        }
      }
      // Valuation-date change / import discard (N8-01): the store carries the user state over and names what it could not keep.
      if (req.body.valuationDate || (req.body.discardImport && ctx.market.source() === "import")) {
        const rebuilt = ctx.market.rebuild(req.body.valuationDate ? parseISO(req.body.valuationDate) : m.valuationDate, {
          discardImport: req.body.discardImport,
        });
        m = rebuilt.market;
        warnings.push(...rebuilt.warnings);
      }
      if (req.body.discountCurveId) m = { ...m, discountCurveId: { ...m.discountCurveId, ...req.body.discountCurveId } };
      if (req.body.collateralDiscountCurveId) {
        m = { ...m, collateralDiscountCurveId: { ...(m.collateralDiscountCurveId ?? {}), ...req.body.collateralDiscountCurveId } };
      }
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
      if (vols.swaption.length + vols.caplet.length + vols.fx.length > 0) {
        // Remembered per key so a later valuation-date rebuild re-applies the overrides (N8-01).
        ctx.market.rememberVols({ swaptionVols: req.body.swaptionVols, capletVols: req.body.capletVols, fxVols: req.body.fxVols });
      }
      ctx.market.set(m);
      const snapshotId = ctx.market.snapshotId();
      ctx.audit.append({
        actor: "api",
        action: "market.update",
        subject: "market",
        details: {
          valuationDate: toISO(m.valuationDate),
          source: ctx.market.source(),
          spots: Object.keys(req.body.fxSpots ?? {}),
          fixings: req.body.fixings?.length ?? 0,
          fxFixings: req.body.fxFixings?.length ?? 0,
          discountCurveId: req.body.discountCurveId ?? {},
          collateralDiscountCurveId: req.body.collateralDiscountCurveId ?? {},
          dropped: warnings.filter((w) => w.startsWith("MARKET_STATE_DROPPED:")).length,
          snapshotId,
        },
      });
      if (vols.swaption.length + vols.caplet.length + vols.fx.length > 0) {
        ctx.audit.append({ actor: "api", action: "market.vols", subject: "market", details: { ...vols, warnings: warnings.length, snapshotId } });
      }
      return {
        valuationDate: toISO(m.valuationDate),
        snapshotId,
        source: ctx.market.source(),
        discountCurveId: m.discountCurveId,
        collateralDiscountCurveId: m.collateralDiscountCurveId ?? {},
        fxSpots: m.fxSpots,
        fixings: datesToIso(m.fixings),
        fxFixings: datesToIso(m.fxFixings ?? []),
        fxSpotDates: Object.fromEntries(Object.entries(m.fxSpotDates ?? {}).map(([k, v]) => [k, toISO(v)])),
        missingFixingPolicy: m.missingFixingPolicy ?? "curve",
        swaptionVols: Object.keys(m.swaptionVols ?? {}),
        capletVols: Object.keys(m.capletVols ?? {}),
        fxVols: Object.keys(m.fxVols ?? {}),
        warnings,
      };
    },
  );
}
