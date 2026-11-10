import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getOrderedSpreadsheetColumnKeys,
  moveSpreadsheetColumn,
  reorderVisibleSpreadsheetColumns,
} from "../spreadsheet-columns.ts";

const available = ["state", "assignee", "due_date", "custom_fields__priority", "custom_fields__hours"];

test("built-in and custom columns can interleave before the due date", () => {
  assert.deepEqual(
    getOrderedSpreadsheetColumnKeys(available, ["state", "custom_fields__priority", "due_date", "assignee"]),
    ["state", "custom_fields__priority", "due_date", "assignee", "custom_fields__hours"]
  );
});

test("unknown, deleted and duplicate IDs are ignored and new columns append", () => {
  const saved = ["gone", "custom_fields__priority", "due_date", "due_date", null, 42];
  assert.deepEqual(getOrderedSpreadsheetColumnKeys(available, saved), [
    "custom_fields__priority",
    "due_date",
    "state",
    "assignee",
    "custom_fields__hours",
  ]);
  assert.deepEqual(saved, ["gone", "custom_fields__priority", "due_date", "due_date", null, 42]);
});

test("missing or malformed saved order retains the original table order", () => {
  for (const order of [undefined, null, false, "due_date", { due_date: 1 }]) {
    assert.deepEqual(getOrderedSpreadsheetColumnKeys(available, order), available);
  }
});

test("temporarily unavailable custom columns do not mutate saved preferences", () => {
  const saved = ["custom_fields__priority", "due_date", "state", "assignee", "custom_fields__hours"];
  assert.deepEqual(getOrderedSpreadsheetColumnKeys(["state", "assignee", "due_date"], saved), [
    "due_date",
    "state",
    "assignee",
  ]);
  assert.deepEqual(getOrderedSpreadsheetColumnKeys(available, saved), saved);
});

test("hidden columns retain their position when visibility is restored", () => {
  const ordered = getOrderedSpreadsheetColumnKeys(available, ["custom_fields__priority", "due_date"]);
  const hidden = new Set(["due_date"]);
  assert.deepEqual(
    ordered.filter((key) => !hidden.has(key)),
    ["custom_fields__priority", "state", "assignee", "custom_fields__hours"]
  );
  hidden.clear();
  assert.deepEqual(
    ordered.filter((key) => !hidden.has(key)),
    ordered
  );
});

test("moving a column changes only its position and leaves the source untouched", () => {
  assert.deepEqual(moveSpreadsheetColumn(available, "custom_fields__priority", -1), [
    "state",
    "assignee",
    "custom_fields__priority",
    "due_date",
    "custom_fields__hours",
  ]);
  assert.deepEqual(moveSpreadsheetColumn(available, "assignee", 1), [
    "state",
    "due_date",
    "assignee",
    "custom_fields__priority",
    "custom_fields__hours",
  ]);
  assert.deepEqual(available, ["state", "assignee", "due_date", "custom_fields__priority", "custom_fields__hours"]);
});

test("first and last column movement boundaries and missing columns are safe no-ops", () => {
  assert.deepEqual(moveSpreadsheetColumn(available, "state", -1), available);
  assert.deepEqual(moveSpreadsheetColumn(available, "custom_fields__hours", 1), available);
  assert.deepEqual(moveSpreadsheetColumn(available, "gone", -1), available);
  assert.deepEqual(moveSpreadsheetColumn([], "state", 1), []);
});

test("reordering shown columns leaves hidden columns in their original slots", () => {
  const all = ["state", "hidden-a", "assignee", "hidden-b", "due_date", "custom_fields__priority"];
  const reordered = ["custom_fields__priority", "state", "due_date", "assignee"];
  assert.deepEqual(reorderVisibleSpreadsheetColumns(all, reordered), [
    "custom_fields__priority",
    "hidden-a",
    "state",
    "hidden-b",
    "due_date",
    "assignee",
  ]);
  assert.deepEqual(all, ["state", "hidden-a", "assignee", "hidden-b", "due_date", "custom_fields__priority"]);
  assert.deepEqual(reordered, ["custom_fields__priority", "state", "due_date", "assignee"]);
});

test("shown-order merge ignores invalid duplicates and handles empty and single-column groups", () => {
  assert.deepEqual(reorderVisibleSpreadsheetColumns(available, []), available);
  assert.deepEqual(reorderVisibleSpreadsheetColumns(available, ["due_date"]), available);
  assert.deepEqual(reorderVisibleSpreadsheetColumns(available, ["due_date", "gone", "state", "due_date"]), [
    "due_date",
    "assignee",
    "state",
    "custom_fields__priority",
    "custom_fields__hours",
  ]);
});

test("unhiding a field after shown-order changes restores its saved relative position", () => {
  const all = ["state", "custom_fields__priority", "due_date", "assignee"];
  const merged = reorderVisibleSpreadsheetColumns(all, ["due_date", "state", "assignee"]);
  assert.deepEqual(merged, ["due_date", "custom_fields__priority", "state", "assignee"]);
  assert.deepEqual(getOrderedSpreadsheetColumnKeys(all, merged), merged);
});
