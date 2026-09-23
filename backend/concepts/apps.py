from django.apps import AppConfig


class ConceptsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'concepts'

    def ready(self):
        from . import signals  # noqa: F401 — the forgetting half of the feed, for removed articles
