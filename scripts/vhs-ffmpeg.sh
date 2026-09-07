#!/usr/bin/env bash
# Drop-in ffmpeg for VHS. Overlay sources (window bar, margin fill) default
# to 25fps and clamp the MP4. This stamps Set Framerate onto every input and
# the output. Encoder stays libx264: VideoToolbox at a small bitrate wrecks
# TUI text, and unconstrained VideoToolbox files are huge.
set -euo pipefail

real="${REAL_FFMPEG:-/opt/homebrew/bin/ffmpeg}"
if [[ ! -x "$real" ]]; then
  real="$(command -v ffmpeg)"
fi

exec python3 - "$real" "$@" <<'PY'
import sys, subprocess

ffmpeg, args = sys.argv[1], sys.argv[2:]

rate = None
i = 0
while i < len(args) - 1:
    if args[i] == "-r":
        rate = args[i + 1]
        break
    i += 1

out = []
i = 0
while i < len(args):
    a = args[i]
    if a == "-i" and rate is not None:
        if len(out) < 2 or out[-2] != "-r":
            out.extend(["-r", rate])
    out.append(a)
    i += 1

if rate is not None and (len(out) < 2 or out[-2] != "-r"):
    out.insert(-1, "-r")
    out.insert(-1, rate)

raise SystemExit(subprocess.call([ffmpeg, *out]))
PY
