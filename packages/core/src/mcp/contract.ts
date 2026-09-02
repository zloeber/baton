import { DetectorSignals } from "../detect/index.js";

/** Result envelope for every MCP tool: structured data + concise text. */
export interface McpToolResult<T = unknown> {
  structured: T;
  text: string;
  isError?: boolean;
}

export interface HandoffCaptureRequest {
  work: {
    title: string;
    objective: string;
    scope?: string[];
    constraints?: string[];
    definition_of_done?: string[];
  };
  summary: {
    completed?: string[];
    current_state: string;
    why_it_matters?: string | null;
  };
  decisions?: {
    id: string;
    decision: string;
    rationale?: string | null;
    alternatives_considered?: string[];
    evidence_ids?: string[];
    made_at?: string;
  }[];
  artifacts?: {
    path: string;
    role: "modified" | "created" | "read" | "generated";
    description?: string | null;
    revision?: string | null;
    content_hash?: string | null;
    sensitive?: boolean;
  }[];
  evidence?: {
    id: string;
    type: "command" | "test" | "file" | "commit" | "url" | "human";
    claim: string;
    ref?: string | null;
    captured_at?: string;
    result?: string | null;
    digest?: string | null;
  }[];
  open_items?: {
    id: string;
    priority: "high" | "medium" | "low";
    description: string;
    suggested_action?: string | null;
    blocked_by?: string[];
    acceptance_check?: string | null;
  }[];
  risks?: { description: string; severity: "high" | "medium" | "low"; mitigation?: string | null }[];
  parent?: string | null;
  trigger?: "manual" | "threshold" | "hook" | "timeout" | "pre_compaction";
  score?: number | null;
  reasons?: string[];
}

export interface HandoffResumeBrief {
  id: string;
  title: string;
  prompt: string;
  markdown: string;
  freshness: {
    git_head_at_capture: string | null;
    git_head_now: string | null;
    stale: boolean;
  };
  stale_reasons: string[];
}

export type McpToolName =
  | "baton_status"
  | "handoff_capture"
  | "handoff_validate"
  | "handoff_ready"
  | "handoff_resume"
  | "handoff_list"
  | "handoff_fork"
  | "handoff_merge"
  | "handoff_detect";
