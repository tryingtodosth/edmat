"""The admin for decks, cards, and the per-person SM-2 schedule.

`ReviewState` is **one row per (person, card)** and is the schedule itself — editing `due_at` or
`ease` by hand moves somebody's revision, which is a thing an operator may legitimately need to do
after a data repair and should never do casually. It is registered read-only for that reason:
visible, searchable, and not quietly editable. `ReviewLog` is an append-only record and is read-only
for the stronger reason that rewriting history is never a repair.
"""

from django.contrib import admin

from .models import Card, Deck, DeckPlacement, ReviewLog, ReviewState


class CardInline(admin.TabularInline):
    model = Card
    extra = 0
    fields = ('order', 'front', 'back', 'exercise', 'concept')
    raw_id_fields = ('exercise', 'concept')
    ordering = ('order',)


@admin.register(Deck)
class DeckAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'audience', 'is_public', 'source_kind', 'created_at')
    list_filter = ('is_public', 'audience', 'source_kind')
    search_fields = ('name', 'owner__username')
    raw_id_fields = ('owner', 'source_set')
    inlines = [CardInline]


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ('deck', 'order', 'front', 'exercise', 'concept')
    list_filter = ('include_hint', 'include_solution')
    search_fields = ('front', 'back', 'deck__name')
    raw_id_fields = ('deck', 'exercise', 'concept')


@admin.register(ReviewState)
class ReviewStateAdmin(admin.ModelAdmin):
    list_display = ('user', 'card', 'due_at', 'interval_days', 'ease', 'repetitions', 'lapses')
    list_filter = ('repetitions', 'lapses')
    search_fields = ('user__username', 'card__front')
    raw_id_fields = ('user', 'card')
    readonly_fields = ('user', 'card', 'due_at', 'interval_days', 'ease', 'repetitions', 'lapses', 'updated_at')


@admin.register(ReviewLog)
class ReviewLogAdmin(admin.ModelAdmin):
    list_display = ('user', 'card', 'grade', 'interval_before', 'reviewed_at')
    list_filter = ('grade',)
    search_fields = ('user__username', 'card__front')
    raw_id_fields = ('user', 'card')
    readonly_fields = ('user', 'card', 'grade', 'interval_before', 'reviewed_at')


@admin.register(DeckPlacement)
class DeckPlacementAdmin(admin.ModelAdmin):
    list_display = ('deck', 'content_type', 'object_id', 'order', 'added_by', 'added_at')
    list_filter = ('content_type',)
    search_fields = ('deck__name',)
    raw_id_fields = ('deck', 'added_by')
