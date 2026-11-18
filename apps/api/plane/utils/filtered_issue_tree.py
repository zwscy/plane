# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from rest_framework.exceptions import ParseError

from plane.db.models import Issue
from plane.utils.issue_filters import issue_filters


TREE_GROUP_KEYS = {
    "state_id": "state",
    "priority": "priority",
    "cycle_id": "cycle",
    "issue_module__module_id": "module",
    "labels__id": "labels",
    "assignees__id": "assignees",
    "created_by": "created_by",
}


def tree_group_filters(query_params):
    """Scope a group continuation to root rows after matching all project levels."""
    field = query_params.get("tree_group_by")
    group_id = query_params.get("tree_group_id")
    if field is None and group_id is None:
        return {}
    if field not in TREE_GROUP_KEYS or not group_id:
        raise ParseError("Invalid filtered tree group.")
    if field == "priority":
        if group_id not in dict(Issue.PRIORITY_CHOICES):
            raise ParseError("Invalid filtered tree group.")
    elif group_id != "None" or field == "state_id":
        try:
            UUID(group_id)
        except ValueError as error:
            raise ParseError("Invalid filtered tree group.") from error
    return issue_filters({TREE_GROUP_KEYS[field]: group_id}, "GET")


@dataclass
class FilteredIssueTree:
    matches: set[UUID]
    roots: set[UUID]
    children: dict[UUID, list[UUID]]

    @classmethod
    def build(cls, accessible_issues, matching_issues):
        matches = set(matching_issues.order_by().values_list("id", flat=True))
        if not matches:
            return cls(set(), set(), {})

        parents = dict(accessible_issues.order_by().values_list("id", "parent_id"))
        matches.intersection_update(parents)
        visible = set()
        for match in sorted(matches):
            branch = set()
            current = match
            while current in parents and current not in visible:
                branch.add(current)
                visible.add(current)
                current = parents[current]
            # Existing data can contain a parent cycle. Break the cycle in this
            # response only so matching work can still be reached from a root.
            if current in branch:
                parents[current] = None

        roots = set()
        children = defaultdict(list)
        for issue_id in visible:
            parent_id = parents[issue_id]
            if parent_id in visible:
                children[parent_id].append(issue_id)
            else:
                roots.add(issue_id)
        return cls(matches, roots, children)

    def descendant_ids(self, root_ids):
        pending = list(root_ids)
        descendants = set()
        while pending:
            children = self.children.get(pending.pop(), ())
            pending.extend(children)
            descendants.update(children)
        return descendants


def result_issue_ids(results):
    """Read roots that actually survived the paginator's grouping."""
    if isinstance(results, list):
        return {item["id"] for item in results}
    return {issue_id for group in results.values() for issue_id in result_issue_ids(group["results"])}
