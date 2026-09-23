"""Which article a reader actually gets — the read rule, in one place.

**A concept page never 404s while any article of it is published.** That is the whole of this
module, and it is the opposite posture from the list endpoints one file over: a list narrows
(house rule on content language — it shows what the reader asked for and says how much it left
out), and a **detail never narrows**, because a shared link has to resolve for whoever opens it.

So the page a reader is shown may not be the page they would have picked, and when it is not, the
page says so in words: `audience_exact` and `locale_exact` ride back beside the answer and the
frontend draws a line explaining which article this is and offering to write the missing one.
Silently showing the university article to somebody who asked for the primary-school one, with no
notice, is the failure this pair of booleans exists to prevent.

The order is: the reader's own languages first and their own band inside each, then `all` (an
article marked "for everybody" is not a fallback — it is the honest single-article answer), then
the nearest band by the ladder below, then the same two steps in any language, then anything at
all. Nearest by ladder rather than by a preference table because the ladder is real: a secondary
pupil handed the university article is better served than by the early-years one, and the distance
says so without anybody maintaining a matrix.
"""

from __future__ import annotations

from config.audience import DEFAULT_AUDIENCE

#: The bands in the order a reader grows through them. `all` is deliberately absent: it is not a
#: rung on this ladder, it is the answer that fits every rung, and it is tried before any distance
#: is measured.
AUDIENCE_ORDER = ['early_years', 'primary', 'secondary', 'university', 'adult', 'senior']


def _head_of(article):
    """The article's one `published` revision, or None. Reads `revisions.all()` so a prefetched
    article answers without a query — this function runs once per article of a concept."""
    for revision in article.revisions.all():
        if revision.status == 'published':
            return revision
    return None


def _headed_articles(concept, user):
    """[(article, head)] for every article this caller may see that HAS a published revision.

    A page is made of articles a reader can actually read, so an article whose only revision is
    still waiting does not put its `(audience, locale)` on the map — otherwise a reader would be
    sent to a page with nothing on it, which is worse than being sent to the fallback.
    """
    from .access import can_view_article

    out = []
    for article in concept.articles.all():
        if not can_view_article(article, user):
            continue
        head = _head_of(article)
        if head is not None:
            out.append((article, head))
    return out


def _pages_map(concept, user) -> dict[tuple[str, str], list]:
    """`{(audience, locale): [(article, head), …]}`, each list already in pool order."""
    pages: dict[tuple[str, str], list] = {}
    for article, head in _headed_articles(concept, user):
        pages.setdefault((article.audience, article.locale), []).append((article, head))
    for rows in pages.values():
        rows.sort(key=_pool_key)
    return pages


def _pool_key(row):
    """Pinned first, then the most recently published head, then the oldest article — the ordering
    every list of a page's articles uses. `pinned` is the staff/governor lever (`SolutionEntry`'s
    precedent) and recency is the honest tie-break: an article somebody has just improved is the one
    most likely to be worth reading."""
    article, head = row
    published_at = head.published_at
    return (
        not article.pinned,
        -(published_at.timestamp() if published_at is not None else 0),
        article.pk,
    )


def _distance(audience: str, wanted: list[str]) -> int:
    """How far this band is from the nearest band the reader asked for, on `AUDIENCE_ORDER`.

    A band that is not on the ladder at all (only `all` is) never reaches this — it is tried before
    any distance is measured — so an unknown value sorts last rather than raising.
    """
    if audience not in AUDIENCE_ORDER:
        return len(AUDIENCE_ORDER) + 1
    here = AUDIENCE_ORDER.index(audience)
    distances = [
        abs(here - AUDIENCE_ORDER.index(band)) for band in wanted if band in AUDIENCE_ORDER
    ]
    return min(distances) if distances else len(AUDIENCE_ORDER)


