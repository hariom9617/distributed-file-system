import { FastifyInstance } from "fastify";
import { AppConfig } from "../config.js";
import { ChunkStore } from "../services/chunkStore.js";
import os from "os";

export async function healthRoutes(
  app: FastifyInstance,
  store: ChunkStore,
  config: AppConfig
): Promise<void> {
  app.get("/health", async (_req, reply) => {
    const { chunkCount, totalBytes } = await store.storageStats();

    const body = {
      status: "ok",
      nodeId: config.nodeId,
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
