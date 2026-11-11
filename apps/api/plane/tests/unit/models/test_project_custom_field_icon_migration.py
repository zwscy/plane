"""Adding optional field icons preserves historical task and display data."""

from datetime import datetime, timezone as datetime_timezone
from uuid import uuid4

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = [pytest.mark.unit, pytest.mark.django_db(transaction=True)]


@pytest.fixture(scope="session")
def django_db_use_migrations():
    # Run separately with --migrations so the real 0128 -> 0129 upgrade is exercised.
    return True


def test_icon_migration_only_adds_null_column_and_preserves_existing_rows():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [("db", "0128_project_display_defaults_follow_all")]
    after = [("db", "0129_project_custom_field_icon")]

    try:
        executor.migrate(before)
        old_apps = executor.loader.project_state(before).apps
        models = {
            name: old_apps.get_model("db", name)
            for name in [
                "User",
                "Workspace",
                "Project",
                "ProjectCustomField",
                "Issue",
                "DraftIssue",
                "ProjectUserProperty",
            ]
        }
        owner = models["User"]._base_manager.create(username="icon-owner", email="icon-owner@example.test")
        workspace = models["Workspace"]._base_manager.create(name="Icons", slug="icon-migration", owner_id=owner.pk)
        first_id, second_id, option_id = uuid4(), uuid4(), str(uuid4())
        project = models["Project"]._base_manager.create(
            name="Icons",
            identifier="ICON",
            workspace_id=workspace.pk,
            default_display_config={
                "display_properties": {"custom_fields": {str(first_id): True}, "column_order": ["key", str(first_id)]},
                "order_by": "-created_at",
                "legacy_key": [False, 0, None],
            },
        )
        definitions = []
        saved_at = datetime(2024, 6, 1, 8, 30, tzinfo=datetime_timezone.utc)
        for field_id, kind, options, deleted in [
            (first_id, "decimal", [], False),
            (second_id, "select", [{"id": option_id, "name": "Saved", "is_active": False}], True),
        ]:
            definitions.append(
                models["ProjectCustomField"]._base_manager.create(
                    id=field_id,
                    project_id=project.pk,
                    workspace_id=workspace.pk,
                    name=f"Historical {kind}",
                    description="Keep description",
                    field_type=kind,
                    options=options,
                    sort_order=37.5,
                    is_active=not deleted,
                    deleted_at=saved_at if deleted else None,
                )
            )
        values = {str(first_id): 0, str(second_id): option_id, "unknown-historical-field": "retained"}
        issue = models["Issue"]._base_manager.create(
            name="Historical issue", project_id=project.pk, workspace_id=workspace.pk, custom_fields=values
        )
        draft = models["DraftIssue"]._base_manager.create(
            name="Historical draft", project_id=project.pk, workspace_id=workspace.pk, custom_fields=values
        )
        preference = models["ProjectUserProperty"]._base_manager.create(
            project_id=project.pk,
            workspace_id=workspace.pk,
            user_id=owner.pk,
            use_project_default=False,
            filters={"priority": ["urgent"], "legacy_key": [False, 0]},
            display_filters={"layout": "spreadsheet", "order_by": f"-custom_fields__{first_id}"},
            display_properties={"custom_fields": {str(first_id): False}, "column_order": ["state", "key"]},
            rich_filters={"and": [{"property": "priority", "operator": "in", "value": ["urgent"]}]},
            preferences={"navigation": {"default_tab": "pages"}},
            sort_order=82.5,
        )
        rows = {
            "Project": [project.pk],
            "ProjectCustomField": [row.pk for row in definitions],
            "Issue": [issue.pk],
            "DraftIssue": [draft.pk],
            "ProjectUserProperty": [preference.pk],
        }
        expected = {}
        for name, row_ids in rows.items():
            queryset = models[name]._base_manager.filter(pk__in=row_ids)
            queryset.update(created_at=saved_at, updated_at=saved_at)
            expected[name] = list(queryset.order_by("pk").values())

        executor = MigrationExecutor(connection)
        executor.migrate(after)
        new_apps = executor.loader.project_state(after).apps
        for name, row_ids in rows.items():
            actual = list(new_apps.get_model("db", name)._base_manager.filter(pk__in=row_ids).order_by("pk").values())
            if name == "ProjectCustomField":
                assert actual == [{**row, "icon": None} for row in expected[name]]
            else:
                assert actual == expected[name]
        NewField = new_apps.get_model("db", "ProjectCustomField")
        fresh = NewField._base_manager.create(
            name="New default", field_type="text", project_id=project.pk, workspace_id=workspace.pk
        )
        assert fresh.icon is None
    finally:
        MigrationExecutor(connection).migrate(latest)
