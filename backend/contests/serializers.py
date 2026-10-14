"""Serializers for `contests` (CONTESTS-BRIEF.md §3.A).

Three things in here are load-bearing and worth reading before the code:

1. **A stage's payload carries the STATEMENT only.** `ContestProblemSerializer` resolves the
   exercise's translation for the reader's `?lang=` and sends `title` + `statement`. It never sends
   `answer`, and it never touches the hint/solution pool — handing a contestant the solution is the
   one thing a contest module must not do, and the honest place to prevent it is the serializer
   that builds the payload rather than a frontend that chooses not to draw it.
2. **Nothing writable is also derived.** `status`, `announced_at`, `results_published_at`,
   `closed_at`, `advanced`, every score total and every `ContestResult` field are read-only here;
   `rules.py` is their writer. A field a client could PATCH would be a second writer of something
   house rule 5 says has exactly one.
3. **The anonymised label.** `ContestRegistrationSerializer.number` is the row's position among the
   contest's registrations, ordered by arrival — recounted, not stored (`models.py` says why). It
   is what the jury's matrix shows instead of a name.
"""

from __future__ import annotations

from rest_framework import serializers

from config import nodes as node_seam
from config.i18n_utils import request_locale, resolve_translation
from translations.serializers import PlainTextWriteMixin, TranslatedTextMixin

from . import access, presets, rules
from .models import (
    ADVANCEMENT_CHOICES,
    Contest,
    ContestAnswer,
    ContestComplaint,
    ContestProblem,
    ContestRegistration,
    ContestResult,
    ContestRulesSection,
    ContestRulesVersion,
    ContestStaff,
    ContestStage,
    ContestSubmission,
)


def _display_name(user) -> str:
    """Just enough to name somebody. Duplicated per app rather than imported across app
    boundaries, the way `needs/serializers.py` and `events/serializers.py` each do it."""
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


def _person(user) -> dict | None:
    if user is None:
        return None
    return {'id': user.pk, 'display_name': _display_name(user)}


def _initials(user) -> str:
    """What the public results list shows when nobody opted in: first letters, dotted. The UODO
    model regulamin's own default (CONTESTS-LAW.md §4)."""
    name = _display_name(user)
    parts = [p for p in name.replace('.', ' ').split() if p]
    if not parts:
        return '—'
    return ' '.join(f'{p[0].upper()}.' for p in parts[:3])


def _registration_numbers(contest) -> dict[int, int]:
    ids = list(contest.registrations.order_by('created_at', 'id').values_list('pk', flat=True))
    return {pk: index for index, pk in enumerate(ids, start=1)}


# ---- staff ---------------------------------------------------------------------------------------


class ContestStaffSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    #: Write-only: a person is added by account id, which is how every roster on this site works
    #: while there is no people search (root `CLAUDE.md`, known gaps). `/contests/people-suggestions/`
    #: is what makes that bearable rather than a replacement for it.
    user_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = ContestStaff
        fields = ['id', 'user', 'user_id', 'role', 'added_at']
        read_only_fields = ['id', 'user', 'added_at']

    def get_user(self, row: ContestStaff) -> dict | None:
        return _person(row.user)


# ---- problems and stages -------------------------------------------------------------------------


class ContestProblemSerializer(serializers.ModelSerializer):
    """One problem. `statement` is resolved for the reader's language and is the ONLY body here."""

    exercise_id = serializers.IntegerField(write_only=True)
    exercise = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    statement = serializers.SerializerMethodField()
    resolved_locale = serializers.SerializerMethodField()
    visible_from = serializers.DateTimeField(read_only=True)

    class Meta:
        model = ContestProblem
        fields = [
            'id', 'exercise', 'exercise_id', 'order', 'points', 'title', 'statement',
            'resolved_locale', 'visible_from',
        ]
        read_only_fields = ['id', 'exercise', 'title', 'statement', 'resolved_locale', 'visible_from']

    def _translation(self, problem: ContestProblem):
        locale = request_locale(self.context)
        exercise = problem.exercise
        return resolve_translation(
            exercise.translations.filter(status='published'), locale, exercise.original_locale
        )

    def get_exercise(self, problem: ContestProblem) -> dict:
        exercise = problem.exercise
        return {
            'id': exercise.pk,
            'number': exercise.number,
            'branch': exercise.branch.slug,
            'difficulty': exercise.difficulty,
        }

    def get_title(self, problem: ContestProblem) -> str:
        t = self._translation(problem)
        return t.title if t else ''

    def get_statement(self, problem: ContestProblem) -> str:
        t = self._translation(problem)
        return t.statement if t else ''

    def get_resolved_locale(self, problem: ContestProblem) -> str:
        t = self._translation(problem)
        return t.locale if t else problem.exercise.original_locale


