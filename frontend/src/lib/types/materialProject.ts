// Co-authoring: a material's project, its team, and the immutable versions it publishes
// (backend/coauthoring/models.py; COAUTHORING-BRIEF.md §1 and §5).
//
// The shape to hold on to: the `Material` row stays the PUBLISHED PROJECTION. A project owns the
// history, publishing a version copies its payload onto the material, and every existing read site
// (listings, courses, galleries, reports, activity) keeps working without knowing any of this
// exists. Nothing here replaces `Material`; it explains where a material's current bytes came from.
//
// Every string union below mirrors `backend/coauthoring/models.py` exactly (house rule 13 — the
// label maps that go with them live in `lib/components/coauthoring/labels.ts`, which names this
// file in turn). There is deliberately no `approved` anywhere: the positive terminal state is what
// the row IS, `published`.

import type { Audience } from './audience';
import type { ClaimKind } from './material';
import type { MaterialType } from './material';

/** `draft` and `published` are the only two a reader can ever be pointed at; `proposed` is waiting
 *  for the team (or staff, for a first publication), and the last three are terminal history. */
export type MaterialVersionStatus =
	'draft' | 'proposed' | 'published' | 'superseded' | 'rejected' | 'withdrawn';

/** Exactly one payload per version — the backend enforces it in `clean()` and the serializer
 *  rather than as a DB constraint, because a rejected file version has its blob reclaimed and must
 *  stay a valid row (COAUTHORING-BRIEF.md §2). */
export type MaterialVersionKind = 'file' | 'link' | 'body';

export type ProjectMemberRole = 'owner' | 'coauthor';

export type JoinRequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

/** The honest three-way answer `materials/validators.py`'s `scan_for_malware` gives: an unreachable
 *  scanner says `skipped`, never "clean" (root CLAUDE.md house rule 10). */
export type VersionScanStatus = 'skipped' | 'clean' | 'flagged';

/** Why this person cannot propose a new version — a reason, never a boolean, so the refusal can
 *  say which of five completely different things happened (house rule 6). */
export type ProposeBlockReason =
	| 'authentication_required'
	| 'member'
	| 'not_published'
	| 'removed'
	| 'pending_exists'
	// The project's contribution policy (materials_coop/): `request` says "ask to join instead",
	// `closed` says the team is not taking anyone.
	| 'members_only'
	| 'closed';

/** Why this person cannot ask to join. `minor` is a rule, not a rejection: a minor may still
 *  propose a version, because a person always reads a proposal (COAUTHORING-BRIEF.md §0). */
export type JoinBlockReason =
	| 'authentication_required'
	| 'not_seeking'
	| 'member'
	| 'minor'
	| 'pending_exists'
	| 'published'
	// A published project whose policy is `closed` (materials_coop/). Under `request` a published
	// project takes applications, so the reason is simply null there.
	| 'closed';

/** Why an invite link will not work — the same three `CourseInvite` already distinguishes, for the
 *  same reason: "expired" and "already used up" are different to the person holding the link. */
export type ProjectInviteUnusableReason = 'revoked' | 'expired' | 'used_up';

/** Every refusal an invite acceptance can come back with: the three link states above, plus the
 *  two that are about the person rather than the link. */
export type InviteAcceptBlockReason = ProjectInviteUnusableReason | 'minor' | 'already_member';

/** One coverage claim carried on a DRAFTING project's catalogue — a flat `{topic, level, kind}`
 *  triple, not the full votable `MaterialCoverage` row, which only exists once the material does. */
export interface ProjectCoverageDraft {
	topicId: string;
	level: number; // 1-100
	kind: ClaimKind;
}

/** A team member. Named by account id and display name only — this app has no people search, so
 *  adding somebody by hand means knowing their numeric id (COAUTHORING-BRIEF.md §9). */
export interface ProjectMember {
	userId: string;
	displayName: string;
	role: ProjectMemberRole;
	addedAt: string;
}

/** The short form of a version, as it rides on a project and in history lists. Enough to draw a
 *  row and a download link, not enough to review one. */
