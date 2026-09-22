"""The wire shapes. Every key here is read by `frontend/src/lib/api/mappers.ts`.

That file is the other half of this one and neither can be derived from the other — the same
hand-written-pair discipline `community/targets.py` records for comment target names. A key renamed
on one side and not the other is a field that silently becomes `undefined`, which is why the
mappers' own `Raw*` interfaces spell out every name this module emits.

Three read shapes for a version rather than one, because three surfaces want genuinely different
amounts of it: a history row needs enough to draw a line and a download link (`summary`), a version
page needs the payload and the caller's own permissions (`full`), and the moderation queue needs the
CATALOGUE as well, because for a first publication there is no `Material` to read it from yet — the
reviewer is deciding whether one exists.

**Uniqueness validators:** DRF derives them from `unique_together` but NOT from `Meta.constraints`
(backend/CLAUDE.md), and every constraint in this app is a `constraints` entry. Nothing here relies
on DRF to refuse a duplicate; the services module claims every row with a WHERE-anchored update and
answers 409, which is the only thing that is correct under concurrency anyway.
"""

from __future__ import annotations

import json
import re

from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.audience import AUDIENCE_VALUES
from materials.services import clean_requirement_labels, find_duplicate_requirement_label
from taxonomy.models import Branch

from .access import (
    can_decide,
    can_edit,
    can_manage,
    join_block_reason,
    propose_block_reason,
    publish_block_reason,
    role_of,
    switch_allows,
)
from .models import (
    MaterialProject,
    MaterialVersion,
    ProjectInvite,
    ProjectJoinRequest,
    ProjectMember,
)

#: How much of a written body the moderation queue shows. A queue row is a row; the reviewer opens
#: the version itself to read the whole thing.
BODY_EXCERPT_CHARS = 200

_TAG_RE = re.compile(r'<[^>]+>')


def _display_name(user) -> str:
    if user is None:
        return ''
    return getattr(getattr(user, 'profile', None), 'display_name', '') or user.username


def _file_url(obj, context) -> str:
    """Absolute when there is a request to build against, relative otherwise — the same thing DRF's
    own `FileField` does, spelled out because these are `SerializerMethodField`s (the summary and
    the queue row both need the URL without the rest of a file field's write behaviour)."""
    stored = getattr(obj, 'file', None)
    if not stored:
        return ''
    try:
        url = stored.url
    except ValueError:  # pragma: no cover - a storage backend with no URL
        return ''
    request = context.get('request')
    return request.build_absolute_uri(url) if request is not None else url


def _file_name(obj) -> str:
    """The stored basename. Deliberately not the uploader's own filename, which this app never
    keeps — `version_upload_path` discards it as untrusted input (house rule 7), so there is no
    friendlier name to give and inventing one would be worse than the honest random one."""
    stored = getattr(obj, 'file', None)
    if not stored or not stored.name:
        return ''
    return stored.name.rsplit('/', 1)[-1]


# --- members ----------------------------------------------------------------------------------------


class ProjectMemberSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source='user.pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectMember
        fields = ['user_id', 'display_name', 'role', 'added_at']

    def get_display_name(self, obj):
        return _display_name(obj.user)


# --- versions ---------------------------------------------------------------------------------------


class MaterialVersionSummarySerializer(serializers.ModelSerializer):
    """The short form, as it rides on a project and in a history list."""

    created_by_id = serializers.IntegerField(read_only=True)
    created_by_display_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()

    class Meta:
        model = MaterialVersion
        fields = [
            'id',
            'number',
            'status',
            'kind',
            'title',
            'change_note',
            'created_by_id',
            'created_by_display_name',
            'created_at',
            'published_at',
            'file_url',
            'file_name',
            'url',
            'scan_status',
        ]

    def get_created_by_display_name(self, obj):
        return _display_name(obj.created_by)

    def get_file_url(self, obj):
        return _file_url(obj, self.context)

    def get_file_name(self, obj):
        return _file_name(obj)


