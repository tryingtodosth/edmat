"""The compliance panel's data: the preset's legal checklist, evaluated against this contest's own
rows, every item carrying the law keys it rests on.

    report(contest) -> {'items': [{key, state, law, detail}], 'not_legal_advice': True,
                        'preset': key, 'tax': {...}}

**Nothing here is legal advice, and the payload says so in a field** rather than leaving it to the
copy, because the copy is the one thing a second surface can forget (CONTESTS-LAW.md §14). The
frontend draws the sentence from `not_legal_advice` and the per-citation MARKER from the `law` map
the presets endpoint already sends — `verified`, `secondary`, `unverified`, `disputed`. An
unverified article number must never be drawn as settled, which is the whole reason the markers
exist in `presets.LAW` at all.

**Three states, not two.** `ok` — the rows say it is done; `missing` — it is not, and the organiser
can see which field; `warning` — it is done but something about it deserves a second look (a prize
above the 2 000 zł line, an in-kind prize with no gross-up, a 7-day complaint window where the
organiser is a business). A boolean would make the last two the same red tick, and they are a
refusal and a caution.

**`detail` is a KEY, not a sentence.** Same reason as `people.py`: the sentence is the frontend's,
in both languages. The key is the checklist item's own key plus a suffix the panel has a line for
(`…:above_threshold`), and an unknown key falls back to the item's title, so a new check shows
something rather than nothing.

**What this is not.** It does not evaluate the regulamin's words — nobody here can read a paragraph
and say whether §7 actually contains a tax clause. It evaluates what the DATABASE can answer: is
there a claim deadline, is the jury big enough, is there a controller, does a stage description read
like a draw, has every section been written at all. Everything else is an honest `missing` until the
organiser ticks the task `personalize.apply_preset` made for it (step B), and this module says which
is which rather than pretending the harder half is checked.
"""

from __future__ import annotations

from . import presets, rules

OK = 'ok'
MISSING = 'missing'
WARNING = 'warning'


def _item(key, state, law, detail=None) -> dict:
    return {'key': key, 'state': state, 'law': list(law), 'detail': detail or key}


def report(contest) -> dict:
    """Evaluate the checklist of this contest's preset against its rows."""
    preset = presets.get(contest.preset_key)
    items: list[dict] = []
    checklist = presets.checklist_for(preset) if preset else []

    for entry in checklist:
        items.append(_evaluate(contest, entry, preset))

    return {
        'preset': contest.preset_key,
        'items': items,
        'tax': _tax(contest),
        # The one field that must never be optional. Read by `CompliancePanel.svelte`, which draws
        # the sentence in the reader's language and refuses to draw the panel without it.
        'not_legal_advice': True,
    }


