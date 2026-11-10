# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Resolve shared display settings without modifying preserved personal JSON."""

from copy import deepcopy
from uuid import UUID

from django.db import transaction
from rest_framework.exceptions import ValidationError

from plane.db.models import Project, ProjectCustomField, ProjectUserProperty
from plane.db.models.issue import get_default_display_filters, get_default_display_properties
from plane.utils.custom_fields import MULTI_TYPES
from plane.utils.order_queryset import ISSUE_ORDER_BY_ALLOWLIST

DISPLAY_PROPERTY_KEYS = frozenset(get_default_display_properties()) | {"modules", "cycle", "issue_type"}
MANAGED_FILTER_KEYS = {"order_by", "sub_issue"}


def merge_properties(original, delta):
    original = original if isinstance(original, dict) else {}
    merged = {**deepcopy(original), **deepcopy(delta)}
    if isinstance(delta.get("custom_fields"), dict):
        custom = original.get("custom_fields", {})
        merged["custom_fields"] = {**(custom if isinstance(custom, dict) else {}), **delta["custom_fields"]}
    return merged


def valid_custom_field(project_id, raw_id, sortable=False):
    try:
        field_id = str(UUID(raw_id))
    except (ValueError, TypeError, AttributeError):
        return False
    if field_id != raw_id:
        return False
    query = ProjectCustomField.objects.filter(project_id=project_id, pk=field_id, is_active=True)
    if sortable:
        query = query.exclude(field_type__in=MULTI_TYPES)
    return query.exists()


def valid_order_by(value, project_id):
    if not isinstance(value, str):
        return False
    key = value.removeprefix("-")
    if key.startswith("custom_fields__"):
        return valid_custom_field(project_id, key.removeprefix("custom_fields__"), sortable=True)
    return key in ISSUE_ORDER_BY_ALLOWLIST


def validate_properties(value, project_id, existing=None):
    if not isinstance(value, dict):
        raise ValidationError({"display_properties": "Expected an object."})
    for key, setting in value.items():
        if key in DISPLAY_PROPERTY_KEYS and type(setting) is not bool:
            raise ValidationError({"display_properties": f"Expected a boolean for {key}."})
        if (
            key == "custom_fields"
            and isinstance(setting, dict)
            and any(type(shown) is not bool for shown in setting.values())
        ):
            raise ValidationError({"display_properties": "Expected custom field visibility booleans."})
        # Personal full-object clients may echo historic keys or inactive fields.
        if existing is not None and key in existing and setting == existing[key]:
            continue
        if key in DISPLAY_PROPERTY_KEYS:
            valid = type(setting) is bool
        elif key == "column_order":
            valid = (
                isinstance(setting, list)
                and all(isinstance(column, str) for column in setting)
                and len(set(setting)) == len(setting)
                and all(
                    column in DISPLAY_PROPERTY_KEYS
                    or (
                        column.startswith("custom_fields__")
                        and valid_custom_field(project_id, column.removeprefix("custom_fields__"))
                    )
                    for column in setting
                )
            )
        elif key == "custom_fields":
            valid = isinstance(setting, dict) and all(
                type(shown) is bool
                and (
                    (
                        existing is not None
                        and isinstance(existing.get("custom_fields"), dict)
                        and existing["custom_fields"].get(field_id) == shown
                    )
                    or valid_custom_field(project_id, field_id)
                )
                for field_id, shown in setting.items()
            )
        else:
            valid = False
        if not valid:
            raise ValidationError({"display_properties": f"Invalid display property: {key}."})
    return deepcopy(value)


def validate_snapshot(value, project_id):
    if not isinstance(value, dict) or set(value) != {"display_properties", "order_by", "sub_issue"}:
        raise ValidationError({"display_config": "Provide only display_properties, order_by and sub_issue."})
    validate_properties(value["display_properties"], project_id)
    if not valid_order_by(value["order_by"], project_id):
        raise ValidationError({"order_by": "Use a supported ordering field in this project."})
    if type(value["sub_issue"]) is not bool:
        raise ValidationError({"sub_issue": "Expected a boolean."})
    return deepcopy(value)


