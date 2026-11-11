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

const webRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(resolve(webRoot, "package.json"));
const blockRequire = createRequire(resolve(webRoot, "../../packages/blocks/package.json"));
const { JSDOM } = blockRequire("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost",
});
const globals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  PointerEvent: dom.window.PointerEvent,
  TouchEvent: dom.window.TouchEvent,
  FocusEvent: dom.window.FocusEvent,
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
// jsdom has no layout animations; Base UI's scroll area waits for this browser API.
Object.defineProperty(dom.window.Element.prototype, "getAnimations", { value: () => [], configurable: true });
// jsdom 23 sends Document as blur's relatedTarget; normalize this unfocused target for Base UI.
document.addEventListener(
  "focusout",
  (event) => {
    if (event.relatedTarget === document) Object.defineProperty(event, "relatedTarget", { value: null });
  },
  true
);
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { observable, runInAction } = require("mobx");
const primitives = Object.fromEntries(
  await Promise.all(
    [
      "@makeplane/propel/components/menu",
      "@makeplane/propel/components/popover",
      "@makeplane/propel/components/button",
      "@makeplane/propel/components/icon",
      "@makeplane/propel/icons",
      "@plane/blocks/select",
    ].map(async (specifier) => [specifier, await import(specifier)])
  )
);

after(async () => {
  await act(async () => document.activeElement?.blur());
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
  sort_order: 1,
  is_active: true,
  is_type_locked: false,
};

async function render({
  field = {},
  value = 12,
  disabled = false,
  writable = true,
  projectId = "project",
  fail = false,
  immediateFailure = false,
  optionsState = {},
} = {}) {
  const customField = { ...definition, ...field };
  const issue = observable({ id: "issue", project_id: projectId, custom_fields: { amount: value, keep: "保留" } });
  const calls = [];
  const orderChanges = [];
  const filters = observable({ order_by: "sort_order" });
  let finish;
  const updateIssue = async (...args) => {
    calls.push(args);
    if (immediateFailure) throw new Error("offline");
    await new Promise((complete) => {
      finish = complete;
    });
    if (fail) throw new Error("offline");
    runInAction(() => Object.assign(issue.custom_fields, args[2].custom_fields));
  };
  const modules = new Map();
  const mocks = {
    "next/navigation": { useParams: () => ({ workspaceSlug: "workspace", projectId: "project" }) },
    "@plane/i18n": { useTranslation: () => ({ t: (key) => key }) },
    "./use-options": {
      useCustomFieldOptions: (_workspace, _project, requestedField) => ({
        options: ["select", "multi_select", "member", "members"].includes(requestedField.field_type)
          ? requestedField.options
          : undefined,
        isLoading: false,
        error: undefined,
        ...optionsState,
      }),
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const loadDependency = (specifier) => {
      if (mocks[specifier]) return mocks[specifier];
      if (primitives[specifier]) return primitives[specifier];
      if (specifier === "@/components/issues/custom-fields")
        return load(resolve(webRoot, "components/issues/custom-fields/editor.tsx"));
      const target = specifier.startsWith("@/")
        ? resolve(webRoot, specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(file), specifier)
          : null;
      if (target) {
        for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"])
          if (existsSync(target + suffix)) return load(target + suffix);
      }
      return require(specifier);
    };
    new Function("require", "exports", "module", code)(loadDependency, module.exports, module);
    return module.exports;
  }
  const { CustomFieldCell, CustomFieldHeader } = load(
    resolve(webRoot, "components/issues/issue-layouts/spreadsheet/custom-field-columns.tsx")
  );
  const { useTableKeyboardNavigation } = load(resolve(webRoot, "hooks/use-table-keyboard-navigation.tsx"));
  const container = document.createElement("div");
  document.body.append(container);
  const outside = document.createElement("button");
  outside.textContent = "外部操作";
  document.body.append(outside);
  const root = createRoot(container);
  function Table() {
    const onKeyDown = useTableKeyboardNavigation();
    return React.createElement(
      "table",
      { onKeyDown },
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement(CustomFieldHeader, {
            field: customField,
            displayFilters: filters,
            onChange: (patch) => {
              orderChanges.push(patch);
              runInAction(() => Object.assign(filters, patch));
            },
          })
        )
      ),
      React.createElement(
        "tbody",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement(CustomFieldCell, {
            field: customField,
            issue,
            disabled,
            updateIssue: writable ? updateIssue : undefined,
          })
        )
      )
    );
  }
  await act(async () => root.render(React.createElement(Table)));
  return {
    container,
    calls,
    issue,
    orderChanges,
    cell: () => container.querySelector("td"),
    header: () => container.querySelector("th"),
    editor: () => document.querySelectorAll("input, select, textarea")[0] ?? null,
    async click(node) {
      await act(async () => node.click());
    },
    async outsideClick({ moveFocus = true } = {}) {
      const dispatch = async (type) =>
        await act(async () => {
          const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0 });
          Object.defineProperty(event, "pointerType", { value: "mouse" });
          outside.dispatchEvent(event);
        });
      await dispatch("pointerdown");
      await dispatch("mousedown");
      if (moveFocus) await act(async () => outside.focus());
      await dispatch("pointerup");
      await dispatch("mouseup");
      await dispatch("click");
    },
    async outsideClickBeforeReactBlur() {
      const input = document.querySelectorAll("input, textarea")[0];
      const pauseBlur = (event) => {
        if (event.target === input) event.stopImmediatePropagation();
      };
      document.addEventListener("focusout", pauseBlur, true);
      await act(async () => outside.focus());
      document.removeEventListener("focusout", pauseBlur, true);
      assert.equal(document.activeElement === outside, true);
      await act(async () => {
        // Chrome can deliver the native dismiss before React's delegated blur callback.
        flushSync(() => outside.click());
        input.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
      });
      await act(async () => new Promise((complete) => requestAnimationFrame(complete)));
    },
    async key(node, key) {
      await act(async () => node.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true })));
      if (key === "Escape")
        await act(async () => new Promise((complete) => requestAnimationFrame(() => requestAnimationFrame(complete))));
    },
    async edit(rawValue) {
      const input = document.querySelectorAll("input, textarea")[0];
      const prototype =
        input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, rawValue);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    async finish() {
      await act(async () => finish());
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
      outside.remove();
    },
  };
}

