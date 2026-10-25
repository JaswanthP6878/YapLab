# Implementation Plan

- [x] 1. Deploy configuration
  - `infra/deploy.env.example` with defaults; `infra/deploy.env` git-ignored; `_common.sh` loads it, resolves the project and region, and derives the public host
  - _Requirements: 1.4, 3.2, 5.3_

- [x] 2. Infrastructure
  - `create-vm.sh`: Compute API, Static_IP (promoting an existing VM's address), firewall rule for 80/443 by tag, Ubuntu 24.04 VM with address and tag; idempotent; prints the URL
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Release shipping
  - [x] 3.1 `deploy.sh`: `git archive HEAD apps/api`, uncommitted-change warning, copy over `gcloud` SSH
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 3.2 `.env` pushed on first deploy or with `--push-env`; stored with mode `600`; CORS set to the Origin; `*.token` files under `infra/` ignored
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 4. VM provisioning and API install
  - [x] 4.1 `setup.sh`: swap under 2 GB, base packages, uv; idempotent
    - _Requirements: 4.5, 7.2_
  - [x] 4.2 `install.sh`: rsync keeping `.env` and `.venv`, revision file, `uv sync --frozen --no-dev` with extras
    - _Requirements: 2.4_
  - [x] 4.3 `yaplab.service`: one uvicorn worker on `127.0.0.1:8000`, restart always, enabled on boot; health wait and log dump on failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. HTTPS on one origin
  - [x] 5.1 `Caddyfile`: site for the Public_Host with automatic HTTPS, API proxy for `/health` and `/sessions/*` including WebSockets
    - _Requirements: 5.1, 5.2_
  - [x] 5.2 Public checks of `/health` and `/` after each deploy
    - _Requirements: 5.4_
  - [x] 5.3 Optional custom domain through `PUBLIC_HOST`, documented
    - _Requirements: 5.3_

- [x] 6. Frontend on the VM
  - [x] 6.1 `deploy.sh` builds the frontend from HEAD with `VITE_API_URL` set to the Origin; `--web-only` and `--api-only`
    - _Requirements: 6.1, 6.5_
  - [x] 6.2 `Caddyfile`: static site with SPA fallback and cache headers
    - _Requirements: 6.2, 6.3_
  - [x] 6.3 `install-web.sh`: Caddy install, publish, render and validate the Caddyfile, restart, wait for HTTPS
    - _Requirements: 6.4_

- [x] 7. Operations and docs
  - `logs.sh` for API and Caddy; `infra/README.md` with custom domain, troubleshooting, costs, and teardown; Deploy section in the root README
  - _Requirements: 7.1, 7.3_

- [x] 8. Retire the Cloudflare Tunnel
  - Remove `tunnel.sh` and `install-tunnel.sh`; replace tunnel references in the docs
  - _Requirements: 5.1, 5.2_

- [ ] 9. Production check
  - [x] 9.1 Deployed environment verified: certificate, `/health`, `/`, `POST /sessions` 201, session WebSocket `hello`
    - _Requirements: 4.3, 5.1, 5.2, 5.4, 6.4_
  - [ ] 9.2 A full live Teaching session in the browser: microphone, hands, question audio, report
    - _Requirements: 5.1, 5.2_
