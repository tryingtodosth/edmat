from django.urls import path

from .views import (
    EducationView,
    ImportedGradesView,
    ProviderStateView,
    SchoolListView,
    UsosConnectView,
    UsosImportView,
    UsosStateView,
)

urlpatterns = [
    path('auth/providers/', ProviderStateView.as_view(), name='auth-providers'),
    path('schools/', SchoolListView.as_view(), name='school-list'),
    path('education/me/', EducationView.as_view(), name='education-me'),
    path('education/usos/', UsosStateView.as_view(), name='usos-state'),
    path('education/usos/connect/', UsosConnectView.as_view(), name='usos-connect'),
    path('education/usos/import/', UsosImportView.as_view(), name='usos-import'),
    path('education/grades/', ImportedGradesView.as_view(), name='education-grades'),
]
