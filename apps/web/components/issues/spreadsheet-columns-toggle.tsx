/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { observer } from "mobx-react";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { InputField } from "@makeplane/propel/components/input-field";
import { Popover, PopoverContent, PopoverTrigger } from "@makeplane/propel/components/popover";
import {
  ChevronDownOutline,
  ChevronUpOutline,
  GripOutline,
  PreferencesOutline,
  SearchOutline,
} from "@makeplane/propel/icons";
import { DragHandle, Sortable } from "@plane/blocks/common";
import { SPREADSHEET_PROPERTY_DETAILS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayProperties } from "@plane/types";
import { getVisibleCustomFields } from "@/helpers/custom-field-views";
import {
  getOrderedSpreadsheetColumnKeys,
  moveSpreadsheetColumn,
  reorderVisibleSpreadsheetColumns,
} from "@/helpers/spreadsheet-columns";
import { useProjectCustomFields } from "@/hooks/use-project-custom-fields";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { ProjectDisplayConfigControls } from "./project-display-config-controls";
import { SpreadSheetPropertyIcon } from "./issue-layouts/utils";

type TColumnOption = {
  key: string;
  label: string;
  icon: string | undefined;
};

type Props = {
  /** The spreadsheet's built-in columns, already narrowed to the ones this project can show. */
  columns: (keyof IIssueDisplayProperties)[];
  displayProperties: IIssueDisplayProperties;
  handleDisplayPropertiesUpdate: (properties: Partial<IIssueDisplayProperties>) => void;
  isEstimateEnabled: boolean;
  isEpic?: boolean;
};

