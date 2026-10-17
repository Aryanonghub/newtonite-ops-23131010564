#!/usr/bin/env bash
# Two users claim the same Open item at the same instant. Expect exactly one 200 and one 409.
# Usage: ./scripts/race-claim.sh            (needs `docker compose up` running)
set -euo pipefail
API="${API:-http://localhost:8088/api}"

login() {
  curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1@ops.test\",\"password\":\"password123\"}" | sed 's/.*"token":"\([^"]*\)".*/\1/'
}
SARA=$(login sara)
MOHAN=$(login mohan)

# First Open item in Payments (team 1), where both are Members.
ID=$(curl -s "$API/items?status=open&team=1&limit=1" -H "Authorization: Bearer $SARA" \
  | sed 's/.*"items":\[{"id":\([0-9]*\).*/\1/')

echo "Item $ID: Sara and Mohan claim it at the same moment"
# '&' starts both requests in the background so they run in parallel; 'wait' waits for both.
curl -s -o /dev/null -w "  Sara:  %{http_code}\n" -X POST "$API/items/$ID/claim" -H "Authorization: Bearer $SARA" &
curl -s -o /dev/null -w "  Mohan: %{http_code}\n" -X POST "$API/items/$ID/claim" -H "Authorization: Bearer $MOHAN" &
wait
echo "See who won: http://localhost:8088/items/$ID"
