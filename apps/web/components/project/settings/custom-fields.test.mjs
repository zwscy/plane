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
import { after, test } from "node:test";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const blockRoot = resolve(webRoot, "../../packages/blocks");
const require = createRequire(resolve(webRoot, "package.json"));
const blockRequire = createRequire(resolve(blockRoot, "package.json"));
const { JSDOM } = blockRequire("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost",
});
const globals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  IS_REACT_ACT_ENVIRONMENT: true,
};
const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals))
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
Object.defineProperty(dom.window.Element.prototype, "getAnimations", { value: () => [], configurable: true });
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const primitives = Object.fromEntries(
  await Promise.all(
    ["button", "popover", "tabs"].map(async (name) => {
      const specifier = `@makeplane/propel/components/${name}`;
      return [specifier, await import(specifier)];
    })
  )
);
const icons = await import("@makeplane/propel/icons");

after(() => {
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

const definition = {
  id: "amount",
  project_id: "project",
  name: "采购金额",
  description: "",
  field_type: "integer",
  options: [],
  sort_order: 1000,
  is_active: true,
  is_type_locked: false,
  icon: null,
};

async function render({ field = {}, empty = false } = {}) {
  const fields = empty ? [] : [{ ...definition, ...field }];
  const calls = [];
  const service = {
    async update(workspace, project, id, payload) {
      calls.push({ method: "update", workspace, project, id, payload });
      Object.assign(
        fields.find((item) => item.id === id),
        payload
      );
    },
    async create(workspace, project, payload) {
      calls.push({ method: "create", workspace, project, payload });
      fields.push({ ...definition, ...payload });
    },
  };
  const modules = new Map();
  const mocks = {
    ...primitives,
    "@makeplane/propel/icons": icons,
    // Translation resolution is covered with the actual runtime in the shared picker tests.
    "@plane/i18n": { useTranslation: () => ({ t: (key) => key }) },
    "@plane/blocks/toast": { setToast() {} },
    "@plane/utils": { cn: (...values) => values.filter((value) => typeof value === "string").join(" ") },
    "@/hooks/use-project-custom-fields": {
      projectCustomFieldService: service,
      useProjectCustomFields: () => ({ fields, isLoading: false, mutate: async () => fields }),
    },
    // The requested picker has no emoji or Material tab; keep its real Lucide search, colors and popover.
    "./emoji/emoji": {
      EmojiRoot: () => {
        throw new Error("Emoji tab must stay hidden");
      },
    },
    "./material-root": {
      MaterialIconList: () => {
        throw new Error("Material icons must stay hidden");
      },
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const dependency = (specifier) => {
      if (mocks[specifier]) return mocks[specifier];
      if (specifier === "@plane/blocks/emoji-icon-picker")
        return load(resolve(blockRoot, "src/emoji-icon-picker/emoji-picker.tsx"));
      const target = specifier.startsWith("@/")
        ? resolve(webRoot, specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(file), specifier)
          : null;
      if (target)
        for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"])
          if (existsSync(target + suffix)) return load(target + suffix);
      return (file.startsWith(blockRoot) ? blockRequire : require)(specifier);
    };
    new Function("require", "exports", "module", code)(dependency, module.exports, module);
    return module.exports;
  }
  const { ProjectCustomFieldsSettings } = load(resolve(webRoot, "components/project/settings/custom-fields.tsx"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(React.createElement(ProjectCustomFieldsSettings, { workspaceSlug: "workspace", projectId: "project" }))
  );
  const button = (label) => {
    const found = [...document.querySelectorAll("button")].find(
      (node) => node.textContent.trim() === label || node.getAttribute("aria-label") === label
    );
    assert.ok(found, `button ${label} exists`);
    return found;
  };
  return {
    container,
    fields,
    calls,
    button,
    form: () => container.querySelector("form"),
    preview: () => container.querySelector('form [aria-label="字段图标"] svg'),
    async click(label) {
      await act(async () => button(label).click());
    },
    async change(input, value) {
      await act(async () => {
        const prototype =
          input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      });
    },
    async save() {
      await act(async () =>
        container
          .querySelector("form")
          .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
      );
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("field form filters actual Lucide choices, saves an icon/color and preserves it across type changes", async () => {
  const ui = await render();
  try {
    await ui.click("编辑");
    await ui.click("选择图标");
    assert.equal(document.querySelector('[role="tablist"]'), null, "icon-only picker hides emoji tabs");
    const search = document.querySelector('input[placeholder="搜索图标"]');
    assert.ok(search);
    await ui.change(search, "clock");
    assert.ok(document.querySelector('button[aria-label="Clock"]'));
    assert.equal(document.querySelector('button[aria-label="Activity"]'), null);
    await ui.click("#02b55c");
    await ui.click("Clock");
    assert.ok(ui.preview().classList.contains("lucide-clock"));
    assert.equal(ui.preview().style.color, "rgb(2, 181, 92)");
    await ui.change(ui.form().querySelector("select"), "decimal");
    assert.ok(ui.preview().classList.contains("lucide-clock"));
    assert.deepEqual(ui.calls, [], "picker changes stay in the field draft");
    await ui.save();
    assert.equal(ui.calls.length, 1);
    assert.deepEqual(ui.calls[0].payload.icon, { name: "Clock", color: "#02b55c" });
    assert.equal(ui.calls[0].payload.field_type, "decimal");
    assert.equal(ui.form(), null);
    assert.ok(ui.container.querySelector("svg.lucide-clock"), "saved field list previews its selected icon");
  } finally {
    await ui.close();
  }
});

test("cancelling an icon change leaves the saved field untouched and reopening restores its icon", async () => {
  const ui = await render({ field: { icon: { name: "Clock", color: "#123456" } } });
  try {
    await ui.click("编辑");
    await ui.click("选择图标");
    await ui.click("Activity");
    assert.ok(ui.preview().classList.contains("lucide-activity"));
    await ui.click("取消");
    assert.deepEqual(ui.calls, []);
    await ui.click("编辑");
    assert.ok(ui.preview().classList.contains("lucide-clock"));
    assert.equal(ui.preview().style.color, "rgb(18, 52, 86)");
  } finally {
    await ui.close();
  }
});

test("restoring default saves explicit null even when the field type is locked", async () => {
  const ui = await render({ field: { icon: { name: "Clock", color: "#123456" }, is_type_locked: true } });
  try {
    await ui.click("编辑");
    assert.equal(ui.form().querySelector("select").disabled, true);
    await ui.click("恢复默认图标");
    assert.equal(ui.preview().classList.contains("lucide-clock"), false);
    assert.equal(ui.button("恢复默认图标").disabled, true);
    await ui.save();
    assert.equal(ui.calls[0].payload.icon, null);
  } finally {
    await ui.close();
  }
});

test("new fields start with a default icon and save explicit null", async () => {
  const ui = await render({ empty: true });
  try {
    await ui.click("新建字段");
    assert.equal(ui.button("恢复默认图标").disabled, true);
    await ui.change(ui.form().querySelector("input[required]"), "新字段");
    await ui.save();
    assert.equal(ui.calls[0].method, "create");
    assert.equal(ui.calls[0].payload.icon, null);
  } finally {
    await ui.close();
  }
});

for (const icon of [undefined, { name: "FutureIcon", color: "#123456" }]) {
  test(`${icon ? "unknown" : "old"} icon definitions safely render the field type in settings`, async () => {
    const fallback = await render({ field: { icon } });
    try {
      await fallback.click("编辑");
      assert.equal(fallback.preview().dataset.customFieldType, "integer");
      assert.equal(fallback.preview().style.color, "");
    } finally {
      await fallback.close();
    }
  });
}
