/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import {
  AiStarFourOutline,
  ImageOutline,
  LockOutline,
  MailOutline,
  SettingsOutline,
  WorkspaceOutline,
} from "@makeplane/propel/icons";
// types
import type { TSidebarMenuItem } from "./types";

export type TCoreSidebarMenuKey = "general" | "email" | "workspace" | "authentication" | "ai" | "image";

export const coreSidebarMenuLinks: Record<TCoreSidebarMenuKey, TSidebarMenuItem> = {
  general: {
    Icon: SettingsOutline,
    name: "常规设置",
    description: "查看和管理实例基本信息。",
    href: `/general/`,
  },
  email: {
    Icon: MailOutline,
    name: "邮件设置",
    description: "配置 SMTP 发件服务。",
    href: `/email/`,
  },
  workspace: {
    Icon: WorkspaceOutline,
    name: "工作区",
    description: "管理此实例中的所有工作区。",
    href: `/workspace/`,
  },
  authentication: {
    Icon: LockOutline,
    name: "身份验证",
    description: "配置登录和身份验证方式。",
    href: `/authentication/`,
  },
  ai: {
    Icon: AiStarFourOutline,
    name: "人工智能",
    description: "配置 OpenAI 服务凭据。",
    href: `/ai/`,
  },
  image: {
    Icon: ImageOutline,
    name: "图片设置",
    description: "配置第三方图库服务。",
    href: `/image/`,
  },
};