class MaterialVersionSerializer(MaterialVersionSummarySerializer):
    """One version in full, plus the three answers about the CALLER that the frontend must never
    re-derive: the deciding circle differs per state (member / staff / material governor / branch
    governor / proposer), and a client that guessed it would draw buttons that 403."""

    project_id = serializers.IntegerField(read_only=True)
    material_id = serializers.SerializerMethodField()
    based_on_id = serializers.IntegerField(read_only=True)
    decided_by_id = serializers.IntegerField(read_only=True)
    decided_by_display_name = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    can_publish = serializers.SerializerMethodField()
    can_decide = serializers.SerializerMethodField()
    can_withdraw = serializers.SerializerMethodField()

    class Meta(MaterialVersionSummarySerializer.Meta):
        fields = MaterialVersionSummarySerializer.Meta.fields + [
            'project_id',
            'material_id',
            'body',
            'description',
            'based_on_id',
            'decided_by_id',
            'decided_by_display_name',
            'decided_at',
            'decision_note',
            'scan_detail',
            'file_size',
            # Surfaced rather than kept internal, the same reasoning the retired
            # `MaterialSubmissionSerializer` gave for the pair it exposed: the reject response goes
            # straight back to the person who decided, and a `file_url` that has quietly become
            # empty with nothing to explain it reads as a bug rather than as the intended outcome.
            # With `file_size` beside it, the row still says a file was there and how big it was.
            'file_reclaimed_at',
            'comment_count',
            'can_publish',
            'can_decide',
            'can_withdraw',
        ]

    def get_material_id(self, obj):
        return obj.project.material_id

    def get_decided_by_display_name(self, obj):
        return _display_name(obj.decided_by)

    def get_comment_count(self, obj):
        from community.models import Comment

        content_type = ContentType.objects.get_for_model(MaterialVersion)
        return Comment.objects.filter(
            content_type=content_type, object_id=obj.pk, is_removed=False
        ).count()

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_can_publish(self, obj):
        # The same three things the publish action enforces, read from the same functions and in the
        # same order, so the button is never drawn for a publish the server would refuse — as stale,
        # as somebody else's, or because the switch that governs THIS project's publications
        # (`material_submissions` before the first one, `coauthoring` after) is off.
        if publish_block_reason(obj) is not None:
            return False
        user = self._user()
        return can_edit(obj.project, user) and switch_allows(obj.project, user)

    def get_can_decide(self, obj):
        user = self._user()
        return (
            obj.status == 'proposed'
            and can_decide(obj, user)
            and switch_allows(obj.project, user)
        )

    def get_can_withdraw(self, obj):
        user = self._user()
        if obj.status != 'proposed' or not getattr(user, 'is_authenticated', False):
            return False
        return obj.created_by_id == user.pk


class MaterialVersionQueueRowSerializer(MaterialVersionSummarySerializer):
    """One row of the moderation queue's `material_versions` section.

    Carries the project's catalogue because a first publication has no `Material` behind it yet —
    the reviewer is weighing type, audience, provenance and claimed coverage together with the file,
    exactly as they did for a `MaterialSubmission` before that model was folded in here, and the
    queue's Materials tab renders the same fields it always did.
    """

    project_id = serializers.IntegerField(read_only=True)
    description = serializers.CharField(read_only=True)
    body_excerpt = serializers.SerializerMethodField()
    branch_id = serializers.SerializerMethodField()
    branch_name = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    author = serializers.SerializerMethodField()
    source_url = serializers.SerializerMethodField()
    requirements = serializers.SerializerMethodField()
    coverage = serializers.SerializerMethodField()
    price_amount = serializers.SerializerMethodField()
    price_currency = serializers.SerializerMethodField()
    estimated_minutes = serializers.SerializerMethodField()
    audience = serializers.SerializerMethodField()
    is_first_publication = serializers.SerializerMethodField()

    class Meta(MaterialVersionSummarySerializer.Meta):
        fields = MaterialVersionSummarySerializer.Meta.fields + [
            'project_id',
            'description',
            'body_excerpt',
            'scan_detail',
            'branch_id',
            'branch_name',
            'type',
            'author',
            'source_url',
            'requirements',
            'coverage',
            'price_amount',
            'price_currency',
            'estimated_minutes',
            'audience',
            'is_first_publication',
        ]

    # A first publication reads its catalogue off the project (there is no material yet); a proposal
    # on an orphan material reads it off the material, which is the row that actually answers those
    # questions once one exists (the project's copies are frozen — see `MaterialProject`).
    def _catalogue_source(self, obj):
        material = obj.project.material
        return material if material is not None else obj.project

    def get_body_excerpt(self, obj):
        if obj.kind != 'body' or not obj.body:
            return ''
        return _TAG_RE.sub('', obj.body)[:BODY_EXCERPT_CHARS]

    def get_branch_id(self, obj):
        return obj.project.branch.slug

    def get_branch_name(self, obj):
        from config.i18n_utils import request_locale, resolve_translation

        translation = resolve_translation(
            obj.project.branch.translations, request_locale(self.context)
        )
        return translation.name if translation else obj.project.branch.slug

    def get_type(self, obj):
        return self._catalogue_source(obj).type

    def get_author(self, obj):
        return self._catalogue_source(obj).author

    def get_source_url(self, obj):
        return self._catalogue_source(obj).source_url

    def get_requirements(self, obj):
        material = obj.project.material
        if material is not None:
            return [r.label for r in material.requirements.all() if not r.is_removed]
        return list(obj.project.requirements or [])

    def get_coverage(self, obj):
        material = obj.project.material
        if material is not None:
            return [
                {'topic_id': row.topic_id, 'level': row.level, 'kind': row.kind}
                for row in material.coverage.all()
            ]
        return list(obj.project.coverage or [])

    def get_price_amount(self, obj):
        value = self._catalogue_source(obj).price_amount
        return str(value) if value is not None else None

    def get_price_currency(self, obj):
        return self._catalogue_source(obj).price_currency or 'PLN'

    def get_estimated_minutes(self, obj):
        return self._catalogue_source(obj).estimated_minutes

    def get_audience(self, obj):
        return self._catalogue_source(obj).audience

    def get_is_first_publication(self, obj):
        return obj.project.material_id is None


