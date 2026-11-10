/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { PriorityOutline } from "@makeplane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssuePriorityActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssuePriorityActivity = observer(function IssuePriorityActivity(props: TIssuePriorityActivity) {
  const { t, currentLocale } = useTranslation();
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  const priority =
    currentLocale === "zh-CN" &&
    activity.new_value &&
    ["urgent", "high", "medium", "low", "none"].includes(activity.new_value.toLowerCase())
      ? t(activity.new_value.toLowerCase() === "none" ? "none" : `issue.priority.${activity.new_value.toLowerCase()}`)
      : activity.new_value;
  return (
    <IssueActivityBlockComponent
      icon={<PriorityOutline className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {t("common.ui.activity_set_the_priority_to") + " "}
        <span className="font-medium text-primary">{priority}</span>
        {showIssue ? " " + t("common.ui.activity_for") + " " : ``}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
