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


def request_locale(context, default='en'):
    request = context.get('request')
    if request is None:
        return default
    return request.query_params.get('lang', default)
