"""Which SQLite file a log row belongs in.

The one rule worth remembering: **a user's shard is `user_id // LOG_SHARD_SIZE`, and it never
changes.** Integer division rather than modulo is the entire reason this is safe to grow — adding
capacity creates a new file and touches no existing row. A `% shard_count` scheme would move every
user to a different file the moment the count changed, which for an audit log means rewriting the
history you are keeping precisely because it must not be rewritten.

Capacity is therefore `LOG_SHARD_SIZE * LOG_SHARD_COUNT` users. Running out is not a corruption
risk — `shard_for_user` raises rather than silently folding user 9000 back into shard 0 — but it is
an outage for logging, so `check_log_capacity` exists to warn long before it happens.
"""

from django.conf import settings

LOG_APP_LABEL = 'telemetry'


def shard_for_user(user_id: int | None) -> str:
    """The database alias for one user's log rows, or the anonymous shard for `None`.

    Anonymous traffic has no user to shard on and is the bulk of a public site's requests, so it all
    lands in one file. That file will be much larger than the rest; splitting it by month is the
    natural next step and is recorded as such rather than pretended away.
    """
    if not user_id:
        return settings.LOG_ANON_SHARD
    index = int(user_id) // settings.LOG_SHARD_SIZE
    if index >= settings.LOG_SHARD_COUNT:
        raise ValueError(
            f'User {user_id} needs log shard {index}, but only {settings.LOG_SHARD_COUNT} are '
            f'configured (capacity {settings.LOG_SHARD_SIZE * settings.LOG_SHARD_COUNT} users). '
            f'Raise EDMAT_LOG_SHARD_COUNT and run `manage.py migrate_log_shards`. Do NOT change '
            f'EDMAT_LOG_SHARD_SIZE — that would re-point every existing user at a different file.'
        )
    return f'logs_{index}'


def all_log_shards() -> list[str]:
    """Every log database alias, anonymous shard last."""
    return [f'logs_{i}' for i in range(settings.LOG_SHARD_COUNT)] + [settings.LOG_ANON_SHARD]


def is_log_shard(alias: str) -> bool:
    return alias == settings.LOG_ANON_SHARD or alias.startswith('logs_')


class LogShardRouter:
    """Keeps telemetry models out of `default` and everything else out of the log shards.

    Writes are routed by the `instance` hint, which Django passes on save — so a caller only has to
    build the object with the right `user_id` and the routing follows. Reads deliberately return
    `None` (no opinion): there is no single shard that "reading a RequestLog" means, so a reader has
    to name one with `.using(...)`, or iterate `all_log_shards()`. Guessing on their behalf would
    quietly return one shard's worth of a question asked about all of them.
    """

    def db_for_write(self, model, **hints):
        if model._meta.app_label != LOG_APP_LABEL:
            return None
        instance = hints.get('instance')
        if instance is None:
            return None
        user_id = getattr(instance, 'user_id', None)
        if user_id is None:
            user_id = getattr(instance, 'actor_id', None)
        return shard_for_user(user_id)

    def db_for_read(self, model, **hints):
        if model._meta.app_label != LOG_APP_LABEL:
            return None
        instance = hints.get('instance')
        if instance is not None:
            user_id = getattr(instance, 'user_id', None) or getattr(instance, 'actor_id', None)
            return shard_for_user(user_id)
        return None

    def allow_relation(self, obj1, obj2, **hints):
        """Relations are allowed only within the same side of the split. Telemetry models carry no
        real ForeignKeys precisely because they cannot reach `auth_user` across files (see
        models.py), so this only ever has to stop a cross-side relation being introduced later."""
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if labels == {LOG_APP_LABEL}:
            return True
        if LOG_APP_LABEL in labels:
            return False
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Telemetry tables exist ONLY on log shards; every other app exists only on `default`.

        Without this, `migrate` would create the whole schema in every shard file and the log tables
        in the main database — which is exactly the coupling this split exists to prevent.
        """
        if app_label == LOG_APP_LABEL:
            return is_log_shard(db)
        if is_log_shard(db):
            return False
        return None
