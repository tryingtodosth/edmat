"""The admin for a goal and its definition of done.

`status` is **read-only here on purpose.** It is derived from the criteria by
`goals.rules.recount` and nothing else writes it (root CLAUDE.md, shape 4: where a terminal state is
a fact about other rows, it is derived, and the API answers 400 with the reason if you ask for it by
hand). An admin form that offered the field would be the one surface in the project that can make
`met` mean nothing — so it offers `met_by` and `met_at` read-only beside it, which is the evidence,
not the decision.
"""

from django.contrib import admin

from .models import Goal, GoalCriterion


class GoalCriterionInline(admin.TabularInline):
    """The criteria ARE the goal's definition of done, so they are edited on the goal rather than
    hunted for in a list of their own."""

    model = GoalCriterion
    extra = 0
    fields = ('order', 'text', 'met_at', 'met_by')
    raw_id_fields = ('met_by',)
    ordering = ('order',)


@admin.register(Goal)
class GoalAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'content_type', 'object_id', 'order', 'created_by', 'met_at')
    list_filter = ('status', 'content_type')
    search_fields = ('title', 'description')
    raw_id_fields = ('created_by', 'met_by')
    readonly_fields = ('status', 'met_by', 'met_at', 'created_at', 'updated_at')
    inlines = [GoalCriterionInline]


@admin.register(GoalCriterion)
class GoalCriterionAdmin(admin.ModelAdmin):
    list_display = ('text', 'goal', 'order', 'met_at', 'met_by')
    list_filter = ('goal__status',)
    search_fields = ('text', 'goal__title')
    raw_id_fields = ('goal', 'met_by')
