/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { CalendarOutline } from "@makeplane/propel/icons";
// hooks
import { renderFormattedDate } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
// helpers

type TIssueStartDateActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueStartDateActivity = observer(function IssueStartDateActivity(props: TIssueStartDateActivity) {
  const { t, currentLocale } = useTranslation();
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<CalendarOutline width={14} height={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.new_value
          ? t("common.ui.activity_set_the_start_date_to") + " "
          : t("common.ui.activity_removed_the_start_date") + " "}
        {activity.new_value && (
          <>
            <span className="font-medium text-primary">
              {renderFormattedDate(activity.new_value, undefined, currentLocale)}
            </span>
          </>
        )}
        {showIssue &&
          (activity.new_value ? " " + t("common.ui.activity_for") + " " : " " + t("common.ui.activity_from") + " ")}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
