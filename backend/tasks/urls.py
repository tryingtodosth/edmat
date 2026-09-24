"""Routes: the board hangs off a node, one task hangs off its own id.

`MANAGEMENT-BRIEF.md` §2 — the nested prefix `nodes/<kind>/<pk>/tasks/` lives HERE, in this app,
rather than in `config/urls.py`, so that six parallel branches each own their own line and none of
them edits a shared file. `config/urls.py` already includes this module; the prep commit did that
with an empty router precisely so no step has to.

`<int:pk>` on the nested path and `NumericPkRouter` on the viewset are the same decision twice
(`config/routers.py`): `/api/tasks/undefined/` is a 404 from the URL resolver rather than a 500
from `int()`.
"""

from django.urls import path

from config.routers import NumericPkRouter

from .views import NodeTasksView, TaskViewSet

router = NumericPkRouter()
router.register('tasks', TaskViewSet, basename='task')

urlpatterns = router.urls + [
    path('nodes/<str:kind>/<int:pk>/tasks/', NodeTasksView.as_view(), name='node-tasks'),
]
