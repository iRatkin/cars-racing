#!/usr/bin/env bash
BASE_URL="${1:-https://cars-racing-production.up.railway.app}"
USER_ID="${2:-usr_374579614}"

echo "Checking balance for $USER_ID via $BASE_URL"
echo ""

curl -s "$BASE_URL/health" > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "Server not reachable at $BASE_URL"
  exit 1
fi

echo "Server is up. Querying MongoDB directly..."
echo ""

railway run -- node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db();
  const user = await db.collection('users').findOne({ userId: '$USER_ID' });
  if (!user) { console.log('User not found'); process.exit(1); }
  console.log('User:', user.userId);
  console.log('Race Coins:', user.raceCoinsBalance ?? 0);
  console.log('Owned Cars:', (user.ownedCarIds || []).join(', ') || 'none');
  console.log('Garage Rev:', user.garageRevision);
  await client.close();
})();
"
