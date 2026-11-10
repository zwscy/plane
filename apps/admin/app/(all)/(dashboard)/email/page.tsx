/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Switch } from "@makeplane/propel/components/switch";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
import { Skeleton } from "@plane/blocks/skeleton";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useInstance } from "@/hooks/store";
// types
import type { Route } from "./+types/page";
// local
import { InstanceEmailForm } from "./email-config-form";

const InstanceEmailPage = observer(function InstanceEmailPage(_props: Route.ComponentProps) {
  // store
  const { fetchInstanceConfigurations, formattedConfig, disableEmail } = useInstance();

  const { isLoading } = useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSMTPEnabled, setIsSMTPEnabled] = useState(false);

  const handleToggle = async () => {
    if (isSMTPEnabled) {
      setIsSubmitting(true);
      try {
        await disableEmail();
        setIsSMTPEnabled(false);
        setToast({
          title: "邮件服务已停用",
          message: "邮件发送功能已停用",
          type: "success",
        });
      } catch (_error) {
        setToast({
          title: "停用邮件服务失败",
          message: "无法停用邮件服务，请重试。",
          type: "error",
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setIsSMTPEnabled(true);
  };
  useEffect(() => {
    if (formattedConfig) {
      setIsSMTPEnabled(formattedConfig.ENABLE_SMTP === "1");
    }
  }, [formattedConfig]);

  return (
    <PageWrapper
      header={{
        title: "邮件设置",
        description: (
          <>
            通过配置的 SMTP 服务器，向工作区成员发送邀请和通知邮件。
            <div className="text-body-xs-regular text-tertiary">
              请先保存配置，再发送测试邮件确认设置正确。&nbsp;
              <span className="text-danger-primary">配置错误可能导致退信或发送失败。</span>
            </div>
          </>
        ),
        actions: isLoading ? (
          <Skeleton>
            <Skeleton.Item width="24px" height="16px" className="rounded-full" />
          </Skeleton>
        ) : (
          <Switch
            aria-label="启用 SMTP 邮件服务"
            checked={isSMTPEnabled}
            onCheckedChange={handleToggle}
            size="sm"
            disabled={isSubmitting}
          />
        ),
      }}
    >
      {isSMTPEnabled && !isLoading && (
        <>
          {formattedConfig ? (
            <InstanceEmailForm config={formattedConfig} />
          ) : (
            <Skeleton className="space-y-10">
              <Skeleton.Item height="50px" width="75%" />
              <Skeleton.Item height="50px" width="75%" />
              <Skeleton.Item height="50px" width="40%" />
              <Skeleton.Item height="50px" width="40%" />
              <Skeleton.Item height="50px" width="20%" />
            </Skeleton>
          )}
        </>
      )}
    </PageWrapper>
  );
});

export const meta: Route.MetaFunction = () => [{ title: "邮件设置 - 管理后台" }];

export default InstanceEmailPage;
