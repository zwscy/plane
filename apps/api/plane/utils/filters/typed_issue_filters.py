# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Allowlisted typed issue predicates, composed as permission-scoped PK subqueries."""

from datetime import date
import math

from django.db.models import Case, CharField, DecimalField, Func, Q, Value, When
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from rest_framework.exceptions import ValidationError

from plane.db.models import (
    Cycle,
    EstimatePoint,
    Issue,
    Label,
    Module,
    ProjectCustomField,
    ProjectMember,
    State,
    StateGroup,
)
from plane.utils.custom_fields import MULTI_TYPES, canonical_uuid

EMPTY_OPERATORS = {"is_empty", "is_not_empty"}
MEMBERSHIP_OPERATORS = {"in", "not_in", "contains_all"}
RANGE_OPERATORS = {"range", "not_range"}
BASIC_OPERATORS = {"exact", "not_exact", "in", "not_in"} | EMPTY_OPERATORS
ORDERED_OPERATORS = BASIC_OPERATORS | {"gt", "gte", "lt", "lte"} | RANGE_OPERATORS
TEXT_OPERATORS = BASIC_OPERATORS | {"icontains", "not_icontains"}
OPERATORS = ORDERED_OPERATORS | TEXT_OPERATORS | {"contains_all"}

# Public property names map to fixed ORM paths; user input never supplies a lookup.
BUILTINS = {
    "name": ("text", "name"),
    "priority": ("priority", "priority"),
    "state_group": ("state_group", "state__group"),
    "state_id": ("uuid", "state_id"),
    "project_id": ("uuid", "project_id"),
    "created_by_id": ("uuid", "created_by_id"),
    "estimate_point": ("uuid", "estimate_point_id"),
    "start_date": ("date", "start_date"),
    "target_date": ("date", "target_date"),
    "created_at": ("date", "created_at__date"),
    "updated_at": ("date", "updated_at__date"),
    "is_draft": ("boolean", "is_draft"),
    "assignee_id": ("members", "issue_assignee__assignee_id"),
    "label_id": ("labels", "label_issue__label_id"),
    "module_id": ("modules", "issue_module__module_id"),
    "cycle_id": ("cycle", "issue_cycle__cycle_id"),
    "mention_id": ("members", "issue_mention__mention_id"),
    "subscriber_id": ("members", "issue_subscribers__subscriber_id"),
}


