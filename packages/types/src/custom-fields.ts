/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TCustomFieldType =
  | "text"
  | "textarea"
  | "integer"
  | "decimal"
  | "date"
  | "boolean"
  | "select"
  | "multi_select"
  | "member"
  | "members"
  | "labels"
  | "state"
  | "priority"
  | "cycle"
  | "modules"
  | "estimate";

export type TCustomFieldValue = string | number | boolean | string[] | null;
export type TCustomFieldOption = { id: string; name: string; is_active: boolean };
export type TProjectCustomField = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  field_type: TCustomFieldType;
  options: TCustomFieldOption[];
  sort_order: number;
  is_active: boolean;
  is_type_locked: boolean;
};
export type TProjectCustomFieldInput = Pick<
  TProjectCustomField,
  "name" | "description" | "field_type" | "options" | "sort_order" | "is_active"
>;
