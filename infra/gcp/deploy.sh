#!/usr/bin/env bash
# Ship the committed code (HEAD) to the VM: the backend and the built frontend.
#
#   infra/gcp/deploy.sh             # deploy API and web; copies .env only on first deploy
#   infra/gcp/deploy.sh --api-only  # backend only
#   infra/gcp/deploy.sh --web-only  # frontend only (no API restart)
#   infra/gcp/deploy.sh --push-env  # also replace the VM's .env with the local one
#
# Everything is served from one origin, https://<host>: Caddy serves the
# frontend and proxies /health and /sessions (including WebSockets) to the API.
# The repo is private, so the VM never clones it: we send `git archive HEAD`
# for the backend and a frontend build made from HEAD on this machine.
set -euo pipefail
source "$(dirname "$0")/_common.sh"

push_env=0 api=1 web=1
for arg in "$@"; do
  case "$arg" in
    --push-env) push_env=1 ;;
    --api-only) web=0 ;;
    --web-only) api=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
if (( !api && !web )); then
  echo "--api-only and --web-only together leave nothing to deploy." >&2
  exit 2
fi

host="$(public_host)"
origin="https://$host"

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- apps/api frontend)" ]]; then
  echo "Note: apps/api or frontend has uncommitted changes; only the committed HEAD is deployed." >&2
fi
revision="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
files=("$INFRA_DIR"/vm/*)

if (( api )); then
  git -C "$REPO_ROOT" archive --format=tar.gz -o "$work/app.tar.gz" HEAD apps/api
  files+=("$work/app.tar.gz")
fi

if (( web )); then
  echo "Building the frontend from $revision with VITE_API_URL=$origin ..."
  mkdir -p "$work/src"
  git -C "$REPO_ROOT" archive HEAD frontend | tar -x -C "$work/src"
  (cd "$work/src/frontend" && npm ci --no-audit --no-fund --loglevel=error \
    && VITE_API_URL="$origin" npm run build --silent)
  tar -czf "$work/web.tar.gz" -C "$work/src/frontend/dist" .
  files+=("$work/web.tar.gz")
fi

vm_ssh "mkdir -p ~/$REMOTE_INCOMING"

if (( api )); then
  if (( !push_env )) && ! vm_ssh "test -f ~/yaplab/app/.env" 2>/dev/null; then
    echo "No .env on the VM yet; copying the local one."
    push_env=1
  fi
  if (( push_env )); then
    if [[ ! -f "$REPO_ROOT/.env" ]]; then
      echo "Missing $REPO_ROOT/.env (copy .env.example and fill in the keys)." >&2
      exit 1
    fi
    files+=("$REPO_ROOT/.env")
  fi
fi
vm_scp "${files[@]}" "$REMOTE_INCOMING/"

steps="bash ~/$REMOTE_INCOMING/setup.sh"
(( api )) && steps+=" && REVISION='$revision' APP_ORIGIN='$origin' UV_EXTRAS='$UV_EXTRAS' bash ~/$REMOTE_INCOMING/install.sh"
(( web )) && steps+=" && REVISION='$revision' PUBLIC_HOST='$host' bash ~/$REMOTE_INCOMING/install-web.sh"
vm_ssh "$steps"

check() {
  if curl -fsS --max-time 15 -o /dev/null "$1"; then
    echo "Public check passed: $1"
  else
    echo "Public check failed: $1 (see infra/README.md, Troubleshooting)." >&2
  fi
}
check "$origin/health"
(( web )) && check "$origin/"
echo "Deployed $revision. Open $origin"
