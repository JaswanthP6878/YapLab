# Requirements Document

## Introduction

This document specifies how YapLab is deployed. Everything runs on one small Google Cloud VM with a static IP. Caddy serves the app from a single HTTPS origin: it obtains the certificate itself, serves the frontend build, and proxies the API, including WebSockets, to a single long-lived backend process. Without a domain, the hostname is the free `<ip-with-dashes>.sslip.io` name for the static IP. The deployment is driven by base scripts in `infra/` that a developer runs from a laptop with `gcloud`. The repository is private, so the VM receives packaged releases instead of cloning the repository.

## Glossary

- **Deploy_Scripts**: The laptop-side scripts in `infra/gcp/`.
- **VM_Scripts**: The scripts, Caddyfile, and systemd unit in `infra/vm/` that run on the VM.
- **VM**: The Google Compute Engine instance that runs the app.
- **Static_IP**: The reserved regional address `<vm-name>-ip` attached to the VM.
- **Public_Host**: `PUBLIC_HOST` from Deploy_Config if set, otherwise `<Static_IP with dashes>.sslip.io`.
- **Origin**: `https://<Public_Host>`, the single public URL for the frontend and the API.
- **Release**: `git archive HEAD apps/api`, the committed backend at the current commit.
- **API_Service**: The systemd service `yaplab` running uvicorn for the backend.
- **Web_Build**: The frontend built from the current commit with `VITE_API_URL` set to the Origin.
- **Web_Server**: Caddy on the VM, serving the Origin.
- **Deploy_Config**: `infra/deploy.env`, a git-ignored file with the project, zone, VM name, machine type, extras, and optional Public_Host.

## Requirements

### Requirement 1: Creating the Infrastructure

**User Story:** As a developer, I want one command to create the server and its address, so that setup is fast and repeatable.

#### Acceptance Criteria

1. WHEN the developer runs `create-vm.sh`, THE Deploy_Scripts SHALL reserve the Static_IP, allow TCP 80 and 443 only to VMs tagged `yaplab-web`, and create an Ubuntu 24.04 VM with that address and tag, the configured machine type (default `e2-small`), zone (default `us-east1-b`), and boot disk.
2. IF a step is already done, THEN THE Deploy_Scripts SHALL skip it; IF the VM already exists without a Static_IP, THEN THE Deploy_Scripts SHALL promote its current address so the URL does not change.
3. WHEN it finishes, THE Deploy_Scripts SHALL print the Static_IP and the Origin.
4. WHERE no project is configured, THE Deploy_Scripts SHALL use the active `gcloud` project, and SHALL stop with a clear message if there is none.

### Requirement 2: Shipping a Release

**User Story:** As a developer, I want to deploy exactly what I committed, so that the server never runs half-finished work.

#### Acceptance Criteria

1. WHEN the developer runs `deploy.sh`, THE Deploy_Scripts SHALL package the Release from the current commit and copy it to the VM over `gcloud` SSH.
2. IF `apps/api` or `frontend` has uncommitted changes, THEN THE Deploy_Scripts SHALL warn that only the committed code is deployed.
3. THE VM SHALL NOT need access to the Git repository.
4. WHEN a Release is installed, THE VM_Scripts SHALL replace the previous application files while keeping the VM's `.env` and virtual environment, record the deployed revision, and install dependencies from the lockfile with the configured extras and without development dependencies.

### Requirement 3: Secrets and Configuration

**User Story:** As a developer, I want keys handled safely, so that deploying never leaks them.

#### Acceptance Criteria

1. WHEN the VM has no `.env`, or the developer passes `--push-env`, THE Deploy_Scripts SHALL copy the repo-root `.env` to the VM, where THE VM_Scripts SHALL store it with mode `600`.
2. THE Deploy_Scripts SHALL keep Deploy_Config free of secrets and out of version control.
3. WHEN the API is deployed, THE VM_Scripts SHALL set `FRONTROW_CORS_ORIGINS` in the VM's `.env` to the Origin.
4. THE repository SHALL ignore `*.token` files under `infra/`, so that credentials saved there are never committed.

### Requirement 4: Running the API

**User Story:** As a presenter, I want the backend always available, so that a session can start at any time.

#### Acceptance Criteria

1. THE API_Service SHALL run one uvicorn worker bound to `127.0.0.1:8000`, so that sessions stay in one process and the API is reachable only through the Web_Server.
2. THE API_Service SHALL start on boot and restart after a crash.
3. WHEN a Release is installed, THE VM_Scripts SHALL restart the API_Service and wait up to 30 seconds for `/health` to succeed.
4. IF the API does not become healthy, THEN THE VM_Scripts SHALL print recent service logs and fail the deploy.
5. WHERE the VM has less than 2 GB of memory, THE VM_Scripts SHALL add a 1 GB swap file once.

### Requirement 5: Public HTTPS Access

**User Story:** As a presenter, I want the app at one HTTPS URL without buying a domain, so that the microphone works and the link is easy to share.

#### Acceptance Criteria

1. THE Web_Server SHALL serve the Origin over HTTPS with a certificate it obtains and renews automatically, and SHALL redirect HTTP to HTTPS.
2. THE Web_Server SHALL proxy `/health`, `/sessions`, and `/sessions/*`, including WebSocket upgrades, to the API_Service.
3. WHERE `PUBLIC_HOST` is set to a domain whose A record points at the Static_IP, THE Deploy_Scripts SHALL use that domain instead of the sslip.io name.
4. WHEN a deploy finishes, THE Deploy_Scripts SHALL check the Origin's `/health` and, when the frontend was deployed, its root, and report the results.

### Requirement 6: Serving the Frontend

**User Story:** As a presenter, I want the app served from the same server as the API, so that there is one place to deploy and nothing cross-origin to configure.

#### Acceptance Criteria

1. WHEN the developer deploys the frontend, THE Deploy_Scripts SHALL build it from the current commit on the developer's machine with `VITE_API_URL` set to the Origin.
2. THE Web_Server SHALL serve the Web_Build from `/var/www/yaplab` for every path not proxied to the API, falling back to `index.html` for unknown paths.
3. THE Web_Server SHALL mark fingerprinted `/assets/*` files as cacheable for a year and all other responses as `no-cache`, so that a deploy takes effect immediately.
4. WHEN a Web_Build is installed, THE VM_Scripts SHALL install Caddy if needed, replace the previous build, write and validate the Caddyfile for the Public_Host, restart Caddy, and fail with recent logs if the Origin and its `/health` are not served over HTTPS within 120 seconds.
5. WHERE the developer passes `--web-only` or `--api-only`, THE Deploy_Scripts SHALL deploy only that part; a frontend-only deploy SHALL NOT restart the API_Service.

### Requirement 7: Operating the Deployment

**User Story:** As a developer, I want simple day-to-day commands, so that I can debug and update quickly.

#### Acceptance Criteria

1. WHEN the developer runs `logs.sh`, THE Deploy_Scripts SHALL follow the API_Service logs, or the Web_Server logs with `logs.sh web`.
2. THE VM_Scripts SHALL be safe to run on every deploy, repeating no completed one-time setup.
3. THE repository SHALL document the first deploy, using a custom domain, everyday commands, troubleshooting, sizing, costs, and teardown in `infra/README.md`.
