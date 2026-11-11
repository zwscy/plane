/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Button } from "@makeplane/propel/components/button";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@makeplane/propel/components/popover";
import { Select, SelectContent, SelectItem, SelectList } from "@makeplane/propel/components/select";
import {
  AddOutline,
  ArrowCollapseOutline,
  AtOutline,
  CalendarOutline,
  CloseOutline,
  CyclesOutline,
  DueDateOutline,
  EstimateOutline,
  FilterOutline,
  LabelsOutline,
  MembersOutline,
  ModuleOutline,
  PriorityOutline,
  SearchOutline,
  StateOutline,
  StartDateOutline,
  UserOutline,
  WorkItemsOutline,
} from "@makeplane/propel/icons";
import { EHeaderVariant, Header } from "@plane/blocks/layout";
import { SelectTriggerChrome } from "@plane/blocks/select";
import type { IWorkItemFilterInstance } from "@plane/shared-state";
import type { TProjectCustomField } from "@plane/types";
import { cn } from "@plane/utils";
import { CustomFieldTypeIcon } from "@/components/issues/custom-fields/type-icon";
import { useCustomFieldOptions } from "@/components/issues/custom-fields/use-options";
import { RowTransition } from "@/components/rich-filters/transition-components";
import { RichFiltersViewControls } from "@/components/rich-filters/view-controls";
import { useProjectCustomFields } from "@/hooks/use-project-custom-fields";
import { IssueService } from "@/services/issue/issue.service";
import type { DraftFilterRow, PanelDraft, PanelField } from "./project-filter-model";
import {
  buildPanelExpression,
  getPanelOperatorLabel,
  getPanelOperators,
  isPanelChoice,
  isPanelEmpty,
  isPanelMultiValue,
  isPanelRange,
  newDraftFilterRow,
  parsePanelExpression,
} from "./project-filter-model";

const issueService = new IssueService();

const CONTROL_CLASS =
  "min-h-8 min-w-0 rounded-md border border-subtle bg-surface-1 px-2 py-1.5 text-body-xs-regular text-primary outline-none focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent-strong/20 disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS = "w-full text-body-xs-regular";
const JOIN_OPTIONS = [
  { value: "and", label: "所有" },
  { value: "or", label: "任一" },
];
const BOOLEAN_OPTIONS = [
  { value: "true", label: "是" },
  { value: "false", label: "否" },
];

function PanelSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
  disabled,
  invalid,
  className,
}: {
  label: string;
  placeholder?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      value={selected?.value ?? null}
      onValueChange={(next) => typeof next === "string" && onChange(next)}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        render={
          <SelectTriggerChrome
            variant="select-lg"
            aria-label={label}
            isEmpty={!selected}
            className={cn(SELECT_CLASS, invalid && "border-danger-strong", className)}
          />
        }
      >
        <span className="min-w-0 grow truncate text-left">{selected?.label ?? placeholder ?? "请选择"}</span>
      </BaseSelect.Trigger>
      <SelectContent sizing="auto" positionMethod="fixed">
        <SelectList>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} label={option.label} />
          ))}
        </SelectList>
      </SelectContent>
    </Select>
  );
}
const ICONS = {
  name: WorkItemsOutline,
  state_id: StateOutline,
  state_group: StateOutline,
  priority: PriorityOutline,
  assignee_id: MembersOutline,
  label_id: LabelsOutline,
  module_id: ModuleOutline,
  cycle_id: CyclesOutline,
  start_date: StartDateOutline,
  target_date: DueDateOutline,
  created_at: CalendarOutline,
  updated_at: CalendarOutline,
  created_by_id: UserOutline,
  mention_id: AtOutline,
  subscriber_id: UserOutline,
  estimate_point: EstimateOutline,
};
const BUILTIN_FIELDS: PanelField[] = [
  { key: "name", name: "工作项", type: "text" },
  { key: "state_id", name: "状态", type: "state" },
  { key: "priority", name: "优先级", type: "priority" },
  { key: "assignee_id", name: "负责人", type: "members" },
  { key: "label_id", name: "标签", type: "labels" },
  { key: "module_id", name: "模块", type: "modules" },
  { key: "cycle_id", name: "周期", type: "cycle" },
  { key: "start_date", name: "开始日期", type: "date" },
  { key: "target_date", name: "截止日期", type: "date" },
  { key: "created_at", name: "创建时间", type: "date" },
  { key: "updated_at", name: "更新时间", type: "date" },
  { key: "estimate_point", name: "估算", type: "estimate" },
  { key: "created_by_id", name: "创建人", type: "member" },
  { key: "mention_id", name: "提及成员", type: "members" },
  { key: "subscriber_id", name: "订阅者", type: "members" },
  {
    key: "state_group",
    name: "状态分组",
    type: "select",
    options: [
      { id: "backlog", name: "待办", is_active: true },
      { id: "unstarted", name: "未开始", is_active: true },
      { id: "started", name: "进行中", is_active: true },
      { id: "completed", name: "已完成", is_active: true },
      { id: "cancelled", name: "已取消", is_active: true },
    ],
  },
];