# --- projects ---------------------------------------------------------------------------------------


class MaterialProjectSerializer(serializers.ModelSerializer):
    """A project as its own page, a listing row, and the teaser a stranger sees — one shape.

    Deliberately not three serializers. The teaser is the same key set with the private halves
    empty (`published_version`/`head_version` null, `my_role` null, every `can_*` false, both counts
    zero), which is what lets one mapper read all three and one queryset serve all three. A narrower
    serializer for the teaser would be a second place to remember when a field is added.

    `title`/`description` come from the head version even in the teaser, and that is the one thing
    a teaser deliberately DOES say: a project asking for co-authors has to be able to name what it
    is about, or the ask is unanswerable.
    """

    material_id = serializers.IntegerField(read_only=True)
    branch_id = serializers.SlugRelatedField(source='branch', slug_field='slug', read_only=True)
    branch_name = serializers.SerializerMethodField()
    created_by_id = serializers.IntegerField(read_only=True)
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    published_version = serializers.SerializerMethodField()
    head_version = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_propose = serializers.SerializerMethodField()
    propose_block_reason = serializers.SerializerMethodField()
    join_block_reason = serializers.SerializerMethodField()
    pending_proposals_count = serializers.SerializerMethodField()
    pending_join_requests_count = serializers.SerializerMethodField()
    # Read off the MATERIAL once one exists and off the project only while drafting — the same
    # split `MaterialProject`'s own docstring describes, applied at the one place a reader sees it.
    type = serializers.SerializerMethodField()
    audience = serializers.SerializerMethodField()
    author = serializers.SerializerMethodField()
    source_url = serializers.SerializerMethodField()
    price_amount = serializers.SerializerMethodField()
    price_currency = serializers.SerializerMethodField()
    estimated_minutes = serializers.SerializerMethodField()
    requirements = serializers.SerializerMethodField()
    coverage = serializers.SerializerMethodField()

    class Meta:
        model = MaterialProject
        fields = [
            'id',
            'material_id',
            'branch_id',
            'branch_name',
            'locale',
            'type',
            'audience',
            'author',
            'source_url',
            'price_amount',
            'price_currency',
            'estimated_minutes',
            'requirements',
            'coverage',
            'seeking_coauthors',
            'seeking_note',
            'created_by_id',
            'created_at',
            'title',
            'description',
            'published_version',
            'head_version',
            'members',
            'member_count',
            'my_role',
            'can_edit',
            'can_manage',
            'can_propose',
            'propose_block_reason',
            'join_block_reason',
            'pending_proposals_count',
            'pending_join_requests_count',
        ]

    # --- the caller ---------------------------------------------------------------------------

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _may_edit(self, obj):
        # Cached per ROW, never on `self`: DRF's `ListSerializer` shares ONE child instance across
        # every row under `many=True`, and caching on the serializer made every exercise in a bulk
        # listing show the first row's content once — a real data-corruption bug this codebase has
        # already paid for (exercises/CLAUDE.md).
        cached = getattr(obj, '_coauth_may_edit', None)
        if cached is None:
            cached = can_edit(obj, self._user())
            obj._coauth_may_edit = cached
        return cached

    def _catalogue_source(self, obj):
        return obj.material if obj.material_id is not None else obj

    # --- the two versions ----------------------------------------------------------------------

    def _visible_head(self, obj):
        """The head as THIS caller may see it. A draft is invisible to somebody who cannot edit, so
        for them the head is the published row — which is also exactly what a proposal must be
        written against, keeping `based_on` meaningful on both paths."""
        if self._may_edit(obj):
            return obj.head_version
        return obj.published_version

    def _summary(self, version):
        if version is None:
            return None
        return MaterialVersionSummarySerializer(version, context=self.context).data

    def get_published_version(self, obj):
        return self._summary(obj.published_version)

    def get_head_version(self, obj):
        return self._summary(self._visible_head(obj))

    def _naming_version(self, obj):
        """The version whose title and description name this project for THIS caller.

        The visible head, never the raw one: for a stranger looking at a published material that is
        the published version, because a member's unpublished draft is not theirs to read — reading
        `head_version` here once put a draft's title and description on the public project page.
        The one exception is a teaser (a draft project with nothing published, asking for help),
        which deliberately names itself by its draft; see the class docstring.
        """
        visible = self._visible_head(obj)
        if visible is not None:
            return visible
        if obj.material_id is not None:
            return None
        head = obj.head_version
        if head is not None:
            return head
        if self._may_edit(obj):
            # A draft project whose every version was refused or withdrawn — a first publication the
            # queue turned down, which is what a rejected single-shot upload became when that form
            # was folded in here. Its own team still has to find it by name in their listing, and
            # the refused version's title is the only name it ever had.
            return max(obj.versions.all(), key=lambda version: version.number, default=None)
        return None

    def get_title(self, obj):
        version = self._naming_version(obj)
        return version.title if version is not None else ''

    def get_description(self, obj):
        version = self._naming_version(obj)
        return version.description if version is not None else ''

    # --- the team ------------------------------------------------------------------------------

    def get_members(self, obj):
        return ProjectMemberSerializer(
            sorted(obj.members.all(), key=lambda row: (row.role != 'owner', row.added_at, row.pk)),
            many=True,
            context=self.context,
        ).data

    def get_member_count(self, obj):
        return len(obj.members.all())

    def get_my_role(self, obj):
        return role_of(obj, self._user())

    def get_can_edit(self, obj):
        return self._may_edit(obj)

    def get_can_manage(self, obj):
        return can_manage(obj, self._user())

    def get_can_propose(self, obj):
        return propose_block_reason(obj, self._user()) is None

    def get_propose_block_reason(self, obj):
        return propose_block_reason(obj, self._user())

    def get_join_block_reason(self, obj):
        return join_block_reason(obj, self._user())

    def get_pending_proposals_count(self, obj):
        # Members only, and 0 for everybody else — how much is waiting is itself private, the same
        # reasoning that keeps a course's pending-contribution count off its public page.
        if not self._may_edit(obj):
            return 0
        return sum(1 for v in obj.versions.all() if v.status == 'proposed')

    def get_pending_join_requests_count(self, obj):
        if not can_manage(obj, self._user()):
            return 0
        return obj.join_requests.filter(status='pending').count()

    # --- the catalogue -------------------------------------------------------------------------

    def get_branch_name(self, obj):
        from config.i18n_utils import request_locale, resolve_translation

        translation = resolve_translation(obj.branch.translations, request_locale(self.context))
        return translation.name if translation else obj.branch.slug

    def get_type(self, obj):
        return self._catalogue_source(obj).type

    def get_audience(self, obj):
        return self._catalogue_source(obj).audience

    def get_author(self, obj):
        return self._catalogue_source(obj).author

    def get_source_url(self, obj):
        return self._catalogue_source(obj).source_url

    def get_price_amount(self, obj):
        value = self._catalogue_source(obj).price_amount
        return str(value) if value is not None else None

    def get_price_currency(self, obj):
        return self._catalogue_source(obj).price_currency or 'PLN'

    def get_estimated_minutes(self, obj):
        return self._catalogue_source(obj).estimated_minutes

    def get_requirements(self, obj):
        material = obj.material
        if material is not None:
            return [r.label for r in material.requirements.all() if not r.is_removed]
        return list(obj.requirements or [])

    def get_coverage(self, obj):
        material = obj.material
        if material is not None:
            return [
                {'topic_id': row.topic_id, 'level': row.level, 'kind': row.kind}
                for row in material.coverage.all()
            ]
        return list(obj.coverage or [])


