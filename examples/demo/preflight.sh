#!/usr/bin/env bash
# Checks everything a live demo run depends on, so nothing surprises you on camera. Read-only.
#
#   examples/demo/preflight.sh                 # uses the current Showtime project
#   SF_ALIAS=showtime-uat examples/demo/preflight.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
ALIAS="${SF_ALIAS:-showtime-uat}"
LOCK="${SHOWTIME_LOCK_FILE:-$HOME/hackathon/.org-busy}"
FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=s.slice(s.indexOf("{"));const d=JSON.parse(t);'"$1"'}catch(e){console.log("ERR")}})'; }

echo "Showtime preflight"
OUT=$(agentia showtime doctor --json 2>/dev/null | json 'const bad=d.checks.filter(c=>c.status==="fail").map(c=>c.id);const warn=d.checks.filter(c=>c.status==="warn").map(c=>c.id);console.log(bad.length?"FAIL "+bad.join(","):"OK"+(warn.length?" warn:"+warn.join(","):""))')
case "$OUT" in OK*) ok "doctor: all required checks pass ${OUT#OK}";; *) bad "doctor: $OUT (run: agentia showtime doctor)";; esac

pgrep -f "showtime serve" >/dev/null && ok "Review Hub is running" || bad "Review Hub is not running (start: agentia showtime serve)"
[ -e "$LOCK" ] && bad "shared Copado lock is held: $(cat "$LOCK")" || ok "shared Copado lock is free"

N=$(sf data query -o "$ALIAS" -q "SELECT COUNT() FROM Case WHERE Account.Name LIKE '%(fictional%'" --json 2>/dev/null | json 'console.log(d.result.totalSize)')
case "$N" in 0) ok "UAT has no leftover demo Cases";; ERR|"") bad "could not query the UAT org ($ALIAS is not authorized?)";; *) warn "UAT has $N demo Cases on the fictional accounts (clear: examples/demo/reset.sh)";; esac

WAIT=$(agentia showtime watch --dry-run 2>/dev/null | grep -c "is in" || true)
[ "$WAIT" = "0" ] && ok "watch: no story is waiting in UAT" || warn "watch: $WAIT story waiting in UAT; it will start a show as soon as you run watch"

# The staged take: story A (round 1) and B (round 2) waiting in INT-SFP, and the feature not yet in UAT.
A="${DEMO_STORY_A:-US-0000050}"; B="${DEMO_STORY_B:-US-0000051}"
for S in "$A" "$B"; do
  E=$(agentia cicd work get "$S" --json 2>/dev/null | json 'console.log(d.result.sourceEnvironmentName)')
  [ "$E" = "INT-SFP" ] && ok "$S is waiting in INT-SFP" || bad "$S is in '$E', not INT-SFP (the take is one-shot; see docs/demo-runbook.md)"
done
U=$(sf sobject describe --sobject Case -o "$ALIAS" --json 2>/dev/null | json 'console.log(d.result.fields.some(f=>f.name==="Urgent_Badge__c")?"yes":"no")')
[ "$U" = "no" ] && ok "UAT does not have the urgent-case feature yet" || warn "UAT already has the urgent-case feature from an earlier take (the video looks the same)"

[ -z "$(git status --porcelain)" ] && ok "repo has no uncommitted changes" || warn "repo has uncommitted changes"
echo; [ "$FAIL" = "0" ] && echo "Ready." || echo "Fix the ✗ items first."
exit $FAIL
