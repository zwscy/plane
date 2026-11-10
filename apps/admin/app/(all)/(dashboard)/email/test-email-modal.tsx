/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { InputField } from "@makeplane/propel/components/input-field";
import { InstanceService } from "@plane/services";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
};

enum ESendEmailSteps {
  SEND_EMAIL = "SEND_EMAIL",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}

const instanceService = new InstanceService();

export function SendTestEmailModal(props: Props) {
  const { isOpen, handleClose } = props;

  // state
  const [receiverEmail, setReceiverEmail] = useState("");
  const [sendEmailStep, setSendEmailStep] = useState<ESendEmailSteps>(ESendEmailSteps.SEND_EMAIL);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // reset state
  const resetState = () => {
    setReceiverEmail("");
    setSendEmailStep(ESendEmailSteps.SEND_EMAIL);
    setIsLoading(false);
    setError("");
  };

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();

    setIsLoading(true);
    await instanceService
      .sendTestEmail(receiverEmail)
      .then(() => {
        setSendEmailStep(ESendEmailSteps.SUCCESS);
        return;
      })
      .catch((err) => {
        setError(err?.error || "无法发送测试邮件，请检查 SMTP 配置后重试。");
        setSendEmailStep(ESendEmailSteps.FAILED);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <Dialog
      open={isOpen}
      // The legacy Headless UI dialog closed on outside click and Escape (critic C2): keep both.
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      // Reset once the close animation has finished so the content does not flip while fading out.
      onOpenChangeComplete={(open) => {
        if (!open) resetState();
      }}
    >
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>
                {sendEmailStep === ESendEmailSteps.SEND_EMAIL
                  ? "发送测试邮件"
                  : sendEmailStep === ESendEmailSteps.SUCCESS
                    ? "发送请求已提交"
                    : "发送失败"}
              </DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            {sendEmailStep === ESendEmailSteps.SEND_EMAIL && (
              <InputField
                id="receiver_email"
                type="email"
                size="lg"
                orientation="vertical"
                label="收件邮箱"
                value={receiverEmail}
                onChange={(e) => setReceiverEmail(e.target.value)}
                placeholder="请输入接收测试邮件的邮箱地址"
                autoComplete="email"
                tabIndex={0}
              />
            )}
            {sendEmailStep === ESendEmailSteps.SUCCESS && (
              <div className="flex flex-col gap-y-4 text-body-xs-regular">
                <p>已提交向 {receiverEmail} 发送测试邮件的请求。请在收件箱或垃圾邮件文件夹中确认是否收到。</p>
                <p>若仍未收到，请检查 SMTP 配置后重新测试。</p>
              </div>
            )}
            {sendEmailStep === ESendEmailSteps.FAILED && <div className="text-body-xs-regular">{error}</div>}
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            onClick={handleClose}
            tabIndex={0}
            label={sendEmailStep === ESendEmailSteps.SEND_EMAIL ? "取消" : "关闭"}
          />
          {sendEmailStep === ESendEmailSteps.SEND_EMAIL && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              loading={isLoading}
              onClick={handleSubmit}
              tabIndex={0}
              label={isLoading ? "正在发送邮件" : "发送邮件"}
            />
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
