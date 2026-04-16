import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { AppConfig } from "./config/config.js";
import { enterSeasonAtomicallyInMongo, finishSeasonRaceAtomicallyInMongo } from "./infra/mongo/season-mongo-transactions.js";
import {
  TelegramInitDataValidationError,
  validateTelegramInitData
} from "./modules/auth/telegram-init-data.js";
import {
  canPurchaseCarServerSide,
  type CarsCatalogRepository
} from "./modules/cars-catalog/cars-catalog-repository.js";
import { buildGarageView } from "./modules/garage/garage-view.js";
import { classifyPurchaseIntentRetry } from "./modules/payments/purchase-domain.js";
import type { PurchaseIntentRecord, PurchasesRepository } from "./modules/payments/purchases-repository.js";
import { getBundleById } from "./modules/race-coins/race-coins-catalog.js";
import { compareTelegramWebhookSecretToken } from "./modules/telegram/webhook-domain.js";
import { ensureStarterCarState } from "./modules/users/starter-car.js";
import type { UsersRepository } from "./modules/users/users-repository.js";
import {
  canStartRace,
  computeSeasonStatus,
  type LeaderboardEntry
} from "./modules/seasons/seasons-domain.js";
import type { RaceRunsRepository } from "./modules/seasons/race-runs-repository.js";
import type { SeasonEntriesRepository } from "./modules/seasons/season-entries-repository.js";
import type { SeasonsRepository } from "./modules/seasons/seasons-repository.js";

export interface AppDependencies {
  config?: AppConfig;
  usersRepository?: UsersRepository;
  purchasesRepository?: PurchasesRepository;
  carsCatalogRepository?: CarsCatalogRepository;
  seasonsRepository?: SeasonsRepository;
  seasonEntriesRepository?: SeasonEntriesRepository;
  raceRunsRepository?: RaceRunsRepository;
  mongoClient?: MongoClient;
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

const seasonIdParamSchema = z.object({
  seasonId: z.string().min(1)
});

const raceFinishBodySchema = z.object({
  raceId: z.string().min(1),
  seed: z.string().min(1),
  score: z.number().int().min(0)
});

export function buildApp(dependencies: AppDependencies = {}): FastifyInstance {
  const {
    config,
    usersRepository,
    purchasesRepository,
    carsCatalogRepository,
    seasonsRepository,
    seasonEntriesRepository,
    raceRunsRepository,
    mongoClient,
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

  if (config && usersRepository && carsCatalogRepository) {
    const appConfig = config;
    const userRepo = usersRepository;
    const carsRepo = carsCatalogRepository;

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
      const activeCars = await carsRepo.getActiveSortedByOrder();
      const garage = buildGarageView(
        {
          ownedCarIds: starterState.ownedCarIds,
          garageRevision: starterState.garageRevision
        },
        activeCars.map((car) => ({
          carId: car.carId,
          title: car.title,
          price: car.price,
          active: car.active,
          purchasable: car.isPurchasable,
          isStarter: car.isStarterDefault,
          sortOrder: car.sortOrder
        }))
      );

      const garageResponse = {
        ...garage,
        raceCoinsBalance: user.raceCoinsBalance ?? 0
      };

      if (appConfig.env === "dev") {
        request.log.info({ garageResponse }, "garage response");
      }

      return reply.send(garageResponse);
    });

    app.post("/v1/auth/telegram", async (request, reply) => {
      const parsedBody = telegramAuthBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ code: "INIT_DATA_REQUIRED" });
      }

