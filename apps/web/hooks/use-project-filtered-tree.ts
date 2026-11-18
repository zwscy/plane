/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { EIssueServiceType, EIssuesStoreType } from "@plane/types";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useOrderedSubIssues } from "@/hooks/use-ordered-sub-issues";

export const useProjectFilteredTree = () => {
  const { projectId } = useParams();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(EIssuesStoreType.PROJECT);
  const tree = issues.filteredTree;
  return storeType === EIssuesStoreType.PROJECT && tree?.projectId === projectId?.toString() ? tree : undefined;
};

/** A new result opens its paths again. Manual collapse during filtering is local to that result. */
export const useFilteredTreeCollapse = (version?: number) => {
  const [collapsedVersion, setCollapsedVersion] = useState<number>();
  return {
    isCollapsed: version !== undefined && collapsedVersion === version,
    toggle: () => setCollapsedVersion((previous) => (previous === version ? undefined : version)),
  };
};

export const useIssueTreeRow = (issueId: string, isEpic: boolean) => {
  const [expanded, setExpanded] = useState(false);
  const projectTree = useProjectFilteredTree();
  const tree = isEpic ? undefined : projectTree;
  const collapse = useFilteredTreeCollapse(tree?.version);
  const { subIssues } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  useOrderedSubIssues(issueId, !tree && expanded, isEpic);

  const children = tree ? tree.childrenByParent[issueId] : subIssues.subIssuesByIssueId(issueId);
  return {
    children,
    isExpanded: tree ? !!children?.length && !collapse.isCollapsed : expanded,
    toggleExpanded: tree ? collapse.toggle : () => setExpanded((previous) => !previous),
    filteredChildCount: tree ? (children?.length ?? 0) : undefined,
    isFilterContext: tree?.contextIds.has(issueId) ?? false,
  };
};
