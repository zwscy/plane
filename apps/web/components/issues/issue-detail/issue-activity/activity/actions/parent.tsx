/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { ParentOutline } from "@makeplane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssueParentActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueParentActivity = observer(function IssueParentActivity(props: TIssueParentActivity) {
  const { t } = useTranslation();
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<ParentOutline className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.new_value
          ? t("common.ui.activity_set_the_parent_to") + " "
          : t("common.ui.activity_removed_the_parent") + " "}
        {activity.new_value ? (
          <span className="font-medium text-primary">{activity.new_value}</span>
        ) : (
          <span className="font-medium text-primary">{activity.old_value}</span>
        )}
        {showIssue &&
          (activity.new_value ? " " + t("common.ui.activity_for") + " " : " " + t("common.ui.activity_from") + " ")}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
