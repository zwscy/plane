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
import * as fieldViews from "../../../helpers/custom-field-views.ts";

// Execute the actual TS stores, with only browser singletons and HTTP service constructors replaced.
// Real MobX, lodash, response processing, list mutation and child-store methods run below.
const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(webRoot, "package.json"));
const ts = require("typescript");
const { autorun } = require("mobx");
const globalRoot = { projectRoot: { project: { getProjectIdentifierById: () => "TEST" } } };
function HTTPService() {
  return {};
}
const notifications = [];
const modules = new Map();
const renderMocks = new Map();
function loadStore(file) {
  const path = resolve(webRoot, file);
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} };
  modules.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const load = (specifier) => {
    if (renderMocks.has(specifier)) return renderMocks.get(specifier);
    if (specifier === "@/helpers/custom-field-views") return fieldViews;
    if (specifier === "@plane/blocks/toast") return { setToast: (notification) => notifications.push(notification) };
    if (specifier === "@/lib/store-context") return { store: globalRoot, rootStore: globalRoot };
    if (specifier === "@/lib/local-storage") return { storage: { get: () => null } };
    if (specifier.startsWith("@/services/")) return new Proxy({}, { get: () => HTTPService });
    if (specifier.startsWith(".")) {
      const target = resolve(dirname(path), specifier);
      if (existsSync(`${target}.ts`)) return loadStore(`${target}.ts`);
      if (existsSync(`${target}.tsx`)) return loadStore(`${target}.tsx`);
    }
    return require(specifier);
  };
  new Function("require", "exports", "module", code)(load, module.exports, module);
  return module.exports;
}
const { IssueStore } = loadStore("store/issue/issue.store.ts");
const { ProjectIssues } = loadStore("store/issue/project/issue.store.ts");
const { CycleIssues } = loadStore("store/issue/cycle/issue.store.ts");
const { ModuleIssues } = loadStore("store/issue/module/issue.store.ts");
const { ProjectViewIssues } = loadStore("store/issue/project-views/issue.store.ts");
const { IssueSubIssuesStore } = loadStore("store/issue/issue-details/sub_issues.store.ts");

const orderBy = "custom_fields__field";
const issue = (id, value, parent_id = null) => ({
  id,
  name: id,
  project_id: "project",
  parent_id,
  custom_fields: { field: value },
  sequence_id: Number(value),
  created_at: "2026-11-10T00:00:00Z",
  archived_at: null,
});
const response = (items) => ({ results: items, total_count: items.length, next_page_results: false });
const deferred = () => {
  let fulfill;
  let reject;
  const promise = new Promise((yes, no) => {
    fulfill = yes;
    reject = no;
  });
  return { promise, resolve: fulfill, reject };
};
function fixture(selectedOrder = orderBy) {
  const filters = {
    issueFilters: { displayFilters: { order_by: selectedOrder, layout: "list", sub_issue: false } },
    getFilterParams: () => ({ order_by: filters.issueFilters.displayFilters.order_by }),
  };
  const root = {
    projectId: "project",
    workspaceSlug: "workspace",
    issues: new IssueStore(),
    projectIssuesFilter: filters,
    rootStore: { router: { projectId: "project" }, projectRoot: { project: { fetchProjectDetails: async () => {} } } },
    issueDetail: { relation: { extractRelationsFromIssues: () => {} } },
  };
  const store = new ProjectIssues(root, filters);
  root.projectIssues = store;
  root.issueDetail.subIssues = new IssueSubIssuesStore({ rootIssueStore: root }, "issues");
  const items = [issue("ten", 10), issue("twenty", 20)];
  store.onfetchIssues(response(items), { canGroup: false, perPageCount: 100 }, "workspace", "project");
  return { store, root, items };
}

