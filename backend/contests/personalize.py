"""Personalising every other module to a contest — the preset, turned into rows on the node.

`CONTESTS-BRIEF.md` §3.B, the owner's *"personalize all current modules to this use case"*. A
contest owns almost nothing of what it needs to be run: the timeline is a `plans.Plan`, the
definition of done is a `goals.Goal` and its criteria, the legal checklist is one `tasks.Task` per
item, "jury member wanted" is a `needs.Need`, and the jury confirming the ranking is a
`decisions.Poll`. All five hang off the contest **as a node** (`config/nodes.py`), which is the
whole reason `contests` could be a small app.

This module is the MECHANISM. The words are in `presets.py`, both languages on one line, so a
reviewer can see that the Polish still says what the English does.

## Three rules it is built to

1. **Through each app's own path, never its ORM alone.** Every row goes through that app's write
   serializer (so its validation and its `sanitize_content` run — house rule 8) after that app's
   rule module has said the actor may create it (`tasks.rules.can_create`,
   `config.nodes.can_manage_node`). A second copy of "may this person" here is how two surfaces
   start disagreeing (root `CLAUDE.md` boundary 2). `work/edmat_project.py` is the precedent for
   everything else about the shape, including the bilingual text.
2. **A module that is off is a word in `skipped`, never an exception** (house rule 10: flag it,
   don't fake it). A moderator who switched `tasks` off gets a contest with a plan, a goal, needs
   and a poll, and a report that says `tasks` plainly. `apply_preset` is called from
   `ContestViewSet.create`, so an exception here would be a 500 on founding a contest.
3. **Idempotent, row by row, keyed by title on the node.** A second call creates nothing and says
   `already_personalised`. There is no `contest_preset_rows` marker table: a title on a node is what
   every other seed in this project keys on (`work/edmat_project.py`'s own "Idempotent by title"),
   it survives the organiser renaming a row the way a person would expect (the renamed row is
   theirs, and a re-run writes the preset's row again beside it), and it needs no migration — which
   step B is forbidden from adding to this app anyway (`CONTESTS-BRIEF.md` §4 rule 1).

## What it reads off the contest, and what it does without

Step A adds `has_prize`, `complaint_window_days` and the stage rows; this module is written against
a branch where none of them exist yet, so each is read with `getattr` and falls back to the
preset's own answer. That is not defensiveness for its own sake — it is what lets the two branches
be built at once, and it stays correct afterwards, because the preset is exactly the right default
for a field a founder has not touched.

Dates come from the contest's four datetimes (`starts_at`, `ends_at`, `registration_opens_at`,
`registration_closes_at`) and the preset's stage offsets. A step or a task whose anchor is empty is
created **with no due date** rather than with a guessed one: an invented deadline on a legal
checklist is worse than an open one.
"""

from __future__ import annotations

from datetime import timedelta

from django.apps import apps as django_apps

from . import presets

#: Words `skipped` can carry, besides a module's own flag key — and the flag keys are the module
#: names themselves (`plans`, `goals`, `tasks`, `needs`, `decisions`), so the wizard's "what will be
#: created for you" list can grey exactly one line (`CONTESTS-BRIEF.md` §3.A, wizard screen iv).
UNKNOWN_PRESET = 'unknown_preset'
NOT_MANAGER = 'not_manager'
ALREADY = 'already_personalised'


def _empty_report(preset_key: str, skipped: list[str]) -> dict:
    return {
        'preset': preset_key,
        'created': {'plan': None, 'goal': None, 'tasks': [], 'needs': [], 'polls': []},
        'skipped': skipped,
    }


def _enabled(flag_key: str, app_label: str) -> bool:
    """Whether this module is both installed and switched on. Installed is asked first because a
    bare clone that dropped an app should read as "not here", not as a crash."""
    if not django_apps.is_installed(app_label):
        return False
    from moderation.services import is_feature_enabled

    return bool(is_feature_enabled(flag_key))


def _node_filter(contest) -> dict:
    from config import nodes

    return {'content_type': nodes.node_content_type(contest), 'object_id': contest.pk}


