#!/usr/bin/env bash
# Follow logs on the VM: the API by default, or Caddy (HTTPS, frontend) with `logs.sh web`.
set -euo pipefail
source "$(dirname "$0")/_common.sh"

unit=yaplab
[[ "${1:-}" == "web" ]] && unit=caddy
vm_ssh "sudo journalctl -u $unit -n 100 -f"
