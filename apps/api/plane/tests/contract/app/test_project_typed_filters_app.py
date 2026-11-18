"""Project rich-filter contract: typed values, scope, counts and pagination."""

import json
from datetime import date
from unittest import mock
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from plane.db.models import Issue, Label, Project, ProjectCustomField, ProjectMember, State, User, WorkspaceMember

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture
def filter_project(workspace, create_user):
    project = Project.objects.create(name="Filters", identifier="FLT", workspace=workspace)
    ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
    State.objects.create(project=project, name="Todo", color="#000000", default=True)
    client = APIClient()
    client.force_authenticate(create_user)
    return client, project


def field(project, kind, **kwargs):
    return ProjectCustomField.objects.create(project=project, name=kind, field_type=kind, **kwargs)


def issue(project, name, definition=None, value=None, **kwargs):
    return Issue.objects.create(
        project=project, name=name, custom_fields={} if definition is None else {str(definition.id): value}, **kwargs
    )


def fetch(filter_project, expression, **params):
    client, project = filter_project
    with mock.patch("plane.app.views.issue.base.recent_visited_task.delay"):
        return client.get(
            f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/issues/",
            {"filters": json.dumps(expression), **params},
        )


def names(response):
    assert response.status_code == 200, response.data
    return {item["name"] for item in response.data["results"]}


@pytest.mark.parametrize("layout", ["list", "spreadsheet"])
def test_tree_filter_keeps_the_path_to_a_match_and_hides_other_branches(filter_project, layout):
    _, project = filter_project
    definition = field(project, "integer")
    parent = issue(project, "Root", definition, 1)
    child = issue(project, "Intermediate", definition, 2, parent=parent)
    leaf = issue(project, "Matching leaf", definition, 10, parent=child)
    issue(project, "Unrelated sibling", definition, 3, parent=child)
    issue(project, "Unrelated branch", definition, 4)
    expression = {"and": [{"name__icontains": "Matching"}, {f"custom_fields__{definition.id}__gt": 5}]}
    tree = fetch(filter_project, expression, sub_issue="false", layout=layout, filter_tree="true")
    assert names(tree) == {parent.name}
    assert tree.data["results"][0]["sub_issues_count"] == 1
    assert tree.data["filtered_tree"]["match_count"] == 1
    assert {row["id"] for row in tree.data["filtered_tree"]["children"]} == {child.id, leaf.id}
    assert set(tree.data["filtered_tree"]["context_ids"]) == {str(parent.id), str(child.id)}
    # The cached issue details keep their actual counts. A filtered layout uses
    # only its own child list for chevrons and inline expansion.
    assert next(row for row in tree.data["filtered_tree"]["children"] if row["id"] == child.id)["sub_issues_count"] == 2

    flat = fetch(filter_project, expression, sub_issue="true", layout=layout, filter_tree="true")
    assert names(flat) == {leaf.name}
    assert "filtered_tree" not in flat.data
    cleared = fetch(filter_project, {}, sub_issue="false", layout=layout, filter_tree="true")
    assert names(cleared) == {parent.name, "Unrelated branch"}
    assert "filtered_tree" not in cleared.data


def test_tree_filter_requires_project_page_opt_in(filter_project):
    _, project = filter_project
    parent = issue(project, "Parent")
    issue(project, "Matching child", parent=parent)
    legacy = fetch(filter_project, {"name__icontains": "Matching"}, sub_issue="false", layout="list")
    assert names(legacy) == set()
    assert "filtered_tree" not in legacy.data