def _text(pair: tuple[str, str]) -> tuple[str, str]:
    """`(en, pl)` -> `(pl, en)`. Every pair in `presets.py` is written English first because the
    research note is; every row here is written Polish first because `pl` is the base locale and the
    original a `TextVersion` carries."""
    return pair[1], pair[0]


def _write_bilingual(obj, heading: tuple[str, str], body: tuple[str, str] | None = None) -> None:
    """Both languages in ONE submission, Polish the original — `translations/` (2026-10-08).

    One submission is the point: `write_versions` stamps every language with the identical
    `updated_at`, so a row this created never shows a reader "the Polish is 4 minutes newer" about
    text nobody has edited. `heading`/`body` arrive as `(pl, en)`.
    """
    from translations.services import write_versions
    from translations.targets import fields_of

    heading_field, body_field = fields_of(obj)
    pl_heading, en_heading = heading
    pl_body, en_body = body if body is not None else ('', '')

    def half(one_heading: str, one_body: str) -> dict:
        out: dict[str, str] = {}
        if heading_field:
            out['heading'] = one_heading
        if body_field:
            out['body'] = one_body
        return out

    versions = {'pl': half(pl_heading, pl_body)}
    if en_heading or en_body:
        versions['en'] = half(en_heading or pl_heading, en_body)
    write_versions(obj, original_locale='pl', versions=versions, user=None)


# ---- the dates ----------------------------------------------------------------------------------


def _complaint_window_days(contest, preset) -> int:
    """Step A's field when it exists, the preset's otherwise. Never zero: a window of no days is
    not a window, and the law's floor is 14 for a business organiser (CONTESTS-LAW.md §9)."""
    value = getattr(contest, 'complaint_window_days', None)
    return int(value) if value else int(preset.complaint_window_days)


def _has_prize(contest, preset) -> bool:
    """Whether a prize is promised — the fact the whole of KC art. 919–921, the gambling act and
    PIT hang off (CONTESTS-LAW.md §13 g). The contest's own answer wins where step A's field
    exists; before it does, the preset's."""
    value = getattr(contest, 'has_prize', None)
    return bool(preset.has_prize) if value is None else bool(value)


def _anchors(contest, preset) -> dict:
    """`anchor name -> datetime or None`. Every date this module can honestly produce, worked out
    once, so a step and the task that shadows it never disagree by a day."""
    starts = contest.starts_at
    ends = contest.ends_at
    window = _complaint_window_days(contest, preset)
    handover = ends + timedelta(days=presets.HANDOVER_DAYS_AFTER_END) if ends else None
    return {
        'start': starts,
        'start_minus_7': (
            starts - timedelta(days=presets.BEFORE_ANNOUNCE_LEAD_DAYS) if starts else None
        ),
        'registration_opens': contest.registration_opens_at or starts,
        'registration_closes': contest.registration_closes_at or starts,
        'end': ends,
        'complaints_close': ends + timedelta(days=window) if ends else None,
        'handover': handover,
        'none': None,
    }


def _stage_steps(contest, preset) -> list[dict]:
    """Two steps per stage of the preset's ladder — "opens" and "closes" — because that is where the
    jury's work actually starts and stops, and a single step for a stage cannot be half done.

    Offsets are the `StageTemplate`'s, counted from `starts_at`. With no `starts_at` the steps are
    still created, with no dates: a ladder a reader can see is worth more than one that waits for a
    date somebody has not chosen.
    """
    starts = contest.starts_at
    steps: list[dict] = []
    for stage in preset.stages:
        opens = starts + timedelta(days=stage.offset_days) if starts else None
        closes = (
            starts + timedelta(days=stage.offset_days + stage.duration_days) if starts else None
        )
        steps.append(
            {
                'heading': (
                    presets.STAGE_STEP_OPENS[1].format(name=stage.name_pl),
                    presets.STAGE_STEP_OPENS[0].format(name=stage.name_en),
                ),
                'due_at': opens,
            }
        )
        steps.append(
            {
                'heading': (
                    presets.STAGE_STEP_CLOSES[1].format(name=stage.name_pl),
                    presets.STAGE_STEP_CLOSES[0].format(name=stage.name_en),
                ),
                'due_at': closes,
            }
        )
    return steps


