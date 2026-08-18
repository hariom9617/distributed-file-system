import path from "path";

/**
 * Loads and validates environment configuration.
 * Call loadConfig() once at startup; use the returned object everywhere else.
 */
export interface AppConfig {
  port: number;
  storagePath: string;
  logLevel: string;
}

export function loadConfig(): AppConfig {
  const port = parseInt(process.env["PORT"] ?? "3001", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
  }

  const rawStorage = process.env["STORAGE_PATH"] ?? "./data/chunks";
  const storagePath = path.resolve(rawStorage);

  const logLevel = process.env["LOG_LEVEL"] ?? "info";
  const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
  if (!validLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL value: "${logLevel}"`);
  }

  return { port, storagePath, logLevel };
}