      if (appConfig.env === "dev") {
        request.log.info({ initData: parsedBody.data.initData }, "auth initData received");
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

        const responseBody = {
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
        };

        if (appConfig.env === "dev") {
          request.log.info({ responseBody }, "auth response");
        }

        return reply.send(responseBody);
      } catch (error) {
        if (error instanceof TelegramInitDataValidationError) {
          return reply.code(401).send({ code: "INIT_DATA_INVALID" });
        }

        throw error;
      }
    });

    if (purchasesRepository && createInvoiceLink) {
      app.post("/v1/purchases/coins-intents", async (request, reply) => {
        if (appConfig.env === "dev") {
          request.log.info({ body: request.body }, "coins-intents request body");
        }

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
          if (appConfig.env === "dev") {
            request.log.warn({ bundleId: parsedBody.data.bundleId }, "bundle not found");
          }
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
      const car = await carsRepo.getById(parsedBody.data.carId);
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

    if (seasonsRepository && seasonEntriesRepository && raceRunsRepository && mongoClient) {
      const seasonsRepo = seasonsRepository;
      const seasonEntriesRepo = seasonEntriesRepository;
      const raceRunsRepo = raceRunsRepository;
      const txClient = mongoClient;

      app.get("/v1/seasons", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const requestNow = now?.() ?? new Date();
        const seasons = await seasonsRepo.getActiveAndUpcomingSeasons(requestNow);

        const entries = await Promise.all(
          seasons.map(async (season) => {
            const entry = await seasonEntriesRepo.findEntry(season.seasonId, tokenPayload.sub);
            return {
              seasonId: season.seasonId,
              title: season.title,
              mapId: season.mapId,
              entryFee: season.entryFee,
              startsAt: season.startsAt.toISOString(),
              endsAt: season.endsAt.toISOString(),
              status: computeSeasonStatus(season, requestNow),
              entered: entry !== null,
              bestScore: entry?.bestScore ?? null,
              totalRaces: entry?.totalRaces ?? null
            };
          })
        );

        return reply.send({ seasons: entries });
      });

      app.get("/v1/seasons/:seasonId", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const params = seasonIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
        }

        const requestNow = now?.() ?? new Date();
        const season = await seasonsRepo.getSeasonById(params.data.seasonId, requestNow);
        if (!season) {
          return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
        }

        const entry = await seasonEntriesRepo.findEntry(season.seasonId, tokenPayload.sub);

        return reply.send({
          seasonId: season.seasonId,
          title: season.title,
          mapId: season.mapId,
          entryFee: season.entryFee,
          startsAt: season.startsAt.toISOString(),
          endsAt: season.endsAt.toISOString(),
          status: computeSeasonStatus(season, requestNow),
          entered: entry !== null,
          bestScore: entry?.bestScore ?? null,
          totalRaces: entry?.totalRaces ?? null
        });
      });

      app.post("/v1/seasons/:seasonId/enter", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const params = seasonIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
        }

        const requestNow = now?.() ?? new Date();
        const season = await seasonsRepo.getSeasonById(params.data.seasonId, requestNow);
        if (!season) {
          return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
        }

        const seasonStatus = computeSeasonStatus(season, requestNow);
        if (seasonStatus !== "active") {
          return reply.code(422).send({ code: "SEASON_NOT_ACTIVE" });
        }

        const enterResult = await enterSeasonAtomicallyInMongo(txClient, {
          season,
          userId: tokenPayload.sub
        });
        if (enterResult.kind === "already-entered") {
          return reply.code(409).send({ code: "ALREADY_ENTERED" });
        }
        if (enterResult.kind === "insufficient-balance") {
          return reply.code(422).send({ code: "INSUFFICIENT_BALANCE" });
        }

        return reply.send({
          success: true,
          seasonId: season.seasonId,
          entryId: enterResult.entry.entryId,
          raceCoinsBalance: enterResult.user.raceCoinsBalance
        });
      });

      app.post("/v1/seasons/:seasonId/races/start", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const params = seasonIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
        }

        const requestNow = now?.() ?? new Date();
        const season = await seasonsRepo.getSeasonById(params.data.seasonId, requestNow);
        if (!season) {
          return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
        }

        if (!canStartRace(season, requestNow)) {
          return reply.code(422).send({ code: "SEASON_NOT_ACTIVE" });
        }

        const entry = await seasonEntriesRepo.findEntry(season.seasonId, tokenPayload.sub);
        if (!entry) {
          return reply.code(403).send({ code: "NOT_ENTERED" });
        }

        const seed = randomUUID();
        const raceRun = await raceRunsRepo.createRaceRun({
          seasonId: season.seasonId,
          userId: tokenPayload.sub,
          seed
        });

        return reply.send({
          raceId: raceRun.raceId,
          seed: raceRun.seed
        });
      });

      app.post("/v1/seasons/:seasonId/races/finish", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const params = seasonIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
        }

        const parsedBody = raceFinishBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
          return reply.code(400).send({ code: "INVALID_RACE_RESULT" });
        }

        const raceRun = await raceRunsRepo.getRaceRunById(parsedBody.data.raceId);
        if (!raceRun) {
          return reply.code(404).send({ code: "RACE_NOT_FOUND" });
        }

        if (raceRun.userId !== tokenPayload.sub) {
          return reply.code(403).send({ code: "RACE_FORBIDDEN" });
        }

        if (raceRun.seasonId !== params.data.seasonId) {
          return reply.code(400).send({ code: "RACE_SEASON_MISMATCH" });
        }

        if (raceRun.seed !== parsedBody.data.seed) {
          return reply.code(400).send({ code: "INVALID_SEED" });
        }

        if (raceRun.status !== "started") {
          return reply.code(409).send({ code: "RACE_ALREADY_FINISHED" });
        }

        const entry = await seasonEntriesRepo.findEntry(params.data.seasonId, tokenPayload.sub);
        if (!entry) {
          return reply.code(403).send({ code: "NOT_ENTERED" });
        }

        const finishResult = await finishSeasonRaceAtomicallyInMongo(txClient, {
          raceId: raceRun.raceId,
          score: parsedBody.data.score,
          entry
        });
        if (finishResult.kind === "already-finished") {
          return reply.code(409).send({ code: "RACE_ALREADY_FINISHED" });
        }

        return reply.send({
          raceId: finishResult.raceRun.raceId,
          score: finishResult.raceRun.score,
          isNewBest: finishResult.isNewBest,
          bestScore: finishResult.bestScore
        });
      });

      app.get("/v1/seasons/:seasonId/leaderboard", async (request, reply) => {
        const tokenPayload = await verifyJwtOrReject(request, reply);
        if (!tokenPayload) {
          return;
        }

        const params = seasonIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ code: "SEASON_ID_REQUIRED" });
        }

        const requestNow = now?.() ?? new Date();
        const season = await seasonsRepo.getSeasonById(params.data.seasonId, requestNow);
        if (!season) {
          return reply.code(404).send({ code: "SEASON_NOT_FOUND" });
        }

        const queryLimit = parseLeaderboardLimit(request);
        const topEntries = await seasonEntriesRepo.getLeaderboard(season.seasonId, queryLimit);

        const entries: LeaderboardEntry[] = [];
        let previousScore: number | null = null;
        let previousRank = 0;
        for (const [index, seasonEntry] of topEntries.entries()) {
          const user = await userRepo.getUserById(seasonEntry.userId);
          const rank =
            previousScore !== null && seasonEntry.bestScore === previousScore
              ? previousRank
              : index + 1;
          entries.push({
            rank,
            userId: seasonEntry.userId,
            username: user?.username,
            firstName: user?.firstName,
            bestScore: seasonEntry.bestScore,
            totalRaces: seasonEntry.totalRaces
          });
          previousScore = seasonEntry.bestScore;
          previousRank = rank;
        }

        const totalParticipants = await seasonEntriesRepo.countEntries(season.seasonId);

        let currentPlayer: LeaderboardEntry | undefined;
        const playerInTop = entries.find((e) => e.userId === tokenPayload.sub);
        if (playerInTop) {
          currentPlayer = playerInTop;
        } else {
          const playerEntry = await seasonEntriesRepo.findEntry(season.seasonId, tokenPayload.sub);
          if (playerEntry) {
            const playerRank = await seasonEntriesRepo.getEntryRank(
              season.seasonId,
              tokenPayload.sub
            );
            const playerUser = await userRepo.getUserById(tokenPayload.sub);
            currentPlayer = {
              rank: playerRank ?? totalParticipants,
              userId: playerEntry.userId,
              username: playerUser?.username,
              firstName: playerUser?.firstName,
              bestScore: playerEntry.bestScore,
              totalRaces: playerEntry.totalRaces
            };
          }
        }

        return reply.send({
          seasonId: season.seasonId,
          entries,
          currentPlayer: currentPlayer ?? null,
          totalParticipants
        });
      });
    }
  }

  return app;
}

function parseLeaderboardLimit(request: FastifyRequest): number {
  const raw = request.query;
  if (typeof raw !== "object" || raw === null || !("limit" in raw)) {
    return 100;
  }
  const limitVal = Reflect.get(raw, "limit");
  const parsed =
    typeof limitVal === "string"
      ? Number(limitVal)
      : typeof limitVal === "number"
        ? limitVal
        : NaN;
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
    return parsed;
  }
  return 100;
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