function usePanelFields(workspaceSlug: string, projectId: string) {
  const { fields, isLoading, error } = useProjectCustomFields(workspaceSlug, projectId);
  const panelFields = useMemo(
    () => [
      ...BUILTIN_FIELDS,
      ...fields
        .filter((field) => field.is_active)
        .map((field) => ({
          key: `custom_fields__${field.id}`,
          name: field.name,
          type: field.field_type,
          options: field.options,
          customField: field,
        })),
    ],
    [fields]
  );
  return { fields: panelFields, isLoading, error };
}

function PanelFieldIcon({ field }: { field: PanelField }) {
  if (field.customField)
    return (
      <CustomFieldTypeIcon type={field.type} icon={field.customField.icon} className="size-4 shrink-0 text-secondary" />
    );
  const Icon = ICONS[field.key as keyof typeof ICONS] ?? FilterOutline;
  return <Icon className="size-4 shrink-0 text-secondary" aria-hidden="true" />;
}

/** Reuse the same project catalogues as the custom-field editors and spreadsheet cells. */
function optionDefinition(field: PanelField): TProjectCustomField {
  return (
    field.customField ?? {
      id: field.key,
      name: field.name,
      field_type: field.type,
      options: field.options ?? [],
      project_id: "",
      description: "",
      sort_order: 0,
      is_active: true,
      is_type_locked: true,
    }
  );
}

