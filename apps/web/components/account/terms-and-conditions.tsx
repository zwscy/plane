/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import Link from "next/link";
import { EAuthModes } from "@plane/constants";
import { useTranslation } from "@plane/i18n";

interface TermsAndConditionsProps {
  authType?: EAuthModes;
}

// Constants for better maintainability
const LEGAL_LINKS = {
  termsOfService: "https://plane.so/legals/terms-and-conditions",
  privacyPolicy: "https://plane.so/legals/privacy-policy",
} as const;

const MESSAGES = {
  [EAuthModes.SIGN_UP]: "common.ui.by_creating_an_account",
  [EAuthModes.SIGN_IN]: "common.ui.by_signing_in",
} as const;

// Reusable link component to reduce duplication
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-secondary" target="_blank" rel="noopener noreferrer">
      <span className="text-body-xs-medium underline hover:cursor-pointer">{children}</span>
    </Link>
  );
}

export function TermsAndConditions({ authType = EAuthModes.SIGN_IN }: TermsAndConditionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center">
      <p className="text-center text-body-xs-regular whitespace-pre-line text-tertiary">
        {t(MESSAGES[authType])}
        {t("common.ui.understand_and_agree_to")}{" "}
        <LegalLink href={LEGAL_LINKS.termsOfService}>{t("common.ui.terms_of_service")}</LegalLink>{" "}
        {t("automations.conjunctions.and")}{" "}
        <LegalLink href={LEGAL_LINKS.privacyPolicy}>{t("common.ui.privacy_policy")}</LegalLink>.
      </p>
    </div>
  );
}
