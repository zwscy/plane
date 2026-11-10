from django.db import migrations, models


def preserve_existing_personal_display(apps, schema_editor):
    # Include soft-deleted rows and avoid save(), so every JSON and timestamp is
    # preserved exactly. Only rows inserted after this migration follow defaults.
    properties = apps.get_model("db", "ProjectUserProperty")
    properties.objects.using(schema_editor.connection.alias).all().update(use_project_default=False)


class Migration(migrations.Migration):
    dependencies = [("db", "0126_project_custom_fields")]

    operations = [
        migrations.AddField(
            model_name="project",
            name="default_display_config",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="projectuserproperty",
            name="use_project_default",
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(preserve_existing_personal_display, migrations.RunPython.noop),
    ]
