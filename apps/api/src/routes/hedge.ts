import { type FastifyInstance } from "fastify";
import {
  type HedgeRelationship,
  type MarketContext,
  type Trade,
  deserializeMarket,
  hedgeEffectivenessReport,
  hypotheticalDerivative,
  isPricingError,
  type MarketSnapshotJson,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { apiErrorCode, sendError } from "../lib/errors.js";
import { volSurfaceProblems } from "../lib/vol-surfaces.js";
import { FREQUENCY_PATTERN, MAX_AMOUNT, arrayResponse, marketSnapshotRef, objectResponse, responses, tradeRef } from "../schemas.js";

/**
 * Valuations per trade of an effectiveness test (compute budget, N4-01): instrument and hypothetical
 * derivative at current and designation market, prospective dollar offset (2 shocks), basis test, the
 * regression set (standard parallel shocks, FX shocks 6 × 2, basis shocks 2 × 2 + discount 1 × 2) and
 * the hypothetical's par / vol solve – conservatively 40, the same class as bucketed risk.
 */
const HEDGE_EFFECTIVENESS_WEIGHT = 40;
/** Building the hypothetical derivative solves the par rate / fair forward: a handful of valuations. */
const HEDGE_HYPOTHETICAL_WEIGHT = 4;

const isoDate = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

/** Outstanding notional per period start (`{ date, notional }[]`, last entry with date ≤ period start applies). */
const notionalSchedule = {
  type: "array",
  maxItems: 1000,
  items: {
    type: "object",
    required: ["date", "notional"],
    properties: { date: isoDate, notional: { type: "number", minimum: 0, maximum: MAX_AMOUNT } },
    additionalProperties: false,
  },
} as const;

/** `HedgedItemAmortisation` – Tilgungsplan generated from the loan terms. */
const amortisationSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: {
      type: "string",
      enum: ["Linear", "Annuity", "Custom"],
      description: "Linear: equal principal instalments; Annuity: constant instalment at `loanRate`; Custom: `schedule`",
    },
    finalNotional: { type: "number", minimum: 0, maximum: MAX_AMOUNT, description: "Balloon after the last instalment (default 0)" },
    loanRate: { type: "number", minimum: -1, maximum: 1, description: "Annuity plan rate (default `hedgedItem.fixedRate`)" },
    schedule: { ...notionalSchedule, description: 'Explicit outstanding notional per period start (type "Custom")' },
    frequency: {
      type: "string",
      pattern: FREQUENCY_PATTERN,
      description:
        'Instalment frequency as upper-case tenor with count ≥ 1 ("1M", "3M", "6M", "1Y"; same pattern as trade legs, N5-04) – default: fixed-leg frequency of the currency. The implied schedule counts against the compute budget (400 TOO_MANY_PERIODS above 1200 periods).',
    },
  },
  additionalProperties: false,
} as const;

