"""Finding something inside one course.

A twelve-week course is chapters, sessions, referenced exercises and materials, uploaded files and
several conversations, and until now the only way to find any of it was to scroll. This answers
"where did we do Cauchy" across all of it at once.

## What it searches, and where each rule comes from

Nothing here invents a visibility rule. Every one already exists as a model method, and this walks
the same ones the course page itself renders through, so a hit can never be something the reader
could not have found by scrolling:

| Kind         | Fields                                   | Gate                                            |
|--------------|------------------------------------------|-------------------------------------------------|
| `course`     | `summary`, `description`                 | reaching the course at all (the viewset's queryset) |
| `chapter`    | `title`, `description`                   | none beyond the above — see the locked note below |
| `lesson`     | `title`, `description`, `participant_notes` | `Lesson.is_visible_to`; notes need `is_member` |
| `item`       | the label `CourseItemSerializer` renders, and the curator's `note` | `CourseItem.is_visible_to`, plus the published check |
| `attachment` | `title`                                  | `Attachment.is_visible_to`                       |
| `comment`    | `body`                                   | `Course.discussion_visible_to` + the thread's own target |

**A locked chapter can be a hit; its contents cannot.** That is not a leak, it is what the course
page already does: `ChapterSerializer` returns a locked chapter's title, description and unlock date
to everybody, because "there is a week 3 and it opens on the 14th" is information a participant
should have. What the lock hides is what is *inside*, and `Chapter.is_visible_to` is asked before any
lesson, item or thread under it is considered.

**The published check is applied here and also by `CourseItem.is_visible_to`.** It was written here
first, when that method genuinely did not make it — `LessonExerciseSet.visible_exercises` did, and
said in its own docstring that `CourseItem` "does not make this check and should" — so search honoured
it rather than reproducing a known gap in a new surface. `CourseItem` has since been fixed on the
course page where it belonged, so the call below is now redundant rather than stricter. It is kept
because it costs nothing and states the rule where a reader of this module will look for it; if the
two ever disagree, this one is the copy to delete.

**Removed and auto-hidden comments never match**, even though their rows still hold the words: their
bodies are blanked on the way out to every reader, so matching them would make search the one place
in the app where a deleted comment is still readable.

## Matching

`config.dbsearch` owns the one folding rule, so a term folds identically whether the row was filtered
in SQL (comments, where the count is unbounded) or in Python (everything else, where it is not and
where visibility depends on `role_of`/`is_member`/chapter locks that no WHERE clause can express —
and where an item's label only exists once a per-locale translation has been resolved). Both call
`fold()` on both sides, which is what keeps "found by the database" and "found in Python" the same
question.

Terms are ANDed and each is looked for across the whole record rather than within one field, so
"cauchy szereg" finds a lesson whose title says one and whose notes say the other.

Text is matched as stored, which for descriptions means Markdown with raw HTML passed through — so a
two-letter term could in principle match a tag name rather than prose. Left as is: filtering markup
out before matching would mean two different notions of "the text" (the database cannot strip tags),
and the two-character floor already rules out the worst of it. Snippets are stripped, because that is
display rather than matching.
"""

import re

from django.contrib.contenttypes.models import ContentType
from django.db.models import Q

from community.models import Comment
from config.dbsearch import contains_all, fold, search_terms

from .models import Attachment, Chapter, Course, Lesson

#: One letter matches nearly every row in the course and is never a real query — it is somebody
#: mid-word. Refused with a reason rather than scanned, so the UI can say why nothing came back
#: instead of showing an empty list that looks like "no results".
MIN_QUERY_LENGTH = 2

#: Per kind, not overall, so a course whose discussion runs to hundreds of comments cannot push its
#: chapters off the end of the response. `truncated` says when this bit.
PER_KIND_LIMIT = 50

#: Characters of context either side of the match in a snippet.
SNIPPET_RADIUS = 70

_TAG = re.compile(r'<[^>]+>')
_WHITESPACE = re.compile(r'\s+')


def _plain(text: str | None) -> str:
    """Text with its markup taken out, for display in a snippet.

    Tags become a space rather than nothing: `</p><p>` joining two sentences into one word is a worse
    read than `<b>Ca</b>uchy` splitting one. The consequence is that a term matched inside a word
    that markup interrupts may not be findable in this output, which `_snippet` handles by falling
    back to the beginning rather than by pretending.
    """
    return _WHITESPACE.sub(' ', _TAG.sub(' ', text or '')).strip()


