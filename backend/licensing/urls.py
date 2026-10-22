"""URL conf for `licensing`, included from `config/urls.py` under `api/`."""

from django.urls import path

from .views import BulkLicenceView, LicenceView, MyLicencesView

urlpatterns = [
    # Before `<str:kind>/<int:pk>/` for readability only — neither literal parses as an int pk.
    path('licences/mine/', MyLicencesView.as_view(), name='licence-mine'),
    path('licences/bulk/', BulkLicenceView.as_view(), name='licence-bulk'),
    path('licences/<str:kind>/<int:pk>/', LicenceView.as_view(), name='licence-detail'),
]
