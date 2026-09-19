"""A minor's comment is held for a moderator before anybody else sees it (AUDIENCE-BRIEF.md
§2) — one hook on the model rather than a check in each of the many comment endpoints."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from accounts.minors import hold_for_review, is_minor

from .models import Comment


@receiver(post_save, sender=Comment)
def hold_minor_comment(sender, instance, created, **kwargs):
    if not created:
        return
    if is_minor(instance.author):
        hold_for_review(instance, instance.author)
        return
    # Any picture in the body gets, on a minor-band thread, the same pre-publication review an
    # attached picture gets (views.py's `attachments`) — rather than slipping past that rule by
    # arriving inside the body instead of beside it.
    #
    # This used to look for `data-chem=` alone, when a chemistry drawing was the only thing that
    # could be embedded. Pictures now go in the body too (community/inline_images.py) and the
    # attachment row is PDFs only, so the narrow check would have quietly become the hole it was
    # written to close: every ordinary picture on a minor's thread would have gone straight to
    # publication. `<img` covers the drawing, the uploaded picture and anything typed by hand.
    if '<img' in (instance.body or ''):
        from config.audience import MINOR_AUDIENCES

        if getattr(instance.target, 'audience', None) in MINOR_AUDIENCES:
            hold_for_review(instance, instance.author)
