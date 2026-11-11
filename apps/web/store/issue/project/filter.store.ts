/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty, isEqual, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction, toJS } from "mobx";
// base class
import { computedFn } from "mobx-utils";
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import { EIssueFilterType } from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  IProjectDisplayConfig,
  IProjectUserPropertiesResponse,
  TIssueKanbanFilters,
  IIssueFilters,
  TIssueParams,
  IssuePaginationOptions,
  TWorkItemFilterExpression,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
import { isCustomFieldOrderBy } from "@/helpers/custom-field-views";
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// helpers
// types
import type { IIssueRootStore } from "../root.store";
import { ProjectService } from "@/services/project";
// constants
// services

export interface IProjectIssuesFilter extends IBaseIssueFilterStore {
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    projectId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  getIssueFilters(projectId: string): IIssueFilters | undefined;
  // action
  fetchFilters: (workspaceSlug: string, projectId: string) => Promise<void>;
  getUseProjectDefault: (projectId: string) => boolean | undefined;
  getProjectDisplayConfig: (projectId: string) => IProjectDisplayConfig | Record<string, never> | undefined;
  getDisplayConfigPending: (projectId: string) => boolean;
  saveProjectDisplayConfig: (workspaceSlug: string, projectId: string) => Promise<void>;
  resetProjectDisplayConfig: (workspaceSlug: string, projectId: string) => Promise<void>;
  updateFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    filters: TWorkItemFilterExpression
  ) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate
  ) => Promise<void>;
}

export class ProjectIssuesFilter extends IssueFilterHelperStore implements IProjectIssuesFilter {
  // observables
  filters: { [projectId: string]: IIssueFilters } = {};
  useProjectDefault: Record<string, boolean | undefined> = {};
  projectDisplayConfigs: Record<string, IProjectDisplayConfig | Record<string, never>> = {};
  displayConfigPending: Record<string, number> = {};
  private displayRequestIds: Record<string, number> = {};
  private richFilterRequestIds: Record<string, number> = {};
  private displayWrites: Record<string, Promise<unknown> | undefined> = {};
  private richFilterWrites: Record<string, Promise<unknown> | undefined> = {};
  // root store
  rootIssueStore: IIssueRootStore;
  // services
  projectService;

