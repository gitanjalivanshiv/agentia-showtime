#!/usr/bin/env bash
# Puts the demo org back to its starting data: deletes the Cases on the fictional demo accounts (the ones Showtime
# recordings create). Keeps the accounts, and never touches any other Case in the org. Asks first.
#
#   examples/demo/reset.sh            # list, ask, delete
#   examples/demo/reset.sh --yes      # no question
#   SF_ALIAS=my-uat examples/demo/reset.sh
set -euo pipefail
ALIAS="${SF_ALIAS:-showtime-uat}"
# Only Cases on the fictional demo accounts, whatever their subject. Other Cases in the org are never touched.
Q="SELECT Id FROM Case WHERE Account.Name LIKE '%(fictional%'"

command -v sf >/dev/null || { echo "The Salesforce CLI (sf) is required."; exit 1; }
IDS=$(sf data query -o "$ALIAS" -q "$Q" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result.records;console.log(r.map(x=>x.Id).join(" "))})')
N=$(echo "$IDS" | wc -w | tr -d ' ')
echo "Org alias: $ALIAS. Demo Cases found: $N"
[ "$N" = "0" ] && { echo "Nothing to reset."; exit 0; }
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Delete these $N Cases (fictional demo data only)? [y/N] " a
  [ "$a" = "y" ] || { echo "Left everything as it was."; exit 0; }
fi
for id in $IDS; do sf data delete record -o "$ALIAS" -s Case -i "$id" >/dev/null; done
echo "Deleted $N Cases. The fictional accounts are untouched."
