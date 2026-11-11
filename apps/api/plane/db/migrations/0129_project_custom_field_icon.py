from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0128_project_display_defaults_follow_all")]

    operations = [
        migrations.AddField(
            model_name="projectcustomfield",
            name="icon",
            field=models.JSONField(blank=True, default=None, null=True),
        )
    ]
