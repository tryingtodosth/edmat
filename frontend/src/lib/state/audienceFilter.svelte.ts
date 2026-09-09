/**
 * The viewing preference: which audience bands lists are narrowed to (AUDIENCE-BRIEF.md §1).
 *
 * A LEAF module on purpose, like token.svelte.ts: `lib/api/client.ts` reads it to append
 * `?audience=` to every browse request, and `auth.svelte.ts` (which itself imports the client)
 * writes it after a profile loads — so this file imports nothing, which is what keeps that from
 * being a cycle. Persisted to localStorage always: for a guest that IS the preference, for a
 * signed-in person it is the cache of `Profile.audience_filter` so the first request after a
 * reload is already narrowed.
 */
import type { Audience } from '$lib/types/audience';

const STORAGE_KEY = 'edmat.audienceFilter';
const VALID: Audience[] = [
	'early_years',
	'primary',
	'secondary',
	'university',
	'adult',
	'senior',
	'all'
];

function readStored(): Audience[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is Audience => VALID.includes(v)) : [];
	} catch {
		return [];
	}
}

class AudienceFilterStore {
	bands = $state<Audience[]>(readStored());

	/** `'primary,secondary'` for the query string, or `undefined` when nothing is narrowed. */
	get param(): string | undefined {
		return this.bands.length > 0 ? this.bands.join(',') : undefined;
	}

	set(bands: Audience[]) {
		this.bands = VALID.filter((v) => bands.includes(v));
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bands));
		} catch {
			/* private mode / blocked storage: the in-memory value still applies this session */
		}
	}

	/** Called by the auth store once a profile is known; the account's saved choice wins. */
	syncFromProfile(bands: Audience[] | undefined) {
		if (bands) this.set(bands);
	}
}

export const audienceFilterStore = new AudienceFilterStore();