for (const [type, value, text] of [
  ["integer", 0, "0"],
  ["decimal", 1.5, "1.5"],
  ["boolean", false, "否"],
  ["text", "", "未设置"],
  ["text", null, "未设置"],
  ["textarea", "第一行\n第二行", "第一行\n第二行"],
  ["multi_select", ["one", "two"], "第一项、第二项"],
]) {
  test(`idle ${type} renders ${JSON.stringify(value)} compactly without edit controls`, async () => {
    const ui = await render({
      field: {
        field_type: type,
        options: [
          { id: "one", name: "第一项", is_active: true },
          { id: "two", name: "第二项", is_active: false },
        ],
      },
      value,
    });
    try {
      assert.equal(ui.editor() === null, true, "idle cells must not mount edit controls");
      assert.equal(ui.cell().textContent, text);
      assert.equal(ui.cell().querySelector("svg") === null, true, "custom field values have no repeated prefix icon");
      assert.equal(ui.cell().querySelector("button").getAttribute("aria-label"), "采购金额");
      assert.deepEqual(ui.calls, []);
    } finally {
      await ui.close();
    }
  });
}

test("click opens the real editor; unchanged dismissal writes nothing", async () => {
  const ui = await render();
  try {
    assert.equal(ui.editor() === null, true, "idle cells must not mount edit controls");
    await ui.click(ui.cell().querySelector(".clickable"));
    assert.equal(ui.editor().value, "12");
    assert.deepEqual(ui.calls, []);
    await ui.key(ui.editor(), "Escape");
    assert.equal(ui.editor() === null, true, "idle cells must not mount edit controls");
    assert.equal(document.activeElement === ui.cell(), true);
    assert.deepEqual(ui.calls, []);
  } finally {
    await ui.close();
  }
});

test("unchanged outside dismissal closes after blur delivery without writing", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.outsideClick();
    await act(async () => new Promise((complete) => requestAnimationFrame(complete)));
    assert.equal(ui.editor() === null, true);
    assert.deepEqual(ui.calls, []);
  } finally {
    await ui.close();
  }
});