class ContestStageSerializer(serializers.ModelSerializer):
    max_points = serializers.FloatField(read_only=True)
    problem_count = serializers.SerializerMethodField()
    problems_visible = serializers.BooleanField(read_only=True)
    event = serializers.SerializerMethodField()
    submission_count = serializers.SerializerMethodField()
    advanced_count = serializers.SerializerMethodField()

    class Meta:
        model = ContestStage
        fields = [
            'id', 'order', 'key', 'title', 'description', 'mode', 'event', 'opens_at',
            'closes_at', 'advancement', 'advance_count', 'advance_threshold', 'status',
            'advanced_at', 'max_points', 'problem_count', 'problems_visible',
            'submission_count', 'advanced_count',
        ]
        # `status` and `advanced_at` are `rules.advance`'s and the open/close actions' — a PATCH
        # that could set them would be a second writer of who advances.
        read_only_fields = [
            'id', 'event', 'status', 'advanced_at', 'max_points', 'problem_count',
            'problems_visible', 'submission_count', 'advanced_count',
        ]

    def validate_advancement(self, value):
        if value not in dict(ADVANCEMENT_CHOICES):
            raise serializers.ValidationError('unknown_advancement')
        return value

    def validate_description(self, value):
        # `chance_element` is refused at announce (`rules.announce_block_reason`) AND here, where
        # the organiser is actually typing the word — being told at the moment you write
        # "losowanie" is a completely different experience from being told a week later that the
        # contest cannot be announced.
        if rules._looks_like_a_draw(value):
            raise serializers.ValidationError(rules.CHANCE_ELEMENT)
        return value

    def get_problem_count(self, stage: ContestStage) -> int:
        return stage.problems.count()

    def get_event(self, stage: ContestStage) -> dict | None:
        if stage.event_id is None:
            return None
        return {'id': stage.event_id, 'title': stage.event.title}

    def get_submission_count(self, stage: ContestStage) -> int:
        return stage.submissions.exclude(status='draft').count()

    def get_advanced_count(self, stage: ContestStage) -> int:
        return stage.submissions.filter(advanced=True).count()


# ---- registrations -------------------------------------------------------------------------------


class ContestRegistrationSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    number = serializers.SerializerMethodField()
    initials = serializers.SerializerMethodField()
    has_guardian_consent = serializers.SerializerMethodField()

    class Meta:
        model = ContestRegistration
        fields = [
            'id', 'user', 'number', 'initials', 'status', 'affiliation', 'guardian_name',
            'has_guardian_consent', 'publish_name', 'team_name', 'accepted_rules_version',
            'created_at', 'decided_at',
        ]
        read_only_fields = fields

    def get_user(self, row: ContestRegistration) -> dict | None:
        return _person(row.user)

    def get_number(self, row: ContestRegistration) -> int:
        numbers = self.context.get('registration_numbers')
        if numbers is None:
            numbers = _registration_numbers(row.contest)
            self.context['registration_numbers'] = numbers
        return numbers.get(row.pk, 0)

    def get_initials(self, row: ContestRegistration) -> str:
        return _initials(row.user)

    def get_has_guardian_consent(self, row: ContestRegistration) -> bool:
        return row.guardian_consent_at is not None


class RegisterSerializer(serializers.Serializer):
    """The register request. Nothing here is a model field directly, because two of them
    (`guardian_consent`, `accepted_rules`) are acts rather than values: a boolean that arrives
    `true` becomes a TIMESTAMP on the row, which is the only form a consent can be shown in later."""

    affiliation = serializers.CharField(required=False, allow_blank=True, max_length=200)
    guardian_name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    guardian_consent = serializers.BooleanField(required=False, default=False)
    #: Deliberately NOT part of entry — it has its own PATCH (`publish-name/`) and defaults False —
    #: but accepted here so the register form can offer the opt-in in one step, which is what the
    #: UODO model regulamin's own form does. Its own endpoint is what makes it revocable.
    publish_name = serializers.BooleanField(required=False, default=False)
    team_name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    accepted_rules = serializers.BooleanField(required=False, default=True)


class DecideSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=['accepted', 'declined'])


class PublishNameSerializer(serializers.Serializer):
    publish_name = serializers.BooleanField()


# ---- submissions, answers, scores ----------------------------------------------------------------


