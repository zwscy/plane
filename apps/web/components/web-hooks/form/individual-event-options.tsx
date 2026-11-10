/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import { CheckboxField } from "@makeplane/propel/components/checkbox-field";
import type { IWebhook } from "@plane/types";
import { useTranslation } from "@plane/i18n";

export const INDIVIDUAL_WEBHOOK_OPTIONS: {
  key: keyof IWebhook;
  label: string;
  description: string;
}[] = [
  {
    key: "project",
    label: "projects",
    description: "common.ui.webhook_project_events",
  },
  {
    key: "cycle",
    label: "cycles",
    description: "common.ui.webhook_cycle_events",
  },
  {
    key: "issue",
    label: "work_items",
    description: "common.ui.webhook_issue_events",
  },
  {
    key: "module",
    label: "modules",
    description: "common.ui.webhook_module_events",
  },
  {
    key: "issue_comment",
    label: "common.ui.work_item_comments",
    description: "common.ui.webhook_comment_events",
  },
];

type Props = {
  control: Control<IWebhook, any>;
};

export function WebhookIndividualEventOptions({ control }: Props) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-6 lg:grid-cols-2">
      {INDIVIDUAL_WEBHOOK_OPTIONS.map((option) => (
        <Controller
          key={option.key}
          control={control}
          name={option.key}
          render={({ field: { onChange, value } }) => (
            <CheckboxField
              name={option.key}
              label={t(option.label)}
              size="lg"
              description={t(option.description)}
              stretch="full"
              checked={value === true}
              onCheckedChange={onChange}
            />
          )}
        />
      ))}
    </div>
  );
}
