#!/usr/bin/env bash
# Run vhs with a PATH ffmpeg wrapper so MP4s keep Set Framerate and use
# VideoToolbox. Usage: bash scripts/vhs-record.sh docs/demo-query.tape
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
bindir="$(mktemp -d "${TMPDIR:-/tmp}/vhs-ffmpeg.XXXXXX")"
trap 'rm -rf "$bindir"' EXIT
ln -s "$root/scripts/vhs-ffmpeg.sh" "$bindir/ffmpeg"

export PATH="$bindir:$PATH"
export REAL_FFMPEG="${REAL_FFMPEG:-/opt/homebrew/bin/ffmpeg}"
exec vhs "$@"
