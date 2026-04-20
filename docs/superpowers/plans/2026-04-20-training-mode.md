# Training Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free seasonal training runs plus a separate personal training highscore without changing ranked season behavior.

**Architecture:** Extend the existing race-run journal with a `mode` discriminator, add a new Mongo-backed repository for seasonal training progress, and wire separate training endpoints into the existing season routes. Ranked flows keep using `seasonEntries`; training flows use a dedicated `seasonTrainingEntries` collection and their own atomic finish helper.

**Tech Stack:** TypeScript ESM, Fastify 5, MongoDB driver 6, Zod, OpenAPI YAML

---

### Task 1: Extend season persistence for training progress

**Files:**
- Create: `src/modules/seasons/season-training-entries-repository.ts`
- Create: `src/infra/mongo/season-training-entries-repository.ts`
- Modify: `src/modules/seasons/seasons-domain.ts`
- Modify: `src/modules/seasons/race-runs-repository.ts`
- Modify: `src/modules/seasons/season-atomic.ts`
- Modify: `src/infra/mongo/race-runs-repository.ts`
- Modify: `src/infra/mongo/season-mongo-transactions.ts`
- Modify: `src/infra/mongo/indexes.ts`

- [ ] **Step 1: Add training domain types and repository contract**

```ts
export type RaceRunMode = "ranked" | "training";

export interface SeasonTrainingEntry {
  entryId: string;
  seasonId: string;
  userId: string;
  bestScore: number;
  totalRaces: number;
  createdAt: Date;
}
```

- [ ] **Step 2: Extend race runs with mode support**

```ts
export interface CreateRaceRunInput {
  seasonId: string;
  userId: string;
  seed: string;
  mode: RaceRunMode;
}
```

- [ ] **Step 3: Add Mongo repository and atomic training finish helper**

```ts
export async function finishTrainingRaceAtomicallyInMongo(
  client: MongoClient,
  input: { raceId: string; score: number; seasonId: string; userId: string }
): Promise<FinishTrainingRaceAtomicResult> { /* ... */ }
```

- [ ] **Step 4: Register new indexes**

Run: `npm run typecheck`
Expected: PASS after the new repository and index definitions compile together

### Task 2: Wire training season routes into the app runtime

**Files:**
- Modify: `src/app.ts`
- Modify: `src/runtime.ts`

- [ ] **Step 1: Inject the training repository into app dependencies**

```ts
seasonTrainingEntriesRepository?: SeasonTrainingEntriesRepository;
```

- [ ] **Step 2: Extend season list/detail responses with training summary**

```ts
training: {
  bestScore: trainingEntry?.bestScore ?? null,
  totalRaces: trainingEntry?.totalRaces ?? 0
}
```

- [ ] **Step 3: Add training start, finish, and personal-highscore routes**

```ts
app.post("/v1/seasons/:seasonId/training-races/start", async (...) => { /* ... */ });
app.post("/v1/seasons/:seasonId/training-races/finish", async (...) => { /* ... */ });
app.get("/v1/seasons/:seasonId/training-highscore", async (...) => { /* ... */ });
```

- [ ] **Step 4: Keep ranked flow behavior unchanged**

Run: `npm run typecheck`
Expected: PASS with the new route contracts and dependency wiring

### Task 3: Update API documentation and verify build

**Files:**
- Modify: `swagger.yaml`

- [ ] **Step 1: Document the training endpoints and schemas**

```yaml
TrainingProgress:
  type: object
  required: [bestScore, totalRaces]
```

- [ ] **Step 2: Extend season response schemas with `training`**

```yaml
training:
  $ref: "#/components/schemas/TrainingProgress"
```

- [ ] **Step 3: Run final verification**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS
