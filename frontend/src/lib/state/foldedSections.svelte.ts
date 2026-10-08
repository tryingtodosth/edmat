// Which folded sections this reader has opened.
//
// The owner, 2026-10-08: *"simplify and clean as rn its overwehalming: most things should be hidden
// under some kind of expandable sth"* — and, asked what should be open to begin with, "everything
// shut but the first", remembered. An `/events/[id]` mounts sixteen panels below the hero and a
// `/courses/[id]` nearly as many; shut by default, a reader meets the event rather than its
// administration.
//
// **Keyed by SECTION, not by object.** `fold:documents` rather than `fold:event:6:documents`: a
// reader who opens Documents on one event is telling us something about themselves, not about that
// event, and a per-object key would make them say it again on the next one — and would grow one
// localStorage entry per row they ever looked at. The cost is that two sections with the same key
// on one page share a state, which is why `FoldSection` requires the key to be the SECTION's name
// and not its title.
//
// A rune module persisted to localStorage, this project's established shape for reader-scoped
// presentation state that must survive a reload (`theme.svelte.ts`, `materialsUi.svelte.ts`,
// `editorPrefs.svelte.ts`). Every read and write is wrapped: localStorage throws in a locked-down
// or private context, and a disclosure that cannot remember is still a working disclosure.

import { SvelteSet } from 'svelte/reactivity';

const STORAGE_KEY = 'edmat-open-sections';

function readStored(): string[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((k): k is string => typeof k === 'string');
	} catch {
		// Unreadable, unparseable or forbidden — start from "everything shut", which is the default
		// this feature wants anyway.
		return [];
	}
}

// A `SvelteSet` rather than a plain one so that adding a key is itself the reactive update: with a
// plain `Set` behind `$state` every toggle had to build a replacement set, and the lint rule that
// forbids it is right that the copy is the bug waiting to happen.
const open = new SvelteSet(readStored());

function persist(): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
	} catch {
		// Best-effort: the fold still works for this visit, it just will not be remembered.
	}
}

export const foldedSections = {
	/** Open unless this reader has said otherwise — `openByDefault` is for the one section a page
	 * wants showing (the owner's "everything shut but the first"). A key the reader has never
	 * touched is absent from the set, so the default stands until they click. */
	isOpen(key: string, openByDefault = false): boolean {
		if (open.has(`-${key}`)) return false;
		return openByDefault || open.has(key);
	},
	toggle(key: string, openByDefault = false): void {
		const nowOpen = this.isOpen(key, openByDefault);
		// A section that is open BY DEFAULT needs a stored "no" rather than the absence of a "yes",
		// or shutting it would be forgotten the moment the page reloads. The `-` prefix is that no.
		open.delete(key);
		open.delete(`-${key}`);
		open.add(nowOpen ? `-${key}` : key);
		persist();
	},
	/** For a "collapse all" affordance and for tests that want a clean slate. */
	reset(): void {
		open.clear();
		persist();
	}
};
