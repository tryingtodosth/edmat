import type {
	EditSuggestion,
	ExerciseSubmission,
	ExerciseTranslation,
	GovernableNodeKind,
	MaterialSubmission,
	ModerationStatus,
	NodeGovernorGrant,
	ReportGroup,
	ReportKind
} from '$lib/types';
import { apiClient } from '$lib/api/client';
import {
	mapEditSuggestion,
	mapExerciseSubmission,
	mapExerciseTranslation,
	mapMaterialSubmission,
	mapNodeGovernorGrant,
	mapReportGroup,
	type RawEditSuggestion,
	type RawExerciseSubmission,
	type RawExerciseTranslation,
	type RawMaterialSubmission,
	type RawNodeGovernorGrant,
	type RawReportGroup
} from '$lib/api/mappers';

export interface ModerationQueue {
	/** Proposed disciplines, branches and topics awaiting a decision — one flat list, because to a
	 * moderator they are one job ("somebody suggested a word, does it belong"), and the only thing
	 * that differs is which level it sits at, which `kind` carries. */
	taxonomyProposals: TaxonomyProposal[];
	exerciseSubmissions: ExerciseSubmission[];
	materialSubmissions: MaterialSubmission[];
	editSuggestions: EditSuggestion[];
	translations: ExerciseTranslation[];
	// Already priority-sorted by the backend (build_report_queue: auto-hidden first, then report
	// count descending) — this app's own established convention of not re-deriving server-computed
	// ordering client-side (same trust model Exercise.averageRating/reviewCount already get).
	reports: ReportGroup[];
}

export async function getModerationQueue(): Promise<ModerationQueue> {
	const raw = await apiClient.get<{
		submissions: RawExerciseSubmission[];
		material_submissions: RawMaterialSubmission[];
		edit_suggestions: RawEditSuggestion[];
		translations: RawExerciseTranslation[];
		reports: RawReportGroup[];
		taxonomy_proposals: unknown[];
	}>('/moderation/queue/');
	return {
		exerciseSubmissions: raw.submissions.map(mapExerciseSubmission),
		materialSubmissions: raw.material_submissions.map(mapMaterialSubmission),
		editSuggestions: raw.edit_suggestions.map(mapEditSuggestion),
		translations: raw.translations.map(mapExerciseTranslation),
		reports: raw.reports.map(mapReportGroup),
		taxonomyProposals: (raw.taxonomy_proposals ?? []).map(mapTaxonomyProposal)
	};
}

// `reviewerId` stays a parameter for call-site compatibility — the backend attributes the decision
// to whoever the auth token belongs to (moderation/views.py's ModerationActionView sets
// `reviewed_by = request.user` directly), and separately enforces (IsModerator) that only a real
// moderator's own token can reach this endpoint at all, so a caller can't decide as someone else
// even by passing a different id here.
async function decide(
	kind: 'submission' | 'material' | 'edit' | 'translation',
	id: string,
	status: ModerationStatus,
	note?: string
) {
	const decision = status === 'approved' ? 'approve' : 'reject';
	await apiClient.post(`/moderation/${kind}/${encodeURIComponent(id)}/${decision}/`, {
		review_note: note?.trim() || ''
	});
}

export async function decideExerciseSubmission(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('submission', id, status, note);
}

export async function decideMaterialSubmission(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('material', id, status, note);
}

export async function decideEditSuggestion(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('edit', id, status, note);
}

export async function decideTranslation(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('translation', id, status, note);
}

/** How many decisions are waiting, for the navigation badge.
 *
 * A dedicated endpoint rather than `getModerationQueue().length`: the queue serializes every pending
 * item to produce a body a badge would throw away. Scoped server-side exactly as the queue is, so
 * the number always agrees with the page it links to. */
export async function getModerationPendingCount(): Promise<number> {
	const raw = await apiClient.get<{ total?: number }>('/moderation/queue/count/');
	return raw.total ?? 0;
}