export interface MaterialVersionSummary {
	id: string;
	number: number;
	status: MaterialVersionStatus;
	kind: MaterialVersionKind;
	title: string;
	changeNote: string;
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	publishedAt: string | null;
	fileUrl: string;
	fileName: string;
	url: string;
	scanStatus: VersionScanStatus;
}

/** One version in full — what the version page and the editor's stale-save notice render.
 *
 *  `canPublish`/`canDecide`/`canWithdraw` are the server's answers, never re-derived here: the
 *  deciding circle differs per state (member / staff / material governor / branch governor), and a
 *  frontend that guessed it would be drawing buttons that 403. */
export interface MaterialVersion {
	id: string;
	projectId: string;
	/** Null until the project's first publication materialises a `Material` row. */
	materialId: string | null;
	number: number;
	status: MaterialVersionStatus;
	kind: MaterialVersionKind;
	fileUrl: string;
	fileName: string;
	url: string;
	body: string;
	title: string;
	description: string;
	changeNote: string;
	/** The version this one was written against. A save whose `basedOn` is no longer the head is
	 *  refused with 409 `stale` — collaboration here is turn-based, by design. */
	basedOnId: string | null;
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	decidedByUserId: string | null;
	decidedByDisplayName: string;
	decidedAt: string | null;
	decisionNote: string;
	publishedAt: string | null;
	scanStatus: VersionScanStatus;
	scanDetail: string;
	/** Recorded at upload. The per-account quota still sums live; this is what the row remembers. */
	fileSize: number;
	commentCount: number;
	canPublish: boolean;
	canDecide: boolean;
	canWithdraw: boolean;
}

/** A material's project: the catalogue, the team, and the two versions that matter.
 *
 *  `headVersion` is the highest-numbered `draft` or `published` row; for anybody who is not a
 *  member it is the published one, which is the whole of what they can see. **Before the first
 *  publication it can also be a `proposed` row** — that is a queued first publication, which is
 *  what the submit form's answer reports and what gives such a project a name at all (a stranger
 *  cannot propose against a project that has published nothing, so `proposed` there can only mean
 *  "somebody pressed Publish and it went to the queue"). */
export interface MaterialProject {
	id: string;
	/** Null while the project is still a draft that has never published anything. */
	materialId: string | null;
	branchId: string; // the backend slug, as everywhere else in this app
	branchName: string;
	/** The language the versions' title/description are written in — not the reader's interface
	 *  language, and not a translation workflow (COAUTHORING-BRIEF.md §9). */
	locale: string;
	type: MaterialType;
	audience: Audience;
	author: string;
	sourceUrl: string;
	priceAmount?: number;
	priceCurrency: string;
	estimatedMinutes?: number;
	requirements: string[];
	coverage: ProjectCoverageDraft[];
	seekingCoauthors: boolean;
	seekingNote: string;
	createdByUserId: string | null;
	createdAt: string;
	/** From the head version, so a project row can be drawn without loading its versions. */
	title: string;
	description: string;
	publishedVersion: MaterialVersionSummary | null;
	headVersion: MaterialVersionSummary | null;
	members: ProjectMember[];
	memberCount: number;
	myRole: ProjectMemberRole | null;
	canEdit: boolean;
	canManage: boolean;
	canPropose: boolean;
	proposeBlockReason: ProposeBlockReason | null;
	joinBlockReason: JoinBlockReason | null;
	/** Members only; 0 for everybody else — the count is itself private information. */
	pendingProposalsCount: number;
	/** Managers only; 0 for everybody else. */
	pendingJoinRequestsCount: number;
}

/**
 * What a stranger sees of a draft project that is looking for co-authors.
 *
 * Deliberately the SAME shape rather than a narrower one: the endpoint answers with the same key
 * set and simply leaves the private halves empty (`publishedVersion`/`headVersion` null, members
 * as display names with no ids, `myRole` null, every `can*` false), so the mapper cannot tell the
 * two apart and neither could a separate interface. The name exists to say, at a call site, which
 * of the two a variable is expected to hold.
 */
export type MaterialProjectTeaser = MaterialProject;

/** An invite link. `urlPath` is what the server suggests; the panel still builds the absolute URL
 *  from the address the person is actually looking at (the CourseInvites precedent — the server
 *  has no reliable idea which public origin a browser reached it on). */
