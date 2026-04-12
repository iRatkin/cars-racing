import jwt from "@fastify/jwt";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppConfig } from "./config/config.js";
import {
  TelegramInitDataValidationError,
  validateTelegramInitData
} from "./modules/auth/telegram-init-data.js";
import {
  canPurchaseCarServerSide,
  getActiveCarsSortedBySortOrder,
  getCarById
} from "./modules/cars-catalog/cars-catalog.js";
import { buildGarageView } from "./modules/garage/garage-view.js";
import { classifyPurchaseIntentRetry } from "./modules/payments/purchase-domain.js";
import type { PurchaseIntentRecord, PurchasesRepository } from "./modules/payments/purchases-repository.js";
import { compareTelegramWebhookSecretToken } from "./modules/telegram/webhook-domain.js";
import { ensureStarterCarState } from "./modules/users/starter-car.js";
import type { UsersRepository } from "./modules/users/users-repository.js";

export interface AppDependencies {
  config?: AppConfig;
  usersRepository?: UsersRepository;
  purchasesRepository?: PurchasesRepository;
  createInvoiceLink?: (input: {
    purchaseId: string;
    carId: string;
    title: string;
    invoiceTitle?: string;
    invoiceDescription?: string;
    priceSnapshot: { currency: "XTR"; amount: number };
  }) => Promise<string>;
  handleTelegramWebhook?: (update: unknown) => Promise<void>;
  now?: () => Date;
}

const telegramAuthBodySchema = z.object({
  initData: z.string().min(1)
});

const carIntentBodySchema = z.object({
  carId: z.string().min(1)
});