# ---- the five modules ---------------------------------------------------------------------------


def _create_plan(contest, actor, preset, node, has_prize) -> tuple[int | None, bool]:
    """`(plan id, created)` — the timeline. `created` is False for a plan this already wrote."""
    from plans.models import Plan, PlanStep
    from plans.serializers import PlanCreateSerializer, PlanStepCreateSerializer

    title = _text(presets.PLAN_TITLE)
    existing = Plan.objects.filter(**node, title=title[0]).first()
    if existing is not None:
        return existing.pk, False

    body = _text(presets.PLAN_DESCRIPTION)
    serializer = PlanCreateSerializer(data={'title': title[0], 'description': body[0]})
    serializer.is_valid(raise_exception=True)
    plan = Plan.objects.create(
        **node, created_by=actor, status='active', **serializer.validated_data
    )
    _write_bilingual(plan, title, body)

    # The timeline: the phases before the stages, then the stage ladder, then the phases after it.
    # `PLAN_PHASES` is in order and the stage steps go in at `registration_closes`, which is where
    # a contest stops being administration and starts being a competition.
    anchors = _anchors(contest, preset)
    stage_steps = _stage_steps(contest, preset)
    rows: list[dict] = []
    for phase in presets.PLAN_PHASES:
        if phase.prize_only and not has_prize:
            continue
        rows.append(
            {
                'heading': (phase.title_pl, phase.title_en),
                'body': (phase.body_pl, phase.body_en),
                'due_at': anchors.get(phase.anchor),
            }
        )
        if phase.key == 'registration_closes':
            rows.extend(stage_steps)

    for order, row in enumerate(rows, start=1):
        heading = row['heading']
        body = row.get('body')
        payload = {'title': heading[0], 'description': (body[0] if body else '')}
        if row.get('due_at') is not None:
            payload['due_at'] = row['due_at']
        step_serializer = PlanStepCreateSerializer(data=payload)
        step_serializer.is_valid(raise_exception=True)
        data = step_serializer.validated_data
        step = PlanStep.objects.create(
            plan=plan,
            title=data['title'],
            description=data.get('description', ''),
            due_at=data.get('due_at'),
            order=order,
        )
        _write_bilingual(step, heading, body or ('', ''))
    return plan.pk, True


def _create_goal(contest, actor, preset, node, has_prize) -> tuple[int | None, bool]:
    """`(goal id, created)` — the definition of done. The criteria ARE the definition: `status`
    is derived from them by `goals.rules.recount` and nothing else writes it (house rule 5), so this
    sets no status at all."""
    from goals import rules as goal_rules
    from goals.models import Goal
    from goals.serializers import GoalCriterionSerializer, GoalSerializer

    title = _text(presets.GOAL_TITLE)
    existing = Goal.objects.filter(**node, title=title[0]).first()
    if existing is not None:
        return existing.pk, False

    body = _text(presets.GOAL_DESCRIPTION)
    serializer = GoalSerializer(data={'title': title[0], 'description': body[0]})
    serializer.is_valid(raise_exception=True)
    goal = serializer.save(**node, created_by=actor)
    _write_bilingual(goal, title, body)

    for order, (en, pl) in enumerate(presets.goal_criteria_for(preset, has_prize)):
        criterion_serializer = GoalCriterionSerializer(data={'text': pl, 'order': order})
        criterion_serializer.is_valid(raise_exception=True)
        criterion = criterion_serializer.save(goal=goal, order=order)
        # A criterion is the `poll_option` shape in `translations/targets.py`: one text field and no
        # body, so only the heading is written in both languages.
        _write_bilingual(criterion, (pl, en))
    # The recount is the only writer of `status`, and it runs on every change to the list — here so
    # that a goal born with criteria is `open` by the same arithmetic that will later make it `met`.
    goal_rules.recount(goal)
    return goal.pk, True