function FieldPicker({
  fields,
  value,
  onChange,
  disabled,
}: {
  fields: PanelField[];
  value: string;
  onChange: (field: PanelField) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = fields.find((field) => field.key === value);
  const shown = fields.filter((field) => field.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <SelectTriggerChrome
            variant="select-lg"
            aria-label="选择筛选字段"
            className={SELECT_CLASS}
            isActive={open}
            isEmpty={!selected}
            prependIcon={selected ? <PanelFieldIcon field={selected} /> : undefined}
          />
        }
      >
        <span className="min-w-0 grow truncate text-left">
          {selected?.name ?? (value ? "已失效的字段" : "选择字段")}
        </span>
      </PopoverTrigger>
      <PopoverContent variant="rich" side="bottom" align="start" positionMethod="fixed">
        <div className="w-64 max-w-[calc(100vw-3rem)]">
          <div className="relative mb-2">
            <SearchOutline className="absolute top-2 left-2 size-4 text-placeholder" aria-hidden="true" />
            <input
              type="search"
              aria-label="搜索筛选字段"
              placeholder="搜索字段"
              className={cn(CONTROL_CLASS, "w-full pl-8")}
              value={search}
              disabled={disabled}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="可筛选字段">
            {[false, true].map((custom) => (
              <section key={String(custom)} aria-label={custom ? "自定义字段" : "工作项字段"}>
                {shown.some((field) => !!field.customField === custom) && (
                  <p className="px-2 pt-2 pb-1 text-caption-sm-medium text-tertiary">
                    {custom ? "自定义字段" : "工作项字段"}
                  </p>
                )}
                {shown
                  .filter((field) => !!field.customField === custom)
                  .map((field) => (
                    <button
                      type="button"
                      key={field.key}
                      role="option"
                      disabled={disabled}
                      aria-selected={field.key === value}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-body-xs-regular text-primary hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong"
                      onClick={() => {
                        onChange(field);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <PanelFieldIcon field={field} />
                      <span className="truncate">{field.name}</span>
                    </button>
                  ))}
              </section>
            ))}
            {!shown.length && (
              <p className="px-2 py-4 text-center text-body-xs-regular text-tertiary">没有匹配的字段</p>
            )}
          </div>
          <p className="mt-2 border-t border-subtle pt-2 text-caption-sm-regular text-tertiary">
            隐藏的列也可以用于筛选
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type ValueProps = {
  workspaceSlug: string;
  projectId: string;
  field: PanelField;
  row: DraftFilterRow;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string | string[]) => void;
  onAvailabilityChange: (id: string, unavailable: boolean) => void;
};
const ConditionValue = observer(function ConditionValue(props: ValueProps) {
  const { workspaceSlug, projectId, field, row, disabled, invalid, onChange, onAvailabilityChange } = props;
  const { options, isLoading, error } = useCustomFieldOptions(workspaceSlug, projectId, optionDefinition(field));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const choice = isPanelChoice(field.type) && !isPanelEmpty(row.operator);
  useEffect(() => {
    onAvailabilityChange(row.id, choice && (isLoading || !!error));
  }, [row.id, choice, isLoading, error, onAvailabilityChange]);
  if (isPanelEmpty(row.operator))
    return <span className="flex min-h-8 items-center px-1 text-caption-md-regular text-tertiary">无需填写值</span>;
  const scalar = Array.isArray(row.value) ? "" : row.value;
  if (field.type === "boolean")
    return (
      <PanelSelect
        label={`${field.name}的值`}
        invalid={invalid}
        value={scalar}
        disabled={disabled}
        options={BOOLEAN_OPTIONS}
        onChange={onChange}
      />
    );
  if (choice) {
    const multiple = isPanelMultiValue(row.operator);
    const selected = Array.isArray(row.value) ? row.value : row.value ? [row.value] : [];
    const names = selected.map((id) => options?.find((option) => option.id === id)?.name ?? "已失效的选项");
    const missing = options ? selected.filter((id) => !options.some((option) => option.id === id)) : [];
    const shown = [...(options ?? []), ...missing.map((id) => ({ id, name: "已失效的选项", is_active: false }))].filter(
      (option) =>
        (option.is_active || selected.includes(option.id)) &&
        option.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    );
    return (
      <div className="min-w-0">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setSearch("");
          }}
        >
          <PopoverTrigger
            disabled={disabled || isLoading || !!error}
            render={
              <SelectTriggerChrome
                variant="select-lg"
                aria-label={`${field.name}的值`}
                className={cn(SELECT_CLASS, invalid && "border-danger-strong")}
                isActive={open}
                isEmpty={!selected.length}
              />
            }
          >
            <span className="min-w-0 grow truncate text-left">
              {isLoading ? "加载选项中…" : error ? "选项加载失败" : names.join("、") || "选择值"}
            </span>
          </PopoverTrigger>
          <PopoverContent variant="rich" side="bottom" align="start" positionMethod="fixed">
            <div className="w-64 max-w-[calc(100vw-3rem)]">
              <input
                type="search"
                aria-label={`搜索${field.name}选项`}
                placeholder="搜索选项"
                className={cn(CONTROL_CLASS, "mb-2 w-full")}
                value={search}
                disabled={disabled}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {shown.map((option) =>
                  multiple ? (
                    <div key={option.id} className="rounded-md px-1 py-1 hover:bg-layer-transparent-hover">
                      <Checkbox
                        label={`${option.name}${option.is_active ? "" : "（已停用）"}`}
                        checked={selected.includes(option.id)}
                        disabled={disabled}
                        stretch="full"
                        onCheckedChange={(checked) =>
                          onChange(checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))
                        }
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      key={option.id}
                      aria-pressed={selected.includes(option.id)}
                      disabled={disabled}
                      className="block w-full rounded-md px-2 py-2 text-left text-body-xs-regular text-primary hover:bg-layer-transparent-hover"
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      {option.name}
                      {option.is_active ? "" : "（已停用）"}
                    </button>
                  )
                )}
                {!shown.length && <p className="py-3 text-center text-body-xs-regular text-tertiary">没有可选项</p>}
              </div>
              {multiple && (
                <div className="mt-2 flex items-center justify-between border-t border-subtle pt-2 text-caption-md-regular text-secondary">
                  <span>已选择 {selected.length} 项</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    stretch="auto"
                    label="确定"
                    disabled={disabled}
                    onClick={() => setOpen(false)}
                  />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {!!error && (
          <p role="alert" className="mt-1 text-caption-sm-regular text-danger-primary">
            选项加载失败，请刷新重试
          </p>
        )}
        {selected.some((id) => options && !options.some((option) => option.id === id)) && !isLoading && !error && (
          <p role="alert" className="mt-1 text-caption-sm-regular text-danger-primary">
            包含已失效的选项，请重新选择
          </p>
        )}
      </div>
    );
  }
  const numeric = field.type === "integer" || field.type === "decimal";
  const range = isPanelRange(row.operator);
  const values = range ? (Array.isArray(row.value) ? row.value : [row.value, ""]) : [scalar];
  return (
    <div className="flex min-w-0 items-center gap-1">
      {(range ? [0, 1] : [0]).map((index) => (
        <input
          key={index}
          aria-label={`${field.name}${range ? (index === 0 ? "起始值" : "结束值") : "的值"}`}
          aria-invalid={invalid}
          className={cn(CONTROL_CLASS, "w-full")}
          type={numeric ? "number" : field.type === "date" ? "date" : "text"}
          step={field.type === "integer" ? "1" : numeric ? "any" : undefined}
          placeholder={range ? (index === 0 ? "起始值" : "结束值") : "输入值"}
          value={values[index] ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              range
                ? [
                    index === 0 ? event.target.value : (values[0] ?? ""),
                    index === 1 ? event.target.value : (values[1] ?? ""),
                  ]
                : event.target.value
            )
          }
        />
      ))}
    </div>
  );
});

type PanelProps = {
  workspaceSlug: string;
  projectId: string;
  filter: IWorkItemFilterInstance;
  disabled?: boolean;
  summaryTrigger?: boolean;
};

export const ProjectFilterPopover = observer(function ProjectFilterPopover(props: PanelProps) {
  const { workspaceSlug, projectId, filter, disabled = false, summaryTrigger = false } = props;
  const { fields, isLoading, error } = usePanelFields(workspaceSlug, projectId);
  const active = parsePanelExpression(filter.adapter.toExternal(filter.expression));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PanelDraft>(() => ({ join: active.join, rows: active.rows }));
  const [unsupported, setUnsupported] = useState(active.unsupported);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [unavailable, setUnavailable] = useState<Record<string, boolean>>({});
  const applying = filter.isApplying;
  const [applyError, setApplyError] = useState("");
  const onAvailabilityChange = useCallback(
    (id: string, value: boolean) =>
      setUnavailable((previous) => (previous[id] === value ? previous : { ...previous, [id]: value })),
    []
  );
  const setPanelOpen = (next: boolean) => {
    if (applying) return;
    if (next) {
      const current = parsePanelExpression(filter.adapter.toExternal(filter.expression));
      setDraft({ join: current.join, rows: current.rows });
      setUnsupported(current.unsupported);
      setErrors({});
      setApplyError("");
      setUnavailable({});
    }
    setOpen(next);
  };
  const updateRow = (id: string, patch: Partial<DraftFilterRow>) => {
    setDraft((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setApplyError("");
  };
  const apply = async () => {
    if (applying) return;
    const result = buildPanelExpression(draft, fields);
    setErrors(result.errors);
    if (!result.expression || unsupported) return;
    setApplyError("");
    let validationFailed = false;
    try {
      const expression = result.expression;
      await filter.applyExpression(expression, async () => {
        if (!Object.keys(expression).length) return;
        try {
          await issueService.getIssues(workspaceSlug, projectId, {
            filters: JSON.stringify(expression),
            per_page: "1",
          });
        } catch (validationError) {
          validationFailed = true;
          throw validationError;
        }
      });
      filter.toggleVisibility(true);
      setOpen(false);
    } catch {
      setApplyError(
        validationFailed
          ? "筛选条件验证失败，请检查字段和条件是否仍可用，或稍后重试。原筛选已保留"
          : "筛选保存失败，原筛选已保留，请重试"
      );
    }
  };
  const operationsDisabled = applying || isLoading || !!error;
  return (
    <Popover open={open} onOpenChange={setPanelOpen}>
      <PopoverTrigger
        disabled={disabled || applying}
        render={
          <button
            type="button"
            aria-label={summaryTrigger ? "编辑筛选" : `筛选（${active.count} 个条件）`}
            className={cn(
              "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-subtle px-2 text-body-xs-regular text-secondary hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-50",
              active.count > 0 && "border-accent-strong bg-accent-subtle text-accent-primary"
            )}
          />
        }
      >
        <FilterOutline className="size-4" aria-hidden="true" />
        <span>{summaryTrigger ? "编辑筛选" : "筛选"}</span>
        {!summaryTrigger && active.count > 0 && (
          <span className="rounded bg-accent-subtle-hover px-1 text-caption-md-medium">{active.count}</span>
        )}
      </PopoverTrigger>
      <PopoverContent variant="rich" side="bottom" align={summaryTrigger ? "start" : "end"} positionMethod="fixed">
        <div
          className="w-[650px] max-w-[calc(100vw-2rem)] whitespace-normal"
          aria-label="项目筛选条件"
          aria-busy={applying}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-body-sm-medium text-primary">筛选工作项</h3>
            <span className="text-caption-md-regular text-tertiary">{draft.rows.length} 个条件</span>
          </div>
          <div className="mb-3 flex items-center gap-2 text-body-xs-regular text-secondary">
            <span>满足以下</span>
            <PanelSelect
              label="条件组合方式"
              disabled={applying || unsupported}
              className="w-20 shrink-0"
              value={draft.join}
              options={JOIN_OPTIONS}
              onChange={(join) => setDraft((previous) => ({ ...previous, join: join as PanelDraft["join"] }))}
            />
            <span>条件的工作项</span>
          </div>
          {unsupported ? (
            <div
              role="alert"
              className="mb-3 rounded-md border border-subtle bg-layer-1 p-3 text-body-xs-regular text-secondary"
            >
              <p>当前筛选包含嵌套分组或暂不支持的条件，已完整保留。</p>
              <p className="mt-1">此面板支持一组“所有 / 任一”条件。若需重新设置，请先清空条件，再应用。</p>
            </div>
          ) : (
            <div className="max-h-[min(48vh,380px)] space-y-2 overflow-y-auto pr-1">
              {!draft.rows.length && (
                <div className="rounded-md border border-dashed border-subtle px-4 py-6 text-center text-body-xs-regular text-tertiary">
                  暂无条件，添加字段开始筛选
                </div>
              )}
              {draft.rows.map((row, index) => {
                const field = fields.find((item) => item.key === row.property);
                const rowError =
                  errors[row.id] ??
                  (!isLoading && row.property && !field ? "字段已停用、删除或不可用，请选择其他字段" : "");
                return (
                  <div
                    key={row.id}
                    className="rounded-md border border-subtle bg-layer-1 p-2"
                    aria-label={`条件 ${index + 1}`}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1.25fr)_24px] items-start gap-2 max-sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px]">
                      <FieldPicker
                        fields={fields}
                        value={row.property}
                        disabled={operationsDisabled}
                        onChange={(next) => {
                          const fresh = newDraftFilterRow(next);
                          updateRow(row.id, { property: fresh.property, operator: fresh.operator, value: fresh.value });
                        }}
                      />
                      <PanelSelect
                        label={`条件 ${index + 1} 的操作`}
                        placeholder="选择操作"
                        disabled={operationsDisabled || !field}
                        value={row.operator}
                        options={
                          !field
                            ? []
                            : [
                                ...(!getPanelOperators(field.type).includes(
                                  row.operator as ReturnType<typeof getPanelOperators>[number]
                                )
                                  ? [{ value: row.operator, label: "不支持的操作" }]
                                  : []),
                                ...getPanelOperators(field.type).map((operator) => ({
                                  value: operator,
                                  label: getPanelOperatorLabel(operator, field.type),
                                })),
                              ]
                        }
                        onChange={(operator) => {
                          updateRow(row.id, {
                            operator,
                            value: isPanelRange(operator) ? ["", ""] : isPanelMultiValue(operator) ? [] : "",
                          });
                        }}
                      />
                      <div className="min-w-0 max-sm:col-span-2 max-sm:row-start-2">
                        {field ? (
                          <ConditionValue
                            workspaceSlug={workspaceSlug}
                            projectId={projectId}
                            field={field}
                            row={row}
                            disabled={operationsDisabled}
                            invalid={!!rowError}
                            onChange={(value) => updateRow(row.id, { value })}
                            onAvailabilityChange={onAvailabilityChange}
                          />
                        ) : (
                          <input
                            aria-label={`条件 ${index + 1} 的值`}
                            disabled
                            placeholder="先选择字段"
                            className={cn(CONTROL_CLASS, "w-full")}
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`删除条件 ${index + 1}`}
                        disabled={applying}
                        className="grid size-7 place-items-center rounded-md text-tertiary hover:bg-layer-transparent-hover hover:text-danger-primary focus-visible:ring-2 focus-visible:ring-accent-strong max-sm:col-start-3 max-sm:row-start-1"
                        onClick={() =>
                          setDraft((previous) => ({
                            ...previous,
                            rows: previous.rows.filter((item) => item.id !== row.id),
                          }))
                        }
                      >
                        <CloseOutline className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {!!rowError && (
                      <p className="mt-1.5 text-caption-sm-regular text-danger-primary" role="alert">
                        {rowError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!unsupported && (
            <button
              type="button"
              disabled={operationsDisabled}
              className="mt-3 flex items-center gap-1.5 rounded-md px-1 py-1 text-body-xs-medium text-accent-primary focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-50"
              onClick={() => setDraft((previous) => ({ ...previous, rows: [...previous.rows, newDraftFilterRow()] }))}
            >
              <AddOutline className="size-4" aria-hidden="true" />
              添加条件
            </button>
          )}
          {(isLoading || !!error) && (
            <p
              className={cn("mt-2 text-caption-md-regular", error ? "text-danger-primary" : "text-tertiary")}
              role={error ? "alert" : "status"}
            >
              {error ? "字段加载失败，原筛选已保留，请刷新重试" : "正在加载项目字段…"}
            </p>
          )}
          <p className="mt-3 text-caption-sm-regular text-tertiary">
            应用后更新个人筛选。子工作项沿用当前树形展开规则。
          </p>
          {!!applyError && (
            <p role="alert" className="mt-2 text-body-xs-regular text-danger-primary">
              {applyError}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-subtle pt-3">
            <Button
              variant="ghost"
              size="sm"
              stretch="auto"
              label="清空条件"
              disabled={applying}
              onClick={() => {
                setDraft({ join: "and", rows: [] });
                setUnsupported(false);
                setErrors({});
                setApplyError("");
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label="取消"
                disabled={applying}
                onClick={() => setPanelOpen(false)}
              />
              <Button
                variant="primary"
                size="sm"
                stretch="auto"
                label={applying ? "应用中…" : "应用筛选"}
                disabled={operationsDisabled || unsupported || draft.rows.some((row) => unavailable[row.id])}
                onClick={() => void apply()}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});

const ConditionSummary = observer(function ConditionSummary({
  row,
  field,
  workspaceSlug,
  projectId,
}: {
  row: DraftFilterRow;
  field: PanelField;
  workspaceSlug: string;
  projectId: string;
}) {
  const { options, isLoading, error } = useCustomFieldOptions(workspaceSlug, projectId, optionDefinition(field));
  const values = Array.isArray(row.value) ? row.value : [row.value];
  const text = values
    .map((value) =>
      field.type === "boolean"
        ? value === "true"
          ? "是"
          : value === "false"
            ? "否"
            : "未设置"
        : isPanelChoice(field.type)
          ? (options?.find((option) => option.id === value)?.name ??
            (isLoading ? "加载中…" : error ? "选项加载失败" : "已失效的选项"))
          : value
    )
    .join(isPanelRange(row.operator) ? " 至 " : "、");
  const label = `${field.name} ${getPanelOperatorLabel(row.operator, field.type)}${isPanelEmpty(row.operator) ? "" : ` ${text}`}`;
  return (
    <span
      className="inline-flex max-w-80 items-center gap-1.5 rounded border border-subtle bg-surface-1 px-2 py-1"
      title={label}
    >
      <PanelFieldIcon field={field} />
      <span className="truncate">{label}</span>
    </span>
  );
});

export const ProjectFiltersSummaryRow = observer(function ProjectFiltersSummaryRow(
  props: PanelProps & { variant?: "modal" | "header" }
) {
  const { filter, workspaceSlug, projectId, disabled = false, variant = "header" } = props;
  const { fields, isLoading } = usePanelFields(workspaceSlug, projectId);
  const active = parsePanelExpression(filter.adapter.toExternal(filter.expression));
  const [updating, setUpdating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const applying = filter.isApplying;
  const [error, setError] = useState("");
  const update = async () => {
    setUpdating(true);
    try {
      await filter.updateView();
    } finally {
      setUpdating(false);
    }
  };
  const clear = async () => {
    if (applying) return;
    setClearing(true);
    setError("");
    try {
      await filter.applyExpression({});
    } catch {
      setError("清空失败，原筛选已保留，请重试");
    } finally {
      setClearing(false);
    }
  };
  const content = (
    <div className="flex w-full flex-wrap items-center gap-2 py-2 text-body-xs-regular text-secondary">
      <span className="shrink-0 text-caption-md-medium text-tertiary">
        {active.count} 个筛选条件{active.count > 1 ? ` · 满足${active.join === "and" ? "所有" : "任一"}` : ""}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {active.unsupported ? (
          <span>已保留复杂筛选</span>
        ) : !active.rows.length ? (
          <span className="text-tertiary">未设置筛选</span>
        ) : (
          active.rows.map((row) => {
            const field = fields.find((item) => item.key === row.property);
            return field ? (
              <ConditionSummary
                key={row.id}
                row={row}
                field={field}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
              />
            ) : (
              <span key={row.id} className="text-danger-primary">
                {isLoading ? "加载字段中…" : "已失效的字段条件（已保留）"}
              </span>
            );
          })
        )}
      </div>
      <ProjectFilterPopover {...props} disabled={disabled || applying} summaryTrigger />
      {active.count > 0 && (
        <Button
          variant="ghost"
          size="sm"
          stretch="auto"
          label={clearing ? "清空中…" : "清空"}
          disabled={disabled || applying}
          onClick={() => void clear()}
        />
      )}
      {!disabled && (
        <fieldset disabled={applying} className="contents">
          <RichFiltersViewControls
            save={{
              enabled: filter.canSaveView && !applying,
              label: filter.saveViewOptions?.label,
              onClick: filter.saveView,
            }}
            update={{
              enabled: filter.canUpdateView && !applying,
              isUpdating: updating,
              label: filter.updateViewOptions?.label,
              onClick: update,
            }}
          />
        </fieldset>
      )}
      {variant === "header" && (
        <button
          type="button"
          aria-label="收起筛选"
          disabled={applying}
          className="grid size-7 place-items-center rounded-md hover:bg-layer-transparent-hover focus-visible:ring-2 focus-visible:ring-accent-strong"
          onClick={() => filter.toggleVisibility(false)}
        >
          <ArrowCollapseOutline className="size-4" aria-hidden="true" />
        </button>
      )}
      {!!error && (
        <p role="alert" className="w-full text-danger-primary">
          {error}
        </p>
      )}
    </div>
  );
  return (
    <RowTransition show={filter.isVisible}>
      {variant === "modal" ? (
        <div className="rounded-lg bg-layer-1 px-3">{content}</div>
      ) : (
        <Header variant={EHeaderVariant.TERNARY} className="min-h-11 bg-surface-1 !px-3">
          {content}
        </Header>
      )}
    </RowTransition>
  );
});
