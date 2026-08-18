import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  ChunkStore,
  InvalidChunkIdError,
  ChunkNotFoundError,
} from "../services/chunkStore.js";

interface ChunkParams {
  chunkId: string;
}

/**
 * Register all /chunks routes onto the Fastify instance.
 */
export async function chunkRoutes(
  app: FastifyInstance,
  store: ChunkStore
): Promise<void> {
  // ── POST /chunks ──────────────────────────────────────────────────────────
  // Body: raw binary (application/octet-stream)
  // Query: ?chunkId=<id>   OR   Header: x-chunk-id: <id>
  //
  // We accept the chunk ID via query param *or* custom header so callers
  // have flexibility.  Query param takes precedence.

  app.post(
    "/chunks",
    {
      config: { rawBody: false },
    },
    async (
      req: FastifyRequest<{ Querystring: { chunkId?: string } }>,
      reply: FastifyReply
    ) => {
      const chunkId =
        req.query.chunkId ??
        (req.headers["x-chunk-id"] as string | undefined);

      if (!chunkId) {
        return reply
          .code(400)
          .send({ error: "Missing chunk ID (query param ?chunkId= or header x-chunk-id)" });
      }

      // req.raw is the underlying IncomingMessage — a Readable stream.
      // We never buffer the full body; it streams straight to disk.
      try {
        const result = await store.store(chunkId, req.raw);
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof InvalidChunkIdError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // ── GET /chunks/:chunkId ──────────────────────────────────────────────────
  // Streams the raw chunk bytes back to the client.

  app.get(
    "/chunks/:chunkId",
    async (
      req: FastifyRequest<{ Params: ChunkParams }>,
      reply: FastifyReply
    ) => {
      const { chunkId } = req.params;

      try {
        // Fetch metadata first so we can set Content-Length.
        const meta = await store.stat(chunkId);
        const readStream = await store.openReadStream(chunkId);

        // Set headers before sending.  We use reply.send(stream) so Fastify
        // handles the piping — this also works correctly with inject() in tests.
        return reply
          .code(200)
          .header("Content-Type", "application/octet-stream")
          .header("Content-Length", String(meta.size))
          .header("x-chunk-id", chunkId)
          .header("x-chunk-sha256", meta.sha256)
          .header("x-chunk-size", String(meta.size))
          .send(readStream);
      } catch (err) {
        if (err instanceof ChunkNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof InvalidChunkIdError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // ── HEAD /chunks/:chunkId ─────────────────────────────────────────────────
  // Returns metadata headers without a body.

  app.head(
    "/chunks/:chunkId",
    async (
      req: FastifyRequest<{ Params: ChunkParams }>,
      reply: FastifyReply
    ) => {
      const { chunkId } = req.params;

      try {
        const meta = await store.stat(chunkId);
        return reply
          .code(200)
          .header("Content-Length", String(meta.size))
          .header("Content-Type", "application/octet-stream")
          .header("x-chunk-id", meta.chunkId)
          .header("x-chunk-sha256", meta.sha256)
          .header("x-chunk-size", String(meta.size))
          .header("x-chunk-created-at", meta.createdAt)
          .header("x-chunk-modified-at", meta.modifiedAt)
          .send();
      } catch (err) {
        if (err instanceof ChunkNotFoundError) {
          return reply.code(404).send();
        }
        if (err instanceof InvalidChunkIdError) {
          return reply.code(400).send();
        }
        throw err;
      }
    }
  );

  // ── DELETE /chunks/:chunkId ───────────────────────────────────────────────

  app.delete(
    "/chunks/:chunkId",
    async (
      req: FastifyRequest<{ Params: ChunkParams }>,
      reply: FastifyReply
    ) => {
      const { chunkId } = req.params;

      try {
        await store.delete(chunkId);
        return reply.code(200).send({ deleted: chunkId });
      } catch (err) {
        if (err instanceof ChunkNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof InvalidChunkIdError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );
}
