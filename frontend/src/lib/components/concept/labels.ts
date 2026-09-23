// The label maps for the concepts app's closed enums, and the one place a refusal reason becomes a
// sentence.
//
// These mirror `backend/concepts/models.py`, `backend/concepts/blocks.py` and
// `backend/concepts/access.py` — the unions themselves live in `lib/types/concept.ts`, which names
// the same backend files (house rule 13: say it in both places, because that is where drift creeps
// in).
//
// Deliberately NOT in `lib/utils/labels.ts`, where this project's cross-surface backend-enum
// mirrors live: these are used by this folder and its routes only, and putting them beside their
// components keeps the shared file from growing a section per feature. The `coauthoring/labels.ts`
// precedent, for the same reason.

import { m } from '$lib/paraglide/messages.js';
import {
	ConceptConflictError,
	ConceptRefusedError,
	DraftExistsError,
	StaleRevisionError
} from '$lib/services/concepts';
import type { FeatureFlagKey } from '$lib/types';
import type {
	ConceptBlockKind,
	ConceptLinkBlockReason,
	ConceptRelation,
	ConceptRevisionStatus
} from '$lib/types/concept';

/**
 * The kill switch this whole surface hangs off (CONCEPTS-BRIEF.md §0). Named once here rather than
 * spelled as a literal at every `isEnabled(...)`/`FeatureGate` call site, so the union in
 * `types/featureFlag.ts` is what actually checks those call sites.
 */
export const CONCEPTS_FLAG: FeatureFlagKey = 'concepts';

export const REVISION_STATUS_LABELS: Record<ConceptRevisionStatus, () => string> = {
	draft: m.concept_status_draft, // "Draft"
	pending: m.concept_status_pending, // "Waiting"
	published: m.concept_status_published, // "Published"
	superseded: m.concept_status_superseded, // "Superseded"
	rejected: m.concept_status_rejected, // "Rejected"
	withdrawn: m.concept_status_withdrawn // "Withdrawn"
};

export const BLOCK_KIND_LABELS: Record<ConceptBlockKind, () => string> = {
	markdown: m.concept_block_markdown, // "Text"
	latex: m.concept_block_latex, // "Formula"
	chem: m.concept_block_chem, // "Chemistry"
	pdf: m.concept_block_pdf, // "PDF"
	image: m.concept_block_image // "Picture"
};

/** The order the "Add block" menu offers them in — text first, because most blocks are text. */
export const BLOCK_KINDS: ConceptBlockKind[] = ['markdown', 'latex', 'chem', 'pdf', 'image'];

export const RELATION_LABELS: Record<ConceptRelation, () => string> = {
	related: m.concept_relation_related, // "Related"
	prerequisite: m.concept_relation_prerequisite // "Know this first"
};

/** Why this person cannot add a link. Two reasons, two sentences — "sign in" and "an account
 *  belonging to someone under 18 cannot do this" are the same refusal to a boolean and completely
 *  different to a person (house rule 6). */
export const LINK_BLOCK_LABELS: Record<ConceptLinkBlockReason, () => string> = {
	authentication_required: m.concept_linkBlock_authentication_required, // "Sign in to link something here."
	minor: m.concept_linkBlock_minor // "An account belonging to someone under 18 cannot add links."
};

/**
 * Every refusal reason the API can answer a write with, as one sentence. One lookup rather than a
 * `catch` per call site that picks its own wording: the same `minor` comes back from creating a
 * link and from several other endpoints, and two phrasings of it would read as two rules.
 */
const REFUSAL_LABELS: Record<string, () => string> = {
	...LINK_BLOCK_LABELS,
	minor: m.concept_error_minor, // "An account belonging to someone under 18 cannot do this."
	note_required: m.concept_error_note_required, // "A refusal needs a note saying why."
	already_decided: m.concept_error_already_decided, // "Somebody decided this a moment before you did."
	not_draft: m.concept_error_not_draft, // "This is not a draft any more, so it cannot be edited."
	already_linked: m.concept_error_already_linked, // "That is already linked here."
	self: m.concept_error_self, // "A concept cannot be linked to itself."
	relation: m.concept_error_relation, // "“Know this first” only makes sense between two concepts."
	body_origin: m.concept_error_body_origin, // "This link comes from the text itself — remove the [[mention]] to remove the link."
	quota: m.concept_error_quota // "You have used up your upload allowance."
};

/** The sentence for a reason, or the honest generic one for a reason nobody has written a sentence
 *  for yet — never the raw wire value, which is English either way and not a sentence. */
export function refusalMessage(reason: string | null | undefined): string {
	if (reason && REFUSAL_LABELS[reason]) return REFUSAL_LABELS[reason]();
	return m.common_error_generic(); // "Something went wrong."
}

/**
 * The sentence for whatever a write threw. Every panel here catches the same shapes — a refusal
 * carrying its reason, a 409 carrying what already happened, the two structured 409s, and
 * everything else — so this is the one `catch` body worth writing once.
 *
 * `StaleRevisionError` and `DraftExistsError` are handled by the editor itself (each has a whole
 * dialogue, not a line), and reach this only when something else catches them by accident; they
 * still get their own sentence rather than the generic one.
 */
export function messageForError(error: unknown): string {
	if (error instanceof StaleRevisionError) return m.concept_editor_staleShort(); // "Somebody published a newer version while you were writing."
	if (error instanceof DraftExistsError) return m.concept_editor_draftExistsShort(); // "You already have an unfinished revision of this article."
	if (error instanceof ConceptRefusedError || error instanceof ConceptConflictError) {
		return refusalMessage(error.reason);
	}
	return m.common_error_generic(); // "Something went wrong."
}

/** A byte count as something a person reads. Kept here rather than in `utils/` on the three-strikes
 *  rule: this is the second surface that wants one, and the material page formats its own. */
export function formatBytes(bytes: number): string {
	if (bytes <= 0) return '';
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return m.concept_size_mb({ size: mb.toFixed(1) }); // "{size} MB"
	return m.concept_size_kb({ size: Math.max(1, Math.round(bytes / 1024)) }); // "{size} kB"
}