def test_tree_filter_paginates_whole_branches_and_orders_siblings(filter_project):
    _, project = filter_project
    definition = field(project, "integer")
    left = issue(project, "Match left", definition, 1)
    right = issue(project, "Right root", definition, 2)
    different_state = State.objects.create(project=project, name="Started", group="started", color="#123456")
    issue(project, "Hidden under matching parent", definition, 0, parent=left)
    issue(project, "Match ten", definition, 10, parent=right, state=different_state)
    issue(project, "Match two", definition, 2, parent=right, state=different_state)
    expression = {"name__icontains": "Match "}
    params = {
        "sub_issue": "false",
        "layout": "list",
        "filter_tree": "true",
        "per_page": 1,
        "order_by": f"custom_fields__{definition.id}",
    }
    first = fetch(filter_project, expression, **params)
    assert names(first) == {left.name}
    assert first.data["total_results"] == 2
    assert first.data["next_page_results"] is True
    assert first.data["filtered_tree"] == {"match_count": 3, "children": [], "context_ids": []}

    second = fetch(filter_project, expression, cursor=first.data["next_cursor"], **params)
    assert names(second) == {right.name}
    assert second.data["next_page_results"] is False
    assert second.data["filtered_tree"]["match_count"] == 3
    assert [row["name"] for row in second.data["filtered_tree"]["children"]] == ["Match two", "Match ten"]
    assert second.data["filtered_tree"]["context_ids"] == [str(right.id)]

    grouped = fetch(filter_project, expression, group_by="state_id", **params)
    assert grouped.status_code == 200, grouped.data
    assert [row["name"] for group in grouped.data["results"].values() for row in group["results"]] == [left.name]
    assert grouped.data["filtered_tree"]["match_count"] == 3

    continued_group = fetch(
        filter_project,
        expression,
        tree_group_by="state_id",
        tree_group_id=str(right.state_id),
        cursor=grouped.data["next_cursor"],
        **params,
    )
    assert names(continued_group) == {right.name}
    assert [row["name"] for row in continued_group.data["filtered_tree"]["children"]] == ["Match two", "Match ten"]
    assert continued_group.data["filtered_tree"]["match_count"] == 3
    invalid = fetch(filter_project, expression, tree_group_by="state_id", tree_group_id="invalid", **params)
    assert invalid.status_code == 400


def test_tree_filter_does_not_expose_inaccessible_ancestors_or_descendants(filter_project, create_user):
    client, project = filter_project
    guest = User.objects.create(email="tree-guest@example.com", username="tree-guest")
    WorkspaceMember.objects.create(workspace=project.workspace, member=guest, role=5)
    ProjectMember.objects.create(workspace=project.workspace, project=project, member=guest, role=5)
    project.guest_view_all_features = False
    project.save(update_fields=["guest_view_all_features"])
    hidden_root = issue(project, "Hidden root")
    visible_root = issue(project, "Visible owner", parent=hidden_root)
    visible_leaf = issue(project, "Match visible", parent=visible_root)
    hidden_leaf = issue(project, "Match hidden", parent=visible_root)
    # BaseModel stamps created_by from the request audit context during save.
    Issue.objects.filter(id__in=[hidden_root.id, hidden_leaf.id]).update(created_by=create_user)
    Issue.objects.filter(id__in=[visible_root.id, visible_leaf.id]).update(created_by=guest)
    client.force_authenticate(guest)

    tree = fetch(
        filter_project, {"name__icontains": "Match"}, sub_issue="false", layout="spreadsheet", filter_tree="true"
    )
    assert names(tree) == {visible_root.name}
    assert tree.data["filtered_tree"]["match_count"] == 1
    assert [row["id"] for row in tree.data["filtered_tree"]["children"]] == [visible_leaf.id]
    assert tree.data["filtered_tree"]["context_ids"] == [str(visible_root.id)]


@pytest.mark.parametrize("kind", ["integer", "decimal"])
def test_numeric_comparison_and_range_before_pagination(filter_project, kind):
    _, project = filter_project
    definition = field(project, kind)
    for value in [-3, 0, 2, 10, 10.5 if kind == "decimal" else 11]:
        issue(project, str(value), definition, value)
    key = f"custom_fields__{definition.id}"
    response = fetch(filter_project, {key + "__gt": 2}, per_page=1)
    assert response.status_code == 200, response.data
    assert response.data["total_results"] == 2
    assert len(response.data["results"]) == 1
    assert names(fetch(filter_project, {key + "__range": [-3, 2]})) == {"-3", "0", "2"}
    assert names(fetch(filter_project, {key + "__not_range": "0,10"})) == {"-3", "10.5" if kind == "decimal" else "11"}


