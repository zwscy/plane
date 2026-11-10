# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Shared app/public/draft field validation and transactional patch semantics."""

from datetime import date
import math
from uuid import UUID

from django.db import transaction
from django.db.models.fields.json import KeyTransform
from rest_framework import serializers

from plane.db.models import (
    Cycle,
    DraftIssue,
    EstimatePoint,
    Issue,
    Label,
    Module,
    Project,
    ProjectCustomField,
    ProjectMember,
    State,
)

MULTI_TYPES = frozenset({"multi_select", "members", "labels", "modules"})


def nonempty(value):
    # Equality with False/0 would incorrectly classify those real values as empty.
    return value is not None and value != "" and value != [] and value != {}


def stored_values(field):
    key = str(field.id)
    for model in (Issue, DraftIssue):
        yield from (
            model.all_objects.filter(project_id=field.project_id, custom_fields__has_key=key)
            .annotate(_custom_value=KeyTransform(key, "custom_fields"))
            .values_list("_custom_value", flat=True)
            .iterator()
        )


def is_type_locked(field):
    return any(nonempty(value) for value in stored_values(field))


def canonical_uuid(value):
    if not isinstance(value, str):
        raise ValueError("Expected a UUID string")
    parsed = str(UUID(value))
    if parsed != value:
        raise ValueError("Expected a canonical UUID string")
    return parsed


def validate_custom_fields(project_id, patch, previous=None):
    if not isinstance(patch, dict):
        raise serializers.ValidationError("Expected an object keyed by field IDs.")
    previous = previous or {}
    if not patch:
        return patch
    try:
        keys = [canonical_uuid(key) for key in patch]
    except (ValueError, TypeError, AttributeError):
        raise serializers.ValidationError("Field keys must be UUID strings.")
    definitions = {
        str(field.id): field for field in ProjectCustomField.all_objects.filter(project_id=project_id, id__in=keys)
    }
    errors = {}
    for key, value in patch.items():
        field = definitions.get(key)
        if field is None:
            errors[key] = "Unknown field for this project."
            continue
        if value is None:
            continue
        old = previous.get(key)
        unchanged = type(value) is type(old) and value == old
        if not field.is_active or field.deleted_at is not None:
            if not unchanged:
                errors[key] = "This field is inactive."
            continue
        try:
            validate_value(field, value, old)
        except (ValueError, TypeError, AttributeError) as error:
            errors[key] = str(error)
    if errors:
        raise serializers.ValidationError(errors)
    return patch


def validate_value(field, value, previous):
    kind = field.field_type
    if kind in {"text", "textarea"}:
        if not isinstance(value, str):
            raise ValueError("Expected text.")
    elif kind == "integer":
        if type(value) is not int or not -(2**53 - 1) <= value <= 2**53 - 1:
            raise ValueError("Expected an integer between -(2^53-1) and 2^53-1.")
    elif kind == "decimal":
        if type(value) not in (int, float) or (type(value) is float and not math.isfinite(value)):
            raise ValueError("Expected a finite number.")
    elif kind == "boolean":
        if type(value) is not bool:
            raise ValueError("Expected a boolean.")
    elif kind == "date":
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError("Expected a date in YYYY-MM-DD format.")
    elif kind == "priority":
        if value not in {choice[0] for choice in Issue.PRIORITY_CHOICES}:
            raise ValueError("Invalid priority.")
    else:
        multiple = kind in MULTI_TYPES
        if multiple:
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise ValueError("Expected an array of UUID strings.")
            if len(set(value)) != len(value):
                raise ValueError("Duplicate values are not allowed.")
            values = value
            old_values = previous if isinstance(previous, list) else []
        else:
            values = [value]
            old_values = [previous]
        for item in values:
            canonical_uuid(item)
        if kind in {"select", "multi_select"}:
            options = {option["id"]: option for option in field.options}
            for item in values:
                option = options.get(item)
                if option is None or (not option["is_active"] and item not in old_values):
                    raise ValueError("Unknown or inactive option.")
            return
        if kind in {"member", "members"}:
            valid = ProjectMember.objects.filter(
                project_id=field.project_id,
                member_id__in=values,
                is_active=True,
                role__gte=15,
                member__is_active=True,
            ).values_list("member_id", flat=True)
        else:
            model = {"labels": Label, "state": State, "cycle": Cycle, "modules": Module, "estimate": EstimatePoint}[
                kind
            ]
            queryset = model.all_objects.filter(project_id=field.project_id, id__in=values, deleted_at__isnull=True)
            if kind in {"cycle", "modules"}:
                queryset = queryset.filter(archived_at__isnull=True)
            if kind == "state":
                queryset = queryset.exclude(is_triage=True)
            if kind == "estimate":
                queryset = queryset.filter(estimate__deleted_at__isnull=True)
            valid = queryset.values_list("id", flat=True)
        valid = {str(item) for item in valid}
        # Only retain historical IDs belonging to this project; never accept a foreign ID.
        retained = set(old_values) & set(values)
        if kind in {"member", "members"}:
            historical = ProjectMember.all_objects.filter(
                project_id=field.project_id, member_id__in=retained
            ).values_list("member_id", flat=True)
        else:
            historical = model.all_objects.filter(project_id=field.project_id, id__in=retained).values_list(
                "id", flat=True
            )
        valid.update(str(item) for item in historical)
        if set(values) - valid:
            raise ValueError("References must be active entities in this project.")


class CustomFieldsWriteMixin:
    def validate_custom_fields(self, value):
        project_id = self.instance.project_id if self.instance else self.context.get("project_id")
        source = self.instance or self.context.get("custom_fields_source")
        return validate_custom_fields(project_id, value, getattr(source, "custom_fields", {}))

    def save(self, **kwargs):
        project_id = self.instance.project_id if self.instance else self.context.get("project_id")
        # Definitions and writes take the same project lock, so a concurrent type or
        # option edit cannot slip between validation and persistence.
        with transaction.atomic():
            if project_id:
                Project.objects.select_for_update().get(pk=project_id)
            previous = {}
            source = self.context.get("custom_fields_source")
            if source is not None:
                source = DraftIssue.objects.select_for_update().filter(pk=source.pk, project_id=project_id).first()
                if source is None:
                    raise serializers.ValidationError({"custom_fields": "The source draft no longer exists."})
                previous = source.custom_fields
                self.validated_data.setdefault("custom_fields", {})
            if self.instance:
                current = self.Meta.model.all_objects.select_for_update().get(pk=self.instance.pk)
                previous = current.custom_fields
                # ModelSerializer.save writes every model column; refresh even when
                # this request only updates another built-in property.
                self.instance.custom_fields = previous
            if "custom_fields" in self.validated_data:
                patch = self.validated_data["custom_fields"]
                try:
                    validate_custom_fields(project_id, patch, previous)
                except serializers.ValidationError as error:
                    raise serializers.ValidationError({"custom_fields": error.detail})
                merged = dict(previous)
                for key, value in patch.items():
                    if value is None:
                        merged.pop(key, None)
                    else:
                        merged[key] = value
                self.validated_data["custom_fields"] = merged
            return super().save(**kwargs)
