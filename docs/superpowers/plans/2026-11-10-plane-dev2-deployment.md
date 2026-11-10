# Plane dev2 Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deploy the approved custom Plane version freshly on dev2, with isolated resources and verified automatic backups retaining the latest three successful sets.

**Architecture:** Dedicated Docker Compose project `plane-dev2`; loopback proxy `127.0.0.1:8090`; dedicated PostgreSQL if Baota cannot safely provide PostgreSQL. Build amd64 images off-host. Existing services and databases stay independently running. The user configures the reverse proxy.

**Tech Stack:** Docker Compose, PostgreSQL 15, Valkey, RabbitMQ, MinIO-compatible Silo, Python standard-library deployment tools, systemd cgroup isolation and a dedicated systemd backup timer.

**Spec:** User-approved deployment plan in this conversation, revised by the latest instruction: fresh initialization, PostgreSQL preference/fallback, exactly three recent backups, preserve existing services.

## Global Constraints

- Never import the local test database, users, projects, files or field definitions.
- Prefer Baota PostgreSQL when installed and safely usable. Read-only audit found no installed/registered Baota PgSQL; the existing native PostgreSQL 18.6 serves another environment and expanding its listener requires a restart. Use a dedicated Docker PostgreSQL 15 instance under the authorized fallback.
- Keep current business container IDs/start times/restart counts and native PostgreSQL start time unchanged; do not alter existing networks, firewall, Nginx sites, Docker daemon configuration, databases or global image caches.
- Native worktree tool did not return; continue on the clean isolated feature branch `codex/dev2-deployment` in the existing checkout. Source application tree is unchanged from merged `5bff4b510`.
- Set conservative worker concurrency and isolate aggregate new-service CPU/memory using a new `plane-dev2.slice`; measure available memory during startup and stop only this project if resource safety fails.
- Fresh secrets are stored outside Git with restrictive permissions. Back up the new application SECRET_KEY; never print credentials.
- Only loopback port 8090 is published. Domain/TLS/reverse proxy remain user-owned; the final public URL is configured when supplied.
- Backups use an atomic completed set, pg_dump plus consistent object-storage/config state, verification before rotation, latest 3 successful sets. Failed/partial runs never prune successful history.
- Restore verification uses an explicitly disposable database and separate file extraction; no restore over live data.
- No unrelated cleanup, system package upgrade, global Docker prune or existing-service restart.

## Tasks

### Task 1: Preflight and isolation

- [x] Capture existing containers, native PG start time, memory, ports and business HTTP baseline.
- [x] Verify fallback decision, cgroup v2/systemd support, Docker architecture and unused port.
- [x] Establish feature branch and private execution ledger.

### Task 2: Runtime and amd64 artifacts

- [x] Add `deploy/dev2/compose.yaml`, `manage.sh`, environment example, build tooling and slice configuration.
- [x] Apply one worker and bounded memory/CPU/logging; preserve auxiliary image versions and proxy routes already tested locally.
- [x] Validate Compose and build amd64 app images off-host without retagging the local experience images.
- [x] Transfer immutable image artifacts and deployment files; start only new infrastructure, migrate empty DB and start app services under resource monitoring.

### Task 3: Backups and restore

- [x] Write tests first for three-set retention, partial failures, symlinks and service-state recovery.
- [x] Implement restricted backup/restore tooling and encrypted configuration backup using existing image cryptography.
- [x] Enable one daily 03:30 Asia/Shanghai systemd backup timer after real recovery acceptance, preserving all existing scheduled tasks. Baota task registration was audited and would restart shared cron, so it is not used.
- [x] Produce and verify real backup sets, verify retention, and restore into an isolated disposable DB/file tree.
- [x] Store the initial off-host copy and backup key securely on the local computer; continuous off-host destination is not yet configured.

### Task 4: Acceptance and delivery

- [x] Verify HTTP/API readiness, empty application state, custom-field migration and application source/image versions.
- [x] Verify existing services/resources match baseline and no published data-service ports.
- [x] Independently review deployment/backup changes; fix functional risks with tests.
- [x] Prepare reviewed deployment files and handoff instructions: loopback target, directories, backup timer, recovery and domain/bootstrap steps. Commit/push receipts are recorded after GitHub verification.

## Review Focus

- Retention only removes verified complete backup sets belonging to this deployment.
- Any failed backup resumes exactly the app services it paused, without starting previously stopped services.
- A saved DB dump and attachment snapshot represent one quiesced write window.
- New container resource pressure cannot consume the existing business services' memory budget.
- Fresh deployment and restore testing never reuse or overwrite existing native/Dify/local test databases.
