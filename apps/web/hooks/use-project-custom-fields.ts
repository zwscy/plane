/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { sortBy } from "lodash-es";
import useSWR from "swr";
import { ProjectCustomFieldService } from "@plane/services";

export const projectCustomFieldService = new ProjectCustomFieldService();

export function useProjectCustomFields(workspaceSlug?: string, projectId?: string | null) {
  const { data, isLoading, error, mutate } = useSWR(
    workspaceSlug && projectId ? ["project-custom-fields", workspaceSlug, projectId] : null,
    () => projectCustomFieldService.list(workspaceSlug!, projectId!)
  );
  return {
    fields: sortBy(data ?? [], ["sort_order", "id"]),
    isLoading,
    error,
    mutate,
  };
}
