# Project condition panel implementation plan

**Goal:** Implement the user's selected Feishu style project filtering panel, with built-in and active project custom fields using the same names and icons as table headers. Deliver locally for acceptance before any commit, push, merge or dev2 deployment.

**Architecture:** Reuse the existing rich_filters JSON and permission-scoped querysets. Extend supported typed leaf conditions and AND/OR round trips, replace project-scoped filter controls with a searchable condition panel, and retain workspace filtering compatibility. Existing personal saved filters remain readable; no data migration is required.

**Decisions:** A panel condition is field + operator + value. Conditions combine with all/any; no arbitrary nested-group editor is introduced. Retain nested historical expressions without silently flattening them. Typed operators include exact/not exact, text contains/not contains, numeric/date comparisons and range, single selection membership, multi selection any/all/exclusion, and empty/nonempty. Empty includes absent/null/empty text/empty list; zero and false are values. Apply validates every draft row rather than silently dropping incomplete conditions. Filters remain personal and do not change project display defaults.

## Tasks

- [x] Backend: add strict project-owned custom-field filtering and typed built-in conditions in the existing rich filter backend. Reject unknown, cross-project or inactive fields and malformed values. Filter before counts/pagination. Test numeric boundaries, text, dates, selections, nulls, OR and project scope.
- [x] Filter state: extend typed operators, OR serialization and traversal; preserve old exact/in/range expressions, negation and arrays without lossy conversions. Test round trips and filter persistence semantics.
- [x] Project panel: searchable field picker with matching names/icons, type-specific inputs and operators, all/any, add/remove, apply/clear/cancel, count and readable summary. Include inactive/deleted saved field handling without silently broadening results. Add focused component/model tests.
- [x] Integration: test the existing custom fields suite and new API tests, frontend type checking, relevant lint and production build. Exercise local browser UI in Chinese, including refresh persistence and custom decimal values.
- [x] Local update: record current image identities and take a local database backup. Package verified UI/API, update only Plane application services on localhost:8090, and verify running UI/API. Leave changes uncommitted for user review.

## Review focus

Numeric comparison must distinguish 2 from 10 and preserve decimals, zero and negatives. Empty must exclude zero/false. Unknown fields must fail explicitly. Old personal filters must survive loading/saving. OR must survive serialization and refresh. Project permissions, counts and pagination must agree. Tree expansion must not be presented as filtering every descendant unless implemented and verified; retain existing tree behavior in this change and explain it in the panel.

## Local verification (2026-11-11)

- Backend: 202 related contract/unit tests passed, including 50 typed-filter contracts; API lint passed.
- Frontend: 43 real-store/adapter tests passed after persistence-order fixes; 28 panel/custom-field tests passed; existing 42 field display/editor tests passed. Web type generation/TypeScript and production build passed; changed-file lint passed for 29 files.
- Running local API: 11 checks compared the existing 15 tasks against independently computed results, including numeric 10, decimal ranges, empty values, all/any, pagination totals, and invalid values/field IDs.
- Browser: seven acceptance scenarios passed, including Chinese field search, exact header icon shape matching, cancel, actual apply, refresh persistence of OR, range validation, and injected preference-save failure retaining the previous task list. Original personal filters restored after testing.
- Fresh review identified persistence failure inconsistency in project/cycle/module callbacks; fixed with persistence-before-query and covered by real-store regressions. Archived local-write failure follows the same policy.
- Existing React hydration warning 418 also reproduced with the pre-change frontend image; no unrelated hydration changes made.
- Local database/archive backups verified by pg_restore listing and tar listing. Only local Plane application images updated. No commit/push/merge or dev2 operation performed.

## Accepted release scope (2026-11-11)

The user accepted the final unified dropdown styles and authorized committing the feature, merging into master, backing up dev2 data with the latest three successful backup sets retained, deploying the pushed master revision, and removing unused old Plane application containers/images after verification.

Final UI controls use shared SelectTriggerChrome and the dedicated Propel Select primitive for fixed choices. Real browser checks verified identical 32px height, 13px font, 6px radius, 16px chevrons and 11px right inset across field/operator/value selectors, plus mouse and keyboard selection.

Release review identified concurrent apply/clear rollback risk. The shared per-filter apply lock now covers API validation and persistence and disables controls across all popovers/summary actions; deferred regression tests cover failure, unlock and concurrent-call rejection.
