#!/usr/bin/env bash
# Seeds the sample app ("VIP Case Escalation") into a Showtime playground through Copado, the way a team would:
# create a story, put the metadata on its feature branch, publish, validate, and (only on your say-so) deploy
# INT → UAT. Then load the fictional accounts into the UAT org. It asks before every step that writes.
#
# Needs: the agentia CLI with CICD auth, the Salesforce CLI authorized for the UAT org, and a clone of the
# Copado-connected Git repository.
#
#   SHOWTIME_WORKSPACE=~/path/to/copado-repo-clone  examples/demo/seed.sh [--dry-run]
#
# Environment: DEV_ENV (default INT-SFP), UAT_ENV (default UAT-SFP), SF_ALIAS (default showtime-uat), STORY_TITLE.
set -euo pipefail
cd "$(dirname "$0")"

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
WS="${SHOWTIME_WORKSPACE:?Set SHOWTIME_WORKSPACE to your clone of the Copado-connected repo}"
DEV_ENV="${DEV_ENV:-INT-SFP}"; UAT_ENV="${UAT_ENV:-UAT-SFP}"; ALIAS="${SF_ALIAS:-showtime-uat}"
TITLE="${STORY_TITLE:-Showtime Demo – VIP Case Escalation}"
LOCK="${SHOWTIME_LOCK_FILE:-$HOME/hackathon/.org-busy}"

run() { if [ "$DRY" = "1" ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }
ask() { [ "$DRY" = "1" ] && return 0; read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || { echo "Stopped. Nothing further was changed."; exit 0; }; }
lock() { if [ -e "$LOCK" ]; then echo "The shared Copado lock is held: $(cat "$LOCK")"; echo "Ask the owner before continuing. Not deleting it."; exit 2; fi; [ "$DRY" = "1" ] || echo "showtime: seed $1 started $(date -u +%FT%TZ)" > "$LOCK"; }
unlock() { [ "$DRY" = "1" ] || rm -f "$LOCK"; }
trap unlock EXIT

echo "Story:  $TITLE"; echo "Path:   $DEV_ENV → $UAT_ENV only"; echo "Repo:   $WS"
ask "Create the story and its feature branch in Copado?"
lock "create story"
ENVJSON=$(agentia cicd environment list --json | sed -n '/^{/,$p')
IDS=$(echo "$ENVJSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).result.data.find(x=>x.name===process.argv[1]);if(!e){console.error("Environment not found: "+process.argv[1]);process.exit(1)}console.log(e.id+" "+e.credentials[0].id)})' "$DEV_ENV")
ENV_ID=${IDS% *}; CRED_ID=${IDS#* }
PROJECT=$(agentia cicd project list --json | sed -n '/^{/,$p' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.data[0].id))')
STORY=$(run agentia cicd work create --title "$TITLE" --project "$PROJECT" --source-environment "$ENV_ID" --source-credential "$CRED_ID" \
  --as-a "service manager" --want-to "cases from VIP accounts set to High priority automatically" --so-that "VIP customers are helped first" \
  --acceptance-criteria "Account has a VIP checkbox; a new Case on a VIP account gets Priority High and shows a VIP badge; other accounts unchanged" --json | sed -n '/^{/,$p' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.name))' 2>/dev/null || echo "US-XXXXXXX")
echo "Story: $STORY"
(cd "$WS" && run agentia cicd work set "$STORY")
unlock

echo "Copying the sample app onto the feature branch…"
run mkdir -p "$WS/force-app"; run cp -R force-app/main "$WS/force-app/"
(cd "$WS" && run git add force-app && run git commit -m "$STORY VIP Case Escalation sample app")
ask "Publish to Copado and run a validation (no deployment)?"
lock "publish and validate"
(cd "$WS" && run agentia cicd work publish && { [ "$DRY" = "1" ] || sleep 45; } && run agentia cicd work submit --skip-local-tests --skip-pull-request)
unlock
echo "Check the validation in Copado (Commit, Promote AND Deploy jobs) before deploying."

ask "Deploy $STORY from $DEV_ENV to $UAT_ENV? This changes the $UAT_ENV org."
lock "deploy"
(cd "$WS" && run agentia cicd work submit --deploy --skip-local-tests --skip-pull-request)
unlock

ask "Load the fictional demo accounts into the UAT org ($ALIAS) and assign the permission set?"
run sf org assign permset -n Showtime_VIP_Access -o "$ALIAS" || true
run sf data import tree --files data/accounts.json -o "$ALIAS"
echo "Done. Next: agentia showtime init, then agentia showtime run $STORY"
