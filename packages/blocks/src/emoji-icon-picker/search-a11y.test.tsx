/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initPromise, setLanguage } from "@plane/i18n";
import { EmojiRoot } from "./emoji/emoji";
import { IconRoot } from "./icon/icon-root";

vi.mock("./icon/lucide-root", () => ({ LucideIconsList: () => null }));
vi.mock("./icon/material-root", () => ({ MaterialIconList: () => null }));

describe("emoji/icon picker search fields", () => {
  it("names the icon tab search with the translated label", () => {
    render(<IconRoot defaultColor="#6d7b8a" onChange={vi.fn()} iconType="material" />);
    // Assert the explicit attribute: the accessible-name algorithm would otherwise fall back to the placeholder.
    const search = screen.getByRole("textbox", { name: "Search" });
    expect(search.getAttribute("aria-label")).toBe("Search");
    expect(search.getAttribute("placeholder")).toBe("Search");
  });

  it("names the icon tab search with the caller's placeholder", () => {
    render(<IconRoot defaultColor="#6d7b8a" onChange={vi.fn()} iconType="lucide" searchPlaceholder="Find an icon" />);
    expect(screen.getByRole("textbox", { name: "Find an icon" }).getAttribute("aria-label")).toBe("Find an icon");
  });

  it("names the emoji tab search with the translated label", () => {
    render(<EmojiRoot onChange={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: "Search" }).getAttribute("aria-label")).toBe("Search");
  });
});

describe("icon picker contrast hint translations", () => {
  afterEach(async () => {
    await setLanguage("en");
  });

  it.each([
    ["en", "Colors will be adjusted to ensure sufficient contrast."],
    ["zh-CN", "颜色会自动调整，以确保足够的对比度。"],
    ["zh-TW", "顏色會自動調整，以確保足夠的對比度。"],
  ] as const)("resolves the actual %s runtime namespace", async (language, expected) => {
    await initPromise;
    await setLanguage(language);
    render(<IconRoot defaultColor="#6d7b8a" onChange={vi.fn()} iconType="lucide" />);
    expect(screen.getByText(expected)).toBeDefined();
    expect(screen.queryByText("common.color_picker.contrast_adjustment")).toBeNull();
  });
});
