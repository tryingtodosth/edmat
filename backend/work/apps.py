from django.apps import AppConfig


class WorkConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'work'

    def ready(self):
        """Register builtin providers when the app is ready."""
        from . import builtin  # noqa: F401
        # The management steps' own providers, wired at integration (work/integrations.py).
        from . import integrations  # noqa: F401
