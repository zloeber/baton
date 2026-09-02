/**
 * @baton/adapter-generic (spec §15): the reference adapter.
 *
 * It integrates through the documented CLI surface only: `baton detect
 * --event`, checkpoint creation, and resume rendering. It never requires raw
 * messages or hidden prompts, and it never launches or terminates sessions.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  captureGitInfo,
  findProjectRoot,
  isInitialized,
  ProjectStore,
  resolveBatonDirName,
} from "@baton/core";
import type {
  AdapterEvent,
  DetectorResult,
  ProjectContext,
  SessionMetadata,
  BatonAdapter,
} from "@baton/adapter-sdk";

export interface GenericAdapterOptions {
  /** Project root; defaults to the nearest initialized root from cwd. */
  rootDir?: string;
  /** Path to the baton CLI entry (defaults to npx-able `baton`). */
  cliCommand?: string;
  cliArgs?: string[];
}

export class GenericAdapter implements BatonAdapter {
  private readonly rootDir: string;
  private readonly cli: { command: string; args: string[] };

  constructor(private readonly options: GenericAdapterOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? process.cwd());
    this.cli = {
      command: options.cliCommand ?? "node",
      args: options.cliArgs ?? [],
    };
  }

  async getProjectContext(): Promise<ProjectContext> {
    const found = findProjectRoot(this.rootDir);
    const root = found ?? this.rootDir;
    return {
      rootDir: root,
      projectId: ProjectStore.projectId(root),
      initialized: isInitialized(root),
    };
  }

  async getSessionMetadata(): Promise<SessionMetadata> {
    const git = captureGitInfo(this.rootDir);
    return {
      harness: "generic",
      sessionId: null, // opaque by policy; the CLI hashes externally supplied ids
      model: null,
      ...(git.vcs === "git" ? {} : {}),
    };
  }

  /**
   * Evaluate a normalized event through the CLI so core semantics, cooldown
   * state, and JSON contract stay identical for every integration path.
   */
  detectViaCli(event: AdapterEvent): DetectorResult & { suppress: boolean; recommendedAction: string } {
    const r = spawnSync(
      this.cli.command,
      [...this.cli.args, "--json", "detect", "--event", JSON.stringify(event)],
      { cwd: this.rootDir, encoding: "utf8" },
    );
    if (r.status !== 0 || !r.stdout) {
      throw new Error(`detect failed (exit ${r.status}): ${r.stderr}`);
    }
    return JSON.parse(r.stdout) as DetectorResult & { suppress: boolean; recommendedAction: string };
  }

  /** Render a resume brief for a handoff via the CLI. */
  resumeViaCli(id: string): string {
    const r = spawnSync(this.cli.command, [...this.cli.args, "resume", id, "--format", "prompt"], {
      cwd: this.rootDir,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`resume failed (exit ${r.status}): ${r.stderr}`);
    return r.stdout;
  }

  /** Config presence check helper used by tests. */
  hasConfig(): boolean {
    return existsSync(join(this.rootDir, resolveBatonDirName(this.rootDir), "config.json"));
  }
}
