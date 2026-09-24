"""The management providers, registered at integration (MANAGEMENT-BRIEF.md §5).

Each management app ships `<app>/work.py: work_items(user)` in the §3.F item shape, written on its
own branch without knowing this app existed (§4 rule 13). Wiring them is this file's whole job,
and it is the integrator's, not any step's — so a step never imports `work`, and `work` never
imports a step's models.

One registration per SECTION, not per app: `/work` groups rows by section key and labels each
section by that key (`frontend/src/routes/work/+page.svelte`'s `sectionLabels`, which F wrote in
advance for exactly these six), and a needs provider yields two kinds of row (an application of
mine, a decision waiting on me) that belong under two headings. Each wrapper keeps only the rows
whose `kind` is the section it registers — the item shape's `kind` and the section key are the
same vocabulary on purpose.

A step whose kill switch is off is skipped by `collect()` through the flag key given here, so the
dashboard goes quiet for a killed module without any of this knowing (house rule 3).
"""

from . import providers


def _only(kind, work_items):
    def provider(user):
        return [item for item in work_items(user) if item.get('kind') == kind]

    provider.__name__ = f'{kind}_items'
    return provider


def register_management_providers():
    from decisions.work import work_items as poll_items
    from needs.work import work_items as need_items
    from plans.work import work_items as plan_items
    from tasks.work import work_items as task_items

    providers.register('task', 'tasks', _only('task', task_items))
    providers.register('need_application', 'needs', _only('need_application', need_items))
    providers.register('need_decision', 'needs', _only('need_decision', need_items))
    providers.register('plan_step', 'plans', _only('plan_step', plan_items))
    providers.register('plan_suggestion', 'plans', _only('plan_suggestion', plan_items))
    providers.register('poll', 'decisions', _only('poll', poll_items))


register_management_providers()
