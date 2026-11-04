"""The content-licence registry — the one place that says which licences a piece of content may
carry, what each one permits, and which way a change may go (owner, 2026-10-14: the licence is "not
settled yet. should be specific to each exercise, materials etc.").

Pure Python on purpose: model modules import `LICENCE_CHOICES` from here for their field's
`choices`, and a module those models import cannot import models back.

**Mirrored** into `frontend/src/lib/utils/labels.ts` (`LICENCES`, `LICENCE_FACTS`) — add or rename
a key in both files, and a migration for every model whose field freezes the choices.

The seven keys, and why there are seven:

- The five Creative Commons 4.0 / CC0 licences that still allow **derivatives**. No `-nd` variant is
  offered, because a translation is a derivative and EdMat translates content as a matter of course;
  an ND licence would forbid the community translation the site exists to collect.
- `edmat-only` — the author keeps every right and grants nobody anything beyond the operating
  licence `/terms` § 9 point 2 always takes (host, display, translate for display, moderate,
  archive). **The default** for anything created through the site: nothing is opened to the world
  without the author choosing it.
- `unknown` — content whose rights are unresolved: the seeded corpus (`LEGAL.md` §3) and anything
  imported without a declared licence. **Never selectable by a user**; only staff may set it, as a
  "rights in question" marker. It is shown with an honest "shown for study only" line.
"""

from __future__ import annotations

from dataclasses import dataclass

UNKNOWN = 'unknown'
EDMAT_ONLY = 'edmat-only'
DEFAULT_LICENCE = EDMAT_ONLY


@dataclass(frozen=True)
class Licence:
    key: str
    #: The official short name ("CC BY-SA 4.0") — a proper noun, the same in every language.
    short: str
    #: The official English title. The Polish one lives in the frontend catalogue.
    name: str
    #: The human-readable summary (the CC "deed"); `deed.<locale>` exists for every CC locale.
    deed_url: str = ''
    #: The legal code in English, and the OFFICIAL Polish translation where one exists.
    legalcode_en: str = ''
    legalcode_pl: str = ''
    #: Whether anybody (not only EdMat) may reuse the work at all.
    public_reuse: bool = False
    commercial: bool = False
    derivatives: bool = False
    share_alike: bool = False
    attribution: bool = True
    #: Whether a person may pick it in a form or through the API.
    selectable: bool = True


_CC = 'https://creativecommons.org/licenses'

LICENCES: dict[str, Licence] = {
    lic.key: lic
    for lic in (
        Licence(
            key='cc0-1.0',
            short='CC0 1.0',
            name='CC0 1.0 Universal (Public Domain Dedication)',
            deed_url='https://creativecommons.org/publicdomain/zero/1.0/',
            legalcode_en='https://creativecommons.org/publicdomain/zero/1.0/legalcode.en',
            # No official Polish translation of CC0 is listed by Creative Commons.
            legalcode_pl='',
            public_reuse=True,
            commercial=True,
            derivatives=True,
            share_alike=False,
            attribution=False,
        ),
        Licence(
            key='cc-by-4.0',
            short='CC BY 4.0',
            name='Creative Commons Attribution 4.0 International',
            deed_url=f'{_CC}/by/4.0/',
            legalcode_en=f'{_CC}/by/4.0/legalcode.en',
            legalcode_pl=f'{_CC}/by/4.0/legalcode.pl',
            public_reuse=True,
            commercial=True,
            derivatives=True,
        ),
        Licence(
            key='cc-by-sa-4.0',
            short='CC BY-SA 4.0',
            name='Creative Commons Attribution-ShareAlike 4.0 International',
            deed_url=f'{_CC}/by-sa/4.0/',
            legalcode_en=f'{_CC}/by-sa/4.0/legalcode.en',
            legalcode_pl=f'{_CC}/by-sa/4.0/legalcode.pl',
            public_reuse=True,
            commercial=True,
            derivatives=True,
            share_alike=True,
        ),
        Licence(
            key='cc-by-nc-4.0',
            short='CC BY-NC 4.0',
            name='Creative Commons Attribution-NonCommercial 4.0 International',
            deed_url=f'{_CC}/by-nc/4.0/',
            legalcode_en=f'{_CC}/by-nc/4.0/legalcode.en',
            legalcode_pl=f'{_CC}/by-nc/4.0/legalcode.pl',
            public_reuse=True,
            commercial=False,
            derivatives=True,
        ),
        Licence(
            key='cc-by-nc-sa-4.0',
            short='CC BY-NC-SA 4.0',
            name='Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International',
            deed_url=f'{_CC}/by-nc-sa/4.0/',
            legalcode_en=f'{_CC}/by-nc-sa/4.0/legalcode.en',
            legalcode_pl=f'{_CC}/by-nc-sa/4.0/legalcode.pl',
            public_reuse=True,
            commercial=False,
            derivatives=True,
            share_alike=True,
        ),
        Licence(
            key=EDMAT_ONLY,
            short='EdMat only',
            name='All rights reserved by the author; published on EdMat under the terms of use, § 9',
        ),
        Licence(
            key=UNKNOWN,
            short='Rights not clarified',
            name='Rights not yet clarified',
            attribution=False,
            selectable=False,
        ),
    )
}

