"""EdMat managed on EdMat — write the project's own organisation and everything hung off it.

    manage.py seed_edmat_project --owner <username>

Idempotent: a second run refreshes the text of every entry in `work/edmat_project.py` and leaves
the state people changed on the site (status, assignees, applications, ballots) alone. The named
account becomes an owner of the organisation; the organisation is founded here rather than through
`organizations.services.found`, so the creation gate (`config/creation.py`) is not asked — this is
the operator's own body, written by the operator.

What it writes: one plan per module (its done steps come from `work/edmat_history.json`, which
`export_edmat_history` produces from `HISTORY.md`), the association's three phase plans and the
phase-1 compliance tasks, the standalone tasks, the public needs, the polls, the founding meeting
once its date is set, the two research accounts and the Gemini Deep Research thread under `/about`.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from work.edmat_project import ORGANIZATION_SLUG, build_edmat_project


class Command(BaseCommand):
    help = 'Seed or refresh the EdMat organisation and the project work hung off it (work/edmat_project.py).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--owner', required=True, help='Username of the account that owns the EdMat organisation.'
        )
        parser.add_argument(
            '--retake-description',
            action='store_true',
            help=(
                "Overwrite the organisation's description even if somebody has edited it through "
                'the bilingual editor on /about. Off by default, because the whole point of '
                "`keep_edited` is that a deployment never silently undoes the owner's own words — "
                'but when the NEW text in `work/edmat_project.py` is the one that should win, this '
                'is how to say so out loud.'
            ),
        )

    def handle(self, *args, **options):
        try:
            with transaction.atomic():
                built = build_edmat_project(
                    options['owner'], retake_description=options['retake_description']
                )
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc

        verb = 'Founded' if built['organization_created'] else 'Refreshed'
        self.stdout.write(
            self.style.SUCCESS(
                f'{verb} “{built["organization"].name}” — /organizations/{ORGANIZATION_SLUG} '
                f'(owner: {built["owner"].username})'
            )
        )
        for plan in built['plans']:
            steps = plan.steps.count()
            done = plan.steps.filter(status='done').count()
            self.stdout.write(f'  plan /plans/{plan.pk}   [{plan.status}]   {done}/{steps} steps   {plan.title}')
        for task in built['tasks']:
            due = task.due_at.date().isoformat() if task.due_at else '—'
            self.stdout.write(f'  task /tasks/{task.pk}   [{task.status}]   due {due}   {task.title}')
        for need in built['needs']:
            self.stdout.write(f'  need /needs/{need.pk}   [{need.status}]   {need.title}')
        for poll in built['polls']:
            self.stdout.write(f'  poll /polls/{poll.pk}   [{poll.status}]   {poll.question}')
        if built['event'] is not None:
            self.stdout.write(f'  event /events/{built["event"].pk}   [{built["event"].status}]   {built["event"].title}')
        for username in built['accounts']:
            self.stdout.write(f'  account {username}   (no usable password)')
        thread = built['thread']
        if thread:
            self.stdout.write(
                f'  thread /about#{thread["section"]}   {thread["comments"]} comment(s), '
                f'{thread["replies"]} repl{"y" if thread["replies"] == 1 else "ies"}, '
                f'{thread["created"]} new'
            )
        self.stdout.write(
            f'  {built["plans_created"]} plan(s), {built["steps_created"]} step(s), '
            f'{built["tasks_created"]} task(s), {built["needs_created"]} need(s), '
            f'{built["polls_created"]} poll(s) created; {built["history_count"]} history sections read. '
            'Tasks and polls are the roster’s; active plans and open needs are public.'
        )
        for extra in built['project_threads']:
            self.stdout.write(
                f'  thread /{extra["page"]}   {extra["comments"]} comment(s), {extra["created"]} new'
            )
        for line in built['waiting']:
            self.stdout.write(self.style.WARNING(f'  waiting: {line}'))
        for key in built['history_unfiled']:
            self.stdout.write(self.style.WARNING(f'  history sections filed under an unknown goal: {key}'))
