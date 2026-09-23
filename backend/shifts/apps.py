from django.apps import AppConfig


class ShiftsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'shifts'

    def ready(self):
        from . import signals  # noqa: F401 — a session that moves takes its shifts with it
