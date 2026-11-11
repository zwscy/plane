import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(directory, "../../package.json"));
const blockRequire = createRequire(resolve(directory, "../../../../packages/blocks/package.json"));
const { JSDOM } = blockRequire("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
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
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const { observable, runInAction } = require("mobx");
const { act } = React;
const types = [
  "text",
  "textarea",
  "integer",
  "decimal",
  "date",
  "boolean",
  "select",
  "multi_select",
  "member",
  "members",
  "labels",
  "state",
  "priority",
  "cycle",
  "modules",
  "estimate",
];
const fields = types.map((type) => ({
  id: type,
  name: `自定义${type}`,
  field_type: type,
  icon: { name: "Clock", color: "#123456" },
  is_active: true,
  options: [],
}));
fields.push({ ...fields[0], id: "inactive", name: "停用字段", is_active: false });
const passthrough = ({ children }) => React.createElement("div", null, children);
const PlaceholderIcon = () => React.createElement("svg");
const MockIssueService = function MockIssueService() {};
const SelectContext = React.createContext(null);
const MockSelect = ({ value, onValueChange, disabled, children }) => {
  const [open, setOpen] = React.useState(false);
  return React.createElement(
    SelectContext.Provider,
    { value: { open, setOpen, value, onValueChange, disabled } },
    children
  );
};
const MockSelectTrigger = ({ children, render, disabled }) => {
  const context = React.useContext(SelectContext);
  return React.cloneElement(
    render,
    {
      disabled: disabled || context.disabled,
      "aria-haspopup": "listbox",
      "aria-expanded": context.open,
      onClick: () => context.setOpen(!context.open),
    },
    children
  );
};
const MockSelectContent = ({ children }) => (React.useContext(SelectContext).open ? children : null);
const MockSelectList = ({ children }) => React.createElement("div", { role: "listbox" }, children);
const MockSelectItem = ({ value, label, children, disabled }) => {
  const context = React.useContext(SelectContext);
  return React.createElement(
    "button",
    {
      type: "button",
      role: "option",
      disabled: disabled || context.disabled,
      "aria-selected": context.value === value,
      onClick: () => {
        context.onValueChange(value);
        context.setOpen(false);
      },
    },
    label ?? children
  );
};
const MockSelectTriggerChrome = ({
  children,
  prependIcon,
  variant: _variant,
  isActive: _isActive,
  isEmpty: _isEmpty,
  ...props
}) => React.createElement("button", { type: "button", ...props }, prependIcon, children);
function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(resolve(directory, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", code)(
    (name) => {
      if (overrides[name]) return overrides[name];
      if (name === "./project-filter-model") return load("project-filter-model.ts");
      if (name.endsWith("/issue.service")) return { IssueService: MockIssueService };
      if (name === "@makeplane/propel/icons") return new Proxy({}, { get: () => PlaceholderIcon });
      if (name === "@makeplane/propel/components/icon")
        return { Icon: ({ icon: Glyph }) => React.createElement(Glyph) };
      if (name === "@base-ui/react/select") return { Select: { Trigger: MockSelectTrigger } };
      if (name === "@makeplane/propel/components/select")
        return {
          Select: MockSelect,
          SelectContent: MockSelectContent,
          SelectList: MockSelectList,
          SelectItem: MockSelectItem,
        };
      if (name === "@plane/blocks/select") return { SelectTriggerChrome: MockSelectTriggerChrome };
      if (name.endsWith("/popover"))
        return {
          Popover: passthrough,
          PopoverContent: passthrough,
          PopoverTrigger: ({ children, render }) =>
            React.cloneElement(render ?? React.createElement("button"), {}, children),
        };
      if (name === "@makeplane/propel/elements/button")
        return {
          Button: ({ render, children, variant: _variant, size: _size, stretch: _stretch, ...props }) =>
            React.cloneElement(typeof render === "function" ? render(props) : render, props, children),
          ButtonLabel: ({ children }) => React.createElement("span", null, children),
        };
      if (name === "@makeplane/propel/components/button")
        return {
          Button: ({ label, onClick, disabled }) => React.createElement("button", { onClick, disabled }, label),
        };
      if (name.endsWith("/checkbox"))
        return {
          Checkbox: ({ label, checked, disabled }) =>
            React.createElement(
              "label",
              null,
              React.createElement("input", { type: "checkbox", checked, disabled, readOnly: true }),
              label
            ),
        };
      if (name.endsWith("/type-icon"))
        return {
          CustomFieldTypeIcon: ({ type, icon }) =>
            React.createElement("svg", { "data-type": type, "data-icon": icon?.name }),
        };
      if (name.endsWith("/use-options"))
        return {
          useCustomFieldOptions: (_workspace, _project, field) => ({ options: field.options, isLoading: false }),
        };
      if (name.endsWith("/use-project-custom-fields"))
        return { useProjectCustomFields: () => ({ fields, isLoading: false }) };
      if (name.endsWith("/view-controls"))
        return {
          RichFiltersViewControls: ({ save, update }) =>
            React.createElement(
              "div",
              null,
              React.createElement("button", { disabled: !save.enabled, onClick: save.onClick }, "保存视图"),
              React.createElement(
                "button",
                { disabled: !update.enabled || update.isUpdating, onClick: update.onClick },
                "更新视图"
              )
            ),
        };
      if (name.endsWith("/transition-components")) return { RowTransition: passthrough };
      if (name === "@plane/blocks/layout") return { Header: passthrough, EHeaderVariant: { TERNARY: "ternary" } };
      if (name === "@plane/utils")
        return { cn: (...values) => values.filter((value) => typeof value === "string").join(" ") };
      return require(name);
    },
    module.exports,
    module
  );
  return module.exports;
}

test("project picker includes hidden built-ins and every active custom type with its configured icon", () => {
  const { ProjectFilterPopover } = load("project-filter-panel.tsx");
  const filter = {
    expression: null,
    adapter: { toExternal: () => ({ name__icontains: "" }) },
    isVisible: false,
    isApplying: false,
  };
  const markup = renderToStaticMarkup(
    React.createElement(ProjectFilterPopover, { workspaceSlug: "workspace", projectId: "project", filter })
  );
  for (const name of [
    "工作项",
    "状态",
    "优先级",
    "负责人",
    "标签",
    "模块",
    "周期",
    "开始日期",
    "截止日期",
    "创建时间",
    "更新时间",
    ...types.map((type) => `自定义${type}`),
  ])
    assert.ok(markup.includes(name), `${name} is filterable`);
  assert.ok(!markup.includes("停用字段"));
  for (const type of types)
    assert.ok(markup.includes(`data-type="${type}" data-icon="Clock"`), `${type} uses its table icon`);
  assert.ok(markup.includes("满足以下"));
  assert.ok(markup.includes("应用筛选"));
  assert.ok(markup.includes("取消"));
});

const PopoverContext = React.createContext(null);
const interactivePopovers = {
  Popover: ({ open, onOpenChange, children }) =>
    React.createElement(PopoverContext.Provider, { value: { open, onOpenChange } }, children),
  PopoverContent: ({ children }) =>
    React.useContext(PopoverContext).open ? React.createElement("div", null, children) : null,
  PopoverTrigger: ({ children, render, disabled }) => {
    const context = React.useContext(PopoverContext);
    return React.cloneElement(render, { disabled, onClick: () => context.onOpenChange(!context.open) }, children);
  },
};
async function renderPanel({
  initial = { name__icontains: "旧条件" },
  preflightFails = false,
  saveFails = false,
  preflightPending,
  savePending,
  withSummary = false,
} = {}) {
  let expression = structuredClone(initial);
  const saved = [];
  const preflights = [];
  const filter = observable({
    expression: null,
    adapter: { toExternal: () => expression },
    isVisible: true,
    isApplying: false,
    canSaveView: true,
    canUpdateView: true,
    async saveView() {},
    async updateView() {},
    toggleVisibility() {},
    async applyExpression(next, beforeApply) {
      if (filter.isApplying) throw new Error("Filter application already in progress");
      runInAction(() => {
        filter.isApplying = true;
      });
      try {
        await beforeApply?.();
        await savePending;
        if (saveFails) throw new Error("offline");
        saved.push(next);
        expression = next;
      } finally {
        runInAction(() => {
          filter.isApplying = false;
        });
      }
    },
  });
  class Service {
    async getIssues(...args) {
      preflights.push(args);
      assert.equal(filter.isApplying, true, "validation runs inside the shared application lock");
      await preflightPending;
      if (preflightFails) throw new Error("invalid field");
    }
  }
  const { ProjectFilterPopover, ProjectFiltersSummaryRow } = load("project-filter-panel.tsx", {
    "@makeplane/propel/components/popover": interactivePopovers,
    "@/services/issue/issue.service": { IssueService: Service },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = { workspaceSlug: "workspace", projectId: "project", filter };
  await act(async () =>
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ProjectFilterPopover, props),
        withSummary ? React.createElement(ProjectFiltersSummaryRow, props) : null
      )
    )
  );
  const findButton = (label) => {
    const found = [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent.trim() === label ||
        button.getAttribute("aria-label") === label ||
        button.getAttribute("aria-label")?.startsWith(`${label}, `)
    );
    assert.ok(found, `button ${label} exists`);
    return found;
  };
  const ui = {
    container,
    saved,
    preflights,
    filter,
    findButton,
    expression: () => expression,
    async click(label) {
      await act(async () => findButton(label).click());
    },
    async select(label, optionLabel) {
      const trigger = findButton(label);
      assert.equal(trigger.disabled, false, `${label} is enabled`);
      await act(async () => trigger.click());
      const option = [...container.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent.trim() === optionLabel
      );
      assert.ok(option, `option ${optionLabel} exists`);
      await act(async () => option.click());
    },
    async change(control, value) {
      await act(async () => {
        const prototype =
          control.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(control, value);
        control.dispatchEvent(
          new dom.window.Event(control.tagName === "SELECT" ? "change" : "input", { bubbles: true })
        );
      });
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
  await ui.click(`筛选（${load("project-filter-model.ts").parsePanelExpression(initial).count} 个条件）`);
  return ui;
}

for (const [from, to, label] of [
  ["and", "or", "任一"],
  ["or", "and", "所有"],
]) {
  test(`condition combination dropdown switches ${from.toUpperCase()} to ${to.toUpperCase()} without altering the conditions`, async () => {
    const conditions = [{ name__icontains: "旧条件" }, { custom_fields__integer__gte: 0 }];
    const ui = await renderPanel({ initial: { [from]: conditions } });
    try {
      await ui.select("条件组合方式", label);
      assert.deepEqual(ui.expression(), { [from]: conditions }, "selection only changes the draft");
      await ui.click("应用筛选");
      assert.deepEqual(ui.expression(), { [to]: conditions });
      assert.deepEqual(JSON.parse(ui.preflights[0][2].filters), { [to]: conditions });
    } finally {
      await ui.close();
    }
  });
}

test("operator dropdown resets values when switching between scalar, range and empty conditions", async () => {
  const ui = await renderPanel({ initial: { custom_fields__integer__exact: 7 } });
  try {
    await ui.select("条件 1 的操作", "介于");
    const start = ui.container.querySelector('input[aria-label="自定义integer起始值"]');
    const end = ui.container.querySelector('input[aria-label="自定义integer结束值"]');
    assert.equal(start.value, "");
    assert.equal(end.value, "");
    await ui.change(start, "2");
    await ui.change(end, "5");
    await ui.select("条件 1 的操作", "大于");
    const scalar = ui.container.querySelector('input[aria-label="自定义integer的值"]');
    assert.equal(scalar.value, "", "range values are cleared when returning to a scalar operator");
    await ui.click("应用筛选");
    assert.equal(ui.saved.length, 0);
    assert.equal(ui.preflights.length, 0);
    await ui.change(scalar, "9");
    await ui.select("条件 1 的操作", "为空");
    assert.equal(ui.container.querySelector('input[aria-label="自定义integer的值"]'), null);
    assert.ok(ui.container.textContent.includes("无需填写值"));
    await ui.click("应用筛选");
    assert.deepEqual(ui.expression(), { custom_fields__integer__is_empty: true });
  } finally {
    await ui.close();
  }
});

test("boolean value dropdown applies false as a boolean rather than an empty value", async () => {
  const ui = await renderPanel({ initial: { custom_fields__boolean__exact: true } });
  try {
    await ui.select("自定义boolean的值", "否");
    assert.deepEqual(ui.expression(), { custom_fields__boolean__exact: true });
    await ui.click("应用筛选");
    assert.deepEqual(ui.expression(), { custom_fields__boolean__exact: false });
    assert.deepEqual(JSON.parse(ui.preflights[0][2].filters), { custom_fields__boolean__exact: false });
  } finally {
    await ui.close();
  }
});

test("draft edits and cancellation retain the active filter, valid Apply validates remotely before saving", async () => {
  const ui = await renderPanel();
  try {
    await ui.change(ui.container.querySelector('input[aria-label="工作项的值"]'), "新条件");
    assert.deepEqual(ui.expression(), { name__icontains: "旧条件" });
    await ui.click("取消");
    assert.equal(ui.saved.length, 0);
    await ui.click("筛选（1 个条件）");
    assert.equal(ui.container.querySelector('input[aria-label="工作项的值"]').value, "旧条件");
    await ui.change(ui.container.querySelector('input[aria-label="工作项的值"]'), "已应用");
    await ui.click("应用筛选");
    assert.deepEqual(ui.expression(), { name__icontains: "已应用" });
    assert.equal(ui.preflights.length, 1);
    assert.deepEqual(JSON.parse(ui.preflights[0][2].filters), ui.expression());
  } finally {
    await ui.close();
  }
});

test("incomplete rows block Apply and deleting the incomplete row leaves the prior condition intact", async () => {
  const ui = await renderPanel();
  try {
    await ui.click("添加条件");
    await ui.click("应用筛选");
    assert.ok(ui.container.textContent.includes("请选择字段"));
    assert.equal(ui.saved.length, 0);
    assert.equal(ui.preflights.length, 0);
    await ui.click("删除条件 2");
    await ui.click("应用筛选");
    assert.deepEqual(ui.expression(), { name__icontains: "旧条件" });
  } finally {
    await ui.close();
  }
});

for (const options of [{ preflightFails: true }, { saveFails: true }]) {
  test(`${options.preflightFails ? "server validation" : "persistence"} failure leaves active filters intact with a Chinese error`, async () => {
    const ui = await renderPanel(options);
    try {
      await ui.change(ui.container.querySelector('input[aria-label="工作项的值"]'), "未保存");
      await ui.click("应用筛选");
      assert.deepEqual(ui.expression(), { name__icontains: "旧条件" });
      assert.ok(ui.container.textContent.includes("原筛选已保留"));
      assert.ok(ui.container.textContent.includes(options.preflightFails ? "筛选条件验证失败" : "筛选保存失败"));
      assert.ok(ui.container.querySelector('input[aria-label="工作项的值"]'), "failed draft remains editable");
    } finally {
      await ui.close();
    }
  });
}

const deferred = () => {
  let resolvePending;
  const promise = new Promise((release) => {
    resolvePending = release;
  });
  return { promise, resolve: resolvePending };
};

for (const phase of ["validation", "persistence"]) {
  test(`shared ${phase} pending state disables the summary and every open panel`, async () => {
    const pending = deferred();
    const ui = await renderPanel({
      withSummary: true,
      preflightPending: phase === "validation" ? pending.promise : undefined,
      savePending: phase === "persistence" ? pending.promise : undefined,
    });
    try {
      await ui.click("编辑筛选");
      assert.equal(ui.container.querySelectorAll('[aria-label="项目筛选条件"]').length, 2);
      await ui.click("选择筛选字段");
      assert.ok(ui.container.querySelector('input[aria-label="搜索筛选字段"]'));
      await ui.change(ui.container.querySelector('input[aria-label="工作项的值"]'), "新条件");
      await ui.click("应用筛选");
      assert.equal(ui.filter.isApplying, true);
      assert.equal(ui.preflights.length, 1);
      assert.deepEqual(ui.expression(), { name__icontains: "旧条件" });
      for (const control of ui.container.querySelectorAll("button, input")) {
        assert.equal(
          control.disabled,
          true,
          `${control.getAttribute("aria-label") ?? control.textContent} is disabled`
        );
      }
      for (const panel of ui.container.querySelectorAll('[aria-label="项目筛选条件"]')) {
        assert.equal(panel.getAttribute("aria-busy"), "true");
      }
      await ui.click("清空");
      assert.equal(ui.saved.length, 0, "summary Clear cannot persist while another panel applies");
      await act(async () => pending.resolve());
      assert.equal(ui.filter.isApplying, false);
      assert.deepEqual(ui.saved, [{ name__icontains: "新条件" }]);
      assert.equal(ui.findButton("清空").disabled, false);
    } finally {
      await act(async () => pending.resolve());
      await ui.close();
    }
  });
}

test("summary Clear exposes its pending lock to a separate open filter panel", async () => {
  const pending = deferred();
  const ui = await renderPanel({ withSummary: true, savePending: pending.promise });
  try {
    await ui.click("清空");
    assert.equal(ui.filter.isApplying, true);
    for (const control of ui.container.querySelectorAll("button, input")) {
      assert.equal(control.disabled, true, `${control.getAttribute("aria-label") ?? control.textContent} is disabled`);
    }
    assert.equal(ui.preflights.length, 0);
    await act(async () => pending.resolve());
    assert.deepEqual(ui.saved, [{}]);
    assert.deepEqual(ui.expression(), {});
    assert.equal(ui.filter.isApplying, false);
  } finally {
    await act(async () => pending.resolve());
    await ui.close();
  }
});

for (const operator of ["exact", "in"]) {
  test(`shared pending lock disables an already open ${operator} choice picker`, async () => {
    const pending = deferred();
    const ui = await renderPanel({
      initial: { [`state_group__${operator}`]: operator === "in" ? ["started"] : "started" },
      withSummary: true,
      savePending: pending.promise,
    });
    try {
      await ui.click("状态分组的值");
      assert.ok(ui.container.querySelector('input[aria-label="搜索状态分组选项"]'));
      await ui.click("清空");
      assert.equal(ui.filter.isApplying, true);
      for (const control of ui.container.querySelectorAll("button, input")) {
        assert.equal(
          control.disabled,
          true,
          `${control.getAttribute("aria-label") ?? control.textContent} is disabled`
        );
      }
      await act(async () => pending.resolve());
      assert.deepEqual(ui.saved, [{}]);
    } finally {
      await act(async () => pending.resolve());
      await ui.close();
    }
  });
}
