/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useParams } from "next/navigation";
import type { TIssueOrderByOptions } from "@plane/types";
import { isCustomFieldOrderBy, isCustomFieldOrderValid } from "@/helpers/custom-field-views";
import { useProjectCustomFields } from "@/hooks/use-project-custom-fields";

/** Recover saved sorts when the field or current layout no longer supports custom ordering. */
export const useValidCustomFieldOrder = (
  orderBy: TIssueOrderByOptions | undefined,
  onChange: (orderBy: TIssueOrderByOptions) => void,
  allowCustomOrder = true
) => {
  const { workspaceSlug, projectId } = useParams();
  const isCustom = !!projectId && isCustomFieldOrderBy(orderBy);
  const { fields, isLoading, error } = useProjectCustomFields(
    workspaceSlug?.toString(),
    isCustom && allowCustomOrder ? projectId?.toString() : undefined
  );
  const valid = !isCustom || (allowCustomOrder && isCustomFieldOrderValid(fields, orderBy));
  useEffect(() => {
    if (isCustom && (!allowCustomOrder || (!isLoading && !error && !valid))) onChange("sort_order");
  }, [isCustom, allowCustomOrder, isLoading, error, valid, onChange]);
  return !isCustom || (!isLoading && valid);
};
