/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueActivity } from "@plane/types";

export const getRelationActivityContent = (
  activity: TIssueActivity | undefined,
  t: (key: string) => string
): string | undefined => {
  if (!activity) return;

  switch (activity.field) {
    case "blocking":
      return activity.old_value === ""
        ? t("common.ui.activity_marked_this_work_item_is_blocking_work_item") + " "
        : t("common.ui.activity_removed_the_blocking_work_item") + " ";
    case "blocked_by":
      return activity.old_value === ""
        ? t("common.ui.activity_marked_this_work_item_is_being_blocked_by") + " "
        : t("common.ui.activity_removed_this_work_item_being_blocked_by_work_item") + " ";
    case "duplicate":
      return activity.old_value === ""
        ? t("common.ui.activity_marked_this_work_item_as_duplicate_of") + " "
        : t("common.ui.activity_removed_this_work_item_as_a_duplicate_of") + " ";
    case "relates_to":
      return activity.old_value === ""
        ? t("common.ui.activity_marked_that_this_work_item_relates_to") + " "
        : t("common.ui.activity_removed_the_relation_from") + " ";
  }

  return;
};
