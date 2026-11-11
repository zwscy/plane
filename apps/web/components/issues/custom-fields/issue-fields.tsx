/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useState } from "react";
import { setToast } from "@plane/blocks/toast";
import type { TCustomFieldValue } from "@plane/types";
import { useProjectCustomFields } from "@/hooks/use-project-custom-fields";
import { CustomFieldEditor } from "./editor";
import { CustomFieldTypeIcon } from "./type-icon";

type Props = {
  workspaceSlug: string;
  projectId: string;
  values?: Record<string, TCustomFieldValue>;
  onChange: (values: Record<string, TCustomFieldValue>) => void | Promise<unknown>;
  disabled?: boolean;
};
export const IssueCustomFields = observer(function IssueCustomFields({
  workspaceSlug,
  projectId,
  values,
  onChange,
  disabled,
}: Props) {
  const { fields, error, isLoading } = useProjectCustomFields(workspaceSlug, projectId);
  const [savingId, setSavingId] = useState<string>();
  const activeFields = fields.filter((field) => field.is_active);
  if (isLoading) return <p className="text-body-xs-regular text-tertiary">自定义字段加载中…</p>;
  if (error)
    return (
      <p role="alert" className="text-body-xs-regular text-danger-primary">
        自定义字段加载失败，请刷新重试
      </p>
    );
  if (!activeFields.length) return null;
  return (
    <section className="space-y-3" aria-label="自定义字段">
      <h5 className="text-body-sm-semibold">自定义字段</h5>
      {activeFields.map((field) => (
        <div key={field.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-2">
          <span className="py-1.5 text-body-xs-medium break-words" title={field.description}>
            <CustomFieldTypeIcon
              type={field.field_type}
              icon={field.icon}
              className="mr-1.5 inline-block size-4 align-text-bottom text-secondary"
            />
            {field.name}
          </span>
          <CustomFieldEditor
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            field={field}
            value={values?.[field.id]}
            disabled={disabled || !!savingId}
            onChange={async (value) => {
              setSavingId(field.id);
              try {
                await onChange({ [field.id]: value });
              } catch (saveFailure) {
                setToast({ type: "error", title: "保存失败", message: "自定义字段未保存，请重试。" });
                throw saveFailure;
              } finally {
                setSavingId(undefined);
              }
            }}
          />
        </div>
      ))}
    </section>
  );
});
