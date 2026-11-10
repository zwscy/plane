"""Project fields: scoped definitions, strict values, merge semantics and typed ordering."""

from datetime import date
from unittest import mock
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.app.serializers import IssueCreateSerializer
from plane.api.serializers.issue import IssueSerializer as PublicIssueSerializer
from plane.db.models import Issue, Project, ProjectMember, State, Label
from plane.utils.order_queryset import order_issue_queryset

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture
def setup_fields(workspace, create_user):
    project = Project.objects.create(name="字段", identifier="CF", workspace=workspace)
    ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
    State.objects.create(project=project, name="待办", color="#000000", default=True)
    client = APIClient()
    client.force_authenticate(create_user)
    return client, project, f"/api/workspaces/{workspace.slug}/projects/{project.id}/custom-fields/"


def create_field(setup_fields, field_type="text", **kwargs):
    client, project, url = setup_fields
    response = client.post(url, {"name": "测试字段", "field_type": field_type, **kwargs}, format="json")
    assert response.status_code == 201, getattr(response, "data", response.content)
    return response.data


def issue_serializer(project, data, instance=None, public=False):
    cls = PublicIssueSerializer if public else IssueCreateSerializer
    return cls(
        instance,
        data=data,
        partial=instance is not None,
        context={
            "project_id": project.id,
            "workspace_id": project.workspace_id,
            "default_assignee_id": None,
        },
    )


def test_definition_permissions_and_scope(setup_fields, workspace, create_user):
    client, project, url = setup_fields
    field = create_field(setup_fields)
    assert field["project_id"] == str(project.id)
    assert field["is_type_locked"] is False
    assert client.get(url).data[0]["id"] == field["id"]
    ProjectMember.objects.filter(project=project, member=create_user).update(role=15)
    # Workspace admins follow existing Plane project-admin override.
    from plane.db.models import WorkspaceMember

    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=15)
    assert client.post(url, {"name": "禁止", "field_type": "text"}, format="json").status_code == 403
    other = Project.objects.create(name="Other", identifier="OTHER", workspace=workspace)
    ProjectMember.objects.create(project=other, workspace=workspace, member=create_user, role=20)
    assert (
        client.patch(
            url.replace(str(project.id), str(other.id)) + field["id"] + "/", {"name": "cross"}, format="json"
        ).status_code
        == 404
    )


@pytest.mark.parametrize("public", [False, True])
@pytest.mark.parametrize(
    "kind,good,bad",
    [
        ("text", "中文", 1),
        ("textarea", "第一行\n第二行", {}),
        ("integer", 0, True),
        ("decimal", 2.5, "2.5"),
        ("date", "2026-11-10", "2026-02-30"),
        ("boolean", False, 0),
        ("priority", "urgent", "invalid"),
    ],
)
def test_strict_scalar_values(setup_fields, public, kind, good, bad):
    _, project, _ = setup_fields
    field = create_field(setup_fields, kind)
    serializer = issue_serializer(project, {"name": "Work", "custom_fields": {field["id"]: good}}, public=public)
    assert serializer.is_valid(), serializer.errors
    issue = serializer.save()
    assert issue.custom_fields == {field["id"]: good}
    invalid = issue_serializer(project, {"custom_fields": {field["id"]: bad}}, issue, public)
    assert not invalid.is_valid()
    assert "custom_fields" in invalid.errors


@pytest.mark.parametrize("kind,value", [("integer", 0), ("boolean", False), ("text", "used")])
@pytest.mark.parametrize("historical", ["draft", "archived", "deleted"])
def test_type_lock_counts_zero_false_and_historical_issues(setup_fields, kind, value, historical):
    client, project, url = setup_fields
    field = create_field(setup_fields, kind)
    serializer = issue_serializer(project, {"name": "Historical", "custom_fields": {field["id"]: value}})
    assert serializer.is_valid(), serializer.errors
    issue = serializer.save()
    changes = (
        {"is_draft": True}
        if historical == "draft"
        else {"archived_at": date.today()}
        if historical == "archived"
        else {"deleted_at": "2026-01-01T00:00:00Z"}
    )
    Issue.all_objects.filter(pk=issue.id).update(**changes)
    assert client.get(url).data[0]["is_type_locked"] is True
    assert client.patch(url + field["id"] + "/", {"field_type": "textarea"}, format="json").status_code == 400


