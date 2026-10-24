#!/usr/bin/env bash
# Install the release in ~/yaplab-incoming/app.tar.gz into ~/yaplab/app,
# sync dependencies, (re)install the systemd unit, and restart the API.
# Expects REVISION, APP_ORIGIN, and UV_EXTRAS from deploy.sh.
set -euo pipefail

INCOMING="$HOME/yaplab-incoming"
APP_DIR="$HOME/yaplab/app"
UV="$HOME/.local/bin/uv"

mkdir -p "$APP_DIR"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
tar -xzf "$INCOMING/app.tar.gz" -C "$staging"
# Keep the VM's .env and virtualenv; everything else matches the release.
rsync -a --delete --exclude '/.env' --exclude '/apps/api/.venv/' "$staging/" "$APP_DIR/"
echo "${REVISION:-unknown}" > "$APP_DIR/REVISION"

if [[ -f "$INCOMING/.env" ]]; then
  install -m 600 "$INCOMING/.env" "$APP_DIR/.env"
  rm -f "$INCOMING/.env"
fi
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "No $APP_DIR/.env; run deploy.sh --push-env." >&2
  exit 1
fi
if [[ -n "${APP_ORIGIN:-}" ]]; then
  if grep -q '^FRONTROW_CORS_ORIGINS=' "$APP_DIR/.env"; then
    sed -i "s#^FRONTROW_CORS_ORIGINS=.*#FRONTROW_CORS_ORIGINS=$APP_ORIGIN#" "$APP_DIR/.env"
  else
    printf '\nFRONTROW_CORS_ORIGINS=%s\n' "$APP_ORIGIN" >> "$APP_DIR/.env"
  fi
fi

extras=()
for extra in ${UV_EXTRAS:-}; do extras+=(--extra "$extra"); done
(cd "$APP_DIR/apps/api" && "$UV" sync --frozen --no-dev "${extras[@]}")

sed -e "s#__USER__#$USER#g" -e "s#__APP_DIR__#$APP_DIR#g" "$INCOMING/yaplab.service" \
  | sudo tee /etc/systemd/system/yaplab.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable yaplab >/dev/null 2>&1
sudo systemctl restart yaplab

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "API healthy on the VM (revision ${REVISION:-unknown})."
    exit 0
  fi
  sleep 1
done
echo "API did not become healthy; recent logs:" >&2
sudo journalctl -u yaplab -n 40 --no-pager >&2
exit 1
