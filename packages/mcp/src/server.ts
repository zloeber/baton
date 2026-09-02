#!/usr/bin/env node
/**
 * Threadline MCP server (spec §13): stdio transport, nine tools wrapping
 * @threadline/core. Writes are local project writes only; no generic shell
 * execution tool is exposed.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { McpToolName } from "./contract.js";
import * as tools from "./tools.js";

const ROOT_INPUT = { root: z.string().min(1).describe("Absolute project root directory") } as const;

const ToolSchemas: Record<McpToolName, z.ZodTypeAny> = {
  threadline_status: z.object(ROOT_INPUT),
  handoff_capture: z.object({
    ...ROOT_INPUT,
    work: z.object({
      title: z.string().min(1),
      objective: z.string().min(1),
      scope: z.array(z.string()).optional(),
      constraints: z.array(z.string()).optional(),
      definition_of_done: z.array(z.string()).optional(),
    }),
    summary: z.object({
      completed: z.array(z.string()).optional(),
      current_state: z.string().min(1),
      why_it_matters: z.string().nullable().optional(),
    }),
    decisions: z
      .array(
        z.object({
          id: z.string().optional(),
          decision: z.string().min(1),
          rationale: z.string().nullable().optional(),
          alternatives_considered: z.array(z.string()).optional(),
          evidence_ids: z.array(z.string()).optional(),
          made_at: z.string().optional(),
        }),
      )
      .optional(),
    artifacts: z
      .array(
        z.object({
          path: z.string().min(1),
          role: z.enum(["modified", "created", "read", "generated"]),
          description: z.string().nullable().optional(),
          revision: z.string().nullable().optional(),
          content_hash: z.string().nullable().optional(),
          sensitive: z.boolean().optional(),
        }),
      )
      .optional(),
    evidence: z
      .array(
        z.object({
          id: z.string().optional(),
          type: z.enum(["command", "test", "file", "commit", "url", "human"]),
          claim: z.string().min(1),
          ref: z.string().nullable().optional(),
          captured_at: z.string().optional(),
          result: z.string().nullable().optional(),
          digest: z.string().nullable().optional(),
        }),
      )
      .optional(),
    open_items: z
      .array(
        z.object({
          id: z.string().optional(),
          priority: z.enum(["high", "medium", "low"]),
          description: z.string().min(1),
          suggested_action: z.string().nullable().optional(),
          blocked_by: z.array(z.string()).optional(),
          acceptance_check: z.string().nullable().optional(),
        }),
      )
      .optional(),
    risks: z
      .array(
        z.object({
          description: z.string().min(1),
          severity: z.enum(["high", "medium", "low"]),
          mitigation: z.string().nullable().optional(),
        }),
      )
      .optional(),
    parent: z.string().nullable().optional(),
    trigger: z.enum(["manual", "threshold", "hook", "timeout", "pre_compaction"]).optional(),
    score: z.number().min(0).max(1).nullable().optional(),
    reasons: z.array(z.string()).optional(),
  }),
  handoff_validate: z.object({ ...ROOT_INPUT, id: z.string().min(1), recheck: z.boolean().optional() }),
  handoff_ready: z.object({
    ...ROOT_INPUT,
    id: z.string().min(1),
    warning_acknowledgement: z.string().optional(),
  }),
  handoff_resume: z.object({
    ...ROOT_INPUT,
    id: z.string().min(1),
    format: z.enum(["prompt", "md"]).optional(),
  }),
  handoff_list: z.object({
    ...ROOT_INPUT,
    status: z.string().optional(),
    work: z.string().optional(),
  }),
  handoff_fork: z.object({ ...ROOT_INPUT, id: z.string().min(1), label: z.string().min(1) }),
  handoff_merge: z.object({
    ...ROOT_INPUT,
    parent_ids: z.array(z.string().min(1)).min(2),
    resolution: z.object({
      title: z.string().optional(),
      objective: z.string().min(1),
      current_state: z.string().min(1),
      decision: z.string(),
    }),
  }),
  handoff_detect: z.object({
    ...ROOT_INPUT,
    signals: z
      .object({
        contextPressure: z.number().min(0).max(1).nullable().optional(),
        turnPressure: z.number().min(0).max(1).nullable().optional(),
        elapsedPressure: z.number().min(0).max(1).nullable().optional(),
        workBoundary: z.boolean().optional(),
        handoffRequest: z.boolean().optional(),
        changePressure: z.number().min(0).max(1).nullable().optional(),
        stuckSignal: z.number().min(0).max(1).nullable().optional(),
        resumeReadiness: z.number().min(0).max(1).nullable().optional(),
      })
      .optional(),
  }),
};

const TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  threadline_status: "Threadline project status: config, latest handoff, git freshness, detector availability.",
  handoff_capture: "Create a draft handoff from structured work/summary/decisions/open items/evidence. Secrets are redacted per policy; creates a draft only.",
  handoff_validate: "Run deterministic validation checks (schema, policy, artifacts, evidence, lineage). recheck only runs allowlisted commands.",
  handoff_ready: "Promote a validated handoff to ready (immutable). Warning acknowledgement required when validation warns.",
  handoff_resume: "Render a compact resume brief plus a freshness report; flags stale state prominently.",
  handoff_list: "List handoff metadata summaries. No secret-bearing evidence payload by default.",
  handoff_fork: "Fork a handoff into an immutable linked child with a branch label.",
  handoff_merge: "Merge two or more parents; requires an explicit resolution decision when decisions conflict.",
  handoff_detect: "Score normalized handoff-pressure signals; returns score/reasons/recommended action. Does not create records by default.",
};

function main(): void {
  const server = new Server(
    { name: "threadline-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (Object.keys(TOOL_DESCRIPTIONS) as McpToolName[]).map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: ToolSchemas[name] as unknown as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name as McpToolName;
    const schema = ToolSchemas[name];
    if (!schema) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    const parsed = schema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
        isError: true,
      };
    }
    const args = parsed.data as { root: string } & Record<string, unknown>;
    const ctx = tools.makeContext(args.root);
    try {
      let result;
      switch (name) {
        case "threadline_status":
          result = tools.threadlineStatus(ctx);
          break;
        case "handoff_capture":
          result = tools.handoffCapture(ctx, args as never);
          break;
        case "handoff_validate":
          result = tools.handoffValidate(ctx, args.id as string, args.recheck as boolean | undefined);
          break;
        case "handoff_ready":
          result = tools.handoffReady(ctx, args.id as string, args.warning_acknowledgement as string | undefined);
          break;
        case "handoff_resume":
          result = tools.handoffResume(ctx, args.id as string, (args.format as "prompt" | "md") ?? "prompt");
          break;
        case "handoff_list":
          result = tools.handoffList(ctx, { status: args.status as string | undefined, work: args.work as string | undefined });
          break;
        case "handoff_fork":
          result = tools.handoffFork(ctx, args.id as string, args.label as string);
          break;
        case "handoff_merge":
          result = tools.handoffMerge(ctx, args.parent_ids as string[], args.resolution as never);
          break;
        case "handoff_detect":
          result = tools.handoffDetect(ctx, (args.signals ?? {}) as never);
          break;
        default:
          return { content: [{ type: "text", text: `Unhandled tool: ${name}` }], isError: true };
      }
      return {
        content: [
          { type: "text", text: result.text },
          { type: "text", text: JSON.stringify(result.structured, null, 2) },
        ],
        isError: result.isError,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  void server.connect(transport);
}

main();