  constructor(_rootStore: IIssueRootStore) {
    super();
    makeObservable(this, {
      // observables
      filters: observable,
      useProjectDefault: observable,
      projectDisplayConfigs: observable,
      displayConfigPending: observable,
      // computed
      issueFilters: computed,
      appliedFilters: computed,
      // actions
      fetchFilters: action,
      updateFilterExpression: action,
      updateFilters: action,
      applyUserProperties: action,
      saveProjectDisplayConfig: action,
      resetProjectDisplayConfig: action,
      beginDisplayRequest: action,
      finishDisplayRequest: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.projectService = new ProjectService();
  }

  get issueFilters() {
    const projectId = this.rootIssueStore.projectId;
    if (!projectId) return undefined;

    return this.getIssueFilters(projectId);
  }

  get appliedFilters() {
    const projectId = this.rootIssueStore.projectId;
    if (!projectId) return undefined;

    return this.getAppliedFilters(projectId);
  }

  getUseProjectDefault = (projectId: string) => this.useProjectDefault[projectId];
  getProjectDisplayConfig = (projectId: string) => this.projectDisplayConfigs[projectId];
  getDisplayConfigPending = (projectId: string) => !!this.displayConfigPending[projectId];

  applyUserProperties = (projectId: string, response: IProjectUserPropertiesResponse) => {
    // Display writes and refreshes must not replace a newer, independently edited rich filter.
    if (!this.filters[projectId]) set(this.filters, [projectId, "richFilters"], response.rich_filters);
    set(this.filters, [projectId, "displayFilters"], this.computedDisplayFilters(response.display_filters));
    set(this.filters, [projectId, "displayProperties"], this.computedDisplayProperties(response.display_properties));
    this.useProjectDefault[projectId] = response.use_project_default;
    this.projectDisplayConfigs[projectId] = response.project_display_config;
  };

  beginDisplayRequest = (projectId: string) => {
    this.displayConfigPending[projectId] = (this.displayConfigPending[projectId] ?? 0) + 1;
    this.displayRequestIds[projectId] = (this.displayRequestIds[projectId] ?? 0) + 1;
    return this.displayRequestIds[projectId];
  };

  finishDisplayRequest = (projectId: string) => {
    this.displayConfigPending[projectId] = Math.max(0, (this.displayConfigPending[projectId] ?? 0) - 1);
  };

  private enqueueWrite = <T>(
    pendingWrites: Record<string, Promise<unknown> | undefined>,
    projectId: string,
    write: () => Promise<T>
  ): Promise<T> => {
    const previous = pendingWrites[projectId];
    const pending = previous ? previous.catch(() => undefined).then(write) : write();
    pendingWrites[projectId] = pending;
    const clear = () => {
      if (pendingWrites[projectId] === pending) delete pendingWrites[projectId];
    };
    void pending.then(clear, clear);
    return pending;
  };

  private refreshIssuesForDisplayChanges = async (
    workspaceSlug: string,
    projectId: string,
    previous: IIssueDisplayFilterOptions | undefined
  ) => {
    const current = this.getIssueFilters(projectId)?.displayFilters;
    if (
      !previous ||
      projectId !== this.rootIssueStore.projectId ||
      (previous.order_by === current?.order_by && previous.sub_issue === current?.sub_issue)
    )
      return;
    try {
      await this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
    } catch (error) {
      // The preference write already succeeded; a failed task refresh must not roll it back.
      console.error("error while refreshing issues after display settings changed", error);
    }
  };

  saveProjectDisplayConfig = async (workspaceSlug: string, projectId: string) => {
    const filters = this.getIssueFilters(projectId);
    if (!filters || this.getDisplayConfigPending(projectId)) return;
    const snapshot: IProjectDisplayConfig = {
      display_properties: toJS(filters.displayProperties ?? {}),
      order_by: filters.displayFilters?.order_by ?? "sort_order",
      sub_issue: filters.displayFilters?.sub_issue ?? true,
    };
    const requestId = this.beginDisplayRequest(projectId);
    try {
      const response = await this.enqueueWrite(this.displayWrites, projectId, async () => {
        await this.projectService.updateProjectDisplayConfig(workspaceSlug, projectId, snapshot);
        return this.projectService.getProjectUserProperties(workspaceSlug, projectId);
      });
      if (requestId === this.displayRequestIds[projectId]) {
        const previous = this.getIssueFilters(projectId)?.displayFilters;
        this.applyUserProperties(projectId, response);
        await this.refreshIssuesForDisplayChanges(workspaceSlug, projectId, previous);
      }
    } finally {
      this.finishDisplayRequest(projectId);
    }
  };

  resetProjectDisplayConfig = async (workspaceSlug: string, projectId: string) => {
    if (this.getDisplayConfigPending(projectId)) return;
    const previous = this.getIssueFilters(projectId)?.displayFilters;
    const requestId = this.beginDisplayRequest(projectId);
    try {
      const response = await this.enqueueWrite(this.displayWrites, projectId, () =>
        this.projectService.resetProjectDisplayConfig(workspaceSlug, projectId)
      );
      if (requestId !== this.displayRequestIds[projectId]) return;
      this.applyUserProperties(projectId, response);
      await this.refreshIssuesForDisplayChanges(workspaceSlug, projectId, previous);
    } finally {
      this.finishDisplayRequest(projectId);
    }
  };

  getIssueFilters(projectId: string) {
    const displayFilters = this.filters[projectId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    return this.computedIssueFilters(displayFilters);
  }

  getAppliedFilters(projectId: string) {
    const userFilters = this.getIssueFilters(projectId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "issues");
    if (!filteredParams) return undefined;

    const filteredRouteParams: Partial<Record<TIssueParams, string | boolean>> = this.computedFilteredParams(
      userFilters?.richFilters,
      userFilters?.displayFilters,
      filteredParams
    );

    return filteredRouteParams;
  }

  getFilterParams = computedFn(
    (
      options: IssuePaginationOptions,
      projectId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = this.getAppliedFilters(projectId);
      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string, projectId: string) => {
    const requestId = (this.displayRequestIds[projectId] ?? 0) + 1;
    this.displayRequestIds[projectId] = requestId;
    const pendingWrite = this.displayWrites[projectId];
    if (pendingWrite) await pendingWrite.catch(() => undefined);
    const _filters = await this.projectService.getProjectUserProperties(workspaceSlug, projectId);
    if (requestId !== this.displayRequestIds[projectId]) return;

    // fetching the kanban toggle helpers in the local storage
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    const currentUserId = this.rootIssueStore.currentUserId;
    if (currentUserId) {
      const _kanbanFilters = this.handleIssuesLocalFilters.get(
        EIssuesStoreType.PROJECT,
        workspaceSlug,
        projectId,
        currentUserId
      );
      kanbanFilters.group_by = _kanbanFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = _kanbanFilters?.kanban_filters?.sub_group_by || [];
    }

    const previous = this.getIssueFilters(projectId)?.displayFilters;
    runInAction(() => {
      this.applyUserProperties(projectId, _filters);
      set(this.filters, [projectId, "kanbanFilters"], kanbanFilters);
    });
    await this.refreshIssuesForDisplayChanges(workspaceSlug, projectId, previous);
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IProjectIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    filters
  ) => {
    const requestId = (this.richFilterRequestIds[projectId] ?? 0) + 1;
    this.richFilterRequestIds[projectId] = requestId;
    try {
      const response = await this.enqueueWrite(this.richFilterWrites, projectId, () =>
        this.projectService.updateProjectUserProperties(workspaceSlug, projectId, { rich_filters: filters })
      );
      if (requestId !== this.richFilterRequestIds[projectId]) return;
      runInAction(() => {
        set(this.filters, [projectId, "richFilters"], response.rich_filters);
      });
      this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IProjectIssuesFilter["updateFilters"] = async (workspaceSlug, projectId, type, filters) => {
    const previousFilters = toJS(this.filters[projectId]);
    let requestId: number | undefined;
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[projectId])) return;

      const _filters = {
        richFilters: this.filters[projectId].richFilters,
        displayFilters: this.filters[projectId].displayFilters as IIssueDisplayFilterOptions,
        displayProperties: this.filters[projectId].displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[projectId].kanbanFilters as TIssueKanbanFilters,
      };

      switch (type) {
        case EIssueFilterType.DISPLAY_FILTERS: {
          const updatedDisplayFilters = Object.fromEntries(
            Object.entries(filters).filter(
              ([key, value]) => !isEqual(value, _filters.displayFilters[key as keyof IIssueDisplayFilterOptions])
            )
          ) as IIssueDisplayFilterOptions;
          if (isEmpty(updatedDisplayFilters)) return;
          requestId = this.beginDisplayRequest(projectId);
          _filters.displayFilters = { ..._filters.displayFilters, ...updatedDisplayFilters };

          // set sub_group_by to null if group_by is set to null
          if (_filters.displayFilters.group_by === null && _filters.displayFilters.sub_group_by !== null) {
            _filters.displayFilters.sub_group_by = null;
            updatedDisplayFilters.sub_group_by = null;
          }
          // set sub_group_by to null if layout is switched to kanban group_by and sub_group_by are same
          if (
            _filters.displayFilters.layout === "kanban" &&
            _filters.displayFilters.group_by === _filters.displayFilters.sub_group_by &&
            _filters.displayFilters.sub_group_by !== null
          ) {
            _filters.displayFilters.sub_group_by = null;
            updatedDisplayFilters.sub_group_by = null;
          }
          // set group_by to state if layout is switched to kanban and group_by is null
          if (_filters.displayFilters.layout === "kanban" && _filters.displayFilters.group_by === null) {
            _filters.displayFilters.group_by = "state";
            updatedDisplayFilters.group_by = "state";
          }

          runInAction(() => {
            // A layout-only change must keep following the shared sort. Normalize its optimistic
            // rendering without sending an order_by delta that would create a personal override.
            if (
              this.getUseProjectDefault(projectId) &&
              updatedDisplayFilters.layout &&
              !["list", "spreadsheet"].includes(updatedDisplayFilters.layout) &&
              isCustomFieldOrderBy(_filters.displayFilters.order_by) &&
              !Object.hasOwn(updatedDisplayFilters, "order_by")
            )
              set(this.filters, [projectId, "displayFilters", "order_by"], "-created_at");
            Object.keys(updatedDisplayFilters).forEach((_key) => {
              set(
                this.filters,
                [projectId, "displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          if (this.getShouldClearIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.clear(true); // clear issues for local store when some filters like layout changes
          }

          if (this.getShouldReFetchIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
          }

          const response = await this.enqueueWrite(this.displayWrites, projectId, () =>
            this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
              display_filters: updatedDisplayFilters,
            })
          );
          if (requestId === this.displayRequestIds[projectId]) {
            const previous = this.getIssueFilters(projectId)?.displayFilters;
            this.applyUserProperties(projectId, response);
            await this.refreshIssuesForDisplayChanges(workspaceSlug, projectId, previous);
          }

          break;
        }
        case EIssueFilterType.DISPLAY_PROPERTIES: {
          const updatedDisplayProperties = Object.fromEntries(
            Object.entries(filters).filter(
              ([key, value]) =>
                key !== "custom_fields" &&
                !isEqual(value, _filters.displayProperties[key as keyof IIssueDisplayProperties])
            )
          ) as IIssueDisplayProperties;
          const customFields = (filters as IIssueDisplayProperties).custom_fields;
          if (customFields) {
            const changes = Object.fromEntries(
              Object.entries(customFields).filter(
                ([key, value]) => value !== _filters.displayProperties.custom_fields?.[key]
              )
            );
            if (!isEmpty(changes)) updatedDisplayProperties.custom_fields = changes;
          }
          if (isEmpty(updatedDisplayProperties)) return;
          requestId = this.beginDisplayRequest(projectId);
          _filters.displayProperties = { ..._filters.displayProperties, ...updatedDisplayProperties };

          runInAction(() => {
            Object.keys(updatedDisplayProperties).forEach((_key) => {
              set(
                this.filters,
                [projectId, "displayProperties", _key],
                _key === "custom_fields"
                  ? {
                      ...this.filters[projectId].displayProperties?.custom_fields,
                      ...updatedDisplayProperties.custom_fields,
                    }
                  : updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          const response = await this.enqueueWrite(this.displayWrites, projectId, () =>
            this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
              display_properties: updatedDisplayProperties,
            })
          );
          if (requestId === this.displayRequestIds[projectId]) {
            const previous = this.getIssueFilters(projectId)?.displayFilters;
            this.applyUserProperties(projectId, response);
            await this.refreshIssuesForDisplayChanges(workspaceSlug, projectId, previous);
          }
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.PROJECT, type, workspaceSlug, projectId, currentUserId, {
              kanban_filters: _filters.kanbanFilters,
            });

          runInAction(() => {
            Object.keys(updatedKanbanFilters).forEach((_key) => {
              set(
                this.filters,
                [projectId, "kanbanFilters", _key],
                updatedKanbanFilters[_key as keyof TIssueKanbanFilters]
              );
            });
          });

          break;
        }
        default:
          break;
      }
    } catch (error) {
      if (requestId === undefined || requestId === this.displayRequestIds[projectId]) {
        runInAction(() => {
          set(this.filters, [projectId, "displayFilters"], previousFilters?.displayFilters);
          set(this.filters, [projectId, "displayProperties"], previousFilters?.displayProperties);
          set(this.filters, [projectId, "kanbanFilters"], previousFilters?.kanbanFilters);
        });
        try {
          await this.fetchFilters(workspaceSlug, projectId);
        } catch {
          // Keep the last effective settings when the recovery request is also unavailable.
        }
      }
      throw error;
    } finally {
      if (requestId !== undefined) this.finishDisplayRequest(projectId);
    }
  };
}