LICENCE_CHOICES = [(lic.key, lic.short) for lic in LICENCES.values()]
LICENCE_VALUES = list(LICENCES)
SELECTABLE_LICENCES = [key for key, lic in LICENCES.items() if lic.selectable]
#: The longest key, which every model's `max_length` must hold.
LICENCE_MAX_LENGTH = 20
assert max(len(k) for k in LICENCES) <= LICENCE_MAX_LENGTH


def is_selectable(key: str) -> bool:
    lic = LICENCES.get(key)
    return bool(lic and lic.selectable)


def at_least_as_open(new: str, old: str) -> bool:
    """True if `new` permits everything `old` permitted — the only direction an author may move.

    Creative Commons grants are irrevocable (CC 4.0 §2(a)(1), "irrevocable"), so a label that moved
    to something narrower would describe a licence the work is no longer actually limited to: every
    copy taken earlier keeps the old one. Refusing the narrowing keeps the label true.

    It is a PARTIAL order, not a ladder: BY-NC and BY-SA each forbid something the other allows, so
    neither may become the other. `edmat-only` and `unknown` grant the public nothing, so anything
    public is at least as open as them; nothing narrower than a public licence is.
    """
    if new == old:
        return True
    a, b = LICENCES.get(new), LICENCES.get(old)
    if a is None or b is None:
        return False
    if not b.public_reuse:
        return True
    if not a.public_reuse:
        return False
    return (
        (a.commercial or not b.commercial)
        and (a.derivatives or not b.derivatives)
        and (b.share_alike or not a.share_alike)
        and (b.attribution or not a.attribution)
    )


#: What `compare_to_container` answers. MIRRORED in `frontend/src/lib/types/licence.ts`
#: (`LicenceRelation`) and `utils/labels.ts` (`licenceRelationNote`) — house rule 13.
LICENCE_RELATIONS = ('same', 'wider', 'narrower', 'different', 'unclear')


def compare_to_container(item: str, container: str) -> str:
    """How a work placed inside a container (a corpus material linked into a course) sits with the
    container's own licence. The item ALWAYS keeps its own — a course links, it does not copy, so
    nothing here changes anybody's licence; this only says whether a reader who takes the course's
    licence at its word would be wrong about this one item.

    - `same`      — the same key;
    - `wider`     — the item allows everything the container does (and maybe more): nothing to say;
    - `narrower`  — the container allows something the item does not (CC BY-SA course, an
                    "EdMat only" material);
    - `different` — neither covers the other (BY-NC and BY-SA): the item's terms differ;
    - `unclear`   — the item's rights are not clarified (`unknown`, the seeded corpus).
    """
    if item == container:
        return 'same'
    if item == UNKNOWN:
        return 'unclear'
    if at_least_as_open(item, container):
        return 'wider'
    if at_least_as_open(container, item):
        return 'narrower'
    return 'different'


def derivative_licence(parent: str) -> str:
    """The licence a derivative of `parent` (a translation of an exercise) is published under.

    Always the parent's own, for every key in this registry, and the reasons differ per family:
    under a ShareAlike licence it is REQUIRED (CC BY-SA 4.0 §3(b)); under BY / BY-NC / CC0 a
    different choice would be lawful, but a translation offered under a licence its own original
    does not carry is a trap for the reader, who would reuse the translation and infringe the
    original; under `edmat-only` the derivative exists only inside the operating licence anyway;
    and a translation of `unknown` content is exactly as unclear as its source. No `-nd` licence is
    in the registry, so no parent forbids the translation itself.
    """
    lic = LICENCES.get(parent)
    if lic is None:
        return UNKNOWN
    return parent


def parse_licence_param(raw) -> list[str] | None:
    """`'cc-by-4.0,cc0-1.0'` -> the known keys; empty or all-unknown -> None (no filter), the same
    degrade-to-everything posture as `config/audience.parse_audience_param`."""
    if not raw:
        return None
    wanted = [part.strip() for part in str(raw).split(',') if part.strip() in LICENCES]
    return wanted or None


def apply_licence_filter(qs, params, field: str = 'licence'):
    wanted = parse_licence_param(params.get('licence'))
    if wanted is None:
        return qs
    return qs.filter(**{f'{field}__in': wanted})


def licence_validation_error(value) -> str | None:
    """The refusal reason for a licence a PERSON asked for, or None if it is acceptable.

    Reasons, not booleans (house rule 6): the form has a sentence for each.
    """
    if value not in LICENCES:
        return 'licence_unknown_key'
    if not is_selectable(value):
        return 'licence_not_selectable'
    return None
