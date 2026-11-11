# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models

from .project import ProjectBaseModel


class ProjectCustomField(ProjectBaseModel):
    FIELD_TYPES = (
        "text",
        "textarea",
        "integer",
        "decimal",
        "date",
        "boolean",
        "select",
        "multi_select",
        "member",
        "members",
        "labels",
        "state",
        "priority",
        "cycle",
        "modules",
        "estimate",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    icon = models.JSONField(blank=True, default=None, null=True)
    field_type = models.CharField(max_length=32, choices=[(value, value) for value in FIELD_TYPES])
    options = models.JSONField(default=list, blank=True)
    sort_order = models.FloatField(default=65535)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "project_custom_fields"
        ordering = ("sort_order", "created_at", "id")
