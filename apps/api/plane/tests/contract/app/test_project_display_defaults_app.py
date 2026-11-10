"""Project display defaults remain independent of personal filters and overrides."""

from copy import deepcopy
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.app.serializers.issue import ProjectUserPropertySerializer
from plane.app.serializers.project import ProjectSerializer
from plane.api.serializers.project import ProjectSerializer as PublicProjectSerializer
from plane.db.models import (
    Project,
    ProjectCustomField,
    ProjectMember,
    ProjectUserProperty,
    User,
    Workspace,
    WorkspaceMember,
)

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


def snapshot(**kwargs):
    return {
        "display_properties": {"assignee": False, "state": True, "column_order": ["state", "assignee"]},
        "order_by": "-priority",
        "sub_issue": False,
        **kwargs,
    }


@pytest.fixture
def displays(workspace, create_user):
    project = Project.objects.create(name="Display defaults", identifier="DIS", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    member = User.objects.create(email="display-member@example.invalid", username="display-member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    ProjectMember.objects.create(project=project, member=member, role=15)
    ProjectUserProperty.objects.filter(project=project).delete(soft=False)
    admin_client, member_client = APIClient(), APIClient()
    admin_client.force_authenticate(create_user)
    member_client.force_authenticate(member)
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/"
    return admin_client, member_client, project, member, base


def save_default(displays, config=None):
    admin, _, _, _, base = displays
    response = admin.put(base + "display-config/", config or snapshot(), format="json")
    assert response.status_code == 200, getattr(response, "data", response.content)
    return response.data


def test_two_accounts_follow_override_admin_updates_and_restore_preserve_raw(displays):
    admin, member, project, user, base = displays
    assert save_default(displays) == snapshot()
    inherited = member.get(base + "user-properties/")
    assert inherited.status_code == 200
    assert inherited.data["use_project_default"] is True
    assert inherited.data["project_display_config"] == snapshot()
    assert inherited.data["display_properties"] == snapshot()["display_properties"]
    assert inherited.data["display_filters"]["order_by"] == "-priority"
    assert inherited.data["display_filters"]["sub_issue"] is False
    original = ProjectUserProperty.objects.get(project=project, user=user)
    original_json = deepcopy(original.display_filters)
    changed = member.patch(base + "user-properties/", {"display_properties": {"state": False}}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["use_project_default"] is False
    assert changed.data["display_properties"] == {**snapshot()["display_properties"], "state": False}
    assert changed.data["display_filters"]["order_by"] == "-priority"
    save_default(displays, snapshot(order_by="start_date", sub_issue=True, display_properties={"labels": False}))
    personal = member.get(base + "user-properties/").data
    assert personal["display_properties"]["state"] is False
    assert personal["display_filters"]["order_by"] == "-priority"
    admin_props = admin.get(base + "user-properties/").data
    assert admin_props["display_filters"]["order_by"] == "start_date"
    original.refresh_from_db()
    raw = {
        name: deepcopy(getattr(original, name))
        for name in ["display_properties", "display_filters", "filters", "rich_filters", "preferences"]
    }
    restored = member.post(base + "user-properties/reset-display/", {}, format="json")
    assert restored.status_code == 200, restored.data
    assert restored.data["use_project_default"] is True
    assert restored.data["display_properties"] == {"labels": False}
    assert restored.data["display_filters"]["layout"] == original_json["layout"]
    original.refresh_from_db()
    assert all(getattr(original, name) == value for name, value in raw.items())


def test_personal_filters_layout_legacy_full_patch_and_deltas_do_not_freeze_follow(displays):
    _, member, project, user, base = displays
    save_default(displays)
    current = member.get(base + "user-properties/").data
    rich = {"logical_operator": "and", "conditions": [{"property": "priority", "value": "high"}]}
    # Legacy callers send all effective display filters for a layout-only edit.
    response = member.patch(
        base + "user-properties/",
        {
            "display_filters": {**current["display_filters"], "layout": "spreadsheet", "group_by": "state"},
            "filters": {"priority": ["high"]},
            "rich_filters": rich,
            "preferences": {"navigation": {"default_tab": "pages"}},
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["use_project_default"] is True
    row = ProjectUserProperty.objects.get(project=project, user=user)
    assert row.display_filters["order_by"] == "-created_at"  # inherited echo is not copied to raw JSON
    assert row.rich_filters == rich
    response = member.patch(base + "user-properties/", {"display_filters": {"sub_issue": True}}, format="json")
    assert response.data["use_project_default"] is False
    assert response.data["display_filters"]["order_by"] == "-priority"
    assert response.data["display_filters"]["layout"] == "spreadsheet"
    assert response.data["display_properties"] == snapshot()["display_properties"]
    assert response.data["rich_filters"] == rich
    response = member.patch(base + "user-properties/", {"display_properties": {"custom_fields": {}}}, format="json")
    assert response.status_code == 200
    assert response.data["display_properties"]["state"] is True
    assert response.data["display_filters"]["sub_issue"] is True


def test_existing_personal_partial_properties_and_filters_merge_without_data_loss(displays):
    _, member, project, user, base = displays
    row = ProjectUserProperty.objects.create(project=project, user=user)
    # Historic values are retained even if the current strict default schema would reject them.
    row.display_properties = {"state": False, "legacy": "preserve", "custom_fields": {"old": False}}
    row.display_filters = {"layout": "list", "order_by": "-created_at", "sub_issue": True, "legacy": [1]}
    row.use_project_default = False
    row.save()
    response = member.patch(
        base + "user-properties/",
        {"display_properties": {"assignee": False}, "display_filters": {"group_by": "state"}},
        format="json",
    )
    assert response.status_code == 200, response.data
    row.refresh_from_db()
    assert row.display_properties == {
        "state": False,
        "legacy": "preserve",
        "custom_fields": {"old": False},
        "assignee": False,
    }
    assert row.display_filters["legacy"] == [1]
    assert row.display_filters["order_by"] == "-created_at"


@pytest.mark.parametrize("role", [5, 15, 20])
def test_read_write_roles_include_workspace_admin_override(displays, role):
    admin, member, project, user, base = displays
    ProjectMember.objects.filter(project=project, member=user).update(role=role)
    assert member.get(base + "display-config/").status_code == 200
    assert member.put(base + "display-config/", snapshot(), format="json").status_code == (200 if role == 20 else 403)
    WorkspaceMember.objects.filter(workspace=project.workspace, member=user).update(role=20)
    assert member.put(base + "display-config/", snapshot(), format="json").status_code == 200
    assert admin.get(base + "display-config/").status_code == 200


@pytest.mark.parametrize("revocation", ["workspace", "project", "workspace_deleted", "project_deleted", "nonmember"])
def test_inactive_or_nonmembers_cannot_read_write_reset_or_create_rows(displays, revocation):
    _, member, project, user, base = displays
    from django.utils import timezone

    if revocation.startswith("workspace"):
        query = WorkspaceMember.all_objects.filter(workspace=project.workspace, member=user)
    else:
        query = ProjectMember.all_objects.filter(project=project, member=user)
    if revocation.endswith("deleted"):
        query.update(deleted_at=timezone.now())
    elif revocation == "nonmember":
        query.delete()
    else:
        query.update(is_active=False)
    for method, suffix, data in [
        ("get", "display-config/", None),
        ("put", "display-config/", snapshot()),
        ("get", "user-properties/", None),
        ("patch", "user-properties/", {}),
        ("post", "user-properties/reset-display/", {}),
    ]:
        response = getattr(member, method)(base + suffix, data, format="json")
        assert response.status_code in [403, 404], (method, suffix, response.status_code)
    assert not ProjectUserProperty.objects.filter(project=project, user=user).exists()


def test_foreign_workspace_and_project_are_scoped(displays):
    admin, member, project, user, base = displays
    foreign = Workspace.objects.create(name="Foreign", slug="foreign", owner=user)
    WorkspaceMember.objects.create(workspace=foreign, member=user, role=20)
    other = Project.objects.create(name="Foreign", identifier="F", workspace=foreign)
    ProjectMember.objects.create(project=other, member=user, role=20)
    for suffix in ["display-config/", "user-properties/", "user-properties/reset-display/"]:
        url = base.replace(str(project.id), str(other.id)) + suffix
        assert member.get(url).status_code in [403, 404, 405]
    assert admin.put(
        base.replace(project.workspace.slug, foreign.slug) + "display-config/", snapshot(), format="json"
    ).status_code in [403, 404]


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        {},
        {"display_properties": {}, "order_by": "-created_at"},
        snapshot(filters={}),
        snapshot(display_properties=[]),
        snapshot(display_properties={"state": "false"}),
        snapshot(display_properties={"bad": True}),
        snapshot(display_properties={"column_order": ["state", "state"]}),
        snapshot(display_properties={"column_order": ["bogus"]}),
        snapshot(display_properties={"custom_fields": []}),
        snapshot(display_properties={"custom_fields": {str(uuid4()): True}}),
        snapshot(order_by="name; DROP TABLE"),
        snapshot(order_by=1),
        snapshot(sub_issue=1),
    ],
)
def test_invalid_defaults_are_atomic(displays, bad):
    admin, _, project, _, base = displays
    save_default(displays)
    response = admin.put(base + "display-config/", bad, format="json")
    assert response.status_code == 400, getattr(response, "data", response.content)
    project.refresh_from_db()
    assert project.default_display_config == snapshot()


def test_custom_definitions_validated_and_follow_order_safely_falls_back(displays):
    _, member, project, user, base = displays
    field = ProjectCustomField.objects.create(project=project, name="Number", field_type="integer")
    order = "custom_fields__" + str(field.id)
    config = snapshot(
        order_by=order, display_properties={"custom_fields": {str(field.id): False}, "column_order": [order]}
    )
    save_default(displays, config)
    assert member.get(base + "user-properties/").data["display_filters"]["order_by"] == order
    response = member.patch(base + "user-properties/", {"display_filters": {"layout": "kanban"}}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["use_project_default"] is True
    assert response.data["display_filters"]["order_by"] == "-created_at"
    member.patch(base + "user-properties/", {"display_filters": {"layout": "list"}}, format="json")
    ProjectCustomField.objects.filter(pk=field.id).update(is_active=False)
    response = member.get(base + "user-properties/")
    assert response.data["use_project_default"] is True
    assert response.data["display_filters"]["order_by"] == "-created_at"
    assert response.data["project_display_config"]["order_by"] == order
    project.refresh_from_db()
    assert project.default_display_config == config
    assert ProjectUserProperty.objects.get(project=project, user=user).display_filters["order_by"] == "-created_at"
    assert displays[0].put(base + "display-config/", config, format="json").status_code == 400


@pytest.mark.parametrize("kind", ["multi_select", "members", "labels", "modules"])
def test_unsortable_custom_defaults_rejected(displays, kind):
    admin, _, project, _, base = displays
    field = ProjectCustomField.objects.create(project=project, name="Multiple", field_type=kind)
    response = admin.put(base + "display-config/", snapshot(order_by="custom_fields__" + str(field.id)), format="json")
    assert response.status_code == 400


def test_personal_invalid_delta_is_atomic_and_mass_assignment_is_read_only(displays):
    _, member, project, user, base = displays
    save_default(displays)
    member.get(base + "user-properties/")
    response = member.patch(
        base + "user-properties/",
        {"display_properties": {"state": "false"}, "rich_filters": {"bad": "must not persist"}},
        format="json",
    )
    assert response.status_code == 400
    row = ProjectUserProperty.objects.get(project=project, user=user)
    assert row.use_project_default is True
    assert row.rich_filters == {}
    serializer = ProjectUserPropertySerializer(
        row, data={"use_project_default": False, "project_display_config": {}}, partial=True
    )
    assert serializer.is_valid(), serializer.errors
    assert "use_project_default" not in serializer.validated_data
    serializer.save()
    row.refresh_from_db()
    assert row.use_project_default is True
    for serializer_class in [ProjectSerializer, PublicProjectSerializer]:
        serializer = serializer_class(
            project,
            data={"default_display_config": snapshot()},
            partial=True,
            context={"workspace_id": project.workspace_id},
        )
        assert serializer.is_valid(), serializer.errors
        assert "default_display_config" not in serializer.validated_data


@pytest.mark.parametrize("delta", [{"display_properties": {"assignee": 0}}, {"display_filters": {"sub_issue": 0}}])
def test_personal_boolean_numbers_rejected_even_when_equal_to_effective_false(displays, delta):
    _, member, _, _, base = displays
    save_default(displays)
    member.get(base + "user-properties/")
    response = member.patch(base + "user-properties/", delta, format="json")
    assert response.status_code == 400, response.data
    assert member.get(base + "user-properties/").data["use_project_default"] is True


def test_stale_validated_personal_patch_uses_current_default_before_snapshot(displays):
    _, member, project, user, base = displays
    save_default(displays)
    member.get(base + "user-properties/")
    row = ProjectUserProperty.objects.get(project=project, user=user)
    serializer = ProjectUserPropertySerializer(row, data={"display_properties": {"state": False}}, partial=True)
    assert serializer.is_valid(), serializer.errors
    config = snapshot(order_by="start_date", sub_issue=True, display_properties={"state": True, "labels": False})
    save_default(displays, config)
    saved = serializer.save()
    assert saved.use_project_default is False
    assert saved.display_properties == {"state": False, "labels": False}
    assert saved.display_filters["order_by"] == "start_date"
    assert saved.display_filters["sub_issue"] is True


def test_defaults_update_never_writes_other_personal_rows_and_empty_defaults_are_usable(displays):
    admin, member, project, user, base = displays
    from plane.db.models.issue import get_default_display_properties

    assert admin.get(base + "display-config/").data == {}
    assert member.get(base + "user-properties/").data["display_properties"] == get_default_display_properties()
    row = ProjectUserProperty.objects.get(project=project, user=user)
    raw = deepcopy(ProjectUserProperty.objects.filter(pk=row.pk).values().get())
    save_default(displays)
    assert ProjectUserProperty.objects.filter(pk=row.pk).values().get() == raw


def test_foreign_deleted_and_multi_custom_references_are_rejected_in_defaults(displays):
    admin, _, project, _, base = displays
    from django.utils import timezone

    other = Project.objects.create(name="Other", identifier="O", workspace=project.workspace)
    foreign = ProjectCustomField.objects.create(project=other, name="Foreign", field_type="text")
    deleted = ProjectCustomField.objects.create(project=project, name="Deleted", field_type="text")
    ProjectCustomField.objects.filter(pk=deleted.pk).update(deleted_at=timezone.now())
    for field in [foreign, deleted]:
        for config in [
            snapshot(order_by="custom_fields__" + str(field.id)),
            snapshot(display_properties={"custom_fields": {str(field.id): True}}),
            snapshot(display_properties={"column_order": ["custom_fields__" + str(field.id)]}),
        ]:
            assert admin.put(base + "display-config/", config, format="json").status_code == 400


@pytest.mark.parametrize("legacy", [[], "legacy", {"custom_fields": []}])
def test_unrelated_personal_patch_and_reset_preserve_historical_json_shapes(displays, legacy):
    _, member, project, user, base = displays
    row = ProjectUserProperty.objects.create(
        project=project,
        user=user,
        use_project_default=False,
        display_properties=deepcopy(legacy),
        display_filters=deepcopy(legacy),
    )
    response = member.patch(base + "user-properties/", {"rich_filters": {"retained": True}}, format="json")
    assert response.status_code == 200, response.data
    row.refresh_from_db()
    assert row.display_properties == legacy
    assert row.display_filters == legacy
    response = member.post(base + "user-properties/reset-display/", {}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["use_project_default"] is True
    row.refresh_from_db()
    assert row.display_properties == legacy
    assert row.display_filters == legacy


def test_legacy_normalized_full_visibility_echo_is_not_a_personal_change(displays):
    _, member, _, _, base = displays
    from plane.db.models.issue import get_default_display_properties

    properties = {"state": False}
    save_default(displays, snapshot(display_properties=properties))
    normalized = {**get_default_display_properties(), **properties, "column_order": [], "custom_fields": {}}
    response = member.patch(base + "user-properties/", {"display_properties": normalized}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["use_project_default"] is True
    assert response.data["display_properties"] == properties
