/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCustomFieldInput,
  formatCustomFieldValue,
  moveCustomFieldOption,
  getCustomFieldPatch,
  getDraftConversionPayload,
} from "./helpers.ts";

test("number fields preserve zero, reject invalid/fractional integers and clear empty values", () => {
  assert.equal(parseCustomFieldInput("integer", "0"), 0);
  assert.equal(parseCustomFieldInput("integer", "1.5"), undefined);
  assert.equal(parseCustomFieldInput("integer", "NaN"), undefined);
  assert.equal(parseCustomFieldInput("decimal", "1.25"), 1.25);
  assert.equal(parseCustomFieldInput("decimal", "Infinity"), undefined);
  assert.equal(parseCustomFieldInput("integer", ""), null);
});
test("booleans distinguish no value, yes and no", () => {
  assert.equal(parseCustomFieldInput("boolean", ""), null);
  assert.equal(parseCustomFieldInput("boolean", "false"), false);
  assert.equal(parseCustomFieldInput("boolean", "true"), true);
});
test("values render readable names and preserve historical inactive choices", () => {
  const choices = [
    { id: "one", name: "第一项", is_active: false },
    { id: "two", name: "第二项", is_active: true },
  ];
  assert.equal(formatCustomFieldValue(false, choices), "否");
  assert.equal(formatCustomFieldValue(0, choices), "0");
  assert.equal(formatCustomFieldValue(1.5), "1.5");
  assert.equal(formatCustomFieldValue(["one", "two"], choices), "第一项、第二项");
  assert.equal(formatCustomFieldValue("missing", choices), "已失效的选项");
  assert.equal(formatCustomFieldValue(null), "未设置");
  assert.equal(formatCustomFieldValue("中文内容"), "中文内容");
});
test("option reorder preserves stable ids and refuses out of range moves", () => {
  const choices = [
    { id: "one", name: "一", is_active: true },
    { id: "two", name: "二", is_active: true },
  ];
  assert.deepEqual(
    moveCustomFieldOption(choices, 0, 1).map((x) => x.id),
    ["two", "one"]
  );
  assert.deepEqual(moveCustomFieldOption(choices, 0, -1), choices);
  assert.equal(choices[0].id, "one");
});

test("integer inputs accept both safe boundaries and reject the adjacent unsafe values", () => {
  assert.equal(parseCustomFieldInput("integer", String(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
  assert.equal(parseCustomFieldInput("integer", String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.equal(parseCustomFieldInput("integer", String(Number.MIN_SAFE_INTEGER - 1)), undefined);
  assert.equal(parseCustomFieldInput("integer", String(Number.MAX_SAFE_INTEGER + 1)), undefined);
  assert.equal(parseCustomFieldInput("integer", "-1.5"), undefined);
});

// Apply the documented backend merge contract to independent stale form snapshots.
const applyCustomFieldPatch = (serverValues, patch) => {
  const result = structuredClone(serverValues);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
};

test("two stale edit forms preserve each other's changes to independent fields", () => {
  const snapshotOne = { customer: "原客户", amount: 10 };
  const snapshotTwo = structuredClone(snapshotOne);
  let server = structuredClone(snapshotOne);
  server = applyCustomFieldPatch(server, getCustomFieldPatch({ ...snapshotOne, customer: "新客户" }, snapshotOne));
  server = applyCustomFieldPatch(server, getCustomFieldPatch({ ...snapshotTwo, amount: 20 }, snapshotTwo));
  assert.deepEqual(server, { customer: "新客户", amount: 20 });
});

test("clearing one stale field preserves other server changes and emits explicit null", () => {
  const baseline = { customer: "原客户", amount: 10 };
  const patch = getCustomFieldPatch({ ...baseline, amount: null }, baseline);
  assert.deepEqual(patch, { amount: null });
  assert.deepEqual(applyCustomFieldPatch({ customer: "已更新", amount: 10 }, patch), { customer: "已更新" });
});

test("unchanged and reverted values emit no keys, including equivalent copied arrays", () => {
  const baseline = { zero: 0, flag: false, members: ["成员甲", "成员乙"] };
  assert.deepEqual(getCustomFieldPatch(structuredClone(baseline), baseline), {});
  assert.deepEqual(getCustomFieldPatch({ optional: null }, {}), {});
  assert.deepEqual(getCustomFieldPatch({}, baseline), {});
});

test("changed zero, false and array values survive patch generation without mutating the snapshot", () => {
  const baseline = { amount: 3, enabled: true, members: ["成员甲"] };
  const current = { amount: 0, enabled: false, members: ["成员乙"], newField: "新值" };
  const patch = getCustomFieldPatch(current, baseline);
  assert.deepEqual(patch, current);
  assert.deepEqual(applyCustomFieldPatch(baseline, patch), current);
  assert.deepEqual(baseline, { amount: 3, enabled: true, members: ["成员甲"] });
});

test("draft conversion from a stale window keeps newer unrelated values and original built-in payload behavior", () => {
  const snapshot = {
    id: "draft-id",
    project_id: "project-id",
    name: "原标题",
    custom_fields: { customer: "原客户", amount: 10 },
  };
  const formValues = {
    ...structuredClone(snapshot),
    name: "转换时标题",
    priority: "high",
    module_ids: ["模块甲"],
    custom_fields: { ...snapshot.custom_fields, amount: 20 },
  };
  const payload = getDraftConversionPayload(snapshot, formValues, structuredClone(snapshot.custom_fields));
  const convertedValues = applyCustomFieldPatch(
    { customer: "另一窗口的新客户", amount: 10 },
    payload.custom_fields ?? {}
  );
  assert.deepEqual(convertedValues, { customer: "另一窗口的新客户", amount: 20 });
  assert.equal(payload.name, "转换时标题");
  assert.equal(payload.priority, "high");
  assert.equal(payload.project_id, "project-id");
  assert.deepEqual(payload.module_ids, ["模块甲"]);
  assert.deepEqual(snapshot.custom_fields, { customer: "原客户", amount: 10 });
});

test("draft conversion omits unchanged custom fields while preserving built-in form updates", () => {
  const snapshot = {
    id: "draft-id",
    project_id: "project-id",
    name: "原标题",
    custom_fields: { flag: false, amount: 0, members: ["成员甲"] },
  };
  const formValues = { ...structuredClone(snapshot), name: "新标题", project_id: "目标项目" };
  const payload = getDraftConversionPayload(snapshot, formValues, structuredClone(snapshot.custom_fields));
  assert.equal(Object.hasOwn(payload, "custom_fields"), false);
  assert.equal(payload.name, "新标题");
  assert.equal(payload.project_id, "目标项目");
});

test("draft conversion preserves explicit clears and changed zero, false and array values", () => {
  const snapshot = {
    id: "draft-id",
    custom_fields: { customer: "客户甲", amount: 10, flag: true, members: ["成员甲"], keep: "旧值" },
  };
  const formValues = { custom_fields: { customer: null, amount: 0, flag: false, members: ["成员乙"], keep: "旧值" } };
  const payload = getDraftConversionPayload(snapshot, formValues, snapshot.custom_fields);
  assert.deepEqual(payload.custom_fields, { customer: null, amount: 0, flag: false, members: ["成员乙"] });
  assert.deepEqual(applyCustomFieldPatch({ ...snapshot.custom_fields, keep: "已更新" }, payload.custom_fields), {
    amount: 0,
    flag: false,
    members: ["成员乙"],
    keep: "已更新",
  });
});
