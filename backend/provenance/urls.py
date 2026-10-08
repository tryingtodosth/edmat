"""URL conf for `provenance`, included from `config/urls.py` under `api/`.

The prefix is `ai-assistance/` and not `provenance/`: the app is named for what it is about (where
content came from, which may one day be more than one question), the endpoint is named for the one
question it answers, and the kill switch is `ai_assisted`. An address is the first thing a reader
of the API sees.
"""

from django.urls import path

from .views import AssistanceSummaryView, AuthorMarkView, ScoreLockView, VoteView

urlpatterns = [
    path('ai-assistance/', AssistanceSummaryView.as_view(), name='ai-assistance-summary'),
    path(
        'ai-assistance/<str:kind>/<int:pk>/vote/',
        VoteView.as_view(),
        name='ai-assistance-vote',
    ),
    path(
        'ai-assistance/<str:kind>/<int:pk>/author-mark/',
        AuthorMarkView.as_view(),
        name='ai-assistance-author-mark',
    ),
    path(
        'ai-assistance/<str:kind>/<int:pk>/lock/',
        ScoreLockView.as_view(),
        name='ai-assistance-lock',
    ),
]
