#!/usr/bin/env bash
# One-time VM preparation, safe to re-run on every deploy: swap on small
# machines, base packages, and uv.
set -euo pipefail

# e2-micro has 1 GB of RAM; uv sync and the provider SDKs need headroom.
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if (( mem_kb < 2000000 )) && ! swapon --show | grep -q .; then
  echo "Adding a 1 GB swap file."
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

missing=()
for pkg in curl rsync ca-certificates; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if (( ${#missing[@]} )); then
  sudo apt-get update -q
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq "${missing[@]}"
fi

if [[ ! -x "$HOME/.local/bin/uv" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
