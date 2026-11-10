/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { EmptyStateDetailed } from "@plane/blocks/empty-state";
import { cn } from "@plane/utils";
// layouts
import DefaultLayout from "@/layouts/default-layout";
import { useTranslation } from "@plane/i18n";

type Props = {
  actionButton?: React.ReactNode;
  /** @deprecated Every section now shares the same no-access illustration; kept so callers need no change. */
  section?: "settings" | "general";
  /** @deprecated Every section now shares the same no-access illustration; kept so callers need no change. */
  isProjectView?: boolean;
  className?: string;
};

export const NotAuthorizedView = observer(function NotAuthorizedView(props: Props) {
  const { t } = useTranslation();
  const { actionButton, className } = props;

  return (
    <DefaultLayout className={cn("bg-surface-1", className)}>
      <EmptyStateDetailed
        align="center"
        assetKey="no-access"
        assetClassName="size-40"
        title={t("common.ui.oops_you_are_not_authorized_to_view_this_page")}
        customButton={actionButton}
      />
    </DefaultLayout>
  );
});
