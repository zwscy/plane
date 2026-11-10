/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// These pure exports live alongside eagerly imported browser stores and UI.
// Compile the actual declarations verbatim, without starting that unrelated
// runtime or replacing any behavior exercised by the tests.
function loadPureExport(relativePath, name) {
  const file = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((item) => item.name.getText(source) === name)
  );
  assert.ok(declaration, `Missing export: ${name}`);
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", code)(module.exports, module);
  return module.exports[name];
}

const getComputedDisplayProperties = loadPureExport(
  "../../../../../../packages/utils/src/work-item/base.ts",
  "getComputedDisplayProperties"
);
const getDisplayPropertiesCount = loadPureExport("../utils.tsx", "getDisplayPropertiesCount");

test("saved mixed built-in/custom column positions survive display-property loading", () => {
  const result = getComputedDisplayProperties({
    column_order: ["state", "custom_fields__priority-order", "due_date", "future-column"],
  });
  assert.deepEqual(result.column_order, ["state", "custom_fields__priority-order", "due_date", "future-column"]);
});

test("column-order normalization copies string entries without filtering unresolved column IDs", () => {
  const input = Object.freeze({
    column_order: Object.freeze([
      "due_date",
      null,
      4,
      false,
      {},
      ["state"],
      "custom_fields__not-yet-loaded",
      "",
      "due_date",
    ]),
  });
  const result = getComputedDisplayProperties(input);
  assert.deepEqual(result.column_order, ["due_date", "custom_fields__not-yet-loaded", "", "due_date"]);
  assert.notEqual(result.column_order, input.column_order);
  assert.equal(input.column_order.length, 9);
});

test("malformed column-order values safely fall back while empty saved arrays stay valid", () => {
  for (const column_order of [undefined, null, false, 5, "due_date", { 0: "due_date" }]) {
    assert.equal(getComputedDisplayProperties({ column_order }).column_order, undefined);
  }
  assert.deepEqual(getComputedDisplayProperties({ column_order: [] }).column_order, []);
});

test("loading saved order preserves explicit visibility flags, custom maps and defaults", () => {
  const custom_fields = Object.freeze({ visible: true, hidden: false });
  const input = Object.freeze({
    column_order: Object.freeze(["custom_fields__hidden", "due_date"]),
    custom_fields,
    due_date: false,
    state: true,
  });
  const result = getComputedDisplayProperties(input);
  assert.deepEqual(result.column_order, ["custom_fields__hidden", "due_date"]);
  assert.deepEqual(result.custom_fields, { visible: true, hidden: false });
  assert.equal(result.due_date, false);
  assert.equal(result.state, true);
  assert.equal(result.assignee, true);
  result.column_order.push("state");
  assert.deepEqual(input.column_order, ["custom_fields__hidden", "due_date"]);
  assert.deepEqual(input.custom_fields, { visible: true, hidden: false });
});

test("table column counts ignore order metadata and count only enabled boolean properties", () => {
  const properties = Object.freeze({
    key: true,
    state: true,
    due_date: false,
    column_order: Object.freeze(["state", "due_date"]),
    custom_fields: Object.freeze({ a: true, b: false }),
    malformedString: "true",
    malformedNumber: 1,
    malformedObject: {},
  });
  assert.equal(getDisplayPropertiesCount(properties), 2);
  assert.equal(getDisplayPropertiesCount(properties, ["key"]), 1);
});

test("empty order metadata does not add a phantom table column", () => {
  assert.equal(getDisplayPropertiesCount({ state: true, column_order: [] }), 1);
  assert.equal(getDisplayPropertiesCount({ column_order: [] }), 0);
  assert.equal(getDisplayPropertiesCount({}), 0);
});
