/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EIssuesStoreType } from "@plane/types";
import { setToast } from "@plane/blocks/toast";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";

type Props = { workspaceSlug: string; projectId: string; storeType: EIssuesStoreType };

const ProjectDisplayConfigActions = observer(function ProjectDisplayConfigActions({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { issuesFilter } = useIssues(EIssuesStoreType.PROJECT);
  const { allowPermissions } = useUserPermissions();
  const following = issuesFilter.getUseProjectDefault(projectId);
  const pending = issuesFilter.getDisplayConfigPending(projectId);
  const canSave = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const handleAction = async (action: "save" | "reset") => {
    try {
      if (action === "save") await issuesFilter.saveProjectDisplayConfig(workspaceSlug, projectId);
      else await issuesFilter.resetProjectDisplayConfig(workspaceSlug, projectId);
      setToast({
        type: "success",
        title: t(
          action === "save" ? "issue.display.project_defaults.saved" : "issue.display.project_defaults.restored"
        ),
      });
    } catch {
      setToast({ type: "error", title: t("issue.display.project_defaults.failed") });
    }
  };
  return (
    <div className="mt-2 border-t border-subtle px-2 pt-3 pb-2">
      <p role="status" className="text-caption-md-regular text-secondary">
        {t(
          following === false ? "issue.display.project_defaults.personal" : "issue.display.project_defaults.following"
        )}
      </p>
      <div className="mt-2 flex flex-col items-start gap-2">
        {following === false && (
          <button
            type="button"
            data-display-action="reset"
            disabled={pending}
            onClick={() => void handleAction("reset")}
            className="rounded-sm text-body-xs-medium text-accent-primary hover:underline focus-visible:ring-2 focus-visible:ring-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("issue.display.project_defaults.restore")}
          </button>
        )}
        {canSave && (
          <button
            type="button"
            data-display-action="save"
            disabled={pending || following === undefined}
            onClick={() => void handleAction("save")}
            className="rounded-sm text-body-xs-medium text-accent-primary hover:underline focus-visible:ring-2 focus-visible:ring-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("issue.display.project_defaults.save")}
          </button>
        )}
      </div>
    </div>
  );
});

/** Both menus share actions, but only the ordinary project view can manage project defaults. */
export function ProjectDisplayConfigControls(props: Props) {
  return props.storeType === EIssuesStoreType.PROJECT ? <ProjectDisplayConfigActions {...props} /> : null;
}
