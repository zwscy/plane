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

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(webRoot, "package.json"));
const blockRequire = createRequire(resolve(webRoot, "../../packages/blocks/package.json"));
const { JSDOM } = blockRequire("jsdom");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const propelRoot = dirname(require.resolve("@makeplane/propel/package.json"));
const icons = require(resolve(propelRoot, "dist/icons/index.js"));
const passthrough = ({ children }) => children;

const fieldTypes = [
  ["text", "TextOutline"],
  ["textarea", "AlignLeftOutline"],
  ["integer", "HashOutline"],
  ["decimal", "HashOutline"],
  ["date", "CalendarOutline"],
  ["boolean", "BooleanOutline"],
  ["select", "DropdownOutline"],
  ["multi_select", "MultiTagOutline"],
  ["member", "UserOutline"],
  ["members", "MembersOutline"],
  ["labels", "LabelsOutline"],
  ["state", "StateOutline"],
  ["priority", "PriorityOutline"],
  ["cycle", "CyclesOutline"],
  ["modules", "ModuleOutline"],
  ["estimate", "EstimateOutline"],
];

function load(relativePath, mocks = {}) {
  const file = resolve(webRoot, relativePath);
  assert.ok(existsSync(file), `${relativePath} must provide custom field type icons`);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", code)(
    (specifier) =>
      mocks[specifier] ??
      require(
        specifier.startsWith("@makeplane/propel/")
          ? resolve(propelRoot, "dist", specifier.slice("@makeplane/propel/".length), "index.js")
          : specifier
      ),
    module.exports,
    module
  );
  return module.exports;
}

function markup(component) {
  return new JSDOM(renderToStaticMarkup(component));
}

test("every supported custom field type renders its semantic, decorative icon at the caller's size", () => {
  const { CustomFieldTypeIcon } = load("components/issues/custom-fields/type-icon.tsx");
  for (const [type, iconName] of fieldTypes) {
    const dom = markup(React.createElement(CustomFieldTypeIcon, { type, className: "size-4 text-secondary" }));
    const expectedDom = markup(React.createElement(icons[iconName]));
    try {
      const svg = dom.window.document.querySelector("svg");
      assert.ok(svg, `${type} has an icon`);
      assert.equal(svg.dataset.customFieldType, type);
      assert.equal(svg.getAttribute("aria-hidden"), "true");
      assert.ok(svg.classList.contains("size-4"));
      assert.ok(svg.classList.contains("text-secondary"));
      assert.ok(svg.querySelector("path, circle, rect, line, polyline"), `${type} has visible geometry`);
      assert.equal(
        svg.innerHTML,
        expectedDom.window.document.querySelector("svg").innerHTML,
        `${type} uses ${iconName}`
      );
    } finally {
      dom.window.close();
      expectedDom.window.close();
    }
  }
});

test("a selected catalogue icon renders its safe color and unknown names retain the type fallback", () => {
  const { CustomFieldTypeIcon } = load("components/issues/custom-fields/type-icon.tsx");
  const { LUCIDE_ICONS_LIST } = require("@plane/blocks/emoji-icon-picker/data");
  const clock = LUCIDE_ICONS_LIST.find((icon) => icon.name === "Clock");
  for (const [icon, expected, color] of [
    [{ name: "Clock", color: "#aB1234" }, clock.element, "rgb(171, 18, 52)"],
    [{ name: "Clock", color: "url(https://example.com/color)" }, clock.element, ""],
    [{ name: "clock", color: "#123456" }, icons.HashOutline, ""],
    [{ name: "UnknownIcon", color: "#123456" }, icons.HashOutline, ""],
    [null, icons.HashOutline, ""],
  ]) {
    const dom = markup(React.createElement(CustomFieldTypeIcon, { type: "integer", icon, className: "size-4" }));
    const expectedDom = markup(React.createElement(expected));
    try {
      const svg = dom.window.document.querySelector("svg");
      assert.equal(svg.innerHTML, expectedDom.window.document.querySelector("svg").innerHTML);
      assert.equal(svg.style.color, color);
      assert.equal(svg.getAttribute("aria-hidden"), "true");
      assert.ok(svg.classList.contains("size-4"));
    } finally {
      dom.window.close();
      expectedDom.window.close();
    }
  }
});

