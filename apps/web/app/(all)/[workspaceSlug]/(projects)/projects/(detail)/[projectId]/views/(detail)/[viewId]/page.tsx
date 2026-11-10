/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { EmptyStateDetailed } from "@plane/blocks/empty-state";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectViewLayoutRoot } from "@/components/issues/issue-layouts/roots/project-view-layout-root";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useProjectView } from "@/hooks/store/use-project-view";
import { useAppRouter } from "@/hooks/use-app-router";
import type { Route } from "./+types/page";
import { useTranslation } from "@plane/i18n";

function ProjectViewIssuesPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  // router
  const router = useAppRouter();
  const { workspaceSlug, projectId, viewId } = params;
  // store hooks
  const { fetchViewDetails, getViewById } = useProjectView();
  const { getProjectById } = useProject();
  // derived values
  const projectView = getViewById(viewId);
  const project = getProjectById(projectId);
  const pageTitle = project?.name && projectView?.name ? `${project?.name} - ${projectView?.name}` : undefined;

  const { error } = useSWR(`VIEW_DETAILS_${viewId}`, () => fetchViewDetails(workspaceSlug, projectId, viewId));

  if (error) {
    return (
      <EmptyStateDetailed
        align="center"
        assetKey="view"
        assetClassName="size-40"
        title={t("common.ui.view_does_not_exist")}
        description={t("common.ui.the_view_you_are_looking_for_does_not_exist_or_you_don_t_have_permission_to_view_it")}
        actions={[
          {
            label: t("common.ui.view_other_views"),
            variant: "primary",
            onClick: () => router.push(`/${workspaceSlug}/projects/${projectId}/views`),
          },
        ]}
      />
    );
  }

  return (
    <>
      <PageHead title={pageTitle} />
      <ProjectViewLayoutRoot />
    </>
  );
}

export default observer(ProjectViewIssuesPage);