export interface ProjectInvite {
	id: string;
	token: string;
	urlPath: string;
	label: string;
	/** 0 means unlimited. */
	maxUses: number;
	uses: number;
	expiresAt: string | null;
	/** Revoking stamps a time; it never deletes the row (house rule 12). */
	revokedAt: string | null;
	createdAt: string;
	isUsable: boolean;
	unusableReason: ProjectInviteUnusableReason | null;
}

/** What somebody holding a link is told before they act on it, and before they have logged in.
 *  Thin on purpose: an invite token travels through group chats. */
export interface ProjectInvitePreview {
	projectId: string;
	materialId: string | null;
	title: string;
	branchName: string;
	createdByDisplayName: string;
	isUsable: boolean;
	unusableReason: ProjectInviteUnusableReason | null;
}

/** Asking to join a project that says it is looking for people. `statement` is ≥ 20 characters,
 *  the same bar `GovernorApplication` sets, for the same reason: it is read by a person. */
export interface ProjectJoinRequest {
	id: string;
	projectId: string;
	userId: string;
	displayName: string;
	statement: string;
	status: JoinRequestStatus;
	decidedByUserId: string | null;
	decidedAt: string | null;
	decisionNote: string;
	createdAt: string;
}

/**
 * One row of the moderation queue's `material_versions` section — a proposed version of a project
 * that needs staff review (a first publication, or a proposal on an orphan project).
 *
 * Carries the catalogue as well as the payload because for a first publication there is no
 * `Material` to read it from yet: the reviewer is deciding whether this becomes one.
 */
export interface MaterialVersionQueueRow {
	id: string;
	projectId: string;
	number: number;
	kind: MaterialVersionKind;
	title: string;
	description: string;
	fileUrl: string;
	fileName: string;
	url: string;
	/** 200 characters with the tags stripped — the body is Markdown+HTML and a queue row is a row. */
	bodyExcerpt: string;
	scanStatus: VersionScanStatus;
	scanDetail: string;
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	branchId: string;
	branchName: string;
	type: MaterialType;
	author: string;
	sourceUrl: string;
	requirements: string[];
	coverage: ProjectCoverageDraft[];
	priceAmount?: number;
	priceCurrency: string;
	estimatedMinutes?: number;
	audience: Audience;
	isFirstPublication: boolean;
}

/** The catalogue half of a project — what `CatalogueForm` edits, and half of what creating one
 *  sends. Every field optional on a PATCH; `branchId`/`locale` are create-only (a project's branch
 *  is not something a later edit moves). */
export interface ProjectCatalogueDraft {
	type: MaterialType;
	audience: Audience;
	author?: string;
	sourceUrl?: string;
	priceAmount?: number;
	priceCurrency?: string;
	estimatedMinutes?: number;
	requirements?: string[];
	coverage?: ProjectCoverageDraft[];
	seekingCoauthors?: boolean;
	seekingNote?: string;
}

/** The payload half — one version's content. `file` travels separately, as a real `File` in a
 *  multipart body, because it does not fit a typed JSON draft. */
export interface VersionDraft {
	kind: MaterialVersionKind;
	title: string;
	description?: string;
	url?: string;
	body?: string;
	changeNote?: string;
	/** The version this was written against — omitted only when the project has none yet. */
	basedOnId?: string;
}

/** Creating a project: branch + locale + the catalogue + version 1, in one request. */
export interface MaterialProjectDraft extends ProjectCatalogueDraft {
	branchId: string;
	locale: string;
	version: VersionDraft;
}

/** What `CatalogueForm` answers with: the catalogue plus the two fields only a brand-new project
 *  carries. `branchId` is empty when the form is editing one that already exists — a project's
 *  branch is not something a later edit moves. */
export interface ProjectCatalogueResult extends ProjectCatalogueDraft {
	branchId: string;
	locale: string;
}

/** What `InvitesPanel` sends to mint a link. */
export interface ProjectInviteDraft {
	label?: string;
	/** 0 (the default) means unlimited. */
	maxUses?: number;
	expiresAt?: string | null;
}
