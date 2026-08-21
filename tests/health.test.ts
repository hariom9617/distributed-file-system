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
    // Use default NODE_ID (falls back to "node-1" when env var is absent).
    delete process.env["NODE_ID"];
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

  it("includes nodeId in the response", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<{ nodeId: string }>();
    // When NODE_ID is not set, the default is "node-1".
    expect(body.nodeId).toBe("node-1");
  });

  it("includes process and system fields", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty("process");
    expect(body).toHaveProperty("system");
    expect(body).toHaveProperty("timestamp");
  });
});

// ── NODE_ID configuration ────────────────────────────────────────────────────

describe("NODE_ID configuration", () => {
  const NODE_STORAGE = path.join(
    os.tmpdir(),
    `dfs-nodeid-test-${process.pid}`
  );

  afterAll(async () => {
    await fsp.rm(NODE_STORAGE, { recursive: true, force: true });
    // Clean up env var after suite.
    delete process.env["NODE_ID"];
  });

  it("uses NODE_ID env var when provided", async () => {
    await fsp.mkdir(NODE_STORAGE, { recursive: true });
    process.env["NODE_ID"] = "node-42";

    const config = loadConfig();
    config.storagePath = NODE_STORAGE;
    config.logLevel = "silent";
    const app = await buildApp(config);

    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json<{ nodeId: string }>();
    expect(body.nodeId).toBe("node-42");

    await app.close();
    delete process.env["NODE_ID"];
  });

  it("defaults to node-1 when NODE_ID is not set", async () => {
    await fsp.mkdir(NODE_STORAGE, { recursive: true });
    delete process.env["NODE_ID"];

    const config = loadConfig();
    expect(config.nodeId).toBe("node-1");
  });

  it("accepts alphanumeric, hyphen and underscore in NODE_ID", async () => {
    for (const id of ["node-1", "node_2", "StorageNode3", "abc-123_XYZ"]) {
      process.env["NODE_ID"] = id;
      const config = loadConfig();
      expect(config.nodeId).toBe(id);
    }
    delete process.env["NODE_ID"];
  });

  it("throws on NODE_ID with path separator characters", () => {
    process.env["NODE_ID"] = "node/evil";
    expect(() => loadConfig()).toThrow(/Invalid NODE_ID/);
    delete process.env["NODE_ID"];
  });

  it("throws on NODE_ID that is too long (>64 chars)", () => {
    process.env["NODE_ID"] = "a".repeat(65);
    expect(() => loadConfig()).toThrow(/Invalid NODE_ID/);
    delete process.env["NODE_ID"];
  });

  it("reflects the correct nodeId when three different node configs are created", () => {
    for (const [id, port] of [
      ["node-1", "3001"],
      ["node-2", "3002"],
      ["node-3", "3003"],
    ] as [string, string][]) {
      process.env["NODE_ID"] = id;
      process.env["PORT"] = port;
      const config = loadConfig();
      expect(config.nodeId).toBe(id);
      expect(config.port).toBe(Number(port));
    }
    delete process.env["NODE_ID"];
    delete process.env["PORT"];
  });
});
