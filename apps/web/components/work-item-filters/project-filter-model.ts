/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  TCustomFieldType,
  TCustomFieldOption,
  TProjectCustomField,
  TWorkItemFilterExpression,
} from "@plane/types";

export type PanelField = {
  key: string;
  name: string;
  type: TCustomFieldType;
  options?: TCustomFieldOption[];
  customField?: TProjectCustomField;
};
export type PanelOperator = keyof typeof PANEL_OPERATOR_LABELS;
export type DraftFilterRow = { id: string; property: string; operator: string; value: string | string[] };
export type PanelDraft = { join: "and" | "or"; rows: DraftFilterRow[] };

export const PANEL_OPERATOR_LABELS = {
  exact: "等于",
  not_exact: "不等于",
  in: "包含任意一项",
  not_in: "不包含以下任一项",
  contains_all: "包含全部",
  icontains: "包含",
  not_icontains: "不包含",
  gt: "大于",
  gte: "大于或等于",
  lt: "小于",
  lte: "小于或等于",
  range: "介于",
  not_range: "不在范围内",
  is_empty: "为空",
  is_not_empty: "不为空",
} as const;

const EMPTY_OPERATORS = ["is_empty", "is_not_empty"] as const;
const ARRAY_OPERATORS = new Set(["in", "not_in", "contains_all", "range", "not_range"]);
const NATIVE_MULTIPLE_PROPERTIES = new Set(["assignee_id", "label_id", "module_id", "mention_id", "subscriber_id"]);
const MULTIPLE_TYPES = new Set(["multi_select", "members", "labels", "modules"]);
const CHOICE_TYPES = new Set([
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
]);
export const isPanelChoice = (type: TCustomFieldType) => CHOICE_TYPES.has(type);
export const isPanelRange = (operator: string) => operator === "range" || operator === "not_range";
export const isPanelEmpty = (operator: string) => EMPTY_OPERATORS.some((value) => value === operator);
export const isPanelMultiValue = (operator: string) => ARRAY_OPERATORS.has(operator);

export function getPanelOperators(type: TCustomFieldType): PanelOperator[] {
  if (MULTIPLE_TYPES.has(type)) return ["in", "contains_all", "not_in", ...EMPTY_OPERATORS];
  if (CHOICE_TYPES.has(type)) return ["in", "not_in", "exact", "not_exact", ...EMPTY_OPERATORS];
  if (type === "boolean") return ["exact", "not_exact", ...EMPTY_OPERATORS];
  if (type === "integer" || type === "decimal" || type === "date")
    return ["exact", "not_exact", "gt", "gte", "lt", "lte", "range", "not_range", ...EMPTY_OPERATORS];
  return ["icontains", "not_icontains", "exact", "not_exact", ...EMPTY_OPERATORS];
}

export function getPanelOperatorLabel(operator: string, type?: TCustomFieldType): string {
  if (type === "date") {
    const labels: Record<string, string> = { gt: "晚于", gte: "晚于或当天", lt: "早于", lte: "早于或当天" };
    if (labels[operator]) return labels[operator];
  }
  return PANEL_OPERATOR_LABELS[operator as PanelOperator] ?? `不支持的操作（${operator}）`;
}

