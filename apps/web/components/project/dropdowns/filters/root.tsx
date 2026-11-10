/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { MenuCheckboxItem, MenuSeparator } from "@makeplane/propel/components/menu";
import { PROJECT_CREATED_AT_FILTER_OPTIONS } from "@plane/constants";
import type { TProjectDisplayFilters, TProjectFilters } from "@plane/types";
// components
import { DateFilterSubmenu, isCustomDateFilterValue } from "@/components/common/filters/date-filter-submenu";
import { MemberFilterSubmenu } from "@/components/common/filters/member-filter-submenu";
// local imports
import { FilterAccess } from "./access";
import { useTranslation } from "@plane/i18n";

type Props = {
  displayFilters: TProjectDisplayFilters;
  filters: TProjectFilters;
  handleFiltersUpdate: (key: keyof TProjectFilters, value: string | string[]) => void;
  handleDisplayFiltersUpdate: (updatedDisplayProperties: Partial<TProjectDisplayFilters>) => void;
  memberIds?: string[] | undefined;
};

export const ProjectFiltersSelection = observer(function ProjectFiltersSelection(props: Props) {
  const { t } = useTranslation();
  const { displayFilters, filters, handleFiltersUpdate, handleDisplayFiltersUpdate, memberIds } = props;

  return (
    <>
      <MenuCheckboxItem
        label={t("workspace_projects.scope.my_projects")}
        checked={!!displayFilters.my_projects}
        onCheckedChange={(checked) => handleDisplayFiltersUpdate({ my_projects: checked })}
      />

      <MenuSeparator />

      {/* access */}
      <FilterAccess
        appliedFilters={filters.access ?? null}
        handleUpdate={(val) => handleFiltersUpdate("access", val)}
      />

      {/* lead */}
      <MemberFilterSubmenu
        label={t("lead")}
        memberIds={memberIds}
        appliedFilters={filters.lead}
        onToggle={(val) => handleFiltersUpdate("lead", val)}
      />

      {/* members */}
      <MemberFilterSubmenu
        label={t("common.members")}
        memberIds={memberIds}
        appliedFilters={filters.members}
        onToggle={(val) => handleFiltersUpdate("members", val)}
      />

      {/* created date */}
      <DateFilterSubmenu
        label={t("workspace_projects.sort.created_at")}
        options={PROJECT_CREATED_AT_FILTER_OPTIONS}
        appliedFilters={filters.created_at}
        onToggleOption={(val) => handleFiltersUpdate("created_at", val)}
        onSelectCustomRange={(val) => handleFiltersUpdate("created_at", val)}
        onClearCustomRange={() =>
          handleFiltersUpdate("created_at", (filters.created_at ?? []).filter(isCustomDateFilterValue))
        }
      />
    </>
  );
});
