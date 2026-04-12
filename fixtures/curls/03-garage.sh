#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN=$(cat "$SCRIPT_DIR/../token.txt" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "No token found. Run 02-auth.sh first."
  exit 1
fi

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/v1/garage | python3 -m json.tool