export const SpreadsheetColumnsToggle = observer(function SpreadsheetColumnsToggle(props: Props) {
  const { columns, displayProperties, handleDisplayPropertiesUpdate, isEstimateEnabled, isEpic = false } = props;
  const { t } = useTranslation();
  const { workspaceSlug, projectId } = useParams();
  const storeType = useIssueStoreType();
  const [searchQuery, setSearchQuery] = useState("");
  const searchTerm = searchQuery.trim().toLowerCase();
  const { fields, isLoading, error } = useProjectCustomFields(
    workspaceSlug?.toString(),
    isEpic ? undefined : projectId?.toString()
  );
  const customFields = getVisibleCustomFields(fields);
  const orderDisabled = !!searchTerm || (!!projectId && !isEpic && (isLoading || !!error));

  const options: TColumnOption[] = columns
    .filter((key) => key !== "custom_fields" && key !== "column_order" && (key !== "estimate" || isEstimateEnabled))
    .map((key) => {
      const details = SPREADSHEET_PROPERTY_DETAILS[key];
      const label =
        key === "sub_issue_count" && isEpic ? t("issue.label", { count: 2 }) : details ? t(details.i18n_title) : key;
      return { key, label, icon: details?.icon };
    });
  options.push(
    ...customFields.map((field) => ({ key: `custom_fields__${field.id}`, label: field.name, icon: undefined }))
  );
  const columnKeys = getOrderedSpreadsheetColumnKeys(
    options.map((option) => option.key),
    displayProperties.column_order
  );
  const optionsByKey = new Map(options.map((option) => [option.key, option]));
  const orderedOptions = columnKeys.map((key) => optionsByKey.get(key)!);
  const isVisible = (key: string) =>
    key.startsWith("custom_fields__")
      ? displayProperties.custom_fields?.[key.slice("custom_fields__".length)] !== false
      : !!displayProperties[key as keyof IIssueDisplayProperties];
  const shownOptions = orderedOptions.filter((option) => isVisible(option.key));
  const hiddenOptions = orderedOptions.filter((option) => !isVisible(option.key));
  const matchesSearch = (option: TColumnOption) => option.label.toLowerCase().includes(searchTerm);
  const filteredShownOptions = shownOptions.filter(matchesSearch);
  const filteredHiddenOptions = hiddenOptions.filter(matchesSearch);

  const handleVisibilityChange = (key: string, visible: boolean) => {
    if (key.startsWith("custom_fields__")) {
      handleDisplayPropertiesUpdate({
        custom_fields: { ...displayProperties.custom_fields, [key.slice("custom_fields__".length)]: visible },
      });
    } else {
      handleDisplayPropertiesUpdate({ [key]: visible });
    }
  };
  const handleOrderChange = (reorderedShownKeys: string[]) => {
    if (!orderDisabled)
      handleDisplayPropertiesUpdate({
        column_order: reorderVisibleSpreadsheetColumns(columnKeys, reorderedShownKeys),
      });
  };
  const moveColumn = (key: string, direction: -1 | 1) =>
    handleOrderChange(
      moveSpreadsheetColumn(
        shownOptions.map((option) => option.key),
        key,
        direction
      )
    );
  const renderCheckbox = (option: TColumnOption) => (
    <div className="min-w-0 flex-1 overflow-hidden">
      <Checkbox
        checked={isVisible(option.key)}
        onCheckedChange={(checked) => handleVisibilityChange(option.key, checked)}
        label={option.label}
        stretch="full"
        icon={
          option.icon ? (
            <SpreadSheetPropertyIcon iconKey={option.icon} className="size-4 shrink-0 text-secondary" />
          ) : undefined
        }
      />
    </div>
  );
  const renderShownOption = (option: TColumnOption, index: number) => (
    <div data-column-key={option.key} className="flex min-h-9 items-center gap-1 rounded-md bg-accent-subtle px-1">
      <span data-column-drag-handle>
        <DragHandle disabled={orderDisabled} />
      </span>
      {renderCheckbox(option)}
      <button
        type="button"
        aria-label={t("issue.display.columns.move_up", { name: option.label })}
        disabled={orderDisabled || index === 0}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-secondary hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong disabled:cursor-not-allowed disabled:opacity-30"
        onClick={() => moveColumn(option.key, -1)}
      >
        <ChevronUpOutline className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={t("issue.display.columns.move_down", { name: option.label })}
        disabled={orderDisabled || index === shownOptions.length - 1}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-secondary hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong disabled:cursor-not-allowed disabled:opacity-30"
        onClick={() => moveColumn(option.key, 1)}
      >
        <ChevronDownOutline className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <Popover onOpenChange={(open) => !open && setSearchQuery("")}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("issue.display.columns.title")}
            className="grid size-7 place-items-center rounded-md text-secondary hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        }
      >
        <PreferencesOutline className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent variant="rich" side="bottom" align="end" positionMethod="fixed">
        <div className="w-80 max-w-[calc(100vw-3rem)]">
          <h3 className="text-body-sm-medium text-primary">{t("issue.display.columns.title")}</h3>
          <p className="mt-1 mb-3 text-caption-md-regular whitespace-normal text-secondary">
            {t("issue.display.columns.description")}
          </p>
          <InputField
            size="lg"
            orientation="vertical"
            type="search"
            aria-label={t("issue.display.columns.search")}
            placeholder={t("issue.display.columns.search")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            startIcon={<SearchOutline className="size-4" aria-hidden="true" />}
          />
          {!!searchTerm && (
            <p className="mt-2 text-caption-md-regular whitespace-normal text-secondary">
              {t("issue.display.columns.clear_search_to_reorder")}
            </p>
          )}
          <div className="mt-3 max-h-80 overflow-y-auto" aria-label={t("issue.display.columns.title")}>
            <section aria-label={t("issue.display.columns.shown")}>
              <h4 className="mb-2 text-caption-md-medium text-secondary">{t("issue.display.columns.shown")}</h4>
              <div className="space-y-1">
                {filteredShownOptions.length === 0 ? (
                  <p className="px-1 py-2 text-caption-md-regular text-placeholder">
                    {searchTerm ? t("no_matching_results") : t("issue.display.columns.empty_shown")}
                  </p>
                ) : orderDisabled ? (
                  filteredShownOptions.map((option, index) => (
                    <div key={option.key}>{renderShownOption(option, index)}</div>
                  ))
                ) : (
                  <Sortable
                    data={shownOptions}
                    dragHandleSelector="[data-column-drag-handle] button"
                    renderDragPreview={(option) => (
                      <div className="flex h-9 items-center gap-2 overflow-hidden rounded-md border border-subtle bg-surface-1 px-2 text-body-xs-regular text-primary">
                        <GripOutline className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />
                        {option.icon && (
                          <SpreadSheetPropertyIcon iconKey={option.icon} className="size-4 shrink-0 text-secondary" />
                        )}
                        <span className="truncate">{option.label}</span>
                      </div>
                    )}
                    keyExtractor={(option) => option.key}
                    onChange={(nextOptions) => handleOrderChange(nextOptions.map((option) => option.key))}
                    render={renderShownOption}
                  />
                )}
              </div>
            </section>
            <hr className="my-3 border-subtle" />
            <section aria-label={t("issue.display.columns.hidden")}>
              <h4 className="mb-2 text-caption-md-medium text-secondary">{t("issue.display.columns.hidden")}</h4>
              <div className="space-y-1">
                {filteredHiddenOptions.length === 0 ? (
                  <p className="px-1 py-2 text-caption-md-regular text-placeholder">
                    {searchTerm ? t("no_matching_results") : t("issue.display.columns.empty_hidden")}
                  </p>
                ) : (
                  filteredHiddenOptions.map((option) => (
                    <div
                      key={option.key}
                      data-column-key={option.key}
                      className="flex min-h-9 items-center rounded-md px-1 hover:bg-layer-transparent-hover"
                    >
                      {renderCheckbox(option)}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          {workspaceSlug && projectId && !isEpic && (
            <ProjectDisplayConfigControls
              workspaceSlug={workspaceSlug.toString()}
              projectId={projectId.toString()}
              storeType={storeType}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