test("editing a custom-sorted root retains visible IDs/count throughout the asynchronous refresh", async () => {
  const { store, items } = fixture();
  const network = deferred();
  const started = deferred();
  const observed = [];
  const dispose = autorun(() =>
    observed.push({
      ids: store.getIssueIds()?.slice(),
      count: store.getGroupIssueCount(undefined, undefined, false),
      loader: store.getIssueLoader(),
    })
  );
  store.issueService.patchIssue = async () => issue("twenty", 5);
  store.issueService.getIssues = async (_workspace, _project, queries) => {
    assert.equal(queries.order_by, orderBy);
    started.resolve();
    return network.promise;
  };
  const update = store.updateIssue("workspace", "project", "twenty", { custom_fields: { field: 5 } });
  await started.promise;
  assert.deepEqual(store.getIssueIds(), ["ten", "twenty"]);
  assert.equal(store.getGroupIssueCount(undefined, undefined, false), 2);
  network.resolve(response([issue("twenty", 5), items[0]]));
  await update;
  dispose();
  assert.deepEqual(store.getIssueIds(), ["twenty", "ten"]);
  assert.ok(observed.every((state) => state.ids?.length === 2 && state.count === 2 && state.loader !== "init-loader"));
});

test("creating a root requests authoritative custom order instead of leaving the new ID appended", async () => {
  const { store, items } = fixture();
  const created = issue("five", 5);
  let queries;
  store.issueService.createIssue = async () => created;
  store.issueService.getIssues = async (_workspace, _project, params) => {
    queries = params;
    return response([created, ...items]);
  };
  await store.createIssue("workspace", "project", { name: "five", custom_fields: { field: 5 } });
  assert.equal(queries?.order_by, orderBy);
  assert.deepEqual(store.getIssueIds(), ["five", "ten", "twenty"]);
  assert.equal(store.getGroupIssueCount(undefined, undefined, false), 3);
});

test("quick creation removes its optimistic row before applying server order/count", async () => {
  const { store, items, root } = fixture();
  const created = issue("five", 5);
  store.issueService.createIssue = async () => created;
  store.issueService.getIssues = async () => response([created, ...items]);
  await store.quickAddIssue("workspace", "project", { ...created, id: "temporary", tempId: "temporary" });
  assert.deepEqual(store.getIssueIds(), ["five", "ten", "twenty"]);
  assert.equal(store.getGroupIssueCount(undefined, undefined, false), 3);
  assert.equal(root.issues.getIssueById("temporary"), undefined);
});

test("creating and attaching children reorders only their sibling list and retains the root tree", async () => {
  const { store, root } = fixture();
  const children = root.issueDetail.subIssues;
  const oldChildren = [issue("child-ten", 10, "ten"), issue("child-twenty", 20, "ten")];
  const child = issue("child-five", 5, "ten");
  children.issueService.subIssues = async () => ({ sub_issues: oldChildren });
  await children.fetchSubIssues("workspace", "project", "ten", orderBy);
  store.issueService.createIssue = async () => child;
  let siblingFetches = 0;
  children.issueService.subIssues = async (_workspace, _project, parentId, params) => {
    siblingFetches++;
    assert.equal(parentId, "ten");
    assert.equal(params.order_by, orderBy);
    return { sub_issues: [child, ...oldChildren] };
  };
  await store.createIssue("workspace", "project", { name: child.name, parent_id: "ten", custom_fields: { field: 5 } });
  assert.equal(siblingFetches, 1);
  assert.deepEqual(children.subIssuesByIssueId("ten"), ["child-five", "child-ten", "child-twenty"]);
  assert.deepEqual(store.getIssueIds(), ["ten", "twenty"]);
  // Existing-work-item attachment follows a separate endpoint, which also needs authoritative ordering.
  children.issueService.addSubIssues = async () => ({ sub_issues: [child] });
  await children.createSubIssues("workspace", "project", "ten", [child.id]);
  assert.equal(siblingFetches, 2);
  assert.deepEqual(children.subIssuesByIssueId("ten"), ["child-five", "child-ten", "child-twenty"]);
});

