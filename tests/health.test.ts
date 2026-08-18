import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server";
import { loadConfig } from "../src/config";
import os from "os";
import path from "path";
import fsp from "fs/promises";

const TEST_STORAGE = path.join(os.tmpdir(), `dfs-health-test-${process.pid}`);

describe("GET /health", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await fsp.mkdir(TEST_STORAGE, { recursive: true });
    const config = loadConfig();
    config.storagePath = TEST_STORAGE;
    config.logLevel = "silent";
    app = await buildApp(config);
  });

  afterAll(async () => {
    await app.close();
    await fsp.rm(TEST_STORAGE, { recursive: true, force: true });
  });

  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      status: string;
      uptime: number;
      storage: { chunkCount: number; totalBytes: number };
    }>();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.storage.chunkCount).toBe(0);
    expect(body.storage.totalBytes).toBe(0);
  });

  it("includes process and system fields", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty("process");
    expect(body).toHaveProperty("system");
    expect(body).toHaveProperty("timestamp");
  });
});
