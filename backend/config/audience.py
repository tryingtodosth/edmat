"""The audience band — one axis on every content-bearing model (AUDIENCE-BRIEF.md §1).

"Difficulty" on this site has always meant *relative to a university course*. Once the audience
widens (toddlers via an adult, school pupils, seniors, career changers — Piotr's decision of
2026-09-09) every exercise, material, course, event, listing, post and set needs to say who it is
for, or every list becomes noise for everyone. One enumerated value, not a range or a multi-select:
content aimed at "primary and secondary" is two pieces of content in practice, and `all` is the
escape hatch a submitter has to pick on purpose.

Everything that existed before the field did is `university` — true of the whole corpus and of
every course, listing and event this site had ever had.

`?audience=a,b` on a list endpoint narrows to those bands; content marked `all` always passes,
because it is the one value that means "for everybody". An unknown value is ignored rather than
refused (a browse filter degrades to "show everything", the same posture `?near=` takes).
"""

AUDIENCE_CHOICES = [
    ('early_years', 'Early years (0–6, via an adult)'),
    ('primary', 'Primary school (6–12)'),
    ('secondary', 'Secondary school (12–19)'),
    ('university', 'University'),
    ('adult', 'Adult learners'),
    ('senior', 'Seniors'),
    ('all', 'Everyone'),
]
AUDIENCE_VALUES = [value for value, _ in AUDIENCE_CHOICES]
DEFAULT_AUDIENCE = 'university'
# The bands whose readers may be minors — anything shown to them is held to §2's rules.
MINOR_AUDIENCES = frozenset({'early_years', 'primary', 'secondary'})


def parse_audience_param(raw):
    """`'primary,secondary'` → `{'primary', 'secondary'}`; empty/None/unknown-only → None (no
    filter). `all` in the request means "no narrowing" too — asking for everyone is not a filter."""
    if not raw:
        return None
    wanted = {part.strip() for part in raw.split(',') if part.strip() in AUDIENCE_VALUES}
    if not wanted or 'all' in wanted:
        return None
    return wanted


def apply_audience_filter(qs, params, field='audience'):
    """Narrow `qs` to the bands named by `params['audience']`, always admitting rows marked `all`."""
    wanted = parse_audience_param(params.get('audience'))
    if wanted is None:
        return qs
    return qs.filter(**{f'{field}__in': list(wanted) + ['all']})
