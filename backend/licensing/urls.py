"""URL conf for `licensing`, included from `config/urls.py` under `api/`."""

from django.urls import path

from .views import LicenceView

urlpatterns = [
    path('licences/<str:kind>/<int:pk>/', LicenceView.as_view(), name='licence-detail'),
]
