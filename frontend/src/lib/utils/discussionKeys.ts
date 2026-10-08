// The spelling of a discussion key for a management row or an organisation's page, and where such a
// key sends a reader.
//
// `backend/community/discussions.py` (2026-10-08, "A task, a plan, a need or a poll is a location
// too" and "And so is an organisation's own page"): a `DiscussionLocation`'s page may be `tasks/17`,
// `plans/3`, `needs/2`, `polls/1` or `organizations/edmat` as well as `about/...`. The words are the
// frontend's own route segments, which is what makes the last function below a string operation
// rather than a lookup. `MANAGEMENT_PAGE_RE` and `ORGANIZATION_PAGE_RE` over there are the other
// half of this pair; a word added there and not here is a row the moderation tab cannot link to
// (house rule 13 — mirrored, said in both files).
import { resolve } from '$app/paths';

export const MANAGEMENT_DISCUSSION_KINDS = [
	'tasks',
	'plans',
	'needs',
	'polls',
	'goals',
	'organizations'
] as const;
export type ManagementDiscussionKind = (typeof MANAGEMENT_DISCUSSION_KINDS)[number];

/** The kinds whose key carries a SLUG rather than a numeric id. `organizations` is the one, because
 *  the slug is that model's stable public address and is what `/organizations/[slug]` resolves —
 *  `discussions.py: SLUG_KINDS` is the backend's half of this. */
const SLUG_KINDS: readonly string[] = ['organizations'];

const ID_RE = /^[1-9][0-9]{0,9}$/;
/** `organizations/services.allocate_slug`'s output, and the backend's `ORGANIZATION_PAGE_RE`. */
const SLUG_RE = /^[a-z0-9-]{1,60}$/;

/** `tasks/17`, `organizations/edmat` — the key a row's panel asks the policy endpoint about, and the
 *  `page` it posts to. */
export function discussionKeyFor(kind: ManagementDiscussionKind, id: string | number): string {
	return `${kind}/${id}`;
}

/** `'tasks'` for `tasks/17`, `'organizations'` for `organizations/edmat`; `null` for a standing
 *  page's key (`about`, `about/guide#enrolling`). */
export function managementDiscussionKind(key: string): ManagementDiscussionKind | null {
	const slash = key.indexOf('/');
	if (slash < 0) return null;
	const word = key.slice(0, slash);
	const rest = key.slice(slash + 1);
	if (!(MANAGEMENT_DISCUSSION_KINDS as readonly string[]).includes(word)) return null;
	// The shape is checked per kind, and only after the word: `about/guide` would pass a slug test,
	// which is why the word comes first.
	const shape = SLUG_KINDS.includes(word) ? SLUG_RE : ID_RE;
	return shape.test(rest) ? (word as ManagementDiscussionKind) : null;
}

/** The page a management row's or an organisation's thread lives on, or `null` for a standing page's
 *  key — those are reached by their own page and anchor, which this app has never built from a key. */
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
		case 'goals':
			return resolve('/goals/[id]', { id });
		case 'organizations':
			return resolve('/organizations/[slug]', { slug: id });
	}
}
