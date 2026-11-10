/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import type { TCustomFieldOption, TProjectCustomField } from "@plane/types";
import { useMember } from "@/hooks/store/use-member";
import { useLabel } from "@/hooks/store/use-label";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useCycle } from "@/hooks/store/use-cycle";
import { useModule } from "@/hooks/store/use-module";
import { useProjectEstimates } from "@/hooks/store/estimates";
import { getEstimatePointDisplayValue } from "@/components/dropdowns/estimate/estimate-select";

const PRIORITIES: TCustomFieldOption[] = [
  { id: "urgent", name: "紧急", is_active: true },
  { id: "high", name: "高", is_active: true },
  { id: "medium", name: "中", is_active: true },
  { id: "low", name: "低", is_active: true },
  { id: "none", name: "无优先级", is_active: true },
];
const REFERENCES = new Set(["member", "members", "labels", "state", "cycle", "modules", "estimate"]);
const option = (id: string, name: string): TCustomFieldOption => ({ id, name, is_active: true });

/** Catalogues are project scoped and shared through SWR; only the requested kind is fetched. */
export function useCustomFieldOptions(workspaceSlug: string, projectId: string, field: TProjectCustomField) {
  const members = useMember();
  const labels = useLabel();
  const states = useProjectState();
  const cycles = useCycle();
  const modules = useModule();
  const estimates = useProjectEstimates();
  const kind = field.field_type === "members" ? "member" : field.field_type;
  const { isLoading, error } = useSWR(
    workspaceSlug && projectId && REFERENCES.has(kind)
      ? ["custom-field-catalogue", workspaceSlug, projectId, kind]
      : null,
    async () => {
      switch (kind) {
        case "member":
          await members.project.fetchProjectMembers(workspaceSlug, projectId);
          break;
        case "labels":
          await labels.fetchProjectLabels(workspaceSlug, projectId);
          break;
        case "state":
          await states.fetchProjectStates(workspaceSlug, projectId);
          break;
        case "cycle":
          await cycles.fetchAllCycles(workspaceSlug, projectId);
          break;
        case "modules":
          await modules.fetchModules(workspaceSlug, projectId);
          break;
        case "estimate":
          await estimates.getProjectEstimates(workspaceSlug, projectId);
          break;
      }
      return true;
    },
    { revalidateOnFocus: false }
  );
  let options: TCustomFieldOption[] | undefined;
  switch (kind) {
    case "select":
    case "multi_select":
      options = field.options;
      break;
    case "priority":
      options = PRIORITIES;
      break;
    case "member":
      options = (members.project.getProjectMemberIds(projectId, false) ?? []).map((id) =>
        option(id, members.getUserDetails(id)?.display_name ?? "未知成员")
      );
      break;
    case "labels":
      options = (labels.getProjectLabels(projectId) ?? []).map((label) => option(label.id, label.name));
      break;
    case "state":
      options = (states.getProjectStates(projectId) ?? []).map((state) => option(state.id, state.name));
      break;
    case "cycle":
      options = (cycles.getProjectCycleDetails(projectId) ?? []).map((cycle) => option(cycle.id, cycle.name));
      break;
    case "modules":
      options = (modules.getProjectModuleDetails(projectId) ?? []).map((module) => option(module.id, module.name));
      break;
    case "estimate": {
      const activeId = estimates.currentActiveEstimateIdByProjectId(projectId);
      const estimate = activeId ? estimates.getEstimateById(activeId) : undefined;
      options = (estimate?.estimatePointIds ?? []).map((id) =>
        option(id, getEstimatePointDisplayValue(estimate, id) ?? "未知估算")
      );
      break;
    }
  }
  return { options, isLoading, error };
}