export function buildApp(dependencies: AppDependencies = {}): FastifyInstance {
  const {
    config,
    usersRepository,
    purchasesRepository,
    createInvoiceLink,
    handleTelegramWebhook,
    now
  } = dependencies;
  const app = Fastify({
    logger: Boolean(config)
  });

  if (config) {
    app.register(jwt, {
      secret: config.jwtSecret
    });
  }

  app.get("/health", async () => ({ ok: true }));

  if (config && handleTelegramWebhook) {
    app.post("/v1/telegram/webhook", async (request, reply) => {
      const providedSecret = request.headers["x-telegram-bot-api-secret-token"];
      const providedSecretValue = Array.isArray(providedSecret)
        ? providedSecret[0]
        : providedSecret;

      if (
        !compareTelegramWebhookSecretToken(
          providedSecretValue,
          config.telegramWebhookSecret
        )
      ) {
        return reply.code(401).send({ code: "INVALID_WEBHOOK_SECRET" });
      }

      await handleTelegramWebhook(request.body);
      return reply.send({ ok: true });
    });
  }

  if (config && usersRepository) {
    const appConfig = config;
    const userRepo = usersRepository;

    app.get("/v1/garage", async (request, reply) => {
      let tokenPayload: { sub: string; telegramUserId: string };
      try {
        tokenPayload = await request.jwtVerify<{
          sub: string;
          telegramUserId: string;
        }>();
      } catch {
        return reply.code(401).send({ code: "UNAUTHORIZED" });
      }

      const user = await userRepo.getUserById(tokenPayload.sub);

      if (!user) {
        return reply.code(404).send({ code: "USER_NOT_FOUND" });
      }

      const starterState = ensureStarterCarState(user);
      const garage = buildGarageView(
        {
          ownedCarIds: starterState.ownedCarIds,
          garageRevision: starterState.garageRevision
        },
        getActiveCarsSortedBySortOrder().map((car) => ({
          carId: car.carId,
          title: car.title,
          price: car.price,
          active: car.active,
          purchasable: car.isPurchasable,
          isStarter: car.isStarterDefault,
          sortOrder: car.sortOrder
        }))
      );

      return reply.send(garage);
    });

    app.post("/v1/auth/telegram", async (request, reply) => {
      const parsedBody = telegramAuthBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ code: "INIT_DATA_REQUIRED" });
      }

      try {
        const validated = validateTelegramInitData(
          parsedBody.data.initData,
          appConfig.botToken,
          {
            now: now?.() ?? new Date(),
            maxAgeSeconds: 15 * 60
          }
        );

        const user = await userRepo.upsertTelegramUser({
          telegramUserId: validated.telegramUserId,
          firstName: stringOrUndefined(validated.user.first_name),
          lastName: stringOrUndefined(validated.user.last_name),
          username: stringOrUndefined(validated.user.username),
          languageCode: stringOrUndefined(validated.user.language_code),
          isPremium:
            typeof validated.user.is_premium === "boolean"
              ? validated.user.is_premium
              : undefined
        });

        const starterState = ensureStarterCarState(user);
        const accessToken = await reply.jwtSign(
          {
            sub: user.userId,
            telegramUserId: user.telegramUserId
          },
          {
            expiresIn: "12h"
          }
        );

        return reply.send({
          accessToken,
          expiresInSec: 43200,
          profile: {
            userId: user.userId,
            telegramUserId: user.telegramUserId,
            firstName: user.firstName,
            username: user.username,
            ownedCarIds: starterState.ownedCarIds,
            garageRevision: starterState.garageRevision
          }
        });
      } catch (error) {
        if (error instanceof TelegramInitDataValidationError) {
          return reply.code(401).send({ code: "INIT_DATA_INVALID" });
        }

        throw error;
      }
    });

    if (purchasesRepository && createInvoiceLink) {
      app.post("/v1/purchases/car-intents", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const parsedBody = carIntentBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
          return reply.code(400).send({ code: "CAR_ID_REQUIRED" });
        }

        const user = await userRepo.getUserById(tokenPayload.sub);
        if (!user) {
          return reply.code(404).send({ code: "USER_NOT_FOUND" });
        }

        const starterState = ensureStarterCarState(user);
        const car = getCarById(parsedBody.data.carId);
        if (!car) {
          return reply.code(404).send({ code: "CAR_NOT_FOUND" });
        }
        if (!canPurchaseCarServerSide(car)) {
          return reply.code(422).send({ code: "CAR_NOT_PURCHASABLE" });
        }
        if (starterState.ownedCarIds.includes(car.carId)) {
          return reply.code(409).send({ code: "CAR_ALREADY_OWNED" });
        }

        const requestNow = now?.() ?? new Date();
        const existingIntent = await purchasesRepository.findActiveIntent({
          userId: user.userId,
          carId: car.carId
        });

        if (existingIntent) {
          const retryDecision = classifyPurchaseIntentRetry(
            {
              purchaseId: existingIntent.purchaseId,
              carId: existingIntent.carId,
              purchaseStatus: existingIntent.status,
              isActiveIntent: existingIntent.isActiveIntent,
              expiresAt: existingIntent.expiresAt,
              invoicePayload: existingIntent.invoicePayload
            },
            requestNow
          );

          if (retryDecision.kind === "reuse-existing-intent") {
            return reply.send(formatPurchaseIntentResponse(existingIntent));
          }

          if (retryDecision.kind === "expire-and-release-intent") {
            await purchasesRepository.expireIntent(existingIntent.purchaseId);
          }
        }

        const expiresAt = new Date(requestNow.getTime() + 15 * 60 * 1000);
        let intent: PurchaseIntentRecord;
        try {
          intent = await purchasesRepository.createIntent({
            userId: user.userId,
            telegramUserId: user.telegramUserId,
            carId: car.carId,
            priceSnapshot: car.price,
            expiresAt
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            throw error;
          }
          const racedIntent = await purchasesRepository.findActiveIntent({
            userId: user.userId,
            carId: car.carId
          });
          if (!racedIntent) {
            throw error;
          }
          return reply.send(formatPurchaseIntentResponse(racedIntent));
        }
        const invoiceUrl = await createInvoiceLink({
          purchaseId: intent.purchaseId,
          carId: car.carId,
          title: car.title,
          invoiceTitle: car.invoiceTitle,
          invoiceDescription: car.invoiceDescription,
          priceSnapshot: car.price
        });
        await purchasesRepository.setInvoiceUrl(intent.purchaseId, invoiceUrl);

        return reply.send(
          formatPurchaseIntentResponse({
            ...intent,
            invoiceUrl
          })
        );
      });
    }
  }

  return app;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function verifyJwtOrReject(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ sub: string; telegramUserId: string } | null> {
  try {
    return await request.jwtVerify<{ sub: string; telegramUserId: string }>();
  } catch {
    await reply.code(401).send({ code: "UNAUTHORIZED" });
    return null;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function formatPurchaseIntentResponse(intent: {
  purchaseId: string;
  status: string;
  invoiceUrl?: string;
  expiresAt: Date;
  priceSnapshot: { currency: "XTR"; amount: number };
}) {
  return {
    purchaseId: intent.purchaseId,
    status: intent.status,
    invoiceUrl: intent.invoiceUrl,
    expiresAt: intent.expiresAt.toISOString(),
    price: intent.priceSnapshot
  };
}
