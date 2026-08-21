import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildApp } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`Storage node listening on port ${config.port}`);
    app.log.info(`Node ID: ${config.nodeId}`);
    app.log.info(`Chunk storage path: ${config.storagePath}`);
  } catch (err) {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

void main();
