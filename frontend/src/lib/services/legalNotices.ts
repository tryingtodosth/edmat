// DSA Art. 16 legal notices — mirrors backend/legal/views.py's LegalNoticeViewSet. Deliberately its
// own file, not folded into `issues.ts`: the two hit different, unrelated endpoints and (per
// backend/legal/models.py's own doc comment) this one is never gated by the `issues` FeatureFlag.
import { apiClient } from '$lib/api/client';
import {
	mapLegalNotice,
	mapLegalNoticeContentPreview,
	type RawLegalNotice,
	type RawLegalNoticeContentPreview
} from '$lib/api/mappers';
import type {
	LegalNotice,
	LegalNoticeContentPreview,
	LegalNoticeDraft,
	LegalNoticeStatus
} from '$lib/types/legalNotice';

export async function fileLegalNotice(draft: LegalNoticeDraft): Promise<LegalNotice> {
	const raw = await apiClient.post<RawLegalNotice>('/legal-notices/', {
		content_url: draft.contentUrl,
		explanation: draft.explanation,
		good_faith_confirmed: draft.goodFaithConfirmed,
		notifier_name: draft.notifierName,
		contact_email: draft.contactEmail
	});
	return mapLegalNotice(raw);
}

/** Staff (and, read-only, a signed-in notifier reading their own) — the moderation-queue-adjacent
 * listing this app's own `/legal/queue` page renders. */
export async function getLegalNotices(): Promise<LegalNotice[]> {
	const raw = await apiClient.get<RawLegalNotice[]>('/legal-notices/');
	return raw.map(mapLegalNotice);
}

/** Staff only — the Art. 17 "statement of reasons" is `resolveNote`, required by the backend. */
export async function resolveLegalNotice(
	id: string,
	decision: {
		status: Exclude<LegalNoticeStatus, 'open'>;
		resolveNote: string;
		contentKind?: string;
		contentObjectId?: number;
	}
): Promise<LegalNotice> {
	const raw = await apiClient.post<RawLegalNotice>(
		`/legal-notices/${encodeURIComponent(id)}/resolve/`,
		{
			status: decision.status,
			resolve_note: decision.resolveNote,
			content_kind: decision.contentKind || '',
			content_object_id: decision.contentObjectId ?? null
		}
	);
	return mapLegalNotice(raw);
}

/** Staff only — who posted the content a notice points at, and what it says, so a moderator can
 * see that BEFORE deciding rather than acting on an id blind. Throws (an `ApiError`, 400 for an
 * unrecognized `contentKind`, 404 for an id that doesn't exist) — the caller renders that as a
 * real "couldn't find that" state, not the honest-but-empty "no author on record" case, which is
 * a normal 200 with both fields blank. */
export async function previewLegalNoticeContent(
	noticeId: string,
	contentKind: string,
	contentObjectId: number
): Promise<LegalNoticeContentPreview> {
	const raw = await apiClient.get<RawLegalNoticeContentPreview>(
		`/legal-notices/${encodeURIComponent(noticeId)}/content-preview/` +
			`?content_kind=${encodeURIComponent(contentKind)}&content_object_id=${contentObjectId}`
	);
	return mapLegalNoticeContentPreview(raw);
}
