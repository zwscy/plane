# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import (
    BigIntegerField,
    BooleanField,
    Case,
    CharField,
    DateField,
    DecimalField,
    F,
    Func,
    IntegerField,
    OuterRef,
    Subquery,
    Value,
    When,
)
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Cast, NullIf
from rest_framework.exceptions import ValidationError

from plane.db.models import Cycle, EstimatePoint, ProjectCustomField, ProjectMember, State
from plane.utils.custom_fields import MULTI_TYPES, canonical_uuid

ORDER_ALIAS = "_custom_field_order"


def order_custom_field(queryset, order_by, project_id):
    descending = order_by.startswith("-")
    key = order_by[1:] if descending else order_by
    raw_id = key.removeprefix("custom_fields__")
    try:
        field_id = canonical_uuid(raw_id)
    except (ValueError, TypeError, AttributeError):
        raise ValidationError({"order_by": "Invalid custom field ordering key."})
    field = ProjectCustomField.objects.filter(pk=field_id, project_id=project_id, is_active=True).first()
    if field is None or field.field_type in MULTI_TYPES:
        raise ValidationError({"order_by": "Ordering requires an active single-valued field in this project."})
    # A UUID is always a JSON key parameter, never an interpolated ORM lookup.
    queryset = queryset.annotate(_custom_raw=KeyTransform(field_id, "custom_fields"))
    value = Case(
        When(_custom_raw__in=[None, [], {}], then=Value(None)),
        default=NullIf(KeyTextTransform(field_id, "custom_fields"), Value("")),
        output_field=CharField(),
    )
    kind = field.field_type
    if kind == "integer":
        expression = Cast(value, BigIntegerField())
    elif kind == "decimal":
        expression = Func(value, template="(%(expressions)s)::numeric", output_field=DecimalField())
    elif kind == "date":
        expression = Cast(value, DateField())
    elif kind == "boolean":
        expression = Cast(value, BooleanField())
    elif kind in {"select", "priority"}:
        sequence = (
            [option["id"] for option in field.options]
            if kind == "select"
            else ["urgent", "high", "medium", "low", "none"]
        )
        queryset = queryset.annotate(_custom_field_value=value)
        expression = Case(
            *[When(_custom_field_value=item, then=Value(index)) for index, item in enumerate(sequence)],
            default=Value(None),
            output_field=IntegerField(),
        )
    elif kind in {"state", "member", "cycle", "estimate"}:
        queryset = queryset.annotate(_custom_field_value=value)
        model, sort_key = {
            "state": (State, "sequence"),
            "member": (ProjectMember, "member__display_name"),
            "cycle": (Cycle, "sort_order"),
            "estimate": (EstimatePoint, "key"),
        }[kind]
        id_key = "member_id" if kind == "member" else "id"
        references = (
            model.all_objects.filter(project_id=project_id)
            .annotate(_reference_id=Cast(id_key, CharField()))
            .filter(_reference_id=OuterRef("_custom_field_value"))
            .order_by("id")
        )
        expression = Subquery(references.values(sort_key)[:1])
    else:
        expression = value
    queryset = queryset.annotate(**{ORDER_ALIAS: expression})
    ordering = F(ORDER_ALIAS).desc(nulls_last=True) if descending else F(ORDER_ALIAS).asc(nulls_last=True)
    return queryset.order_by(ordering, "sequence_id", "id"), ("-" if descending else "") + ORDER_ALIAS
