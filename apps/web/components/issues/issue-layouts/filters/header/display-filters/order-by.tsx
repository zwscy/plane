/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import { useProjectCustomFields } from "@/hooks/use-project-custom-fields";
import { getSortableCustomFields } from "@/helpers/custom-field-views";
import { observer } from "mobx-react";
import {
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuContent,
  MenuSubmenuTrigger,
} from "@makeplane/propel/components/menu";
import { ISSUE_ORDER_BY_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssueOrderByOptions } from "@plane/types";
// local imports
import { DisplayFilterCurrentValue } from "./current-value";

type Props = {
  selectedOrderBy: TIssueOrderByOptions | undefined;
  handleUpdate: (val: TIssueOrderByOptions) => void;
  orderByOptions: TIssueOrderByOptions[];
  isEpic?: boolean;
  allowCustomFields?: boolean;
};

/** Manual ordering is a position, not a sortable field, so it has no direction. */
const MANUAL_ORDER_BY: TIssueOrderByOptions = "sort_order";

// An order-by key is a field plus an optional leading `-` for descending.
const getOrderByField = (orderBy: TIssueOrderByOptions) => (orderBy.startsWith("-") ? orderBy.slice(1) : orderBy);
const isDescendingOrderBy = (orderBy: TIssueOrderByOptions) => orderBy.startsWith("-");

export const FilterOrderBy = observer(function FilterOrderBy(props: Props) {
  const { selectedOrderBy, handleUpdate, orderByOptions, isEpic = false, allowCustomFields = true } = props;
  // hooks
  const { t } = useTranslation();
  const { workspaceSlug, projectId } = useParams();
  const { fields } = useProjectCustomFields(
    workspaceSlug?.toString(),
    isEpic || !allowCustomFields ? undefined : projectId?.toString()
  );

  const activeOrderBy = selectedOrderBy ?? "-created_at";
  const activeField = getOrderByField(activeOrderBy);
  const isDescending = isDescendingOrderBy(activeOrderBy);
  const isManual = activeOrderBy === MANUAL_ORDER_BY;

  const options = [
    ...ISSUE_ORDER_BY_OPTIONS.filter((option) => orderByOptions.includes(option.key)).map((option) => ({
      key: option.key as TIssueOrderByOptions,
      label: t(option.titleTranslationKey),
    })),
    ...getSortableCustomFields(fields).map((field) => ({
      key: `custom_fields__${field.id}` as TIssueOrderByOptions,
      label: field.name,
    })),
  ];
  const selectedOption = options.find((option) => getOrderByField(option.key) === activeField);

  const handleFieldChange = (field: string) => {
    const option = options.find((o) => getOrderByField(o.key) === field);
    if (!option) return;
    // coming from manual ordering there is no direction to keep, so the field's default applies
    if (option.key === MANUAL_ORDER_BY || isManual) {
      handleUpdate(option.key);
      return;
    }
    handleUpdate((isDescending ? `-${field}` : field) as TIssueOrderByOptions);
  };

  const handleDirectionChange = (direction: string) => {
    handleUpdate((direction === "desc" ? `-${activeField}` : activeField) as TIssueOrderByOptions);
  };

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger
        label={t("common.order_by.label")}
        trailing={selectedOption && <DisplayFilterCurrentValue>{selectedOption.label}</DisplayFilterCurrentValue>}
      />
      <MenuSubmenuContent>
        <MenuRadioGroup value={activeField} onValueChange={(value: string) => handleFieldChange(value)}>
          {options.map((orderBy) => (
            <MenuRadioItem key={orderBy.key} value={getOrderByField(orderBy.key)} label={orderBy.label} />
          ))}
        </MenuRadioGroup>
        {!isManual && (
          <>
            <MenuSeparator />
            <MenuRadioGroup
              value={isDescending ? "desc" : "asc"}
              onValueChange={(value: string) => handleDirectionChange(value)}
            >
              <MenuRadioItem value="asc" label={t("common.order_by.asc")} />
              <MenuRadioItem value="desc" label={t("common.order_by.desc")} />
            </MenuRadioGroup>
          </>
        )}
      </MenuSubmenuContent>
    </MenuSubmenu>
  );
});
