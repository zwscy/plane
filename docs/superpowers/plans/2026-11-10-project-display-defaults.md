# Project display defaults Implementation Plan

> The original implementation record below is retained. Its existing-row migration policy is superseded by the confirmed 2026-11-11 addendum at the end of this document.

> **For agentic workers:** Use subagent-driven-development for the independent backend and frontend tasks, then review their integration.

**Goal:** Share administrator-managed project display defaults while retaining independent personal overrides and filters.

**Architecture:** Store one default snapshot on Project and one follow/override flag on ProjectUserProperty. Resolve effective display settings in the API; never fan out default updates into members' rows. Preserve original personal JSON when restoring follow mode.

**Tech Stack:** Django/DRF/PostgreSQL, React/MobX, existing project preferences endpoints and test suites.

**Spec:** The user's request in this conversation: project defaults for visible fields, column order, task sorting and subtask display; personal override; restore; administrator authorization; old-data preservation and two-account verification.

## Global Constraints

- Only `display_properties`, `order_by`, and `sub_issue` are shared. Layout, grouping, calendar settings, rich/legacy filters and navigation preferences remain personal.
- Existing rows retain their JSON and start as personal overrides; new rows follow project defaults. This conservative migration remains subject to the user's pending compatibility preference.
- An administrator saving defaults never updates any other personal row. Restoring defaults changes the current user's flag, not their preserved personal JSON.
- Scope controls to ordinary project issues; cycle, module, saved/shared views and workspace views retain existing behavior.
- Use current membership/role rules, require active workspace/project membership, and prevent cross-workspace/project access or generic serializer bypass.
- No new dependencies. Back up before deployment; preserve task data, attachments and unrelated services.

## Review Focus

- Partial personal edits must snapshot all currently effective managed settings before applying the delta.
- Full-object legacy PATCH requests containing unchanged managed values must not create an override merely because the keys are present.
- Temporary filters and layout-only changes must not freeze shared settings into a personal override.
- A removed/disabled custom sorting field or incompatible layout must fall back safely without silently altering the follow flag.
- Concurrent default updates and personal edits must not produce mixed snapshots; lock Project before the current personal row.

## Task 1: Backend persistence, resolution and permissions

**Files:** `db/models/project.py`, migration `0127_project_display_defaults.py`, dedicated display-config helper/serializer/view, existing project/user-property serializers and URLs, contract and migration tests.

**Interfaces:**

- `Project.default_display_config: JSON` defaults to `{}`.
- `ProjectUserProperty.use_project_default: bool` defaults to true; migration marks pre-existing rows false without changing other fields.
- Default snapshot: `{display_properties: IIssueDisplayProperties, order_by: string, sub_issue: boolean}`.
- `GET/PUT /api/workspaces/{slug}/projects/{id}/display-config/`: members read, administrators write a validated complete snapshot; PUT rejects unrelated fields.
- `POST /api/workspaces/{slug}/projects/{id}/user-properties/reset-display/`: follows project defaults while preserving raw personal JSON.
- Existing user-properties GET/PATCH returns effective `display_properties` and `display_filters`, plus read-only `use_project_default` and `project_display_config`. Other personal fields remain unchanged.
- PATCH accepts display deltas, merges safely, compares managed values against current effective values, and switches to personal only for a genuine managed change. First override snapshots current effective managed values.

- [ ] Add failing two-account contract tests: follow, override, admin update, restore, raw preservation, filters, full/partial PATCH and failure atomicity.
- [ ] Add permission/invalid-input tests: admin, workspace-admin project member, member, guest, inactive/nonmember, foreign project/workspace, malformed config and custom-field references.
- [ ] Implement additive fields, migration, API resolution and explicit serializer protections.
- [ ] Test the migration against representative old JSON and empty/new rows.
- [ ] Run targeted backend contract/unit checks and migration consistency checks.

## Task 2: Frontend state and controls

**Files:** project service, `IProjectUserPropertiesResponse` types, project filter store, new small project-display control, project display menu and spreadsheet column panel, i18n and store/component tests.

**Interfaces:**

- Service methods: `getProjectDisplayConfig`, `updateProjectDisplayConfig`, `resetProjectDisplayConfig` using Task 1 URLs.
- Store tracks source/default snapshot and pending status per project; consumes the API's effective response after mutations.
- Send actual display deltas rather than accidentally echoing inherited fields on layout-only edits.
- Controls show follow/personal status, an administrator-only save-current-default action, and restore-follow action; scope only to PROJECT store.
- Restore refreshes task data when sorting or subtask visibility changes, preserving rich filters.
- Defaults update on refresh/re-entry; no new polling or realtime infrastructure.

- [ ] Add failing real-store tests for source state, save/restore, rich-filter preservation, pending/error handling and authoritative response consumption.
- [ ] Implement UI actions, role visibility, loading/error feedback and translations.
- [ ] Cover column-order persistence and existing custom sorting/recursive tree behavior.
- [ ] Run relevant frontend tests, types and production build sequentially after shared-package outputs are ready.

## Task 3: Integration and delivery

- [ ] Review both tasks for requirement coverage and authorization bypasses.
- [ ] Back up local data; verify additive migrations preserve legacy configuration and task contents.
- [ ] Verify administrator/member accounts: default follow, independent override, default update isolation, restore and independent temporary filters; prove non-admin save fails.
- [ ] Verify browser controls and saved column order/parent-child layout.
- [ ] Commit and push the feature branch; package verified revisions and update local runtime.
- [ ] Back up dev2, run the migration in a separate API container, update only Plane components that need this change, verify data/services and retain three successful backups.
- [ ] Report deployed revisions, evidence and any remaining limitations without implying a push alone is deployment.

## 2026-11-11 confirmed migration policy (supersedes the original existing-row policy)

- Back up the existing configuration before changing it. Keep any already configured project default; initialize an unset project default from the confirmed current administrator's display configuration before running the new migration. Administrator selection and seeding are deployment steps, not part of the data migration.
- Keep already applied `0127` unchanged. New data migration `0128_project_display_defaults_follow_all` sets `use_project_default=True` once for every existing property row, including soft-deleted rows. Preserve all raw JSON, personal filters/preferences, project defaults, and timestamps.
- Later personal overrides retain the existing request behavior. Ordinary requests, restarts, and later administrator default updates do not repeat the migration or reset those overrides.
- Verify `0127` → `0128` with MigrationExecutor against mixed flags, populated/empty JSON, soft-deleted rows, unchanged project defaults, and a later personal override. Run migration tests explicitly with `--migrations`, separately from the ordinary `--nomigrations` contract suite.
- Reversing `0128` is a no-op because prior flags cannot be inferred safely. Restore the pre-upgrade backup when exact previous follow/personal states are required.
