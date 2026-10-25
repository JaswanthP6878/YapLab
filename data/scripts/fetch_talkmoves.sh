#!/usr/bin/env bash
# Download the official, revision-pinned corpus. Raw files never enter Git.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REVISION="${TALKMOVES_REVISION:-869b9406de268ebab0f1b9a3bccde0b416b97290}"
if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'TALKMOVES_REVISION must be a full lowercase Git commit SHA.\n' >&2
  exit 2
fi
RAW="$ROOT/data/raw"
ARCHIVE="$RAW/talkmoves-$REVISION.tar.gz"
DEST="$RAW/talkmoves"
mkdir -p "$RAW" "$ROOT/data/results"
if [[ ! -f "$ARCHIVE" ]]; then
  curl --fail --location --retry 2 --connect-timeout 20 \
    "https://codeload.github.com/SumnerLab/TalkMoves/tar.gz/$REVISION" \
    --output "$ARCHIVE.partial"
  mv "$ARCHIVE.partial" "$ARCHIVE"
fi
if [[ ! -f "$DEST/.source-revision" ]] || [[ "$(cat "$DEST/.source-revision")" != "$REVISION" ]]; then
  EXTRACT="$(mktemp -d "$RAW/.talkmoves-XXXXXX")"
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$EXTRACT"
  printf '%s\n' "$REVISION" > "$EXTRACT/.source-revision"
  # Keep an older snapshot separate instead of mixing removed upstream files.
  if [[ -e "$DEST" ]]; then mv "$DEST" "$RAW/talkmoves-previous-$(date +%s)"; fi
  mv "$EXTRACT" "$DEST"
fi
python3 "$ROOT/data/scripts/talkmoves_common.py" --manifest "$REVISION" "$ARCHIVE"
