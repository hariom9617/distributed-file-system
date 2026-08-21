import path from "path";

/**
 * Loads and validates environment configuration.
 * Call loadConfig() once at startup; use the returned object everywhere else.
 */
export interface AppConfig {
  nodeId: string;
  port: number;
  storagePath: string;
  logLevel: string;
}

/** Characters allowed in a NODE_ID value. */
const VALID_NODE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function loadConfig(): AppConfig {
  // ── Node identity ────────────────────────────────────────────────────────
  const nodeId = process.env["NODE_ID"] ?? "node-1";
  if (!VALID_NODE_ID_RE.test(nodeId)) {
    throw new Error(
      `Invalid NODE_ID value: "${nodeId}". ` +
        "Only alphanumeric characters, hyphens, and underscores are allowed (max 64 chars)."
    );
  }

  // ── Network ──────────────────────────────────────────────────────────────
  const port = parseInt(process.env["PORT"] ?? "3001", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
  }

  // ── Storage ──────────────────────────────────────────────────────────────
  const rawStorage = process.env["STORAGE_PATH"] ?? "./data/chunks";
  const storagePath = path.resolve(rawStorage);

  // ── Logging ──────────────────────────────────────────────────────────────
  const logLevel = process.env["LOG_LEVEL"] ?? "info";
  const validLevels = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
  if (!validLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL value: "${logLevel}"`);
  }

  return { nodeId, port, storagePath, logLevel };
}
