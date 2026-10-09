"""Personalising every other module to a contest — STUB, filled by step B
(`prompts/19-contests-b-personalise.md`).

The signature is fixed in advance because step A calls it from `ContestViewSet.create` and from
`seed_contest_demo`, and the frontend's preset wizard shows the report it returns:

    apply_preset(contest, actor) -> dict
        Creates, on the contest node and through the OTHER apps' own services (never their ORMs
        directly), what the contest's preset says a contest of that kind needs: the plan with its
        timeline steps, the goal whose criteria are its definition of done, the legal-checklist
        tasks assigned to the organiser, the "jury member wanted" needs, the decision the jury
        will take. Returns {'preset': key, 'created': {'plan': id|None, 'goal': id|None,
        'tasks': [ids], 'needs': [ids], 'polls': [ids]}, 'skipped': [reason-words]} — every
        module that is switched off or not installed is a word in `skipped`, never an exception
        (house rule 10: flag it, don't fake it).

Until step B lands it creates nothing and says so.
"""


def apply_preset(contest, actor) -> dict:
    return {
        'preset': contest.preset_key,
        'created': {'plan': None, 'goal': None, 'tasks': [], 'needs': [], 'polls': []},
        'skipped': ['not_built'],
    }