class ContestAnswerSerializer(serializers.ModelSerializer):
    problem_id = serializers.IntegerField()
    attachment_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = ContestAnswer
        fields = ['id', 'problem_id', 'text', 'attachment_id', 'updated_at']
        read_only_fields = ['id', 'updated_at']


class ContestSubmissionSerializer(serializers.ModelSerializer):
    answers = ContestAnswerSerializer(many=True, read_only=True)
    registration = serializers.SerializerMethodField()
    points = serializers.SerializerMethodField()
    scored_problems = serializers.SerializerMethodField()

    class Meta:
        model = ContestSubmission
        fields = [
            'id', 'registration', 'status', 'submitted_at', 'advanced', 'answers', 'points',
            'scored_problems', 'updated_at',
        ]
        read_only_fields = fields

    def get_registration(self, submission: ContestSubmission) -> dict:
        row = submission.registration
        numbers = self.context.get('registration_numbers')
        if numbers is None:
            numbers = _registration_numbers(row.contest)
            self.context['registration_numbers'] = numbers
        # **Anonymised by default** (CONTESTS-BRIEF.md §3.A item 6): the jury sees a number. The
        # name is added only where the caller manages the contest, which is the roster view.
        payload = {
            'id': row.pk,
            'number': numbers.get(row.pk, 0),
            'team_name': row.team_name,
        }
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is not None and access.can_manage(user, row.contest):
            payload['user'] = _person(row.user)
        return payload

    def get_points(self, submission: ContestSubmission) -> float:
        return round(rules.submission_points(submission), 3)

    def get_scored_problems(self, submission: ContestSubmission) -> int:
        return rules.scored_problem_count(submission)


class SubmissionWriteSerializer(serializers.Serializer):
    """`PUT /api/contest-stages/{id}/submission/` — the whole draft in one call.

    One call rather than one per answer, because a contest answer box is a form somebody fills in
    and saves, and a per-answer endpoint would make a half-saved submission a reachable state in a
    page whose whole point is the deadline.
    """

    answers = ContestAnswerSerializer(many=True)


class ScoreRowSerializer(serializers.Serializer):
    problem = serializers.IntegerField()
    points = serializers.FloatField()
    note = serializers.CharField(required=False, allow_blank=True)


class ScoresWriteSerializer(serializers.Serializer):
    scores = ScoreRowSerializer(many=True)


class ContestScoreSerializer(serializers.Serializer):
    """One juror's own cells, for the matrix. A juror sees their own notes and everybody's points:
    a jury whose members cannot see each other's marks cannot discuss a ranking, which is the thing
    KC art. 921 §2 makes them a jury to do."""

    problem = serializers.IntegerField(source='problem_id')
    juror = serializers.SerializerMethodField()
    points = serializers.FloatField()
    note = serializers.CharField()

    def get_juror(self, score) -> dict | None:
        return _person(score.juror)


# ---- results and complaints ----------------------------------------------------------------------


class ContestResultSerializer(serializers.ModelSerializer):
    """The published ranking. **The name shown obeys `publish_name`, every time.**

    `display_name` is the initials unless this participant opted in — and the opt-in is only
    honoured where the contest's `publication_default` allows a full name at all, so revoking the
    consent, or an organiser changing the default, takes the name off the public list immediately
    (CONTESTS-LAW.md §4: UODO's own lesson).
    """

    display_name = serializers.SerializerMethodField()
    registration_number = serializers.SerializerMethodField()
    is_me = serializers.SerializerMethodField()
    max_points = serializers.SerializerMethodField()

    class Meta:
        model = ContestResult
        fields = [
            'id', 'rank', 'total_points', 'max_points', 'title', 'display_name',
            'registration_number', 'is_me', 'published_at',
        ]
        read_only_fields = fields

    def get_display_name(self, row: ContestResult) -> str:
        registration = row.registration
        contest = row.contest
        if registration.publish_name and contest.publication_default == 'full_name_opt_in':
            return _display_name(registration.user)
        return _initials(registration.user)

    def get_registration_number(self, row: ContestResult) -> int:
        numbers = self.context.get('registration_numbers')
        if numbers is None:
            numbers = _registration_numbers(row.contest)
            self.context['registration_numbers'] = numbers
        return numbers.get(row.registration_id, 0)

    def get_is_me(self, row: ContestResult) -> bool:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and row.registration.user_id == user.pk)

    def get_max_points(self, row: ContestResult) -> float:
        total = self.context.get('max_points')
        if total is None:
            total = float(
                sum(stage.max_points for stage in row.contest.stages.prefetch_related('problems'))
            )
            self.context['max_points'] = total
        return round(total, 3)


