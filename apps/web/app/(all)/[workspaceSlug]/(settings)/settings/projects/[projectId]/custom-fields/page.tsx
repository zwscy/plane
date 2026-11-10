/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "react-router";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { ProjectCustomFieldsSettings } from "@/components/project/settings/custom-fields";
import { useUserPermissions } from "@/hooks/store/user";

export default observer(function CustomFieldsSettingsPage() {
  const { workspaceSlug, projectId } = useParams();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const allowed = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  if (workspaceUserInfo && !allowed) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  if (!allowed || !workspaceSlug || !projectId) return null;
  return (
    <SettingsContentWrapper
      header={<SettingsPageHeader leftItem={<span className="text-body-sm-medium">自定义字段</span>} />}
    >
      <PageHead title="自定义字段" />
      <ProjectCustomFieldsSettings workspaceSlug={workspaceSlug} projectId={projectId} />
    </SettingsContentWrapper>
  );
});
