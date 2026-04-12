import cors from "@fastify/cors";
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
import { getBundleById } from "./modules/race-coins/race-coins-catalog.js";
import { compareTelegramWebhookSecretToken } from "./modules/telegram/webhook-domain.js";
import { ensureStarterCarState } from "./modules/users/starter-car.js";
import type { UsersRepository } from "./modules/users/users-repository.js";

export interface AppDependencies {
  config?: AppConfig;
  usersRepository?: UsersRepository;
  purchasesRepository?: PurchasesRepository;
  createInvoiceLink?: (input: {
    purchaseId: string;
    title: string;
    invoiceTitle: string;
    invoiceDescription: string;
    priceSnapshot: { currency: "XTR"; amount: number };
  }) => Promise<string>;
  handleTelegramWebhook?: (update: unknown) => Promise<void>;
  now?: () => Date;
}

const telegramAuthBodySchema = z.object({
  initData: z.string().min(1)
});

const coinsIntentBodySchema = z.object({
  bundleId: z.string().min(1)
});

const buyCarBodySchema = z.object({
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

  app.register(cors, {
    origin: "*"
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

      return reply.send({
        ...garage,
        raceCoinsBalance: user.raceCoinsBalance ?? 0
      });
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
            garageRevision: starterState.garageRevision,
            raceCoinsBalance: user.raceCoinsBalance ?? 0
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
      app.post("/v1/purchases/coins-intents", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const parsedBody = coinsIntentBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
          return reply.code(400).send({ code: "BUNDLE_ID_REQUIRED" });
        }

        const bundle = getBundleById(parsedBody.data.bundleId);
        if (!bundle) {
          return reply.code(404).send({ code: "BUNDLE_NOT_FOUND" });
        }

        const user = await userRepo.getUserById(tokenPayload.sub);
        if (!user) {
          return reply.code(404).send({ code: "USER_NOT_FOUND" });
        }

        const requestNow = now?.() ?? new Date();
        const existingIntent = await purchasesRepository.findActiveIntent({
          userId: user.userId,
          bundleId: bundle.bundleId
        });

        if (existingIntent) {
          const retryDecision = classifyPurchaseIntentRetry(
            {
              purchaseId: existingIntent.purchaseId,
              bundleId: existingIntent.bundleId,
              purchaseStatus: existingIntent.status,
              isActiveIntent: existingIntent.isActiveIntent,
              expiresAt: existingIntent.expiresAt,
              invoicePayload: existingIntent.invoicePayload
            },
            requestNow
          );

          if (retryDecision.kind === "reuse-existing-intent") {
            return reply.send(formatCoinsIntentResponse(existingIntent));
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
            bundleId: bundle.bundleId,
            priceSnapshot: bundle.price,
            coinsAmount: bundle.coins,
            expiresAt
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            throw error;
          }
          const racedIntent = await purchasesRepository.findActiveIntent({
            userId: user.userId,
            bundleId: bundle.bundleId
          });
          if (!racedIntent) {
            throw error;
          }
          return reply.send(formatCoinsIntentResponse(racedIntent));
        }
        const invoiceUrl = await createInvoiceLink({
          purchaseId: intent.purchaseId,
          title: bundle.invoiceTitle,
          invoiceTitle: bundle.invoiceTitle,
          invoiceDescription: bundle.invoiceDescription,
          priceSnapshot: bundle.price
        });
        await purchasesRepository.setInvoiceUrl(intent.purchaseId, invoiceUrl);

        return reply.send(
          formatCoinsIntentResponse({
            ...intent,
            invoiceUrl
          })
        );
      });
    }

    app.post("/v1/purchases/buy-car", async (request, reply) => {
      const tokenPayload = await verifyJwtOrReject(request, reply);
      if (!tokenPayload) {
        return;
      }

      const parsedBody = buyCarBodySchema.safeParse(request.body);
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
      if (car.price.currency !== "RC") {
        return reply.code(422).send({ code: "CAR_NOT_PURCHASABLE" });
      }

      const updatedUser = await userRepo.spendRaceCoins(user.userId, car.price.amount);
      if (!updatedUser) {
        return reply.code(422).send({ code: "INSUFFICIENT_BALANCE" });
      }

      const userWithCar = await userRepo.addOwnedCar(updatedUser.userId, car.carId);
      if (!userWithCar) {
        return reply.code(404).send({ code: "USER_NOT_FOUND" });
      }

      return reply.send({
        success: true,
        carId: car.carId,
        raceCoinsBalance: userWithCar.raceCoinsBalance,
        garageRevision: userWithCar.garageRevision
      });
    });
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

function formatCoinsIntentResponse(intent: {
  purchaseId: string;
  status: string;
  invoiceUrl?: string;
  expiresAt: Date;
  priceSnapshot: { currency: "XTR"; amount: number };
  coinsAmount: number;
}) {
  return {
    purchaseId: intent.purchaseId,
    status: intent.status,
    invoiceUrl: intent.invoiceUrl,
    expiresAt: intent.expiresAt.toISOString(),
    price: intent.priceSnapshot,
    coinsAmount: intent.coinsAmount
  };
}
