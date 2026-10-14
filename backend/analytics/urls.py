from django.urls import path

from . import views

urlpatterns = [
    path('analytics/overview/', views.OverviewView.as_view(), name='analytics-overview'),
    path('analytics/traffic/', views.TrafficView.as_view(), name='analytics-traffic'),
    path('analytics/content/', views.ContentView.as_view(), name='analytics-content'),
    path('analytics/community/', views.CommunityView.as_view(), name='analytics-community'),
    path('analytics/moderation/', views.ModerationView.as_view(), name='analytics-moderation'),
    path('analytics/coverage/', views.CoverageView.as_view(), name='analytics-coverage'),
    path('analytics/cohorts/', views.CohortsView.as_view(), name='analytics-cohorts'),
    path('analytics/clients/', views.ClientsView.as_view(), name='analytics-clients'),
    path('analytics/health/', views.HealthView.as_view(), name='analytics-health'),
    path('analytics/recompute/', views.RecomputeView.as_view(), name='analytics-recompute'),
]
