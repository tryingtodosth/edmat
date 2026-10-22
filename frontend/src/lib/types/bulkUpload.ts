import type { Licence } from './licence';

/** One refusal or warning from `POST /api/exercise-imports/` (backend `exercises/bulk.py`): a
 * word from its vocabulary (`labels.ts: BULK_UPLOAD_LABELS`) and the server's own detail text. */
export interface BulkUploadIssue {
	code: string;
	detail: string;
}

export interface BulkUploadFile {
	name: string;
	ok: boolean;
	title: string;
	parts: number;
	errors: BulkUploadIssue[];
	warnings: BulkUploadIssue[];
}

export interface BulkUploadCreated {
	name: string;
	submissionId: string;
	status: 'pending' | 'approved';
	exerciseId?: string;
}

/** The report a preview returns, and a commit returns with `created` filled in. `mode` says
 * which way the files would go: `publish` (a verified contributor, or staff) or `queue`. */
export interface BulkUploadReport {
	ok: boolean;
	branch: string;
	mode: 'publish' | 'queue';
	errors: BulkUploadIssue[];
	newTags: string[];
	files: BulkUploadFile[];
	limits: { files: number; fileBytes: number; totalBytes: number; parts: number };
	created: BulkUploadCreated[];
	batch?: string;
}

export interface BulkUploadRequest {
	branchId: string;
	files: File[];
	licence?: Licence;
	aiAssisted: boolean;
}
