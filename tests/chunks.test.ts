import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/server";
import { loadConfig } from "../src/config";
import os from "os";
import path from "path";
import fsp from "fs/promises";
import { Readable } from "stream";

const TEST_STORAGE = path.join(os.tmpdir(), `dfs-chunks-test-${process.pid}`);

/**
 * Helper: inject a binary payload as a POST /chunks request.
 */
async function uploadChunk(
  app: Awaited<ReturnType<typeof buildApp>>,
  chunkId: string,
  data: Buffer
) {
  return app.inject({
    method: "POST",
    url: `/chunks?chunkId=${chunkId}`,
    headers: { "content-type": "application/octet-stream" },
    payload: data,
  });
}

describe("Chunk routes", () => {
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

  // Clean storage between tests so they are independent.
  beforeEach(async () => {
    const entries = await fsp.readdir(TEST_STORAGE);
    await Promise.all(
      entries.map((e) => fsp.unlink(path.join(TEST_STORAGE, e)))
    );
  });

  // ── POST /chunks ────────────────────────────────────────────────────────

  describe("POST /chunks", () => {
    it("stores a chunk and returns 201 with metadata", async () => {
      const data = Buffer.from("hello distributed world");
      const res = await uploadChunk(app, "chunk-001", data);

      expect(res.statusCode).toBe(201);
      const body = res.json<{
        chunkId: string;
        size: number;
        sha256: string;
        storedAt: string;
      }>();
      expect(body.chunkId).toBe("chunk-001");
      expect(body.size).toBe(data.length);
      expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(body.storedAt).toBeTruthy();
    });

    it("returns 400 when chunkId is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/chunks",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("data"),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toContain("Missing chunk ID");
    });

    it("returns 400 for an invalid chunk ID (path traversal attempt)", async () => {
      const res = await uploadChunk(app, "../evil", Buffer.from("x"));
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for a chunk ID with slashes", async () => {
      const res = await uploadChunk(app, "foo/bar", Buffer.from("x"));
      expect(res.statusCode).toBe(400);
    });

    it("accepts chunk ID via x-chunk-id header", async () => {
      const data = Buffer.from("header-based id");
      const res = await app.inject({
        method: "POST",
        url: "/chunks",
        headers: {
          "content-type": "application/octet-stream",
          "x-chunk-id": "chunk-via-header",
        },
        payload: data,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ chunkId: string }>().chunkId).toBe("chunk-via-header");
    });

    it("correctly computes SHA-256", async () => {
      const { createHash } = await import("crypto");
      const data = Buffer.from("integrity check payload");
      const expected = createHash("sha256").update(data).digest("hex");

      const res = await uploadChunk(app, "chunk-sha-test", data);
      expect(res.json<{ sha256: string }>().sha256).toBe(expected);
    });

    it("stores a large chunk (1 MB) without error", async () => {
      const data = Buffer.alloc(1024 * 1024, 0xab); // 1 MB
      const res = await uploadChunk(app, "chunk-large", data);
      expect(res.statusCode).toBe(201);
      expect(res.json<{ size: number }>().size).toBe(1024 * 1024);
    });
  });

  // ── GET /chunks/:chunkId ────────────────────────────────────────────────

  describe("GET /chunks/:chunkId", () => {
    it("returns the stored bytes with correct headers", async () => {
      const data = Buffer.from("retrieve me");
      await uploadChunk(app, "chunk-get", data);

      const res = await app.inject({
        method: "GET",
        url: "/chunks/chunk-get",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/octet-stream");
      expect(res.headers["x-chunk-id"]).toBe("chunk-get");
      expect(res.rawPayload).toEqual(data);
    });

    it("returns 404 for a non-existent chunk", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/chunks/does-not-exist",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for an invalid chunk ID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/chunks/bad..id",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── HEAD /chunks/:chunkId ───────────────────────────────────────────────

  describe("HEAD /chunks/:chunkId", () => {
    it("returns 200 with metadata headers and no body", async () => {
      const data = Buffer.from("head me please");
      await uploadChunk(app, "chunk-head", data);

      const res = await app.inject({
        method: "HEAD",
        url: "/chunks/chunk-head",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-chunk-id"]).toBe("chunk-head");
      expect(res.headers["x-chunk-size"]).toBe(String(data.length));
      expect(res.headers["x-chunk-sha256"]).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body).toBe(""); // no body for HEAD
    });

    it("returns 404 for a missing chunk", async () => {
      const res = await app.inject({
        method: "HEAD",
        url: "/chunks/missing-chunk",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /chunks/:chunkId ─────────────────────────────────────────────

  describe("DELETE /chunks/:chunkId", () => {
    it("deletes an existing chunk and returns 200", async () => {
      await uploadChunk(app, "chunk-del", Buffer.from("delete me"));

      const res = await app.inject({
        method: "DELETE",
        url: "/chunks/chunk-del",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ deleted: string }>().deleted).toBe("chunk-del");

      // Verify it's gone
      const check = await app.inject({
        method: "GET",
        url: "/chunks/chunk-del",
      });
      expect(check.statusCode).toBe(404);
    });

    it("returns 404 when deleting a non-existent chunk", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/chunks/phantom-chunk",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Health reflects chunk count ─────────────────────────────────────────

  describe("Health storage stats", () => {
    it("increments chunkCount after upload", async () => {
      await uploadChunk(app, "chunk-h1", Buffer.from("a"));
      await uploadChunk(app, "chunk-h2", Buffer.from("bb"));

      const res = await app.inject({ method: "GET", url: "/health" });
      const body = res.json<{
        storage: { chunkCount: number; totalBytes: number };
      }>();

      expect(body.storage.chunkCount).toBe(2);
      expect(body.storage.totalBytes).toBe(3);
    });
  });
});