@pytest.mark.parametrize("kind,values", [("text", ["", "AbCd", "abc"]), ("boolean", [False, True])])
def test_empty_distinguishes_absent_null_empty_and_false(filter_project, kind, values):
    _, project = filter_project
    definition = field(project, kind)
    issue(project, "absent")
    issue(project, "null", definition, None)
    for value in values:
        issue(project, repr(value), definition, value)
    key = f"custom_fields__{definition.id}"
    expected = {"absent", "null", "''"} if kind == "text" else {"absent", "null"}
    assert names(fetch(filter_project, {key + "__is_empty": True})) == expected
    assert names(fetch(filter_project, {key + "__is_not_empty": True})) == set(map(repr, values)) - {"''"}
    if kind == "boolean":
        assert names(fetch(filter_project, {key + "__exact": False})) == {"False"}
    else:
        assert names(fetch(filter_project, {key + "__icontains": "BC"})) == {"'AbCd'", "'abc'"}
        assert names(fetch(filter_project, {key + "__not_icontains": "BC"})) == expected


def test_zero_or_and_not(filter_project):
    _, project = filter_project
    definition = field(project, "integer")
    issue(project, "zero", definition, 0)
    issue(project, "ten", definition, 10)
    issue(project, "missing")
    key = f"custom_fields__{definition.id}"
    assert names(fetch(filter_project, {key + "__is_empty": True})) == {"missing"}
    assert names(fetch(filter_project, {"or": [{key + "__exact": 0}, {"name__icontains": "miss"}]})) == {
        "zero",
        "missing",
    }
    assert names(fetch(filter_project, {"not": {key + "__exact": 10}})) == {"zero", "missing"}


def test_dates_compare_calendar_dates_and_validate_bounds(filter_project):
    _, project = filter_project
    definition = field(project, "date")
    for value in ["2026-01-02", "2026-01-10", "2026-02-01"]:
        issue(project, value, definition, value)
    key = f"custom_fields__{definition.id}"
    assert names(fetch(filter_project, {key + "__range": ["2026-01-02", "2026-01-10"]})) == {"2026-01-02", "2026-01-10"}
    assert names(fetch(filter_project, {key + "__gt": "2026-01-10"})) == {"2026-02-01"}
    assert fetch(filter_project, {key + "__exact": "2026-02-30"}).status_code == 400
    assert fetch(filter_project, {key + "__range": ["2026-02-01", "2026-01-01"]}).status_code == 400


def test_multiselect_any_all_none_and_inactive_options(filter_project):
    _, project = filter_project
    first, second = str(uuid4()), str(uuid4())
    definition = field(
        project,
        "multi_select",
        options=[
            {"id": first, "name": "One", "is_active": True},
            {"id": second, "name": "Historical", "is_active": False},
        ],
    )
    issue(project, "both", definition, [first, second])
    issue(project, "one", definition, [first])
    issue(project, "empty", definition, [])
    issue(project, "absent")
    key = f"custom_fields__{definition.id}"
    assert names(fetch(filter_project, {key + "__in": [second]})) == {"both"}
    assert names(fetch(filter_project, {key + "__in": first + "," + second})) == {"both", "one"}
    assert names(fetch(filter_project, {key + "__contains_all": [first, second]})) == {"both"}
    assert names(fetch(filter_project, {key + "__not_in": [second]})) == {"one", "empty", "absent"}
    assert names(fetch(filter_project, {key + "__is_empty": True})) == {"empty", "absent"}
    assert fetch(filter_project, {key + "__in": [str(uuid4())]}).status_code == 400


@pytest.mark.parametrize("invalid", [True, "2", 1.5, [2], None])
def test_integer_rejects_wrong_scalar_types(filter_project, invalid):
    _, project = filter_project
    definition = field(project, "integer")
    assert fetch(filter_project, {f"custom_fields__{definition.id}__exact": invalid}).status_code == 400


@pytest.mark.parametrize(
    "suffix,value",
    [
        ("__is_empty", False),
        ("__is_empty", "true"),
        ("__regex", ".*"),
        ("__icontains", "1"),
        ("__range", [1]),
        ("__range", [10, 1]),
        ("__in", []),
        ("__exact", {"gte": 1}),
    ],
)
def test_invalid_operators_and_shapes_fail_explicitly(filter_project, suffix, value):
    _, project = filter_project
    definition = field(project, "integer")
    assert fetch(filter_project, {f"custom_fields__{definition.id}" + suffix: value}).status_code == 400


