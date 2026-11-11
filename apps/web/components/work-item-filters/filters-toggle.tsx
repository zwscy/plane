/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { EIssuesStoreType } from "@plane/types";
// components
import { FiltersToggle } from "@/components/rich-filters/filters-toggle";
import { ProjectFilterPopover } from "./project-filter-panel";
// hooks
import { useWorkItemFilters } from "@/hooks/store/work-item-filters/use-work-item-filters";

type TWorkItemFiltersToggleProps = {
  entityType: EIssuesStoreType;
  entityId: string;
};

export const WorkItemFiltersToggle = observer(function WorkItemFiltersToggle(props: TWorkItemFiltersToggleProps) {
  const { entityType, entityId } = props;
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const { getFilter } = useWorkItemFilters();
  // derived values
  const filter = getFilter(entityType, entityId);

  if (filter && workspaceSlug && projectId) {
    return (
      <ProjectFilterPopover filter={filter} workspaceSlug={workspaceSlug.toString()} projectId={projectId.toString()} />
    );
  }

  return <FiltersToggle filter={filter} />;
});
