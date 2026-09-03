import { type FastifyInstance } from "fastify";
import { type AppContext } from "../app.js";
import { responses } from "../schemas.js";

export async function registerAuditRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Querystring: { limit?: number } }>(
    "/api/audit",
    {
      schema: {
        operationId: "getAudit",
        tags: ["audit"],
        summary: "Audit-Trail (append-only, SHA-256-Hash-Kette) – Trade-Änderungen, Markt-Updates, Report-Erzeugung",
        querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5000 } } },
        response: responses(
          {
            200: {
              type: "object",
              required: ["entries", "chainValid"],
              properties: {
                entries: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      seq: { type: "integer" },
                      at: { type: "string" },
                      actor: { type: "string", description: 'Always "api" until authentication is added (see SECURITY.md)' },
                      action: { type: "string" },
                      subject: { type: "string" },
                      details: { type: "object", additionalProperties: true },
                      prevHash: { type: "string" },
                      hash: { type: "string" },
                    },
                    additionalProperties: true,
                  },
                },
                chainValid: { type: "boolean" },
                firstBroken: { type: ["integer", "null"], description: "Sequence number of the first broken entry, null when the chain is valid" },
              },
            },
          },
          400,
        ),
      },
    },
    async (req) => {
      const firstBroken = ctx.audit.verify();
      return { entries: ctx.audit.list(req.query.limit ?? 200), chainValid: firstBroken === null, firstBroken };
    },
  );
}
