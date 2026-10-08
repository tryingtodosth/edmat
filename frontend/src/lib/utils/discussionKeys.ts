// The spelling of a discussion key for a management row, and where such a key sends a reader.
//
// `backend/community/discussions.py` (2026-10-08, "A task, a plan, a need or a poll is a location
// too"): a `DiscussionLocation`'s page may be `tasks/17`, `plans/3`, `needs/2` or `polls/1` as well
// as `about/...`. The words are the frontend's own route segments, which is what makes the second
// function below a string operation rather than a lookup. `MANAGEMENT_PAGE_RE` over there is the
// other half of this pair; a word added there and not here is a row the moderation tab cannot
// link to (house rule 13 — mirrored, said in both files).
import { resolve } from '$app/paths';

export const MANAGEMENT_DISCUSSION_KINDS = ['tasks', 'plans', 'needs', 'polls'] as const;
export type ManagementDiscussionKind = (typeof MANAGEMENT_DISCUSSION_KINDS)[number];

/** `tasks/17` — the key a row's panel asks the policy endpoint about, and the `page` it posts to. */
export function discussionKeyFor(kind: ManagementDiscussionKind, id: string | number): string {
	return `${kind}/${id}`;
}

/** `'tasks'` for `tasks/17`; `null` for a standing page's key (`about`, `about/guide#enrolling`). */
export function managementDiscussionKind(key: string): ManagementDiscussionKind | null {
	const slash = key.indexOf('/');
	if (slash < 0) return null;
	const word = key.slice(0, slash);
	const rest = key.slice(slash + 1);
	if (!/^[1-9][0-9]{0,9}$/.test(rest)) return null;
	return (MANAGEMENT_DISCUSSION_KINDS as readonly string[]).includes(word)
		? (word as ManagementDiscussionKind)
		: null;
}

/** The page a management row's thread lives on, or `null` for a standing page's key — those are
 *  reached by their own page and anchor, which this app has never built from a key. */
export function discussionLocationHref(key: string): string | null {
	const kind = managementDiscussionKind(key);
	if (kind === null) return null;
	const id = key.slice(kind.length + 1);
	switch (kind) {
		case 'tasks':
			return resolve('/tasks/[id]', { id });
		case 'plans':
			return resolve('/plans/[id]', { id });
		case 'needs':
			return resolve('/needs/[id]', { id });
		case 'polls':
			return resolve('/polls/[id]', { id });
	}
}
