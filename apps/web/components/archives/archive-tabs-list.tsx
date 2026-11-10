/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Tab, Tabs, TabsList } from "@makeplane/propel/components/tabs";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
// types
import type { IProject } from "@plane/types";
// hooks
import { useProject } from "@/hooks/store/use-project";

const ARCHIVES_TAB_LIST: {
  key: string;
  label: string;
  shouldRender: (projectDetails: IProject) => boolean;
}[] = [
  {
    key: "issues",
    label: "work_items",
    shouldRender: () => true,
  },
  {
    key: "cycles",
    label: "cycles",
    shouldRender: (projectDetails) => projectDetails.cycle_view,
  },
  {
    key: "modules",
    label: "modules",
    shouldRender: (projectDetails) => projectDetails.module_view,
  },
];

export const ArchiveTabsList = observer(function ArchiveTabsList() {
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();
  const pathname = usePathname();
  // store hooks
  const { getProjectById } = useProject();

  // derived values
  if (!projectId) return null;
  const projectDetails = getProjectById(projectId?.toString());
  if (!projectDetails) return null;

  const activeTab = ARCHIVES_TAB_LIST.find((tab) => pathname.includes(`/archives/${tab.key}`))?.key;

  return (
    <Tabs variant="underline" value={activeTab}>
      {/* Bottom-aligned so the active bar sits on the header's bottom rule. */}
      <div className="flex self-stretch pt-2.5">
        <TabsList>
          {ARCHIVES_TAB_LIST.map(
            (tab) =>
              tab.shouldRender(projectDetails) && (
                <Tab
                  key={tab.key}
                  value={tab.key}
                  label={t(tab.label)}
                  nativeButton={false}
                  render={<Link href={`/${workspaceSlug}/projects/${projectId}/archives/${tab.key}`} />}
                />
              )
          )}
        </TabsList>
      </div>
    </Tabs>
  );
});
