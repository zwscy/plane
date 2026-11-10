/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useId, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { CUSTOM_FIELD_MULTI_TYPES } from "@plane/constants";
import type { TProjectCustomField, TCustomFieldValue } from "@plane/types";
import { formatCustomFieldValue, parseCustomFieldInput } from "./helpers";
import { useCustomFieldOptions } from "./use-options";

export type CustomFieldEditorProps = {
  workspaceSlug: string;
  projectId: string;
  field: TProjectCustomField;
  value: TCustomFieldValue | undefined;
  onChange: (value: TCustomFieldValue) => void | Promise<unknown>;
  disabled?: boolean;
  compact?: boolean;
};

export const CustomFieldValue = observer(function CustomFieldValue(
  props: Omit<CustomFieldEditorProps, "onChange" | "disabled">
) {
  const { field, value, workspaceSlug, projectId } = props;
  const { options, isLoading, error } = useCustomFieldOptions(workspaceSlug, projectId, field);
  const text =
    isLoading && value != null
      ? "加载中…"
      : error && value != null
        ? "选项加载失败"
        : formatCustomFieldValue(value, options);
  return (
    <span className="block truncate text-body-xs-regular" title={text}>
      {text}
    </span>
  );
});

export const CustomFieldEditor = observer(function CustomFieldEditor(props: CustomFieldEditorProps) {
  const { workspaceSlug, projectId, field, value, onChange, disabled = false, compact = false } = props;
  const { options, isLoading, error } = useCustomFieldOptions(workspaceSlug, projectId, field);
  const [raw, setRaw] = useState(value == null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastCommitted = useRef<TCustomFieldValue>(value ?? null);
  const id = useId();
  useEffect(() => {
    setRaw(value == null ? "" : String(value));
    setInvalid(false);
    lastCommitted.current = value ?? null;
  }, [value, field.id]);
  const className =
    "w-full min-w-0 rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-xs-regular text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-60";
  const save = async (next: TCustomFieldValue) => {
    if (JSON.stringify(next) === JSON.stringify(lastCommitted.current)) return;
    const previous = lastCommitted.current;
    lastCommitted.current = next;
    setSaveError(false);
    setSaving(true);
    try {
      await onChange(next);
    } catch {
      lastCommitted.current = previous;
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  const commit = () => {
    const next = parseCustomFieldInput(field.field_type, raw);
    setInvalid(next === undefined);
    if (next !== undefined) void save(next);
  };
  const singleValue = typeof value === "string" ? value : "";
  const multiple = CUSTOM_FIELD_MULTI_TYPES.includes(field.field_type);
  const selectedIds = Array.isArray(value) ? value : singleValue ? [singleValue] : [];
  const visibleOptions = options?.filter((option) => option.is_active || selectedIds.includes(option.id));
  const missingIds = options ? selectedIds.filter((selected) => !options.some((option) => option.id === selected)) : [];
  let control;
  if (field.field_type === "boolean") {
    control = (
      <select
        id={id}
        aria-label={field.name}
        className={className}
        value={value == null ? "" : String(value)}
        disabled={disabled || saving}
        onChange={(event) => void save(parseCustomFieldInput("boolean", event.target.value) ?? null)}
      >
        <option value="">未设置</option>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    );
  } else if (options) {
    control = (
      <select
        id={id}
        aria-label={field.name}
        className={className}
        multiple={multiple}
        size={multiple ? (compact ? 2 : 3) : undefined}
        value={multiple ? selectedIds : singleValue}
        disabled={disabled || saving || isLoading || !!error}
        onChange={(event) => {
          const next = multiple
            ? Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean)
            : event.target.value || null;
          void save(Array.isArray(next) && !next.length ? null : next);
        }}
      >
        {!multiple && <option value="">{isLoading ? "加载中…" : "未设置"}</option>}
        {visibleOptions?.map((option) => (
          <option key={option.id} value={option.id} disabled={!option.is_active && !selectedIds.includes(option.id)}>
            {option.name}
            {option.is_active ? "" : "（已停用）"}
          </option>
        ))}
        {missingIds.map((missing) => (
          <option key={missing} value={missing} disabled>
            {isLoading ? "加载中…" : error ? "选项加载失败" : "已失效的选项"}
          </option>
        ))}
      </select>
    );
  } else if (field.field_type === "textarea") {
    control = (
      <textarea
        id={id}
        aria-label={field.name}
        className={className}
        value={raw}
        rows={compact ? 2 : 3}
        disabled={disabled || saving}
        onChange={(event) => setRaw(event.target.value)}
        onBlur={commit}
      />
    );
  } else {
    const numeric = field.field_type === "integer" || field.field_type === "decimal";
    control = (
      <input
        id={id}
        aria-label={field.name}
        className={className}
        type={numeric ? "number" : field.field_type === "date" ? "date" : "text"}
        step={field.field_type === "integer" ? "1" : numeric ? "any" : undefined}
        min={field.field_type === "integer" ? Number.MIN_SAFE_INTEGER : undefined}
        max={field.field_type === "integer" ? Number.MAX_SAFE_INTEGER : undefined}
        value={raw}
        disabled={disabled || saving}
        onChange={(event) => setRaw(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        aria-invalid={invalid}
      />
    );
  }
  return (
    <div className="min-w-0 space-y-1" title={field.description || field.name}>
      <div className="flex min-w-0 items-start gap-1">
        {control}
        {!disabled && value != null && (
          <Button
            stretch="auto"
            variant="ghost"
            size="sm"
            label="清空"
            disabled={saving}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setRaw("");
              void save(null);
            }}
          />
        )}
      </div>
      {saveError && (
        <p className="text-caption-sm-regular text-danger-primary" role="alert">
          保存失败，请重新编辑后重试
        </p>
      )}
      {invalid && (
        <p className="text-caption-sm-regular text-danger-primary" role="alert">
          请输入有效的{field.field_type === "integer" ? "整数" : "数字"}
        </p>
      )}
      {error && (
        <p className="text-caption-sm-regular text-danger-primary" role="alert">
          选项加载失败，请刷新重试
        </p>
      )}
      {multiple && !compact && <p className="text-caption-sm-regular text-tertiary">按住 Ctrl / ⌘ 可多选</p>}
    </div>
  );
});
