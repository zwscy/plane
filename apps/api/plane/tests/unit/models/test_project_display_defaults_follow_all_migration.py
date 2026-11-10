"""The one-time follow-default migration keeps every saved preference intact."""

from copy import deepcopy
from datetime import datetime, timezone as datetime_timezone

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


@pytest.fixture(scope="session")
def django_db_use_migrations():
    # Run separately with --migrations: this test exercises the recorded data
    # migration rather than the ordinary suite's --nomigrations schema shortcut.
    return True


def test_existing_rows_follow_defaults_once_without_rewriting_saved_data():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [("db", "0127_project_display_defaults")]
    after = [("db", "0128_project_display_defaults_follow_all")]

    try:
        executor.migrate(before)
        old_apps = executor.loader.project_state(before).apps
        User = old_apps.get_model("db", "User")
        Workspace = old_apps.get_model("db", "Workspace")
        Project = old_apps.get_model("db", "Project")
        Property = old_apps.get_model("db", "ProjectUserProperty")

        owner = User.objects.create(username="follow-all-owner", email="follow-all-owner@example.test")
        workspace = Workspace.objects.create(name="Follow all", slug="follow-all-migration", owner_id=owner.pk)
        default_config = {
            "display_properties": {"state": True, "column_order": ["key", "state"]},
            "order_by": "-created_at",
            "sub_issue": True,
            "legacy_key": {"retained": [False, 0, None]},
        }
        configured = Project.objects.create(
            name="Configured", identifier="CONF", workspace_id=workspace.pk, default_display_config=default_config
        )
        unset = Project.objects.create(name="Unset", identifier="UNSET", workspace_id=workspace.pk)
        populated = {
            "filters": {"priority": ["urgent"], "legacy_key": ["retained"]},
            "display_filters": {
                "layout": "spreadsheet",
                "group_by": "state",
                "sub_group_by": "priority",
                "order_by": "-custom_fields__historical-field",
                "sub_issue": False,
                "calendar_date_range": "2026-11",
                "legacy_key": {"nested": [False, 0, None]},
            },
            "display_properties": {
                "state": False,
                "priority": True,
                "column_order": ["key", "state", "custom_fields__historical-field"],
                "custom_fields": {"historical-field": False},
                "legacy_key": "retained",
            },
            "rich_filters": {"and": [{"property": "priority", "operator": "in", "value": ["urgent"]}]},
            "preferences": {"navigation": {"default_tab": "pages"}, "legacy_key": [1, 2]},
        }
        json_fields = ("filters", "display_filters", "display_properties", "rich_filters", "preferences")
        saved_at = datetime(2024, 6, 1, 8, 30, tzinfo=datetime_timezone.utc)
        row_ids = []
        for index, (project, follows, deleted, values) in enumerate(
            [
                (configured, False, False, populated),
                (configured, True, False, populated),
                (configured, False, True, populated),
                (configured, True, True, populated),
                (unset, False, False, {key: {} for key in json_fields}),
                (unset, False, True, {}),
            ]
        ):
            user = User.objects.create(
                username=f"follow-all-member-{index}", email=f"follow-all-member-{index}@example.test"
            )
            row = Property.objects.create(
                project_id=project.pk,
                workspace_id=workspace.pk,
                user_id=user.pk,
                use_project_default=follows,
                sort_order=37.5 + index,
                deleted_at=saved_at if deleted else None,
                **deepcopy(values),
            )
            row_ids.append(row.pk)
        Property.objects.filter(pk__in=row_ids).update(created_at=saved_at, updated_at=saved_at)
        Project.objects.filter(pk__in=[configured.pk, unset.pk]).update(updated_at=saved_at)
        expected_rows = list(Property.objects.filter(pk__in=row_ids).order_by("pk").values())
        expected_projects = list(Project.objects.filter(pk__in=[configured.pk, unset.pk]).order_by("pk").values())

        executor = MigrationExecutor(connection)
        executor.migrate(after)
        new_apps = executor.loader.project_state(after).apps
        NewProject = new_apps.get_model("db", "Project")
        NewProperty = new_apps.get_model("db", "ProjectUserProperty")

        actual_rows = list(NewProperty.objects.filter(pk__in=row_ids).order_by("pk").values())
        assert all(row["use_project_default"] is True for row in actual_rows)
        assert len(actual_rows) == len(expected_rows)
        for actual, expected in zip(actual_rows, expected_rows):
            assert actual == {**expected, "use_project_default": True}
        assert (
            list(NewProject.objects.filter(pk__in=[configured.pk, unset.pk]).order_by("pk").values())
            == expected_projects
        )

        # A later personal choice survives another migrate invocation, as it
        # would after restarting a container whose migrations are already applied.
        override_id = row_ids[0]
        NewProperty.objects.filter(pk=override_id).update(
            use_project_default=False, display_properties={"state": False, "column_order": ["state", "key"]}
        )
        override = NewProperty.objects.values().get(pk=override_id)
        MigrationExecutor(connection).migrate(after)
        assert NewProperty.objects.values().get(pk=override_id) == override
    finally:
        MigrationExecutor(connection).migrate(latest)