def _create_tasks(contest, actor, preset, node, has_prize) -> tuple[list[int], bool]:
    """One task per legal-checklist item, assigned by the item's `role`, due by its `phase`.

    The description is the item's citations with their verification markers and the sentence that
    says none of it is legal advice (`presets.citation_block`, CONTESTS-LAW.md §14). That is the
    whole reason these are tasks rather than a static checklist page: a task is what the work
    dashboard watches and what somebody can be put on.
    """
    from tasks.models import Task, TaskAssignee
    from tasks.serializers import TaskWriteSerializer

    anchors = _anchors(contest, preset)
    role_holder = _role_holders(contest)
    created: list[int] = []
    made_any = False
    for item in presets.checklist_for(preset, has_prize):
        heading = (item.title_pl, item.title_en)
        existing = Task.objects.filter(**node, title=heading[0]).first()
        if existing is not None:
            created.append(existing.pk)
            continue
        body = (
            presets.citation_block(item.law, 'pl'),
            presets.citation_block(item.law, 'en'),
        )
        due_at = anchors.get(presets.TASK_PHASE_ANCHORS.get(item.phase, 'none'))
        payload = {'title': heading[0], 'description': body[0]}
        serializer = TaskWriteSerializer(data=payload, context={'node': contest})
        serializer.is_valid(raise_exception=True)
        task = Task.objects.create(
            **node, created_by=actor, due_at=due_at, **serializer.validated_data
        )
        _write_bilingual(task, heading, body)
        # Assigned to whoever holds the role the checklist names, and to the organiser when the
        # secretary slot is empty — which it usually is at the moment a contest is founded.
        holder = role_holder.get(item.role) or role_holder.get('organiser')
        if holder is not None:
            TaskAssignee.objects.get_or_create(
                task=task, user=holder, defaults={'assigned_by': actor}
            )
        created.append(task.pk)
        made_any = True
    return created, made_any


def _role_holders(contest) -> dict:
    """`role -> one user`, for the checklist's `organiser` / `secretary` split. The founder is an
    organiser whether or not a `ContestStaff` row says so (`contests/access.py`), which is why that
    key is filled from the row itself."""
    holders = {'organiser': contest.organiser}
    for staff in contest.staff.all():
        holders.setdefault(staff.role, staff.user)
    return holders


def _create_needs(contest, actor, preset, node) -> tuple[list[int], bool]:
    """The preset's "wanted" rows — a jury member, a proctor for an on-site stage. An OPEN need is
    readable by everybody (`needs.rules.public_needs`), which is the point: this is how a contest
    asks the site for help rather than only its own staff."""
    from needs.models import Need
    from needs.serializers import NeedSerializer

    created: list[int] = []
    made_any = False
    for kind, title_en, title_pl, wanted in preset.needs:
        heading = (title_pl, title_en)
        existing = Need.objects.filter(**node, title=heading[0]).first()
        if existing is not None:
            created.append(existing.pk)
            continue
        serializer = NeedSerializer(
            data={
                'title': heading[0],
                'description': '',
                'kind': kind,
                'wanted_count': wanted,
                'skill_level': 'intermediate' if kind == 'expertise' else 'none',
            }
        )
        serializer.is_valid(raise_exception=True)
        need = serializer.save(**node, created_by=actor)
        _write_bilingual(need, heading)
        created.append(need.pk)
        made_any = True
    return created, made_any


def _create_polls(contest, actor, node) -> tuple[list[int], bool]:
    """The one decision a contest always has: the jury confirming the ranking before it is
    published. **Draft**, with `eligibility='staff'` — a poll that opened itself would be a vote
    nobody was told about, and a draft's question can still be edited
    (`decisions/views.py` refuses a PATCH to an open one)."""
    from decisions.models import Poll, PollOption
    from decisions.serializers import PollCreateSerializer, PollOptionCreateSerializer

    question = _text(presets.POLL_QUESTION)
    existing = Poll.objects.filter(**node, question=question[0]).first()
    if existing is not None:
        return [existing.pk], False

    body = _text(presets.POLL_DESCRIPTION)
    serializer = PollCreateSerializer(
        data={
            'question': question[0],
            'description': body[0],
            'mode': 'single',
            'eligibility': 'staff',
            'anonymous': False,
        }
    )
    serializer.is_valid(raise_exception=True)
    poll = Poll.objects.create(**node, created_by=actor, status='draft', **serializer.validated_data)
    _write_bilingual(poll, question, body)
    for order, (en, pl) in enumerate(presets.POLL_OPTIONS):
        option_serializer = PollOptionCreateSerializer(data={'text': pl, 'order': order})
        option_serializer.is_valid(raise_exception=True)
        option = PollOption.objects.create(poll=poll, **option_serializer.validated_data)
        _write_bilingual(option, (pl, en))
    return [poll.pk], True


