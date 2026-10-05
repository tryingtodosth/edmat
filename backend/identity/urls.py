from django.urls import path

from .views import (
    EducationView,
    ImportedGradesView,
    LearningRecordView,
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
    # A sibling of `accounts`' own `users/<pk>/…` paths (both apps are included under `api/`), which
    # is what keeps the learning record off the profile response every byline already fetches while
    # still addressing it by the same user id everything else in this API uses.
    path(
        'users/<int:pk>/learning-record/',
        LearningRecordView.as_view(),
        name='user-learning-record',
    ),
]
