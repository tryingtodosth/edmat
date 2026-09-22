// Co-authoring: one function per endpoint in COAUTHORING-BRIEF.md §5, and nothing else on this
// surface calls `fetch` (frontend/CLAUDE.md's layer boundary).
//
// Two things this module does that a thinner wrapper would not:
//
// 1. **Refusals arrive as typed errors carrying their reason.** The backend answers a blocked
//    action with `{detail: '<reason>'}` — `minor`, `already_member`, `expired`, `not_seeking`,
//    `pending_exists`, … — and each of those is a completely different sentence to the person in
//    front of it (house rule 6). A component catches `ProjectRefusedError` and looks the reason up;
//    it never has to know that the reason travelled inside an HTTP body.
// 2. **A stale save is its own error, carrying the head.** Collaboration here is turn-based: a save
//    written against a version that is no longer the head comes back 409 with the current head
//    attached, and `StaleVersionError` carries it mapped so the editor can show what landed
//    underneath rather than just "conflict".

import { apiClient, ApiError } from '$lib/api/client';
import {
	mapComment,
	mapMaterialProject,
	mapMaterialVersion,
	mapMaterialVersionSummary,
	mapProjectInvite,
	mapProjectInvitePreview,
	mapProjectJoinRequest,
	mapProjectMember,
	toBackendMaterialType,
	type RawComment,
	type RawMaterialProject,
	type RawMaterialVersion,
	type RawMaterialVersionSummary,
	type RawProjectInvite,
	type RawProjectInvitePreview,
	type RawProjectJoinRequest,
	type RawProjectMember
} from '$lib/api/mappers';
import type { Comment, CommentTargetType } from '$lib/types';
import type {
	MaterialProject,
	MaterialProjectDraft,
	MaterialProjectTeaser,
	MaterialVersion,
	MaterialVersionSummary,
	ProjectCatalogueDraft,
	ProjectInvite,
	ProjectInviteDraft,
	ProjectInvitePreview,
	ProjectJoinRequest,
	ProjectMember,
	VersionDraft
} from '$lib/types/materialProject';

/**
 * Somebody else's save landed first. `head` is the version this one should have been written
 * against — null only if the server could not name one, which the editor still has a line for.
 */
export class StaleVersionError extends Error {
	head: MaterialVersionSummary | null;

	constructor(message: string, head: MaterialVersionSummary | null) {
		super(message);
		this.name = 'StaleVersionError';
		this.head = head;
	}
}

/**
 * The world moved (409): `already_decided`, `not_draft`, `not_proposed`. Distinct from a refusal
 * below, which is about who you are rather than about what has already happened — root CLAUDE.md
 * is explicit that 409 and 400 must not be conflated.
 */
export class VersionConflictError extends Error {
	reason: string;

	constructor(message: string, reason: string) {
		super(message);
		this.name = 'VersionConflictError';
		this.reason = reason;
	}
}

/**
 * A rule said no (400 `{detail: '<reason>'}`): `minor`, `already_member`, `owner_immutable`,
 * `note_required`, an invite's `expired`/`revoked`/`used_up`, a `propose_block_reason` or a
 * `join_block_reason`. The reason IS the message — every one of them has its own sentence in both
 * catalogues.
 */
export class ProjectRefusedError extends Error {
	reason: string;

	constructor(message: string, reason: string) {
		super(message);
		this.name = 'ProjectRefusedError';
		this.reason = reason;
	}
}

/** The `{detail: '…'}` a DRF refusal carries, when it carries one. */
function detailOf(error: unknown): string | null {
	if (!(error instanceof ApiError)) return null;
	const body = error.body as { detail?: unknown } | null | undefined;
	return typeof body?.detail === 'string' ? body.detail : null;
}

/**
 * The one translation from HTTP to this module's errors. Every write below funnels through it, so
 * a new refusal reason needs a message key and nothing else — not a fourth place that inspects an
 * `ApiError` body by hand.
 */
function rethrow(error: unknown): never {
	if (error instanceof ApiError) {
		const detail = detailOf(error);
		if (error.status === 409) {
			if (detail === 'stale') {
				const head = (error.body as { head?: RawMaterialVersionSummary | null } | null)?.head;
				throw new StaleVersionError(error.message, head ? mapMaterialVersionSummary(head) : null);
			}
			throw new VersionConflictError(error.message, detail ?? 'conflict');
		}
		if (error.status === 400 && detail) throw new ProjectRefusedError(error.message, detail);
	}
	throw error;
}

