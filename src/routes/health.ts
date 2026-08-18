import { FastifyInstance } from "fastify";
import { ChunkStore } from "../services/chunkStore.js";
import os from "os";

export async function healthRoutes(
  app: FastifyInstance,
  store: ChunkStore
): Promise<void> {
  app.get("/health", async (_req, reply) => {
    const { chunkCount, totalBytes } = await store.storageStats();

    const body = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      storage: {
        chunkCount,
        totalBytes,
      },
      process: {
        pid: process.pid,
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        platform: process.platform,
        nodeVersion: process.version,
      },
      system: {
        hostname: os.hostname(),
        cpus: os.cpus().length,
        loadAvg: os.loadavg(),
        freeMB: Math.round(os.freemem() / 1024 / 1024),
        totalMB: Math.round(os.totalmem() / 1024 / 1024),
      },
    };

    return reply.code(200).send(body);
  });
}
