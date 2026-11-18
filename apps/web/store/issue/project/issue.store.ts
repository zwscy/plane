/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isCustomFieldOrderBy } from "@/helpers/custom-field-views";
import { action, makeObservable, observable, runInAction } from "mobx";
// types
import type {
  TIssue,
  TIssueParams,
  TLoader,
  ViewFlags,
  IssuePaginationOptions,
  TIssuesResponse,
  TBulkOperationsPayload,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// helpers
// base class
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
// services
import type { IIssueRootStore } from "../root.store";
import type { IProjectIssuesFilter } from "./filter.store";

type FilteredTree = {
  projectId: string;
  matchCount: number;
  childrenByParent: Record<string, string[]>;
  contextIds: ReadonlySet<string>;
  version: number;
};

const withFilteredTree = (params: Partial<Record<TIssueParams, string | boolean>>) =>
  (params.layout === EIssueLayoutTypes.LIST || params.layout === EIssueLayoutTypes.SPREADSHEET) &&
  params.sub_issue === false &&
  params.filters &&
  params.filters !== "{}"
    ? { ...params, filter_tree: true }
    : params;

export interface IProjectIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
  filteredTree: FilteredTree | undefined;
  // action
  fetchIssues: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    option: IssuePaginationOptions
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    projectId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  quickAddIssue: (workspaceSlug: string, projectId: string, data: TIssue) => Promise<TIssue | undefined>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;
}

export class ProjectIssues extends BaseIssuesStore implements IProjectIssues {
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };
  router;
  filteredTree: FilteredTree | undefined = undefined;
  private requestVersion = 0;

  // filter store
  issueFilterStore: IProjectIssuesFilter;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IProjectIssuesFilter) {
    super(_rootStore, issueFilterStore);
    makeObservable(this, {
      filteredTree: observable.ref,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,

      quickAddIssue: action,
    });
    // filter store
    this.issueFilterStore = issueFilterStore;
    this.router = _rootStore.rootStore.router;
  }

  /**
   * Fetches the project details
   * @param workspaceSlug
   * @param projectId
   */
  fetchParentStats = async (workspaceSlug: string, projectId?: string) => {
    if (projectId) this.rootIssueStore.rootStore.projectRoot.project.fetchProjectDetails(workspaceSlug, projectId);
  };

  /** */
  updateParentStats = () => {};

  override clear(shouldClearPaginationOptions = true) {
    ++this.requestVersion;
    super.clear(shouldClearPaginationOptions);
    this.filteredTree = undefined;
  }

  private storeFilteredTree(projectId: string, response: TIssuesResponse, append = false) {
    const tree = response.filtered_tree;
    if (!tree) return;

    const previous = append && this.filteredTree?.projectId === projectId ? this.filteredTree : undefined;
    const pageChildren: Record<string, string[]> = {};
    for (const child of tree.children) {
      if (!child.parent_id) continue;
      (pageChildren[child.parent_id] ??= []).push(child.id);
    }
    this.rootIssueStore.issues.addIssue(tree.children);
    this.filteredTree = {
      projectId,
      matchCount: tree.match_count,
      childrenByParent: { ...previous?.childrenByParent, ...pageChildren },
      contextIds: new Set([...(previous?.contextIds ?? []), ...tree.context_ids]),
      version: previous?.version ?? this.requestVersion,
    };
  }

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param projectId
   * @param loadType
   * @param options
   * @returns
   */
  fetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader = "init-loader",
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    let requestVersion = ++this.requestVersion;
    try {
      // set loader and clear store
      runInAction(() => {
        this.setLoader(loadType);
        // Keep mounted tree rows during custom-order mutation refreshes; the response replaces
        // IDs and counts together in onfetchIssues after the request completes.
        if (!(isExistingPaginationOptions && loadType === "mutation" && isCustomFieldOrderBy(this.orderBy)))
          this.clear(!isExistingPaginationOptions);
        else {
          this.controller.abort();
          this.controller = new AbortController();
        }
      });
      requestVersion = this.requestVersion;

      // get params from pagination options
      const params = withFilteredTree(
        this.issueFilterStore.getFilterParams(options, projectId, undefined, undefined, undefined)
      );
      // call the fetch issues API with the params
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      // after fetching issues, call the base method to process the response further
      if (requestVersion !== this.requestVersion) return;
      runInAction(() => {
        this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);
        this.storeFilteredTree(projectId, response);
      });
      return response;
    } catch (error) {
      if (requestVersion !== this.requestVersion) return;
      // set loader to undefined if errored out
      this.setLoader(undefined);
      throw error;
    }
  };

  /**
   * This method is called subsequent pages of pagination
   * if groupId/subgroupId is provided, only that specific group's next page is fetched
   * else all the groups' next page is fetched
   * @param workspaceSlug
   * @param projectId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (workspaceSlug: string, projectId: string, groupId?: string, subGroupId?: string) => {
    const cursorObject = this.getPaginationData(groupId, subGroupId);
    // if there are no pagination options and the next page results do not exist the return
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;
    const requestVersion = this.requestVersion;
    try {
      // set Loader
      this.setLoader("pagination", groupId, subGroupId);

      // get params from stored pagination options
      const filterByRootGroup = this.filteredTree?.projectId === projectId && !!groupId;
      let params = withFilteredTree(
        this.issueFilterStore.getFilterParams(
          this.paginationOptions,
          projectId,
          this.getNextCursor(groupId, subGroupId),
          filterByRootGroup ? undefined : groupId,
          filterByRootGroup ? undefined : subGroupId
        )
      );
      if (filterByRootGroup && typeof params.group_by === "string" && groupId) {
        // Paginate the displayed root group without adding its criteria to the descendant filter.
        const { group_by, sub_group_by: _subGroup, ...ungrouped } = params;
        params = { ...ungrouped, tree_group_by: group_by, tree_group_id: groupId };
      }
      // call the fetch issues API with the params for next page in issues
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params);

      // after the next page of issues are fetched, call the base method to process the response
      if (requestVersion !== this.requestVersion) return;
      runInAction(() => {
        this.onfetchNexIssues(response, groupId, subGroupId);
        this.storeFilteredTree(projectId, response, true);
      });
      return response;
    } catch (error) {
      if (requestVersion !== this.requestVersion) return;
      // set Loader as undefined if errored out
      this.setLoader(undefined, groupId, subGroupId);
      throw error;
    }
  };

  /**
   * This Method exists to fetch the first page of the issues with the existing stored pagination
   * This is useful for refetching when filters, groupBy, orderBy etc changes
   * @param workspaceSlug
   * @param projectId
   * @param loadType
   * @returns
   */
  fetchIssuesWithExistingPagination = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader = "mutation"
  ) => {
    if (!this.paginationOptions) return;
    return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
  };

  /**
   * Override inherited create issue, to update list only if user is on current project
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @returns
   */
  override createIssue = async (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => {
    const response = await super.createIssue(workspaceSlug, projectId, data, "", projectId === this.router.projectId);
    return response;
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  quickAddIssue = this.issueQuickAdd;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
}