def test_stale_partial_edits_merge_and_null_clears(setup_fields):
    _, project, _ = setup_fields
    first = create_field(setup_fields)
    second = create_field(setup_fields, "integer")
    issue = Issue.objects.create(project=project, name="Merge")
    stale = Issue.objects.get(pk=issue.pk)
    one = issue_serializer(project, {"custom_fields": {first["id"]: "one"}}, issue)
    two = issue_serializer(project, {"custom_fields": {second["id"]: 0}}, stale, public=True)
    assert one.is_valid() and two.is_valid()
    one.save()
    two.save()
    issue.refresh_from_db()
    assert issue.custom_fields == {first["id"]: "one", second["id"]: 0}
    clear = issue_serializer(project, {"custom_fields": {first["id"]: None}}, issue)
    assert clear.is_valid(), clear.errors
    clear.save()
    issue.refresh_from_db()
    assert issue.custom_fields == {second["id"]: 0}


def test_options_stable_ids_inactive_retention_and_removal_guard(setup_fields):
    client, project, url = setup_fields
    option_id = str(uuid4())
    field = create_field(setup_fields, "select", options=[{"id": option_id, "name": "甲", "is_active": True}])
    serializer = issue_serializer(project, {"name": "Selected", "custom_fields": {field["id"]: option_id}})
    assert serializer.is_valid(), serializer.errors
    issue = serializer.save()
    detail = url + field["id"] + "/"
    assert client.patch(detail, {"options": []}, format="json").status_code == 400
    assert (
        client.patch(
            detail, {"options": [{"id": option_id, "name": "改名", "is_active": False}]}, format="json"
        ).status_code
        == 200
    )
    fresh = issue_serializer(project, {"name": "New", "custom_fields": {field["id"]: option_id}})
    assert not fresh.is_valid()
    retained = issue_serializer(project, {"custom_fields": {field["id"]: option_id}}, issue)
    assert retained.is_valid(), retained.errors
    assert client.delete(detail).status_code == 204
    assert client.get(url).data == []
    assert issue_serializer(project, {"name": "still readable"}, issue).is_valid()


def test_cross_project_fields_entities_and_invalid_shapes(setup_fields, workspace):
    _, project, _ = setup_fields
    other = Project.objects.create(name="Other", identifier="O", workspace=workspace)
    state = State.objects.create(project=other, name="Foreign", color="#000000")
    field = create_field(setup_fields, "state")
    for data in [{field["id"]: str(state.id)}, {str(uuid4()): "unknown"}, [], None]:
        serializer = issue_serializer(project, {"name": "Invalid", "custom_fields": data})
        assert not serializer.is_valid(), data
    labels = create_field(setup_fields, "labels")
    label = Label.objects.create(project=project, name="Valid")
    valid = issue_serializer(project, {"name": "Valid", "custom_fields": {labels["id"]: [str(label.id)]}})
    assert valid.is_valid(), valid.errors
    assert not issue_serializer(
        project, {"name": "Invalid", "custom_fields": {labels["id"]: [str(label.id), str(label.id)]}}
    ).is_valid()


@pytest.mark.parametrize(
    "kind,values",
    [
        ("integer", [2, 10, 1]),
        ("decimal", [2.2, 10.1, 1.5]),
        ("date", ["2026-02-01", "2026-11-01", "2025-12-31"]),
        ("text", ["b", "z", "a"]),
    ],
)
def test_typed_ordering_null_last_and_stable_ties(setup_fields, kind, values):
    _, project, _ = setup_fields
    field = create_field(setup_fields, kind)
    ids = []
    for value in [*values, None, values[0]]:
        serializer = issue_serializer(project, {"name": "Order", "custom_fields": {field["id"]: value}})
        assert serializer.is_valid(), serializer.errors
        ids.append(serializer.save().id)
    queryset = Issue.objects.filter(project=project)
    for desc, expected in [
        (False, [ids[2], ids[0], ids[4], ids[1], ids[3]]),
        (True, [ids[1], ids[0], ids[4], ids[2], ids[3]]),
    ]:
        ordered, _ = order_issue_queryset(
            queryset, ("-" if desc else "") + "custom_fields__" + field["id"], project_id=project.id
        )
        assert list(ordered.values_list("id", flat=True)) == expected
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        order_issue_queryset(queryset, "custom_fields__" + str(uuid4()), project_id=project.id)


