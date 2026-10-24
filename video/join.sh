#!/usr/bin/env bash
# Append the demo recording to the rendered intro.
#
#   ./join.sh path/to/demo.mp4 [out/yaplab.mp4]
#
# The intro has no audio track, so silence is laid under it; the demo is scaled
# and padded to 1920x1080 at 30 fps whatever it was recorded at.
set -euo pipefail
cd "$(dirname "$0")"

demo="${1:?usage: ./join.sh path/to/demo.mp4 [output.mp4]}"
out="${2:-out/yaplab.mp4}"
intro=out/yaplab-intro.mp4
[[ -f "$intro" ]] || { echo "Render the intro first: npm run render" >&2; exit 1; }

ffmpeg -y -i "$intro" -i "$demo" -f lavfi -i anullsrc=r=48000:cl=stereo -filter_complex "\
[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[dv];\
[0:v]setsar=1[iv];\
[2:a]atrim=duration=90[ia];\
[1:a]aresample=48000[da];\
[iv][ia][dv][da]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k "$out"

echo "Wrote $out"
