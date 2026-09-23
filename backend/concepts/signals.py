"""The forgetting half of the feed for this app — one receiver, and the reason it is here.

An article that stops being public takes its feed rows with it. Two ways that happens:

* a moderator's **report decision** or an **auto-hide**, which set `is_removed` / `auto_hidden_at`
  through `moderation.services` and reach the feed through `remove_activity_for` there already
  (`resolve_report_decision` calls it for every reported kind) — plus this receiver, because the
  concept's OWN row, recorded on the first publication anywhere under it, hangs off the article as
  its `source` and has to go when the article was the only visible one;
* a **hard delete**, which a generic `source` reference has no FK to cascade from.

The `post_delete` registration for `ConceptArticle` is deliberately here rather than added to
`activity/signals.py`'s list, and that IS a deviation from that file's own "this list is the
convention" note — worth it because `activity` would otherwise have to import `concepts`, which
imports `moderation`, which imports `activity`. `MaterialVersion` could be listed there because
`coauthoring` sits on the other side of that cycle; this one cannot.
"""

from django.db.models.signals import post_delete
from django.dispatch import receiver

from activity.services import remove_activity_for

from .models import ConceptArticle, ConceptRevision


@receiver(post_delete, sender=ConceptArticle)
@receiver(post_delete, sender=ConceptRevision)
def source_deleted(sender, instance, **kwargs):
    remove_activity_for(instance)
