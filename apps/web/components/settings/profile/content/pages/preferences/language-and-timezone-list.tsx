/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { SelectField } from "@makeplane/propel/components/select-field";
import { SUPPORTED_LANGUAGES, useTranslation } from "@plane/i18n";
import { setToast } from "@plane/blocks/toast";
// components
import { TimezoneSelect } from "@/components/global/timezone-select";
import { StartOfWeekPreference } from "@/components/profile/start-of-week-preference";
import { SettingsControlItem } from "@/components/settings/control-item";
// hooks
import { useUser, useUserProfile } from "@/hooks/store/user";

export const ProfileSettingsLanguageAndTimezonePreferencesList = observer(
  function ProfileSettingsLanguageAndTimezonePreferencesList() {
    // store hooks
    const {
      data: user,
      updateCurrentUser,
      userProfile: { data: profile },
    } = useUser();
    const { updateUserProfile } = useUserProfile();
    // translation
    const { t } = useTranslation();

    const handleTimezoneChange = async (value: string) => {
      try {
        await updateCurrentUser({ user_timezone: value });
        setToast({
          title: t("toast.success"),
          message: t("power_k.preferences_actions.toast.timezone.success"),
          type: "success",
        });
      } catch (_error) {
        setToast({
          title: t("toast.error"),
          message: t("common.ui.failed_to_update_timezone"),
          type: "error",
        });
      }
    };

    const handleLanguageChange = async (value: string) => {
      try {
        await updateUserProfile({ language: value });
        setToast({
          title: t("toast.success"),
          message: t("common.ui.language_updated_successfully"),
          type: "success",
        });
      } catch (_error) {
        setToast({
          title: t("toast.error"),
          message: t("common.ui.failed_to_update_language"),
          type: "error",
        });
      }
    };

    return (
      <div className="flex flex-col gap-y-1">
        <SettingsControlItem
          title={t("timezone")}
          description={t("timezone_setting")}
          control={
            <TimezoneSelect
              value={user?.user_timezone || "Asia/Kolkata"}
              onChange={handleTimezoneChange}
              label={t("timezone")}
              size="md"
              width="fit"
              className="max-w-64"
            />
          }
        />
        <SettingsControlItem
          title={t("language")}
          description={t("language_setting")}
          control={
            <SelectField<string>
              aria-label={t("language")}
              size="md"
              width="fit"
              options={SUPPORTED_LANGUAGES}
              value={profile?.language ?? null}
              onValueChange={(value) => {
                if (value !== null) void handleLanguageChange(value);
              }}
              placeholder={t("common.ui.select_a_language")}
            />
          }
        />
        <StartOfWeekPreference
          option={{
            title: t("common.ui.first_day_of_the_week"),
            description: t("common.ui.this_will_change_how_all_calendars_in_your_app_look"),
          }}
        />
      </div>
    );
  }
);