def _evaluate(contest, entry, preset) -> dict:
    key = entry.key
    law = entry.law

    if key == 'rules_published':
        if contest.rules_version >= 1:
            return _item(key, OK, law)
        written = contest.rules_sections.exclude(body='').count()
        expected = len(presets.sections_for(preset)) if preset else 0
        return _item(key, MISSING, law, f'{key}:{written}of{expected}')

    if key == 'claim_deadline':
        if not contest.has_prize:
            return _item(key, OK, law, f'{key}:no_prize')
        if contest.prize_claim_deadline is None:
            return _item(key, MISSING, law)
        return _item(key, OK, law)

    if key == 'criteria_published':
        return _item(key, OK if rules._has_text(contest.merit_criteria) else MISSING, law)

    if key == 'jury_appointed':
        size = rules._jury_size(contest)
        minimum = preset.jury_min if preset else 1
        recommended = preset.jury_recommended if preset else 3
        if size < minimum:
            return _item(key, MISSING, law, f'{key}:{size}of{minimum}')
        if size < recommended:
            return _item(key, WARNING, law, f'{key}:below_recommended:{size}of{recommended}')
        return _item(key, OK, law, f'{key}:{size}')

    if key == 'no_draw':
        offenders = [
            stage.title
            for stage in contest.stages.all()
            if rules._looks_like_a_draw(stage.description)
        ]
        if rules._looks_like_a_draw(contest.merit_criteria):
            offenders.append('criteria')
        if offenders:
            return _item(key, MISSING, law, f'{key}:chance_element')
        return _item(key, OK, law)

    if key == 'tax_decided':
        if not contest.has_prize:
            return _item(key, OK, law, f'{key}:no_prize')
        if contest.prize_regime == 'none':
            return _item(key, MISSING, law)
        return _item(key, OK, law, f'{key}:{contest.prize_regime}')

    if key == 'payer_identity':
        if contest.data_controller_name:
            return _item(key, OK, law)
        return _item(key, MISSING, law)

    if key == 'guardian_consent':
        # Structural, like `publication_consent`: `rules.register_block_reason` refuses a minor
        # whose request carries no guardian name and consent (`guardian_consent_required`), so a
        # place-holding row without one belongs to an adult. There is therefore no failure state
        # to report — only the count, so the organiser can see that the consents exist and how
        # many. A preset that does not allow minors at all says that instead.
        if not contest.allows_minors:
            return _item(key, OK, law, f'{key}:no_minors')
        consented = contest.registrations.filter(
            status__in=('requested', 'accepted'), guardian_consent_at__isnull=False
        ).count()
        return _item(key, OK, law, f'{key}:enforced:{consented}')

    if key == 'rodo_clause':
        if contest.data_controller_name and contest.data_controller_contact:
            return _item(key, OK, law)
        return _item(key, MISSING, law)

    if key == 'publication_consent':
        # Structural: `publish_name` defaults False and has its own PATCH. There is no way to
        # bundle it into entry, so this is `ok` by construction and the panel says why.
        opted_in = contest.registrations.filter(publish_name=True).count()
        return _item(key, OK, law, f'{key}:structural:{opted_in}')

    if key == 'licence_clause':
        return _item(key, OK, law, f'{key}:{contest.entry_licence}')

    if key == 'image_consent':
        # Nothing in this app stores a photograph: pictures of a final live in a gallery
        # (`galleries/`), which has its own consent and its own visibility rule. Named rather than
        # silently ticked.
        return _item(key, WARNING, law, f'{key}:galleries')

    if key == 'complaints_procedure':
        days = contest.complaint_window_days
        expected = preset.complaint_window_days if preset else 14
        if days < expected:
            return _item(key, MISSING, law, f'{key}:{days}of{expected}')
        if contest.organiser_is_business and days < 14:
            # UOKiK's register: a 7-day window was held abusive where the organiser is a business.
            return _item(key, WARNING, law, f'{key}:business_short:{days}')
        return _item(key, OK, law, f'{key}:{days}')

    if key == 'external_reference':
        if contest.external_reference_url:
            return _item(key, OK, law)
        return _item(key, MISSING, law)

    if key == 'wykaz_listed':
        # A fact about a ministerial list this site cannot read. Always a caution, never a tick.
        return _item(key, WARNING, law, f'{key}:manual')

    if key == 'accommodation_contact':
        if contest.accommodation_contact:
            return _item(key, OK, law)
        return _item(key, MISSING, law)

    if key == 'team_split':
        if not contest.team:
            return _item(key, OK, law, f'{key}:not_a_team_contest')
        section = contest.rules_sections.filter(key='prizes').exclude(body='').exists()
        return _item(key, OK if section else MISSING, law, f'{key}:prizes_section')

    if key == 'consumer_block':
        if not contest.organiser_is_business:
            return _item(key, OK, law, f'{key}:not_a_business')
        if contest.complaint_window_days >= 14 and contest.rules_version >= 1:
            return _item(key, OK, law)
        return _item(key, MISSING, law)

    if key == 'every_stage_scored':
        stages = list(contest.stages.prefetch_related('problems', 'submissions__scores'))
        unscored = [s.title for s in stages if not rules.stage_is_fully_scored(s)]
        if not stages:
            return _item(key, MISSING, law, f'{key}:no_stages')
        if unscored:
            return _item(key, MISSING, law, f'{key}:{len(unscored)}of{len(stages)}')
        return _item(key, OK, law, f'{key}:{len(stages)}')

    if key == 'results_published':
        if contest.results_published_at is not None:
            return _item(key, OK, law)
        return _item(key, MISSING, law)

    if key == 'complaints_answered':
        open_count = contest.complaints.filter(status='open').count()
        if open_count:
            return _item(key, MISSING, law, f'{key}:{open_count}')
        return _item(key, OK, law)

    if key == 'prizes_handed':
        # A handover happens in a room, not in a database. `at_close` is the phase and the
        # organiser's own task (step B) is the record; this says so.
        if contest.status == 'closed':
            return _item(key, OK, law, f'{key}:closed')
        return _item(key, WARNING, law, f'{key}:manual')

    if key == 'pit_8ar':
        if not contest.has_prize:
            return _item(key, OK, law, f'{key}:no_prize')
        return _item(key, WARNING, law, f'{key}:manual')

    if key == 'certificates_issued':
        certifiable = contest.results.exclude(title='participant').count()
        if contest.results_published_at is None:
            return _item(key, MISSING, law, f'{key}:no_results')
        return _item(key, OK, law, f'{key}:{certifiable}')

    # A checklist item this module has no evaluation for is `warning` with its own key — never a
    # silent `ok` (house rule 10: flag it, don't fake it). Step B may add an item to `presets.py`
    # without touching this file and it will show as something to look at rather than as done.
    return _item(key, WARNING, law, f'{key}:manual')


def _tax(contest) -> dict:
    """The one tax block, computed once here so the panel and the regulamin editor cannot disagree.

    The **"science" limb** of the 2 000 zł exemption is the one shown — never the mass-media limb,
    which is disputed for an internet announcement and which this site must not let an organiser
    rely on (CONTESTS-LAW.md §3). `gross_up_pln` is the *ubruttowienie* practice, not statute: an
    in-kind prize's winner must pay the tax before receiving it (PIT art. 41 ust. 7), so the
    regulamin declares the prize as the item plus a cash part equal to the tax — prize ÷ 0.9.
    """
    if not contest.has_prize:
        return {'applies': False}
    value = contest.prize_total_value_pln
    above = bool(value and value > presets.PIT_68_THRESHOLD_PLN)
    gross_up = round(value / presets.GROSS_UP_DIVISOR, 2) if value else None
    return {
        'applies': True,
        'regime': contest.prize_regime,
        'value_pln': value,
        'threshold_pln': presets.PIT_68_THRESHOLD_PLN,
        'above_threshold': above,
        'gross_up_pln': gross_up,
        'law': ['pit_21_1_68', 'pit_30_1_2', 'pit_41_4', 'pit_41_7', 'pit_21_1_115'],
    }
