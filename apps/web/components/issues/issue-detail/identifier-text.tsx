/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { setToast } from "@plane/blocks/toast";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import type { TIdentifierTextProps, TIdentifierTextVariant, TIssueIdentifierSize } from "@plane/types";
import { cn } from "@plane/utils";
import { useTranslation } from "@plane/i18n";

const SIZE_MAP: Record<TIssueIdentifierSize, string> = {
  xs: "text-caption-md-medium",
  sm: "text-caption-md-medium",
  md: "text-caption-md-medium",
  lg: "text-caption-md-medium",
};

const VARIANT_MAP: Record<TIdentifierTextVariant, string> = {
  default: "text-tertiary",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  primary: "text-primary",
  "primary-subtle": "text-primary/80",
  success: "text-success-primary",
};

export function IdentifierText(props: TIdentifierTextProps) {
  const { t } = useTranslation();
  const { identifier, enableClickToCopyIdentifier = false, size = "lg", variant = "default" } = props;
  // handlers
  const handleCopyIssueIdentifier = () => {
    if (enableClickToCopyIdentifier) {
      navigator.clipboard
        .writeText(identifier)
        .then(() => {
          setToast({
            type: "success",
            title: t("power_k.contextual_actions.work_item.copy_id_toast_success"),
          });
          return;
        })
        .catch(() => {
          console.error("Failed to copy work item ID");
        });
    }
  };

  const textSizeClassName = SIZE_MAP[size];
  const variantClassName = VARIANT_MAP[variant];

  if (!enableClickToCopyIdentifier) {
    return (
      <span
        className={cn("text-caption-md-medium whitespace-nowrap text-tertiary", textSizeClassName, variantClassName)}
      >
        {identifier}
      </span>
    );
  }

  return (
    <Tooltip label={t("common.ui.click_to_copy")} disabled={!enableClickToCopyIdentifier}>
      <button
        type="button"
        className={cn("text-caption-md-medium whitespace-nowrap text-tertiary", textSizeClassName, variantClassName, {
          "cursor-pointer": enableClickToCopyIdentifier,
        })}
        onClick={handleCopyIssueIdentifier}
        disabled={!enableClickToCopyIdentifier}
      >
        {identifier}
      </button>
    </Tooltip>
  );
}
