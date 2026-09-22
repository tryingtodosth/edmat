// The label maps for co-authoring's closed enums, and the one place a refusal reason becomes a
// sentence.
//
// These mirror `backend/coauthoring/models.py` and `backend/coauthoring/access.py` — the unions
// themselves live in `lib/types/materialProject.ts`, which names the same backend file (house rule
// 13: say it in both places, because that is where drift creeps in).
//
// Deliberately NOT in `lib/utils/labels.ts`, where this project's other backend-enum mirrors live:
// these are used by this folder only, and putting them beside their components keeps the shared
// file from growing a section per feature. If a surface outside `components/coauthoring/` ever
// needs one, moving it there is the right answer — that is what "three strikes" means.

import { m } from '$lib/paraglide/messages.js';
import { ProjectRefusedError, VersionConflictError } from '$lib/services/materialProjects';
import type { FeatureFlagKey } from '$lib/types';
import type {
	JoinBlockReason,
	JoinRequestStatus,
	MaterialVersionKind,
	MaterialVersionStatus,
	ProjectMemberRole,
	ProposeBlockReason
} from '$lib/types/materialProject';

/**
 * The kill switch this whole surface hangs off (COAUTHORING-BRIEF.md §0: `coauthoring` gates
 * collaborating on an existing material; `material_submissions` keeps gating creating a new one).
 *
 * Named once here rather than spelled as a literal at every `isEnabled(...)` call site, so the
 * union in `types/featureFlag.ts` — which the flag's own three-file rule keeps in step with the
 * backend choices and `utils/labels.ts` — is what actually checks these call sites.
 */
export const COAUTHORING_FLAG: FeatureFlagKey = 'coauthoring';

export const VERSION_STATUS_LABELS: Record<MaterialVersionStatus, () => string> = {
	draft: m.coauth_status_draft, // "Draft"
	proposed: m.coauth_status_proposed, // "Proposed"
	published: m.coauth_status_published, // "Published"
	superseded: m.coauth_status_superseded, // "Superseded"
	rejected: m.coauth_status_rejected, // "Rejected"
	withdrawn: m.coauth_status_withdrawn // "Withdrawn"
};

export const VERSION_KIND_LABELS: Record<MaterialVersionKind, () => string> = {
	file: m.coauth_kind_file, // "File"
	link: m.coauth_kind_link, // "Link"
	body: m.coauth_kind_body // "Written here"
};

export const MEMBER_ROLE_LABELS: Record<ProjectMemberRole, () => string> = {
	owner: m.coauth_role_owner, // "Owner"
	coauthor: m.coauth_role_coauthor // "Co-author"
};

export const JOIN_STATUS_LABELS: Record<JoinRequestStatus, () => string> = {
	pending: m.coauth_joinStatus_pending, // "Waiting"
	accepted: m.coauth_joinStatus_accepted, // "Accepted"
	declined: m.coauth_joinStatus_declined, // "Declined"
	withdrawn: m.coauth_joinStatus_withdrawn // "Withdrawn"
};

/** Why this person cannot propose a change. Five reasons, five sentences — "you are already a
 *  co-author" and "somebody took this material down" are the same refusal to a boolean and
 *  completely different to a person (house rule 6). */
export const PROPOSE_BLOCK_LABELS: Record<ProposeBlockReason, () => string> = {
	authentication_required: m.coauth_block_authentication_required, // "Sign in to propose a change."
	member: m.coauth_block_member, // "You are a co-author here, so edit the material instead of proposing a change to it."
	not_published: m.coauth_block_not_published, // "Nothing has been published here yet, so there is nothing to improve."
	removed: m.coauth_block_removed, // "This material was taken down, so it cannot be changed."
	pending_exists: m.coauth_block_pending_exists // "Your earlier proposal is still waiting for a decision."
};

export const JOIN_BLOCK_LABELS: Record<JoinBlockReason, () => string> = {
	authentication_required: m.coauth_joinBlock_authentication_required, // "Sign in to ask to join."
	not_seeking: m.coauth_joinBlock_not_seeking, // "This project is not looking for co-authors."
	member: m.coauth_joinBlock_member, // "You are already a co-author here."
	minor: m.coauth_joinBlock_minor, // "An account belonging to someone under 18 cannot join a project. …"
	pending_exists: m.coauth_joinBlock_pending_exists, // "You have already asked, and nobody has decided yet."
	published: m.coauth_joinBlock_published // "This material is already published, so it takes improvements rather than co-authors."
};

/**
 * Every refusal reason the API can answer a write with, as one sentence.
 *
 * One lookup rather than a `catch` per call site that picks its own wording: the same `minor` comes
 * back from creating a project, adding a member, accepting an invite and asking to join, and four
 * different phrasings of it would read as four different rules.
 */
const REFUSAL_LABELS: Record<string, () => string> = {
	...PROPOSE_BLOCK_LABELS,
	...JOIN_BLOCK_LABELS,
	minor: m.coauth_error_minor, // "An account belonging to someone under 18 cannot do this."
	already_member: m.coauth_error_already_member, // "That person is already a co-author."
	owner_immutable: m.coauth_error_owner_immutable, // "The owner cannot be removed — hand the project over first."
	note_required: m.coauth_error_note_required, // "A refusal needs a note saying why."
	already_decided: m.coauth_error_already_decided, // "Somebody decided this a moment before you did."
	not_draft: m.coauth_error_not_draft, // "This version is not a draft any more."
	not_proposed: m.coauth_error_not_proposed, // "This version is no longer waiting for a decision."
	revoked: m.coauth_inviteReason_revoked, // "This link was revoked."
	expired: m.coauth_inviteReason_expired, // "This link has expired."
	used_up: m.coauth_inviteReason_used_up // "This link has been used as many times as it allows."
};
// One sentence per reason, deliberately not one per (reason, surface): `minor` comes back from four
// different endpoints, and four phrasings of it would read as four different rules.

/** The sentence for a reason, or the honest generic one for a reason nobody has written a sentence
 *  for yet — never the raw wire value, which is English either way and not a sentence. */
export function refusalMessage(reason: string | null | undefined): string {
	if (reason && REFUSAL_LABELS[reason]) return REFUSAL_LABELS[reason]();
	return m.common_error_generic(); // "Something went wrong."
}

/**
 * The sentence for whatever a write threw. Every panel here catches the same three shapes — a
 * refusal carrying its reason, a 409 carrying what already happened, and everything else — so this
 * is the one `catch` body worth writing once.
 */
export function messageForError(error: unknown): string {
	if (error instanceof ProjectRefusedError || error instanceof VersionConflictError) {
		return refusalMessage(error.reason);
	}
	return m.common_error_generic(); // "Something went wrong."
}

/** True for a file this app should preview as a picture. `.webp` is in the list because it is what
 *  every uploaded picture is STORED as — the pipeline re-encodes (house rule 7). */
export function isPictureUrl(url: string): boolean {
	return /\.(png|jpe?g|webp|gif)($|\?)/i.test(url);
}

export function isPdfUrl(url: string): boolean {
	return /\.pdf($|\?)/i.test(url);
}
