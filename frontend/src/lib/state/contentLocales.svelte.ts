/**
 * The content-language rule (AUDIENCE-BRIEF.md §5): lists show only items with a published
 * version in the interface language, plus whatever extra languages the reader opted into.
 *
 * A LEAF module like audienceFilter.svelte.ts: `client.ts` reads it to send `?content_locales=`
 * on every browse request, `auth.svelte.ts` writes it after a profile loads. localStorage for a
 * guest, the profile's `content_locales` for a signed-in person. The interface language itself
 * comes from Paraglide at request time, so switching the interface switches the content too.
 */
import { getLocale, locales } from '$lib/paraglide/runtime';

const STORAGE_KEY = 'edmat.contentLocales';
export const SUPPORTED_CONTENT_LOCALES: readonly string[] = locales;

function readStored(): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
	} catch {
		return [];
	}
}

class ContentLocalesStore {
	/** Languages besides the interface one. */
	extras = $state<string[]>(readStored());

	/** Every language a list should include: the interface language first, then the extras. */
	get effective(): string[] {
		const ui = getLocale();
		return [ui, ...this.extras.filter((l) => l !== ui)];
	}
	get param(): string {
		return this.effective.join(',');
	}
	set(extras: string[]) {
		this.extras = [...new Set(extras.map((l) => l.toLowerCase()))];
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.extras));
		} catch {
			/* storage blocked: the in-memory value still applies this session */
		}
	}
	/** "Show them": every supported language the interface is not already showing. */
	showAll() {
		this.set([...SUPPORTED_CONTENT_LOCALES]);
	}
	syncFromProfile(extras: string[] | undefined) {
		if (extras) this.set(extras);
	}
}

export const contentLocalesStore = new ContentLocalesStore();
