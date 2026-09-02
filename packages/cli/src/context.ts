import { resolve } from "node:path";
import { cwd as processCwd } from "node:process";
import {
  Config,
  ProjectStore,
  captureGitInfo,
  findProjectRoot,
  loadConfig,
} from "@threadline/core";

export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface AppContext {
  rootDir: string;
  store: ProjectStore;
  config: Config;
  gitHeadNow: () => string | null;
}

/** Resolve the project root: explicit option > nearest initialized root > cwd. */
export function resolveRoot(rootOption?: string): string {
  if (rootOption) return resolve(rootOption);
  const found = findProjectRoot(resolve(processCwd()));
  return found ?? resolve(processCwd());
}

export function loadContext(rootOption?: string): AppContext {
  const rootDir = resolveRoot(rootOption);
  return {
    rootDir,
    store: new ProjectStore(rootDir),
    config: loadConfig(rootDir),
    gitHeadNow: () => captureGitInfo(rootDir).head,
  };
}

export function requireInitialized(ctx: AppContext): void {
  if (ctx.config.project_id === undefined || ctx.config === undefined) {
    throw new CliError("project not initialized; run `threadline init` first", "USER");
  }
}