test("failed custom refresh retains the last displayed tree and the successful persisted edit", async () => {
  const { store, root, items } = fixture();
  let patches = 0;
  store.issueService.patchIssue = async () => {
    patches++;
    return issue("twenty", 5);
  };
  store.issueService.getIssues = async () => {
    throw new Error("offline");
  };
  await store.updateIssue("workspace", "project", "twenty", { custom_fields: { field: 5 } });
  assert.deepEqual(store.getIssueIds(), ["ten", "twenty"]);
  assert.equal(store.getGroupIssueCount(undefined, undefined, false), 2);
  assert.equal(root.issues.getIssueById("twenty").custom_fields.field, 5);
  const notice = notifications.at(-1);
  assert.equal(notice.type, "warning");
  store.issueService.getIssues = async () => response([issue("twenty", 5), items[0]]);
  await notice.actionItems[0].onClick();
  assert.equal(patches, 1);
  assert.deepEqual(store.getIssueIds(), ["twenty", "ten"]);
});

for (const [kind, Store] of [
  ["project", ProjectIssues],
  ["cycle", CycleIssues],
  ["module", ModuleIssues],
  ["view", ProjectViewIssues],
]) {
  for (const [selectedOrder, loadType, expectPreserved] of [
    [orderBy, "mutation", true],
    ["priority", "mutation", false],
    [orderBy, "init-loader", false],
  ]) {
    test(`${kind} ${selectedOrder} ${loadType} preserves only custom mutation rows and still aborts prior requests`, async () => {
      const { root, items } = fixture(selectedOrder);
      const store = new Store(root, root.projectIssuesFilter);
      store.fetchParentStats = () => {};
      store.onfetchIssues(response(items), { canGroup: false, perPageCount: 100 }, "workspace", "project");
      const previousController = store.controller;
      const network = deferred();
      store.issueService.getIssues = async () => network.promise;
      const refresh =
        kind === "project"
          ? store.fetchIssuesWithExistingPagination("workspace", "project", loadType)
          : kind === "view"
            ? store.fetchIssuesWithExistingPagination("workspace", "project", "view", loadType)
            : store.fetchIssuesWithExistingPagination("workspace", "project", loadType, kind);
      assert.equal(store.getGroupIssueCount(undefined, undefined, false), expectPreserved ? 2 : undefined);
      assert.equal(previousController.signal.aborted, true);
      network.resolve(response(items));
      await refresh;
      assert.deepEqual(store.getIssueIds(), ["ten", "twenty"]);
    });
  }
}

for (const [kind, Store] of [
  ["cycle", CycleIssues],
  ["module", ModuleIssues],
]) {
  for (const quick of [false, true]) {
    test(`${kind} ${quick ? "quick" : "normal"} creation refreshes after native membership and temporary-row cleanup`, async () => {
      const { root, items } = fixture();
      const filters = root.projectIssuesFilter;
      const store = new Store(root, filters);
      root[`${kind}Id`] = kind;
      root[`${kind}Issues`] = store;
      root[`${kind}IssuesFilter`] = filters;
      store.fetchParentStats = () => {};
      store.onfetchIssues(response(items), { canGroup: false, perPageCount: 100 }, "workspace", "project");
      const created = issue("five", 5);
      let attached = false;
      store.issueService.createIssue = async () => created;
      store.issueService.addIssueToCycle = async () => {
        attached = true;
      };
      store.moduleService.addModulesToIssue = async () => {
        attached = true;
      };
      store.issueService.getIssues = async (_workspace, _project, params) => {
        assert.equal(attached, true);
        assert.equal(params.order_by, orderBy);
        return response([created, ...items]);
      };
      if (quick)
        await store.quickAddIssue("workspace", "project", { ...created, id: "temporary", tempId: "temporary" }, kind);
      else await store.createIssue("workspace", "project", { name: "five", custom_fields: { field: 5 } }, kind);
      assert.deepEqual(store.getIssueIds(), ["five", "ten", "twenty"]);
      assert.equal(store.getGroupIssueCount(undefined, undefined, false), 3);
      assert.equal(root.issues.getIssueById("temporary"), undefined);
    });
  }
}

