/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCustomFieldValue } from "@plane/types";
type Field = { id: string; is_active: boolean; field_type: string; sort_order: number };
export const getVisibleCustomFields = <T extends Field>(fields: T[], visibility?: Record<string, boolean>): T[] =>
  fields
    .filter((field) => field.is_active && visibility?.[field.id] !== false)
    .sort((a, b) => a.sort_order - b.sort_order);
export const getSortableCustomFields = <T extends Field>(fields: T[]): T[] =>
  getVisibleCustomFields(fields).filter(
    (field) => !["multi_select", "members", "labels", "modules"].includes(field.field_type)
  );
export const isCustomFieldOrderBy = (orderBy?: string): boolean => /^-?custom_fields__.+$/.test(orderBy ?? "");
export const preserveCustomFieldOrder = (issueIds: string[], orderBy?: string): string[] | undefined =>
  isCustomFieldOrderBy(orderBy) ? issueIds : undefined;
export const mergeCustomFieldValues = (
  current: Record<string, TCustomFieldValue> = {},
  patch: Record<string, TCustomFieldValue> = {}
): Record<string, TCustomFieldValue> => {
  const values = { ...current, ...patch };
  for (const [key, value] of Object.entries(values)) if (value === null) delete values[key];
  return values;
};

export const isCustomFieldOrderValid = <T extends Field>(fields: T[], orderBy?: string): boolean =>
  !isCustomFieldOrderBy(orderBy) ||
  getSortableCustomFields(fields).some((field) => orderBy?.replace(/^-/, "") === `custom_fields__${field.id}`);
