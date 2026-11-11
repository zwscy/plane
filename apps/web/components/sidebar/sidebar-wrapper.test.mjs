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
import { after, test } from "node:test";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
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
    ["components/icon", "components/icon-button", "components/scroll-area", "icons"].map(async (name) => {
      const specifier = `@makeplane/propel/${name}`;
      return [specifier, await import(specifier)];
    })
  )
);

after(() => {
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function render({ locale = "en", width = 1024, collapsed = false } = {}) {
  const translations = JSON.parse(
    readFileSync(resolve(webRoot, `../../packages/i18n/src/locales/${locale}/common.json`), "utf8")
  );
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], translations) ?? key;
  const sidebarToggles = [];
  const before = JSON.stringify({ ...window.localStorage });
  let outsideClick;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  const mocks = {
    ...primitives,
    "@plane/i18n": { useTranslation: () => ({ t }) },
    "@plane/hooks": { useOutsideClickDetector: (_ref, callback) => (outsideClick = callback) },
    "@/hooks/use-window-size": { default: () => [width, 800] },
    "@/hooks/store/use-app-theme": {
      useAppTheme: () => ({
        sidebarCollapsed: collapsed,
        sidebarPeek: false,
        toggleSidebar: () => sidebarToggles.push("toggle"),
        toggleSidebarPeek: () => {},
      }),
    },
    // This regression targets the wrapper's locale gate and dialog state. Actual dialog controls
    // and preference persistence are verified separately; opening/closing this boundary is read-only.
    "@/components/navigation/customize-navigation-dialog": {
      CustomizeNavigationDialog: ({ isOpen, onClose }) =>
        isOpen
          ? React.createElement(
              "div",
              { role: "dialog", "aria-label": t("customize_navigation") },
              React.createElement("button", { "aria-label": t("close"), onClick: onClose }, t("close"))
            )
          : null,
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(resolve(webRoot, "components/sidebar/sidebar-wrapper.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "exports", "module", code)(
    (specifier) =>
      mocks[specifier] ??
      (specifier === "./sidebar-toggle-button" ? { AppSidebarToggleButton: () => null } : require(specifier)),
    module.exports,
    module
  );
  const { SidebarWrapper } = module.exports;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(SidebarWrapper, { title: t("projects") }, React.createElement("a", null, "Project item"))
    )
  );
  return {
    container,
    t,
    sidebarToggles,
    outsideClick: () => act(async () => outsideClick()),
    assertPreferencesUnchanged() {
      assert.equal(
        JSON.stringify({ ...window.localStorage }),
        before,
        "the wrapper must not change stored preferences"
      );
    },
    async click(label) {
      const button = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label);
      assert.ok(button, `button ${label} exists`);
      await act(async () => button.click());
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

for (const [locale, title, label] of [
  ["en", "Projects", "Customize navigation"],
  ["zh-CN", "项目", "自定义导航"],
  ["zh-TW", "專案", "自訂導覽"],
])
  test(`${locale} projects sidebar opens and closes navigation settings`, async () => {
    const ui = await render({ locale });
    try {
      assert.ok(ui.container.textContent.includes(title));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      ui.assertPreferencesUnchanged();
      await ui.click(label);
      const dialog = document.querySelector('[role="dialog"]');
      assert.ok(dialog, "customize navigation opens");
      assert.equal(dialog.getAttribute("aria-label"), label);
      ui.assertPreferencesUnchanged();
      await ui.click(ui.t("close"));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(ui.sidebarToggles, []);
      ui.assertPreferencesUnchanged();
    } finally {
      await ui.close();
    }
  });

test("a narrow expanded sidebar still collapses on mount and outside click", async () => {
  const ui = await render({ locale: "zh-CN", width: 767 });
  try {
    assert.deepEqual(ui.sidebarToggles, ["toggle"]);
    await ui.outsideClick();
    assert.deepEqual(ui.sidebarToggles, ["toggle", "toggle"]);
    ui.assertPreferencesUnchanged();
  } finally {
    await ui.close();
  }
});

test("a narrow collapsed sidebar does not toggle itself or write navigation preferences", async () => {
  const ui = await render({ locale: "zh-CN", width: 767, collapsed: true });
  try {
    await ui.outsideClick();
    assert.deepEqual(ui.sidebarToggles, []);
    ui.assertPreferencesUnchanged();
  } finally {
    await ui.close();
  }
});
