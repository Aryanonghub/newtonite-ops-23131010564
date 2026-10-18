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
MOHAN=$(login mohan)   # Member, Payments: submits the items, so neither approver is the submitter (four-eyes)

approve() { # $1 = name, $2 = token, $3 = item id, $4 = version
  curl -s -o /dev/null -w "  $1: %{http_code}\n" -X POST "$API/items/$3/transition" \
    -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "{\"to\":\"resolved\",\"version\":$4}"
}
next_waiting() { # Mohan creates, claims and submits a Payments item; prints "id version"
  local id
  id=$(curl -s -X POST "$API/items" -H "Authorization: Bearer $MOHAN" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: race-approve-$RANDOM-$RANDOM-$(date +%s)" \
    -d '{"title":"Race approve demo","type":"task","priority":"high","team_id":1}' | sed 's/^{"id":\([0-9]*\).*/\1/')
  curl -s -o /dev/null -X POST "$API/items/$id/claim" -H "Authorization: Bearer $MOHAN"
  curl -s -o /dev/null -X POST "$API/items/$id/transition" -H "Authorization: Bearer $MOHAN" \
    -H 'Content-Type: application/json' -d '{"to":"awaiting_approval","version":2}'
  echo "$id 3"
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
