// Concepts (pojęcia) — wiki-like pages for the things exercises and materials are ABOUT
// (backend/concepts/models.py; CONCEPTS-BRIEF.md §1, §2 and §5).
//
// The shape to hold on to, because nothing else in this app is built quite this way:
//
//   Concept          one language-neutral node with a slug. No title, no text, no audience.
//   └ ConceptArticle written for one (audience, locale). SEVERAL articles may share one
//                    (audience, locale) — they are peers, the way hints and solutions are a pool
//                    on an exercise, not one page several people fight over.
//     └ ConceptRevision  immutable once submitted, numbered per article, exactly one `published`.
//
// A "page" is one (audience, locale) — not a table, the key the articles share. The detail
// endpoint resolves which page a reader is shown (`resolve.py`) and says, in `audienceExact` /
// `localeExact`, whether it had to fall back; a concept page never 404s while any article is
// published, because a shared link must resolve.
//
// Every string union below mirrors `backend/concepts/models.py` and `backend/concepts/blocks.py`
// exactly (house rule 13 — the label maps that go with them live in
// `lib/components/concept/labels.ts`, which names this file in turn). There is deliberately no
// `approved` anywhere: the positive terminal state is what the row IS, `published`.

import type { Audience } from './audience';

/** `draft` is private and mutable and is the one row that may be hard-deleted; everything after a
 *  submit is immutable and kept (house rule 12). */
export type ConceptRevisionStatus =
	'draft' | 'pending' | 'published' | 'superseded' | 'rejected' | 'withdrawn';

export type ConceptBlockKind = 'markdown' | 'latex' | 'chem' | 'pdf' | 'image';

export type ConceptAssetKind = 'image' | 'pdf';

/** `prerequisite` ("know this first") is legal only for a concept target — the backend refuses it
 *  on an exercise or a material with 400 `relation`. */
export type ConceptRelation = 'related' | 'prerequisite';

/** Where a link came from. `body` rows are harvested from `[[slug]]` mentions on every publish and
 *  cannot be removed by hand; only `manual` rows have a remove button. */
export type ConceptLinkOrigin = 'manual' | 'body';

export type ConceptLinkTargetType = 'exercise' | 'material' | 'concept';

/** Why this person cannot add a link — a reason, never a boolean (house rule 6). */
export type ConceptLinkBlockReason = 'authentication_required' | 'minor';

/* --- blocks ------------------------------------------------------------------------------------
 * An article's content is an ORDERED LIST OF BLOCKS, each edited with the UI this app already has
 * for that kind of thing. `blocks.py` is the one place that says what a block may be; this union
 * is its mirror. The READ shape carries the two expansions the backend adds (`drawing`, `asset`),
 * which the write shape must not send back — `toRawConceptBlocks` in `lib/api/mappers.ts` strips
 * them. */

/** A chemistry drawing (`chem.ChemDrawing`), expanded for reading. */
export interface ConceptBlockDrawing {
	imageUrl: string;
	label: string;
	width: number;
	height: number;
	sourceFormat: string;
}

/** A `ConceptAsset` expanded onto a `pdf` / `image` block for reading. */
export interface ConceptBlockAsset {
	url: string;
	originalName: string;
	sizeBytes: number;
	width: number;
	height: number;
}

/** A paragraph: Markdown with raw HTML and literal LaTeX delimiters, exactly like every other
 *  content field in this app. Inline maths, inline pictures and inline chemistry stay allowed
 *  inside one — a picture as its own block is a different thing from a picture in a sentence. */
export interface ConceptMarkdownBlock {
	kind: 'markdown';
	body: string;
}

/** One display formula. Stored raw and rendered client-side as `\[ … \]`, so no HTML is possible
 *  in it at all. */
export interface ConceptLatexBlock {
	kind: 'latex';
	source: string;
}

export interface ConceptChemBlock {
	kind: 'chem';
	drawingId: string;
	caption: string;
	/** Read shape only. */
	drawing?: ConceptBlockDrawing;
}

export interface ConceptPdfBlock {
	kind: 'pdf';
	assetId: string;
	caption: string;
	/** Read shape only. */
	asset?: ConceptBlockAsset;
}

export interface ConceptImageBlock {
	kind: 'image';
	assetId: string;
	/** Required by the editor: a picture with no description is a picture some readers never get. */
	alt: string;
	caption: string;
	/** Read shape only. */
	asset?: ConceptBlockAsset;
}

