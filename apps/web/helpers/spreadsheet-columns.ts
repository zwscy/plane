/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const getOrderedSpreadsheetColumnKeys = (availableKeys: readonly string[], savedOrder?: unknown): string[] => {
  const remaining = new Set(availableKeys);
  const ordered: string[] = [];
  if (Array.isArray(savedOrder)) {
    for (const key of savedOrder) {
      if (typeof key === "string" && remaining.delete(key)) ordered.push(key);
    }
  }
  return [...ordered, ...remaining];
};

export const moveSpreadsheetColumn = (keys: readonly string[], key: string, direction: -1 | 1): string[] => {
  const index = keys.indexOf(key);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= keys.length) return [...keys];
  const reordered = [...keys];
  reordered.splice(index, 1);
  reordered.splice(destination, 0, key);
  return reordered;
};

export const reorderVisibleSpreadsheetColumns = (
  allKeys: readonly string[],
  reorderedShownKeys: readonly string[]
): string[] => {
  const all = [...new Set(allKeys)];
  const available = new Set(all);
  const shownKeys = [...new Set(reorderedShownKeys.filter((key) => available.has(key)))];
  const shown = new Set(shownKeys);
  let index = 0;
  // Replace shown slots only, so hidden fields keep their position when shown again.
  return all.map((key) => (shown.has(key) ? shownKeys[index++]! : key));
};