for (const quick of [false, true]) {
  test(`${quick ? "quick" : "normal"} create remains successful when order refresh fails and retry performs GET only`, async () => {
    const { store, items, root } = fixture();
    const created = issue("five", 5);
    let writes = 0;
    let reads = 0;
    let finalized = false;
    store.issueService.createIssue = async () => {
      writes++;
      return created;
    };
    store.issueService.getIssues = async () => {
      reads++;
      throw new Error("offline");
    };
    const result = quick
      ? await store.quickAddIssue("workspace", "project", { ...created, id: "temporary", tempId: "temporary" })
      : await store.createIssue("workspace", "project", { name: "five", custom_fields: { field: 5 } });
    // This is the caller's follow-up sequence (assets/properties/children); a refresh rejection must not skip it.
    finalized = true;
    assert.equal(result.id, "five");
    assert.equal(finalized, true);
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    assert.deepEqual(store.getIssueIds(), ["ten", "twenty", "five"]);
    assert.equal(store.getGroupIssueCount(undefined, undefined, false), 3);
    assert.equal(root.issues.getIssueById("temporary"), undefined);
    const notice = notifications.at(-1);
    assert.equal(notice.type, "warning");
    store.issueService.getIssues = async () => {
      reads++;
      return response([created, ...items]);
    };
    await notice.actionItems[0].onClick();
    assert.equal(writes, 1);
    assert.equal(reads, 2);
    assert.deepEqual(store.getIssueIds(), ["five", "ten", "twenty"]);
  });
}

test("child create and attachment remain successful after sibling refresh failure, and retry only reads", async () => {
  const { store, root } = fixture();
  const children = root.issueDetail.subIssues;
  const existing = [issue("child-ten", 10, "ten")];
  const child = issue("child-five", 5, "ten");
  children.issueService.subIssues = async () => ({ sub_issues: existing });
  await children.fetchSubIssues("workspace", "project", "ten", orderBy);
  let creates = 0;
  let attachments = 0;
  store.issueService.createIssue = async () => {
    creates++;
    return child;
  };
  children.issueService.subIssues = async () => {
    throw new Error("offline");
  };
  const created = await store.createIssue("workspace", "project", { name: child.name, parent_id: "ten" });
  assert.equal(created.id, child.id);
  assert.equal(creates, 1);
  assert.deepEqual(children.subIssuesByIssueId("ten"), ["child-ten"]);
  assert.equal(children.loader, undefined);
  children.issueService.addSubIssues = async () => {
    attachments++;
    return { sub_issues: [child] };
  };
  await children.createSubIssues("workspace", "project", "ten", [child.id]);
  assert.equal(attachments, 1);
  assert.deepEqual(children.subIssuesByIssueId("ten"), ["child-ten", "child-five"]);
  assert.equal(children.loader, undefined);
  const notice = notifications.at(-1);
  assert.equal(notice.type, "warning");
  children.issueService.subIssues = async () => ({ sub_issues: [child, ...existing] });
  await notice.actionItems[0].onClick();
  assert.equal(creates, 1);
  assert.equal(attachments, 1);
  assert.deepEqual(children.subIssuesByIssueId("ten"), ["child-five", "child-ten"]);
});

