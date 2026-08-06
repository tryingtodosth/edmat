"""Shared "resolve a translation row for a requested locale, falling back to the original" helper —
CLAUDE.md Section 10's "resolve, fall back to original" behavior, used identically by every
translatable model (Field/Course/Topic/Chapter in taxonomy, Exercise/ExerciseSource in exercises,
Material in materials).
"""

DEFAULT_FALLBACK_LOCALE = 'pl'  # today's only real original content locale (Section 3's corpus stats)


def resolve_translation(translations_qs, locale, fallback_locale=DEFAULT_FALLBACK_LOCALE):
    """Pick the translation row matching `locale`; fall back to `fallback_locale`, then to
    whatever's available, then to None (an untranslated row with zero translations, which shouldn't
    happen in practice but is handled honestly rather than raising)."""
    by_locale = {t.locale: t for t in translations_qs.all()}
    return by_locale.get(locale) or by_locale.get(fallback_locale) or next(iter(by_locale.values()), None)


def request_locale(context, default=DEFAULT_FALLBACK_LOCALE):
    """The locale the caller asked for via `?lang=`, defaulting to the original content locale.

    That default used to be 'en', which disagreed with `DEFAULT_FALLBACK_LOCALE` right above it and
    made a missing `?lang=` mean "prefer English" rather than "prefer the original" — the opposite
    of what Section 10 specifies, and only invisible while no non-Polish translation rows existed.
    Adding a single English FieldTranslation in the admin was enough to surface it: every reader,
    Polish interface included, started seeing the English name. The frontend now always sends
    `lang` (services/taxonomy.ts, services/exercises.ts), so this default is a backstop rather than
    the live path — but a backstop that silently prefers a translation over the original is the
    wrong one to leave in place for direct API consumers and any future call site that forgets.
    """
    request = context.get('request')
    if request is None:
        return default
    return request.query_params.get('lang', default)