export type ConceptBlock =
	ConceptMarkdownBlock | ConceptLatexBlock | ConceptChemBlock | ConceptPdfBlock | ConceptImageBlock;

/** A picture or a PDF placed as a block. Never the bytes that were uploaded (house rule 7): the
 *  file is re-encoded / sniffed / scanned by the same pipeline a comment attachment gets. There is
 *  no delete endpoint — a block in a published revision must keep resolving. */
export interface ConceptAsset {
	id: string;
	kind: ConceptAssetKind;
	url: string;
	originalName: string;
	sizeBytes: number;
	width: number;
	height: number;
}

/* --- revisions --------------------------------------------------------------------------------- */

/** The short form, as it rides in a history list and in a stale-save refusal. Enough to draw a row,
 *  not enough to read the article. */
export interface ConceptRevisionSummary {
	id: string;
	articleId: string;
	number: number;
	status: ConceptRevisionStatus;
	title: string;
	changeNote: string;
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	publishedAt: string | null;
}

/** One revision in full — what the history page renders and what the editor prefills from.
 *
 *  The four `can*` answers are the server's, never re-derived here: the deciding circle is staff,
 *  a governor of any of the concept's branches, OR the article's own author, and a frontend that
 *  guessed it would be drawing buttons that 403. */
export interface ConceptRevision {
	id: string;
	articleId: string;
	conceptId: string;
	slug: string;
	audience: Audience;
	locale: string;
	number: number;
	status: ConceptRevisionStatus;
	title: string;
	summary: string;
	blocks: ConceptBlock[];
	changeNote: string;
	/** The head this was written against — null for revision 1. A submit whose `basedOnId` is no
	 *  longer the head is refused with 409 `stale`: collaboration here is turn-based, by design. */
	basedOnId: string | null;
	/** Whether that basis is still the article's head. What the queue row carries, so a reviewer
	 *  knows whether the diff they are reading is against what is live. */
	basedOnIsCurrent: boolean;
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	updatedAt: string;
	submittedAt: string | null;
	reviewedByUserId: string | null;
	reviewedByDisplayName: string;
	reviewedAt: string | null;
	reviewNote: string;
	publishedAt: string | null;
	/** Whether submitting this would publish it outright rather than queue it. */
	willPublish: boolean;
	canSubmit: boolean;
	canDecide: boolean;
	canWithdraw: boolean;
	canDelete: boolean;
}

/* --- articles ---------------------------------------------------------------------------------- */

/** One article as it appears in a pool list. */
export interface ConceptArticleSummary {
	id: string;
	audience: Audience;
	locale: string;
	/** Staff/governor: first in the page's pool (the `SolutionEntry` precedent). */
	pinned: boolean;
	title: string;
	summary: string;
	createdByUserId: string | null;
	createdByDisplayName: string;
	headPublishedAt: string | null;
	revisionCount: number;
	commentCount: number;
}

/** One article in full — the summary plus its head revision and this caller's standing on it. */
export interface ConceptArticle extends ConceptArticleSummary {
	conceptId: string;
	slug: string;
	/** The one `published` revision. Null for an article whose only revisions are still waiting —
	 *  which only its author, a reviewer and staff can see at all. */
	head: ConceptRevision | null;
	/** The caller's own draft or pending revision of this article, when they have one. */
	myOpen: ConceptRevisionSummary | null;
	canReview: boolean;
	canPin: boolean;
	willPublish: boolean;
}

/* --- concepts ---------------------------------------------------------------------------------- */

/** One (audience, locale) of a concept, named in the page switcher. */
export interface ConceptPageRef {
	audience: Audience;
	locale: string;
	articleCount: number;
	leadTitle: string;
}

/** The page a reader was actually given, resolved by `resolve_page()`. `audienceExact` /
 *  `localeExact` are false when the reader is being shown a neighbouring band or another
 *  language — the page says so in words rather than pretending it is theirs. */
export interface ConceptPage {
	audience: Audience;
	locale: string;
	audienceExact: boolean;
	localeExact: boolean;
	/** Every visible article of this page, pinned first then newest head. */
	articles: ConceptArticleSummary[];
	/** The lead article in full — the one rendered on the page. Null when the page has none. */
	article: ConceptArticle | null;
}

