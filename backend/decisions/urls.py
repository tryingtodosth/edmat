"""URL conf for `decisions` (MANAGEMENT-BRIEF.md §3). Includes:
- /api/nodes/<kind>/<pk>/polls/ — polls nested under a node
- /api/polls/{id}/ and actions — individual poll operations
- /api/poll-options/{id}/ — option deletion
"""

from django.urls import path

from config.routers import NumericPkRouter
from .views import NodePollsView, PollOptionViewSet, PollViewSet

router = NumericPkRouter()
router.register(r'polls', PollViewSet, basename='poll')
router.register(r'poll-options', PollOptionViewSet, basename='poll-option')

urlpatterns = [
    # Node-nested polls list/create
    path('nodes/<str:kind>/<int:pk>/polls/', NodePollsView.as_view(), name='node-polls'),
]

urlpatterns += router.urls
