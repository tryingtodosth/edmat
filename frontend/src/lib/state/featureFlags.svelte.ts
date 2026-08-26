// A Svelte 5 rune module, same idiom notifications.svelte.ts/messages.svelte.ts already establish
// for global, fetch-once client state. Deliberately independent of authStore (unlike
// notifications/messages, which only ever matter for a logged-in visitor) — a feature kill switch
// affects an ANONYMOUS visitor's nav/routes too (e.g. a guest shouldn't see "Tutoring listings" or
// hit /services while it's off), so this refreshes unconditionally on app boot, not gated behind
// `authStore.isAuthenticated` the way those two are.
//
// Fails OPEN while the very first fetch hasn't resolved yet (an empty `flags` record plus
// `isEnabled` defaulting to true below) — matching the backend's own `is_feature_enabled` fail-open
// behavior for a missing row (moderation/services.py), so a slow/failed initial request never
// flashes disabled-feature UI at a visitor for whom every feature is actually on.

import type { FeatureFlag, FeatureFlagKey } from '$lib/types';
import { getFeatureFlags, setFeatureFlag as apiSetFeatureFlag } from '$lib/services/featureFlags';

let flags = $state<Record<string, FeatureFlag>>({});
// Whether `refresh()` has completed once. Before that `isEnabled` fails open, which is right for
// rendering links but wrong for firing a request the API will refuse — a page can wait on this.
let loaded = $state(false);

export const featureFlagsStore = {
	get all(): FeatureFlag[] {
		return Object.values(flags);
	},
	get isLoaded(): boolean {
		return loaded;
	},

	isEnabled(key: FeatureFlagKey): boolean {
		return flags[key]?.isEnabled ?? true;
	},
	async refresh(): Promise<void> {
		const list = await getFeatureFlags();
		const next: Record<string, FeatureFlag> = {};
		for (const flag of list) next[flag.key] = flag;
		flags = next;
		loaded = true;
	},
	async toggle(key: FeatureFlagKey, isEnabled: boolean): Promise<void> {
		const updated = await apiSetFeatureFlag(key, isEnabled);
		flags = { ...flags, [key]: updated };
	}
};