def test_draft_values_lock_types_and_share_validation(setup_fields):
    from plane.app.serializers.draft import DraftIssueCreateSerializer

    client, project, url = setup_fields
    field = create_field(setup_fields, "boolean")
    serializer = DraftIssueCreateSerializer(
        data={"name": "草稿", "custom_fields": {field["id"]: False}},
        context={"project_id": project.id, "workspace_id": project.workspace_id},
    )
    assert serializer.is_valid(), serializer.errors
    draft = serializer.save()
    assert draft.custom_fields == {field["id"]: False}
    assert client.patch(url + field["id"] + "/", {"field_type": "text"}, format="json").status_code == 400


def test_select_order_follows_definition_and_multi_sort_rejected(setup_fields):
    client, project, url = setup_fields
    options = [{"id": str(uuid4()), "name": name, "is_active": True} for name in ["Z", "A"]]
    field = create_field(setup_fields, "select", options=options)
    ids = []
    for option in reversed(options):
        serializer = issue_serializer(project, {"name": "Option", "custom_fields": {field["id"]: option["id"]}})
        assert serializer.is_valid(), serializer.errors
        ids.append(serializer.save().id)
    ordered, _ = order_issue_queryset(
        Issue.objects.filter(project=project), "custom_fields__" + field["id"], project_id=project.id
    )
    assert list(ordered.values_list("id", flat=True)) == ids[::-1]
    multi = create_field(setup_fields, "multi_select", options=options)
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        order_issue_queryset(
            Issue.objects.filter(project=project), "custom_fields__" + multi["id"], project_id=project.id
        )


def test_native_state_order_uses_sequence(setup_fields):
    _, project, _ = setup_fields
    field = create_field(setup_fields, "state")
    first = State.objects.get(project=project)
    second = State.objects.create(project=project, name="A", color="#000000")
    ids = []
    for state in [second, first]:
        serializer = issue_serializer(project, {"name": "State", "custom_fields": {field["id"]: str(state.id)}})
        assert serializer.is_valid(), serializer.errors
        ids.append(serializer.save().id)
    ordered, _ = order_issue_queryset(
        Issue.objects.filter(project=project), "custom_fields__" + field["id"], project_id=project.id
    )
    assert list(ordered.values_list("id", flat=True)) == ids[::-1]


def test_http_root_detail_children_and_pagination_expose_values(setup_fields):
    client, project, _ = setup_fields
    field = create_field(setup_fields, "integer")
    base = f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/issues/"
    issues = []
    for value in [10, 2, 2, None]:
        serializer = issue_serializer(project, {"name": "HTTP", "custom_fields": {field["id"]: value}})
        assert serializer.is_valid(), serializer.errors
        issues.append(serializer.save())
    with mock.patch("plane.app.views.issue.base.recent_visited_task.delay"):
        response = client.get(base, {"order_by": "custom_fields__" + field["id"], "per_page": 2})
    assert response.status_code == 200, response.data
    assert [str(row["id"]) for row in response.data["results"]] == [str(issues[1].id), str(issues[2].id)]
    assert response.data["results"][0]["custom_fields"] == {field["id"]: 2}
    with mock.patch("plane.app.views.issue.base.recent_visited_task.delay"):
        detail = client.get(base + str(issues[0].id) + "/")
    assert detail.status_code == 200, detail.data
    assert detail.data["custom_fields"] == {field["id"]: 10}
    Issue.objects.filter(pk__in=[issues[1].id, issues[2].id]).update(parent=issues[0])
    children = client.get(base + str(issues[0].id) + "/sub-issues/", {"order_by": "-custom_fields__" + field["id"]})
    assert children.status_code == 200, children.data
    assert [str(row["id"]) for row in children.data["sub_issues"]] == [str(issues[1].id), str(issues[2].id)]
    assert children.data["sub_issues"][0]["custom_fields"] == {field["id"]: 2}