test("column settings render type icons for shown, hidden and dragged custom columns without writing preferences", () => {
  const fields = fieldTypes.map(([type], index) => ({
    id: type,
    project_id: "project",
    name: `${type} field`,
    description: "",
    field_type: type,
    options: [],
    sort_order: index,
    is_active: true,
    is_type_locked: false,
    icon: type === "integer" ? { name: "Clock", color: "#123456" } : null,
  }));
  let preview;
  const iconFile = resolve(webRoot, "components/issues/custom-fields/type-icon.tsx");
  const { SpreadsheetColumnsToggle } = load("components/issues/spreadsheet-columns-toggle.tsx", {
    "next/navigation": { useParams: () => ({ workspaceSlug: "workspace", projectId: "project" }) },
    "@plane/i18n": { useTranslation: () => ({ t: (key) => key }) },
    "@/hooks/use-project-custom-fields": { useProjectCustomFields: () => ({ fields, isLoading: false }) },
    "@/hooks/use-issue-layout-store": { useIssueStoreType: () => "PROJECT" },
    "@/helpers/custom-field-views": load("helpers/custom-field-views.ts"),
    "@/helpers/spreadsheet-columns": load("helpers/spreadsheet-columns.ts"),
    "@/components/issues/custom-fields/type-icon": existsSync(iconFile)
      ? load("components/issues/custom-fields/type-icon.tsx")
      : {},
    "./project-display-config-controls": { ProjectDisplayConfigControls: () => null },
    "./issue-layouts/utils": { SpreadSheetPropertyIcon: () => null },
    // Expose portal and drag-preview content without requiring browser positioning or native dragging.
    "@makeplane/propel/components/popover": {
      Popover: passthrough,
      PopoverTrigger: passthrough,
      PopoverContent: passthrough,
    },
    "@plane/blocks/common": {
      DragHandle: () => null,
      Sortable: ({ data, render, renderDragPreview }) => {
        preview = renderDragPreview(data.find((option) => option.key === "custom_fields__integer"));
        return data.map((option, index) =>
          React.createElement(React.Fragment, { key: option.key }, render(option, index))
        );
      },
    },
  });
  const writes = [];
  const dom = markup(
    React.createElement(SpreadsheetColumnsToggle, {
      columns: [],
      displayProperties: { custom_fields: { date: false } },
      handleDisplayPropertiesUpdate: (update) => writes.push(update),
      isEstimateEnabled: true,
    })
  );
  try {
    for (const [type] of fieldTypes) {
      const row = dom.window.document.querySelector(`[data-column-key="custom_fields__${type}"]`);
      assert.ok(row.querySelector(`svg[data-custom-field-type="${type}"]`), `${type} checkbox has its type icon`);
      if (type === "integer")
        assert.equal(row.querySelector('svg[data-custom-field-type="integer"]').style.color, "rgb(18, 52, 86)");
    }
    const previewDom = markup(preview);
    try {
      assert.ok(previewDom.window.document.querySelector('svg[data-custom-field-type="integer"]'));
      assert.equal(
        previewDom.window.document.querySelector('svg[data-custom-field-type="integer"]').style.color,
        "rgb(18, 52, 86)"
      );
    } finally {
      previewDom.window.close();
    }
    assert.deepEqual(writes, []);
  } finally {
    dom.window.close();
  }
});

test("task create/detail labels render the field's chosen icon and retain the description", () => {
  const { IssueCustomFields } = load("components/issues/custom-fields/issue-fields.tsx", {
    "@/hooks/use-project-custom-fields": {
      useProjectCustomFields: () => ({
        fields: [
          {
            id: "amount",
            name: "采购金额",
            description: "含税金额",
            field_type: "decimal",
            is_active: true,
            icon: { name: "Clock", color: "#123456" },
          },
        ],
      }),
    },
    "./editor": { CustomFieldEditor: () => null },
    "./type-icon": load("components/issues/custom-fields/type-icon.tsx"),
    "@plane/blocks/toast": { setToast() {} },
  });
  const dom = markup(
    React.createElement(IssueCustomFields, {
      workspaceSlug: "workspace",
      projectId: "project",
      values: { amount: 0 },
      onChange: () => {
        throw new Error("Rendering must not write task values");
      },
    })
  );
  try {
    const label = dom.window.document.querySelector('[title="含税金额"]');
    assert.equal(label.textContent, "采购金额");
    assert.ok(label.querySelector("svg.lucide-clock"));
    assert.equal(label.querySelector("svg").style.color, "rgb(18, 52, 86)");
  } finally {
    dom.window.close();
  }
});
