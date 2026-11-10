/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { CalendarLabels } from "@makeplane/propel/components/calendar";
import { formatDateForDisplay, isChineseDateLocale } from "@plane/utils";

/** date-fns supplies date names; the calendar's navigation and selection labels also need translations. */
export function getDatePickerLabels(
  locale: string,
  t: (key: string, params?: Record<string, unknown>) => string
): CalendarLabels | undefined {
  if (!isChineseDateLocale(locale)) return undefined;
  return {
    labelPrevious: () => t("date_picker.previous_month"),
    labelNext: () => t("date_picker.next_month"),
    labelPreviousYear: () => t("date_picker.previous_year"),
    labelNextYear: () => t("date_picker.next_year"),
    labelPreviousYearPage: () => t("date_picker.previous_year_page"),
    labelNextYearPage: () => t("date_picker.next_year_page"),
    labelMonthDropdown: () => t("date_picker.choose_month"),
    labelYearDropdown: () => t("date_picker.choose_year"),
    labelMonthView: (year) => t("date_picker.choose_month_for_year", { year }),
    labelYearView: (firstYear, lastYear) => t("date_picker.choose_year_range", { firstYear, lastYear }),
    labelNav: () => t("date_picker.navigation"),
    labelGrid: (date) => formatDateForDisplay(date, "MMMM yyyy", locale),
    labelDayButton: (date, modifiers) => {
      let label = formatDateForDisplay(date, "PPPP", locale);
      if (modifiers.today) label = `${t("common.today")}，${label}`;
      if (modifiers.selected) label = `${label}，${t("date_picker.selected")}`;
      return label;
    },
  };
}

/** The default trigger label format — a short, unambiguous day. Overridden by `formatToken`. */
export const DEFAULT_DATE_FORMAT_TOKEN = "MMM dd, yyyy";

/**
 * Turns a `minDate` / `maxDate` pair into propel `Calendar` day matchers. Both bounds are
 * inclusive, so they become "before min" / "after max" exclusions rather than the bounds
 * themselves. Typed structurally — react-day-picker's `Matcher` reaches this package only through
 * propel, so it is not imported here.
 */
export function buildDisabledMatchers(
  minDate?: Date,
  maxDate?: Date
): ({ before: Date } | { after: Date })[] | undefined {
  if (!minDate && !maxDate) return undefined;
  const matchers: ({ before: Date } | { after: Date })[] = [];
  if (minDate) matchers.push({ before: minDate });
  if (maxDate) matchers.push({ after: maxDate });
  return matchers;
}