class MaterialProjectTeaserSerializer(MaterialProjectSerializer):
    """What a stranger sees of a draft project that is looking for co-authors.

    Same keys, private halves empty. Its own class rather than a flag on the one above so that the
    decision "a teaser shows no version rows" is a line of code somebody can read, not a condition
    buried in six methods.
    """

    def get_published_version(self, obj):
        return None

    def get_head_version(self, obj):
        return None


# --- writes -------------------------------------------------------------------------------------------


class _CatalogueValidationMixin:
    """The catalogue checks, shared by project create and project PATCH.

    `requirements` and `coverage` accept a JSON-encoded STRING as well as a real list, because this
    endpoint is multipart when a file rides along and a multipart form field always arrives as a
    string — the same acceptance, for the same reason, the retired `MaterialSubmissionSerializer`
    made before this endpoint inherited its job.
    """

    def validate_type(self, value):
        from materials.validators import validate_material_type

        return validate_material_type(value)

    def validate_audience(self, value):
        if value not in AUDIENCE_VALUES:
            raise serializers.ValidationError('Not an audience this site knows.')
        return value

    def validate_price_currency(self, value):
        # A plain CharField would store anything three characters long, and `choices` on the model
        # column is not enforced by the database — the curated list has to be checked here, where
        # the value arrives, or a bad code rides through to the `Material` row at publication.
        from materials.models import CURRENCY_CHOICES

        if value and value not in {code for code, _ in CURRENCY_CHOICES}:
            raise serializers.ValidationError('Not a currency this site lists.')
        return value

    @staticmethod
    def _as_list(value, message):
        if isinstance(value, str):
            try:
                value = json.loads(value) if value.strip() else []
            except ValueError:
                raise serializers.ValidationError(message)
        if not isinstance(value, list):
            raise serializers.ValidationError(message)
        return value

    def validate_requirements(self, value):
        value = self._as_list(value, 'Must be a JSON array of strings.')
        cleaned = clean_requirement_labels(value)
        duplicate = find_duplicate_requirement_label(cleaned)
        if duplicate is not None:
            raise serializers.ValidationError(f'"{duplicate}" appears more than once in this list.')
        return cleaned

    def validate_coverage(self, value):
        """Each entry is `{topic_id, level, kind}` — the shape `create_material` turns into real
        `MaterialCoverage` rows.

        **Checked here because nothing downstream checks it.** `materials.publish.create_material`
        is explicit that each `topic_id` is the CALLER's to have validated, and a topic from another
        branch would make a real claim on a real material with nothing to catch it — so the same
        three checks the retired `MaterialSubmissionSerializer` ran (real ints, level 1–100, kind in
        covers|requires, no duplicate topic+kind) run here, and the cross-field branch check is in
        `validate()` below, where the branch is known.
        """
        value = self._as_list(value, 'Must be a JSON array of {topic_id, level} objects.')
        cleaned = []
        seen = set()
        for entry in value:
            if not isinstance(entry, dict):
                raise serializers.ValidationError('Each coverage entry must be an object.')
            try:
                topic_id = int(entry.get('topic_id'))
                level = int(entry.get('level'))
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    'Each coverage entry needs a real topic_id and level.'
                )
            if not (1 <= level <= 100):
                raise serializers.ValidationError('level must be between 1 and 100.')
            kind = entry.get('kind') or 'covers'
            if kind not in ('covers', 'requires'):
                raise serializers.ValidationError("kind must be 'covers' or 'requires'.")
            if (topic_id, kind) in seen:
                raise serializers.ValidationError('The same topic was listed more than once.')
            seen.add((topic_id, kind))
            cleaned.append({'topic_id': topic_id, 'level': level, 'kind': kind})
        return cleaned

    def _check_coverage_topics(self, coverage, branch):
        if not coverage or branch is None:
            return
        valid = set(branch.topics.values_list('id', flat=True))
        for entry in coverage:
            if entry['topic_id'] not in valid:
                raise serializers.ValidationError(
                    {
                        'coverage': [
                            f'Topic {entry["topic_id"]} is not one of this branch\'s own topics.'
                        ]
                    }
                )


