#!/usr/bin/env bash
# Offline demo. Renders a real narrated demo video from bundled screenshots and prints the Slack message
# Showtime would send. Needs no Copado, Slack, Salesforce org or Mac: only Node 20+ and a network connection
# the first time (npm packages and a headless Chromium for the video cards).
#
#   examples/demo/try-offline.sh
#   SHOWTIME_TTS=silent examples/demo/try-offline.sh     # force silent narration (the default off a Mac)
set -euo pipefail

cd "$(dirname "$0")/../.."
STORY=US-DEMO-001
DEMO=.showtime-demo
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v node >/dev/null || { echo "Node.js 20 or newer is required."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "Node.js 20 or newer is required."; exit 1; }

say "1/4  Installing and building"
[ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
npx --no-install playwright install chromium

say "2/4  Setting up a throwaway project in $DEMO (bundled screenshots, no credentials)"
rm -rf "$DEMO"
mkdir -p "$DEMO/.showtime/shows/$STORY"
cp -R examples/demo/sample/frames "$DEMO/.showtime/shows/$STORY/frames"
cp examples/demo/sample/script.yaml examples/demo/sample/recording.json "$DEMO/.showtime/shows/$STORY/"
# The bundled screenshots count as an already-recorded show, so the lifecycle starts after "recorded".
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$DEMO/.showtime/shows/$STORY/show.json" <<JSON
{"story": "$STORY", "state": "recorded", "history": [
  {"state": "detected", "at": "$NOW"}, {"state": "scripted", "at": "$NOW", "note": "bundled sample"},
  {"state": "recorded", "at": "$NOW", "note": "bundled sample"}]}
JSON
cat > "$DEMO/.showtime/config.json" <<JSON
{
  "uatEnvironment": "UAT",
  "devEnvironment": "INT",
  "crtProjectId": 1,
  "crtJobId": 1,
  "sfAlias": "demo",
  "slack": {"ownersChannel": "#uat-reviews", "releaseChannel": "#release"},
  "voice": {"name": "Samantha", "rate": 165},
  "storyPrefix": "Showtime Demo –"
}
JSON

say "3/4  Narrating and rendering the video"
export SHOWTIME_ROOT="$PWD/$DEMO"
node bin/run.js showtime render "$STORY"

say "4/4  The Slack message Showtime would post (nothing is sent)"
node bin/run.js showtime send "$STORY" --dry-run

VIDEO="$DEMO/.showtime/shows/$STORY/video/$STORY.mp4"
say "Done"
echo "Video:    $VIDEO"
echo "Preview:  ${VIDEO%.mp4}-preview.mp4"
echo "Open it:  open \"$VIDEO\"   (macOS)   |   xdg-open \"$VIDEO\"   (Linux)"
