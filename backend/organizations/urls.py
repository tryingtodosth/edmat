"""URL conf for `organizations` (MANAGEMENT-BRIEF.md §3). Included from `config/urls.py` under `api/` by
the prep commit, with an empty router, so that an unbuilt step answers 404 rather than breaking the
import. Register viewsets on `router` and add nested `path()`s to `urlpatterns`."""

from config.routers import NumericPkRouter

router = NumericPkRouter()

urlpatterns = router.urls
