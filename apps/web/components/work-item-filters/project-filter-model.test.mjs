import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPanelExpression, getPanelOperators, parsePanelExpression } from "./project-filter-model.ts";

const fields = [
  { key: "name", name: "工作项", type: "text" },
  { key: "custom_fields__decimal", name: "费用", type: "decimal" },
  { key: "custom_fields__integer", name: "数量", type: "integer" },
  { key: "custom_fields__boolean", name: "确认", type: "boolean" },
  { key: "custom_fields__date", name: "日期", type: "date" },
  { key: "custom_fields__select", name: "类别", type: "select", options: [{ id: "a", name: "甲", is_active: true }] },
  {
    key: "custom_fields__multi",
    name: "地区",
    type: "multi_select",
    options: [{ id: "a", name: "甲", is_active: true }],
  },
];
const row = (property, operator, value, id = "row") => ({ id, property, operator, value });
const build = (rows, join = "and") => buildPanelExpression({ rows, join }, fields);

test("decimal comparisons preserve numeric zero, negative values and OR arrays", () => {
  const result = build(
    [row("custom_fields__decimal", "gte", "0", "a"), row("custom_fields__decimal", "range", ["-2.5", "10.01"], "b")],
    "or"
  );
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.expression, {
    or: [{ custom_fields__decimal__gte: 0 }, { custom_fields__decimal__range: [-2.5, 10.01] }],
  });
});

test("all incomplete and invalid draft rows block applying rather than disappearing", () => {
  const result = build([
    row("name", "icontains", "", "empty"),
    row("custom_fields__integer", "exact", "1.2", "fraction"),
    row("custom_fields__decimal", "gt", "Infinity", "infinite"),
    row("custom_fields__date", "exact", "2026-02-30", "date"),
    row("custom_fields__decimal", "range", ["10", "2"], "order"),
    row("gone", "exact", "saved", "missing"),
    row("custom_fields__select", "in", ["missing"], "option"),
  ]);
  assert.equal(result.expression, null);
  assert.deepEqual(Object.keys(result.errors), ["empty", "fraction", "infinite", "date", "order", "missing", "option"]);
});

test("boolean false is explicit and empty uses a true sentinel", () => {
  assert.deepEqual(build([row("custom_fields__boolean", "exact", "false")]).expression, {
    custom_fields__boolean__exact: false,
  });
  assert.equal(build([row("custom_fields__boolean", "exact", "")]).expression, null);
  assert.deepEqual(build([row("custom_fields__decimal", "is_empty", "")]).expression, {
    custom_fields__decimal__is_empty: true,
  });
});

test("selection arrays preserve their cardinality and multi selection offers any, all, none", () => {
  assert.deepEqual(build([row("custom_fields__multi", "contains_all", ["a"])]).expression, {
    custom_fields__multi__contains_all: ["a"],
  });
  assert.equal(build([row("custom_fields__multi", "in", [])]).expression, null);
  assert.ok(getPanelOperators("multi_select").includes("contains_all"));
  assert.ok(!getPanelOperators("select").includes("contains_all"));
});

test("legacy CSV and shorthand filters open losslessly without silently flattening nested groups", () => {
  const parsed = parsePanelExpression({
    or: [{ name__icontains: "hello, world" }, { state_id__in: "a,b" }, { priority: "high" }],
  });
  assert.equal(parsed.unsupported, false);
  assert.equal(parsed.join, "or");
  assert.deepEqual(
    parsed.rows.map(({ property, operator, value }) => ({ property, operator, value })),
    [
      { property: "name", operator: "icontains", value: "hello, world" },
      { property: "state_id", operator: "in", value: ["a", "b"] },
      { property: "priority", operator: "exact", value: "high" },
    ]
  );
  const nested = parsePanelExpression({
    and: [{ name__icontains: "a" }, { or: [{ priority__exact: "high" }, { priority__exact: "urgent" }] }],
  });
  assert.equal(nested.unsupported, true);
  assert.equal(nested.count, 3);
  assert.deepEqual(nested.rows, []);
});

test("empty filters and scalar numeric/boolean restore without truthiness coercion", () => {
  assert.deepEqual(build([]).expression, {});
  assert.equal(parsePanelExpression({}).count, 0);
  assert.equal(parsePanelExpression({ custom_fields__decimal__exact: 0 }).rows[0].value, "0");
  assert.equal(parsePanelExpression({ custom_fields__boolean__exact: false }).rows[0].value, "false");
});

test("legacy built-in multiple relation exact remains editable as equivalent single-value membership", () => {
  for (const property of ["assignee_id", "label_id", "module_id", "mention_id", "subscriber_id"]) {
    const parsed = parsePanelExpression({ [`${property}__exact`]: "person-or-option" });
    assert.equal(parsed.rows[0].operator, "in");
    assert.deepEqual(parsed.rows[0].value, ["person-or-option"]);
    assert.deepEqual(buildPanelExpression(parsed, [{ key: property, name: property, type: "members" }]).expression, {
      [`${property}__in`]: ["person-or-option"],
    });
  }
  const custom = parsePanelExpression({ custom_fields__multi__exact: "a" });
  assert.equal(
    custom.rows[0].operator,
    "exact",
    "unsupported custom operators are preserved for an explicit correction"
  );
});
