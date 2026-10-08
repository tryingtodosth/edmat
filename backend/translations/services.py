"""Writing a row's text in every language at once.

**One transaction, one timestamp.** That is the whole reason this is a service and not four
`update_or_create` calls at a call site: the owner's instruction is that writing a change and
translating it should be ONE submission, *"so that if a user translates and edit/update/new
content, there's no sth like “newer in PL by 4 minutes”"*. Every language written together gets
the identical `updated_at`, so `resolve` finds nothing newer anywhere and says nothing.

It also mirrors the original language onto the row's own `title`/`description` (or `question`, or
`text`) — see `models.py`'s "Why the model's own column survives".
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import TextVersion
from .targets import content_type_for, fields_of, kind_of, write_own_text


class TranslationWriteError(ValueError):
    """Carries the word a refusal gives back, so the view answers 400 with a reason rather than a
    stack trace (house rule 6)."""


#: A heading is what a row IS; a body is optional everywhere and absent entirely on a poll option.
MISSING_ORIGINAL = 'original_locale_not_in_versions'
EMPTY_ORIGINAL = 'original_heading_empty'
EMPTY_ORIGINAL_BODY = 'original_body_empty'
NO_VERSIONS = 'no_versions'


@transaction.atomic
def write_versions(obj, *, original_locale: str, versions: dict, user=None,
                   keep_edited: bool = False) -> list[TextVersion]:
    """`versions` is `{'pl': {'heading': …, 'body': …}, 'en': {…}}`.

    - `original_locale` must be one of its keys, and its heading must not be empty: a row has to
      say what it is in at least the language it was written in.
    - A language whose heading AND body are both blank is **deleted** — that is how a translation
      is taken back down, and it is why the editor can simply send both of its columns every time.
    - A language the payload does not mention at all is **left alone**. Omission is not deletion;
      a client that only knows about two languages must not silently drop a third somebody added.

    **`keep_edited=True` refuses to overwrite a language a PERSON wrote.** `written_by` is null for
    a row this project's own seed wrote and set for one a human saved through the editor, so the two
    are told apart by the data rather than by a flag somebody has to remember.

    It exists because of a real hazard the owner named on 2026-10-08: `seed_edmat_project` is
    idempotent and refreshes text on every run, and the deployment runbook was about to say "re-run
    it after every bundle". With the bilingual editor now shipping, the owner edits the EdMat
    organisation's description on production — and the next deploy would have silently thrown those
    edits away. With this on, the seed fills in what nobody has touched and never clobbers a
    person's words; a human's edit wins permanently, and the way to get the seeded text back is to
    delete the row.
    """
    kind = kind_of(obj)
    if not kind:
        raise TranslationWriteError(NO_VERSIONS)
    if not versions:
        raise TranslationWriteError(NO_VERSIONS)
    if original_locale not in versions:
        raise TranslationWriteError(MISSING_ORIGINAL)
    heading_field, _body_field = fields_of(obj)
    if heading_field:
        if not (versions[original_locale].get('heading') or '').strip():
            raise TranslationWriteError(EMPTY_ORIGINAL)
    # An organisation has no heading to be empty — its name is the same in every language — so the
    # same rule ("say SOMETHING in the language you wrote it in") falls on the body instead.
    elif not (versions[original_locale].get('body') or '').strip():
        raise TranslationWriteError(EMPTY_ORIGINAL_BODY)

    content_type = content_type_for(kind)
    now = timezone.now()
    written: list[TextVersion] = []

    # Worked out BEFORE the loop so that a preserved original still counts as present for the
    # mirror below, and so the `is_original` cleanup does not move a row we are not allowed to touch.
    protected: set[str] = set()
    if keep_edited:
        protected = set(
            TextVersion.objects.filter(
                content_type=content_type, object_id=obj.pk, written_by__isnull=False
            ).values_list('locale', flat=True)
        )

    # BEFORE anything is written, never after: `one_original_text_version` is a partial unique
    # INDEX, enforced immediately rather than at commit, so a previous original in a different
    # language has to stop being one first or saving the new one fails inside the transaction.
    # (`.update()` fires no signal, which is fine — nothing listens for this.)
    TextVersion.objects.filter(
        content_type=content_type, object_id=obj.pk, is_original=True
    ).exclude(locale=original_locale).exclude(locale__in=protected).update(is_original=False)

    original_version = None
    for locale, text in versions.items():
        if locale in protected:
            # Somebody wrote this language by hand. Left exactly as it is — not updated, not
            # deleted, not even re-stamped, so its `updated_at` keeps saying when the PERSON wrote
            # it and the staleness reading stays honest.
            continue
        heading = (text.get('heading') or '').strip()
        body = (text.get('body') or '').strip()
        if locale != original_locale and not heading and not body:
            TextVersion.objects.filter(
                content_type=content_type, object_id=obj.pk, locale=locale
            ).delete()
            continue
        version, _created = TextVersion.objects.update_or_create(
            content_type=content_type,
            object_id=obj.pk,
            locale=locale,
            defaults={
                'is_original': locale == original_locale,
                'heading': heading,
                'body': body,
                'written_by': user if (user and user.is_authenticated) else None,
                'updated_at': now,
            },
        )
        written.append(version)
        if locale == original_locale:
            original_version = version

    # Mirrored from the SAVED row and not from the incoming dict, so the column and the version
    # always carry the identical text: `TextVersion.save()` sanitizes the BODY (house rule 8), and
    # copying the raw payload here instead would leave the model's own column holding the one
    # unsanitized copy on the platform — on a model like `Task`, which sanitizes in its serializer
    # rather than in `save()`, that is a real gap and not a theoretical one. The heading is not
    # sanitized at all (see `TextVersion.save`), so for that half the two are trivially equal.
    # A protected original was skipped by the loop above, so `original_version` is None for it —
    # but the column must still end up equal to whatever the ORIGINAL version says, or the two
    # halves of the same text drift apart. So it is read back and mirrored from the PERSON's row.
    # Writing the seed's payload here instead is precisely the overwrite `keep_edited` exists to
    # prevent; writing nothing at all would leave a column that an earlier run had already
    # clobbered stale for ever, with no way back short of SQL.
    if original_version is None and original_locale in protected:
        original_version = TextVersion.objects.filter(
            content_type=content_type, object_id=obj.pk, locale=original_locale
        ).first()
    if original_version is not None:
        changed = write_own_text(obj, original_version.heading, original_version.body)
        if changed:
            obj.save(update_fields=changed)

    return written