def test_definition_scope_and_arbitrary_lookups_are_rejected(filter_project, workspace):
    _, project = filter_project
    other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
    foreign = field(other, "text")
    inactive = field(project, "text", is_active=False)
    deleted = field(project, "text")
    deleted.delete()
    for key in [f"custom_fields__{item}__exact" for item in [foreign.id, inactive.id, deleted.id, uuid4(), "bad"]] + [
        "custom_fields__password__icontains",
        "project__workspace__owner__email__icontains",
    ]:
        assert fetch(filter_project, {key: "test"}).status_code == 400


def test_custom_reference_must_belong_to_project(filter_project, workspace):
    _, project = filter_project
    other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
    local = Label.objects.create(project=project, name="Here", color="#000000")
    foreign = Label.objects.create(project=other, name="Elsewhere", color="#000000")
    definition = field(project, "labels")
    issue(project, "local", definition, [str(local.id)])
    key = f"custom_fields__{definition.id}__in"
    assert names(fetch(filter_project, {key: [str(local.id)]})) == {"local"}
    assert fetch(filter_project, {key: [str(foreign.id)]}).status_code == 400


def test_native_dates_arrays_empty_relations_and_legacy_csv(filter_project):
    _, project = filter_project
    issue(project, "planned", target_date=date(2026, 11, 11), priority="high")
    issue(project, "unplanned", priority="low")
    assert names(fetch(filter_project, {"target_date__gte": "2026-11-11"})) == {"planned"}
    assert names(fetch(filter_project, {"target_date__is_empty": True})) == {"unplanned"}
    assert names(fetch(filter_project, {"priority__in": ["high", "low"]})) == {"planned", "unplanned"}
    assert names(fetch(filter_project, {"priority__in": "high,low"})) == {"planned", "unplanned"}
    assert names(fetch(filter_project, {"label_id__is_empty": True})) == {"planned", "unplanned"}
    assert names(fetch(filter_project, {"cycle_id__is_empty": True})) == {"planned", "unplanned"}
    assert fetch(filter_project, {"name__exact": ["planned"]}).status_code == 400


def test_native_multi_relations_use_active_links_and_do_not_duplicate_results(filter_project):
    from plane.db.models import IssueLabel

    _, project = filter_project
    first = Label.objects.create(project=project, name="First", color="#000000")
    second = Label.objects.create(project=project, name="Second", color="#000000")
    both = issue(project, "both")
    deleted = issue(project, "deleted-link")
    for label in [first, second]:
        IssueLabel.objects.create(project=project, issue=both, label=label)
    IssueLabel.objects.create(project=project, issue=deleted, label=first)
    link = IssueLabel.objects.create(project=project, issue=deleted, label=second)
    link.delete()
    assert names(fetch(filter_project, {"label_id__in": [str(second.id)]})) == {"both"}
    assert names(fetch(filter_project, {"label_id__contains_all": [str(first.id), str(second.id)]})) == {"both"}
    assert names(fetch(filter_project, {"label_id__not_in": [str(second.id)]})) == {"deleted-link"}
    response = fetch(filter_project, {"label_id__in": [str(first.id), str(second.id)]}, per_page=1)
    assert response.status_code == 200, response.data
    assert response.data["total_results"] == 2
    assert len(response.data["results"]) == 1