# ---- the one public function --------------------------------------------------------------------


def apply_preset(contest, actor) -> dict:
    """Create, on the contest node and through the other apps' own paths, what its preset says a
    contest of that kind needs.

    Returns ``{'preset': key, 'created': {'plan': id|None, 'goal': id|None, 'tasks': [ids],
    'needs': [ids], 'polls': [ids]}, 'skipped': [words]}``. `created` names the rows that EXIST for
    this contest after the call, whether this call made them or an earlier one did; `skipped` is why
    something is missing — a module's flag key when it is switched off or not installed,
    `not_manager` when the actor may not create rows on this node, `unknown_preset` for a contest
    whose `preset_key` names no preset, and `already_personalised` when every row was already there.

    Called from `ContestViewSet.create` and from `seed_contest_demo` (step A), so it raises for
    nothing a moderator can cause.
    """
    preset = presets.get(contest.preset_key)
    if preset is None:
        return _empty_report(contest.preset_key, [UNKNOWN_PRESET])

    from config import nodes
    from tasks import rules as task_rules

    report = _empty_report(contest.preset_key, [])
    node = _node_filter(contest)
    has_prize = _has_prize(contest, preset)

    # The object-level authority check, asked once, explicitly, before any write (house rule 4): a
    # queryset filter never runs for something addressed by id. `can_manage_node` is the gate four
    # of the five modules' own views apply; `tasks` is the one that admits any staff member, and it
    # is asked separately below.
    may_manage = nodes.can_manage_node(actor, contest)
    may_task = task_rules.can_create(actor, contest)
    if not (may_manage or may_task):
        return _empty_report(contest.preset_key, [NOT_MANAGER])

    made_anything = False

    if not _enabled('plans', 'plans'):
        report['skipped'].append('plans')
    elif not may_manage:
        report['skipped'].append(NOT_MANAGER)
    else:
        plan_id, made = _create_plan(contest, actor, preset, node, has_prize)
        report['created']['plan'] = plan_id
        made_anything = made_anything or made

    if not _enabled('goals', 'goals'):
        report['skipped'].append('goals')
    elif not may_manage:
        report['skipped'].append(NOT_MANAGER)
    else:
        goal_id, made = _create_goal(contest, actor, preset, node, has_prize)
        report['created']['goal'] = goal_id
        made_anything = made_anything or made

    if not _enabled('tasks', 'tasks'):
        report['skipped'].append('tasks')
    elif not may_task:
        report['skipped'].append(NOT_MANAGER)
    else:
        task_ids, made = _create_tasks(contest, actor, preset, node, has_prize)
        report['created']['tasks'] = task_ids
        made_anything = made_anything or made

    if not _enabled('needs', 'needs'):
        report['skipped'].append('needs')
    elif not may_manage:
        report['skipped'].append(NOT_MANAGER)
    else:
        need_ids, made = _create_needs(contest, actor, preset, node)
        report['created']['needs'] = need_ids
        made_anything = made_anything or made

    if not _enabled('decisions', 'decisions'):
        report['skipped'].append('decisions')
    elif not may_manage:
        report['skipped'].append(NOT_MANAGER)
    else:
        poll_ids, made = _create_polls(contest, actor, node)
        report['created']['polls'] = poll_ids
        made_anything = made_anything or made

    if not made_anything and ALREADY not in report['skipped']:
        # Said rather than implied: the wizard shows this report, and "nothing happened because it
        # had already happened" and "nothing happened because everything is switched off" are two
        # completely different things to the person reading it (house rule 6).
        report['skipped'].append(ALREADY)
    return report
