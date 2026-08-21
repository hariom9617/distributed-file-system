import Fastify, { FastifyInstance } from "fastify";
import { AppConfig } from "./config.js";
import { ChunkStore } from "./services/chunkStore.js";
import { chunkRoutes } from "./routes/chunks.js";
import { healthRoutes } from "./routes/health.js";

/**
 * Build and configure the Fastify application.
 *
 * Separated from main.ts so that tests can import buildApp() directly
 * without binding to a port.
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        process.env["NODE_ENV"] !== "production" && config.logLevel !== "silent"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    // Set a very large body limit so Fastify does not reject large uploads.
    // For /chunks routes we stream via req.raw and never buffer the full body.
    bodyLimit: 10 * 1024 * 1024 * 1024, // 10 GB ceiling
  });

  // ── Content-type parser for raw binary uploads ────────────────────────────
  // Register application/octet-stream as a pass-through (no buffering).
  // The route handler reads req.raw directly.
  // Register application/octet-stream as a pass-through.
  // We do NOT buffer the body here — actual streaming happens in the route
  // via req.raw.  We register this only to prevent Fastify from rejecting
  // the content-type.
  app.addContentTypeParser(
    "application/octet-stream",
    (_req, _payload, done) => {
      done(null, null);
    }
  );

  // Also accept uploads without an explicit content-type header.
  app.addContentTypeParser("*", (_req, _payload, done) => {
    done(null, null);
  });

  const store = new ChunkStore(config.storagePath);
  await store.init();

  // ── Routes ────────────────────────────────────────────────────────────────
  await chunkRoutes(app, store);
  await healthRoutes(app, store, config);

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, _req, reply) => {
    app.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({ error: "Internal server error" });
  });

  return app;
}
