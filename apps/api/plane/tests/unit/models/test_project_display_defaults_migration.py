"""Existing project preferences survive the additive display-default migration."""

from copy import deepcopy

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


@pytest.fixture(scope="session")
def django_db_use_migrations():
    # This module exercises RunPython as well as schema changes, unlike the
    # ordinary suite's --nomigrations fast path.
    return True


def test_legacy_preferences_are_preserved_and_only_new_rows_follow_defaults():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [("db", "0126_project_custom_fields")]
    after = [("db", "0127_project_display_defaults")]

    try:
        executor.migrate(before)
        old_apps = executor.loader.project_state(before).apps
        User = old_apps.get_model("db", "User")
        Workspace = old_apps.get_model("db", "Workspace")
        Project = old_apps.get_model("db", "Project")
        Property = old_apps.get_model("db", "ProjectUserProperty")

        owner = User.objects.create(username="migration-owner", email="migration-owner@example.test")
        workspace = Workspace.objects.create(name="Migration", slug="display-migration", owner_id=owner.pk)
        project = Project.objects.create(name="Preferences", identifier="PREF", workspace_id=workspace.pk)
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
        rows = []
        for index, values in enumerate([populated, {key: {} for key in json_fields}, {}, populated]):
            user = User.objects.create(
                username=f"migration-member-{index}", email=f"migration-member-{index}@example.test"
            )
            row = Property.objects.create(
                project_id=project.pk,
                workspace_id=workspace.pk,
                user_id=user.pk,
                sort_order=37.5 + index,
                deleted_at=timezone.now() if index == 3 else None,
                **deepcopy(values),
            )
            rows.append(
                (
                    row.pk,
                    {key: deepcopy(getattr(row, key)) for key in json_fields},
                    row.sort_order,
                    row.updated_at,
                    row.deleted_at,
                )
            )

        executor = MigrationExecutor(connection)
        executor.migrate(after)
        new_apps = executor.loader.project_state(after).apps
        NewProject = new_apps.get_model("db", "Project")
        NewProperty = new_apps.get_model("db", "ProjectUserProperty")

        assert NewProject.objects.get(pk=project.pk).default_display_config == {}
        for row_id, expected_json, sort_order, updated_at, deleted_at in rows:
            actual = NewProperty.objects.get(pk=row_id)
            assert actual.use_project_default is False
            assert {key: getattr(actual, key) for key in json_fields} == expected_json
            assert actual.sort_order == sort_order
            assert actual.updated_at == updated_at
            assert actual.deleted_at == deleted_at

        # The data migration affects only pre-existing rows; the model default
        # remains enabled for a member joining after the migration.
        newcomer = NewProperty.objects.create(project_id=project.pk, workspace_id=workspace.pk, user_id=owner.pk)
        assert newcomer.use_project_default is True
        assert (
            NewProject.objects.create(
                name="New project", identifier="NEW", workspace_id=workspace.pk
            ).default_display_config
            == {}
        )
    finally:
        # Leave the shared pytest database at the current schema even when an
        # assertion fails, so later test modules can continue normally.
        MigrationExecutor(connection).migrate(latest)
