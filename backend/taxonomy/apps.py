from django.apps import AppConfig


class TaxonomyConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'taxonomy'

    def ready(self):
        # The Unicode-aware `ucontains` lookup needs a Python function registered on every SQLite
        # connection, and `AppConfig.ready` is the earliest place Django guarantees the app registry
        # and the `connections` handler both exist. See config/dbsearch.py for what it fixes.
        #
        # Here rather than in an app that happens to use it: exercises, materials and courses all
        # search, and wiring it from one of them would make the other two depend on that app being
        # loaded. `taxonomy` is what every content app already sits on top of, so it is the one place
        # this cannot be missing.
        from config.dbsearch import register

        register()