/* --- projects --------------------------------------------------------------------------------- */

/** Projects the signed-in account is a member of. */
export async function listMyProjects(): Promise<MaterialProject[]> {
	const rows = await apiClient.get<RawMaterialProject[]>('/material-projects/?mine=1');
	return rows.map(mapMaterialProject);
}

/** Draft projects looking for co-authors — public teasers, readable signed out. */
export async function listSeekingProjects(branchId?: string): Promise<MaterialProjectTeaser[]> {
	const query = branchId ? `&branch=${encodeURIComponent(branchId)}` : '';
	const rows = await apiClient.get<RawMaterialProject[]>(`/material-projects/?seeking=1${query}`);
	return rows.map(mapMaterialProject);
}

/**
 * The project behind one material, or null when the backfill has not given it one (and, for a
 * reader with the feature switched off, when the endpoint answers with nothing). Null is a real
 * answer here, not a failure — `ProjectPanel` renders nothing for it.
 */
export async function getProjectForMaterial(materialId: string): Promise<MaterialProject | null> {
	try {
		const rows = await apiClient.get<RawMaterialProject[]>(
			`/material-projects/?material=${encodeURIComponent(materialId)}`
		);
		return rows.length > 0 ? mapMaterialProject(rows[0]) : null;
	} catch (e) {
		// A killed switch answers 403 and a material nobody has projected answers 404. Neither is
		// worth throwing at a page that is otherwise fine — the panel simply does not appear.
		if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
		throw e;
	}
}

