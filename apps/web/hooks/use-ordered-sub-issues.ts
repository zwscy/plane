/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { EIssueServiceType } from "@plane/types";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";

/** Fetch each expanded sibling set with the current view order without changing its parent. */
export const useOrderedSubIssues = (issueId: string, expanded: boolean, isEpic = false) => {
  const { workspaceSlug } = useParams();
  const { subIssues } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { issueMap, issuesFilter } = useIssuesStore();
  const projectId = issueMap[issueId]?.project_id;
  const orderBy = issuesFilter.issueFilters?.displayFilters?.order_by;
  useEffect(() => {
    if (!expanded || isEpic || !workspaceSlug || !projectId) return;
    void subIssues.fetchSubIssues(workspaceSlug.toString(), projectId, issueId, orderBy).catch(console.error);
  }, [expanded, isEpic, workspaceSlug, projectId, issueId, orderBy, subIssues]);
};
