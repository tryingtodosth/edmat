// The whole discipline/branch tree, fetched once and kept.
//
// **Why preload it.** It is the app's navigation: the disciplines index, the branch grid under each
// one, and the pickers on every submit/filter/create form all want the same two lists. Fetched per
// page, that is a round trip between every click, and on a phone the grid is empty for the length of
// it. It is also small and it barely changes — three disciplines and two branches in the real corpus
// — so holding all of it costs nothing and makes navigation instant after the first visit.
//
// **Keyed by locale, which is the part that is easy to get wrong.** A node's name is per-locale and
// resolved server-side (`?lang=`), so one cache key would paint the previous language's names from
// the saved copy before the network corrected them — a visible flash of the wrong language, and
// exactly the class of bug the taxonomy locale work started from. The locale is in the key, so
// switching language is a cache miss rather than a wrong hit.

import type { Branch, Discipline } from '$lib/types';
import { getAllBranches, getDisciplines } from '$lib/services/taxonomy';
import { getLocale } from '$lib/paraglide/runtime';
import { cached } from '$lib/state/offlineCache.svelte';

function createTaxonomyStore() {
	let disciplines = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let loaded = $state(false);
	/** True while all we have is a saved copy and the network has not answered yet. */
	let fromCache = $state(false);
	let savedAt = $state<number | null>(null);
	let offline = $state(false);

	/** Which locale the loaded data is for, so a language switch reloads rather than lying. */
	let loadedLocale: string | null = null;
	/** The in-flight load, so five call sites on one page produce one request, not five. */
	let inFlight: Promise<void> | null = null;

	async function load(locale: string): Promise<void> {
		await Promise.all([
			cached(`taxonomy:disciplines:${locale}`, getDisciplines, (result) => {
				if (!result.data) return;
				disciplines = result.data;
				fromCache = result.fromCache;
				savedAt = result.fromCache ? result.savedAt : null;
				offline = result.offline;
				loaded = true;
			}),
			cached(`taxonomy:branches:${locale}`, getAllBranches, (result) => {
				if (!result.data) return;
				branches = result.data;
			})
		]).catch(() => {
			// Nothing saved and the network failed. Callers still get empty lists, which is what they
			// would have had anyway — this must never reject, because it runs from the root layout and
			// an unhandled rejection there takes the whole app down (see routes/messages's own note).
		});
		loaded = true;
	}

	return {
		get disciplines() {
			return disciplines;
		},
		get branches() {
			return branches;
		},
		get loaded() {
			return loaded;
		},
		get fromCache() {
			return fromCache;
		},
		get savedAt() {
			return savedAt;
		},
		get offline() {
			return offline;
		},

		/**
		 * Fetch the tree if it is not already here for the current locale. Safe to call from anywhere,
		 * as often as you like: a second call while the first is in flight awaits the same promise.
		 */
		async preload(): Promise<void> {
			const locale = getLocale();
			if (loadedLocale === locale && loaded) return;
			if (inFlight && loadedLocale === locale) return inFlight;
			loadedLocale = locale;
			inFlight = load(locale).finally(() => {
				inFlight = null;
			});
			return inFlight;
		},

		/** The branches under one discipline, from what is already loaded. */
		branchesFor(disciplineId: string): Branch[] {
			return branches.filter((b) => b.disciplineId === disciplineId);
		},

		disciplineById(id: string): Discipline | undefined {
			return disciplines.find((d) => d.id === id);
		},

		/** After proposing a node, so the new one appears without a reload. */
		async refresh(): Promise<void> {
			loadedLocale = null;
			loaded = false;
			return this.preload();
		}
	};
}

export const taxonomyStore = createTaxonomyStore();
