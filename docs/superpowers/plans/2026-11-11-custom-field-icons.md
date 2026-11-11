# Custom field icon selection implementation plan

**Goal:** Let project administrators select a business icon for each custom field, while showing plain numeric/text values in spreadsheet cells.

**Approved design:** Reuse the existing searchable line-icon picker. The selected icon is independent of field type; unset icons fall back to the current type icon. Show icons alongside field names (header, column settings and field settings), not before each task value. Decimal formatting remains the current natural numeric representation, without forced trailing zeroes.

**Delivery constraint:** Update and verify localhost only. Wait for the user's explicit local acceptance before any Git commit/push or dev2 deployment. Preserve the existing uncommitted compact-cell work.

**2026-11-11 delivery approval:** The user requested `push` after the local preview. Commit and push this change to the existing `preview` branch; dev2 deployment remains a separate step and is not part of this push.

## Contract and scope

- Add nullable `ProjectCustomField.icon` JSON with `{ "name": "Clock", "color": "#6d7b8a" }`; `null` restores the type default. Names are bounded identifiers for the existing Lucide picker, colours are six-digit hex values. Unknown icon identifiers render the safe type fallback.
- Add migration `0129_project_custom_field_icon`; leave applied migrations unchanged. Existing definitions get `null`; task custom values, display configuration and timestamps remain unchanged.
- Extend existing administrator-only create/update and member read APIs. Partial updates that omit `icon` preserve it. Validate the object shape, types and lengths; reject malformed input. Icon changes remain allowed when field value types are locked.
- Reuse `EmojiPicker` with the emoji tab hidden and Lucide line icons, plus an explicit restore-default action. Saving or cancelling uses the existing field form lifecycle.
- Keep the compact spreadsheet editor's validated save/close behaviour. Remove repeated field-type icons from values. Keep selected icons in headers, column choices and drag previews.
- No fixed precision setting, uploaded icons, external URLs, or changes to built-in field values.

## Tasks and verification

- [x] Backend: write failing persistence/validation/permission tests, add model field and migration, then verify create/read/update/reset and old-data migration preservation.
- [x] Frontend: extend shared types and icon renderer; add field-form selection/reset; update field-name locations and remove value prefixes; verify save/cancel/fallback and plain decimal/zero/empty rendering.
- [x] Review interfaces and run scoped API contracts, migration checks, web tests, type checks and production build. Keep shared package builds sequential with frontend tests.
- [x] Back up local database, attachments and configuration before migration. Build local worktree images without committing source, migrate, and update only the local services that need it.
- [x] Browser acceptance: choose an icon, save/reload, restore default, verify plain integer/decimal values and Chinese navigation. Column choice/preview consistency is covered by component tests. Display configuration and hierarchy are unchanged; local demo changes are documented below.
- [x] Deliver local preview and verification evidence; await user acceptance for GitHub and dev2.

## Additional confirmed fix: Chinese navigation settings

The user also requested the missing Chinese "Customize navigation" entry. `SidebarWrapper` currently checks the translated title against the literal English `Projects`; its sole caller supplies `t("projects")`. Remove the language-dependent condition without changing navigation preferences or modes. Verify English, Simplified Chinese and Traditional Chinese visibility, open/close behaviour, and the actual Chinese local dialog. Include this in the same local-only preview and acceptance gate.

## Local verification results

- API contracts: 140 passed; migration preservation: 1 passed. Web tests: 194 passed, including 5 navigation regressions; actual i18n picker tests: 6 passed. Web types and production build passed.
- Local migration 0129 applied. Database, uploads and runtime configuration were backed up before migration; full pre/post migration comparisons preserved existing task data and display configuration.
- Chrome verified icon save/reload, cancel, reset and reselect; selected icons in headers, no icon prefix in values, and decimal `1.50` saving/reloading as `1.5`.
- Local examples: 签收顺序 now uses `List`; new 预计工时（体验） uses `Clock`, with `1.5` on existing DEMO-14. Other task custom values and hierarchy are preserved. A separate DEMO-11 description markup normalization was observed (text unchanged) and left untouched.
- Chinese personal interface enabled for the local administrator. Real 自定义导航 dialog opens and retains the existing 标签式导航 choice; project display settings remain byte-for-byte equivalent.
- Local frontend uses `field-icons-186c759fe8`; backend uses `field-icons-b1deaab286`, both built from the worktree before committing. At the local verification checkpoint, GitHub and dev2 were unchanged. The later push approval is recorded above; dev2 has not been deployed as part of this change.
