/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { ProjectCustomFieldService } from "./custom-fields.service.ts";

// Exercise the actual HTTP client: collection/detail URLs, verbs, JSON payload and errors.
describe("ProjectCustomFieldService", () => {
  it("uses the project scoped CRUD contract without dropping Chinese names or inactive option ids", async () => {
    const received = [];
    const field = {
      id: "field-id",
      project_id: "project-id",
      name: "客户阶段",
      description: "项目专用",
      field_type: "select",
      options: [{ id: "option-id", name: "已成交", is_active: false }],
      sort_order: 1000,
      is_active: true,
      is_type_locked: true,
    };
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      received.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : null });
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") response.end(JSON.stringify([field]));
      else if (request.method === "DELETE") {
        response.statusCode = 204;
        response.end();
      } else response.end(JSON.stringify(field));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const service = new ProjectCustomFieldService(`http://127.0.0.1:${server.address().port}`);
      const input = {
        name: field.name,
        description: field.description,
        field_type: field.field_type,
        options: field.options,
        sort_order: 1000,
        is_active: true,
      };
      expect(await service.list("团队", "project-id")).toEqual([field]);
      expect(await service.create("团队", "project-id", input)).toEqual(field);
      expect(await service.update("团队", "project-id", field.id, { options: field.options })).toEqual(field);
      await service.remove("团队", "project-id", field.id);
      const path = "/api/workspaces/%E5%9B%A2%E9%98%9F/projects/project-id/custom-fields/";
      expect(received).toEqual([
        { method: "GET", path, body: null },
        { method: "POST", path, body: input },
        { method: "PATCH", path: `${path}field-id/`, body: { options: field.options } },
        { method: "DELETE", path: `${path}field-id/`, body: null },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  });

  it("surfaces permission failures to callers instead of reporting a successful save", async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 403;
      response.end("Forbidden");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const service = new ProjectCustomFieldService(`http://127.0.0.1:${server.address().port}`);
      await expect(service.update("team", "project", "field", { is_active: false })).rejects.toMatchObject({
        response: { status: 403 },
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  });
});