/** Resolves EVERY pending report against one target at once (moderation/views.py's
 * ReportActionView) — `restore` un-hides it (the reports were unfounded, or a false-positive
 * auto-hide); `remove` is a real, permanent moderator decision (Comment/Review's own isRemoved, or
 * an Exercise staying unpublished). Returns the freshly-resolved report queue directly (the backend
 * already recomputes and returns it), so a caller can just reassign its own local list instead of
 * re-fetching the whole moderation queue. */
export async function resolveReport(
	kind: ReportKind,
	objectId: string,
	decision: 'restore' | 'remove',
	note?: string
): Promise<ReportGroup[]> {
	const raw = await apiClient.post<RawReportGroup[]>(
		`/moderation/reports/${kind}/${encodeURIComponent(objectId)}/${decision}/`,
		{ resolved_note: note?.trim() || '' }
	);
	return raw.map(mapReportGroup);
}

// ---- node governors -------------------------------------------------------------------------
// The "node governor" administration panel itself — granting/revoking who governs which
// Discipline/Branch (moderation/views.py's NodeGovernorViewSet). `list` is scoped to the caller's OWN
// grants server-side unless they're a real global (is_staff) moderator, who sees every grant —
// the exact same backend behavior a plain, unparameterized GET already reflects, nothing extra
// needed on this side to express "my own vs. everyone's".

export async function listNodeGovernors(): Promise<NodeGovernorGrant[]> {
	const raw = await apiClient.get<RawNodeGovernorGrant[]>('/moderation/governors/');
	return raw.map(mapNodeGovernorGrant);
}

/** `userId` is a real, numeric backend User id — there's no user-search endpoint in this API today
 * (CLAUDE.md flags this as a known, honest UX limitation, not a hidden gap), so a staff admin
 * granting this role needs to already know the target account's numeric id (visible via Django
 * admin's own user list). */
export async function grantNodeGovernor(
	userId: string,
	kind: GovernableNodeKind,
	nodeSlug: string
): Promise<NodeGovernorGrant> {
	const raw = await apiClient.post<RawNodeGovernorGrant>('/moderation/governors/', {
		user: Number(userId),
		kind,
		node_slug: nodeSlug
	});
	return mapNodeGovernorGrant(raw);
}

export async function revokeNodeGovernor(id: string): Promise<void> {
	await apiClient.delete(`/moderation/governors/${encodeURIComponent(id)}/`);
}

export interface TaxonomyProposal {
	kind: 'discipline' | 'branch' | 'topic';
	id: number;
	slug: string;
	name: string;
	parent: string | null;
	proposedBy: number | null;
	proposedAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapTaxonomyProposal(raw: any): TaxonomyProposal {
	return {
		kind: raw.kind,
		id: raw.id,
		slug: raw.slug,
		name: raw.name,
		parent: raw.parent ?? null,
		proposedBy: raw.proposed_by ?? null,
		proposedAt: raw.proposed_at ?? null
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Decide on a proposed taxonomy node.
 *
 * Three of the four are corrections rather than refusals, because a pending node is real from the
 * moment it is proposed and has content filed under it by the time anybody reviews:
 *
 *   approve          it is right
 *   merge  + target  a duplicate — its content moves onto the target, the husk is deleted
 *   move   + target  right thing, wrong parent — re-parented, content follows
 *   reject           not a real thing — refused (409) if anything is filed under it
 *
 * A 409 is not a failure to report as broken: it means the node still holds content, and the
 * caller should offer merge or move instead. */
export async function decideTaxonomyProposal(
	kind: string,
	id: number,
	decision: 'approve' | 'merge' | 'move' | 'reject',
	options: { target?: string; note?: string } = {}
): Promise<void> {
	await apiClient.post(`/moderation/taxonomy/${kind}/${id}/`, { decision, ...options });
}
