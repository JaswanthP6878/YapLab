# Shared settings for the laptop-side scripts. Sourced, not executed.

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/.." && pwd)"

if [[ -f "$INFRA_DIR/deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$INFRA_DIR/deploy.env"
fi

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-us-east1-b}"
REGION="${ZONE%-*}"
VM_NAME="${VM_NAME:-yaplab-api}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-small}"
DISK_SIZE_GB="${DISK_SIZE_GB:-20}"
DISK_TYPE="${DISK_TYPE:-pd-standard}"
UV_EXTRAS="${UV_EXTRAS:-anthropic openai elevenlabs data}"
PUBLIC_HOST="${PUBLIC_HOST:-}"

ADDRESS_NAME="$VM_NAME-ip"
NETWORK_TAG=yaplab-web
FIREWALL_RULE=yaplab-allow-web

# Where the VM scripts and each release tarball land before install.sh runs.
REMOTE_INCOMING="yaplab-incoming"

if [[ -z "$PROJECT_ID" ]]; then
  echo "No GCP project: set PROJECT_ID in infra/deploy.env or run 'gcloud config set project <id>'." >&2
  exit 1
fi

vm_ssh() {
  gcloud compute ssh "$VM_NAME" --zone "$ZONE" --project "$PROJECT_ID" --command "$1"
}

vm_scp() {
  # vm_scp <local files...> <remote dir>
  local dest="${*: -1}"
  gcloud compute scp --zone "$ZONE" --project "$PROJECT_ID" "${@:1:$#-1}" "$VM_NAME:$dest"
}

static_ip() {
  gcloud compute addresses describe "$ADDRESS_NAME" --region "$REGION" --project "$PROJECT_ID" \
    --format='value(address)' 2>/dev/null
}

# The public hostname: PUBLIC_HOST if set (a domain whose A record points at the
# static IP), otherwise the free <ip-with-dashes>.sslip.io name for that IP.
public_host() {
  if [[ -n "$PUBLIC_HOST" ]]; then
    echo "$PUBLIC_HOST"
    return
  fi
  local ip
  ip="$(static_ip)"
  [[ -n "$ip" ]] || { echo "No static IP '$ADDRESS_NAME' yet; run infra/gcp/create-vm.sh." >&2; return 1; }
  echo "${ip//./-}.sslip.io"
}
