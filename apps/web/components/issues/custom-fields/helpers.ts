/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCustomFieldType, TCustomFieldValue, TCustomFieldOption, TIssue } from "@plane/types";

export function parseCustomFieldInput(type: TCustomFieldType, raw: string): TCustomFieldValue | undefined {
  if (raw === "") return null;
  if (type === "boolean") return raw === "true";
  if (type === "integer" || type === "decimal") {
    const number = Number(raw);
    if (!Number.isFinite(number) || (type === "integer" && !Number.isSafeInteger(number))) return undefined;
    return number;
  }
  return raw;
}

export function formatCustomFieldValue(value: TCustomFieldValue | undefined, options?: TCustomFieldOption[]): string {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  const display = (entry: string) =>
    options ? (options.find((option) => option.id === entry)?.name ?? "已失效的选项") : entry;
  return Array.isArray(value)
    ? value.map(display).join("、")
    : typeof value === "string"
      ? display(value)
      : String(value);
}

export function moveCustomFieldOption(
  options: TCustomFieldOption[],
  index: number,
  direction: -1 | 1
): TCustomFieldOption[] {
  const next = index + direction;
  if (index < 0 || index >= options.length || next < 0 || next >= options.length) return options;
  const result = [...options];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

export function getCustomFieldPatch(
  current: Record<string, TCustomFieldValue> = {},
  baseline: Record<string, TCustomFieldValue> = {}
): Record<string, TCustomFieldValue> {
  const patch: Record<string, TCustomFieldValue> = {};
  for (const [id, value] of Object.entries(current)) {
    const original = baseline[id] ?? null;
    const unchanged =
      Array.isArray(value) && Array.isArray(original)
        ? value.length === original.length && value.every((entry, index) => entry === original[index])
        : value === original;
    if (!unchanged) patch[id] = value;
  }
  return patch;
}

export function getDraftConversionPayload(
  data: Partial<TIssue>,
  formValues: Partial<TIssue>,
  baseline: Record<string, TCustomFieldValue>
): Partial<TIssue> {
  const payload = { ...data, ...formValues };
  const patch = getCustomFieldPatch(payload.custom_fields, baseline);
  delete payload.custom_fields;
  if (Object.keys(patch).length) payload.custom_fields = patch;
  return payload;
}
