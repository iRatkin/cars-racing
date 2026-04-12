import { MongoClient } from "mongodb";

import { loadConfigFromEnv } from "./config/config.js";
import { ensureMongoIndexes } from "./infra/mongo/indexes.js";
import { buildMongoBackedApp } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const mongoClient = new MongoClient(config.mongoUri);

  await mongoClient.connect();
  const db = mongoClient.db();
  await ensureMongoIndexes(db);

  const app = buildMongoBackedApp({
    config,
    db
  });

  let isClosing = false;
  const close = async (signal: NodeJS.Signals): Promise<void> => {
    if (isClosing) {
      return;
    }

    isClosing = true;
    app.log.info({ signal }, "shutting down");
    await app.close();
    await mongoClient.close();
  };

  process.once("SIGINT", (signal) => {
    void close(signal);
  });
  process.once("SIGTERM", (signal) => {
    void close(signal);
  });

  await app.listen({
    host: "0.0.0.0",
    port: config.port
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
