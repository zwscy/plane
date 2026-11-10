/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, TIssue, TProjectCustomField } from "@plane/types";
import { CustomFieldEditor } from "@/components/issues/custom-fields";
import { getSortableCustomFields } from "@/helpers/custom-field-views";

export const CustomFieldHeader = observer(function CustomFieldHeader({
  field,
  displayFilters,
  onChange,
}: {
  field: TProjectCustomField;
  displayFilters: IIssueDisplayFilterOptions;
  onChange: (data: Partial<IIssueDisplayFilterOptions>) => void;
}) {
  const { t } = useTranslation();
  const key = `custom_fields__${field.id}` as const;
  const selected = displayFilters.order_by === key || displayFilters.order_by === `-${key}`;
  const sortable = getSortableCustomFields([field]).length > 0;
  return (
    <th
      className="h-11 min-w-44 border-r border-b border-subtle bg-layer-1 px-3 text-left text-body-xs-medium"
      aria-sort={selected ? (displayFilters.order_by?.startsWith("-") ? "descending" : "ascending") : "none"}
    >
      {sortable ? (
        <Menu>
          <MenuTrigger render={<button type="button" className="w-full text-left" />}>
            {field.name}
            {selected ? (displayFilters.order_by?.startsWith("-") ? " ↓" : " ↑") : ""}
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              label={t("common.order_by.asc")}
              selected={displayFilters.order_by === key}
              onClick={() => onChange({ order_by: key })}
            />
            <MenuItem
              label={t("common.order_by.desc")}
              selected={displayFilters.order_by === `-${key}`}
              onClick={() => onChange({ order_by: `-${key}` })}
            />
            {selected && (
              <MenuItem
                label={t("common.actions.clear_sorting")}
                onClick={() => onChange({ order_by: "sort_order" })}
              />
            )}
          </MenuContent>
        </Menu>
      ) : (
        field.name
      )}
    </th>
  );
});

export const CustomFieldCell = observer(function CustomFieldCell({
  field,
  issue,
  disabled,
  updateIssue,
}: {
  field: TProjectCustomField;
  issue: TIssue;
  disabled: boolean;
  updateIssue?: (projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>;
}) {
  const { workspaceSlug, projectId } = useParams();
  return (
    <td tabIndex={0} className="h-11 min-w-44 border-r border-b border-subtle px-3 text-body-xs-regular">
      {issue.project_id === projectId && (
        <CustomFieldEditor
          workspaceSlug={workspaceSlug?.toString() ?? ""}
          projectId={issue.project_id ?? ""}
          field={field}
          value={issue.custom_fields?.[field.id] ?? null}
          onChange={async (value) => {
            await updateIssue?.(issue.project_id, issue.id, { custom_fields: { [field.id]: value } });
          }}
          disabled={disabled || !updateIssue}
          compact
        />
      )}
    </td>
  );
});
