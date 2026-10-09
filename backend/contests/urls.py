"""URL conf for `contests`. Included from `config/urls.py` under `api/`.

The prep registers one path, `contest-presets/`, so that the preset wizard (step A) and the
presets registry (step B) meet at an address neither has to add. Step A registers its viewsets on
the router below; step B adds `contest-compliance/<int:pk>/` and nothing else here.
"""

from django.urls import path

from config.routers import NumericPkRouter

from .views import ContestPresetsView

router = NumericPkRouter()

urlpatterns = router.urls + [
    path('contest-presets/', ContestPresetsView.as_view(), name='contest-presets'),
]
