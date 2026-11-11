/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Icon } from "@makeplane/propel/components/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { Popover, PopoverBody, PopoverContent, PopoverTrigger } from "@makeplane/propel/components/popover";
import {
  ChevronDownOutline,
  EraserOutline,
  SortAscendingOutline,
  SortDescendingOutline,
} from "@makeplane/propel/icons";
import { SelectTriggerChrome } from "@plane/blocks/select";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, TIssue, TProjectCustomField } from "@plane/types";
import { CustomFieldEditor, CustomFieldValue } from "@/components/issues/custom-fields";
import { parseCustomFieldInput } from "@/components/issues/custom-fields/helpers";
import { CustomFieldTypeIcon } from "@/components/issues/custom-fields/type-icon";
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
  const headerRef = useRef<HTMLTableCellElement | null>(null);
  const key = `custom_fields__${field.id}` as const;
  const selected = displayFilters.order_by === key || displayFilters.order_by === `-${key}`;
  const sortable = getSortableCustomFields([field]).length > 0;
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      <CustomFieldTypeIcon type={field.field_type} icon={field.icon} className="h-4 w-4 shrink-0 text-placeholder" />
      <span className="truncate">{field.name}</span>
    </span>
  );
  return (
    <th
      ref={headerRef}
      tabIndex={0}
      className="h-11 min-w-36 border-r-[0.5px] border-b-[0.5px] border-subtle bg-layer-1 px-page-x py-1 text-left text-body-xs-regular text-secondary"
      aria-sort={selected ? (displayFilters.order_by?.startsWith("-") ? "descending" : "ascending") : "none"}
    >
      {sortable ? (
        <Menu onOpenChange={(open) => !open && headerRef.current?.focus()}>
          <MenuTrigger
            render={
              <button
                type="button"
                tabIndex={-1}
                className="clickable flex w-full items-center justify-between gap-1.5 py-2 text-left hover:text-primary"
              />
            }
          >
            {label}
            <span className="ml-3 flex shrink-0 items-center gap-1">
              {selected &&
                (displayFilters.order_by?.startsWith("-") ? (
                  <SortAscendingOutline className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <SortDescendingOutline className="h-3 w-3" aria-hidden="true" />
                ))}
              <ChevronDownOutline className="h-3 w-3" aria-hidden="true" />
            </span>
          </MenuTrigger>
          <MenuContent side="bottom" align="start">
            <MenuItem
              icon={<Icon icon={SortDescendingOutline} />}
              label={t("common.order_by.asc")}
              selected={displayFilters.order_by === key}
              onClick={() => onChange({ order_by: key })}
            />
            <MenuItem
              icon={<Icon icon={SortAscendingOutline} />}
              label={t("common.order_by.desc")}
              selected={displayFilters.order_by === `-${key}`}
              onClick={() => onChange({ order_by: `-${key}` })}
            />
            {selected && (
              <MenuItem
                icon={<Icon icon={EraserOutline} />}
                label={t("common.actions.clear_sorting")}
                onClick={() => onChange({ order_by: "sort_order" })}
              />
            )}
          </MenuContent>
        </Menu>
      ) : (
        label
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
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savingRef = useRef(false);
  const closeAfterSaveRef = useRef(false);
  const closeFrameRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(
    () => () => {
      if (closeFrameRef.current !== null) cancelAnimationFrame(closeFrameRef.current);
    },
    []
  );
  const isDisabled = disabled || !updateIssue;
  const trigger = (
    <SelectTriggerChrome
      variant="table-cell"
      className="clickable h-11 min-w-0 text-body-xs-regular"
      aria-label={field.name}
      tabIndex={-1}
      disabled={isDisabled}
      isActive={isOpen}
    >
      <span className="min-w-0 flex-1 text-left">
        <CustomFieldValue
          workspaceSlug={workspaceSlug?.toString() ?? ""}
          projectId={issue.project_id ?? ""}
          field={field}
          value={issue.custom_fields?.[field.id] ?? null}
          compact
        />
      </span>
    </SelectTriggerChrome>
  );
  return (
    <td
      ref={cellRef}
      tabIndex={0}
      className="h-11 min-w-36 border-r-[0.5px] border-b-[0.5px] border-subtle text-body-xs-regular"
    >
      {issue.project_id === projectId &&
        (isDisabled ? (
          trigger
        ) : (
          <Popover
            open={isOpen}
            onOpenChange={(open, details) => {
              if (closeFrameRef.current !== null) {
                cancelAnimationFrame(closeFrameRef.current);
                closeFrameRef.current = null;
              }
              if (open) {
                closeAfterSaveRef.current = false;
                setIsOpen(true);
                return;
              }
              if (details.reason === "escape-key") {
                if (savingRef.current) {
                  closeAfterSaveRef.current = true;
                  details.cancel();
                  return;
                }
                closeAfterSaveRef.current = false;
                setIsOpen(false);
                return;
              }
              details.cancel();
              closeAfterSaveRef.current = true;
              if (!savingRef.current) {
                const activeElement = editorRef.current?.ownerDocument.activeElement;
                if (activeElement instanceof HTMLElement && editorRef.current?.contains(activeElement))
                  activeElement.blur();
              }
              // Native dismissal can precede React's delegated blur. Let its commit run first.
              closeFrameRef.current = requestAnimationFrame(() => {
                closeFrameRef.current = null;
                if (!closeAfterSaveRef.current || savingRef.current) return;
                closeAfterSaveRef.current = false;
                const input = editorRef.current?.querySelector<HTMLInputElement>("input");
                if (
                  input &&
                  (!input.validity.valid || parseCustomFieldInput(field.field_type, input.value) === undefined)
                )
                  return;
                setIsOpen(false);
              });
            }}
          >
            <PopoverTrigger render={trigger} />
            <PopoverContent
              variant="rich"
              side="bottom"
              align="start"
              positionMethod="fixed"
              aria-label={field.name}
              finalFocus={cellRef}
            >
              <PopoverBody>
                {isOpen && (
                  <div ref={editorRef} className="w-64 min-w-0">
                    <CustomFieldEditor
                      workspaceSlug={workspaceSlug?.toString() ?? ""}
                      projectId={issue.project_id ?? ""}
                      field={field}
                      value={issue.custom_fields?.[field.id] ?? null}
                      onChange={async (value) => {
                        savingRef.current = true;
                        try {
                          await updateIssue?.(issue.project_id, issue.id, { custom_fields: { [field.id]: value } });
                          if (closeAfterSaveRef.current) setIsOpen(false);
                        } finally {
                          savingRef.current = false;
                          closeAfterSaveRef.current = false;
                        }
                      }}
                      disabled={isDisabled}
                      compact
                    />
                  </div>
                )}
              </PopoverBody>
            </PopoverContent>
          </Popover>
        ))}
    </td>
  );
});