def resolve_page(concept, *, audiences, locales, user):
    """Which `(audience, locale)` this reader gets, and how exact the answer is.

    Returns `((audience, locale) | None, {'audience_exact': bool, 'locale_exact': bool})`. `None`
    means the concept has no readable article at all, which for anybody but its own authors means
    the concept itself is not there (`access.visible_concepts` agrees, and the view answers 404).

    `audiences=None` is "no preference expressed": `all` first, then `university`
    (`config.audience.DEFAULT_AUDIENCE` — what every row that predates the audience field means),
    then the nearest band to it. `locales` is the reader's languages with their interface language
    first; an empty list means the same thing as "any", and the order below handles it without a
    special case.
    """
    pages = _pages_map(concept, user)
    if not pages:
        return None, {'audience_exact': False, 'locale_exact': False}

    wanted_audiences = list(audiences) if audiences else [DEFAULT_AUDIENCE]
    exact_order = (['all'] + wanted_audiences) if not audiences else (wanted_audiences + ['all'])
    wanted_locales = [str(locale).lower() for locale in (locales or [])]

    def exact_in(locale_pool: list[str]):
        for locale in locale_pool:
            for audience in exact_order:
                if (audience, locale) in pages:
                    return audience, locale
        return None

    def nearest_in(locale_pool: list[str]):
        candidates = [key for key in pages if key[1] in locale_pool]
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda key: (
                _distance(key[0], wanted_audiences),
                locale_pool.index(key[1]),
                key[0],
            ),
        )

    other_locales = sorted({locale for _, locale in pages} - set(wanted_locales))

    chosen = (
        exact_in(wanted_locales)
        or nearest_in(wanted_locales)
        or exact_in(other_locales)
        or nearest_in(other_locales)
    )
    if chosen is None:
        # Step 4 — anything at all. Only reachable when `pages` is non-empty and every branch above
        # somehow declined, which the locale pools together cannot do; kept as an honest floor
        # rather than an assertion, because "the page exists but we picked nothing" must never be a
        # 500 on a public read.
        chosen = max(pages, key=lambda key: _pool_key(pages[key][0])[1])

    audience, locale = chosen
    return chosen, {
        # `all` counts as exact rather than as a fallback: an article marked "for everybody" is
        # written to be the answer for every band, so telling a reader they are seeing somebody
        # else's page would be wrong.
        'audience_exact': audience == 'all' or audience in wanted_audiences,
        'locale_exact': (not wanted_locales) or locale in wanted_locales,
    }


def pool(concept, audience: str, locale: str, user) -> list:
    """The articles of one page, in the order a reader sees them: pinned first, then the most
    recently published head. Only articles with a head — an article still waiting for its first
    review is not part of a page somebody is reading."""
    rows = _pages_map(concept, user).get((audience, locale), [])
    return [article for article, _head in rows]


def pool_with_heads(concept, audience: str, locale: str, user) -> list:
    """`pool()`, but keeping each article's head beside it — what the serializers want, so they do
    not immediately walk `revisions.all()` again for something this module already found."""
    return _pages_map(concept, user).get((audience, locale), [])


def pages(concept, user) -> list[dict]:
    """Every page of this concept that has something to read, for the page switcher.

    `lead_title` is the title of the article a reader would land on for that page — the first in
    pool order — so the switcher can name each chip with real words rather than a band and a
    language code.
    """
    out = []
    for (audience, locale), rows in _pages_map(concept, user).items():
        lead_article, lead_head = rows[0]
        out.append(
            {
                'audience': audience,
                'locale': locale,
                'article_count': len(rows),
                'lead_title': lead_head.title,
            }
        )
    out.sort(
        key=lambda row: (
            AUDIENCE_ORDER.index(row['audience']) if row['audience'] in AUDIENCE_ORDER else len(AUDIENCE_ORDER),
            row['locale'],
        )
    )
    return out


__all__ = ['AUDIENCE_ORDER', 'resolve_page', 'pool', 'pool_with_heads', 'pages']
