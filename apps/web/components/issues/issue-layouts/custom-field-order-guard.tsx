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
import { EIssueLayoutTypes } from "@plane/types";
import { useIssueStoreType, useIssuesStore } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useValidCustomFieldOrder } from "@/hooks/use-valid-custom-field-order";

/** Do not mount a fetching layout until its persisted custom ordering is safe. */
export const CustomFieldOrderGuard = observer(function CustomFieldOrderGuard({ children }: { children: ReactNode }) {
  const { projectId } = useParams();
  const storeType = useIssueStoreType();
  const { issuesFilter } = useIssuesStore();
  const { updateFilters } = useIssuesActions(storeType);
  const displayFilters = issuesFilter?.issueFilters?.displayFilters;
  const allowCustomOrder =
    displayFilters?.layout === EIssueLayoutTypes.LIST || displayFilters?.layout === EIssueLayoutTypes.SPREADSHEET;
  const resetCustomOrder = useCallback(
    (orderBy: TIssueOrderByOptions) => {
      updateFilters(projectId?.toString() ?? "", EIssueFilterType.DISPLAY_FILTERS, { order_by: orderBy });
    },
    [updateFilters, projectId]
  );
  const isOrderReady = useValidCustomFieldOrder(displayFilters?.order_by, resetCustomOrder, allowCustomOrder);
  return isOrderReady ? children : null;
});
