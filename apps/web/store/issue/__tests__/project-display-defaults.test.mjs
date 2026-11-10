/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as fieldViews from "../../../helpers/custom-field-views.ts";

// Run the actual MobX store and shared display normalizers. Only HTTP and browser storage are replaced.
const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(webRoot, "package.json"));
const ts = require("typescript");
const { EIssueFilterType } = require("@plane/constants");
const { autorun } = require("mobx");
const modules = new Map();
function HTTPService() {}
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependency = (specifier) => {
    if (specifier === "@/services/project") return { ProjectService: HTTPService };
    if (specifier === "@/lib/local-storage") return { storage: { get: () => null } };
    if (specifier === "@/helpers/custom-field-views") return fieldViews;
    if (specifier.startsWith(".")) {
      const target = resolve(dirname(file), `${specifier}.ts`);
      if (existsSync(target)) return load(target);
    }
    return require(specifier);
  };
  new Function("require", "exports", "module", code)(dependency, module.exports, module);
  return module.exports;
}
const { ProjectIssuesFilter } = load(resolve(webRoot, "store/issue/project/filter.store.ts"));
const config = {
  display_properties: {
    state: true,
    due_date: false,
    custom_fields: { a: true, b: false },
    column_order: ["state", "custom_fields__a", "due_date"],
  },
  order_by: "-created_at",
  sub_issue: false,
};
const rich = { and: [{ priority: { eq: "urgent" } }] };
const response = (changes = {}) => ({
  rich_filters: rich,
  display_filters: { layout: "list", group_by: null, order_by: config.order_by, sub_issue: false },
  display_properties: config.display_properties,
  use_project_default: true,
  project_display_config: config,
  sort_order: 1,
  preferences: { pages: { block_display: false }, navigation: {} },
  ...changes,
});
function fixture() {
  const fetches = [];
  const root = {
    projectId: "first",
    projectIssues: { clear: () => {}, fetchIssuesWithExistingPagination: (...args) => fetches.push(args) },
  };
  const store = new ProjectIssuesFilter(root);
  store.projectService.getProjectUserProperties = async () => response();
  return { store, fetches };
}
function deferred() {
  let fulfill;
  let reject;
  const promise = new Promise((yes, no) => {
    fulfill = yes;
    reject = no;
  });
  return { promise, resolve: fulfill, reject };
}

test("fetch tracks source and default independently for two projects and refresh adopts updated defaults", async () => {
  const { store } = fixture();
  store.projectService.getProjectUserProperties = async (_workspace, project) =>
    response({ use_project_default: project === "first" });
  await store.fetchFilters("workspace", "first");
  await store.fetchFilters("workspace", "second");
  assert.equal(store.getUseProjectDefault("first"), true);
  assert.equal(store.getUseProjectDefault("second"), false);
  assert.deepEqual(store.getProjectDisplayConfig("first"), config);
  store.projectService.getProjectUserProperties = async () => response({ display_properties: { state: false } });
  await store.fetchFilters("workspace", "first");
  assert.equal(store.getIssueFilters("first").displayProperties.state, false);
  assert.equal(store.getIssueFilters("second").displayProperties.state, true);
});

test("layout-only PATCH sends only its delta and consumes authoritative display/source data", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  let payload;
  store.projectService.updateProjectUserProperties = async (_workspace, _project, data) => {
    payload = data;
    return response({ display_filters: { layout: "spreadsheet", order_by: "priority", sub_issue: true } });
  };
  await store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_FILTERS, { layout: "spreadsheet" });
  assert.deepEqual(payload, { display_filters: { layout: "spreadsheet" } });
  assert.equal(store.getIssueFilters("first").displayFilters.order_by, "priority");
  assert.equal(store.getUseProjectDefault("first"), true);
});

test("column order and custom visibility send real deltas without losing the server's other custom-field keys", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const payloads = [];
  store.projectService.updateProjectUserProperties = async (_workspace, _project, data) => {
    payloads.push(data);
    return response({
      use_project_default: false,
      display_properties: {
        ...config.display_properties,
        column_order: ["due_date", "custom_fields__a", "state"],
        custom_fields: { a: payloads.length === 1, b: false },
      },
    });
  };
  await store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, {
    column_order: ["due_date", "custom_fields__a", "state"],
  });
  await store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { custom_fields: { a: false } });
  assert.deepEqual(payloads, [
    { display_properties: { column_order: ["due_date", "custom_fields__a", "state"] } },
    { display_properties: { custom_fields: { a: false } } },
  ]);
  assert.deepEqual(store.getIssueFilters("first").displayProperties.custom_fields, { a: false, b: false });
  assert.equal(store.getUseProjectDefault("first"), false);
});

