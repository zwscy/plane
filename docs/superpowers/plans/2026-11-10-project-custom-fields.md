# Plane Project Custom Fields Implementation Plan

## Goal and constraints

Deliver project-admin managed fields in the zwscy/plane fork; native project state management stays unchanged. Source /Users/work/Documents/本电脑/plane, branch codex/custom-fields, base 618d0eb74658329a6f6e92434ac54231422c5b96. Preserve the localhost:8090 demo data and Chinese profile. Push the tested branch to GitHub; dev2 deployment is gated on the user explicitly confirming their complete testing has passed.

## Shared contract

- Project collection /api/workspaces/{slug}/projects/{project_id}/custom-fields/ returns an array; POST creates; detail /{field_id}/ supports PATCH and DELETE (soft deletion).
- Definition: id, project_id, name, description, field_type, options, sort_order, is_active, is_type_locked. options are [{id:UUID,name:string,is_active:boolean}], array order is option order. Other standard model audit fields may be present.
- Types: text, textarea, integer, decimal, date, boolean, select, multi_select, member, members, labels, state, priority, cycle, modules, estimate.
- Values: null or JSON string/number/boolean/string-array as appropriate; date YYYY-MM-DD; select and entity references use stable IDs, priority uses the existing enum. Business references are independent values and do not mutate built-in task relations.
- Issue adds custom_fields: Record<fieldUUID,value>, defaults {}. PATCH merges supplied keys atomically, null clears that key. App and public API writes share validation; root list/detail/sub-issue reads expose values.
- Query ordering key custom_fields\_\_{fieldUUID}, with optional leading -; validate field belongs to the queried project, active and single-valued. No arbitrary ORM key interpolation. Number numeric, date chronological, text lexical, custom selects by option order, native references by their existing sequence/display order. Null last in either direction; tie by sequence_id/id. Multi-valued types have no ordering.
- Display preferences custom_fields?: Record<string,boolean>; unspecified active fields visible, explicit false hidden. Deleted/disabled fields excluded from displays/sort menu.
- Frontend shared hook useProjectCustomFields(workspaceSlug?, projectId?) returns {fields,isLoading,error,mutate}. Shared CustomFieldEditor props workspaceSlug,projectId,field,value,onChange,disabled?,compact?. It must handle all field types and expose readable values, reusing existing catalogues/pickers where practical.
- Names and UI labels support Chinese. All fields optional, no defaults/formulas/required flags in v1. No new dependencies unless existing tooling cannot satisfy verification.

### Task 1: Backend fields and ordering

Own apps/api only. Add model/migration/CRUD with project permissions, JSON task values and shared validation, app/public API serialization, server-side pagination-safe ordering and sub-issue ordering. Lock type while ANY task including drafts/archived/soft-deleted has a nonempty value (0/false count). Existing used custom options cannot be deleted or have IDs replaced: allow rename/disable. Reject cross-project references and invalid values. Preserve inactive historical IDs for rendering but reject selecting inactive entities/options anew. Partial edits must not overwrite concurrent unrelated fields or bypass typing via bulk/API routes. Tests first for behavior, then implementation; run focused tests and relevant backend checks.

### Task 2: Frontend configuration and task forms

Own new custom-field types/constants/service/hook/components, packages/types/src/issues/issue.ts, settings routes/nav, issue create forms and detail/peek. Do not touch list/spreadsheet/display/order store paths (Task 3 owns these). Implement project-settings Custom Fields CRUD/reorder/enable UI and all shared input/render components. New/edited tasks support custom_fields. Fields metadata is fetched by project. Read root AGENTS.md. Coordinate concrete exports with Task 3, report tests and outstanding integration details. No git commits by agent.

### Task 3: List/table visibility, ordering, tree integration

Own issue-layout list/spreadsheet/all-properties, display and ordering menus, view-props types, issue store and sub-issue store. Consume Task 2 shared hook/editor. Add dynamic columns/properties, per-user saved visibility, single-valued order menu/headers, custom_fields value refresh dependency. Backend is authoritative for custom sorting, do not re-sort by created_at through fixed-field fallback. Apply sorting to each level of tree without reparenting; child endpoint requests carry order_by. Preserve builtin/Gantt behavior, do not expand scope to infinite hierarchy or nested dragging. Unit-test critical pure ordering/visibility behavior with existing test tools where possible, types/build and browser verification by root. No git commits by agent.

### Task 4: Integration, local deployment and GitHub delivery (root)

Install pinned tools/deps, baseline checks, isolate test DB. Integrate and review task changes; run backend and frontend verification. Backup existing DB/uploads outside Git; clone data into new stack and validate v1.4.3-to-source migration. Build ARM64 custom images sequentially if memory requires, keep rollback image/config/data. Switch validated custom stack to localhost:8090 and stop original app without deleting volumes. Browser verify all field types/core workflow, sorting/tree/state/date regressions and persistence. Document local commands/backup/rollback, commit and push codex/custom-fields, provide URL/SHA/evidence. Complete GitHub authentication if needed; never include credentials/backups in Git. Do not deploy dev2 yet.
