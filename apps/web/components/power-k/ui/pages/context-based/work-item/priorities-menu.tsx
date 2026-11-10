/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Command } from "cmdk";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// plane imports
import { ISSUE_PRIORITIES } from "@plane/constants";
import { PriorityIcon } from "@plane/blocks/icons";
import type { TIssue, TIssuePriorities } from "@plane/types";
// local imports
import { PowerKModalCommandItem } from "../../../modal/command-item";

type Props = {
  handleSelect: (priority: TIssuePriorities) => void;
  workItemDetails: TIssue;
};

export const PowerKWorkItemPrioritiesMenu = observer(function PowerKWorkItemPrioritiesMenu(props: Props) {
  const { t } = useTranslation();
  const { handleSelect, workItemDetails } = props;

  return (
    <Command.Group>
      {ISSUE_PRIORITIES.map((priority) => (
        <PowerKModalCommandItem
          key={priority.key}
          iconNode={<PriorityIcon priority={priority.key} />}
          label={t(priority.key)}
          isSelected={priority.key === workItemDetails.priority}
          onSelect={() => handleSelect(priority.key)}
        />
      ))}
    </Command.Group>
  );
});
