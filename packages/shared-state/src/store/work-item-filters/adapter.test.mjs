/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { autorun } from "mobx";
import { FilterInstance, workItemFiltersAdapter } from "../../../dist/index.js";
import {
  deepCompareFilterExpressions,
  extractConditions,
  hasValidValue,
  sanitizeAndStabilizeExpression,
} from "@plane/utils";

const customField = "custom_fields__122bce99-a970-4e67-8636-25fb94da126d";
const roundTrip = (expression) => workItemFiltersAdapter.toExternal(workItemFiltersAdapter.toInternal(expression));

// Run after building @plane/types, @plane/utils and @plane/shared-state.
test("AND/OR round trips preserve typed arrays, text commas and custom properties", () => {
  const expression = {
    or: [
      { [`${customField}__gte`]: -0.25 },
      { and: [{ name__icontains: "a,b" }, { label_id__contains_all: ["one,two", "three"] }] },
    ],
  };
  assert.deepEqual(roundTrip(expression), expression);
  assert.equal(extractConditions(workItemFiltersAdapter.toInternal(expression)).length, 3);
});

test("legacy exact, membership CSV and date range load without parsing scalar text", () => {
  const expression = {
    and: [
      { priority__exact: "high" },
      { and: [{ assignee_id__in: "first, second" }, { start_date__range: "2026-11-01,2026-11-11" }] },
      { name__exact: "hello, world" },
    ],
  };
  assert.deepEqual(roundTrip(expression), {
    and: [
      { priority__exact: "high" },
      { and: [{ assignee_id__in: ["first", "second"] }, { start_date__range: ["2026-11-01", "2026-11-11"] }] },
      { name__exact: "hello, world" },
    ],
  });
});

test("all typed operators and existing customproperty keys round trip", () => {
  for (const [operator, value] of [
    ["exact", false],
    ["not_exact", 0],
    ["in", ["one"]],
    ["not_in", ["two", "three"]],
    ["icontains", "needle"],
    ["not_icontains", "needle"],
    ["gt", 2],
    ["gte", 2],
    ["lt", 10],
    ["lte", 10],
    ["range", [-0.5, 1.5]],
    ["not_range", [0, 10]],
    ["is_empty", true],
    ["is_not_empty", true],
    ["contains_all", ["one", "two"]],
  ]) {
    const expression = { [`${customField}__${operator}`]: value };
    assert.deepEqual(roundTrip(expression), expression, operator);
  }
  assert.deepEqual(roundTrip({ customproperty_example__exact: "existing" }), {
    customproperty_example__exact: "existing",
  });
});

test("NOT groups preserve nested AND/OR semantics in traversal and sanitization", () => {
  const expression = { not: { or: [{ priority__in: ["high", "urgent"] }, { name__icontains: "test" }] } };
  const internal = workItemFiltersAdapter.toInternal(expression);
  assert.equal(extractConditions(internal).length, 2);
  assert.deepEqual(workItemFiltersAdapter.toExternal(sanitizeAndStabilizeExpression(internal)), expression);
});

test("reset, save and update preserve nested single-child groups and retain the initial baseline", async () => {
  const original = { and: [{ priority__exact: "high" }] };
  const applied = { or: [{ and: [{ [`${customField}__exact`]: 0 }] }, { name__is_empty: true }] };
  const changes = [];
  const saved = [];
  const updated = [];
  const filter = new FilterInstance({
    adapter: workItemFiltersAdapter,
    initialExpression: original,
    onExpressionChange: (expression) => changes.push(expression),
    options: {
      expression: {
        saveViewOptions: { onViewSave: async (expression) => saved.push(expression) },
        updateViewOptions: { onViewUpdate: async (expression) => updated.push(expression) },
      },
    },
  });
  assert.equal(filter.hasChanges, false);
  filter.resetExpression(applied, false);
  assert.equal(filter.hasChanges, true);
  assert.equal(filter.hasActiveFilters, true);
  assert.deepEqual(changes, [applied]);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.initialFilterExpression), original);
  await filter.saveView();
  await filter.updateView();
  assert.deepEqual(saved, [applied]);
  assert.deepEqual(updated, [applied]);
  assert.equal(filter.hasChanges, false);
});

test("zero, false and empty sentinels remain active through save sanitization", async () => {
  await Promise.all(
    [{ [`${customField}__exact`]: 0 }, { [`${customField}__exact`]: false }, { name__is_not_empty: true }].map(
      async (expression) => {
        const saved = [];
        const filter = new FilterInstance({
          adapter: workItemFiltersAdapter,
          initialExpression: expression,
          options: { expression: { saveViewOptions: { onViewSave: async (value) => saved.push(value) } } },
        });
        assert.equal(filter.hasActiveFilters, true);
        await filter.saveView();
        assert.deepEqual(saved, [expression]);
      }
    )
  );
  assert.equal(hasValidValue(0), true);
  assert.equal(hasValidValue(false), true);
  assert.equal(hasValidValue(null), false);
  assert.equal(hasValidValue([]), false);
});

test("comparison distinguishes AND from OR but ignores node IDs and branch order", () => {
  const conditions = [{ priority__exact: "high" }, { name__icontains: "release" }];
  const first = workItemFiltersAdapter.toInternal({ or: conditions });
  const reordered = workItemFiltersAdapter.toInternal({ or: conditions.toReversed() });
  const all = workItemFiltersAdapter.toInternal({ and: conditions });
  assert.equal(deepCompareFilterExpressions(first, reordered), true);
  assert.equal(deepCompareFilterExpressions(first, all), false);
});

