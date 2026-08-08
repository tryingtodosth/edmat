import type { MaterialType } from './material';
import type { ModerationStatus } from './submission';

/** The metadata half of a material submission — everything EXCEPT the file itself, which travels
 * as a real `File` object passed separately to `submitMaterial` (lib/services/materials.ts), since
 * a FormData multipart body doesn't fit the same "one typed JSON draft" shape ExerciseSubmissionDraft
 * uses.
 *
 * `requirements`/`priceAmount`/`priceCurrency`/`estimatedMinutes` are all genuinely optional — a
 * new upload can declare its own requirements/price/time estimate at submission time, mirroring the
 * same fields a real, already-published Material carries (material.ts) — see `_apply_material_submission`
 * (backend) for how these three carry over onto the real Material row once approved. */
// One "Covers" claim declared at submission time — topic + level only, no subtopic (that finer-
// grained UX stays a post-publish-only flow via the material detail page's own "+Add coverage"
// action, `proposeCoverage` in materials.ts) — see moderation/models.py's own MaterialSubmission
// .coverage doc comment for the full reasoning.
export interface MaterialCoverageDraft {
	topicId: string;
	level: number; // 1-100
}

export interface MaterialSubmissionDraft {
	branchId: string;
	type: MaterialType;
	title: string;
	description: string;
	locale: string;
	// Provenance the uploader declares. Optional, but this is the only moment either is
	// recoverable — a moderator looking at a pending PDF cannot determine its author or origin from
	// the bytes, so if the form never asks, the information is not merely missing, it is gone.
	author?: string;
	sourceUrl?: string;
	/** Where the material lives, when it is a link rather than an upload. Distinct from
	 * `sourceUrl`, which is provenance for a file that IS uploaded here. */
	url?: string;
	requirements?: string[];
	coverage?: MaterialCoverageDraft[];
	priceAmount?: number;
	priceCurrency?: string;
	estimatedMinutes?: number;
}

/** What the backend reports back once scanned (materials/validators.py's scan_for_malware) — see
 * that module's own doc comment for why "not scanned" is a real, honestly-surfaced third state,
 * not silently folded into "clean". */
export type MaterialScanStatus = 'skipped' | 'clean' | 'flagged';

export interface MaterialSubmission {
	id: string;
	branchId: string;
	submittedByUserId: string;
	type: MaterialType;
	title: string;
	description: string;
	locale: string;
	fileName: string;
	fileUrl: string;
	author: string;
	sourceUrl?: string;
	/** Where the material lives, when it is a link rather than an upload. Distinct from
	 * `sourceUrl`, which is provenance for a file that IS uploaded here. */
	url?: string;
	requirements: string[];
	priceAmount?: number;
	priceCurrency: string;
	estimatedMinutes?: number;
	scanStatus: MaterialScanStatus;
	scanDetail: string;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
	resultingMaterialId?: string;
}