/** Mirrors `HedgeRelationship` / `HedgedItem` of the core; unknown fields are rejected (ADR-013). */
const hedgeRelationshipSchema = {
  type: "object",
  required: ["id", "name", "type", "hedgedItem", "hedgingInstrumentId", "designationDate", "method", "accountingFramework"],
  properties: {
    id: { type: "string", maxLength: 64 },
    name: { type: "string", maxLength: 200 },
    type: { type: "string", enum: ["CashFlowHedge", "FairValueHedge"] },
    hedgedItem: {
      type: "object",
      required: ["description", "currency", "notional", "kind", "effectiveDate", "maturityDate"],
      properties: {
        description: { type: "string", maxLength: 500 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        notional: { type: "number", exclusiveMinimum: 0, maximum: MAX_AMOUNT },
        kind: { type: "string", enum: ["FloatingRateLoan", "FixedRateLoan", "ForecastFxCashflow", "FxReceivable"] },
        index: { type: "string", maxLength: 32 },
        fixedRate: { type: "number", minimum: -1, maximum: 1 },
        effectiveDate: isoDate,
        maturityDate: isoDate,
        fxPair: { type: "string", pattern: "^[A-Z]{6}$" },
        amount: { type: "number", minimum: -MAX_AMOUNT, maximum: MAX_AMOUNT },
        notionalSchedule: { ...notionalSchedule, description: "Tilgungsplan: outstanding notional per period start; takes precedence over `amortisation`" },
        amortisation: amortisationSchema,
      },
      additionalProperties: false,
    },
    hedgingInstrumentId: { type: "string", maxLength: 64 },
    designationDate: isoDate,
    hedgeRatio: { type: "number", exclusiveMinimum: 0, maximum: 10 },
    method: { type: "string", enum: ["DollarOffset", "Regression", "CriticalTerms"] },
    accountingFramework: { type: "string", enum: ["IFRS9", "HGB"] },
    designation: {
      type: "string",
      enum: ["FullFairValue", "IntrinsicValue"],
      description:
        'Option designation (IFRS 9 6.5.15 / B6.5.29): "IntrinsicValue" measures effectiveness on intrinsic values and reports the time value as `costOfHedging` (OCI); default "FullFairValue"; no effect on linear instruments',
    },
  },
  additionalProperties: false,
} as const;

interface HedgeBody {
  relationship: HedgeRelationship;
  /** Hedging instrument; if omitted the trade is looked up in the store by `relationship.hedgingInstrumentId`. */
  hedgingInstrument?: Trade;
  /** Market snapshot at designation (enables retrospective test and accounting split). */
  designationSnapshot?: MarketSnapshotJson;
  reportingCurrency?: string;
  /** Freeze the hypothetical option's vol at designation (`HedgeReportOptions.freezeDesignationVol`); needs `designationSnapshot`. */
  freezeDesignationVol?: boolean;
}

export async function registerHedgeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: HedgeBody }>(
    "/api/hedge/effectiveness",
    {
      config: { marketHeader: true, computeWeight: () => HEDGE_EFFECTIVENESS_WEIGHT },
      schema: {
        operationId: "hedgeEffectiveness",
        tags: ["pricing"],
        summary: "Hedge-Accounting-Effektivitätstest (IFRS 9 / HGB § 254): hypothetisches Derivat, Critical Terms, Dollar-Offset, Regression, OCI/GuV-Split",
        body: {
          type: "object",
          required: ["relationship"],
          properties: {
            relationship: hedgeRelationshipSchema,
            hedgingInstrument: tradeRef,
            designationSnapshot: marketSnapshotRef,
            reportingCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
            freezeDesignationVol: {
              type: "boolean",
              description:
                "Freeze the volatility of a hypothetical option (cap/floor, swaption, FX option) at designation: with `designationSnapshot` the hypothetical gets a `volOverride` from the designation market's surface (FX option / swaption: smile vol at strike and expiry; cap/floor: the implied flat cap vol at the strike), so vol moves of the surface no longer create ineffectiveness (IFRS 9 B6.5.5). Default false (hypothetical revalued on the current surface); ignored without `designationSnapshot` or when the hypothetical already carries a `volOverride`. The applied vol is reported as `hypotheticalDerivative.frozenVol`.",
            },
          },
          additionalProperties: false,
        },
        response: responses(
          {
            200: {
              type: "object",
              description:
                "HedgeEffectivenessReport: critical terms, prospective / basis / cumulative dollar offset, regression (slope, r2), effective flag, IFRS 9 / HGB accounting split, cost of hedging, German summary lines.",
              properties: {
                relationshipId: { type: "string" },
                effective: { type: "boolean" },
                assessable: { type: "boolean" },
                designation: { type: "string", enum: ["FullFairValue", "IntrinsicValue"], description: "Option designation applied to the measurement" },
                costOfHedging: objectResponse(
                  "Time value of an option designated at intrinsic value (IFRS 9 6.5.15): { currency, timeValue, intrinsicValue, timeValueAtDesignation?, change? }; absent otherwise",
                ),
                hedgingInstrument: objectResponse("{ id, name?, type, pv }"),
                hypotheticalDerivative: {
                  type: "object",
                  description: "The hypothetical derivative and its PV at the valuation date – amortising items carry the notional path on both legs",
                  properties: {
                    trade: objectResponse("Hypothetical derivative as Trade (with `volOverride` when the vol was frozen)"),
                    pv: { description: "PV in reporting currency" },
                    frozenVol: {
                      description: "Decimal vol taken from the designation market when `freezeDesignationVol` applied a `volOverride`; absent otherwise",
                    },
                  },
                  additionalProperties: true,
                },
                criticalTerms: objectResponse("Critical-terms match (incl. `notionalSchedule` check for amortising items)"),
                dollarOffsetProspective: objectResponse("Prospective dollar offset (current vs. +100bp / +10 % spot)"),
                dollarOffsetBasis: objectResponse(
                  "Informational basis test when the hedged item's index differs from the instrument's: hedged item's projection curve shocked alone (+25bp); absent otherwise",
                ),
                basisScenarioIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "Single-curve basis scenarios that were part of the regression set (empty when none)",
                },
                dollarOffsetCumulative: objectResponse("Retrospective dollar offset (requires `designationSnapshot`)"),
                regression: objectResponse("{ slope, intercept, r2, n, points[] }"),
                effectiveByMethod: objectResponse("Verdict per method { DollarOffset, Regression, CriticalTerms }"),
                ifrs9: objectResponse("IFRS 9 OCI/P&L split"),
                hgb: objectResponse("HGB § 254 Einfrierungs-/Durchbuchungsmethode, Drohverlustrückstellung"),
                summary: { type: "array", items: { type: "string" } },
                warnings: { type: "array", items: { type: "string" } },
              },
              additionalProperties: true,
            },
          },
          400,
          404,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      const rel = datesToSerial(req.body.relationship);
      const instrument = req.body.hedgingInstrument ? datesToSerial(req.body.hedgingInstrument) : ctx.trades.get(rel.hedgingInstrumentId)?.trade;
      if (!instrument) return sendError(reply, req, 404, "NOT_FOUND", `Hedging instrument ${rel.hedgingInstrumentId} not found`);
      // The designation snapshot is a client-supplied market: its vol surfaces get the same structural check as an import (R5-1).
      const surfaceProblems = req.body.designationSnapshot ? volSurfaceProblems(req.body.designationSnapshot) : [];
      if (surfaceProblems.length) {
        return sendError(
          reply,
          req,
          400,
          "VOL_SURFACE_INVALID",
          `designationSnapshot: vol surface(s) structurally invalid (${surfaceProblems.length} problem(s))`,
          {
            problems: surfaceProblems,
          },
        );
      }
      let designationCtx: MarketContext | undefined;
      try {
        designationCtx = req.body.designationSnapshot ? deserializeMarket(req.body.designationSnapshot) : undefined;
      } catch (e) {
        // Structural problems of the client-supplied snapshot are input errors (400 with the core's code), as on `PUT /api/market/snapshot`.
        const code = apiErrorCode(isPricingError(e) ? e.code : undefined, "SNAPSHOT_MALFORMED");
        return sendError(reply, req, 400, code, `designationSnapshot: ${(e as Error).message}`);
      }
      const report = hedgeEffectivenessReport(ctx.market.get(), rel, instrument, {
        designationCtx,
        reportingCurrency: req.body.reportingCurrency,
        freezeDesignationVol: req.body.freezeDesignationVol,
      });
      const frozenVol = report.hypotheticalDerivative.frozenVol;
      ctx.audit.append({
        actor: "api",
        action: "hedge.test",
        subject: rel.id,
        details: {
          effective: report.effective,
          method: rel.method,
          designation: report.designation,
          basisScenarios: report.basisScenarioIds.length,
          ...(frozenVol !== undefined ? { frozenVol } : {}),
        },
      });
      return datesToIso(report);
    },
  );

  app.post<{ Body: { relationship: HedgeRelationship; hedgingInstrument?: Trade } }>(
    "/api/hedge/hypothetical",
    {
      config: { marketHeader: true, computeWeight: () => HEDGE_HYPOTHETICAL_WEIGHT },
      schema: {
        operationId: "hedgeHypothetical",
        tags: ["pricing"],
        summary: "Hypothetisches Derivat für eine Sicherungsbeziehung erzeugen",
        body: {
          type: "object",
          required: ["relationship"],
          properties: { relationship: hedgeRelationshipSchema, hedgingInstrument: tradeRef },
          additionalProperties: false,
        },
        response: responses(
          {
            200: {
              type: "object",
              description: "Hypothetical derivative as Trade (par swap / fair forward at designation)",
              properties: { id: { type: "string" }, type: { type: "string" }, legs: arrayResponse("Swap legs") },
              additionalProperties: true,
            },
          },
          400,
          404,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      const rel = datesToSerial(req.body.relationship);
      const instrument = req.body.hedgingInstrument ? datesToSerial(req.body.hedgingInstrument) : ctx.trades.get(rel.hedgingInstrumentId)?.trade;
      if (!instrument) return sendError(reply, req, 404, "NOT_FOUND", `Hedging instrument ${rel.hedgingInstrumentId} not found`);
      return datesToIso(hypotheticalDerivative(ctx.market.get(), rel, instrument));
    },
  );
}
