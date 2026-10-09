from django.apps import AppConfig


class IdentityConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'identity'

    def ready(self):
        """Register the activity and placement providers other apps own
        (`prompts/10-integration.md` §3; CONTESTS-BRIEF.md §3.B for the placements).

        A provider lives in the app that owns the rows it counts and never imports `identity`
        (`prompts/README.md` §5 rule 13); this is the one place that wires them together, so the
        registry's membership can be read off a single screen. `record.py`'s own `sets_by_branch`
        registers itself at the bottom of that module, because `study` has no record module to
        hand it from.

        `courses.record.activity_by_branch` is the **only** `lessons_done` provider. The
        read-across into `courses.models` that `identity/record.py` carried — written by step B of
        the learning cycle before it could see step C's — was deleted on 2026-10-06 (owner
        decision, `prompts/11-closing-design.md` §2). `_activity_block` SUMS across providers, so
        the two of them together doubled every `lessons_done` number on every profile: a wrong
        count that looks exactly like real data. `identity/tests.py` pins the survivor by counting
        how many registered providers answer the key, which is the shape of that failure rather
        than the name of the function that caused it.

        `ready()` can run more than once in one process (the autoreloader, a test that reloads the
        app registry), which is why `register_activity_provider` is idempotent and why registering
        here is safe rather than another way to double a count.
        """
        from contests.record import placements_for as contest_placements
        from courses.record import activity_by_branch as courses_activity
        from flashcards.record import activity_by_branch as flashcards_activity

        from .record import register_activity_provider, register_placement_provider

        register_activity_provider(courses_activity)
        register_activity_provider(flashcards_activity)
        # The third block (CONTESTS-BRIEF.md §3.B): what this person was awarded in a contest
        # somebody else ran. A PLACEMENT provider and not an activity one — see `record.py`'s own
        # "Why it is a third block and not a third column". Step A writes the body (it owns the
        # result rows); on its own branch it answers `[]`, so the block is simply empty.
        register_placement_provider(contest_placements)
