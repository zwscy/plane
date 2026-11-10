/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const webRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(resolve(webRoot, "package.json"));
const blockRequire = createRequire(resolve(webRoot, "../../packages/blocks/package.json"));
const { JSDOM } = blockRequire("jsdom");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { observable, runInAction } = require("mobx");
const { EIssuesStoreType } = require("@plane/types");
const { EUserPermissions, EUserPermissionsLevel } = require("@plane/constants");

async function render({ following = true, admin = false, storeType = EIssuesStoreType.PROJECT, fail = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const state = observable({ following, pending: false });
  const calls = [];
  const toasts = [];
  let finish;
  const operation = async (action, workspace, project) => {
    calls.push([action, workspace, project]);
    runInAction(() => {
      state.pending = true;
    });
    try {
      await new Promise((complete) => {
        finish = complete;
      });
      if (fail) throw new Error("offline");
      if (action === "reset")
        runInAction(() => {
          state.following = true;
        });
    } finally {
      runInAction(() => {
        state.pending = false;
      });
    }
  };
  const store = {
    getUseProjectDefault: () => state.following,
    getDisplayConfigPending: () => state.pending,
    saveProjectDisplayConfig: (workspace, project) => operation("save", workspace, project),
    resetProjectDisplayConfig: (workspace, project) => operation("reset", workspace, project),
  };
  const mocks = {
    "@/hooks/store/use-issues": {
      useIssues: (type) => {
        assert.equal(type, EIssuesStoreType.PROJECT);
        return { issuesFilter: store };
      },
    },
    "@/hooks/store/user": {
      useUserPermissions: () => ({
        allowPermissions: (roles, level, workspace, project) => {
          assert.deepEqual(roles, [EUserPermissions.ADMIN]);
          assert.equal(level, EUserPermissionsLevel.PROJECT);
          assert.equal(workspace, "workspace");
          assert.equal(project, "project");
          return admin;
        },
      }),
    },
    "@plane/i18n": { useTranslation: () => ({ t: (key) => key }) },
    "@plane/blocks/toast": { setToast: (toast) => toasts.push(toast) },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(resolve(webRoot, "components/issues/project-display-config-controls.tsx"), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }
  ).outputText;
  new Function("require", "exports", "module", code)(
    (specifier) => mocks[specifier] ?? require(specifier),
    module.exports,
    module
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(module.exports.ProjectDisplayConfigControls, {
        workspaceSlug: "workspace",
        projectId: "project",
        storeType,
      })
    )
  );
  return {
    container,
    calls,
    toasts,
    async click(action) {
      await act(async () => container.querySelector(`[data-display-action=${action}]`).click());
    },
    async finish() {
      await act(async () => finish());
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("member follows project defaults without save/restore actions", async () => {
  const ui = await render();
  try {
    assert.ok(ui.container.textContent.includes("issue.display.project_defaults.following"));
    assert.equal(ui.container.querySelectorAll("button").length, 0);
  } finally {
    await ui.close();
  }
});

test("personal member can restore; pending disables action, completion updates status and toast", async () => {
  const ui = await render({ following: false });
  try {
    assert.ok(ui.container.textContent.includes("issue.display.project_defaults.personal"));
    assert.equal(ui.container.querySelector("[data-display-action=save]"), null);
    await ui.click("reset");
    assert.equal(ui.container.querySelector("button").disabled, true);
    assert.deepEqual(ui.calls, [["reset", "workspace", "project"]]);
    await ui.finish();
    assert.equal(ui.container.querySelector("button"), null);
    assert.equal(ui.toasts[0].type, "success");
  } finally {
    await ui.close();
  }
});

test("admin save disables both actions; failed request retains personal status and gives feedback", async () => {
  const ui = await render({ following: false, admin: true, fail: true });
  try {
    await ui.click("save");
    assert.ok([...ui.container.querySelectorAll("button")].every((button) => button.disabled));
    await ui.finish();
    assert.equal(ui.toasts[0].type, "error");
    assert.ok(ui.container.textContent.includes("issue.display.project_defaults.personal"));
    assert.ok([...ui.container.querySelectorAll("button")].every((button) => !button.disabled));
  } finally {
    await ui.close();
  }
});

for (const storeType of [
  EIssuesStoreType.CYCLE,
  EIssuesStoreType.MODULE,
  EIssuesStoreType.EPIC,
  EIssuesStoreType.PROJECT_VIEW,
  EIssuesStoreType.GLOBAL,
  EIssuesStoreType.ARCHIVED,
]) {
  test(`${storeType} does not show project defaults or invoke project store hooks`, async () => {
    const ui = await render({ storeType, admin: true });
    try {
      assert.equal(ui.container.textContent, "");
      assert.equal(ui.container.querySelector("button"), null);
    } finally {
      await ui.close();
    }
  });
}
