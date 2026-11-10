/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as fieldViews from "../../../../helpers/custom-field-views.ts";

const webRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(resolve(webRoot, "package.json"));
const blockRequire = createRequire(resolve(webRoot, "../../packages/blocks/package.json"));
const { JSDOM } = blockRequire("jsdom");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { observable, runInAction } = require("mobx");
const { observer } = require("mobx-react");
const { EIssuesStoreType } = require("@plane/types");
const Null = () => null;
const passthrough = ({ children }) => children;
const field = { id: "field", is_active: true, field_type: "text", sort_order: 1 };
const customOrder = "-custom_fields__field";

// Execute the real project roots, layout roots, shared guard and validation hook.
// Replace only catalog/UI/drag dependencies and the HTTP/store boundary. The actual
// layout useEffects decide when an issue fetch runs and supply its pagination/view.
async function renderLayout(kind, layout, order = customOrder, metadata = {}, menu = false) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const filters = observable({ displayFilters: { layout, order_by: order }, displayProperties: {} });
  const definitions = observable({ fields: [field], isLoading: false, error: undefined, ...metadata });
  const state = observable({ rows: [] });
  const requests = [];
  const resets = [];
  const definitionRequests = [];
  const params = {
    workspaceSlug: "workspace",
    projectId: "project",
    cycleId: "cycle",
    moduleId: "module",
    viewId: "view",
  };
  const storeType = EIssuesStoreType[kind];
  const issuesFilter = {
    issueFilters: filters,
    getIssueFilters: () => filters,
    updateFilterExpression: () => {},
    resetFilters: () => {},
  };
  const issues = {
    getIssueLoader: () => undefined,
    viewFlags: {},
    groupedIssueIds: {},
    getGroupIssueCount: () => 0,
    getPaginationData: () => ({}),
    updateIssueDates: async () => {},
  };
  const actions = {
    fetchIssues: async (loadType, options, viewId) => {
      requests.push({
        order: filters.displayFilters.order_by,
        layout: filters.displayFilters.layout,
        loadType,
        options,
        viewId,
      });
      runInAction(() => {
        state.rows = ["loaded issue"];
      });
    },
    updateFilters: async (projectId, filterType, patch) => {
      resets.push({ projectId, filterType, patch, storeType });
      runInAction(() => Object.assign(filters.displayFilters, patch));
    },
  };
  const Results = observer(() => React.createElement("div", { "data-results": true }, state.rows.join(",")));
  const modules = new Map();
  const mocks = new Map(
    Object.entries({
      "next/navigation": { useParams: () => params },
      "@makeplane/propel/components/menu": { MenuSeparator: Null },
      "@/components/issues/issue-layouts/filters": {
        FilterDisplayProperties: Null,
        FilterExtraOptions: Null,
        FilterGroupBy: Null,
        FilterSubGroupBy: Null,
        FilterOrderBy: ({ allowCustomFields }) =>
          React.createElement("div", { "data-custom-order": String(allowCustomFields) }),
      },
      swr: { __esModule: true, default: () => ({}) },
      "@/helpers/custom-field-views": fieldViews,
      "@/hooks/store/use-issues": { useIssues: () => ({ issuesFilter, issues, issueMap: {} }) },
      "@/hooks/use-issues-actions": {
        useIssuesActions: (requestedStoreType) => {
          assert.equal(requestedStoreType, storeType);
          return actions;
        },
      },
      "@/hooks/use-project-custom-fields": {
        useProjectCustomFields: (_workspace, projectId) => {
          definitionRequests.push(projectId);
          return projectId ? definitions : { fields: [], isLoading: false };
        },
      },
      "@/hooks/store/user": { useUserPermissions: () => ({ allowPermissions: () => false }) },
      "@/hooks/store/use-issue-detail": { useIssueDetail: () => ({ issue: { getIssueById: () => undefined } }) },
      "@/hooks/store/use-cycle": { useCycle: () => ({ getCycleById: () => ({ status: "started" }) }) },
      "@/hooks/store/use-project-view": { useProjectView: () => ({ getViewById: () => undefined }) },
      "@/hooks/use-group-dragndrop": { useGroupIssuesDragNDrop: () => () => {} },
      "@/hooks/use-timeline-chart": { useTimeLineChart: () => ({ initGantt: () => {} }) },
      "@/hooks/use-bulk-operation-status": { useBulkOperationStatus: () => false },
      "@/hooks/store/use-calendar-view": {
        useCalendarView: () => ({ getStartAndEndDate: () => ({ startDate: "2026-11-01", endDate: "2026-11-30" }) }),
      },
      "@plane/i18n": { useTranslation: () => ({ t: (text) => text }) },
      "@plane/blocks/spinner": { Spinner: Null },
      "@plane/blocks/toast": { setToast: () => {} },
      "@plane/blocks/layout": { Row: passthrough, ERowVariant: {} },
      "@/components/work-item-filters/filters-hoc/project-level": {
        ProjectLevelWorkItemFiltersHOC: ({ children }) => children({}),
      },
      "@/components/work-item-filters/filters-row": { WorkItemFiltersRow: Null },
      "@/components/cycles/transfer-issues": { TransferIssues: Null },
      "@/components/cycles/transfer-issues-modal": { TransferIssuesModal: Null },
      "@/components/gantt-chart/contexts": { TimeLineTypeContext: React.createContext(undefined) },
      "@/components/gantt-chart/root": { GanttChartRoot: Results },
      "@/components/gantt-chart/sidebar/issues/sidebar": { IssueGanttSidebar: Null },
      "../../peek-overview": { IssuePeekOverview: Null },
      "../../delete-issue-modal": { DeleteIssueModal: Null },
      "../issue-layout-HOC": { IssueLayoutHOC: passthrough },
      "../quick-add": { GanttQuickAddIssueButton: Null, QuickAddIssueRoot: Null },
      "./blocks": { IssueGanttBlock: Null },
      "./default": { List: Results, KanBan: Results },
      "./swimlanes": { KanBanSwimLanes: Results },
      "./kanban-delete-drop-zone": { KanbanDeleteDropZone: Null },
      "./calendar": { CalendarChart: Results },
      "./utils": { handleDragDrop: () => {} },
      "./spreadsheet-view": { SpreadsheetView: Results },
      "@atlaskit/pragmatic-drag-and-drop/combine": { combine: () => () => {} },
      "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element": { autoScrollForElements: () => () => {} },
    })
  );
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const loadDependency = (specifier) => {
      if (mocks.has(specifier)) return mocks.get(specifier);
      if (specifier === "./store/use-issues") return mocks.get("@/hooks/store/use-issues");
      const wrapper = specifier.match(/^\.\.\/(list|kanban|spreadsheet|calendar)\/roots\//);
      if (wrapper) {
        const name = {
          list: "BaseListRoot",
          kanban: "BaseKanBanRoot",
          spreadsheet: "BaseSpreadsheetRoot",
          calendar: "BaseCalendarRoot",
        }[wrapper[1]];
        const base = load(
          resolve(webRoot, `components/issues/issue-layouts/${wrapper[1]}/base-${wrapper[1]}-root.tsx`)
        )[name];
        const Component = () =>
          React.createElement(base, {
            QuickActions: Null,
            viewId:
              kind === "PROJECT"
                ? undefined
                : params[{ CYCLE: "cycleId", MODULE: "moduleId", PROJECT_VIEW: "viewId" }[kind]],
          });
        return new Proxy({}, { get: () => Component });
      }
      const target = specifier.startsWith("@/")
        ? resolve(webRoot, specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(file), specifier)
          : null;
      if (target) {
        for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          if (existsSync(target + suffix)) return load(target + suffix);
        }
      }
      return require(specifier);
    };
    try {
      new Function("require", "exports", "module", code)(loadDependency, module.exports, module);
    } catch (error) {
      error.message += ` (loading ${file})`;
      throw error;
    }
    return module.exports;
  }
  const [filename, exportName] = {
    PROJECT: ["project", "Project"],
    CYCLE: ["cycle", "Cycle"],
    MODULE: ["module", "Module"],
    PROJECT_VIEW: ["project-view", "ProjectView"],
    ARCHIVED: ["archived-issue", "ArchivedIssue"],
  }[kind];
  const Component = menu
    ? load(
        resolve(webRoot, "components/issues/issue-layouts/filters/header/display-filters/display-filters-selection.tsx")
      ).DisplayFiltersSelection
    : load(resolve(webRoot, `components/issues/issue-layouts/roots/${filename}-layout-root.tsx`))[
        `${exportName}LayoutRoot`
      ];
  const container = document.createElement("div");
  const renderer = createRoot(container);
  await act(async () =>
    renderer.render(
      React.createElement(
        Component,
        menu
          ? {
              displayFilters: filters.displayFilters,
              displayProperties: {},
              layoutDisplayFiltersOptions: {
                display_filters: { order_by: ["created_at"] },
                extra_options: { access: false },
              },
            }
          : {}
      )
    )
  );
  return {
    filters,
    definitions,
    requests,
    resets,
    definitionRequests,
    container,
    async close() {
      await act(async () => renderer.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

for (const kind of ["PROJECT", "CYCLE", "MODULE", "PROJECT_VIEW"]) {
  test(`${kind}: saved Kanban custom order recovers before the actual board initial fetch`, async () => {
    const ui = await renderLayout(kind, "kanban", customOrder, { fields: [{ ...field, is_active: false }] });
    try {
      assert.equal(ui.filters.displayFilters.order_by, "sort_order");
      assert.ok(ui.requests.length > 0);
      assert.ok(ui.requests.every((query) => query.order === "sort_order"));
      assert.equal(ui.resets[0].projectId, "project");
      assert.equal(ui.resets[0].storeType, EIssuesStoreType[kind]);
      assert.equal(ui.container.textContent, "loaded issue");
    } finally {
      await ui.close();
    }
  });
}

for (const layout of ["kanban", "gantt_chart", "calendar"]) {
  test(`${layout}: switching from a valid list custom sort resets before the next layout fetch`, async () => {
    const ui = await renderLayout("PROJECT", "list");
    try {
      assert.equal(ui.requests[0].order, customOrder);
      ui.requests.length = 0;
      await act(async () =>
        runInAction(() => {
          ui.filters.displayFilters.layout = layout;
        })
      );
      assert.ok(ui.requests.length > 0);
      assert.ok(ui.requests.every((query) => query.order === "sort_order"));
      assert.equal(ui.filters.displayFilters.order_by, "sort_order");
    } finally {
      await ui.close();
    }
  });
}

for (const layout of ["list", "spreadsheet"]) {
  for (const fields of [[], [{ ...field, is_active: false }], [{ ...field, field_type: "members" }]]) {
    test(`${layout}: invalid saved field (${fields[0]?.field_type ?? "deleted"}/${fields[0]?.is_active}) waits for definitions then recovers`, async () => {
      const ui = await renderLayout("PROJECT", layout, customOrder, { fields, isLoading: true });
      try {
        assert.equal(ui.requests.length, 0);
        assert.equal(ui.resets.length, 0);
        await act(async () =>
          runInAction(() => {
            ui.definitions.isLoading = false;
          })
        );
        assert.equal(ui.filters.displayFilters.order_by, "sort_order");
        assert.ok(ui.requests.length > 0);
        assert.ok(ui.requests.every((query) => query.order === "sort_order"));
      } finally {
        await ui.close();
      }
    });
  }
  for (const kind of ["PROJECT", "CYCLE", "MODULE", "PROJECT_VIEW"]) {
    test(`${kind}/${layout}: valid saved custom order remains available`, async () => {
      const ui = await renderLayout(kind, layout);
      try {
        assert.equal(ui.resets.length, 0);
        assert.ok(ui.requests.length > 0);
        assert.ok(ui.requests.every((query) => query.order === customOrder));
      } finally {
        await ui.close();
      }
    });
  }
}

for (const layout of ["list", "spreadsheet", "kanban", "gantt_chart", "calendar"]) {
  test(`${layout}: built-in ordering loads without waiting for field definitions`, async () => {
    const ui = await renderLayout("PROJECT", layout, "-created_at", { isLoading: true });
    try {
      assert.equal(ui.resets.length, 0);
      assert.ok(ui.requests.length > 0);
      assert.ok(ui.requests.every((query) => query.order === "-created_at"));
      assert.ok(ui.definitionRequests.every((projectId) => projectId === undefined));
    } finally {
      await ui.close();
    }
  });
}

for (const layout of ["list", "spreadsheet", "kanban", "gantt_chart", "calendar"]) {
  test(`${layout}: shared ordering menu exposes custom fields only in list and spreadsheet`, async () => {
    const ui = await renderLayout("PROJECT", layout, "created_at", {}, true);
    try {
      assert.equal(
        ui.container.querySelector("[data-custom-order]")?.dataset.customOrder,
        String(["list", "spreadsheet"].includes(layout))
      );
    } finally {
      await ui.close();
    }
  });
}

test("unsupported saved custom order recovers without waiting for failing field metadata", async () => {
  const ui = await renderLayout("PROJECT", "kanban", customOrder, { isLoading: true, error: new Error("offline") });
  try {
    assert.equal(ui.filters.displayFilters.order_by, "sort_order");
    assert.ok(ui.requests.length > 0);
    assert.ok(ui.requests.every((query) => query.order === "sort_order"));
    assert.ok(ui.definitionRequests.every((projectId) => projectId === undefined));
  } finally {
    await ui.close();
  }
});

for (const layout of ["list", "spreadsheet"]) {
  test(`${layout}: valid custom order waits for metadata without discarding the saved sort`, async () => {
    const ui = await renderLayout("PROJECT", layout, customOrder, { isLoading: true });
    try {
      assert.equal(ui.requests.length, 0);
      assert.equal(ui.resets.length, 0);
      await act(async () =>
        runInAction(() => {
          ui.definitions.isLoading = false;
        })
      );
      assert.equal(ui.resets.length, 0);
      assert.ok(ui.requests.length > 0);
      assert.ok(ui.requests.every((query) => query.order === customOrder));
    } finally {
      await ui.close();
    }
  });
}

for (const fields of [[], [{ ...field, is_active: false }]]) {
  test(`ARCHIVED: saved ${fields.length ? "disabled" : "deleted"} custom order recovers before the actual list initial fetch`, async () => {
    const ui = await renderLayout("ARCHIVED", "list", customOrder, { fields, isLoading: true });
    try {
      assert.equal(ui.requests.length, 0);
      assert.equal(ui.resets.length, 0);
      await act(async () =>
        runInAction(() => {
          ui.definitions.isLoading = false;
        })
      );
      assert.equal(ui.filters.displayFilters.order_by, "sort_order");
      assert.ok(ui.requests.length > 0);
      assert.ok(ui.requests.every((query) => query.order === "sort_order"));
      assert.equal(ui.resets[0].storeType, EIssuesStoreType.ARCHIVED);
      assert.equal(ui.resets[0].projectId, "project");
      assert.equal(ui.container.textContent, "loaded issue");
    } finally {
      await ui.close();
    }
  });
}

for (const order of [customOrder, "-created_at"]) {
  test(`ARCHIVED: valid ${order} ordering loads without resetting`, async () => {
    const ui = await renderLayout("ARCHIVED", "list", order);
    try {
      assert.equal(ui.resets.length, 0);
      assert.ok(ui.requests.length > 0);
      assert.ok(ui.requests.every((query) => query.order === order));
      assert.equal(ui.container.textContent, "loaded issue");
    } finally {
      await ui.close();
    }
  });
}