/** A link from a concept to something else, read from the concept's end. */
export interface ConceptLink {
	id: string;
	relation: ConceptRelation;
	origin: ConceptLinkOrigin;
	targetType: ConceptLinkTargetType;
	targetId: string;
	targetTitle: string;
	/** Concept targets only — what `/concepts/<slug>` needs. */
	targetSlug: string;
	/** Exercise and material targets only. */
	targetAudience: Audience | null;
	addedByUserId: string | null;
	createdAt: string;
	canRemove: boolean;
}

/** The other end: a concept pointing AT the thing being looked at. What the chip row on an
 *  exercise, a material or another concept is made of. */
export interface ConceptBacklink {
	linkId: string;
	conceptId: string;
	slug: string;
	title: string;
	summary: string;
	relation: ConceptRelation;
	origin: ConceptLinkOrigin;
}

/** One of the caller's own unfinished revisions anywhere under this concept — so somebody who
 *  started writing yesterday is shown the way back to it rather than starting again. */
export interface ConceptOpenRevision {
	revisionId: string;
	articleId: string;
	audience: Audience;
	locale: string;
	status: ConceptRevisionStatus;
	updatedAt: string;
}

/** The concept detail: the node, the resolved page, every page it has, and its links. */
export interface Concept {
	id: string;
	slug: string;
	/** Backend slugs, like every other branch reference in this app. May be empty — a concept
	 *  attached to no branch is reviewed by staff and the article's author only. */
	branchIds: string[];
	branchNames: string[];
	tags: string[];
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	updatedAt: string;
	/** Null only when nothing under this concept is visible to this reader. */
	page: ConceptPage | null;
	pages: ConceptPageRef[];
	links: ConceptLink[];
	backlinks: ConceptBacklink[];
	myOpen: ConceptOpenRevision[];
	canEditMetadata: boolean;
	canPin: boolean;
	linkBlockReason: ConceptLinkBlockReason | null;
	/** `can_autopublish` for this caller: whether a submit here goes live or goes to a queue. */
	willPublish: boolean;
}

/** A row of `GET /api/concepts/` — the card on the hub, on search and on the homepage tab.
 *  `title`/`summary` come from the RESOLVED page's lead article, so a reader sees the version
 *  written for them where one exists and is told when they are not (`isFallback`). */
export interface ConceptListRow {
	id: string;
	slug: string;
	title: string;
	summary: string;
	audience: Audience;
	locale: string;
	articleCount: number;
	/** Every band and language this concept has a published article in. */
	audiences: Audience[];
	locales: string[];
	branchIds: string[];
	branchNames: string[];
	tags: string[];
	updatedAt: string;
	isFallback: boolean;
}

/** One row of the moderation queue's `concepts` section. Carries the blocks in the READ shape and
 *  the current head beside them, because the reviewer is deciding on a diff, not on a file. */
export interface ConceptQueueRow {
	id: string;
	articleId: string;
	conceptId: string;
	slug: string;
	audience: Audience;
	locale: string;
	number: number;
	title: string;
	summary: string;
	blocks: ConceptBlock[];
	changeNote: string;
	/** A revision that would bring a whole concept, or a whole article, into being. */
	isNewConcept: boolean;
	isNewArticle: boolean;
	basedOnIsCurrent: boolean;
	current: { revisionId: string; title: string; blocks: ConceptBlock[] } | null;
	createdByUserId: string | null;
	createdByDisplayName: string;
	createdAt: string;
	submittedAt: string | null;
	branchIds: string[];
	branchNames: string[];
}

/* --- what the editor sends --------------------------------------------------------------------- */

/** The fields a revision carries, whichever of the three ways it is being created. */
export interface ConceptRevisionDraft {
	title: string;
	summary?: string;
	blocks: ConceptBlock[];
	changeNote?: string;
	/** The head this is written against — omitted for the first revision of a new article. */
	basedOnId?: string;
	/** Submit it in the same request rather than leaving a draft. What comes back says which of
	 *  two things happened: `published` when the caller may publish, `pending` when a person
	 *  reads it first. */
	submit?: boolean;
}

/** Creating a concept: the node, its first article, and that article's revision 1, in one call. */
export interface ConceptDraft extends ConceptRevisionDraft {
	audience: Audience;
	locale: string;
	branches?: string[];
	tags?: string[];
}

/** Writing a new article for an existing concept — a peer of whatever is already on that page. */
export interface ConceptArticleDraft extends ConceptRevisionDraft {
	audience: Audience;
	locale: string;
}
