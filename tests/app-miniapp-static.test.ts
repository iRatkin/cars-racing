import { afterEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

describe("Mini App static assets", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  test("serves the Mini App index html", async () => {
    const app = buildApp();
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/miniapp/index.html"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<title>Мафынки Mini App</title>");
  });

  test("serves the Telegram bridge module imported by the index html", async () => {
    const app = buildApp();
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/miniapp/telegram-bridge.js"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.body).toContain("export function createTelegramBridge");
  });
});
