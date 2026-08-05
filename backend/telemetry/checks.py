"""A deploy-time check that the log shards were actually migrated.

This exists because of a specific, silent failure mode that is otherwise very easy to ship.

`LogShardRouter.allow_migrate` deliberately confines telemetry tables to the log shard databases
and keeps every other app out of them. The consequence is that a plain `manage.py migrate` — which
only ever touches the `default` alias — creates **none** of the telemetry tables. Creating them is
what `manage.py migrate_log_shards` is for, and that is a genuinely separate command a deploy has
to remember to run.

If it is forgotten, nothing announces it. `RequestLogMiddleware` swallows every logging failure by
design (a full disk or a locked shard must degrade logging, not take the site down), so a
deployment with unmigrated shards serves every page perfectly while writing precisely zero audit
log rows. The absence of a log is not visible the way a broken page is — you find out when you go
looking for evidence that was never recorded, which is exactly the moment it cannot be recovered.

So this converts that silence into a loud, deploy-time error. `manage.py check --deploy` is already
part of the deployment sequence, so the check runs where it will actually be seen, before traffic
arrives rather than months later.

Registered in `TelemetryConfig.ready()` with `deploy=True`, which is load-bearing rather than
decorative: Django runs a `deploy=True` check ONLY when `--deploy` is passed, so `manage.py check
--deploy` (already a step in the deployment sequence, and the place a deployer is actually reading
output) reports it, while an ordinary `manage.py check` and every test run skip it entirely. That
last part matters — the test runner creates fresh, empty per-shard test databases, so a check that
ran unconditionally would fail the whole suite for a condition that is correct in that context.

The `database` tag was tried first and is wrong here: contrary to what the tag name suggests,
Django runs database-tagged checks on a plain `manage.py check` too (verified directly — it
reported all 9 shards), which would have broken exactly the two cases above.
"""

from django.core.checks import Error, register
from django.db import connections
from django.db.utils import OperationalError

from .routers import all_log_shards


@register(deploy=True)
def check_log_shards_migrated(app_configs, **kwargs):
    """Every configured log shard must actually have the telemetry tables in it."""
    errors = []
    expected_table = 'telemetry_requestlog'

    for shard in all_log_shards():
        connection = connections[shard]
        try:
            with connection.cursor() as cursor:
                names = connection.introspection.table_names(cursor)
        except OperationalError as exc:
            # An unreachable/unwritable shard file is its own real problem — most likely the
            # directory is not writable by the user Apache runs as, which would also make every
            # future log write fail the same silent way.
            errors.append(
                Error(
                    f'Log shard {shard!r} could not be opened: {exc}',
                    hint=(
                        f'Check that {connection.settings_dict["NAME"]} and its parent directory '
                        'exist and are writable by the user the application runs as. SQLite needs '
                        'write access to the DIRECTORY too, not just the file, for its journal.'
                    ),
                    id='telemetry.E002',
                )
            )
            continue

        if expected_table not in names:
            errors.append(
                Error(
                    f'Log shard {shard!r} has no {expected_table} table — it was never migrated.',
                    hint=(
                        'Run `manage.py migrate_log_shards`. A plain `manage.py migrate` does NOT '
                        'create these tables: LogShardRouter.allow_migrate confines telemetry to '
                        'the shard databases, and `migrate` only touches `default`. Until this is '
                        'run, every request log write fails silently (RequestLogMiddleware '
                        'swallows the error by design) and no audit trail is recorded at all.'
                    ),
                    id='telemetry.E001',
                )
            )

    return errors
