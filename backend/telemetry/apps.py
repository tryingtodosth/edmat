from django.apps import AppConfig


class TelemetryConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'telemetry'
    verbose_name = 'Activity logs'

    def ready(self):
        # Importing the module is what registers the check — see checks.py for why an unmigrated
        # shard would otherwise be completely silent rather than merely broken.
        from . import checks  # noqa: F401
