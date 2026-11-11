/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { IWorkItemFilterInstance } from "@plane/shared-state";
import type { TWorkItemFilterExpression, TWorkItemFilterProperty } from "@plane/types";
// components
import type { TFiltersRowProps } from "@/components/rich-filters/filters-row";
import { FiltersRow } from "@/components/rich-filters/filters-row";
import { ProjectFiltersSummaryRow } from "./project-filter-panel";

type TWorkItemFiltersRowProps = TFiltersRowProps<TWorkItemFilterProperty, TWorkItemFilterExpression> & {
  filter: IWorkItemFilterInstance;
};

export const WorkItemFiltersRow = observer(function WorkItemFiltersRow(props: TWorkItemFiltersRowProps) {
  const { workspaceSlug, projectId } = useParams();
  if (workspaceSlug && projectId) {
    return (
      <ProjectFiltersSummaryRow
        filter={props.filter}
        workspaceSlug={workspaceSlug.toString()}
        projectId={projectId.toString()}
        variant={props.variant}
        disabled={props.disabledAllOperations}
      />
    );
  }
  return <FiltersRow {...props} />;
});