test("actual create, attachment and patch write failures still reject; patch restores prior values", async () => {
  const { store, root } = fixture();
  const writesFailed = new Error("write denied");
  const notificationCount = notifications.length;
  store.issueService.createIssue = async () => {
    throw writesFailed;
  };
  await assert.rejects(store.createIssue("workspace", "project", { name: "five" }), /write denied/);
  root.issueDetail.subIssues.issueService.addSubIssues = async () => {
    throw writesFailed;
  };
  await assert.rejects(
    root.issueDetail.subIssues.createSubIssues("workspace", "project", "ten", ["five"]),
    /write denied/
  );
  store.issueService.patchIssue = async () => {
    throw writesFailed;
  };
  await assert.rejects(
    store.updateIssue("workspace", "project", "twenty", { custom_fields: { field: 5 } }),
    /write denied/
  );
  assert.equal(root.issues.getIssueById("twenty").custom_fields.field, 20);
  assert.deepEqual(store.getIssueIds(), ["ten", "twenty"]);
  assert.equal(notifications.length, notificationCount);
});

const passthrough = (props) => props.children;
const Null = () => null;

for (const layout of ["spreadsheet", "list"]) {
  test(`${layout} renders custom-ordered grandchildren after each async sibling fetch`, async () => {
    const blockRequire = createRequire(resolve(webRoot, "../../packages/blocks/package.json"));
    const { JSDOM } = blockRequire("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const previous = new Map(
      ["window", "document", "navigator", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ])
    );
    Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true, writable: true });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: dom.window.HTMLElement,
      configurable: true,
      writable: true,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const React = require("react");
    const { act } = React;
    const { createRoot } = require("react-dom/client");
    const { root: storeRoot, store } = fixture();
    const detail = storeRoot.issueDetail;
    Object.assign(detail, { issue: storeRoot.issues, getIsIssuePeeked: () => false, peekIssue: null });
    const childIssues = [{ ...issue("child-one", 1, "ten"), sub_issues_count: 2 }, issue("child-two", 2, "ten")];
    const grandchildren = [issue("grandchild-one", 1, "child-one"), issue("grandchild-two", 2, "child-one")];
    storeRoot.issues.updateIssue("ten", { sub_issues_count: 2 });
    const requested = [];
    const childResponse = deferred();
    detail.subIssues.issueService.subIssues = async (_workspace, _project, parentId, params) => {
      requested.push([parentId, params.order_by]);
      if (parentId === "ten") return { sub_issues: childIssues };
      return childResponse.promise;
    };
    const icon = (props) => React.createElement("svg", { className: props.className });
    const mocks = {
      "next/navigation": { useParams: () => ({ workspaceSlug: "workspace", projectId: "project" }) },
      "@makeplane/propel/icons": { ChevronRightOutline: icon, MoreHorizontalOutline: icon },
      "@plane/hooks": { useOutsideClickDetector: () => {} },
      "@makeplane/propel/components/tooltip": { Tooltip: passthrough },
      "@plane/blocks/layout": {
        ControlLink: ({ children, onClick }) => React.createElement("div", { onClick }, children),
        Row: ({ children, className }) => React.createElement("div", { className }, children),
      },
      "@/components/core/multiple-select": { MultipleSelectEntityAction: Null },
      "@/components/core/render-if-visible-HOC": {
        __esModule: true,
        default: ({ as = "div", children }) => React.createElement(as, null, children),
      },
      "@/components/issues/issue-detail/issue-identifier": { IssueIdentifier: Null },
      "@/hooks/store/use-issue-detail": { useIssueDetail: () => detail },
      "@/hooks/store/use-issues": { useIssues: () => ({ issueMap: storeRoot.issues.issuesMap }) },
      "@/hooks/store/use-project": { useProject: () => ({ getProjectIdentifierById: () => "TEST" }) },
      "@/hooks/use-issue-peek-overview-redirection": {
        __esModule: true,
        default: () => ({ handleRedirection: () => {} }),
      },
      "@/hooks/use-platform-os": { usePlatformOS: () => ({ isMobile: false }) },
      "@/hooks/use-issue-layout-store": {
        useIssuesStore: () => ({ issueMap: storeRoot.issues.issuesMap, issuesFilter: storeRoot.projectIssuesFilter }),
      },
      "../utils": { isIssueNew: () => true, HIGHLIGHT_CLASS: "highlight", getIssueBlockId: (id) => id },
      "@atlaskit/pragmatic-drag-and-drop/combine": { combine: () => () => {} },
      "@atlaskit/pragmatic-drag-and-drop/element/adapter": { dropTargetForElements: () => () => {} },
      "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item": {
        attachInstruction: () => ({}),
        extractInstruction: () => null,
      },
      "@plane/blocks/common": { DropIndicator: Null },
      "@/components/ui/loader/layouts/list-layout-loader": { ListLoaderItemRow: Null },
      "./block": {
        IssueBlock: ({ issueId, setExpanded }) =>
          React.createElement(
            "div",
            { "data-issue-row": issueId },
            React.createElement("button", { onClick: () => setExpanded((expanded) => !expanded) }, issueId)
          ),
      },
      "./custom-field-columns": { CustomFieldCells: Null },
      "./issue-column": { IssueColumn: Null },
    };
    // The hook itself must resolve the same real-store fixture as the rendered row.
    for (const [key, value] of Object.entries(mocks)) renderMocks.set(key, value);
    modules.delete(resolve(webRoot, "hooks/use-ordered-sub-issues.ts"));
    renderMocks.set("@/hooks/use-ordered-sub-issues", loadStore("hooks/use-ordered-sub-issues.ts"));
    const Component =
      layout === "spreadsheet"
        ? loadStore("components/issues/issue-layouts/spreadsheet/issue-row.tsx").SpreadsheetIssueRow
        : loadStore("components/issues/issue-layouts/list/block-root.tsx").IssueBlockRoot;
    const container = document.createElement("div");
    document.body.append(container);
    const renderer = createRoot(container);
    const props = {
      issueId: "ten",
      issuesMap: storeRoot.issues.issuesMap,
      groupId: "all",
      isDragAllowed: false,
      canDropOverIssue: false,
      displayProperties: {},
      isEstimateEnabled: false,
      quickActions: Null,
      canEditProperties: () => false,
      portalElement: { current: null },
      nestingLevel: 0,
      isScrolled: { current: false },
      containerRef: { current: null },
      spreadsheetColumnsList: [],
      selectionHelpers: { getIsEntitySelected: () => false, getIsEntityActive: () => false, isSelectionDisabled: true },
    };
    const renderedIds = () =>
      layout === "spreadsheet"
        ? [...container.querySelectorAll("td[id^=issue-]")].map((node) => node.id.slice("issue-".length))
        : [...container.querySelectorAll("[data-issue-row]")].map((node) => node.dataset.issueRow);
    const expandButton = (id) =>
      layout === "spreadsheet"
        ? container.querySelector(`#issue-${id} button`)
        : container.querySelector(`[data-issue-row="${id}"] button`);
    try {
      await act(async () =>
        renderer.render(
          layout === "spreadsheet"
            ? React.createElement(
                "table",
                null,
                React.createElement("tbody", null, React.createElement(Component, props))
              )
            : React.createElement(Component, props)
        )
      );
      await act(async () => expandButton("ten").click());
      assert.deepEqual(renderedIds(), ["ten", "child-one", "child-two"]);
      await act(async () => expandButton("child-one").click());
      await act(async () => {
        childResponse.resolve({ sub_issues: grandchildren });
        await childResponse.promise;
      });
      assert.deepEqual(detail.subIssues.subIssuesByIssueId("child-one"), ["grandchild-one", "grandchild-two"]);
      assert.deepEqual(requested, [
        ["ten", orderBy],
        ["child-one", orderBy],
      ]);
      assert.deepEqual(renderedIds(), ["ten", "child-one", "grandchild-one", "grandchild-two", "child-two"]);
      assert.deepEqual(store.getIssueIds(), ["ten", "twenty"]);
    } finally {
      await act(async () => renderer.unmount());
      renderMocks.clear();
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
}
