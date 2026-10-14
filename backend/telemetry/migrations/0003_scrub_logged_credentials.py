"""Scrubs API tokens that `RequestLog` wrote down before `CREDENTIAL_QUERY_PARAMS` existed.

Runs once per log shard — every `migrate --database=logs_N telemetry` applies it to that shard's own
rows (`schema_editor.connection.alias`), which is exactly how shards are migrated on deploy. Only
`query_string` is touched, through the same `redact_query_string` the middleware now uses, so a
scrubbed row reads as if it had been redacted on write. The reverse is a no-op: the token is gone.
"""

from django.db import migrations


def scrub(apps, schema_editor):
    from telemetry.middleware import redact_query_string

    RequestLog = apps.get_model('telemetry', 'RequestLog')
    alias = schema_editor.connection.alias
    rows = RequestLog.objects.using(alias).filter(query_string__icontains='token=')
    for row in rows.only('id', 'path', 'query_string').iterator():
        cleaned = redact_query_string(row.path, row.query_string)
        if cleaned != row.query_string:
            RequestLog.objects.using(alias).filter(pk=row.pk).update(query_string=cleaned)


class Migration(migrations.Migration):
    dependencies = [('telemetry', '0002_requestlog_analytics_opt_out')]

    operations = [migrations.RunPython(scrub, migrations.RunPython.noop)]
