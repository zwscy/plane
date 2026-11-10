/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";

import { useTheme } from "next-themes";
// ui
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
import { useTranslation } from "@plane/i18n";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function SwitchAccountModal(props: Props) {
  const { t } = useTranslation();
  const { isOpen, onClose } = props;
  // states
  const [switchingAccount, setSwitchingAccount] = useState(false);
  // router
  const router = useAppRouter();
  // store hooks
  const { data: userData, signOut } = useUser();

  const { setTheme } = useTheme();

  const handleClose = () => {
    setSwitchingAccount(false);
    onClose();
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);

    try {
      await signOut();
      setTheme("system");
      router.push("/");
      handleClose();
    } catch {
      setToast({
        type: "error",
        title: t("toast.error"),
        message: t("auth.sign_out.toast.error.message"),
      });
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      handleClose={handleClose}
      handleSubmit={handleSwitchAccount}
      isSubmitting={switchingAccount}
      variant="primary"
      title={t("common.ui.switch_account")}
      content={
        userData?.email ? (
          <>
            If you have signed up via <span className="text-accent-primary">{userData.email}</span> un-intentionally,
            you can switch your account to a different one from here.
          </>
        ) : null
      }
      primaryButtonText={{
        loading: t("sso.providers.switch_alert_modal.primary_button_text_loading"),
        default: "Switch account",
      }}
    />
  );
}