test("Escape discards uncommitted input without writing on close", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("99");
    await ui.key(ui.editor(), "Escape");
    assert.equal(ui.editor() === null, true);
    assert.equal(document.activeElement === ui.cell(), true);
    assert.equal(ui.cell().textContent, "12");
    assert.deepEqual(ui.calls, []);
  } finally {
    await ui.close();
  }
});

for (const key of ["Enter", "Space"]) {
  test(`table keyboard ${key} opens the custom field editor`, async () => {
    const ui = await render();
    try {
      assert.equal(ui.editor() === null, true);
      await ui.key(ui.cell(), key);
      assert.ok(ui.editor());
      assert.deepEqual(ui.calls, []);
    } finally {
      await ui.close();
    }
  });
}

for (const permissions of [{ disabled: true }, { writable: false }]) {
  test(`read-only cell ${JSON.stringify(permissions)} keeps formatted value without an editable popover`, async () => {
    const ui = await render(permissions);
    try {
      assert.equal(ui.editor() === null, true, "idle cells must not mount edit controls");
      const trigger = ui.cell().querySelector("button");
      assert.equal(trigger.disabled, true);
      await ui.click(trigger);
      await ui.key(ui.cell(), "Enter");
      assert.equal(ui.editor() === null, true, "idle cells must not mount edit controls");
      assert.equal(ui.cell().textContent, "12");
      assert.deepEqual(ui.calls, []);
    } finally {
      await ui.close();
    }
  });
}

test("cell outside the current project has no field display or editor", async () => {
  const ui = await render({ projectId: "other-project" });
  try {
    assert.equal(ui.cell().textContent, "");
    assert.equal(ui.cell().querySelector("button"), null);
    assert.equal(ui.editor() === null, true, "idle cells must not mount edit controls");
  } finally {
    await ui.close();
  }
});

test("editing zero persists only this field, shows pending state, and keeps the editor open", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("0");
    await ui.key(ui.editor(), "Enter");
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 0 } }]]);
    assert.equal(ui.editor().disabled, true);
    await ui.finish();
    assert.equal(ui.editor().disabled, false);
    assert.equal(ui.editor().value, "0");
    assert.equal(ui.issue.custom_fields.keep, "保留");
    await ui.key(ui.editor(), "Escape");
    assert.equal(ui.cell().textContent, "0");
  } finally {
    await ui.close();
  }
});

test("failed save keeps the attempted value and error visible in the open editor", async () => {
  const ui = await render({ fail: true });
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("30");
    await ui.key(ui.editor(), "Enter");
    await ui.finish();
    assert.equal(ui.editor().value, "30");
    assert.equal(ui.editor().disabled, false);
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存失败"));
    assert.equal(ui.issue.custom_fields.amount, 12);
  } finally {
    await ui.close();
  }
});

test("outside pointer dismissal commits dirty input and retains a failed draft", async () => {
  const ui = await render({ fail: true });
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("45");
    await ui.outsideClick();
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 45 } }]]);
    assert.equal(ui.editor() !== null, true, "pending blur save must retain its editor");
    assert.equal(ui.editor().disabled, true);
    await ui.finish();
    assert.equal(ui.editor().value, "45");
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存失败"));
    assert.equal(ui.issue.custom_fields.amount, 12);
  } finally {
    await ui.close();
  }
});

test("outside dismissal before native blur still commits and retains a failed draft", async () => {
  const ui = await render({ fail: true });
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("45");
    await ui.outsideClick({ moveFocus: false });
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 45 } }]]);
    assert.equal(ui.editor() !== null, true);
    await ui.finish();
    assert.equal(ui.editor().value, "45");
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存失败"));
  } finally {
    await ui.close();
  }
});

for (const fail of [false, true]) {
  test(`native dismissal before React blur preserves the ${fail ? "failed draft" : "successful save"}`, async () => {
    const ui = await render({ fail });
    try {
      await ui.click(ui.cell().querySelector(".clickable"));
      await ui.edit("3");
      await ui.outsideClickBeforeReactBlur();
      assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 3 } }]]);
      assert.equal(ui.editor() !== null, true);
      await ui.finish();
      if (fail) {
        assert.equal(ui.editor().value, "3");
        assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存失败"));
      } else {
        assert.equal(ui.editor() === null, true);
        assert.equal(ui.cell().textContent, "3");
      }
    } finally {
      await ui.close();
    }
  });
}

