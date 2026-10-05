"""URL conf for `flashcards` (prompts/02-flashcards.md). Included from `config/urls.py` under
`api/` by the prep commit, EMPTY; step A registers its viewsets here and nowhere else."""

from config.routers import NumericPkRouter

router = NumericPkRouter()

urlpatterns = router.urls
