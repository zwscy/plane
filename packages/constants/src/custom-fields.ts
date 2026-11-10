/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCustomFieldType } from "@plane/types";

export const CUSTOM_FIELD_TYPE_LABELS: Record<TCustomFieldType, string> = {
  text: "单行文本",
  textarea: "多行文本",
  integer: "整数",
  decimal: "小数",
  date: "日期",
  boolean: "是/否",
  select: "单选",
  multi_select: "多选",
  member: "单个成员",
  members: "多个成员",
  labels: "标签",
  state: "状态",
  priority: "优先级",
  cycle: "周期",
  modules: "模块",
  estimate: "估算",
};
export const CUSTOM_FIELD_MULTI_TYPES: TCustomFieldType[] = ["multi_select", "members", "labels", "modules"];
