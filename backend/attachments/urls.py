"""One pattern for every target kind, and the attachment's own routes.

`<kind>` is a word from `targets.TARGET_KINDS`, not a route each of nine apps has to add — which is
the whole point of the registry. `config/urls.py` includes this once.
"""

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AttachmentViewSet, TargetAttachmentsView

router = DefaultRouter()
router.register(r'attachments', AttachmentViewSet, basename='attachment')

urlpatterns = [
    path('<str:kind>/<int:pk>/attachments/', TargetAttachmentsView.as_view(), name='target-attachments'),
    *router.urls,
]
