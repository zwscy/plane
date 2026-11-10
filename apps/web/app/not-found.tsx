/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
// ui
import { Button } from "@makeplane/propel/components/button";
import { EmptyStateDetailed } from "@plane/blocks/empty-state";
// types
import type { Route } from "./+types/not-found";
import { useTranslation } from "@plane/i18n";

export const meta: Route.MetaFunction = () => [
  { title: "404 - Page Not Found" },
  { name: "robots", content: "noindex, nofollow" },
];

function PageNotFound() {
  const { t } = useTranslation();
  return (
    <div className="h-screen w-full overflow-hidden bg-surface-1 p-4">
      <EmptyStateDetailed
        align="center"
        assetKey="error-404"
        assetClassName="size-40"
        title={t("common.ui.oops_something_went_wrong")}
        description={t(
          "common.ui.sorry_the_page_you_are_looking_for_cannot_be_found_it_may_have_been_removed_had_its_name_changed_or_is_tempora"
        )}
        customButton={
          <Button
            variant="primary"
            size="lg"
            stretch="auto"
            label={t("power_k.navigation_actions.nav_home")}
            nativeButton={false}
            render={<Link href="/" />}
          />
        }
      />
    </div>
  );
}

export default PageNotFound;
