# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import math
import re

from rest_framework import serializers

from plane.db.models import ProjectCustomField
from plane.utils.custom_fields import canonical_uuid, is_type_locked, nonempty, stored_values


class ProjectCustomFieldSerializer(serializers.ModelSerializer):
    project_id = serializers.UUIDField(read_only=True)
    is_type_locked = serializers.SerializerMethodField()

    class Meta:
        model = ProjectCustomField
        fields = [
            "id",
            "project_id",
            "name",
            "description",
            "icon",
            "field_type",
            "options",
            "sort_order",
            "is_active",
            "is_type_locked",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "project_id", "is_type_locked", "created_at", "updated_at"]

    def get_is_type_locked(self, instance):
        return is_type_locked(instance)

    def validate_icon(self, value):
        if value is None:
            return None
        if not isinstance(value, dict) or set(value) != {"name", "color"}:
            raise serializers.ValidationError("Expected an icon with name and color.")
        name, color = value["name"], value["color"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,63}", name):
            raise serializers.ValidationError("Icon names must be identifiers of 1 to 64 ASCII characters.")
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise serializers.ValidationError("Icon colors must be six-digit hex values.")
        return {"name": name, "color": color.lower()}

    def validate_sort_order(self, value):
        if not math.isfinite(value):
            raise serializers.ValidationError("Expected a finite sort order.")
        return value

    def validate_options(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected an array of options.")
        seen = set()
        for option in value:
            if not isinstance(option, dict) or set(option) != {"id", "name", "is_active"}:
                raise serializers.ValidationError("Each option must contain id, name and is_active.")
            try:
                key = canonical_uuid(option["id"])
            except (ValueError, TypeError, AttributeError):
                raise serializers.ValidationError("Option IDs must be UUID strings.")
            if key in seen:
                raise serializers.ValidationError("Option IDs must be unique.")
            seen.add(key)
            if not isinstance(option["name"], str) or not option["name"].strip() or len(option["name"]) > 255:
                raise serializers.ValidationError("Option names must contain between 1 and 255 characters.")
            if type(option["is_active"]) is not bool:
                raise serializers.ValidationError("Option is_active must be a boolean.")
        return value

    def validate(self, attrs):
        kind = attrs.get("field_type", getattr(self.instance, "field_type", None))
        options = attrs.get("options", getattr(self.instance, "options", []))
        if kind not in {"select", "multi_select"} and options:
            raise serializers.ValidationError({"options": "Only select fields can define options."})
        if self.instance:
            if kind != self.instance.field_type and is_type_locked(self.instance):
                raise serializers.ValidationError({"field_type": "A field with stored values cannot change type."})
            if "options" in attrs:
                removed = {option["id"] for option in self.instance.options} - {option["id"] for option in options}
                if removed:
                    for value in stored_values(self.instance):
                        if nonempty(value) and removed.intersection(value if isinstance(value, list) else [value]):
                            raise serializers.ValidationError(
                                {"options": "Used options can be renamed or disabled, not removed."}
                            )
        return attrs