test("applying waits for persistence, keeps its initial baseline and rolls back on failure", async () => {
  const original = { priority__exact: "high" };
  const applied = { or: [{ [`${customField}__exact`]: 0 }, { name__icontains: "release" }] };
  const filter = new FilterInstance({ adapter: workItemFiltersAdapter, initialExpression: original });
  let saved;
  let release;
  let completed = false;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  filter.onExpressionChange = async (expression) => {
    await pending;
    saved = expression;
  };
  const applying = filter.applyExpression(applied).then(() => {
    completed = true;
    return completed;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  release();
  await applying;
  assert.deepEqual(saved, applied);
  assert.equal(filter.hasChanges, true);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.initialFilterExpression), original);
  filter.onExpressionChange = async () => {
    throw new Error("Persistence failed");
  };
  await assert.rejects(filter.applyExpression({ name__exact: "another" }), /Persistence failed/);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), applied);
  assert.equal(filter.hasChanges, true);
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

for (const fails of [false, true]) {
  test(`pending validation rejects another Apply before its request and ${fails ? "failure unlocks" : "success persists"}`, async () => {
    const original = { priority__exact: "high" };
    const next = { name__icontains: "release" };
    const validation = deferred();
    const saved = [];
    const filter = new FilterInstance({
      adapter: workItemFiltersAdapter,
      initialExpression: original,
      onExpressionChange: async (expression) => saved.push(expression),
    });
    const busy = [];
    const stop = autorun(() => busy.push(filter.isApplying));
    let secondRequests = 0;
    const applying = filter.applyExpression(next, () => validation.promise);
    const settled = fails ? assert.rejects(applying, /Validation failed/) : applying;
    try {
      assert.equal(filter.isApplying, true);
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), original);
      await assert.rejects(
        filter.applyExpression({}, async () => secondRequests++),
        /already in progress/
      );
      assert.equal(secondRequests, 0, "rejected Apply never starts validation");
      assert.deepEqual(saved, [], "neither request has persisted during validation");
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), original);
      if (fails) validation.reject(new Error("Validation failed"));
      else validation.resolve();
      await settled;
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), fails ? original : next);
      assert.deepEqual(saved, fails ? [] : [next]);
      assert.equal(filter.isApplying, false);
      assert.deepEqual(busy, [false, true, false], "the shared lock is observable");
      await filter.applyExpression({});
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {});
    } finally {
      validation.resolve();
      await settled;
      stop();
    }
  });

  test(`pending persistence rejects Clear without mutation and ${fails ? "failure rolls back" : "success retains the draft"}`, async () => {
    const original = { priority__exact: "high" };
    const next = { name__icontains: "release" };
    const persistence = deferred();
    const saved = [];
    const filter = new FilterInstance({
      adapter: workItemFiltersAdapter,
      initialExpression: original,
      onExpressionChange: async (expression) => {
        saved.push(expression);
        await persistence.promise;
      },
    });
    const applying = filter.applyExpression(next);
    const settled = fails ? assert.rejects(applying, /Persistence failed/) : applying;
    try {
      await Promise.resolve();
      assert.equal(filter.isApplying, true);
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), next);
      await assert.rejects(filter.applyExpression({}), /already in progress/);
      assert.deepEqual(saved, [next], "Clear never starts a preference request");
      assert.deepEqual(
        workItemFiltersAdapter.toExternal(filter.expression),
        next,
        "Clear cannot mutate the active draft"
      );
      if (fails) persistence.reject(new Error("Persistence failed"));
      else persistence.resolve();
      await settled;
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), fails ? original : next);
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.initialFilterExpression), original);
      assert.equal(filter.isApplying, false);
      filter.onExpressionChange = async () => {};
      await filter.applyExpression({});
      assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {});
    } finally {
      persistence.resolve();
      await settled;
    }
  });
}

test("invalid internal expressions release the application lock without changing filters", async () => {
  const original = { priority__exact: "high" };
  const filter = new FilterInstance({ adapter: workItemFiltersAdapter, initialExpression: original });
  await assert.rejects(filter.applyExpression({ name__unknown: "invalid" }), /Invalid filter expression/);
  assert.equal(filter.isApplying, false);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), original);
  await filter.applyExpression({});
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {});
});

test("saving a single nested NOT branch preserves every historical group", () => {
  const expression = { and: [{ not: { or: [{ priority__exact: "high" }] } }] };
  const internal = workItemFiltersAdapter.toInternal(expression);
  assert.deepEqual(workItemFiltersAdapter.toExternal(sanitizeAndStabilizeExpression(internal)), expression);
});

test("adding conditions with OR retains existing groups instead of changing them to AND", () => {
  const filter = new FilterInstance({ adapter: workItemFiltersAdapter });
  filter.addCondition("or", { property: "priority", operator: "exact", value: "high" }, false);
  filter.addCondition("or", { property: "name", operator: "icontains", value: "release" }, false);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {
    or: [{ priority__exact: "high" }, { name__icontains: "release" }],
  });
  filter.addCondition("and", { property: "state_group", operator: "exact", value: "started" }, false);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {
    and: [{ or: [{ priority__exact: "high" }, { name__icontains: "release" }] }, { state_group__exact: "started" }],
  });
});

test("legacy bare properties load as exact without confusing a custom property with its suffix", () => {
  assert.deepEqual(roundTrip({ or: [{ priority: "high" }, { [customField]: 0 }, { [`${customField}__gte`]: 2 }] }), {
    or: [{ priority__exact: "high" }, { [`${customField}__exact`]: 0 }, { [`${customField}__gte`]: 2 }],
  });
});
