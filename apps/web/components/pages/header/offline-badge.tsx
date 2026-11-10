/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { Badge } from "@makeplane/propel/components/badge";
import { Icon } from "@makeplane/propel/components/icon";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { WebDisabledOutline } from "@makeplane/propel/icons";
// hooks
import useOnlineStatus from "@/hooks/use-online-status";
// store
import type { TPageInstance } from "@/store/pages/base-page";
import { useTranslation } from "@plane/i18n";

type Props = {
  page: TPageInstance;
};

export const PageOfflineBadge = observer(function PageOfflineBadge({ page }: Props) {
  const { t } = useTranslation();
  // use online status
  const { isOnline } = useOnlineStatus();

  if (!page.isContentEditable || isOnline) return null;

  return (
    <Tooltip
      label={t(
        "common.ui.you_are_offline_you_can_continue_making_changes_they_will_be_synced_when_you_are_back_online"
      )}
      layout="stacked"
    >
      <Badge
        variant="neutral"
        size="sm"
        startIcon={<Icon icon={WebDisabledOutline} />}
        label={t("common.ui.offline")}
      />
    </Tooltip>
  );
});
