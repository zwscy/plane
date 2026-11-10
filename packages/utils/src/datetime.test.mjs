/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateTimeAgo,
  calculateTimeAgoShort,
  convertMinutesToHoursMinutesString,
  formatDuration,
  formatDateRange,
  getDate,
  getDateDisplayLocale,
  renderFormattedDate,
  renderFormattedPayloadDate,
  renderFormattedTime,
} from "./datetime.ts";

test("Chinese human-readable dates use Chinese order and month/day names", () => {
  assert.equal(renderFormattedDate("2026-11-10", undefined, "zh-CN"), "2026年11月10日");
  assert.equal(renderFormattedDate("2026-11-10", "MMM dd", "zh-CN"), "11月10日");
  assert.equal(renderFormattedDate("2026-11-10", "EEEE", "zh-CN"), "星期二");
  assert.equal(renderFormattedDate("2026-11-10", undefined, "en"), "Nov 10, 2026");
});

test("Chinese locale preserves numeric date preferences and payload dates", () => {
  for (const [token, expected] of [
    ["yyyy-MM-dd", "2026-11-10"],
    ["dd/MM/yyyy", "10/11/2026"],
    ["MM/dd/yyyy", "11/10/2026"],
    ["yyyy/MM/dd", "2026/11/10"],
  ]) {
    assert.equal(renderFormattedDate("2026-11-10", token, "zh-CN"), expected);
  }
  assert.equal(renderFormattedPayloadDate("2026-11-10"), "2026-11-10");
});

test("date-only and timestamp task dates retain the calendar day across timezones", () => {
  assert.equal(renderFormattedDate("2026-11-10T00:30:00+14:00", undefined, "zh-CN"), "2026年11月10日");
  assert.equal(renderFormattedPayloadDate("2026-11-10T00:30:00+14:00"), "2026-11-10");
  assert.equal(getDate("2026-11-10")?.getDate(), 10);
});

test("missing and malformed dates stay empty and valid times retain their local value", () => {
  for (const value of [undefined, null, "", "not-a-date", new Date(NaN)]) {
    assert.equal(renderFormattedDate(value, undefined, "zh-CN"), undefined);
    assert.equal(renderFormattedPayloadDate(value), undefined);
  }
  const localAfternoon = new Date(2026, 10, 10, 13, 25);
  assert.equal(renderFormattedTime(localAfternoon, "24-hour", "zh-CN"), "13:25");
  assert.equal(renderFormattedTime(localAfternoon, "12-hour", "zh-CN"), "下午 01:25");
  assert.equal(renderFormattedTime(localAfternoon, "12-hour", "en"), "01:25 PM");
});

test("Chinese date ranges retain both endpoints over month and year boundaries", () => {
  assert.equal(formatDateRange(getDate("2026-11-10"), getDate("2026-11-14"), "zh-CN"), "2026年11月10日 - 14日");
  assert.equal(formatDateRange(getDate("2026-11-30"), getDate("2026-12-02"), "zh-CN"), "2026年11月30日 - 12月2日");
  assert.equal(formatDateRange(getDate("2026-12-31"), getDate("2027-01-02"), "zh-CN"), "2026年12月31日 - 2027年1月2日");
  assert.equal(formatDateRange(null, getDate("2026-11-10"), "zh-CN"), "2026年11月10日");
  assert.equal(formatDateRange(undefined, null, "zh-CN"), "");
  assert.equal(formatDateRange(getDate("2026-11-10"), getDate("2026-11-14"), "en"), "Nov 10 - 14, 2026");
});

test("relative timestamps use Chinese units and reject invalid inputs safely", () => {
  assert.match(calculateTimeAgo(new Date(Date.now() - 5 * 60 * 1000), "zh-CN"), /5 分钟前/);
  assert.equal(calculateTimeAgo("not-a-date", "zh-CN"), "");
  assert.equal(calculateTimeAgo(null, "zh-CN"), "");
});

test("short elapsed times and durations use Chinese units without changing their values", () => {
  assert.equal(calculateTimeAgoShort(new Date(Date.now() - 5 * 60 * 1000), "zh-CN"), "5分钟");
  assert.equal(calculateTimeAgoShort(new Date(Date.now() - 5 * 60 * 1000), "en"), "5m");
  assert.equal(calculateTimeAgoShort("invalid", "zh-CN"), "");
  assert.equal(formatDuration(3665, "zh-CN"), "1 小时 1 分钟 5 秒");
  assert.equal(formatDuration(0, "zh-CN"), "0 秒");
  assert.equal(formatDuration(0.125, "zh-CN"), "125.00 毫秒");
  assert.equal(formatDuration(3665, "en"), "1 hr 1 min 5 sec");
  assert.equal(convertMinutesToHoursMinutesString(125, "zh-CN"), "2小时 5分钟 ");
});

test("implicit locale follows userLanguage with safe document and server fallbacks", () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { getItem: () => "zh-CN" } },
    });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "en" } } });
    assert.equal(getDateDisplayLocale(), "zh-CN");
    assert.equal(renderFormattedDate("2026-11-10"), "2026年11月10日");
    assert.equal(renderFormattedPayloadDate("2026-11-10"), "2026-11-10");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error("unavailable");
        },
      },
    });
    assert.equal(getDateDisplayLocale(), "en");
    delete globalThis.window;
    delete globalThis.document;
    assert.equal(getDateDisplayLocale(), "en");
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else delete globalThis.window;
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete globalThis.document;
  }
});