test("rich-only response updates rich filters without overwriting current display/source", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const nextRich = { and: [] };
  store.projectService.updateProjectUserProperties = async () =>
    response({ rich_filters: nextRich, display_properties: { state: false } });
  await store.updateFilterExpression("workspace", "first", nextRich);
  assert.deepEqual(store.getIssueFilters("first").richFilters, nextRich);
  assert.equal(store.getUseProjectDefault("first"), true);
  assert.equal(store.getIssueFilters("first").displayProperties.state, true);
});

test("restore follows authoritative defaults, preserves rich filters and refreshes sorting/subtask data", async () => {
  const { store, fetches } = fixture();
  store.projectService.getProjectUserProperties = async () => response({ use_project_default: false });
  await store.fetchFilters("workspace", "first");
  store.projectService.resetProjectDisplayConfig = async () =>
    response({ display_filters: { layout: "list", order_by: "priority", sub_issue: true } });
  await store.resetProjectDisplayConfig("workspace", "first");
  assert.equal(store.getUseProjectDefault("first"), true);
  assert.equal(store.getIssueFilters("first").displayFilters.order_by, "priority");
  assert.deepEqual(store.getIssueFilters("first").richFilters, rich);
  assert.deepEqual(fetches, [["workspace", "first", "mutation"]]);
});

test("save submits only managed snapshot, refreshes effective response and isolates pending per project", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  await store.fetchFilters("workspace", "second");
  const network = deferred();
  let payload;
  store.projectService.updateProjectDisplayConfig = async (_workspace, _project, data) => {
    payload = data;
    return network.promise;
  };
  store.projectService.getProjectUserProperties = async () => response({ use_project_default: false });
  const save = store.saveProjectDisplayConfig("workspace", "first");
  assert.equal(store.getDisplayConfigPending("first"), true);
  assert.equal(store.getDisplayConfigPending("second"), false);
  assert.deepEqual(Object.keys(payload).toSorted(), ["display_properties", "order_by", "sub_issue"]);
  assert.deepEqual(payload.display_properties.column_order, config.display_properties.column_order);
  assert.deepEqual(payload.display_properties.custom_fields, { a: true, b: false });
  network.resolve(config);
  await save;
  assert.equal(store.getDisplayConfigPending("first"), false);
  assert.equal(store.getUseProjectDefault("first"), false);
});

test("failed save/restore clears pending without discarding personal settings or another project", async () => {
  const { store } = fixture();
  store.projectService.getProjectUserProperties = async () => response({ use_project_default: false });
  await store.fetchFilters("workspace", "first");
  await store.fetchFilters("workspace", "second");
  const offline = new Error("offline");
  store.projectService.updateProjectDisplayConfig = async () => {
    throw offline;
  };
  store.projectService.resetProjectDisplayConfig = async () => {
    throw offline;
  };
  await assert.rejects(store.saveProjectDisplayConfig("workspace", "first"), offline);
  await assert.rejects(store.resetProjectDisplayConfig("workspace", "first"), offline);
  assert.equal(store.getDisplayConfigPending("first"), false);
  assert.equal(store.getUseProjectDefault("first"), false);
  assert.equal(store.getUseProjectDefault("second"), false);
  assert.deepEqual(store.getIssueFilters("first").richFilters, rich);
});

test("following custom sort switches to unsupported layout optimistically without PATCHing a personal sort", async () => {
  const { store } = fixture();
  store.projectService.getProjectUserProperties = async () =>
    response({ display_filters: { layout: "list", group_by: "state", order_by: "custom_fields__a" } });
  await store.fetchFilters("workspace", "first");
  const seen = [];
  const dispose = autorun(() => seen.push({ ...store.getIssueFilters("first").displayFilters }));
  const network = deferred();
  let payload;
  store.projectService.updateProjectUserProperties = async (_workspace, _project, data) => {
    payload = data;
    return network.promise;
  };
  const update = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_FILTERS, { layout: "kanban" });
  assert.deepEqual(payload, { display_filters: { layout: "kanban" } });
  assert.ok(seen.every((value) => value.layout !== "kanban" || value.order_by === "-created_at"));
  network.resolve(response({ display_filters: { layout: "kanban", group_by: "state", order_by: "-created_at" } }));
  await update;
  dispose();
  assert.equal(store.getUseProjectDefault("first"), true);
});