test("immediate rejection after delayed React blur remains visible after the deferred close frame", async () => {
  const ui = await render({ immediateFailure: true });
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("3");
    await ui.outsideClickBeforeReactBlur();
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 3 } }]]);
    assert.equal(ui.editor() !== null, true);
    assert.equal(ui.editor().value, "3");
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存失败"));
  } finally {
    await ui.close();
  }
});

for (const dismissal of ["Escape", "outside"]) {
  test(`${dismissal} cannot dismiss a pending save before its failure feedback appears`, async () => {
    const ui = await render({ fail: true });
    try {
      await ui.click(ui.cell().querySelector(".clickable"));
      await ui.edit("30");
      await ui.key(ui.editor(), "Enter");
      if (dismissal === "Escape") await ui.key(ui.editor(), "Escape");
      else await ui.outsideClick();
      assert.equal(ui.editor() !== null, true, "pending save must retain its editor");
      await ui.finish();
      assert.equal(ui.editor().value, "30");
      assert.ok(document.querySelector('[role="alert"]').textContent.includes("保存失败"));
      assert.equal(ui.calls.length, 1);
    } finally {
      await ui.close();
    }
  });
}

test("successful outside blur save closes after settling and retains the saved value", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("45");
    await ui.outsideClick();
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 45 } }]]);
    assert.equal(ui.editor() !== null, true);
    await ui.finish();
    assert.equal(ui.editor() === null, true);
    assert.equal(ui.cell().textContent, "45");
    assert.equal(ui.calls.length, 1);
  } finally {
    await ui.close();
  }
});

test("pending Escape closes after a successful save without a second write", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("45");
    await ui.key(ui.editor(), "Enter");
    await ui.key(ui.editor(), "Escape");
    assert.equal(ui.editor() !== null, true);
    await ui.finish();
    assert.equal(ui.editor() === null, true);
    assert.equal(ui.cell().textContent, "45");
    assert.equal(ui.calls.length, 1);
  } finally {
    await ui.close();
  }
});

test("clear is available only in the editor and emits an explicit null for this field", async () => {
  const ui = await render();
  try {
    assert.equal(ui.cell().textContent.includes("清空"), false);
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.click([...document.querySelectorAll("button")].find((button) => button.textContent === "清空"));
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: null } }]]);
    await ui.finish();
    assert.equal(ui.editor().value, "");
    assert.equal(ui.issue.custom_fields.keep, "保留");
  } finally {
    await ui.close();
  }
});

test("invalid integer stays in the open editor without saving", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("1.5");
    await ui.key(ui.editor(), "Enter");
    assert.equal(ui.editor().getAttribute("aria-invalid"), "true");
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("整数"));
    assert.deepEqual(ui.calls, []);
  } finally {
    await ui.close();
  }
});

test("outside blur keeps invalid integer feedback until the user corrects it", async () => {
  const ui = await render();
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    await ui.edit("1.5");
    await ui.outsideClick();
    assert.equal(ui.editor() !== null, true, "invalid input must retain its validation feedback");
    assert.equal(ui.editor().getAttribute("aria-invalid"), "true");
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("整数"));
    assert.deepEqual(ui.calls, []);
    await act(async () => ui.editor().focus());
    await ui.edit("2");
    await ui.outsideClick();
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: 2 } }]]);
    await ui.finish();
    assert.equal(ui.editor() === null, true);
    assert.equal(ui.cell().textContent, "2");
  } finally {
    await ui.close();
  }
});

