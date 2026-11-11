/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import {
  AlignLeftOutline,
  BooleanOutline,
  CalendarOutline,
  CyclesOutline,
  DropdownOutline,
  EstimateOutline,
  HashOutline,
  LabelsOutline,
  MembersOutline,
  ModuleOutline,
  MultiTagOutline,
  PriorityOutline,
  StateOutline,
  TextOutline,
  UserOutline,
} from "@makeplane/propel/icons";
import { LUCIDE_ICONS_LIST } from "@plane/blocks/emoji-icon-picker/data";
import type { TCustomFieldIcon, TCustomFieldType } from "@plane/types";

const customFieldTypeIcons: Record<TCustomFieldType, typeof TextOutline> = {
  text: TextOutline,
  textarea: AlignLeftOutline,
  integer: HashOutline,
  decimal: HashOutline,
  date: CalendarOutline,
  boolean: BooleanOutline,
  select: DropdownOutline,
  multi_select: MultiTagOutline,
  member: UserOutline,
  members: MembersOutline,
  labels: LabelsOutline,
  state: StateOutline,
  priority: PriorityOutline,
  cycle: CyclesOutline,
  modules: ModuleOutline,
  estimate: EstimateOutline,
};

export function CustomFieldTypeIcon({
  type,
  icon,
  className,
}: {
  type: TCustomFieldType;
  icon?: TCustomFieldIcon | null;
  className?: string;
}) {
  const customIcon = icon && LUCIDE_ICONS_LIST.find((item) => item.name === icon.name);
  if (icon && customIcon) {
    const CustomIcon = customIcon.element;
    return (
      <CustomIcon
        className={className}
        style={/^#[0-9a-f]{6}$/i.test(icon.color) ? { color: icon.color } : undefined}
        aria-hidden="true"
        data-custom-field-type={type}
      />
    );
  }
  const Icon = customFieldTypeIcons[type];
  return <Icon className={className} aria-hidden="true" data-custom-field-type={type} />;
}
