/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TProjectCustomField, TProjectCustomFieldInput } from "@plane/types";
import { APIService } from "../api.service";

export class ProjectCustomFieldService extends APIService {
  constructor(baseURL?: string) {
    super(baseURL || API_BASE_URL);
  }

  private path(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/`;
  }
  async list(workspaceSlug: string, projectId: string): Promise<TProjectCustomField[]> {
    return this.get(this.path(workspaceSlug, projectId)).then((response) => response.data);
  }
  async create(workspaceSlug: string, projectId: string, data: TProjectCustomFieldInput): Promise<TProjectCustomField> {
    return this.post(this.path(workspaceSlug, projectId), data).then((response) => response.data);
  }
  async update(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TProjectCustomFieldInput>
  ): Promise<TProjectCustomField> {
    return this.patch(`${this.path(workspaceSlug, projectId)}${fieldId}/`, data).then((response) => response.data);
  }
  async remove(workspaceSlug: string, projectId: string, fieldId: string): Promise<void> {
    await this.delete(`${this.path(workspaceSlug, projectId)}${fieldId}/`);
  }
}
