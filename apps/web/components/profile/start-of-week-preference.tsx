/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { SelectField } from "@makeplane/propel/components/select-field";
import { START_OF_THE_WEEK_OPTIONS } from "@plane/constants";
import { setToast } from "@plane/blocks/toast";
import type { EStartOfTheWeek } from "@plane/types";
// components
import { SettingsControlItem } from "@/components/settings/control-item";
// hooks
import { useUserProfile } from "@/hooks/store/user";
import { useTranslation } from "@plane/i18n";

export const StartOfWeekPreference = observer(function StartOfWeekPreference(props: {
  option: { title: string; description: string };
}) {
  const { t } = useTranslation();
  // hooks
  const { data: userProfile, updateUserProfile } = useUserProfile();

  const handleStartOfWeekChange = async (val: EStartOfTheWeek) => {
    try {
      await updateUserProfile({ start_of_the_week: val });
      setToast({
        type: "success",
        title: t("success"),
        message: t("common.ui.first_day_of_the_week_updated_successfully"),
      });
    } catch (_error) {
      setToast({ type: "error", title: t("common.ui.update_failed"), message: t("common.ui.please_try_again_later") });
    }
  };

  return (
    <SettingsControlItem
      title={props.option.title}
      description={props.option.description}
      control={
        <SelectField<EStartOfTheWeek>
          aria-label={props.option.title}
          size="md"
          width="fit"
          options={START_OF_THE_WEEK_OPTIONS}
          value={userProfile.start_of_the_week}
          onValueChange={(value) => {
            if (value !== null) void handleStartOfWeekChange(value);
          }}
        />
      }
    />
  );
});
