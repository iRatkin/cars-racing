#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/mafinki}"

mongosh "$MONGO_URI" --eval '
try {
  db.seasons.insertOne({
    seasonId: "season_test_1",
    title: "Test Weekly Sprint",
    mapId: "track_desert",
    entryFee: 10,
    prizePoolShare: 0.5,
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date()
  });
  print("Test season season_test_1 created");
} catch (e) {
  if (e.code === 11000) {
    print("season_test_1 already exists, skipped");
  } else {
    throw e;
  }
}
'