@pytest.mark.parametrize(
    "kind", ["member", "members", "labels", "state", "cycle", "modules", "estimate", "multi_select"]
)
def test_entity_types_reject_foreign_and_new_inactive_values(setup_fields, workspace, create_user, kind):
    from plane.db.models import Cycle, Module, Estimate, EstimatePoint
    from plane.tests.factories import UserFactory

    _, project, _ = setup_fields
    other = Project.objects.create(name="Other", identifier="FOREIGN", workspace=workspace)
    multiple = kind in {"members", "labels", "modules", "multi_select"}
    if kind == "multi_select":
        valid_id, foreign_id = str(uuid4()), str(uuid4())
        field = create_field(setup_fields, kind, options=[{"id": valid_id, "name": "有效", "is_active": True}])
        entity = None
    else:
        field = create_field(setup_fields, kind)
        if kind in {"member", "members"}:
            foreign_id = str(UserFactory().id)
            entity = ProjectMember.objects.get(project=project, member=create_user)
            valid_id = str(create_user.id)
        elif kind == "state":
            entity = State.objects.get(project=project)
            foreign_id = str(State.objects.create(project=other, name="Foreign", color="#000000").id)
            valid_id = str(entity.id)
        elif kind == "estimate":
            estimate = Estimate.objects.create(project=project, name="Points")
            foreign_estimate = Estimate.objects.create(project=other, name="Foreign")
            entity = EstimatePoint.objects.create(project=project, estimate=estimate, key=1, value="1")
            foreign_id = str(
                EstimatePoint.objects.create(project=other, estimate=foreign_estimate, key=1, value="1").id
            )
            valid_id = str(entity.id)
        else:
            model = {"labels": Label, "cycle": Cycle, "modules": Module}[kind]
            extras = {"owned_by": create_user} if kind == "cycle" else {}
            entity = model.objects.create(project=project, name="有效", **extras)
            foreign_id = str(model.objects.create(project=other, name="Foreign", **extras).id)
            valid_id = str(entity.id)
    value = [valid_id] if multiple else valid_id
    serializer = issue_serializer(project, {"name": "Reference", "custom_fields": {field["id"]: value}})
    assert serializer.is_valid(), serializer.errors
    issue = serializer.save()
    invalid = issue_serializer(
        project, {"custom_fields": {field["id"]: [foreign_id] if multiple else foreign_id}}, issue
    )
    assert not invalid.is_valid()
    if entity:
        if kind in {"member", "members"}:
            type(entity).objects.filter(pk=entity.pk).update(is_active=False)
        else:
            from django.utils import timezone

            type(entity).all_objects.filter(pk=entity.pk).update(deleted_at=timezone.now())
        fresh = issue_serializer(project, {"name": "New", "custom_fields": {field["id"]: value}})
        assert not fresh.is_valid()
        retained = issue_serializer(project, {"custom_fields": {field["id"]: value}}, issue)
        assert retained.is_valid(), retained.errors


def test_validation_is_rechecked_under_write_lock_and_unrelated_patch_preserves_values(setup_fields):
    client, project, url = setup_fields
    field = create_field(setup_fields, "text")
    stale_validation = issue_serializer(project, {"name": "Race", "custom_fields": {field["id"]: "string"}})
    assert stale_validation.is_valid()
    assert client.patch(url + field["id"] + "/", {"field_type": "integer"}, format="json").status_code == 200
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        stale_validation.save()
    issue = Issue.objects.create(project=project, name="Concurrent")
    stale = Issue.objects.get(pk=issue.pk)
    custom_edit = issue_serializer(project, {"custom_fields": {field["id"]: 10}}, issue)
    other_edit = issue_serializer(project, {"name": "Renamed"}, stale)
    assert custom_edit.is_valid() and other_edit.is_valid()
    custom_edit.save()
    other_edit.save()
    issue.refresh_from_db()
    assert issue.custom_fields == {field["id"]: 10}


def test_external_api_reads_writes_and_orders(setup_fields, api_key_client):
    _, project, _ = setup_fields
    field = create_field(setup_fields, "integer")
    base = f"/api/v1/workspaces/{project.workspace.slug}/projects/{project.id}/issues/"
    created = []
    with (
        mock.patch("plane.api.views.issue.issue_activity.delay"),
        mock.patch("plane.api.views.issue.model_activity.delay"),
    ):
        for value in [10, 2, None]:
            response = api_key_client.post(
                base, {"name": "Public API", "custom_fields": {field["id"]: value}}, format="json"
            )
            assert response.status_code == 201, response.data
            created.append(response.data["id"])
        update = api_key_client.patch(
            base + str(created[0]) + "/", {"custom_fields": {field["id"]: "bad"}}, format="json"
        )
        assert update.status_code == 400, update.data
    response = api_key_client.get(base, {"order_by": "-custom_fields__" + field["id"], "per_page": 2})
    assert response.status_code == 200, response.data
    assert [str(item["id"]) for item in response.data["results"]] == [str(item) for item in created[:2]]
    assert response.data["results"][0]["custom_fields"] == {field["id"]: 10}
    detail = api_key_client.get(base + str(created[0]) + "/")
    assert detail.status_code == 200, detail.data
    assert detail.data["custom_fields"] == {field["id"]: 10}


