"""The admin for polls and the ballots cast in them.

**A ballot and a vote are two tables on purpose**, and the admin keeps them apart rather than
helpfully joining them: `Ballot` records THAT somebody voted (so they cannot vote twice) and `Vote`
records WHAT was chosen. On an anonymous poll, putting the voter and the chosen option on one admin
screen would undo in a list view exactly what the schema separates. So `VoteAdmin` shows the option
and never the user, and `BallotAdmin` shows the user and never the option.
"""

from django.contrib import admin

from .models import Ballot, Poll, PollOption, Vote


class PollOptionInline(admin.TabularInline):
    model = PollOption
    extra = 0
    fields = ('order', 'text')
    ordering = ('order',)


@admin.register(Poll)
class PollAdmin(admin.ModelAdmin):
    list_display = (
        'question',
        'status',
        'mode',
        'anonymous',
        'eligibility',
        'content_type',
        'object_id',
        'closes_at',
    )
    list_filter = ('status', 'mode', 'anonymous', 'eligibility', 'content_type')
    search_fields = ('question', 'description', 'decision_note')
    raw_id_fields = ('created_by', 'closed_by')
    inlines = [PollOptionInline]


@admin.register(PollOption)
class PollOptionAdmin(admin.ModelAdmin):
    list_display = ('text', 'poll', 'order')
    search_fields = ('text', 'poll__question')
    raw_id_fields = ('poll',)


@admin.register(Ballot)
class BallotAdmin(admin.ModelAdmin):
    """Who voted, and when — never what they chose. See this module's own docstring."""

    list_display = ('poll', 'user', 'cast_at')
    search_fields = ('poll__question', 'user__username')
    raw_id_fields = ('poll', 'user')


@admin.register(Vote)
class VoteAdmin(admin.ModelAdmin):
    """What was chosen — never by whom. See this module's own docstring."""

    list_display = ('poll', 'option')
    search_fields = ('poll__question', 'option__text')
    raw_id_fields = ('poll', 'option', 'ballot')