def _snippet(text: str | None, terms: list[str]) -> str:
    plain = _plain(text)
    if not plain:
        return ''
    folded = fold(plain)
    found = [pos for pos in (folded.find(term) for term in terms) if pos >= 0]
    start = max(min(found) - SNIPPET_RADIUS, 0) if found else 0
    end = min(start + 2 * SNIPPET_RADIUS + 40, len(plain))
    body = plain[start:end]
    return f'{"…" if start else ""}{body}{"…" if end < len(plain) else ""}'


def _matched_field(fields: list[tuple[str, str | None]], terms: list[str]) -> str | None:
    """Which field to show, given the record as a whole already matched.

    The first one holding any term, in the order the caller listed them — which is the order they
    read on screen, so a title match is shown as a title match rather than as whichever field
    happened to be cheapest to look at.
    """
    for name, text in fields:
        if any(term in fold(text) for term in terms):
            return name
    return None


#: Fields whose text is already shown as the hit's own title. Matching one of these is common — it is
#: what searching for a chapter by name does — and echoing it back underneath is noise.
_TITLE_FIELDS = frozenset({'title', 'label'})


def _summarise(
    fields: list[tuple[str, str | None]], terms: list[str], *, context: str | None = None
) -> tuple[str, str]:
    """Which field matched, and the text to show under the hit.

    The matched field's OWN text, which is the bug the tests caught: the first version showed
    whichever field came first, so a course found by its description was summarised by its summary.

    One exception, and it is why `context` exists: when the match is in the field already rendered as
    the title, repeating it underneath says nothing. The record's body text (a description, a
    curator's note) is shown instead — or nothing at all, when there is none. A lesson called
    "Pochodna kierunkowa" with no description was printing its own title twice before this.
    """
    name = _matched_field(fields, terms) or fields[0][0]
    if name in _TITLE_FIELDS:
        source = context or ''
    else:
        source = dict(fields).get(name) or ''
    return name, _snippet(source, terms)


def _record_matches(fields: list[tuple[str, str | None]], terms: list[str]) -> bool:
    """Every term somewhere in this record — not every term in one field.

    The AND is across the record deliberately: "cauchy szereg" should find a session whose title
    names one and whose notes name the other, which is how somebody actually remembers where a thing
    was. Joining with a space is what stops a term matching across the seam between two fields — no
    term can contain whitespace, since the query was split on it.
    """
    return contains_all(' '.join(text for _, text in fields if text), terms)


def _where(chapter=None, lesson=None) -> dict:
    """The two location fields every result carries, so the frontend can link straight to the hit."""
    return {
        'chapter': {'id': chapter.pk, 'title': chapter.title} if chapter else None,
        'lesson': {'id': lesson.pk, 'title': lesson.title} if lesson else None,
    }


def _display_name(user) -> str:
    """Who wrote a comment, the way every other byline in this API resolves it."""
    if user is None:
        return ''
    profile = getattr(user, 'profile', None)
    return getattr(profile, 'display_name', '') or user.username


