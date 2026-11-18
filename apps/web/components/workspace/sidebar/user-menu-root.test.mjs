import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(directory, "../../../package.json"));
const blockRequire = createRequire(resolve(directory, "../../../../../packages/blocks/package.json"));
const { JSDOM } = blockRequire("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
const globals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
};
const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals))
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
after(() => {
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { SWRConfig, useSWRConfig } = require("swr");
const ts = require("typescript");
const translations = JSON.parse(
  readFileSync(resolve(directory, "../../../../../packages/i18n/src/locales/zh-CN/common.json"), "utf8")
);
const passthrough = ({ children }) => React.createElement("div", null, children);
const icon = () => React.createElement("svg");

function deferred() {
  let resolvePromise, reject;
  const promise = new Promise((fulfill, rejectPromise) => {
    resolvePromise = fulfill;
    reject = rejectPromise;
  });
  promise.catch(() => {});
  return { promise, resolve: resolvePromise, reject };
}

function load(state) {
  const code = ts.transpileModule(readFileSync(resolve(directory, "user-menu-root.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    "mobx-react": { observer: (component) => component },
    "next/navigation": { useRouter: () => ({ push: (url) => state.clientNavigations.push(url) }) },
    "@makeplane/propel/icons": new Proxy({}, { get: () => icon }),
    "@makeplane/propel/components/avatar": { Avatar: ({ fallback }) => React.createElement("span", null, fallback) },
    "@makeplane/propel/components/icon": { Icon: icon },
    "@makeplane/propel/components/tooltip": { Tooltip: passthrough },
    "@makeplane/propel/components/menu": {
      Menu: passthrough,
      MenuContent: passthrough,
      MenuSeparator: () => React.createElement("hr"),
      MenuTrigger: ({ render, children }) => React.cloneElement(render, {}, children),
      MenuItem: ({ render, label, onClick }) =>
        React.cloneElement(render ?? React.createElement("button"), { role: "menuitem", onClick }, label),
    },
    "@makeplane/propel/elements/icon-button": {
      IconButton: ({ render, children }) => React.cloneElement(render, {}, children),
    },
    "@plane/constants": { GOD_MODE_URL: "http://localhost:8090/god-mode" },
    "@plane/i18n": { useTranslation: () => ({ t: (key) => translations[key] ?? key }) },
    "@plane/blocks/toast": { setToast: () => {} },
    "@plane/utils": { getFileURL: (value) => value },
    "@/components/common/cover-image": { CoverImage: () => null },
    "@/hooks/store/use-app-theme": { useAppTheme: () => ({ toggleAnySidebarDropdown: () => {} }) },
    "@/hooks/store/use-command-palette": { useCommandPalette: () => ({ toggleProfileSettingsModal: () => {} }) },
    "@/hooks/store/user": { useUser: () => ({ data: state.user, signOut: async () => {} }) },
    "@/services/user.service": {
      UserService: class {
        currentUserInstanceAdminStatus() {
          state.requests.push(state.user?.id);
          return state.respond(state.user?.id);
        }
      },
    },
  };
  new Function("require", "exports", "module", code)((name) => mocks[name] ?? require(name), module.exports, module);
  return module.exports.UserMenuRoot;
}

async function mount(user, respond) {
  const state = { user, respond, requests: [], clientNavigations: [] };
  const Component = load(state);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const cache = new Map();
  const config = { provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false };
  const View = () => {
    const { mutate } = useSWRConfig();
    state.refresh = () => mutate([...cache.keys()][0]);
    return React.createElement(Component);
  };
  const render = async () =>
    act(async () => {
      root.render(React.createElement(SWRConfig, { value: config }, React.createElement(View)));
    });
  await render();
  return {
    state,
    container,
    render,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const managementLink = (container) =>
  [...container.querySelectorAll("[role=menuitem]")].find((node) => node.textContent === "系统管理");

test("verified instance administrators get a full-page system-management link", async () => {
  const page = await mount({ id: "instance-admin", display_name: "Admin" }, async () => ({ is_instance_admin: true }));
  try {
    const link = managementLink(page.container);
    assert.ok(link, "System management must appear for the verified instance administrator");
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("href"), "http://localhost:8090/god-mode/general/");
    assert.deepEqual(page.state.requests, ["instance-admin"]);
    assert.deepEqual(page.state.clientNavigations, []);
  } finally {
    await page.close();
  }
});

test("ordinary users and workspace administrators do not get system-management access", async () => {
  const page = await mount({ id: "workspace-admin", role: 20 }, async () => ({ is_instance_admin: false }));
  try {
    assert.equal(managementLink(page.container), undefined);
    assert.deepEqual(page.state.requests, ["workspace-admin"]);
  } finally {
    await page.close();
  }
});

for (const [name, response] of [
  ["missing", undefined],
  ["malformed", { is_instance_admin: "true" }],
  ["failed", new Error("Unavailable")],
]) {
  test(`${name} administrator responses keep the entry hidden`, async () => {
    const request = deferred();
    const page = await mount({ id: "user" }, () => request.promise);
    try {
      assert.equal(managementLink(page.container), undefined);
      await act(async () => {
        if (response instanceof Error) request.reject(response);
        else request.resolve(response);
      });
      assert.equal(managementLink(page.container), undefined);
    } finally {
      await page.close();
    }
  });
}

test("switching to another account never reuses the prior administrator result", async () => {
  const memberResponse = deferred();
  const page = await mount({ id: "admin" }, (id) =>
    id === "admin" ? Promise.resolve({ is_instance_admin: true }) : memberResponse.promise
  );
  try {
    assert.ok(managementLink(page.container));
    page.state.user = { id: "member" };
    await page.render();
    assert.equal(
      managementLink(page.container),
      undefined,
      "Hide prior identity while the new user's permission is pending"
    );
    await act(async () => memberResponse.resolve({ is_instance_admin: false }));
    assert.equal(managementLink(page.container), undefined);
    assert.deepEqual(page.state.requests, ["admin", "member"]);
    page.state.user = undefined;
    await page.render();
    assert.equal(managementLink(page.container), undefined);
    assert.deepEqual(page.state.requests, ["admin", "member"], "No authenticated request after logout");
  } finally {
    await page.close();
  }
});

test("a late result from a previous account cannot grant the current user an entry", async () => {
  const adminResponse = deferred();
  const page = await mount({ id: "admin" }, (id) =>
    id === "admin" ? adminResponse.promise : Promise.resolve({ is_instance_admin: false })
  );
  try {
    page.state.user = { id: "member" };
    await page.render();
    assert.deepEqual(page.state.requests, ["admin", "member"]);
    await act(async () => adminResponse.resolve({ is_instance_admin: true }));
    assert.equal(managementLink(page.container), undefined);
  } finally {
    await page.close();
  }
});

test("a failed permission refresh hides a previously verified administrator entry", async () => {
  let fail = false;
  const page = await mount({ id: "admin" }, async () => {
    if (fail) throw new Error("Permission endpoint unavailable");
    return { is_instance_admin: true };
  });
  try {
    assert.ok(managementLink(page.container));
    fail = true;
    await act(async () => {
      await page.state.refresh();
    });
    assert.equal(managementLink(page.container), undefined);
  } finally {
    await page.close();
  }
});
