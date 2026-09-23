// The first-visit interface language (backend `config/views.py`, `GET /api/locale-hint/`).
//
// One call, no auth, no body: the server looks at the address the request already arrived from and
// says which of the two interface languages a visitor who has never chosen one should get. Polish
// unless it can positively name a country that is not Poland — and with no GeoIP database
// installed it can never name one, so the answer is simply Polish.
//
// `country` comes back only so a person debugging a wrong language can see WHY. Nothing here
// stores it, and neither does the server.

import { apiClient } from '$lib/api/client';

export type LocaleHint = { suggestedLocale: 'en' | 'pl'; country: string | null };

type RawLocaleHint = { suggested_locale?: string; country?: string | null };

export async function getLocaleHint(): Promise<LocaleHint> {
	const raw = await apiClient.get<RawLocaleHint>('/locale-hint/');
	// Anything unexpected reads as "Polish", which is the same answer the server gives when it does
	// not know — a hint must never be able to break the page it is hinting at.
	const suggested = raw.suggested_locale === 'en' ? 'en' : 'pl';
	return { suggestedLocale: suggested, country: raw.country ?? null };
}
