/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
// types
import { Button } from "@makeplane/propel/components/button";
import { Select, SelectContent, SelectItem, SelectList, SelectTrigger } from "@makeplane/propel/components/select";
import type { IFormattedInstanceConfiguration, TInstanceEmailConfigurationKeys } from "@plane/types";
// components
import type { TControllerInputFormField } from "@/components/common/controller-input";
import { ControllerInput } from "@/components/common/controller-input";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useInstance } from "@/hooks/store";
// local components
import { SendTestEmailModal } from "./test-email-modal";

type IInstanceEmailForm = {
  config: IFormattedInstanceConfiguration;
};

type EmailFormValues = Record<TInstanceEmailConfigurationKeys, string>;

type TEmailSecurityKeys = "EMAIL_USE_TLS" | "EMAIL_USE_SSL" | "NONE";

const EMAIL_SECURITY_OPTIONS: { [key in TEmailSecurityKeys]: string } = {
  EMAIL_USE_TLS: "TLS（STARTTLS）",
  EMAIL_USE_SSL: "SSL",
  NONE: "不加密",
};

export function InstanceEmailForm(props: IInstanceEmailForm) {
  const { config } = props;
  const emailSecurityLabelId = useId();
  // states
  const [isSendTestEmailModalOpen, setIsSendTestEmailModalOpen] = useState(false);
  // store hooks
  const { updateInstanceConfigurations } = useInstance();
  // form data
  const {
    handleSubmit,
    watch,
    setValue,
    control,
    reset,
    formState: { errors, isValid, isDirty, isSubmitting },
  } = useForm<EmailFormValues>({
    defaultValues: {
      EMAIL_HOST: config["EMAIL_HOST"],
      EMAIL_PORT: config["EMAIL_PORT"],
      EMAIL_HOST_USER: config["EMAIL_HOST_USER"],
      EMAIL_HOST_PASSWORD: config["EMAIL_HOST_PASSWORD"],
      EMAIL_USE_TLS: config["EMAIL_USE_TLS"],
      EMAIL_USE_SSL: config["EMAIL_USE_SSL"],
      EMAIL_FROM: config["EMAIL_FROM"],
      ENABLE_SMTP: config["ENABLE_SMTP"],
    },
  });
  const emailFormFields: TControllerInputFormField<EmailFormValues>[] = [
    {
      key: "EMAIL_HOST",
      type: "text",
      label: "SMTP 服务器",
      placeholder: "smtp.qq.com",
      error: Boolean(errors.EMAIL_HOST),
      required: true,
    },
    {
      key: "EMAIL_PORT",
      type: "text",
      label: "端口",
      placeholder: "465 或 587",
      error: Boolean(errors.EMAIL_PORT),
      required: true,
    },
    {
      key: "EMAIL_FROM",
      type: "text",
      label: "发件邮箱",
      description: "收件人看到的发件地址。请填写可用于 SMTP 发信的邮箱地址。",
      placeholder: "例如：name@qq.com",
      error: Boolean(errors.EMAIL_FROM),
      required: true,
    },
  ];

  const OptionalEmailFormFields: TControllerInputFormField<EmailFormValues>[] = [
    {
      key: "EMAIL_HOST_USER",
      type: "text",
      label: "SMTP 用户名",
      placeholder: "例如：name@qq.com",
      error: Boolean(errors.EMAIL_HOST_USER),
      required: false,
    },
    {
      key: "EMAIL_HOST_PASSWORD",
      type: "password",
      label: "密码或授权码",
      placeholder: "请输入密码或邮箱授权码",
      error: Boolean(errors.EMAIL_HOST_PASSWORD),
      required: false,
    },
  ];

  const onSubmit = async (formData: EmailFormValues) => {
    const payload: Partial<EmailFormValues> = { ...formData, ENABLE_SMTP: "1" };

    try {
      await updateInstanceConfigurations(payload);
      // the saved values become the new baseline, so Save disables again until the next edit
      reset(payload);
      setToast({
        type: "success",
        title: "保存成功",
        message: "邮件设置已更新",
      });
    } catch (err) {
      console.error(err);
    }
  };

  const useTLSValue = watch("EMAIL_USE_TLS");
  const useSSLValue = watch("EMAIL_USE_SSL");
  const emailSecurityKey: TEmailSecurityKeys = useMemo(() => {
    if (useTLSValue === "1") return "EMAIL_USE_TLS";
    if (useSSLValue === "1") return "EMAIL_USE_SSL";
    return "NONE";
  }, [useTLSValue, useSSLValue]);

  const handleEmailSecurityChange = (key: TEmailSecurityKeys) => {
    if (key === "EMAIL_USE_SSL") {
      setValue("EMAIL_USE_TLS", "0", { shouldDirty: true });
      setValue("EMAIL_USE_SSL", "1", { shouldDirty: true });
    }
    if (key === "EMAIL_USE_TLS") {
      setValue("EMAIL_USE_TLS", "1", { shouldDirty: true });
      setValue("EMAIL_USE_SSL", "0", { shouldDirty: true });
    }
    if (key === "NONE") {
      setValue("EMAIL_USE_TLS", "0", { shouldDirty: true });
      setValue("EMAIL_USE_SSL", "0", { shouldDirty: true });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <SendTestEmailModal isOpen={isSendTestEmailModalOpen} handleClose={() => setIsSendTestEmailModalOpen(false)} />
        <div className="grid-col grid w-full max-w-4xl grid-cols-1 items-start justify-between gap-10 lg:grid-cols-2">
          {emailFormFields.map((field) => (
            <ControllerInput
              key={field.key}
              control={control}
              type={field.type}
              name={field.key}
              label={field.label}
              description={field.description}
              placeholder={field.placeholder}
              error={field.error}
              required={field.required}
            />
          ))}
          <div className="flex flex-col gap-1">
            <span id={emailSecurityLabelId} className="text-body-xs-medium text-primary">
              加密方式
            </span>
            <Select
              items={EMAIL_SECURITY_OPTIONS}
              value={emailSecurityKey}
              onValueChange={(value) => handleEmailSecurityChange(value as TEmailSecurityKeys)}
            >
              <SelectTrigger
                variant="secondary"
                size="lg"
                placeholder="请选择加密方式"
                aria-labelledby={emailSecurityLabelId}
              />
              <SelectContent>
                <SelectList>
                  {Object.entries(EMAIL_SECURITY_OPTIONS).map(([key, value]) => (
                    <SelectItem key={key} value={key} label={value} size="lg" />
                  ))}
                </SelectList>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="my-6 flex flex-col gap-6 border-t border-subtle pt-4">
          <div className="flex w-full max-w-xl flex-col gap-y-10 px-1">
            <div className="mr-8 flex items-center gap-10 pt-4">
              <div className="grow">
                <div className="text-body-xs-medium text-primary">身份验证</div>
                <div className="text-caption-sm-regular text-tertiary">
                  SMTP 服务器需要身份验证时，请填写发件账号和密码或邮箱授权码。
                </div>
              </div>
            </div>
          </div>
          <div className="grid-col grid w-full max-w-4xl grid-cols-1 items-center justify-between gap-10 lg:grid-cols-2">
            {OptionalEmailFormFields.map((field) => (
              <ControllerInput
                key={field.key}
                control={control}
                type={field.type}
                name={field.key}
                label={field.label}
                description={field.description}
                placeholder={field.placeholder}
                error={field.error}
                required={field.required}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex max-w-4xl items-center gap-4 py-1">
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          onClick={handleSubmit(onSubmit)}
          loading={isSubmitting}
          disabled={!isValid || !isDirty}
          label={isSubmitting ? "正在保存" : "保存更改"}
        />
        <Button
          variant="secondary"
          size="md"
          stretch="auto"
          onClick={() => setIsSendTestEmailModalOpen(true)}
          loading={isSubmitting}
          disabled={!isValid}
          label="发送测试邮件"
        />
      </div>
    </div>
  );
}