export function newDraftFilterRow(field?: PanelField): DraftFilterRow {
  const operator = field ? getPanelOperators(field.type)[0] : "exact";
  return {
    id: uuidv4(),
    property: field?.key ?? "",
    operator,
    value: ARRAY_OPERATORS.has(operator) ? [] : "",
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const countConditions = (value: unknown): number => {
  if (!isRecord(value)) return 0;
  return Object.entries(value).reduce(
    (count, [key, child]) =>
      count +
      (Array.isArray(child) && ["and", "or", "not"].includes(key)
        ? child.reduce((sum, item) => sum + countConditions(item), 0)
        : 1),
    0
  );
};

/** Only a flat group is editable. Nested saved filters remain intact until explicitly cleared. */
export function parsePanelExpression(expression: unknown): PanelDraft & { unsupported: boolean; count: number } {
  const empty = { join: "and" as const, rows: [], unsupported: false, count: 0 };
  if (isRecord(expression) && !Object.keys(expression).length) return empty;
  if (!isRecord(expression)) return { ...empty, unsupported: true };
  const keys = Object.keys(expression);
  const join: PanelDraft["join"] = keys.length === 1 && keys[0] === "or" ? "or" : "and";
  const grouped = keys.length === 1 && (keys[0] === "and" || keys[0] === "or");
  const leaves = grouped ? expression[join] : [expression];
  const count = countConditions(expression);
  const unsupported = { join, rows: [], unsupported: true, count };
  if (!Array.isArray(leaves) || !leaves.length) return unsupported;
  const rows: DraftFilterRow[] = [];
  for (const [index, leaf] of leaves.entries()) {
    if (!isRecord(leaf) || Object.keys(leaf).length !== 1) return unsupported;
    const [key, raw] = Object.entries(leaf)[0];
    if (["and", "or", "not"].includes(key) || (typeof raw === "object" && raw !== null && !Array.isArray(raw)))
      return unsupported;
    const separator = key.lastIndexOf("__");
    const suffix = separator > 0 ? key.slice(separator + 2) : "";
    const hasOperator = suffix in PANEL_OPERATOR_LABELS;
    // Custom-field UUID is part of the property, never an implicit operator.
    const property = hasOperator ? key.slice(0, separator) : key;
    const originalOperator = hasOperator ? suffix : "exact";
    // Native relation equality with one value is equivalent to membership of that value.
    const operator =
      NATIVE_MULTIPLE_PROPERTIES.has(property) &&
      (originalOperator === "exact" || originalOperator === "not_exact") &&
      !Array.isArray(raw)
        ? originalOperator === "exact"
          ? "in"
          : "not_in"
        : originalOperator;
    const value = ARRAY_OPERATORS.has(operator)
      ? (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [raw]).map((part) => String(part ?? ""))
      : Array.isArray(raw)
        ? raw.map((part) => String(part))
        : String(raw ?? "");
    rows.push({ id: `saved-${index}`, property, operator, value });
  }
  return { join, rows, unsupported: false, count };
}

function parseScalar(field: PanelField, value: string): string | number | boolean | undefined {
  if (!value.trim()) return undefined;
  if (field.type === "integer" || field.type === "decimal") {
    const numeric = Number(value);
    return Number.isFinite(numeric) && (field.type !== "integer" || Number.isSafeInteger(numeric))
      ? numeric
      : undefined;
  }
  if (field.type === "boolean") return value === "true" ? true : value === "false" ? false : undefined;
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
  }
  return value;
}

/** Validate every row before producing a replacement for the active expression. */
export function buildPanelExpression(
  draft: PanelDraft,
  fields: PanelField[]
): { expression: TWorkItemFilterExpression | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const leaves: Record<string, unknown>[] = [];
  const fieldMap = new Map(fields.map((field) => [field.key, field]));
  for (const row of draft.rows) {
    const field = fieldMap.get(row.property);
    if (!field) {
      errors[row.id] = row.property ? "字段已停用、删除或不可用，请选择其他字段" : "请选择字段";
      continue;
    }
    if (!getPanelOperators(field.type).includes(row.operator as PanelOperator)) {
      errors[row.id] = "此字段不支持该操作，请重新选择";
      continue;
    }
    let value: unknown = true;
    if (!isPanelEmpty(row.operator)) {
      const multiple = isPanelMultiValue(row.operator);
      const rawValues = multiple ? (Array.isArray(row.value) ? row.value : [row.value]) : [row.value];
      const parsed = rawValues.map((raw) => (typeof raw === "string" ? parseScalar(field, raw) : undefined));
      if (!parsed.length || parsed.some((part) => part === undefined) || (!multiple && Array.isArray(row.value))) {
        errors[row.id] =
          field.type === "integer"
            ? "请输入有效的整数"
            : field.type === "decimal"
              ? "请输入有效的数字"
              : field.type === "date"
                ? "请选择有效日期"
                : "请填写完整条件";
        continue;
      }
      if (isPanelRange(row.operator) && (parsed.length !== 2 || parsed[0]! > parsed[1]!)) {
        errors[row.id] = "请填写完整范围，起始值不能大于结束值";
        continue;
      }
      if (
        (field.type === "select" || field.type === "multi_select") &&
        parsed.some((part) => !field.options?.some((option) => option.id === part))
      ) {
        errors[row.id] = "条件包含已失效的选项，请重新选择";
        continue;
      }
      value = multiple ? [...new Set(parsed)] : parsed[0];
    }
    leaves.push({ [`${row.property}__${row.operator}`]: value });
  }
  if (Object.keys(errors).length) return { expression: null, errors };
  const expression = !leaves.length ? {} : leaves.length === 1 ? leaves[0] : { [draft.join]: leaves };
  return { expression: expression as TWorkItemFilterExpression, errors };
}