class ContestComplaintSerializer(serializers.ModelSerializer):
    registration_number = serializers.SerializerMethodField()
    answered_by = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = ContestComplaint
        fields = [
            'id', 'registration_number', 'text', 'status', 'answer', 'answered_by',
            'answered_at', 'created_at', 'is_mine',
        ]
        read_only_fields = [
            'id', 'registration_number', 'status', 'answer', 'answered_by', 'answered_at',
            'created_at', 'is_mine',
        ]

    def get_registration_number(self, row: ContestComplaint) -> int:
        numbers = self.context.get('registration_numbers')
        if numbers is None:
            numbers = _registration_numbers(row.contest)
            self.context['registration_numbers'] = numbers
        return numbers.get(row.registration_id, 0)

    def get_answered_by(self, row: ContestComplaint) -> dict | None:
        return _person(row.answered_by)

    def get_is_mine(self, row: ContestComplaint) -> bool:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and row.registration.user_id == user.pk)


class ComplaintAnswerSerializer(serializers.Serializer):
    answer = serializers.CharField()


# ---- the regulamin -------------------------------------------------------------------------------


class ContestRulesSectionSerializer(serializers.ModelSerializer):
    heading = serializers.SerializerMethodField()
    guidance = serializers.SerializerMethodField()
    law = serializers.SerializerMethodField()
    required = serializers.SerializerMethodField()

    class Meta:
        model = ContestRulesSection
        fields = ['id', 'key', 'order', 'body', 'heading', 'guidance', 'law', 'required']
        read_only_fields = ['id', 'heading', 'guidance', 'law', 'required']

    def _section(self, row: ContestRulesSection):
        return presets.RULES_SECTIONS.get(row.key)

    def get_heading(self, row) -> dict:
        s = self._section(row)
        return {'en': s.heading_en, 'pl': s.heading_pl} if s else {'en': row.key, 'pl': row.key}

    def get_guidance(self, row) -> dict:
        s = self._section(row)
        return {'en': s.guidance_en, 'pl': s.guidance_pl} if s else {'en': '', 'pl': ''}

    def get_law(self, row) -> list:
        s = self._section(row)
        return list(s.law) if s else []

    def get_required(self, row) -> bool:
        s = self._section(row)
        return bool(s and s.required)


class ContestRulesVersionSerializer(serializers.ModelSerializer):
    published_by = serializers.SerializerMethodField()

    class Meta:
        model = ContestRulesVersion
        fields = ['id', 'number', 'published_at', 'published_by', 'snapshot']
        read_only_fields = fields

    def get_published_by(self, row) -> dict | None:
        return _person(row.published_by)


# ---- the contest itself --------------------------------------------------------------------------

#: Everything a client may write. Spelled out rather than `exclude`d, so a field added to the model
#: is read-only until somebody deliberately lists it here — which is the direction an accident
#: should fall in on a surface with this many derived fields.
WRITABLE = [
    'title', 'description', 'preset_key', 'organization', 'visibility', 'audience',
    'allows_minors', 'starts_at', 'ends_at', 'registration_opens_at', 'registration_closes_at',
    'has_prize', 'prize_claim_deadline', 'prize_description', 'prize_total_value_pln',
    'prize_regime', 'organiser_is_business', 'external_reference_url', 'entry_licence',
    'complaint_window_days', 'publication_default', 'merit_criteria', 'data_controller_name',
    'data_controller_contact', 'accommodation_contact', 'team', 'team_size_max', 'capacity',
    'preparation_course', 'laureate_min_pct', 'finalist_min_pct', 'distinction_count',
]

DERIVED = [
    'id', 'organiser', 'status', 'announced_at', 'results_published_at', 'closed_at',
    'complaints_close_at', 'rules_version', 'created_at', 'updated_at', 'node', 'my_role',
    'is_member', 'can_manage', 'can_score', 'registration_count', 'jury_count', 'stage_count',
    'announce_block_reason', 'register_block_reason', 'my_registration', 'preset',
    'results_are_published',
    # Bilingual title and description (`translations/`, step B's `contest` kind, wired at
    # integration): `title`/`description` answer in the reader's `?lang=` through
    # `TranslatedTextMixin.to_representation`, and these two say which language that was and what
    # else exists — the same three fields a task, a plan and a goal carry.
    'language', 'text_versions',
]


