import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getVisibleCustomFields,
  getSortableCustomFields,
  isCustomFieldOrderBy,
  mergeCustomFieldValues,
  preserveCustomFieldOrder,
} from "../custom-field-views.ts";

const fields = [
  { id: "a", is_active: true, field_type: "text", sort_order: 2 },
  { id: "b", is_active: true, field_type: "integer", sort_order: 1 },
  { id: "c", is_active: false, field_type: "date", sort_order: 0 },
  { id: "d", is_active: true, field_type: "members", sort_order: 3 },
];
test("active fields default visible; explicit false persists; definition order wins", () => {
  assert.deepEqual(
    getVisibleCustomFields(fields, { a: false, c: true }).map((f) => f.id),
    ["b", "d"]
  );
  assert.deepEqual(
    getVisibleCustomFields(fields).map((f) => f.id),
    ["b", "a", "d"]
  );
});
test("multi-valued and inactive fields cannot order", () => {
  assert.deepEqual(
    getSortableCustomFields([
      ...fields,
      ...["multi_select", "labels", "modules"].map((field_type) => ({
        id: field_type,
        is_active: true,
        field_type,
        sort_order: 4,
      })),
    ]).map((f) => f.id),
    ["b", "a"]
  );
});
test("custom order detection accepts both directions and rejects built-in keys", () => {
  assert.equal(isCustomFieldOrderBy("custom_fields__abc"), true);
  assert.equal(isCustomFieldOrderBy("-custom_fields__abc"), true);
  assert.equal(isCustomFieldOrderBy("-created_at"), false);
  assert.equal(isCustomFieldOrderBy(undefined), false);
});
test("server sibling order survives fallback and never flattens children", () => {
  assert.deepEqual(preserveCustomFieldOrder(["parent-b", "parent-a"], "-custom_fields__a"), ["parent-b", "parent-a"]);
  assert.deepEqual(preserveCustomFieldOrder(["child-b", "child-a"], "custom_fields__a"), ["child-b", "child-a"]);
  assert.equal(preserveCustomFieldOrder(["a"], "sort_order"), undefined);
});
test("patch merges fields; null clears only the supplied key; false and zero survive", () => {
  assert.deepEqual(mergeCustomFieldValues({ a: "old", b: 2 }, { a: null, c: false, d: 0 }), { b: 2, c: false, d: 0 });
});

test("saved custom order becomes invalid when its field is disabled, deleted or multi-valued", async () => {
  const { isCustomFieldOrderValid } = await import("../custom-field-views.ts");
  assert.equal(isCustomFieldOrderValid(fields, "custom_fields__a"), true);
  assert.equal(isCustomFieldOrderValid(fields, "-custom_fields__b"), true);
  assert.equal(isCustomFieldOrderValid(fields, "custom_fields__c"), false);
  assert.equal(isCustomFieldOrderValid(fields, "custom_fields__d"), false);
  assert.equal(isCustomFieldOrderValid(fields, "custom_fields__deleted"), false);
  assert.equal(isCustomFieldOrderValid(fields, "sort_order"), true);
});
