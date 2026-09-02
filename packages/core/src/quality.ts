/**
 * Handoff quality / continuity score (spec §7).
 *
 * A handoff should be measurable before it is trusted. The score is fully
 * deterministic and auditable: same record in, same dimensions out. It
 * never gates the state machine by itself — `validate` and the readiness
 * rules remain the hard gate; the score is advisory signal surfaced to
 * humans and agents so weak handoffs are visible before they are relied on.
 *
 * Dimensions (0–100 each), mirroring the improvement plan §7:
 *   objective_clarity        objective present and substantive
 *   current_state_clarity    current_state populated
 *   decision_completeness    decisions recorded and rationaled
 *   evidence_coverage        decisions carry evidence; evidence exists
 *   artifact_coverage        changed work is referenced by artifacts
 *   failed_attempts          negative knowledge recorded when decisions exist
 *   next_action_clarity      actionable open item or completed state
 *   freshness                no stale flag recorded at last validation
 */

import { Handoff } from "./schema.js";

export interface QualityDimension {
  key: string;
  score: number;
  detail: string;
}

export interface QualityScore {
  overall: number;
  dimensions: QualityDimension[];
}

function clamp100(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Length beyond which an objective counts as "substantive" (≈ one sentence). */
const SUBSTANTIVE_LENGTH = 40;

export function scoreQuality(h: Handoff): QualityScore {
  const dimensions: QualityDimension[] = [];

  // Objective clarity.
  const objective = h.work.objective.trim();
  dimensions.push({
    key: "objective_clarity",
    score: objective.length === 0 ? 0 : objective.length >= SUBSTANTIVE_LENGTH ? 100 : 60,
    detail:
      objective.length === 0
        ? "objective missing"
        : objective.length >= SUBSTANTIVE_LENGTH
          ? "objective present and substantive"
          : "objective present but very short",
  });

  // Current-state clarity.
  const state = h.summary.current_state.trim();
  dimensions.push({
    key: "current_state_clarity",
    score: state.length === 0 ? 0 : 100,
    detail: state.length === 0 ? "current_state missing" : "current_state populated",
  });

  // Decision completeness: recorded decisions, each ideally with a rationale.
  const decisionScore =
    h.decisions.length === 0
      ? 50 // not wrong to have none, but completeness is unproven
      : clamp100(
          (h.decisions.filter((d) => d.rationale !== null && d.rationale.trim() !== "").length /
            h.decisions.length) *
            100,
        );
  dimensions.push({
    key: "decision_completeness",
    score: decisionScore,
    detail:
      h.decisions.length === 0
        ? "no decisions recorded"
        : `${h.decisions.length} decision(s), ${h.decisions.filter((d) => d.rationale).length} with rationale`,
  });

  // Evidence coverage: decisions backed by evidence; evidence exists at all.
  const backed =
    h.decisions.length === 0
      ? 0
      : h.decisions.filter((d) => d.evidence_ids.length > 0).length;
  const evidenceScore = clamp100(
    (h.decisions.length === 0 ? 0 : (backed / h.decisions.length) * 70) +
      (h.evidence.length > 0 ? 30 : 0),
  );
  dimensions.push({
    key: "evidence_coverage",
    score: evidenceScore,
    detail:
      h.decisions.length === 0
        ? "no decisions to support"
        : `${backed}/${h.decisions.length} decision(s) carry evidence, ${h.evidence.length} evidence record(s)`,
  });

  // Artifact coverage: non-read work should be visible as artifacts.
  const modifiedOrCreated = h.artifacts.filter((a) => a.role !== "read").length;
  const artifactScore = modifiedOrCreated > 0 ? 100 : h.summary.completed.length > 0 ? 40 : 60;
  dimensions.push({
    key: "artifact_coverage",
    score: artifactScore,
    detail:
      modifiedOrCreated > 0
        ? `${modifiedOrCreated} modified/created artifact(s) referenced`
        : "no modified/created artifacts referenced",
  });

  // Failed approaches: negative knowledge matters once real decisions exist.
  const avoidCount = h.failed_attempts.filter((f) => f.avoid_repeating).length;
  const failedScore =
    h.failed_attempts.length > 0
      ? 100
      : h.decisions.length >= 2
        ? 40 // enough history that absence of failures is suspicious
        : 70; // little history: nothing negative yet is acceptable
  dimensions.push({
    key: "failed_attempts",
    score: failedScore,
    detail:
      h.failed_attempts.length === 0
        ? "no failed approaches recorded"
        : `${h.failed_attempts.length} failed attempt(s), ${avoidCount} marked avoid_repeating`,
  });

  // Next-action clarity.
  const hasActionable = h.open_items.some((o) => o.suggested_action);
  const complete = h.open_items.length === 0 && h.summary.completed.length > 0;
  dimensions.push({
    key: "next_action_clarity",
    score: hasActionable ? 100 : complete ? 90 : 30,
    detail: hasActionable
      ? "open item with suggested_action present"
      : complete
        ? "work recorded complete"
        : "no actionable next step",
  });

  // Freshness: last validation block (or capture-time git head equality).
  const freshness = h.validation.freshness;
  let freshnessScore: number;
  let freshnessDetail: string;
  if (freshness === null || freshness === undefined) {
    freshnessScore = 50;
    freshnessDetail = "freshness never evaluated";
  } else if (!freshness.stale) {
    freshnessScore = 100;
    freshnessDetail = "no drift at last evaluation";
  } else {
    freshnessScore = 25;
    freshnessDetail = "drift detected at last evaluation";
  }
  dimensions.push({
    key: "freshness",
    score: freshnessScore,
    detail: freshnessDetail,
  });

  const overall = clamp100(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
  return { overall, dimensions };
}

/** One-line human summary, e.g. `continuity 93/100 (weakest: failed_attempts 40)`. */
export function formatQuality(q: QualityScore): string {
  const weakest = [...q.dimensions].sort((a, b) => a.score - b.score)[0];
  return `continuity ${q.overall}/100` + (weakest ? ` (weakest: ${weakest.key} ${weakest.score})` : "");
}