for (const pressEnter of [false, true]) {
  test(`fractional integer survives outside dismissal when native validity reports valid (${pressEnter ? "after Enter" : "blur only"})`, async () => {
    const ui = await render();
    try {
      await ui.click(ui.cell().querySelector(".clickable"));
      await ui.edit("1.5");
      const input = ui.editor();
      // Chrome's step calculation with MIN_SAFE_INTEGER as its base can accept 1.5.
      // Reproduce only those platform flags; keep the real editor and parser running.
      const reportedValidity = new Proxy(input.validity, {
        get(target, key) {
          if (key === "valid") return true;
          if (key === "stepMismatch") return false;
          return Reflect.get(target, key, target);
        },
      });
      Object.defineProperty(input, "validity", { configurable: true, get: () => reportedValidity });
      assert.equal(input.validity.valid, true);
      if (pressEnter) await ui.key(input, "Enter");
      await ui.outsideClick();
      assert.equal(ui.editor() !== null, true, "the parser's invalid integer must retain feedback");
      assert.equal(ui.editor().getAttribute("aria-invalid"), "true");
      assert.ok(document.querySelector('[role="alert"]').textContent.includes("整数"));
      assert.deepEqual(ui.calls, []);
      await ui.key(ui.editor(), "Escape");
      assert.equal(ui.editor() === null, true);
      assert.deepEqual(ui.calls, []);
    } finally {
      await ui.close();
    }
  });
}

test("boolean editor preserves false in the partial field update", async () => {
  const ui = await render({ field: { field_type: "boolean" }, value: true });
  try {
    await ui.click(ui.cell().querySelector(".clickable"));
    const select = ui.editor();
    assert.ok(select);
    await act(async () => {
      select.value = "false";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.deepEqual(ui.calls, [["project", "issue", { custom_fields: { amount: false } }]]);
    await ui.finish();
    assert.equal(select.value, "false");
  } finally {
    await ui.close();
  }
});

for (const [optionsState, idleText] of [
  [{ isLoading: true }, "加载中…"],
  [{ error: new Error("offline") }, "选项加载失败"],
]) {
  test(`reference cell keeps ${idleText} visible and disables its editor while unavailable`, async () => {
    const ui = await render({ field: { field_type: "member" }, value: "member-id", optionsState });
    try {
      assert.equal(ui.editor() === null, true);
      assert.equal(ui.cell().textContent, idleText);
      await ui.click(ui.cell().querySelector(".clickable"));
      assert.equal(ui.editor().disabled, true);
      if (optionsState.error) assert.ok(document.querySelector('[role="alert"]').textContent.includes("选项加载失败"));
      assert.deepEqual(ui.calls, []);
    } finally {
      await ui.close();
    }
  });
}

test("header displays a field icon and preserves ascending, descending and reset actions", async () => {
  const ui = await render({ field: { icon: { name: "Clock", color: "#123456" } } });
  try {
    assert.ok(ui.header().querySelector("svg"));
    assert.equal(ui.header().querySelector("svg").style.color, "rgb(18, 52, 86)");
    assert.equal(ui.header().getAttribute("tabindex"), "0");
    assert.equal(ui.header().getAttribute("aria-sort"), "none");
    await ui.key(ui.header(), "Enter");
    let choices = [...document.querySelectorAll('[role^="menuitem"]')];
    await ui.click(choices.find((item) => item.textContent.includes("common.order_by.asc")));
    assert.deepEqual(ui.orderChanges.at(-1), { order_by: "custom_fields__amount" });
    assert.equal(ui.header().getAttribute("aria-sort"), "ascending");
    await ui.click(ui.header().querySelector("button"));
    choices = [...document.querySelectorAll('[role^="menuitem"]')];
    await ui.click(choices.find((item) => item.textContent.includes("common.order_by.desc")));
    assert.equal(ui.header().getAttribute("aria-sort"), "descending");
    await ui.click(ui.header().querySelector("button"));
    choices = [...document.querySelectorAll('[role^="menuitem"]')];
    await ui.click(choices.find((item) => item.textContent.includes("common.actions.clear_sorting")));
    assert.deepEqual(ui.orderChanges.at(-1), { order_by: "sort_order" });
  } finally {
    await ui.close();
  }
});

test("multi-value header shows its icon without offering sorting", async () => {
  const ui = await render({ field: { field_type: "multi_select" }, value: [] });
  try {
    assert.ok(ui.header().querySelector("svg"));
    assert.equal(ui.header().querySelector("button"), null);
    assert.deepEqual(ui.orderChanges, []);
  } finally {
    await ui.close();
  }
});
