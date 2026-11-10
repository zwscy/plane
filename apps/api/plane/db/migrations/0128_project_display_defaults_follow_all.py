from django.db import migrations


def follow_project_defaults(apps, schema_editor):
    # Include soft-deleted rows and use update() so saved JSON and timestamps
    # remain untouched. Django records this one-time policy change as applied.
    properties = apps.get_model("db", "ProjectUserProperty")
    properties.objects.using(schema_editor.connection.alias).all().update(use_project_default=True)


class Migration(migrations.Migration):
    dependencies = [("db", "0127_project_display_defaults")]

    # Previous flags cannot be inferred: restore the pre-upgrade backup when
    # exact original follow/personal states are required.
    operations = [migrations.RunPython(follow_project_defaults, migrations.RunPython.noop)]
