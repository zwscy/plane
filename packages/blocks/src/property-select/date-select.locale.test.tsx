/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangeSelect } from "./date-range-select";
import { DateSelect } from "./date-select";

vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    currentLocale: "zh-CN",
    t: (key: string) =>
      ({ "date_picker.next_month": "下个月", "date_picker.selected": "已选择", "common.today": "今天" })[key] ?? key,
  }),
}));

describe("Chinese date selection", () => {
  it("localizes the trigger, calendar weekdays and navigation while retaining selected date values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateSelect value={new Date(2026, 10, 10)} onChange={onChange} variant="select-md" weekStartsOn={0} />);
    await user.click(screen.getByRole("button", { name: "2026年11月10日" }));
    for (const weekday of ["日", "一", "二", "三", "四", "五", "六"]) {
      expect(within(document.body).getByText(weekday)).toBeDefined();
    }
    expect(within(document.body).getByRole("button", { name: "下个月" })).toBeDefined();
    await user.click(within(document.body).getByRole("button", { name: /2026年11月12日/ }));
    const picked = onChange.mock.calls[0]?.[0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 10, 12]);
  });

  it("merges Chinese date ranges without leaving English date ordering", () => {
    render(
      <DateRangeSelect
        value={{ from: new Date(2026, 10, 10), to: new Date(2026, 10, 14) }}
        onChange={vi.fn()}
        variant="select-md"
        mergeDates
      />
    );
    expect(screen.getByRole("button", { name: "2026年11月10日 - 14日" })).toBeDefined();
  });

  it("respects numeric date preferences in Chinese range triggers", () => {
    render(
      <DateRangeSelect
        value={{ from: new Date(2026, 10, 10), to: new Date(2026, 10, 14) }}
        onChange={vi.fn()}
        variant="select-md"
        formatToken="yyyy/MM/dd"
        mergeDates
      />
    );
    expect(screen.getByRole("button", { name: "2026/11/10 - 14" })).toBeDefined();
  });
});
