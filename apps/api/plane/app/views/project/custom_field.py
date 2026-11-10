# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.custom_field import ProjectCustomFieldSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectCustomField, WorkspaceMember


class ProjectCustomFieldEndpoint(BaseAPIView):
    http_method_names = ["get", "post", "options"]

    def project(self, request, slug, project_id, lock=False):
        # The decorator follows existing project roles; workspace membership must
        # also remain active to read or administer definitions.
        get_object_or_404(WorkspaceMember.objects, workspace__slug=slug, member=request.user, is_active=True)
        queryset = Project.objects.select_for_update() if lock else Project.objects
        return get_object_or_404(queryset, pk=project_id, workspace__slug=slug)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        self.project(request, slug, project_id)
        fields = ProjectCustomField.objects.filter(project_id=project_id)
        return Response(ProjectCustomFieldSerializer(fields, many=True).data)

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        with transaction.atomic():
            project = self.project(request, slug, project_id, lock=True)
            serializer = ProjectCustomFieldSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(project=project)
            return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, field_id):
        with transaction.atomic():
            self.project(request, slug, project_id, lock=True)
            field = get_object_or_404(ProjectCustomField.objects, project_id=project_id, pk=field_id)
            serializer = ProjectCustomFieldSerializer(field, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, field_id):
        with transaction.atomic():
            self.project(request, slug, project_id, lock=True)
            field = get_object_or_404(ProjectCustomField.objects, project_id=project_id, pk=field_id)
            # No cascading deletion: historical task JSON is deliberately retained.
            field.deleted_at = timezone.now()
            field.is_active = False
            field.save(update_fields=["deleted_at", "is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectCustomFieldDetailEndpoint(ProjectCustomFieldEndpoint):
    http_method_names = ["patch", "delete", "options"]
