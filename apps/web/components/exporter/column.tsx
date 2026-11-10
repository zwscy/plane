/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Avatar } from "@makeplane/propel/components/avatar";
import { Badge } from "@makeplane/propel/components/badge";
import { AnchorButton } from "@makeplane/propel/components/anchor-button";
import { Icon } from "@makeplane/propel/components/icon";
import { DownloadOutline } from "@makeplane/propel/icons";
import type { IExportData } from "@plane/types";
import { getDate, getFileURL, renderFormattedDate } from "@plane/utils";
import { useTranslation } from "@plane/i18n";

type RowData = IExportData;
const checkExpiry = (inputDateString: string) => {
  const currentDate = new Date();
  const expiryDate = getDate(inputDateString);
  if (!expiryDate) return false;
  expiryDate.setDate(expiryDate.getDate() + 7);
  return expiryDate > currentDate;
};
export const useExportColumns = () => {
  const { t } = useTranslation();
  const columns = [
    {
      key: "Exported By",
      content: t("common.ui.exported_by"),
      tdRender: (rowData: RowData) => {
        const { avatar_url, display_name, email } = rowData.initiated_by_detail;
        return (
          <div className="flex items-center gap-x-2">
            <Avatar
              size="2xs"
              src={avatar_url && avatar_url.trim() !== "" ? getFileURL(avatar_url) : undefined}
              alt={display_name || email}
              fallback={<span className="capitalize">{(email ?? display_name ?? "?")[0]}</span>}
            />
            <div>{display_name}</div>
          </div>
        );
      },
    },
    {
      key: "Exported On",
      content: t("common.ui.exported_on"),
      tdRender: (rowData: RowData) => <span>{renderFormattedDate(rowData.created_at)}</span>,
    },

    {
      key: "Exported projects",
      content: t("common.ui.exported_projects"),
      tdRender: (rowData: RowData) => (
        <div className="text-body-xs-regular">
          {rowData.project.length} {t("common.ui.project_s")}
        </div>
      ),
    },
    {
      key: "Format",
      content: t("workspace_settings.settings.exports.format"),
      tdRender: (rowData: RowData) => (
        <span className="text-body-xs-regular">
          {rowData.provider === "csv"
            ? "CSV"
            : rowData.provider === "xlsx"
              ? "Excel"
              : rowData.provider === "json"
                ? "JSON"
                : ""}
        </span>
      ),
    },
    {
      key: "Status",
      content: t("common.status"),
      tdRender: (rowData: RowData) => (
        <Badge
          size="sm"
          variant={
            rowData.status === "completed"
              ? "success"
              : rowData.status === "processing"
                ? "warning"
                : rowData.status === "failed"
                  ? "danger"
                  : rowData.status === "expired"
                    ? "orange"
                    : "neutral"
          }
          render={<span className="capitalize" />}
          label={rowData.status}
        />
      ),
    },
    {
      key: "Download",
      content: t("page_navigation_pane.tabs.assets.download_button"),
      tdRender: (rowData: RowData) =>
        checkExpiry(rowData.created_at) ? (
          <>
            {rowData.status == "completed" ? (
              <div className="flex flex-col">
                <AnchorButton
                  variant="primary"
                  size="md"
                  target="_blank"
                  href={rowData?.url}
                  rel="noopener noreferrer"
                  icon={<Icon icon={DownloadOutline} />}
                  label={t("page_navigation_pane.tabs.assets.download_button")}
                />
              </div>
            ) : (
              "-"
            )}
          </>
        ) : (
          <div className="text-caption-sm-regular text-danger-primary">
            {t("workspace_settings.settings.api_tokens.expired")}
          </div>
        ),
    },
  ];
  return columns;
};
