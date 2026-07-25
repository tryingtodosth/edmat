import type { ReportKind } from '$lib/types';
import { apiClient } from '$lib/api/client';

/** POST /api/reports/ — flags an already-published Exercise/Comment/Review for moderator
 * attention. `reason` is optional free text. The backend rejects a second report from the same
 * user against the same target (400) — callers should treat that the same as any other
 * already-handled ApiError, not a special case, since there's nothing more to do about it either
 * way once "you already reported this" comes back. */
export async function submitReport(
	kind: ReportKind,
	objectId: string,
	reason?: string
): Promise<void> {
	await apiClient.post('/reports/', {
		kind,
		object_id: Number(objectId),
		reason: reason?.trim() || ''
	});
}
