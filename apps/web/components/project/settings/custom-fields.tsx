/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { CUSTOM_FIELD_TYPE_LABELS } from "@plane/constants";
import { setToast } from "@plane/blocks/toast";
import type { TProjectCustomField, TProjectCustomFieldInput, TCustomFieldType } from "@plane/types";
import { projectCustomFieldService, useProjectCustomFields } from "@/hooks/use-project-custom-fields";
import { moveCustomFieldOption } from "@/components/issues/custom-fields/helpers";

const inputClass =
  "w-full rounded-md border border-subtle bg-layer-1 px-3 py-2 text-body-sm-regular text-primary disabled:opacity-60";
const emptyField = (sortOrder: number): TProjectCustomFieldInput => ({
  name: "",
  description: "",
  field_type: "text",
  options: [],
  is_active: true,
  sort_order: sortOrder,
});

export const ProjectCustomFieldsSettings = observer(function ProjectCustomFieldsSettings({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const { fields, isLoading, error, mutate } = useProjectCustomFields(workspaceSlug, projectId);
  const [editing, setEditing] = useState<TProjectCustomField | null>();
  const [draft, setDraft] = useState<TProjectCustomFieldInput>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const perform = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setFormError("");
    try {
      await operation();
      await mutate();
      return true;
    } catch {
      // A reorder can persist a prefix before a later request fails. Refresh the actual server state.
      await mutate().catch(() => undefined);
      setFormError("保存失败，请检查字段名称、选项或权限后重试。");
      setToast({ type: "error", title: "操作失败", message: "自定义字段未保存，请重试。" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const startEdit = (field: TProjectCustomField | null) => {
    setEditing(field);
    setFormError("");
    setDraft(
      field
        ? {
            name: field.name,
            description: field.description,
            field_type: field.field_type,
            options: field.options.map((option) => ({ ...option })),
            is_active: field.is_active,
            sort_order: field.sort_order,
          }
        : emptyField(Math.max(0, ...fields.map((item) => item.sort_order)) + 1000)
    );
  };
  const move = (index: number, direction: -1 | 1) =>
    perform(async () => {
      const reordered = [...fields];
      const next = index + direction;
      if (!reordered[next]) return;
      [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
      // Send every position so duplicate historic orders are normalized too.
      for (const [position, field] of reordered.entries()) {
        const sort_order = (position + 1) * 1000;
        if (field.sort_order !== sort_order)
          // Keep project-locked writes sequential and stop on the first failure.
          // oxlint-disable-next-line no-await-in-loop
          await projectCustomFieldService.update(workspaceSlug, projectId, field.id, { sort_order });
      }
    });
  const hasOptions = draft?.field_type === "select" || draft?.field_type === "multi_select";
  if (isLoading) return <p>自定义字段加载中…</p>;
  if (error)
    return (
      <div role="alert" className="space-y-3">
        <p>自定义字段加载失败。</p>
        <Button stretch="auto" size="md" label="重试" variant="secondary" onClick={() => void mutate()} />
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h5-semibold">自定义字段</h1>
          <p className="mt-2 text-body-sm-regular text-secondary">
            为本项目配置任务字段。所有字段均为可选；停用后保留已有值。
          </p>
        </div>
        <Button
          stretch="auto"
          size="md"
          variant="primary"
          label="新建字段"
          disabled={busy || !!draft}
          onClick={() => startEdit(null)}
        />
      </div>
      {draft && (
        <form
          className="space-y-4 rounded-lg border border-subtle p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const name = draft.name.trim();
            if (!name || (hasOptions && draft.options.some((option) => !option.name.trim()))) {
              setFormError("字段名称和选项名称不能为空。");
              return;
            }
            if (hasOptions && !draft.options.some((option) => option.is_active)) {
              setFormError("请至少保留一个启用的选项。");
              return;
            }
            const payload = {
              ...draft,
              name,
              description: draft.description.trim(),
              options: hasOptions ? draft.options.map((option) => ({ ...option, name: option.name.trim() })) : [],
            };
            const saved = await perform(() =>
              editing
                ? projectCustomFieldService.update(workspaceSlug, projectId, editing.id, payload)
                : projectCustomFieldService.create(workspaceSlug, projectId, payload)
            );
            if (saved) {
              setDraft(undefined);
              setEditing(undefined);
            }
          }}
        >
          <h2 className="text-body-md-semibold">{editing ? "编辑字段" : "新建字段"}</h2>
          <label className="block space-y-1">
            <span className="text-body-sm-medium">字段名称</span>
            <input
              required
              maxLength={255}
              className={inputClass}
              value={draft.name}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-body-sm-medium">说明</span>
            <textarea
              className={inputClass}
              value={draft.description}
              rows={2}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-body-sm-medium">字段类型</span>
            <select
              className={inputClass}
              value={draft.field_type}
              disabled={busy || !!editing?.is_type_locked}
              onChange={(event) => setDraft({ ...draft, field_type: event.target.value as TCustomFieldType })}
            >
              {Object.entries(CUSTOM_FIELD_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {editing?.is_type_locked && (
            <p className="text-caption-sm-regular text-tertiary">已有任务使用此字段，类型已锁定。</p>
          )}
          {hasOptions && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-body-sm-medium">选项（按显示顺序）</legend>
              {draft.options.map((option, index) => (
                <div key={option.id} className="flex items-center gap-2">
                  <input
                    aria-label={`选项 ${index + 1} 名称`}
                    required
                    maxLength={255}
                    className={inputClass}
                    value={option.name}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        options: draft.options.map((item) =>
                          item.id === option.id ? { ...item, name: event.target.value } : item
                        ),
                      })
                    }
                  />
                  <Button
                    stretch="auto"
                    variant="ghost"
                    size="sm"
                    label="上移"
                    disabled={busy || index === 0}
                    onClick={() => setDraft({ ...draft, options: moveCustomFieldOption(draft.options, index, -1) })}
                  />
                  <Button
                    stretch="auto"
                    variant="ghost"
                    size="sm"
                    label="下移"
                    disabled={busy || index === draft.options.length - 1}
                    onClick={() => setDraft({ ...draft, options: moveCustomFieldOption(draft.options, index, 1) })}
                  />
                  <Button
                    stretch="auto"
                    variant="secondary"
                    size="sm"
                    label={option.is_active ? "停用" : "启用"}
                    disabled={busy}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: draft.options.map((item) =>
                          item.id === option.id ? { ...item, is_active: !item.is_active } : item
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                stretch="auto"
                variant="secondary"
                size="sm"
                label="添加选项"
                disabled={busy}
                onClick={() =>
                  setDraft({
                    ...draft,
                    options: [...draft.options, { id: crypto.randomUUID(), name: "", is_active: true }],
                  })
                }
              />
              <p className="text-caption-sm-regular text-tertiary">
                停用选项会保留历史值。改名和调整顺序不会改变任务所选的选项。
              </p>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-body-sm-regular">
            <input
              type="checkbox"
              checked={draft.is_active}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
            />
            启用字段
          </label>
          <div className="flex gap-2">
            <Button
              stretch="auto"
              size="md"
              variant="primary"
              type="submit"
              label={busy ? "保存中…" : "保存"}
              disabled={busy}
            />
            <Button
              stretch="auto"
              size="md"
              variant="secondary"
              label="取消"
              disabled={busy}
              onClick={() => {
                setDraft(undefined);
                setEditing(undefined);
                setFormError("");
              }}
            />
          </div>
        </form>
      )}
      {formError && (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {formError}
        </p>
      )}
      {!fields.length && !draft && <p className="py-6 text-body-sm-regular text-tertiary">本项目还没有自定义字段。</p>}
      <div className="divide-y divide-subtle">
        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-wrap items-center gap-2 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-body-sm-medium break-words">
                {field.name} {!field.is_active && <span className="text-tertiary">（已停用）</span>}
              </p>
              <p className="text-caption-sm-regular text-tertiary">
                {CUSTOM_FIELD_TYPE_LABELS[field.field_type]}
                {field.is_type_locked ? " · 类型已锁定" : ""}
              </p>
              {field.description && (
                <p className="mt-1 text-caption-sm-regular break-words text-secondary">{field.description}</p>
              )}
            </div>
            <Button
              stretch="auto"
              variant="ghost"
              size="sm"
              label="上移"
              disabled={busy || !!draft || index === 0}
              onClick={() => void move(index, -1)}
            />
            <Button
              stretch="auto"
              variant="ghost"
              size="sm"
              label="下移"
              disabled={busy || !!draft || index === fields.length - 1}
              onClick={() => void move(index, 1)}
            />
            <Button
              stretch="auto"
              variant="secondary"
              size="sm"
              label="编辑"
              disabled={busy || !!draft}
              onClick={() => startEdit(field)}
            />
            <Button
              stretch="auto"
              variant="secondary"
              size="sm"
              label={field.is_active ? "停用" : "启用"}
              disabled={busy || !!draft}
              onClick={() =>
                void perform(() =>
                  projectCustomFieldService.update(workspaceSlug, projectId, field.id, { is_active: !field.is_active })
                )
              }
            />
            <Button
              stretch="auto"
              variant="ghost"
              size="sm"
              label="删除"
              disabled={busy || !!draft}
              onClick={() => {
                if (window.confirm(`删除“${field.name}”？字段将从任务中隐藏，已有数据会保留。`))
                  void perform(() => projectCustomFieldService.remove(workspaceSlug, projectId, field.id));
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