class MaterialVersionWriteSerializer(serializers.ModelSerializer):
    """One version's payload, on create and on propose alike.

    A `ModelSerializer` rather than a plain one specifically so `file` inherits the model field's
    own `validate_material_submission_file` (`materials/validators.py`, which kept its name through
    the submission model's retirement) — the libmagic sniff, the extension whitelist and the 25MB
    cap, running before a single byte is stored. Re-implementing the field here would silently drop
    all three.
    """

    based_on = serializers.PrimaryKeyRelatedField(
        queryset=MaterialVersion.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = MaterialVersion
        fields = ['kind', 'file', 'url', 'body', 'title', 'description', 'change_note', 'based_on']

    def validate_file(self, upload):
        """An image is re-encoded before it is ever stored; a PDF or a `.docx` is stored untouched
        (house rule 7, and `materials/materialfile.py` for the full argument). Here rather than at
        publish time, for the same reason the submission path gives: the bytes hit disk the moment
        this saves, and a GPS-bearing original must not sit there in the meantime."""
        from materials.materialfile import process_material_file

        return process_material_file(upload)

    def validate(self, attrs):
        """Exactly one payload, named by `kind`.

        The model's `clean()` says the same thing, and both exist on purpose: `clean()` covers the
        admin (the one write path with no serializer) and this covers the API, where a 400 naming
        the field is far more use to the person typing than a 500 out of `full_clean`.
        """
        kind = attrs.get('kind') or getattr(self.instance, 'kind', 'file')
        payload = {
            'file': attrs.get('file'),
            'link': (attrs.get('url') or '').strip(),
            'body': (attrs.get('body') or '').strip(),
        }
        wanted = {'file': 'file', 'link': 'link', 'body': 'body'}[kind]
        if not payload[wanted]:
            raise serializers.ValidationError(
                {wanted if wanted != 'link' else 'url': 'This version needs its own content.'}
            )
        if not (attrs.get('title') or '').strip():
            raise serializers.ValidationError({'title': 'A version needs a title.'})
        # The other two are cleared rather than refused: a form that switched from a link to a text
        # legitimately still holds the old URL in a hidden input, and refusing that would be a
        # puzzle rather than a safeguard. `MaterialVersion` stores exactly one payload either way.
        if kind != 'file':
            attrs['file'] = None
        if kind != 'link':
            attrs['url'] = ''
        if kind != 'body':
            attrs['body'] = ''
        return attrs


class MaterialProjectCreateSerializer(_CatalogueValidationMixin, serializers.Serializer):
    """`POST /api/material-projects/` — branch, locale, catalogue and version 1, in one request.

    One request rather than two because a project with no version is not a thing anybody wants to
    look at, and a client that crashed between the two calls would have left one behind.
    """

    branch = serializers.SlugRelatedField(slug_field='slug', queryset=Branch.objects.all())
    locale = serializers.CharField(max_length=8, required=False, default='pl')
    type = serializers.CharField(max_length=50)
    audience = serializers.CharField(max_length=12, required=False)
    author = serializers.CharField(max_length=200, required=False, allow_blank=True)
    source_url = serializers.URLField(max_length=500, required=False, allow_blank=True)
    price_amount = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, allow_null=True
    )
    price_currency = serializers.CharField(max_length=3, required=False, allow_blank=True)
    estimated_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    requirements = serializers.JSONField(required=False, default=list)
    coverage = serializers.JSONField(required=False, default=list)
    seeking_coauthors = serializers.BooleanField(required=False, default=False)
    seeking_note = serializers.CharField(max_length=500, required=False, allow_blank=True)
    #: "…and send it" in one request. The submit form always meant both — somebody filling in a
    #: title, a file and a subject is not asking to keep a draft — so it says so, and the view calls
    #: `publish_version` itself rather than making the client fire a second request it could crash
    #: between. A `BooleanField` because this endpoint is multipart whenever a file rides along and
    #: every multipart field arrives as the string 'true'/'false'; DRF's own parsing is what makes
    #: the two shapes mean the same thing here.
    publish = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        self._check_coverage_topics(attrs.get('coverage'), attrs.get('branch'))
        return attrs

    def catalogue(self) -> dict:
        """The project's own columns, ready for `MaterialProject(**catalogue)`. `branch` and
        `locale` are handed to `create_project` separately because they are not catalogue — they
        are what the project IS, and `publish` is not catalogue either: it is what to DO with the
        project once it exists."""
        data = dict(self.validated_data)
        data.pop('branch', None)
        data.pop('locale', None)
        data.pop('publish', None)
        return data


