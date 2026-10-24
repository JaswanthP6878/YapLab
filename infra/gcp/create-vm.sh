#!/usr/bin/env bash
# Create the VM with a static IP and open HTTP/HTTPS to it. Safe to re-run:
# each step is skipped when already done, and an existing VM keeps its IP.
set -euo pipefail
source "$(dirname "$0")/_common.sh"

gcloud services enable compute.googleapis.com --project "$PROJECT_ID"

vm_exists=0
gcloud compute instances describe "$VM_NAME" --zone "$ZONE" --project "$PROJECT_ID" >/dev/null 2>&1 && vm_exists=1

# 1. Static IP, so the URL survives restarts.
if [[ -z "$(static_ip)" ]]; then
  if (( vm_exists )); then
    # Promote the running VM's current IP instead of changing it.
    current="$(gcloud compute instances describe "$VM_NAME" --zone "$ZONE" --project "$PROJECT_ID" \
      --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
    gcloud compute addresses create "$ADDRESS_NAME" --region "$REGION" --project "$PROJECT_ID" --addresses "$current"
  else
    gcloud compute addresses create "$ADDRESS_NAME" --region "$REGION" --project "$PROJECT_ID"
  fi
fi
ip="$(static_ip)"

# 2. Firewall: ports 80 (certificate checks, redirect) and 443 to tagged VMs only.
if ! gcloud compute firewall-rules describe "$FIREWALL_RULE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$FIREWALL_RULE" --project "$PROJECT_ID" \
    --network default --direction INGRESS --action ALLOW --rules tcp:80,tcp:443 \
    --source-ranges 0.0.0.0/0 --target-tags "$NETWORK_TAG"
fi

# 3. The VM itself.
if (( vm_exists )); then
  gcloud compute instances add-tags "$VM_NAME" --zone "$ZONE" --project "$PROJECT_ID" --tags "$NETWORK_TAG"
  echo "VM $VM_NAME already exists; tagged for web traffic."
else
  gcloud compute instances create "$VM_NAME" \
    --project "$PROJECT_ID" \
    --zone "$ZONE" \
    --machine-type "$MACHINE_TYPE" \
    --image-family ubuntu-2404-lts-amd64 \
    --image-project ubuntu-os-cloud \
    --boot-disk-size "${DISK_SIZE_GB}GB" \
    --boot-disk-type "$DISK_TYPE" \
    --address "$ip" \
    --tags "$NETWORK_TAG" \
    --labels app=yaplab \
    --shielded-secure-boot
fi

echo "Static IP: $ip"
echo "App URL:   https://$(public_host)"
echo "Next: infra/gcp/deploy.sh"
