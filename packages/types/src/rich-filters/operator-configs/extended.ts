/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCoreFilterFieldConfigs } from "../field-types/core";
import type { TExtendedSupportedOperators } from "../operators/extended";

// ----------------------------- EXACT Operator -----------------------------
export type TExtendedExactOperatorConfigs = never;

// ----------------------------- IN Operator -----------------------------
export type TExtendedInOperatorConfigs = never;

// ----------------------------- RANGE Operator -----------------------------
export type TExtendedRangeOperatorConfigs = never;

// ----------------------------- Extended Operator Specific Configs -----------------------------
export type TExtendedOperatorSpecificConfigs = {
  [K in TExtendedSupportedOperators]: TCoreFilterFieldConfigs;
};
