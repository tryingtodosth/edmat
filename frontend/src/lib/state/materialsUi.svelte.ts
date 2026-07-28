// The materials search/filter/sort overhaul's own "parallel interface" mechanism — "create
// sometimes more than one interface/parallel interface... can be changed using a settings button
// that's also going to handle language." Two real, distinct presentation modes for the materials
// browse experience:
//
// - 'simple'   — a search box, a type filter, and a sort dropdown. Intuitive, low-friction, for a
//                visitor who just wants to find a script or a past exam quickly.
// - 'advanced' — every real structured dimension the overhaul added: topic/subtopic coverage depth
//                (the "difficulty of coverage" axis), a tag filter, field/course scoping on the
//                cross-course hub, on top of everything 'simple' already offers. For someone who
//                wants to slice the corpus precisely.
//
// A Svelte 5 rune module, this app's own established convention for global reactive state that
// isn't page-scoped (theme.svelte.ts, guestSet.svelte.ts, browsingHistory.svelte.ts) — persisted to
// localStorage, the same "the one deliberate exception to 'nothing survives a reload' in this
// mocked phase" reasoning theme.svelte.ts's own header comment already gives: losing a deliberately
// picked interface mode on every reload would be a real regression, not just honest mock-phase
// behavior. Deliberately NOT gated on being logged in — an anonymous visitor is one of this app's
// own primary personas (CLAUDE.md Section 5) and gets exactly the same real choice a registered
// user does, the same way theme/guest-set both already work for guests too.

export type MaterialsUiMode = 'simple' | 'advanced';

const STORAGE_KEY = 'edmat-materials-ui-mode';

function readStoredMode(): MaterialsUiMode {
	if (typeof window === 'undefined') return 'simple';
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (stored === 'simple' || stored === 'advanced') return stored;
	} catch {
		// localStorage can throw in a locked-down/private-browsing context — fall back silently.
	}
	return 'simple';
}

let mode = $state<MaterialsUiMode>(readStoredMode());

export const materialsUiStore = {
	get mode(): MaterialsUiMode {
		return mode;
	},
	setMode(next: MaterialsUiMode): void {
		mode = next;
		try {
			window.localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Best-effort persistence only — a failure here just means the next reload falls back
			// to 'simple', not a broken app.
		}
	},
	/** For a single-button toggle UI (e.g. a quick switch inline on the materials page itself,
	 * alongside the real settings-page control). */
	toggle(): void {
		this.setMode(mode === 'simple' ? 'advanced' : 'simple');
	}
};
