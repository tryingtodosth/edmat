// The label maps for the cooperation overview's closed enums (backend materials_coop/), and the
// one place the panel's layouts are named.
//
// Mirrors `backend/materials_coop/models.py` (`POLICY_CHOICES`) and
// `backend/materials_coop/overview.py` (`TIMELINE_KINDS`); the unions live in
// `lib/types/materialsCoop.ts`, which names the same files (house rule 13). Beside its components
// rather than in `lib/utils/labels.ts`, for the reason `components/coauthoring/labels.ts` gives.

import { m } from '$lib/paraglide/messages.js';
import { CoopRefusedError } from '$lib/services/materialsCoop';
import { COAUTHORING_FLAG, refusalMessage } from '$lib/components/coauthoring/labels';
import type { CoopPolicy, CoopPostBlockReason, CoopTimelineKind } from '$lib/types/materialsCoop';

/** The overview is a view onto co-authoring's rows, so it hangs off the SAME switch: a killed
 *  co-authoring with a live cooperation page would be a page of links to 403s (house rule 3). */
export const COOP_FLAG = COAUTHORING_FLAG;

/** The three designs the panel can be drawn in, switched from its kebab. Ported from 2donet:
 *  `roster` is its RosterList + ProjectCard metrics strip, `timeline` its content history,
 *  `tiles` its dashboard grid (GridLayoutA/B). */
export type CoopLayout = 'roster' | 'timeline' | 'tiles';
export const COOP_LAYOUTS: CoopLayout[] = ['roster', 'timeline', 'tiles'];
export const DEFAULT_COOP_LAYOUT: CoopLayout = 'roster';
/** Per-viewer convenience only (a remembered design), never state anybody else needs. */
export const COOP_LAYOUT_STORAGE_KEY = 'edmat.coopLayout';

export const COOP_LAYOUT_LABELS: Record<CoopLayout, () => string> = {
	roster: m.coop_layout_roster, // "Team"
	timeline: m.coop_layout_timeline, // "Timeline"
	tiles: m.coop_layout_tiles // "Tiles"
};

export const POLICY_LABELS: Record<CoopPolicy, () => string> = {
	open: m.coop_policy_open, // "Open"
	request: m.coop_policy_request, // "By request"
	closed: m.coop_policy_closed // "Closed"
};

/** What each policy means, in a sentence — the settings form's radio descriptions and the
 *  badge's title. */
export const POLICY_HINTS: Record<CoopPolicy, () => string> = {
	open: m.coop_policyHint_open, // "Anyone signed in may propose a change; the co-authors decide."
	request: m.coop_policyHint_request, // "Only co-authors change it. Others may ask to join."
	closed: m.coop_policyHint_closed // "Only co-authors change it, and the team is not taking applications."
};

export const TIMELINE_KIND_LABELS: Record<CoopTimelineKind, () => string> = {
	version_drafted: m.coop_event_version_drafted, // "saved a draft"
	version_proposed: m.coop_event_version_proposed, // "proposed a change"
	version_published: m.coop_event_version_published, // "published a version"
	version_rejected: m.coop_event_version_rejected, // "rejected a proposal"
	version_withdrawn: m.coop_event_version_withdrawn, // "withdrew a proposal"
	member_joined: m.coop_event_member_joined // "joined the team"
};

export const POST_BLOCK_LABELS: Record<CoopPostBlockReason, () => string> = {
	authentication_required: m.coop_postBlock_authentication_required, // "Sign in to write here."
	members_only: m.coop_postBlock_members_only // "This thread is the co-authors' room; ask to join to write here."
};

/** The sentence for whatever a coop write threw. Reuses co-authoring's refusal vocabulary because
 *  every reason this API can answer with is one of that app's. */
export function coopErrorMessage(error: unknown): string {
	if (error instanceof CoopRefusedError) return refusalMessage(error.reason);
	return m.common_error_generic(); // "Something went wrong."
}

/** The remembered design, or the default. Wrapped because storage can be absent or throw. */
export function readStoredLayout(): CoopLayout {
	try {
		const stored = localStorage.getItem(COOP_LAYOUT_STORAGE_KEY);
		if (stored && (COOP_LAYOUTS as string[]).includes(stored)) return stored as CoopLayout;
	} catch {
		/* private window, blocked storage: the default is fine */
	}
	return DEFAULT_COOP_LAYOUT;
}

export function storeLayout(layout: CoopLayout): void {
	try {
		localStorage.setItem(COOP_LAYOUT_STORAGE_KEY, layout);
	} catch {
		/* same */
	}
}
