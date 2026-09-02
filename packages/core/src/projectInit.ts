import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { atomicWriteJsonSync } from "./fsAtomic.js";

export const BATON_DIR = ".baton";
/** Pre-rename storage directory; discovered read-only until migrated. */
export const LEGACY_BATON_DIR = ".threadline";

/**
 * Storage-directory resolution (rename migration, spec-hermes-adapter §7):
 * prefer `.baton`; use legacy `.threadline` only when it exists and `.baton`
 * does not. New writes during the transition go to the resolved directory so
 * state never splits across both.
 */
export function resolveBatonDirName(rootDir: string): string {
  if (existsSync(join(rootDir, BATON_DIR))) return BATON_DIR;
  if (existsSync(join(rootDir, LEGACY_BATON_DIR))) return LEGACY_BATON_DIR;
  return BATON_DIR;
}

export function resolveBatonDir(rootDir: string): string {
  return join(rootDir, resolveBatonDirName(rootDir));
}

export function hasLegacyBatonDir(rootDir: string): boolean {
  return existsSync(join(rootDir, LEGACY_BATON_DIR));
}

/** Detector weights/thresholds (spec §9.2) — all tunable via config. */
export const DetectorConfigSchema = z
  .object({
    weights: z
      .object({
        explicitRequest: z.number(),
        contextPressure: z.number(),
        turnPressure: z.number(),
        elapsedPressure: z.number(),
        changePressure: z.number(),
        stuckSignal: z.number(),
        workBoundary: z.number(),
      })
      .default({
        explicitRequest: 1.0,
        contextPressure: 0.7,
        turnPressure: 0.15,
        elapsedPressure: 0.1,
        changePressure: 0.05,
        stuckSignal: 0.6,
        workBoundary: 0.25,
      }),
    recommendThreshold: z.number().default(0.7),
    autoPrepareThreshold: z.number().default(0.85),
    readinessThreshold: z.number().default(0.8),
    promptCooldownMinutes: z.number().default(20),
  })
  .passthrough();
export type DetectorConfig = z.infer<typeof DetectorConfigSchema>;

export const PolicyConfigSchema = z
  .object({
    secretPatterns: z.array(z.string()).default(defaultSecretPatterns()),
    sensitiveFilePatterns: z.array(z.string()).default(defaultSensitiveFilePatterns()),
    allowedRoots: z.array(z.string()).default([]),
    hashSessionIds: z.boolean().default(true),
  })
  .passthrough();
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export const ConfigSchema = z
  .object({
    schema_version: z.string().default("0.1"),
    project_id: z.string().default(""),
    detector: DetectorConfigSchema.default({}),
    policy: PolicyConfigSchema.default({}),
  })
  .passthrough();
export type Config = z.infer<typeof ConfigSchema>;

export function defaultSecretPatterns(): string[] {
  return [
    "(?i)(api[_-]?key|secret|password|passwd|token|bearer)\\s*[:=]\\s*\\S+",
    "-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----",
    "(?i)x-api-key\\s*[:=]\\s*\\S+",
    "(?i)authorization\\s*:\\s*\\S+",
    "(?i)(aws_access_key_id|aws_secret_access_key)\\s*[:=]\\s*\\S+",
    "ghp_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "sk-(?:proj-)?[A-Za-z0-9_-]{20,}",
    "AKIA[0-9A-Z]{16}",
  ];
}

export function defaultSensitiveFilePatterns(): string[] {
  return ["\\.env(\\.|$)", "credentials", "\\.pem$", "id_rsa", "\\.secret", "secrets\\."];
}

export function defaultConfig(): Config {
  return ConfigSchema.parse({
    schema_version: "0.1",
    project_id: "",
    detector: {},
    policy: {},
  });
}

export const STARTER_IGNORE_POLICY = [
  "# Baton starter policy: paths never captured as artifacts/evidence.",
  "# Patterns are regular expressions matched against project-relative paths.",
  "\\.env(\\..+)?$",
  "credentials\\.json$",
  "\\.pem$",
  "id_rsa$",
  "secrets/",
];

export interface InitResult {
  rootDir: string;
  created: string[];
  existing: string[];
  configPath: string;
}

/** `baton init`: scaffold .baton without touching global Git config. */
export function initProject(rootDir: string, projectId?: string): InitResult {
  const root = resolve(rootDir);
  const dir = join(root, BATON_DIR);
  const handoffs = join(dir, "handoffs");
  const created: string[] = [];
  const existing: string[] = [];

  mkdirSync(handoffs, { recursive: true });
  created.push(BATON_DIR, `${BATON_DIR}/handoffs/`);

  const configPath = join(dir, "config.json");
  if (existsSync(configPath)) {
    existing.push(`${BATON_DIR}/config.json`);
  } else {
    const cfg = defaultConfig();
    cfg.project_id = projectId ?? `sha256:pending`;
    atomicWriteJsonSync(configPath, cfg);
    created.push(`${BATON_DIR}/config.json`);
  }

  const policyPath = join(dir, "policy.json");
  if (!existsSync(policyPath)) {
    atomicWriteJsonSync(policyPath, { ignore: STARTER_IGNORE_POLICY });
    created.push(`${BATON_DIR}/policy.json`);
  } else {
    existing.push(`${BATON_DIR}/policy.json`);
  }

  return { rootDir: root, created, existing, configPath };
}

export function configPath(rootDir: string): string {
  return join(resolveBatonDir(rootDir), "config.json");
}

export function isInitialized(rootDir: string): boolean {
  return existsSync(configPath(rootDir));
}

/** Load + validate config; falls back to defaults when fields are missing. */
export function loadConfig(rootDir: string): Config {
  const p = configPath(rootDir);
  if (!existsSync(p)) return defaultConfig();
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  const cfg = ConfigSchema.parse(raw);
  // Local machine-specific override, gitignored (spec §14).
  const localPath = join(resolveBatonDir(rootDir), "local.json");
  if (existsSync(localPath)) {
    const local = JSON.parse(readFileSync(localPath, "utf8")) as Record<string, unknown>;
    return ConfigSchema.parse({ ...cfg, ...local, detector: { ...cfg.detector, ...(local.detector as object) }, policy: { ...cfg.policy, ...(local.policy as object) } });
  }
  return cfg;
}

export function saveConfig(rootDir: string, cfg: Config): void {
  atomicWriteJsonSync(configPath(rootDir), cfg);
}

/** Walk up from `startDir` to find the nearest initialized project root. */
export function findProjectRoot(startDir: string): string | null {
  let cur = resolve(startDir);
  for (;;) {
    if (isInitialized(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
