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
	}>('/moderation/queue/');
	return {
		exerciseSubmissions: raw.submissions.map(mapExerciseSubmission),
		materialSubmissions: raw.material_submissions.map(mapMaterialSubmission),
		editSuggestions: raw.edit_suggestions.map(mapEditSuggestion),
		translations: raw.translations.map(mapExerciseTranslation),
		reports: raw.reports.map(mapReportGroup)
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