def search_course(course: Course, raw_query: str | None, user, *, label_context=None) -> dict:
    """Everything in `course` matching `raw_query`, as much of it as `user` may see.

    `label_context` is the serializer context an item's label is resolved through (it carries the
    request, and so the `?lang=` a material's title is picked by). Passed in rather than built here
    because the caller already has it.
    """
    query = (raw_query or '').strip()
    if len(query) < MIN_QUERY_LENGTH:
        return {
            'query': query,
            'terms': [],
            'results': [],
            'truncated': False,
            # A machine-readable reason, not a sentence: the UI writes the words, in both locales.
            'reason': 'query_too_short',
            'min_length': MIN_QUERY_LENGTH,
        }

    terms = search_terms(query)
    results: list[dict] = []
    truncated = False
    counts: dict[str, int] = {}

    def add(kind: str, payload: dict) -> None:
        nonlocal truncated
        seen = counts.get(kind, 0)
        if seen >= PER_KIND_LIMIT:
            truncated = True
            return
        counts[kind] = seen + 1
        results.append({'kind': kind, **payload})

    # Asked once each. `can_curate` walks `CourseStaff` through `role_of`, and `is_member` walks the
    # roster on top of that; asking per row would be the N+1 the moderation queue was once measured
    # making.
    can_curate = course.can_curate(user)
    is_member = course.is_member(user)

    # --- the course itself ------------------------------------------------------------------------
    # Its title is deliberately not searched: you are already looking at it, so a hit would say
    # nothing and would match first for every query about the course's own subject.
    course_fields = [('summary', course.summary), ('description', course.description)]
    if _record_matches(course_fields, terms):
        field, snippet = _summarise(course_fields, terms)
        add(
            'course',
            {
                'id': course.pk,
                'title': course.title,
                'field': field,
                'snippet': snippet,
                **_where(),
            },
        )

    # --- chapters, and what is inside the ones that have opened -----------------------------------
    chapters = list(course.chapters.all())
    visible_chapters = []
    visible_lessons: list[Lesson] = []
    for chapter in chapters:
        chapter_fields = [('title', chapter.title), ('description', chapter.description)]
        if _record_matches(chapter_fields, terms):
            field, snippet = _summarise(chapter_fields, terms, context=chapter.description)
            add(
                'chapter',
                {
                    'id': chapter.pk,
                    'title': chapter.title,
                    'field': field,
                    'snippet': snippet,
                    'is_unlocked': chapter.is_unlocked(),
                    **_where(chapter=chapter),
                },
            )
        if not chapter.is_visible_to(user):
            continue
        visible_chapters.append(chapter)
        for lesson in chapter.lessons.all():
            visible_lessons.append(lesson)
            lesson_fields = [('title', lesson.title), ('description', lesson.description)]
            # Notes are the part worth joining a course for, and `LessonSerializer` blanks them for
            # anybody who is not in it. A search that matched them for a stranger would hand back in
            # a snippet exactly what that blanking withholds.
            if is_member:
                lesson_fields.append(('participant_notes', lesson.participant_notes))
            if not _record_matches(lesson_fields, terms):
                continue
            field, snippet = _summarise(lesson_fields, terms, context=lesson.description)
            add(
                'lesson',
                {
                    'id': lesson.pk,
                    'title': lesson.title,
                    'field': field,
                    'snippet': snippet,
                    **_where(chapter=chapter, lesson=lesson),
                },
            )

    # --- referenced exercises, materials, attachments and events ----------------------------------
    # The label comes from `CourseItemSerializer.get_label` itself rather than a second copy of the
    # same rules: a material's title lives on its translations and has to be resolved for the
    # requested locale, and an exercise's name is composed by `Exercise.__str__`. One serializer
    # instance, one method call per row — DRF reuses a single child serializer under `many=True`
    # anyway, so this is the same shape the read path already runs.
    from .serializers import CourseItemSerializer

    labeller = CourseItemSerializer(context=label_context or {})
    for item in course.items.all():
        if not item.is_visible_to(user):
            continue
        if not _item_target_published(item, can_curate=can_curate):
            continue
        label = labeller.get_label(item)
        item_fields = [('label', label), ('note', item.note)]
        if not _record_matches(item_fields, terms):
            continue
        chapter = item.parent_chapter
        field, snippet = _summarise(item_fields, terms, context=item.note)
        add(
            'item',
            {
                'id': item.pk,
                'title': label,
                'field': field,
                'snippet': snippet,
                'item_kind': item.kind,
                # The referenced row's own id, so a result can link to the exercise/material/event
                # rather than only back to the course it is filed in.
                'target_id': (
                    item.exercise_id or item.material_id or item.attachment_id or item.event_id
                ),
                'status': item.status,
                **_where(chapter=chapter, lesson=item.lesson),
            },
        )

    # --- files uploaded to the course --------------------------------------------------------------
    attachments = [a for a in course.attachments.all() if a.is_visible_to(user)]
    for attachment in attachments:
        # Title only — the agreed scope for this kind. The description is shown as context under the
        # hit but is not matched against, so a term appearing only there does not surface the file.
        attachment_fields = [('title', attachment.title)]
        if not _record_matches(attachment_fields, terms):
            continue
        _, snippet = _summarise(attachment_fields, terms, context=attachment.description)
        add(
            'attachment',
            {
                'id': attachment.pk,
                'title': attachment.title,
                'field': 'title',
                'snippet': snippet,
                **_where(),
            },
        )

    # --- the conversations -------------------------------------------------------------------------
    # Gated by the course's own `discussion_mode` exactly as every thread endpoint is, and then by
    # each thread's target: a locked week's discussion is part of its contents, so the chapter and
    # lesson lists above are already filtered by the lock before they get here.
    if course.discussion_visible_to(user):
        comment_hits, comments_truncated = _comment_hits(
            course, terms, visible_chapters, visible_lessons, attachments
        )
        truncated = truncated or comments_truncated
        for hit in comment_hits:
            add('comment', hit)

    return {
        'query': query,
        # Handed back so the UI can highlight what it actually matched on rather than re-splitting
        # the string and guessing at the same rules.
        'terms': terms,
        'results': results,
        'truncated': truncated,
        'reason': None,
        'min_length': MIN_QUERY_LENGTH,
    }


