#!/usr/bin/env bash
# Install the frontend build in ~/yaplab-incoming/web.tar.gz into /var/www/yaplab
# and serve it, with the API, from https://$PUBLIC_HOST via Caddy.
# Expects REVISION and PUBLIC_HOST from deploy.sh.
set -euo pipefail

INCOMING="$HOME/yaplab-incoming"
WEB_DIR=/var/www/yaplab
: "${PUBLIC_HOST:?PUBLIC_HOST is required}"

if ! command -v caddy >/dev/null; then
  sudo apt-get update -q
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq caddy
fi

# Caddy runs as its own user and cannot read home directories, so the site
# lives under /var/www, owned by the deploying user.
sudo install -d -o "$USER" -g "$USER" -m 755 "$WEB_DIR"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
tar -xzf "$INCOMING/web.tar.gz" -C "$staging"
[[ -f "$staging/index.html" ]] || { echo "web.tar.gz has no index.html." >&2; exit 1; }
rsync -a --delete "$staging/" "$WEB_DIR/"
echo "${REVISION:-unknown}" > "$WEB_DIR/REVISION"
chmod -R a+rX "$WEB_DIR"

sed "s#__HOST__#$PUBLIC_HOST#g" "$INCOMING/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo systemctl enable caddy >/dev/null 2>&1
# Restart rather than reload: the admin API is off, and reload depends on it.
sudo systemctl restart caddy

# The first start requests a certificate, which can take a little while.
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null --resolve "$PUBLIC_HOST:443:127.0.0.1" "https://$PUBLIC_HOST/" \
     && curl -fs -o /dev/null --resolve "$PUBLIC_HOST:443:127.0.0.1" "https://$PUBLIC_HOST/health"; then
    echo "Serving https://$PUBLIC_HOST (revision ${REVISION:-unknown})."
    exit 0
  fi
  sleep 2
done
echo "Caddy is not serving https://$PUBLIC_HOST yet; recent logs:" >&2
sudo journalctl -u caddy -n 40 --no-pager >&2
exit 1