class ContestSerializer(PlainTextWriteMixin, TranslatedTextMixin, serializers.ModelSerializer):
    language = serializers.SerializerMethodField()
    text_versions = serializers.SerializerMethodField()
    organiser = serializers.SerializerMethodField()
    node = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_score = serializers.SerializerMethodField()
    registration_count = serializers.SerializerMethodField()
    jury_count = serializers.SerializerMethodField()
    stage_count = serializers.SerializerMethodField()
    announce_block_reason = serializers.SerializerMethodField()
    register_block_reason = serializers.SerializerMethodField()
    my_registration = serializers.SerializerMethodField()
    preset = serializers.SerializerMethodField()
    complaints_close_at = serializers.DateTimeField(read_only=True)
    rules_version = serializers.IntegerField(read_only=True)
    results_are_published = serializers.SerializerMethodField()

    class Meta:
        model = Contest
        fields = DERIVED + WRITABLE
        read_only_fields = DERIVED

    # ---- validation ------------------------------------------------------------------------
    def validate_preset_key(self, value):
        if not value:
            return value
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        allowed = {p.key for p in presets.visible_to(user)}
        if value not in allowed:
            # A non-staff founder picking `kuratorium` is not a typo — it is a claim that this
            # contest exempts pupils from part of an exam (CONTESTS-LAW.md §14 item 9).
            raise serializers.ValidationError('preset_not_available')
        return value

    def validate_merit_criteria(self, value):
        if rules._looks_like_a_draw(value):
            raise serializers.ValidationError(rules.CHANCE_ELEMENT)
        return value

    def validate(self, attrs):
        has_prize = attrs.get('has_prize', getattr(self.instance, 'has_prize', False))
        if not has_prize:
            # No prize means no prize block at all. Silently dropping the regime rather than
            # refusing: a founder who turned the prize off in the wizard's second screen should not
            # be made to clear three fields they can no longer see.
            attrs['prize_regime'] = 'none'
            attrs['prize_claim_deadline'] = None
        return attrs

    # ---- derived ---------------------------------------------------------------------------
    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_organiser(self, contest: Contest) -> dict | None:
        return _person(contest.organiser)

    def get_node(self, contest: Contest) -> dict | None:
        return node_seam.node_ref(contest, self._user())

    def get_my_role(self, contest: Contest) -> str | None:
        return access.role_of(self._user(), contest)

    def get_is_member(self, contest: Contest) -> bool:
        return access.is_member(self._user(), contest)

    def get_can_manage(self, contest: Contest) -> bool:
        return access.can_manage(self._user(), contest)

    def get_can_score(self, contest: Contest) -> bool:
        return access.can_score(self._user(), contest)

    def get_registration_count(self, contest: Contest) -> int:
        return contest.registrations.filter(status__in=('requested', 'accepted')).count()

    def get_jury_count(self, contest: Contest) -> int:
        return rules._jury_size(contest)

    def get_stage_count(self, contest: Contest) -> int:
        return contest.stages.count()

    def get_announce_block_reason(self, contest: Contest) -> str | None:
        """Why it cannot be announced, on every read, for its staff only.

        House rule 6 at the level of a whole page: the contest page draws a line for the word,
        which is how an organiser learns that the claim deadline is missing before they press a
        button rather than after."""
        if not access.is_staff(self._user(), contest):
            return None
        if contest.status != 'draft':
            return None
        return rules.announce_block_reason(contest)

    def get_register_block_reason(self, contest: Contest) -> str | None:
        user = self._user()
        if user is None:
            return rules.ANONYMOUS
        return rules.register_block_reason(user, contest)

    def get_my_registration(self, contest: Contest) -> dict | None:
        user = self._user()
        if not (user and user.is_authenticated):
            return None
        row = contest.registrations.filter(user=user).first()
        if row is None:
            return None
        return ContestRegistrationSerializer(row, context=self.context).data

    def get_preset(self, contest: Contest) -> dict | None:
        preset = presets.get(contest.preset_key)
        return presets.preset_to_api(preset) if preset else None

    def get_results_are_published(self, contest: Contest) -> bool:
        return contest.results_published_at is not None


class ContestListSerializer(ContestSerializer):
    """The hub's card. Everything the detail has except the three expensive answers — the full
    preset payload (twelve regulamin sections and twenty-four checklist items per card), the
    reader's own registration, and the announce refusal — none of which a card draws."""

    class Meta(ContestSerializer.Meta):
        fields = [
            f for f in ContestSerializer.Meta.fields
            if f not in ('preset', 'my_registration', 'announce_block_reason', 'description')
        ]
        read_only_fields = [
            f for f in ContestSerializer.Meta.read_only_fields
            if f not in ('preset', 'my_registration', 'announce_block_reason')
        ]


class TransitionSerializer(serializers.Serializer):
    status = serializers.CharField()
