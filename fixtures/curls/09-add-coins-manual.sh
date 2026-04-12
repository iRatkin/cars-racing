#!/usr/bin/env bash
AMOUNT="${1:-100}"
USER_ID="${2:-usr_374579614}"

echo "Adding $AMOUNT race coins to $USER_ID"
echo ""

docker compose exec mongo mongosh mafinki --quiet --eval "
  const result = db.users.findOneAndUpdate(
    { userId: '$USER_ID' },
    { \$inc: { raceCoinsBalance: $AMOUNT } },
    { returnDocument: 'after' }
  );
  printjson({ userId: result.userId, raceCoinsBalance: result.raceCoinsBalance });
"