export async function getProject(id: string): Promise<MaterialProject | null> {
	try {
		return mapMaterialProject(
			await apiClient.get<RawMaterialProject>(`/material-projects/${encodeURIComponent(id)}/`)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/** The catalogue fields, as multipart or JSON depending on which body the caller is building.
 *  `requirements`/`coverage` travel JSON-encoded over multipart, because a multipart field is
 *  always a string — the server parses either shape (`_CatalogueValidationMixin`). */
function catalogueEntries(draft: ProjectCatalogueDraft): [string, string][] {
	const out: [string, string][] = [['type', toBackendMaterialType(draft.type)]];
	out.push(['audience', draft.audience]);
	if (draft.author?.trim()) out.push(['author', draft.author.trim()]);
	if (draft.sourceUrl?.trim()) out.push(['source_url', draft.sourceUrl.trim()]);
	if (draft.priceAmount !== undefined) out.push(['price_amount', String(draft.priceAmount)]);
	if (draft.priceCurrency) out.push(['price_currency', draft.priceCurrency]);
	if (draft.estimatedMinutes !== undefined) {
		out.push(['estimated_minutes', String(draft.estimatedMinutes)]);
	}
	if (draft.requirements && draft.requirements.length > 0) {
		out.push(['requirements', JSON.stringify(draft.requirements)]);
	}
	if (draft.coverage && draft.coverage.length > 0) {
		out.push([
			'coverage',
			JSON.stringify(
				draft.coverage.map((c) => ({ topic_id: Number(c.topicId), level: c.level, kind: c.kind }))
			)
		]);
	}
	if (draft.seekingCoauthors !== undefined) {
		out.push(['seeking_coauthors', draft.seekingCoauthors ? 'true' : 'false']);
	}
	if (draft.seekingNote !== undefined) out.push(['seeking_note', draft.seekingNote]);
	return out;
}

/** The payload half of a version, flattened the same way. */
function versionEntries(version: VersionDraft): [string, string][] {
	const out: [string, string][] = [
		['kind', version.kind],
		['title', version.title.trim()]
	];
	out.push(['description', version.description?.trim() ?? '']);
	if (version.kind === 'link') out.push(['url', version.url?.trim() ?? '']);
	if (version.kind === 'body') out.push(['body', version.body ?? '']);
	if (version.changeNote?.trim()) out.push(['change_note', version.changeNote.trim()]);
	if (version.basedOnId) out.push(['based_on', version.basedOnId]);
	return out;
}

function toFormData(entries: [string, string][], file?: File | null): FormData {
	const form = new FormData();
	for (const [key, value] of entries) form.append(key, value);
	// Appended only when there really is one: an empty multipart file part arrives as a blank
	// upload rather than as "no file", and DRF would then try to validate it as one.
	if (file) form.append('file', file);
	return form;
}

/** The two flags that travel as `'true'`/`'false'` over multipart and as real booleans over JSON. */
const BOOLEAN_FIELDS = new Set(['seeking_coauthors', 'publish']);

function toJsonBody(entries: [string, string][]): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const [key, value] of entries) {
		// The two list fields were JSON-encoded for the multipart path; over JSON they should be
		// real arrays, not strings that happen to parse.
		body[key] =
			key === 'requirements' || key === 'coverage'
				? JSON.parse(value)
				: BOOLEAN_FIELDS.has(key)
					? value === 'true'
					: value;
	}
	return body;
}

/** What creating a project may do beyond saving version 1 as a draft. */
export interface CreateProjectOptions {
	/**
	 * Publish version 1 in the same request — `/submit-material`'s path, where there is no team yet
	 * and "submit" means "make this a material". The answer says which of two things happened, and
	 * the caller reads it rather than assuming: `materialId` set means it is live (staff, a verified
	 * contributor, a governor of the branch); `materialId` null means the version is waiting in the
	 * moderation queue, because a first publication nobody has vouched for is read by a person.
	 */
	publish?: boolean;
}

/**
 * Start a project. Behind the `material_submissions` switch, not `coauthoring`: creating a new
 * material and collaborating on an existing one are two abilities with two switches
 * (COAUTHORING-BRIEF.md §0). Minors are refused with `minor`.
 */
export async function createProject(
	draft: MaterialProjectDraft,
	file?: File | null,
	options: CreateProjectOptions = {}
): Promise<MaterialProject> {
	const entries: [string, string][] = [
		['branch', draft.branchId],
		['locale', draft.locale],
		...catalogueEntries(draft),
		...versionEntries(draft.version)
	];
	// Sent only when asked for: absent, the server does what it always did and saves a draft.
	if (options.publish) entries.push(['publish', 'true']);
	try {
		const raw = file
			? await apiClient.postForm<RawMaterialProject>(
					'/material-projects/',
					toFormData(entries, file)
				)
			: await apiClient.post<RawMaterialProject>('/material-projects/', toJsonBody(entries));
		return mapMaterialProject(raw);
	} catch (e) {
		return rethrow(e);
	}
}

/**
 * Edit the catalogue, the seeking flag, or (while still drafting) the locale. After the first
 * publication the backend routes these onto the `Material` row itself — the project's own copies
 * are frozen from that moment, which is why this is one endpoint and not two.
 */
export async function updateProject(
	id: string,
	patch: Partial<ProjectCatalogueDraft> & { locale?: string }
): Promise<MaterialProject> {
	const body: Record<string, unknown> = {};
	if (patch.type !== undefined) body.type = toBackendMaterialType(patch.type);
	if (patch.audience !== undefined) body.audience = patch.audience;
	if (patch.author !== undefined) body.author = patch.author;
	if (patch.sourceUrl !== undefined) body.source_url = patch.sourceUrl;
	if (patch.priceAmount !== undefined) body.price_amount = patch.priceAmount;
	if (patch.priceCurrency !== undefined) body.price_currency = patch.priceCurrency;
	if (patch.estimatedMinutes !== undefined) body.estimated_minutes = patch.estimatedMinutes;
	if (patch.requirements !== undefined) body.requirements = patch.requirements;
	if (patch.coverage !== undefined) {
		body.coverage = patch.coverage.map((c) => ({
			topic_id: Number(c.topicId),
			level: c.level,
			kind: c.kind
		}));
	}
	if (patch.seekingCoauthors !== undefined) body.seeking_coauthors = patch.seekingCoauthors;
	if (patch.seekingNote !== undefined) body.seeking_note = patch.seekingNote;
	if (patch.locale !== undefined) body.locale = patch.locale;
	try {
		return mapMaterialProject(
			await apiClient.patch<RawMaterialProject>(
				`/material-projects/${encodeURIComponent(id)}/`,
				body
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- versions --------------------------------------------------------------------------------- */

/** The history. Members, staff and governors get every row; anybody else gets the published and
 *  superseded ones plus their own proposals — the server decides, not this function. */
export async function listVersions(projectId: string): Promise<MaterialVersion[]> {
	const rows = await apiClient.get<RawMaterialVersion[]>(
		`/material-projects/${encodeURIComponent(projectId)}/versions/`
	);
	return rows.map(mapMaterialVersion);
}

/**
 * Save a version. A member's save lands as a `draft`; anybody else's lands as a `proposed` one for
 * the team to decide — the SAME call, because "improve this" and "edit this" are the same act with
 * different permissions, and a second endpoint would have been a second set of rules to keep in
 * step. Throws `StaleVersionError` when `basedOnId` is no longer the head.
 */
export async function saveVersion(
	projectId: string,
	draft: VersionDraft,
	file?: File | null
): Promise<MaterialVersion> {
	const entries = versionEntries(draft);
	const path = `/material-projects/${encodeURIComponent(projectId)}/versions/`;
	try {
		const raw = file
			? await apiClient.postForm<RawMaterialVersion>(path, toFormData(entries, file))
			: await apiClient.post<RawMaterialVersion>(path, toJsonBody(entries));
		return mapMaterialVersion(raw);
	} catch (e) {
		return rethrow(e);
	}
}

export async function getVersion(id: string): Promise<MaterialVersion | null> {
	try {
		return mapMaterialVersion(
			await apiClient.get<RawMaterialVersion>(`/material-versions/${encodeURIComponent(id)}/`)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/**
 * Publish a draft. Comes back `published` normally — or `proposed`, when this is the project's
 * first publication and the publisher cannot auto-publish: the version goes to the moderation
 * queue instead, and the caller reads `status` rather than assuming.
 */
export async function publishVersion(id: string): Promise<MaterialVersion> {
	try {
		return mapMaterialVersion(
			await apiClient.post<RawMaterialVersion>(
				`/material-versions/${encodeURIComponent(id)}/publish/`,
				{}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Accept or reject a proposal. A rejection must carry a note — the server refuses one without
 *  (`note_required`), and `VersionDecision` disables the button until there is one. */
export async function decideVersion(
	id: string,
	decision: 'accept' | 'reject',
	note = ''
): Promise<MaterialVersion> {
	try {
		return mapMaterialVersion(
			await apiClient.post<RawMaterialVersion>(
				`/material-versions/${encodeURIComponent(id)}/decide/`,
				{ decision, note }
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Take back your own proposal. The row survives as `withdrawn`; only the file blob is reclaimed. */
export async function withdrawVersion(id: string): Promise<MaterialVersion> {
	try {
		return mapMaterialVersion(
			await apiClient.post<RawMaterialVersion>(
				`/material-versions/${encodeURIComponent(id)}/withdraw/`,
				{}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- the review thread on one version ----------------------------------------------------------
 * Its own pair of functions rather than `services/comments.ts`'s `targetPath`: the endpoint is this
 * app's (COAUTHORING-BRIEF.md §5) and its visibility follows `can_view_version`, which is a rule no
 * other comment target has. `targetPath` over there knows the same path — it is the generic route
 * for anything that resolves a target by name — but the version page reaches a thread it has
 * already loaded a version for, and everything around these two in this file already speaks this
 * app's errors. */

const VERSION_TARGET: CommentTargetType = 'materialVersion';

export async function listVersionComments(versionId: string): Promise<Comment[]> {
	const raw = await apiClient.get<RawComment[]>(
		`/material-versions/${encodeURIComponent(versionId)}/comments/`
	);
	return raw.map((c) => mapComment(c, VERSION_TARGET, versionId));
}

export async function postVersionComment(
	versionId: string,
	body: string,
	parentId?: string
): Promise<Comment> {
	const raw = await apiClient.post<RawComment>(
		`/material-versions/${encodeURIComponent(versionId)}/comments/`,
		{ body, parent: parentId ? Number(parentId) : undefined }
	);
	return mapComment(raw, VERSION_TARGET, versionId);
}

/* --- members ---------------------------------------------------------------------------------- */

export async function listMembers(projectId: string): Promise<ProjectMember[]> {
	const rows = await apiClient.get<RawProjectMember[]>(
		`/material-projects/${encodeURIComponent(projectId)}/members/`
	);
	return rows.map(mapProjectMember);
}

/** By account id, because this app has no people search — the invite link is the ergonomic path
 *  and this is the deliberate manual one (COAUTHORING-BRIEF.md §9). Refuses `minor` and
 *  `already_member`. */
export async function addMember(projectId: string, userId: string): Promise<ProjectMember> {
	try {
		return mapProjectMember(
			await apiClient.post<RawProjectMember>(
				`/material-projects/${encodeURIComponent(projectId)}/members/`,
				{ user_id: Number(userId) }
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Remove somebody, or leave yourself — the same endpoint, since to the server they are the same
 *  row. The owner cannot be removed (`owner_immutable`); transferring is how that changes. */
export async function removeMember(projectId: string, userId: string): Promise<void> {
	try {
		await apiClient.delete<void>(
			`/material-projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}/`
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Hand the project over. Never something an invite link can do — transferring is a decision about
 *  a named person (the `InviteRole` precedent). */
export async function transferOwnership(
	projectId: string,
	userId: string
): Promise<MaterialProject> {
	try {
		return mapMaterialProject(
			await apiClient.post<RawMaterialProject>(
				`/material-projects/${encodeURIComponent(projectId)}/transfer/`,
				{ user_id: Number(userId) }
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- invites ---------------------------------------------------------------------------------- */

export async function listInvites(projectId: string): Promise<ProjectInvite[]> {
	const rows = await apiClient.get<RawProjectInvite[]>(
		`/material-projects/${encodeURIComponent(projectId)}/invites/`
	);
	return rows.map(mapProjectInvite);
}

export async function createInvite(
	projectId: string,
	draft: ProjectInviteDraft = {}
): Promise<ProjectInvite> {
	try {
		return mapProjectInvite(
			await apiClient.post<RawProjectInvite>(
				`/material-projects/${encodeURIComponent(projectId)}/invites/`,
				{
					label: draft.label ?? '',
					max_uses: draft.maxUses ?? 0,
					expires_at: draft.expiresAt || null
				}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Revoke stamps a time on the row; it never deletes it (house rule 12 — who invited whom, and
 *  whether it was taken back, is part of the trust model). */
export async function revokeInvite(projectId: string, inviteId: string): Promise<void> {
	await apiClient.delete<void>(
		`/material-projects/${encodeURIComponent(projectId)}/invites/${encodeURIComponent(inviteId)}/`
	);
}

/** Readable signed out, deliberately: somebody sent this to a person who may not have an account,
 *  and telling them to sign up without saying what for is how an invite gets ignored. Null for a
 *  token nobody has ever minted. */
export async function getInvitePreview(token: string): Promise<ProjectInvitePreview | null> {
	try {
		return mapProjectInvitePreview(
			await apiClient.get<RawProjectInvitePreview>(`/project-invites/${encodeURIComponent(token)}/`)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/** Refuses with `revoked` / `expired` / `used_up` / `minor` / `already_member` — five refusals,
 *  five sentences. */
export async function acceptInvite(token: string): Promise<MaterialProject> {
	try {
		return mapMaterialProject(
			await apiClient.post<RawMaterialProject>(
				`/project-invites/${encodeURIComponent(token)}/accept/`,
				{}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- join requests ---------------------------------------------------------------------------- */

/** The pending ones, for a member. */
export async function listJoinRequests(projectId: string): Promise<ProjectJoinRequest[]> {
	const rows = await apiClient.get<RawProjectJoinRequest[]>(
		`/material-projects/${encodeURIComponent(projectId)}/join-requests/`
	);
	return rows.map(mapProjectJoinRequest);
}

export async function createJoinRequest(
	projectId: string,
	statement: string
): Promise<ProjectJoinRequest> {
	try {
		return mapProjectJoinRequest(
			await apiClient.post<RawProjectJoinRequest>(
				`/material-projects/${encodeURIComponent(projectId)}/join-requests/`,
				{ statement }
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Accept or decline. A decline needs a note, the same rule a rejected version follows. */
export async function decideJoinRequest(
	id: string,
	decision: 'accept' | 'decline',
	note = ''
): Promise<ProjectJoinRequest> {
	try {
		return mapProjectJoinRequest(
			await apiClient.post<RawProjectJoinRequest>(
				`/project-join-requests/${encodeURIComponent(id)}/decide/`,
				{ decision, note }
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

export async function withdrawJoinRequest(id: string): Promise<ProjectJoinRequest> {
	try {
		return mapProjectJoinRequest(
			await apiClient.post<RawProjectJoinRequest>(
				`/project-join-requests/${encodeURIComponent(id)}/withdraw/`,
				{}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}
