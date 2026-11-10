# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.issue import ProjectUserPropertySerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectUserProperty, WorkspaceMember
from plane.utils.project_display_config import validate_snapshot


def scoped_project(request, slug, project_id, lock=False):
    get_object_or_404(WorkspaceMember.objects, workspace__slug=slug, member=request.user, is_active=True)
    query = Project.objects.select_for_update() if lock else Project.objects
    return get_object_or_404(query, pk=project_id, workspace__slug=slug)


class ProjectDisplayConfigEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        project = scoped_project(request, slug, project_id)
        return Response(project.default_display_config)

    @allow_permission([ROLE.ADMIN])
    def put(self, request, slug, project_id):
        with transaction.atomic():
            project = scoped_project(request, slug, project_id, lock=True)
            project.default_display_config = validate_snapshot(request.data, project.pk)
            project.save(update_fields=["default_display_config", "updated_at"])
            return Response(project.default_display_config)


class ProjectResetDisplayConfigEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id):
        with transaction.atomic():
            project = scoped_project(request, slug, project_id, lock=True)
            properties, _ = ProjectUserProperty.objects.select_for_update().get_or_create(
                project=project, user=request.user
            )
            properties.use_project_default = True
            properties.save(update_fields=["use_project_default", "updated_at"])
            return Response(ProjectUserPropertySerializer(properties).data)