test("full-object caller echoes are reduced to genuine top-level and custom-field deltas", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const payloads = [];
  const network = deferred();
  store.projectService.updateProjectUserProperties = async (_workspace, _project, data) => {
    payloads.push(data);
    return network.promise;
  };
  const update = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, {
    ...config.display_properties,
    custom_fields: { a: false, b: false },
  });
  assert.deepEqual(payloads, [{ display_properties: { custom_fields: { a: false } } }]);
  assert.deepEqual(store.getIssueFilters("first").displayProperties.custom_fields, { a: false, b: false });
  network.resolve(
    response({
      use_project_default: false,
      display_properties: { ...config.display_properties, custom_fields: { a: false, b: false } },
    })
  );
  await update;
});

test("failed display PATCH restores previous effective settings even if recovery GET also fails", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const offline = new Error("offline");
  store.projectService.updateProjectUserProperties = async () => {
    throw offline;
  };
  store.projectService.getProjectUserProperties = async () => {
    throw new Error("recovery offline");
  };
  await assert.rejects(
    store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false }),
    offline
  );
  assert.equal(store.getIssueFilters("first").displayProperties.state, true);
  assert.equal(store.getUseProjectDefault("first"), true);
});

test("pending display writes block save/reset and stay pending until all project writes settle", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  await store.fetchFilters("workspace", "second");
  const first = deferred();
  const second = deferred();
  let requests = 0;
  let saves = 0;
  let resets = 0;
  store.projectService.updateProjectUserProperties = async () => (++requests === 1 ? first.promise : second.promise);
  store.projectService.updateProjectDisplayConfig = async () => {
    saves++;
    return config;
  };
  store.projectService.resetProjectDisplayConfig = async () => {
    resets++;
    return response();
  };
  const write1 = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false });
  const write2 = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { due_date: true });
  assert.equal(store.getDisplayConfigPending("first"), true);
  assert.equal(store.getDisplayConfigPending("second"), false);
  await store.saveProjectDisplayConfig("workspace", "first");
  await store.resetProjectDisplayConfig("workspace", "first");
  assert.equal(saves, 0);
  assert.equal(resets, 0);
  first.resolve(response({ use_project_default: false, display_properties: { state: false } }));
  await write1;
  assert.equal(store.getDisplayConfigPending("first"), true);
  second.resolve(response({ use_project_default: false, display_properties: { state: false, due_date: true } }));
  await write2;
  assert.equal(store.getDisplayConfigPending("first"), false);
});

for (const action of ["display", "reset", "save"]) {
  test(`${action} response preserves a rich filter saved while it was pending`, async () => {
    const { store } = fixture();
    await store.fetchFilters("workspace", "first");
    const network = deferred();
    const nextRich = { and: [{ priority: { eq: "high" } }] };
    store.projectService.updateProjectUserProperties = async (_workspace, _project, payload) =>
      payload.rich_filters ? response({ rich_filters: nextRich }) : network.promise;
    store.projectService.resetProjectDisplayConfig = async () => network.promise;
    store.projectService.updateProjectDisplayConfig = async () => config;
    store.projectService.getProjectUserProperties = async () => network.promise;
    const write =
      action === "display"
        ? store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false })
        : action === "reset"
          ? store.resetProjectDisplayConfig("workspace", "first")
          : store.saveProjectDisplayConfig("workspace", "first");
    await store.updateFilterExpression("workspace", "first", nextRich);
    network.resolve(response({ display_properties: { state: false } }));
    await write;
    assert.deepEqual(store.getIssueFilters("first").richFilters, nextRich);
    assert.equal(store.getIssueFilters("first").displayProperties.state, false);
  });
}

test("display writes serialize HTTP requests so each authoritative response includes earlier edits", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const network = deferred();
  const payloads = [];
  let saved = { state: true, due_date: false };
  store.projectService.updateProjectUserProperties = async (_workspace, _project, payload) => {
    payloads.push(payload);
    if (payloads.length === 1) await network.promise;
    saved = { ...saved, ...payload.display_properties };
    return response({ use_project_default: false, display_properties: saved });
  };
  const first = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false });
  const second = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { due_date: true });
  assert.equal(payloads.length, 1);
  assert.equal(store.getIssueFilters("first").displayProperties.due_date, true);
  network.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(saved, { state: false, due_date: true });
  assert.equal(store.getIssueFilters("first").displayProperties.state, false);
  assert.equal(store.getIssueFilters("first").displayProperties.due_date, true);
  assert.equal(store.getUseProjectDefault("first"), false);
});