def effective_display(instance, project=None):
    project = project or instance.project
    # Historic personal JSON was unrestricted. Normalize only the response and
    # merge inputs; unrelated edits and reset must leave the stored JSON intact.
    properties = deepcopy(instance.display_properties) if isinstance(instance.display_properties, dict) else {}
    filters = (
        deepcopy(instance.display_filters)
        if isinstance(instance.display_filters, dict)
        else get_default_display_filters()
    )
    if instance.use_project_default:
        config = project.default_display_config or {
            "display_properties": get_default_display_properties(),
            "order_by": get_default_display_filters()["order_by"],
            "sub_issue": get_default_display_filters()["sub_issue"],
        }
        properties = deepcopy(config["display_properties"])
        filters.update({key: config[key] for key in MANAGED_FILTER_KEYS})
        order_by = filters["order_by"]
        custom_order = order_by.removeprefix("-").startswith("custom_fields__")
        if not valid_order_by(order_by, project.pk) or (
            custom_order and filters.get("layout", "list") not in {"list", "spreadsheet"}
        ):
            filters["order_by"] = "-created_at"
    return properties, filters


def update_personal_display(instance, validated_data):
    # Every writer takes the project lock first, then this user's property row.
    # A default update and first override therefore observe a coherent snapshot.
    with transaction.atomic():
        project = Project.objects.select_for_update().get(pk=instance.project_id)
        current = ProjectUserProperty.objects.select_for_update().get(pk=instance.pk)
        properties, filters = effective_display(current, project)
        data = deepcopy(validated_data)
        property_delta = data.pop("display_properties", {})
        filter_delta = data.pop("display_filters", {})
        validate_properties(property_delta, project.pk, existing=properties)
        if not isinstance(filter_delta, dict):
            raise ValidationError({"display_filters": "Expected an object."})
        for key in MANAGED_FILTER_KEYS & filter_delta.keys():
            value = filter_delta[key]
            if key == "sub_issue" and type(value) is not bool:
                raise ValidationError({"display_filters": "Expected a boolean for sub_issue."})
            if value == filters.get(key):
                continue
            if key == "order_by" and not valid_order_by(value, project.pk):
                raise ValidationError({"display_filters": f"Invalid {key}."})
        changed_properties = False
        for key, value in property_delta.items():
            if key == "custom_fields" and isinstance(value, dict):
                custom = properties.get("custom_fields", {})
                custom = custom if isinstance(custom, dict) else {}
                changed_properties |= any(shown != custom.get(field_id, True) for field_id, shown in value.items())
            else:
                implicit = True if key in DISPLAY_PROPERTY_KEYS else [] if key == "column_order" else None
                changed_properties |= value != properties.get(key, implicit)
        changed_filters = any(
            filter_delta[key] != filters.get(key) for key in MANAGED_FILTER_KEYS & filter_delta.keys()
        )
        if current.use_project_default and (changed_properties or changed_filters):
            current.display_properties = properties
            current.display_filters = deepcopy(filters)
            current.use_project_default = False
        if not current.use_project_default:
            if property_delta:
                current.display_properties = merge_properties(current.display_properties, property_delta)
            if filter_delta:
                current.display_filters = {**filters, **filter_delta}
        else:
            # Ignore unchanged inherited echoes from old full-object PATCH clients.
            personal_filters = {key: value for key, value in filter_delta.items() if key not in MANAGED_FILTER_KEYS}
            if personal_filters:
                raw_filters = current.display_filters if isinstance(current.display_filters, dict) else {}
                current.display_filters = {**raw_filters, **personal_filters}
        for key, value in data.items():
            setattr(current, key, value)
        current.save()
        current.project = project
        return current
