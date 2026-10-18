#!/usr/bin/env bash
# A Lead and an Admin approve the same item. Expect exactly one 200 and one 409, both when
# they click at the same instant and when one clicks later from a page that is out of date.
# Usage: ./scripts/race-approve.sh            (needs `docker compose up` running)
set -euo pipefail
API="${API:-http://localhost:8088/api}"

login() {
  curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1@ops.test\",\"password\":\"password123\"}" | sed 's/.*"token":"\([^"]*\)".*/\1/'
}
PRIYA=$(login priya)   # Lead, Payments
ADA=$(login admin)     # Admin, all teams

approve() { # $1 = name, $2 = token, $3 = item id, $4 = version
  curl -s -o /dev/null -w "  $1: %{http_code}\n" -X POST "$API/items/$3/transition" \
    -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "{\"to\":\"resolved\",\"version\":$4}"
}
next_waiting() { # prints "id version" of an item awaiting approval in Payments
  curl -s "$API/items?status=awaiting_approval&team=1&limit=1" -H "Authorization: Bearer $PRIYA" \
    | sed 's/.*"items":\[{"id":\([0-9]*\).*"version":\([0-9]*\).*/\1 \2/'
}

read -r ID V <<< "$(next_waiting)"
echo "1) Item $ID (version $V): Priya and Ada click Approve at the same instant"
approve Priya "$PRIYA" "$ID" "$V" &
approve Ada "$ADA" "$ID" "$V" &
wait

read -r ID V <<< "$(next_waiting)"
echo "2) Item $ID (version $V): Priya approves, Ada clicks 2 seconds later from her old page"
approve Priya "$PRIYA" "$ID" "$V"
sleep 2
approve Ada "$ADA" "$ID" "$V"