@pytest.mark.parametrize("value", [[], "", None])
def test_unused_empty_values_do_not_lock_type_and_cannot_break_later_ordering(setup_fields, value):
    client, project, url = setup_fields
    field = create_field(setup_fields, "multi_select" if value == [] else "text")
    serializer = issue_serializer(project, {"name": "Empty", "custom_fields": {field["id"]: value}})
    assert serializer.is_valid(), serializer.errors
    issue = serializer.save()
    assert client.patch(url + field["id"] + "/", {"field_type": "integer"}, format="json").status_code == 200
    ordered, _ = order_issue_queryset(
        Issue.objects.filter(project=project), "custom_fields__" + field["id"], project_id=project.id
    )
    assert list(ordered.values_list("id", flat=True)) == [issue.id]


@pytest.mark.parametrize(
    "value,accepted",
    [(9007199254740991, True), (-9007199254740991, True), (9007199254740992, False), (-9007199254740992, False)],
)
def test_integer_bounds_roundtrip_through_browser_json(setup_fields, value, accepted):
    _, project, _ = setup_fields
    field = create_field(setup_fields, "integer")
    serializer = issue_serializer(project, {"name": "Boundary", "custom_fields": {field["id"]: value}})
    assert serializer.is_valid() is accepted


def test_draft_conversion_retains_saved_values_and_merges_patch(setup_fields, create_user):
    from plane.app.serializers.draft import DraftIssueCreateSerializer

    client, project, url = setup_fields
    first = create_field(setup_fields, "text")
    second = create_field(setup_fields, "integer")
    draft_serializer = DraftIssueCreateSerializer(
        data={"name": "Draft", "custom_fields": {first["id"]: "保留"}},
        context={"project_id": project.id, "workspace_id": project.workspace_id},
    )
    assert draft_serializer.is_valid(), draft_serializer.errors
    draft = draft_serializer.save()
    type(draft).all_objects.filter(pk=draft.pk).update(created_by=create_user)
    with (
        mock.patch("plane.app.views.workspace.draft.issue_activity.delay"),
        mock.patch("plane.bgtasks.deletion_task.soft_delete_related_objects.delay"),
    ):
        response = client.post(
            f"/api/workspaces/{project.workspace.slug}/draft-to-issue/{draft.id}/",
            {"name": "Converted", "custom_fields": {second["id"]: 0}},
            format="json",
        )
    assert response.status_code == 201, response.data
    issue = Issue.objects.get(pk=response.data["id"])
    assert issue.custom_fields == {first["id"]: "保留", second["id"]: 0}


@pytest.mark.django_db(transaction=True)
def test_concurrent_writes_preserve_distinct_keys(setup_fields):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections

    _, project, _ = setup_fields
    first = create_field(setup_fields, "text")
    second = create_field(setup_fields, "integer")
    issue = Issue.objects.create(project=project, name="Concurrent")
    barrier = Barrier(2)

    def write(key, value):
        close_old_connections()
        try:
            stale = Issue.objects.get(pk=issue.pk)
            serializer = issue_serializer(project, {"custom_fields": {key: value}}, stale)
            assert serializer.is_valid(), serializer.errors
            barrier.wait(timeout=10)
            serializer.save()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        tasks = [executor.submit(write, first["id"], "parallel"), executor.submit(write, second["id"], 0)]
        for task in tasks:
            task.result(timeout=20)
    issue.refresh_from_db()
    assert issue.custom_fields == {first["id"]: "parallel", second["id"]: 0}


@pytest.mark.parametrize("sub_group", [False, True])
def test_grouped_custom_order_is_applied_before_pagination(setup_fields, sub_group):
    client, project, _ = setup_fields
    field = create_field(setup_fields, "integer")
    ids = []
    for value in [10, 2, 2, None]:
        serializer = issue_serializer(project, {"name": "Grouped", "custom_fields": {field["id"]: value}})
        assert serializer.is_valid(), serializer.errors
        ids.append(str(serializer.save().id))
    params = {"order_by": "custom_fields__" + field["id"], "per_page": 2, "group_by": "state_id"}
    if sub_group:
        params["sub_group_by"] = "priority"
    with mock.patch("plane.app.views.issue.base.recent_visited_task.delay"):
        response = client.get(f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/issues/", params)
    assert response.status_code == 200, response.data
    state = State.objects.get(project=project)
    group = response.data["results"][str(state.id)]["results"]
    if sub_group:
        group = group["none"]["results"]
    assert [str(item["id"]) for item in group] == ids[1:3]
