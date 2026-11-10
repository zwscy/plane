/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";

export const EstimateSearch = observer(function EstimateSearch() {
  const { t } = useTranslation();
  // hooks
  const {} = {};

  return <div>{t("common.ui.estimate_search")}</div>;
});
