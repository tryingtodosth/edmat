import { apiClient, ApiError } from '$lib/api/client';
import type {
	BulkUploadCreated,
	BulkUploadIssue,
	BulkUploadReport,
	BulkUploadRequest
} from '$lib/types/bulkUpload';

// A person's bulk upload of exercise files (backend `exercises/bulk_views.py`, 2026-10-22). The
// mapping lives here rather than in `api/mappers.ts` because nothing else reads these shapes.

interface RawIssue {
	code: string;
	detail: string;
}

interface RawBulkReport {
	ok: boolean;
	branch: string;
	mode: 'publish' | 'queue';
	errors: RawIssue[];
	new_tags: string[];
	files: {
		name: string;
		ok: boolean;
		title: string;
		parts: number;
		errors: RawIssue[];
		warnings: RawIssue[];
	}[];
	limits: { files: number; file_bytes: number; total_bytes: number; parts: number };
	created?: {
		name: string;
		submission: number;
		status: 'pending' | 'approved';
		exercise: number | null;
	}[];
	batch?: string;
}

const issue = (raw: RawIssue): BulkUploadIssue => ({ code: raw.code, detail: raw.detail ?? '' });

function mapReport(raw: RawBulkReport): BulkUploadReport {
	return {
		ok: raw.ok,
		branch: raw.branch,
		mode: raw.mode,
		errors: raw.errors.map(issue),
		newTags: raw.new_tags ?? [],
		files: raw.files.map((f) => ({
			name: f.name,
			ok: f.ok,
			title: f.title,
			parts: f.parts,
			errors: f.errors.map(issue),
			warnings: f.warnings.map(issue)
		})),
		limits: {
			files: raw.limits.files,
			fileBytes: raw.limits.file_bytes,
			totalBytes: raw.limits.total_bytes,
			parts: raw.limits.parts
		},
		created: (raw.created ?? []).map((c): BulkUploadCreated => ({
			name: c.name,
			submissionId: String(c.submission),
			status: c.status,
			exerciseId: c.exercise == null ? undefined : String(c.exercise)
		})),
		batch: raw.batch
	};
}

function formFor(request: BulkUploadRequest): FormData {
	const form = new FormData();
	form.append('branch', request.branchId);
	if (request.licence) form.append('licence', request.licence);
	form.append('ai_assisted', request.aiAssisted ? 'true' : 'false');
	for (const file of request.files) form.append('files', file, file.name);
	return form;
}

/** Parse and check every file; nothing is written. A refused file is part of the answer. */
export async function previewBulkUpload(request: BulkUploadRequest): Promise<BulkUploadReport> {
	return mapReport(
		await apiClient.postForm<RawBulkReport>('/exercise-imports/?mode=preview', formFor(request))
	);
}

/** Send the files for real. The server re-checks them; when anything is refused it answers 400
 * with the same report, which is returned here (`ok: false`) rather than thrown, so the page can
 * show it the way it shows a preview. */
export async function commitBulkUpload(request: BulkUploadRequest): Promise<BulkUploadReport> {
	try {
		return mapReport(
			await apiClient.postForm<RawBulkReport>('/exercise-imports/?mode=commit', formFor(request))
		);
	} catch (err) {
		if (err instanceof ApiError && err.status === 400 && isReport(err.body)) {
			return mapReport(err.body);
		}
		throw err;
	}
}

function isReport(body: unknown): body is RawBulkReport {
	return Boolean(body && typeof body === 'object' && 'files' in body && 'mode' in body);
}

/** A moderator approves every still-pending submission of one upload (`POST
 * /api/moderation/batches/<batch>/approve/`). Each row is decided the way a one-by-one approve
 * decides it; rows outside the caller's authority or already decided come back as `skipped`. */
export async function approveUploadBatch(
	batch: string,
	reviewNote = ''
): Promise<{ approved: number; skipped: number }> {
	const raw = await apiClient.post<{ approved: unknown[]; skipped: unknown[] }>(
		`/moderation/batches/${encodeURIComponent(batch)}/approve/`,
		{ review_note: reviewNote }
	);
	return { approved: raw.approved.length, skipped: raw.skipped.length };
}
