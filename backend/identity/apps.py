from django.apps import AppConfig


class IdentityConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'identity'

    def ready(self):
        """Register the activity providers other apps own (`prompts/10-integration.md` §3).

        `record.py`'s own two (`sets_by_branch`, `lessons_done_by_branch`) register themselves at
        the bottom of that module. What belongs here is the hook an app wrote for this registry
        without importing it — `flashcards.record.activity_by_branch`
        (`prompts/README.md` §5 rule 13: the hook lives in the app that owns the rows, and the
        integrator wires it).

        **`courses.record.activity_by_branch` is deliberately NOT registered.** It and
        `identity.record.lessons_done_by_branch` are two implementations of the same
        `lessons_done` metric, written on two branches that could not see each other — step B's
        read-only version over `courses`, and step C's in the app that owns `LessonProgress`.
        `_activity_block` SUMS across providers, so registering both would double every
        `lessons_done` number on every profile: a wrong count that looks exactly like real data,
        which is the failure `register_activity_provider`'s own idempotency guard exists to avoid.
        One of the two should go; that is a deletion with a migration-free but visible effect, so
        it is on the board rather than done quietly here.
        """
        from flashcards.record import activity_by_branch as flashcards_activity

        from .record import register_activity_provider

        register_activity_provider(flashcards_activity)
