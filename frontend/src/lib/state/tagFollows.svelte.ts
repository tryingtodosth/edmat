// The current user's own tag-follow state — a Svelte 5 rune module, same idiom every other global
// client-state module in this app already uses. Same "deliberately doesn't import authStore" call
// as notifications.svelte.ts, for the identical reason (avoiding a circular import with
// auth.svelte.ts) — every call site is already responsible for its own auth guard.

import type { TagFollowState } from '$lib/types';
import { followTag, getMyTagFollows, setTagNotify, unfollowTag } from '$lib/services/tags';

let follows = $state<Record<string, TagFollowState>>({});
let loaded = $state(false);

export const tagFollowStore = {
	get loaded(): boolean {
		return loaded;
	},
	/** Every followed tag, for the "my followed tags" list (TagFollowsEditor.svelte) — the only
	 * consumer of the FULL set; every other call site only ever needs a per-tag lookup
	 * (isFollowing/notifyEnabled below), which is why this wasn't exposed until one needed it. */
	get list(): TagFollowState[] {
		return Object.values(follows);
	},
	isFollowing(tag: string): boolean {
		return tag in follows;
	},
	notifyEnabled(tag: string): boolean {
		return follows[tag]?.notify ?? true;
	},

	/** Loads the full follow list once — cheap (a handful of rows for any real user), and every
	 * TagChip on a page would otherwise each fetch its own copy independently. Safe to call
	 * repeatedly; a caller that already has it loaded gets an instant no-op. */
	async ensureLoaded(): Promise<void> {
		if (loaded) return;
		const list = await getMyTagFollows();
		follows = Object.fromEntries(list.map((f) => [f.tag, f]));
		loaded = true;
	},

	clear(): void {
		follows = {};
		loaded = false;
	},

	async follow(tag: string): Promise<void> {
		const previous = follows;
		follows = { ...follows, [tag]: { tag, notify: true } }; // optimistic
		try {
			const real = await followTag(tag);
			follows = { ...follows, [tag]: real };
		} catch {
			follows = previous;
		}
	},

	async unfollow(tag: string): Promise<void> {
		const previous = follows;
		const next = { ...follows };
		delete next[tag];
		follows = next; // optimistic
		try {
			await unfollowTag(tag);
		} catch {
			follows = previous;
		}
	},

	async setNotify(tag: string, notify: boolean): Promise<void> {
		if (!(tag in follows)) return;
		const previous = follows;
		follows = { ...follows, [tag]: { tag, notify } }; // optimistic
		try {
			const real = await setTagNotify(tag, notify);
			follows = { ...follows, [tag]: real };
		} catch {
			follows = previous;
		}
	}
};
