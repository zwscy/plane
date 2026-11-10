/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EIssueFilterType } from "@plane/constants";
import type { TIssueOrderByOptions } from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType, useIssuesStore } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useValidCustomFieldOrder } from "@/hooks/use-valid-custom-field-order";

/** Do not mount a fetching layout until its persisted custom ordering is safe. */
export const CustomFieldOrderGuard = observer(function CustomFieldOrderGuard({ children }: { children: ReactNode }) {
  const { workspaceSlug, projectId } = useParams();
  const storeType = useIssueStoreType();
  const { issuesFilter } = useIssuesStore();
  const { issuesFilter: projectIssuesFilter } = useIssues(EIssuesStoreType.PROJECT);
  const following =
    storeType === EIssuesStoreType.PROJECT &&
    !!projectId &&
    projectIssuesFilter.getUseProjectDefault(projectId.toString());
  const { updateFilters } = useIssuesActions(storeType);
  const displayFilters = issuesFilter?.issueFilters?.displayFilters;
  const allowCustomOrder =
    displayFilters?.layout === EIssueLayoutTypes.LIST || displayFilters?.layout === EIssueLayoutTypes.SPREADSHEET;
  const resetCustomOrder = useCallback(
    (orderBy: TIssueOrderByOptions) => {
      if (following && workspaceSlug && projectId) {
        // The API resolves invalid shared sorts without creating a personal override.
        // A failed refresh keeps the unsafe layout blocked until the next retry.
        void projectIssuesFilter.fetchFilters(workspaceSlug.toString(), projectId.toString()).catch(() => {});
        return;
      }
      updateFilters(projectId?.toString() ?? "", EIssueFilterType.DISPLAY_FILTERS, { order_by: orderBy });
    },
    [following, workspaceSlug, projectId, projectIssuesFilter, updateFilters]
  );
  const isOrderReady = useValidCustomFieldOrder(displayFilters?.order_by, resetCustomOrder, allowCustomOrder);
  return isOrderReady ? children : null;
});
