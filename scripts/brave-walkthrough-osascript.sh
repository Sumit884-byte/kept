#!/usr/bin/env bash
# Drive your *running* Brave Default session (no CDP): open each route, capture the window region.
set -euo pipefail
BASE="${BASE:-https://kept-virid-two.vercel.app}"
OUT="${OUT:-recordings/brave-walkthrough}"
mkdir -p "$OUT"

nav() {
  local id="$1" url="$2" pause="${3:-2.5}"
  osascript -e "tell application \"Brave Browser\" to activate" \
    -e "tell application \"Brave Browser\"
      if (count of windows) = 0 then make new window
      set URL of active tab of front window to \"$url\"
    end tell" >/dev/null
  sleep "$pause"
  screencapture -x "$OUT/${id}.png"
  echo "→ $id $url"
}

nav 01-home "$BASE/" 3
nav 02-sample "$BASE/sample" 3.5
nav 03-start "$BASE/start" 2.5
nav 04-studio "$BASE/studio" 2.5
nav 05-links "$BASE/links" 2.5
nav 06-sign-in "$BASE/sign-in" 2.5
nav 07-join "$BASE/join" 2.5
nav 08-home-again "$BASE/" 2.5

# ~22s capture + pauses ≈ under 3 min with ffmpeg holds
