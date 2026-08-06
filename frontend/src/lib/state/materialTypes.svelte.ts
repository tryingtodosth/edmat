// The material-type vocabulary, which is no longer a fixed list in this file's neighbour.
//
// `MATERIAL_TYPE_LABELS` still holds the thirteen built-ins with curated translations in both
// locales, and it is still the FIRST place a label is looked up — those are the common cases, the
// wording was chosen rather than typed by whoever proposed it, and reading them from a map means a
// card renders its badge on the first frame instead of waiting on a fetch.
//
// What this adds is the rest: anything somebody has proposed since. Those have no message key and
// never will, so their name comes from the API, resolved for the reader's own locale server-side.
//
// The fallback order matters and is deliberate — message key, then API name, then the slug itself.
// The last one is what stops `MATERIAL_TYPE_LABELS[type]()` doing what it used to do for an
// unknown type, which was throw "is not a function" and take the page down with it.

import type { MaterialTypeOption } from '$lib/types';
import { getMaterialTypes } from '$lib/services/materials';
import { getLocale } from '$lib/paraglide/runtime';
import { MATERIAL_TYPE_LABELS } from '$lib/utils/labels';

function createMaterialTypesStore() {
	let types = $state<MaterialTypeOption[]>([]);
	let loaded = $state(false);
	let loadedLocale: string | null = null;
	let inFlight: Promise<void> | null = null;

	async function load(locale: string): Promise<void> {
		try {
			types = await getMaterialTypes();
		} catch {
			// The built-in labels still work without this, so a failed fetch costs only the ability
			// to name a proposed type — never the page. Must not reject: this runs from a layout.
		}
		loadedLocale = locale;
		loaded = true;
	}

	return {
		get list() {
			return types;
		},
		get loaded() {
			return loaded;
		},

		async preload(): Promise<void> {
			const locale = getLocale();
			if (loadedLocale === locale && loaded) return;
			if (inFlight && loadedLocale === locale) return inFlight;
			inFlight = load(locale).finally(() => {
				inFlight = null;
			});
			return inFlight;
		},

		/** After proposing one, so it can be picked without a reload. */
		async refresh(): Promise<void> {
			loadedLocale = null;
			return this.preload();
		},

		/** A readable name for a type slug, never throwing on one we have not heard of. */
		nameFor(slug: string): string {
			const builtin = MATERIAL_TYPE_LABELS[slug as keyof typeof MATERIAL_TYPE_LABELS];
			if (builtin) return builtin();
			return types.find((t) => t.slug === slug)?.name ?? slug;
		},

		isPending(slug: string): boolean {
			return types.find((t) => t.slug === slug)?.status === 'pending';
		}
	};
}

export const materialTypesStore = createMaterialTypesStore();
