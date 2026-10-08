// The policies for the rows a panel draws — one request per PANEL, however many rows.
//
// The management rows' counterpart of `pageDiscussions.svelte.ts`: a task, a plan, a need or a
// poll is its own page to the discussion endpoint (`backend/community/discussions.py`, 2026-10-08),
// so a board of forty rows would be forty policy requests if each row asked for itself. The panel
// owns the fetch instead, through `?keys=`, and hands each row its own policy.
//
// A class rather than a context: a panel holds exactly one of these and reads it directly, and
// nothing below the panel needs to find it. Keyed on the reader as well as the keys, because every
// `canPost` in the answer changes the moment a session resolves — the same guard every dynamic
// load on these panels carries (`frontend/CLAUDE.md` trap 2).
import { policiesForKeys } from '$lib/services/discussions';
import type { DiscussionPolicy } from '$lib/types/discussion';

export class RowDiscussions {
	/** Keyed by the row's key (`tasks/17`). Empty until the request lands, and empty forever if it
	 *  fails — a board must render whether or not its threads load. */
	byKey = $state<Record<string, DiscussionPolicy>>({});
	private loadedFor = '';

	/** Idempotent per (keys, reader), so a caller's `$effect` may re-run freely. An empty list of
	 *  keys clears the map without a request. */
	load(keys: string[], reader: string) {
		const wanted = `${reader}|${keys.join(',')}`;
		if (wanted === this.loadedFor) return;
		this.loadedFor = wanted;
		if (keys.length === 0) {
			this.byKey = {};
			return;
		}
		policiesForKeys(keys)
			.then((map) => {
				if (this.loadedFor === wanted) this.byKey = map;
			})
			.catch(() => {
				if (this.loadedFor === wanted) this.byKey = {};
			});
	}
}
