/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssue } from "@plane/types";
import { CustomFieldEditor } from "@/components/issues/custom-fields";
import { getSortableCustomFields, getVisibleCustomFields } from "@/helpers/custom-field-views";
import { useProjectCustomFields } from "@/hooks/use-project-custom-fields";

export const CustomFieldHeaders = observer(function CustomFieldHeaders({
  displayProperties,
  displayFilters,
  onChange,
}: {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  onChange: (data: Partial<IIssueDisplayFilterOptions>) => void;
}) {
  const { workspaceSlug, projectId } = useParams();
  const { fields } = useProjectCustomFields(workspaceSlug?.toString(), projectId?.toString());
  const { t } = useTranslation();
  const sortable = new Set(getSortableCustomFields(fields).map((field) => field.id));
  return getVisibleCustomFields(fields, displayProperties.custom_fields).map((field) => {
    const key = `custom_fields__${field.id}` as const;
    const selected = displayFilters.order_by === key || displayFilters.order_by === `-${key}`;
    return (
      <th
        key={field.id}
        className="h-11 min-w-44 border-r border-b border-subtle bg-layer-1 px-3 text-left text-body-xs-medium"
        aria-sort={selected ? (displayFilters.order_by?.startsWith("-") ? "descending" : "ascending") : "none"}
      >
        {sortable.has(field.id) ? (
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
});

export const CustomFieldCells = observer(function CustomFieldCells({
  issue,
  displayProperties,
  disabled,
  updateIssue,
}: {
  issue: TIssue;
  displayProperties: IIssueDisplayProperties;
  disabled: boolean;
  updateIssue?: (projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>;
}) {
  const { workspaceSlug, projectId } = useParams();
  // Columns belong to the viewed project; cross-project rows must keep the same table shape.
  const { fields } = useProjectCustomFields(workspaceSlug?.toString(), projectId?.toString());
  return getVisibleCustomFields(fields, displayProperties.custom_fields).map((field) => (
    <td key={field.id} tabIndex={0} className="h-11 min-w-44 border-r border-b border-subtle px-3 text-body-xs-regular">
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
  ));
});
