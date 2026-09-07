#!/usr/bin/env bash
# Isolated Pi session for docs/demo-*.tape. Copies local auth/models into a
# temp HOME so the GIF does not use the operator's toolbelt.json.
#
# Usage: bash scripts/vhs-demo.sh <query|session|settings>
set -euo pipefail

profile="${1:-session}"
root="$(cd "$(dirname "$0")/.." && pwd)"
demo_home="/tmp/pi-toolbelt-vhs-home"
mkdir -p "$demo_home/.pi/agent"

src="${PI_AGENT_HOME:-$HOME/.pi/agent}"
for f in auth.json models.json models-store.json pi-accounts.json; do
  if [[ -f "$src/$f" ]]; then
    cp "$src/$f" "$demo_home/.pi/agent/$f"
  fi
done

printf '%s\n' '{
  "quietStartup": true,
  "hideThinkingBlock": true,
  "defaultThinkingLevel": "off",
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.6-luna"
}' >"$demo_home/.pi/agent/settings.json"

offline=0
case "$profile" in
  query)
    printf '%s\n' '{ "baseline": ["query_tools", "manage_tools"] }' >"$demo_home/.pi/agent/toolbelt.json"
    ;;
  session)
    printf '%s\n' '{ "baseline": ["query_tools", "manage_tools", "read", "bash"] }' >"$demo_home/.pi/agent/toolbelt.json"
    ;;
  settings)
    printf '%s\n' '{ "baseline": ["read", "bash", "edit", "write"], "search": { "type": "bm25" } }' >"$demo_home/.pi/agent/toolbelt.json"
    offline=1
    ;;
  *)
    echo "usage: $0 query|session|settings" >&2
    exit 2
    ;;
esac

export HOME="$demo_home"
export PI_SKIP_VERSION_CHECK=1
if [[ "$offline" -eq 1 ]]; then
  export PI_OFFLINE=1
fi

model="${PI_DEMO_MODEL:-openai-codex/gpt-5.6-luna}"
cd "$root"

pi_args=(
  --no-session
  --no-extensions
  --no-skills
  --no-prompt-templates
  --no-context-files
  --approve
  --thinking off
  --model "$model"
  -e ./src/index.ts
)
if [[ "$offline" -eq 1 ]]; then
  pi_args=(--offline "${pi_args[@]}")
fi

exec pi "${pi_args[@]}"