class MaterialProjectUpdateSerializer(_CatalogueValidationMixin, serializers.Serializer):
    """`PATCH /api/material-projects/{id}/` — every field optional.

    `branch` is absent on purpose: a project's branch is not something a later edit moves (every
    coverage claim on it is scoped to that branch's topics, and a material's slug is unique only
    within one). Moving content between branches is the taxonomy's own job and has its own path.
    """

    locale = serializers.CharField(max_length=8, required=False)
    type = serializers.CharField(max_length=50, required=False)
    audience = serializers.CharField(max_length=12, required=False)
    author = serializers.CharField(max_length=200, required=False, allow_blank=True)
    source_url = serializers.URLField(max_length=500, required=False, allow_blank=True)
    price_amount = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, allow_null=True
    )
    price_currency = serializers.CharField(max_length=3, required=False, allow_blank=True)
    estimated_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    requirements = serializers.JSONField(required=False)
    coverage = serializers.JSONField(required=False)
    seeking_coauthors = serializers.BooleanField(required=False)
    seeking_note = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, attrs):
        project = self.context.get('project')
        self._check_coverage_topics(attrs.get('coverage'), getattr(project, 'branch', None))
        return attrs


class ProjectInviteSerializer(serializers.ModelSerializer):
    """An invite link. `url_path` is a SUGGESTION and the panel treats it as one — it builds the
    absolute link from the address the browser actually reached, because the server has no reliable
    idea which public origin that was (the `CourseInvite` precedent)."""

    url_path = serializers.SerializerMethodField()
    is_usable = serializers.SerializerMethodField()
    unusable_reason = serializers.SerializerMethodField()

    class Meta:
        model = ProjectInvite
        fields = [
            'id',
            'token',
            'url_path',
            'label',
            'max_uses',
            'uses',
            'expires_at',
            'revoked_at',
            'created_at',
            'is_usable',
            'unusable_reason',
        ]

    def get_url_path(self, obj):
        return f'/project-invites/{obj.token}'

    def get_is_usable(self, obj):
        return obj.is_usable

    def get_unusable_reason(self, obj):
        return obj.unusable_reason()


class ProjectInviteWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectInvite
        fields = ['label', 'max_uses', 'expires_at']


class ProjectJoinRequestSerializer(serializers.ModelSerializer):
    project_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    display_name = serializers.SerializerMethodField()
    decided_by_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProjectJoinRequest
        fields = [
            'id',
            'project_id',
            'user_id',
            'display_name',
            'statement',
            'status',
            'decided_by_id',
            'decided_at',
            'decision_note',
            'created_at',
        ]

    def get_display_name(self, obj):
        return _display_name(obj.user)


__all__ = [
    'BODY_EXCERPT_CHARS',
    'ProjectMemberSerializer',
    'MaterialVersionSummarySerializer',
    'MaterialVersionSerializer',
    'MaterialVersionQueueRowSerializer',
    'MaterialProjectSerializer',
    'MaterialProjectTeaserSerializer',
    'MaterialProjectCreateSerializer',
    'MaterialProjectUpdateSerializer',
    'MaterialVersionWriteSerializer',
    'ProjectInviteSerializer',
    'ProjectInviteWriteSerializer',
    'ProjectJoinRequestSerializer',
]