@pytest.mark.parametrize(
    "kind", ["textarea", "select", "member", "members", "state", "priority", "cycle", "modules", "estimate"]
)
def test_remaining_custom_types_accept_valid_typed_values(filter_project, create_user, kind):
    from plane.db.models import Cycle, Estimate, EstimatePoint, Module

    _, project = filter_project
    kwargs = {}
    if kind == "textarea":
        value = "Long text"
    elif kind == "priority":
        value = "high"
    elif kind == "select":
        value = str(uuid4())
        kwargs["options"] = [{"id": value, "name": "Old choice", "is_active": False}]
    elif kind in {"member", "members"}:
        value = str(create_user.id)
    elif kind == "state":
        value = str(State.objects.get(project=project).id)
    elif kind == "cycle":
        value = str(Cycle.objects.create(project=project, name="Cycle", owned_by=create_user).id)
    elif kind == "modules":
        value = str(Module.objects.create(project=project, name="Module").id)
    else:
        estimate = Estimate.objects.create(project=project, name="Estimate")
        value = str(EstimatePoint.objects.create(project=project, estimate=estimate, key=1, value="1").id)
    multiple = kind in {"members", "modules"}
    definition = field(project, kind, **kwargs)
    issue(project, "match", definition, [value] if multiple else value)
    issue(project, "absent")
    key = f"custom_fields__{definition.id}"
    assert names(
        fetch(filter_project, {key + ("__in" if multiple else "__exact"): [value] if multiple else value})
    ) == {"match"}
    assert names(fetch(filter_project, {key + "__is_not_empty": True})) == {"match"}


def test_builtin_estimate_point_and_created_date(filter_project):
    from datetime import datetime, timezone
    from plane.db.models import Estimate, EstimatePoint

    _, project = filter_project
    estimate = Estimate.objects.create(project=project, name="Estimate")
    point = EstimatePoint.objects.create(project=project, estimate=estimate, key=2, value="2")
    item = issue(project, "estimated", estimate_point=point)
    unestimated = issue(project, "unestimated")
    Issue.objects.filter(pk=unestimated.pk).update(created_at=datetime(2020, 1, 1, 12, tzinfo=timezone.utc))
    Issue.objects.filter(pk=item.pk).update(created_at=datetime(2026, 11, 11, 15, 30, tzinfo=timezone.utc))
    assert names(fetch(filter_project, {"estimate_point__exact": str(point.id)})) == {"estimated"}
    assert names(fetch(filter_project, {"estimate_point__is_empty": True})) == {"unestimated"}
    assert names(fetch(filter_project, {"created_at__range": ["2026-11-11", "2026-11-11"]})) == {"estimated"}


@pytest.mark.parametrize("expression", [[], False, None, "", 1])
def test_non_object_filter_json_is_rejected(filter_project, expression):
    assert fetch(filter_project, expression).status_code == 400


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf"), "NaN", True])
def test_decimal_rejects_nonfinite_or_mistyped_numbers(filter_project, value):
    _, project = filter_project
    definition = field(project, "decimal")
    assert fetch(filter_project, {f"custom_fields__{definition.id}__gt": value}).status_code == 400


def test_custom_filter_requires_explicit_project_context(filter_project):
    from types import SimpleNamespace
    from rest_framework.exceptions import ValidationError
    from plane.utils.filters import ComplexFilterBackend, IssueFilterSet

    _, project = filter_project
    definition = field(project, "text")
    with pytest.raises(ValidationError, match="project endpoint"):
        ComplexFilterBackend().filter_queryset(
            None,
            Issue.objects.filter(project=project),
            SimpleNamespace(kwargs={}, filterset_class=IssueFilterSet),
            filter_data={f"custom_fields__{definition.id}__exact": "text"},
        )


@pytest.mark.parametrize("group", ["and", "or", "not"])
def test_logical_operator_case_matches_validation_contract(filter_project, group):
    _, project = filter_project
    issue(project, "match")
    issue(project, "other")
    condition = {"name__exact": "match"}
    payload = condition if group == "not" else [condition]
    expected = {"other"} if group == "not" else {"match"}
    assert names(fetch(filter_project, {group.upper(): payload})) == expected


def test_legacy_state_groups_remain_queryable(filter_project):
    assert fetch(filter_project, {"state_group__in": "triage"}).status_code == 200


def test_extremely_large_decimal_and_empty_dictionary_are_rejected(filter_project):
    _, project = filter_project
    definition = field(project, "decimal")
    key = f"custom_fields__{definition.id}__gt"
    assert fetch(filter_project, {key: 10**1000}).status_code == 400
    assert fetch(filter_project, {key: {}}).status_code == 400
    assert fetch(filter_project, {"and": [{}]}).status_code == 400