def _item_target_published(item, *, can_curate: bool) -> bool:
    """Whether the thing this item points at is still live, for somebody who cannot curate.

    Now also enforced by `CourseItem.is_visible_to`, which the caller asks first — see the module
    docstring for why this stayed.

    Attachments and events have no `published` flag of their own — an attachment is gated by
    membership and an event carries its own status and its own page — so only the two corpus kinds
    are asked.
    """
    if can_curate:
        return True
    if item.exercise_id and not item.exercise.published:
        return False
    if item.material_id and not item.material.published:
        return False
    return True


def _comment_hits(course, terms, chapters, lessons, attachments) -> tuple[list[dict], bool]:
    """Matching comments across every thread this course holds, in one query.

    One query rather than four, and in SQL rather than in Python, because this is the only kind whose
    size is not bounded by the course's own structure — a busy course's thread is the reason the
    `ucontains` lookup had to exist at all.
    """
    scopes = [
        ('course', ContentType.objects.get_for_model(Course), {course.pk: course}),
        ('chapter', ContentType.objects.get_for_model(Chapter), {c.pk: c for c in chapters}),
        ('lesson', ContentType.objects.get_for_model(Lesson), {row.pk: row for row in lessons}),
        (
            'attachment',
            ContentType.objects.get_for_model(Attachment),
            {a.pk: a for a in attachments},
        ),
    ]

    # Two filters, kept separate so the OR over threads and the AND over terms cannot be mistaken
    # for one another: any of these threads, AND every one of the terms.
    target_filter = Q()
    for _, content_type, rows in scopes:
        if rows:
            target_filter |= Q(content_type=content_type, object_id__in=list(rows))
    if not target_filter:
        return [], False

    term_filter = Q()
    for term in terms:
        term_filter &= Q(body__ucontains=term)

    rows = list(
        Comment.objects.filter(target_filter, term_filter)
        # A tombstone's body is blanked for every reader (`CommentSerializer`), so matching one would
        # make search the only place a removed comment is still legible. Same for one the reporting
        # system has auto-hidden.
        .filter(is_removed=False, auto_hidden_at__isnull=True)
        .select_related('author', 'author__profile', 'content_type')
        .order_by('-created_at')[: PER_KIND_LIMIT + 1]
    )
    truncated = len(rows) > PER_KIND_LIMIT
    rows = rows[:PER_KIND_LIMIT]

    by_type = {content_type.pk: (kind, targets) for kind, content_type, targets in scopes}
    hits = []
    for comment in rows:
        kind, targets = by_type[comment.content_type_id]
        target = targets.get(comment.object_id)
        if target is None:
            # Only reachable if a thread's target stopped being visible between the two queries.
            continue
        if kind == 'lesson':
            where = _where(chapter=target.chapter, lesson=target)
        elif kind == 'chapter':
            where = _where(chapter=target)
        else:
            where = _where()
        hits.append(
            {
                'id': comment.pk,
                # A comment has no title of its own, and "who said it" is what a reader scans for.
                'title': _display_name(comment.author),
                'field': 'body',
                'snippet': _snippet(comment.body, terms),
                'thread': {
                    'kind': kind,
                    'id': target.pk,
                    'title': course.title if kind == 'course' else target.title,
                },
                'created_at': comment.created_at,
                **where,
            }
        )
    return hits, truncated