test("same-field display writes reach the server in user intent order", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const network = deferred();
  const values = [];
  let savedState = true;
  store.projectService.updateProjectUserProperties = async (_workspace, _project, payload) => {
    values.push(payload.display_properties.state);
    if (values.length === 1) await network.promise;
    savedState = payload.display_properties.state;
    return response({ use_project_default: false, display_properties: { state: savedState } });
  };
  const first = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false });
  const second = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: true });
  assert.deepEqual(values, [false]);
  network.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(values, [false, true]);
  assert.equal(savedState, true);
  assert.equal(store.getIssueFilters("first").displayProperties.state, true);
});

test("rich-filter writes serialize separately and preserve the latest saved intent", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const network = deferred();
  const firstRich = { and: [{ priority: { eq: "low" } }] };
  const newestRich = { and: [{ priority: { eq: "high" } }] };
  const payloads = [];
  store.projectService.updateProjectUserProperties = async (_workspace, _project, payload) => {
    payloads.push(payload.rich_filters);
    if (payloads.length === 1) await network.promise;
    return response({ rich_filters: payload.rich_filters });
  };
  const first = store.updateFilterExpression("workspace", "first", firstRich);
  const second = store.updateFilterExpression("workspace", "first", newestRich);
  assert.equal(payloads.length, 1);
  assert.deepEqual(store.getIssueFilters("first").richFilters, newestRich);
  network.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(payloads, [firstRich, newestRich]);
  assert.deepEqual(store.getIssueFilters("first").richFilters, newestRich);
});

test("display-filter full-object echoes omit inherited managed values on a personal layout change", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  let payload;
  store.projectService.updateProjectUserProperties = async (_workspace, _project, data) => {
    payload = data;
    return response({ display_filters: { layout: "spreadsheet", order_by: "-created_at", sub_issue: false } });
  };
  await store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_FILTERS, {
    ...store.getIssueFilters("first").displayFilters,
    layout: "spreadsheet",
  });
  assert.deepEqual(payload, { display_filters: { layout: "spreadsheet" } });
  assert.equal(store.getUseProjectDefault("first"), true);
});

test("authoritative layout response refreshes issues using the resolved managed sort and subtasks", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const queries = [];
  store.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination = () =>
    queries.push({ ...store.getIssueFilters("first").displayFilters });
  store.projectService.updateProjectUserProperties = async () =>
    response({ display_filters: { layout: "kanban", group_by: "state", order_by: "priority", sub_issue: true } });
  await store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_FILTERS, { layout: "kanban" });
  assert.ok(queries.length > 0);
  assert.equal(queries.at(-1).order_by, "priority");
  assert.equal(queries.at(-1).sub_issue, true);
});

test("refreshing an already mounted project refetches when the authoritative default order changes", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const queries = [];
  store.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination = () =>
    queries.push(store.getIssueFilters("first").displayFilters.order_by);
  store.projectService.getProjectUserProperties = async () =>
    response({ display_filters: { layout: "list", order_by: "priority", sub_issue: false } });
  await store.fetchFilters("workspace", "first");
  assert.deepEqual(queries, ["priority"]);
});

test("refresh waits for already queued display writes before reading authoritative settings", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const network = deferred();
  let savedState = true;
  let reads = 0;
  store.projectService.updateProjectUserProperties = async () => {
    await network.promise;
    savedState = false;
    return response({ use_project_default: false, display_properties: { state: savedState } });
  };
  store.projectService.getProjectUserProperties = async () => {
    reads++;
    return response({ use_project_default: savedState, display_properties: { state: savedState } });
  };
  const write = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false });
  const refresh = store.fetchFilters("workspace", "first");
  assert.equal(reads, 0);
  network.resolve();
  await Promise.all([write, refresh]);
  assert.equal(reads, 1);
  assert.equal(store.getIssueFilters("first").displayProperties.state, false);
  assert.equal(store.getUseProjectDefault("first"), false);
});

test("a failed queued write does not block the next independent display change", async () => {
  const { store } = fixture();
  await store.fetchFilters("workspace", "first");
  const network = deferred();
  const offline = new Error("offline");
  let calls = 0;
  store.projectService.updateProjectUserProperties = async () => {
    calls++;
    if (calls === 1) return network.promise;
    return response({ use_project_default: false, display_properties: { state: true, due_date: true } });
  };
  const first = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { state: false });
  const second = store.updateFilters("workspace", "first", EIssueFilterType.DISPLAY_PROPERTIES, { due_date: true });
  const rejected = assert.rejects(first, offline);
  network.reject(offline);
  await Promise.all([rejected, second]);
  assert.equal(calls, 2);
  assert.equal(store.getIssueFilters("first").displayProperties.state, true);
  assert.equal(store.getIssueFilters("first").displayProperties.due_date, true);
  assert.equal(store.getDisplayConfigPending("first"), false);
});
