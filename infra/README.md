# Deploying YapLab

Everything runs on one small GCP VM with a static IP. Caddy serves the app at
`https://<host>`: it gets the HTTPS certificate itself, serves the frontend, and
proxies the API (including WebSockets). No domain is needed: by default the
host is the free `<ip-with-dashes>.sslip.io` name for the VM's IP.

```
Browser ──► https://35-229-50-202.sslip.io ──► Caddy :443 ─┬─ /health, /sessions/* ──► uvicorn 127.0.0.1:8000
                                                           └─ everything else ──────► /var/www/yaplab (frontend)
```

- **One origin.** The frontend and API share a URL, so there is no CORS to configure and the microphone works (browsers require HTTPS).
- **Only 80 and 443 are open**, to the VM's `yaplab-web` tag; the API itself listens on localhost.
- **One API process.** Sessions live in memory, so the API runs as a single uvicorn worker. An API deploy ends live sessions; a frontend-only deploy does not.
- **No GitHub access on the VM.** The repo is private, so `deploy.sh` sends `git archive HEAD apps/api` and a frontend build made from HEAD on your machine.
- **Secrets** stay in the repo-root `.env`. It is copied to the VM over SSH and stored with mode `600`.

## Layout

| File | Runs on | Does |
|---|---|---|
| `deploy.env.example` | — | Settings for the scripts; copy to `deploy.env` (git-ignored) |
| `gcp/create-vm.sh` | laptop | Static IP, firewall rule for 80/443, and the VM (Ubuntu 24.04); every step skipped when already done |
| `gcp/deploy.sh` | laptop | Builds and ships HEAD (API and/or frontend), installs on the VM, checks the public URL |
| `gcp/logs.sh` | laptop | Follows API logs (`logs.sh web` for Caddy) |
| `vm/setup.sh` | VM | Swap on small machines, base packages, uv (idempotent) |
| `vm/install.sh` | VM | Unpacks the API, keeps `.env`, sets CORS, `uv sync`, installs the unit, restarts, waits for health |
| `vm/install-web.sh` | VM | Installs Caddy, publishes the build to `/var/www/yaplab`, writes the Caddyfile for the host, waits for HTTPS |
| `vm/Caddyfile` | VM | HTTPS site: API proxy for `/health` and `/sessions/*`, SPA fallback, cache headers |
| `vm/yaplab.service` | VM | systemd unit: one uvicorn worker on `127.0.0.1:8000` |

## First deploy

Prerequisites: `gcloud` signed in (`gcloud auth login`), Node.js for the frontend build, and a GCP project with billing.

```bash
cp infra/deploy.env.example infra/deploy.env   # set PROJECT_ID
infra/gcp/create-vm.sh                          # prints the app URL
infra/gcp/deploy.sh                             # ends with "Public check passed" and the URL
```

Make sure the repo-root `.env` has your production keys first (`FRONTROW_LLM`, the provider key, `ELEVENLABS_API_KEY`, `FRONTROW_TTS`, `FRONTROW_STT`, ...). The first deploy copies it to the VM.

### Using your own domain instead

Add a DNS **A record** for, say, `yaplab.example.com` pointing at the static IP that `create-vm.sh` printed. On Cloudflare, set it to **DNS only** (grey cloud) so Caddy can get the certificate. Then set `PUBLIC_HOST=yaplab.example.com` in `infra/deploy.env` and run `infra/gcp/deploy.sh`. The frontend is rebuilt for the new URL, Caddy gets a certificate for it, and the sslip.io name stops being served.

## Everyday use

```bash
infra/gcp/deploy.sh               # ship the committed API and frontend
infra/gcp/deploy.sh --web-only    # frontend only; live sessions keep running
infra/gcp/deploy.sh --api-only    # API only
infra/gcp/deploy.sh --push-env    # also replace the VM's .env with your local one
infra/gcp/logs.sh                 # API logs; `logs.sh web` for Caddy
```

Only committed code is deployed. Avoid API deploys during a demo: a restart ends live sessions.

## Troubleshooting

- **Public check failed / certificate errors:** run `infra/gcp/logs.sh web`. Caddy needs ports 80 and 443 reachable (firewall rule `yaplab-allow-web`, VM tag `yaplab-web`), and the hostname must resolve to the static IP.
- **App loads but stays in demo mode:** the frontend was built without the API URL; run `infra/gcp/deploy.sh --web-only`.
- **API errors:** `infra/gcp/logs.sh`.

## Sizing

`e2-small` (2 GB) is the default and handles a demo with dozens of concurrent sessions; the work is mostly waiting on LLM and ElevenLabs calls. `e2-micro` (1 GB) is free in `us-east1`, `us-central1`, and `us-west1` with a `pd-standard` disk; `setup.sh` adds a 1 GB swap file on machines under 2 GB. Don't use Spot VMs: they can be stopped mid-session. To resize, stop the VM, change its machine type, and start it again; the static IP stays.

## Costs, access, teardown

Anyone who can open the app spends your LLM and ElevenLabs credits, so set spending limits with the providers. A static IP costs a little while the VM runs and a little more while it is stopped. To remove everything:

```bash
gcloud compute instances delete yaplab-api --zone us-east1-b
gcloud compute addresses delete yaplab-api-ip --region us-east1
gcloud compute firewall-rules delete yaplab-allow-web
```