class TypedIssueFilters:
    def __init__(self, queryset, project_id):
        self.queryset = queryset
        self.project_id = project_id
        self.definitions = {}

    def supports_key(self, key):
        if not isinstance(key, str):
            return False
        if key.startswith("custom_fields__"):
            return True  # Full UUID, scope and operator validation occurs before evaluation.
        property_name, _, operator = key.partition("__")
        return property_name in BUILTINS and (not operator or operator in OPERATORS)

    def error(self, key, message):
        raise ValidationError({"message": message, "code": "invalid_typed_filter", "field": key})

    def build(self, key, value):
        custom = key.startswith("custom_fields__")
        if custom:
            parts = key.split("__")
            if len(parts) != 3 or parts[2] not in OPERATORS:
                self.error(key, "Expected custom_fields__<field UUID>__<supported operator>.")
            field_id, operator = parts[1:]
            try:
                canonical_uuid(field_id)
            except (ValueError, TypeError, AttributeError):
                self.error(key, "Custom field ID must be a canonical UUID.")
            if not self.project_id:
                self.error(key, "Custom field filtering requires a project endpoint.")
            if field_id not in self.definitions:
                self.definitions[field_id] = ProjectCustomField.objects.filter(
                    id=field_id, project_id=self.project_id, is_active=True
                ).first()
            definition = self.definitions[field_id]
            if definition is None:
                self.error(key, "Custom field must be active and belong to this project.")
            kind = definition.field_type
        else:
            property_name, _, operator = key.partition("__")
            operator = operator or "exact"
            kind, path = BUILTINS[property_name]
            definition = None

        multiple = kind in MULTI_TYPES
        if multiple:
            allowed = MEMBERSHIP_OPERATORS | EMPTY_OPERATORS
        elif kind in {"integer", "decimal", "date"}:
            allowed = ORDERED_OPERATORS
        elif kind in {"text", "textarea"}:
            allowed = TEXT_OPERATORS
        else:
            allowed = BASIC_OPERATORS
        # Existing native relation exact filters mean membership in the relation.
        if multiple and not custom:
            allowed = allowed | {"exact", "not_exact"}
        if operator not in allowed:
            self.error(key, f"Operator '{operator}' is not supported for {kind} fields.")

        if operator in EMPTY_OPERATORS:
            if value is not True:
                self.error(key, "Empty operators require the boolean true sentinel.")
            values = None
        else:
            array_operator = operator in MEMBERSHIP_OPERATORS | RANGE_OPERATORS
            if array_operator:
                values = value if isinstance(value, list) else value.split(",") if isinstance(value, str) else [value]
                if not values or any(item is None or item == "" for item in values):
                    self.error(key, "Expected a nonempty array or comma-separated value.")
                if operator in RANGE_OPERATORS and len(values) != 2:
                    self.error(key, "Ranges require exactly two bounds.")
                # CSV is retained for historical filters, including numeric ranges.
                if isinstance(value, str) and kind in {"integer", "decimal"}:
                    try:
                        values = [int(item) if kind == "integer" else float(item) for item in values]
                    except ValueError:
                        self.error(key, "Expected numeric CSV values.")
            else:
                if isinstance(value, (list, dict)):
                    self.error(key, "This operator requires a scalar value.")
                values = [value]
            self._validate_values(key, kind, values, definition)
            if operator in RANGE_OPERATORS and values[0] > values[1]:
                self.error(key, "Range lower bound must not exceed the upper bound.")

        if custom:
            predicate = self._custom_predicate(field_id, kind, operator, values)
        else:
            predicate = self._native_predicate(path, kind, operator, values)
        return predicate

    def _validate_values(self, key, kind, values, definition):
        for value in values:
            valid = True
            if kind in {"text", "textarea"}:
                valid = isinstance(value, str)
            elif kind == "integer":
                valid = type(value) is int and -(2**53 - 1) <= value <= 2**53 - 1
            elif kind == "decimal":
                try:
                    valid = type(value) in (int, float) and math.isfinite(value)
                except OverflowError:
                    valid = False
            elif kind == "boolean":
                valid = type(value) is bool
            elif kind == "date":
                try:
                    valid = isinstance(value, str) and date.fromisoformat(value).isoformat() == value
                except ValueError:
                    valid = False
            elif kind == "priority":
                valid = isinstance(value, str) and value in {choice[0] for choice in Issue.PRIORITY_CHOICES}
            elif kind == "state_group":
                valid = isinstance(value, str) and value in StateGroup.values
            else:
                try:
                    canonical_uuid(value)
                except (ValueError, TypeError, AttributeError):
                    valid = False
            if not valid:
                self.error(key, f"Invalid {kind} filter value.")
        if definition is None or kind in {"text", "textarea", "integer", "decimal", "boolean", "date", "priority"}:
            return
        if kind in {"select", "multi_select"}:
            # Disabled options remain queryable so historical values can be found.
            valid_ids = {option["id"] for option in definition.options}
        elif kind in {"member", "members"}:
            valid_ids = {
                str(item)
                for item in ProjectMember.all_objects.filter(
                    project_id=self.project_id, member_id__in=values
                ).values_list("member_id", flat=True)
            }
        else:
            model = {"labels": Label, "state": State, "cycle": Cycle, "modules": Module, "estimate": EstimatePoint}[
                kind
            ]
            valid_ids = {
                str(item)
                for item in model.all_objects.filter(project_id=self.project_id, id__in=values).values_list(
                    "id", flat=True
                )
            }
        if set(values) - valid_ids:
            self.error(key, "Filter options or references must belong to this project field.")

    def _matching_ids(self, queryset):
        # Subqueries avoid relation duplicates and keep all/any/not semantics stable.
        return Q(pk__in=queryset.order_by().values("pk"))

    def _custom_predicate(self, field_id, kind, operator, values):
        queryset = self.queryset.alias(_filter_raw=KeyTransform(field_id, "custom_fields"))
        if operator in EMPTY_OPERATORS:
            predicate = self._matching_ids(
                queryset.filter(
                    Q(_filter_raw__isnull=True) | Q(_filter_raw=None) | Q(_filter_raw="") | Q(_filter_raw=[])
                )
            )
            return ~predicate if operator == "is_not_empty" else predicate
        negative = operator in {"not_exact", "not_in", "not_icontains", "not_range"}
        positive = {"not_exact": "exact", "not_in": "in", "not_icontains": "icontains", "not_range": "range"}.get(
            operator, operator
        )
        if kind in MULTI_TYPES:
            condition = Q()
            if positive == "contains_all":
                condition = Q(_filter_raw__contains=values)
            else:
                for value in values:
                    condition |= Q(_filter_raw__contains=[value])
        elif positive in {"exact", "in"}:
            condition = Q(_filter_raw__in=values)
        else:
            if kind in {"integer", "decimal"}:
                # Guard casts with JSON type checks; historical malformed values cannot
                # cause SQL cast errors or compare as lexicographic strings.
                queryset = queryset.alias(
                    _filter_type=Func(
                        KeyTransform(field_id, "custom_fields"), function="jsonb_typeof", output_field=CharField()
                    )
                ).alias(
                    _filter_value=Case(
                        When(
                            _filter_type="number",
                            then=Func(
                                KeyTextTransform(field_id, "custom_fields"),
                                template="(%(expressions)s)::numeric",
                                output_field=DecimalField(),
                            ),
                        ),
                        default=Value(None),
                        output_field=DecimalField(),
                    )
                )
            else:
                # Canonical YYYY-MM-DD strings have calendar-date lexical ordering.
                queryset = queryset.alias(_filter_value=KeyTextTransform(field_id, "custom_fields"))
            condition = Q(**{f"_filter_value__{positive}": values if positive == "range" else values[0]})
        predicate = self._matching_ids(queryset.filter(condition))
        return ~predicate if negative else predicate

    def _native_predicate(self, path, kind, operator, values):
        relation = path.split("__")[0] if path.startswith(("issue_", "label_issue__")) else None
        queryset = self.queryset
        relation_condition = Q()
        if relation:
            relation_condition = Q(
                **{
                    f"{relation}__deleted_at__isnull": True,
                    f"{relation}__id__isnull": False,
                }
            )
        if operator in EMPTY_OPERATORS:
            if relation:
                predicate = ~self._matching_ids(queryset.filter(relation_condition))
            else:
                condition = Q(**{f"{path}__isnull": True})
                if kind in {"text", "textarea"}:
                    condition |= Q(**{path: ""})
                predicate = self._matching_ids(queryset.filter(condition))
            return ~predicate if operator == "is_not_empty" else predicate
        negative = operator in {"not_exact", "not_in", "not_icontains", "not_range"}
        positive = {"not_exact": "exact", "not_in": "in", "not_icontains": "icontains", "not_range": "range"}.get(
            operator, operator
        )
        if positive == "contains_all":
            predicate = Q()
            for value in values:
                predicate &= self._matching_ids(queryset.filter(relation_condition & Q(**{path: value})))
        else:
            value = values if positive in {"in", "range"} else values[0]
            predicate = self._matching_ids(queryset.filter(relation_condition & Q(**{f"{path}__{positive}": value})))
        return ~predicate if negative else predicate
