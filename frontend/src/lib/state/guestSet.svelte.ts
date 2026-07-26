// "My Set" for an anonymous visitor — a bare, localStorage-backed array of exercise ids, carried
// forward from the existing static site's own guest-set feature (Database-of-Student-Exercise's
// site/assets/set.js — see CLAUDE.md Section 3). Registered users get the richer, server-side
// ExerciseSet model instead (lib/services/exerciseSets.ts) once logged in; this store is
// deliberately the simpler, un-named "just a working list" version for anyone browsing without an
// account, matching CLAUDE.md Section 6's own "no account required" user story.

const STORAGE_KEY = 'edmat-guest-set';

function readStored(): string[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function persist(ids: string[]) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
	} catch {
		// Best-effort only.
	}
}

let ids = $state<string[]>(readStored());

export const guestSetStore = {
	get ids(): string[] {
		return ids;
	},
	get count(): number {
		return ids.length;
	},
	has(exerciseId: string): boolean {
		return ids.includes(exerciseId);
	},
	toggle(exerciseId: string): void {
		ids = ids.includes(exerciseId) ? ids.filter((id) => id !== exerciseId) : [...ids, exerciseId];
		persist(ids);
	},
	remove(exerciseId: string): void {
		ids = ids.filter((id) => id !== exerciseId);
		persist(ids);
	},
	/** Bulk-adds every id not already present — the tag-hover menu's "Save for later" action
	 * (TagChip.svelte): every exercise carrying a given tag, added to the current working set in
	 * one step, reusing this SAME store any single "add to my set" button already writes to
	 * (ExerciseCard.svelte's own `guestSetStore.toggle`) rather than a second, parallel mechanism.
	 * Returns how many were genuinely new, so the caller can show an honest "N added" vs. "all
	 * already in your set" message. */
	addMany(exerciseIds: string[]): number {
		// A plain array `.includes()` check, not `new Set(ids)` — this codebase's own eslint config
		// flags a bare `Set` inside a `.svelte.ts` module even for a short-lived, non-reactive local
		// like this one; a working set is small enough that the O(n²) membership check costs nothing
		// real in practice, so there's no reason to reach for `SvelteSet` (reactive-Set support) for
		// something that was never reactive state in the first place.
		const added = exerciseIds.filter((id) => !ids.includes(id));
		if (added.length === 0) return 0;
		ids = [...ids, ...added];
		persist(ids);
		return added.length;
	},
	/** Wholesale-replaces the working set — used when a registered user loads a previously saved named set. */
	setAll(next: string[]): void {
		ids = next;
		persist(ids);
	},
	clear(): void {
		ids = [];
		persist(ids);
	}
};
