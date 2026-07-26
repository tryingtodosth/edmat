import type { MaterialType } from './material';
import type { ModerationStatus } from './submission';

/** The metadata half of a material submission — everything EXCEPT the file itself, which travels
 * as a real `File` object passed separately to `submitMaterial` (lib/services/materials.ts), since
 * a FormData multipart body doesn't fit the same "one typed JSON draft" shape ExerciseSubmissionDraft
 * uses. */
export interface MaterialSubmissionDraft {
	courseId: string;
	type: MaterialType;
	title: string;
	description: string;
	locale: string;
}

/** What the backend reports back once scanned (materials/validators.py's scan_for_malware) — see
 * that module's own doc comment for why "not scanned" is a real, honestly-surfaced third state,
 * not silently folded into "clean". */
export type MaterialScanStatus = 'skipped' | 'clean' | 'flagged';

export interface MaterialSubmission {
	id: string;
	courseId: string;
	submittedByUserId: string;
	type: MaterialType;
	title: string;
	description: string;
	locale: string;
	fileName: string;
	fileUrl: string;
	scanStatus: MaterialScanStatus;
	scanDetail: string;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
	resultingMaterialId?: string;
}
