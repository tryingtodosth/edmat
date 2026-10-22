// The content-licence seam (backend `licensing/`, 2026-10-14). Components never fetch
// (frontend/CLAUDE.md's layer boundary); `apiClient` is the one `fetch()`.
//
// The licence KEY rides on every exercise, solution, material and concept article already (the
// mappers read it), so a list never asks this. A detail page asks once, for the two things the key
// alone cannot say: since when, and whether the caller may widen it.

import { ApiError, apiClient } from '$lib/api/client';
import { mapLicence } from '$lib/api/mappers';
import type {
	BulkLicenceResult,
	Licence,
	LicenceReading,
	LicensedKind,
	MyLicensedItem,
	MyLicences
} from '$lib/types/licence';

interface RawReading {
	licence: string;
	since: string | null;
	history?: { from: string; to: string; changed_at: string; as_staff: boolean; note: string }[];
	can_change?: boolean;
	allowed?: string[];
}

function mapReading(raw: RawReading): LicenceReading {
	return {
		licence: mapLicence(raw.licence),
		since: raw.since ?? null,
		history: (raw.history ?? []).map((row) => ({
			from: mapLicence(row.from),
			to: mapLicence(row.to),
			changedAt: row.changed_at,
			asStaff: Boolean(row.as_staff),
			note: row.note ?? ''
		})),
		canChange: Boolean(raw.can_change),
		allowed: (raw.allowed ?? []).map((key) => mapLicence(key))
	};
}

export async function getLicence(kind: LicensedKind, id: string): Promise<LicenceReading> {
	return mapReading(await apiClient.get<RawReading>(`/licences/${kind}/${id}/`));
}

/** Thrown with the backend's reason (`licence_narrowing`, …) so the form can say which refusal it
 *  was — `labels.licenceReasonLabel` has a sentence for each. */
export class LicenceChangeError extends Error {
	constructor(public reason: string) {
		super(reason);
	}
}

export async function changeLicence(
	kind: LicensedKind,
	id: string,
	licence: Licence,
	note = ''
): Promise<LicenceReading> {
	try {
		return mapReading(
			await apiClient.post<RawReading>(`/licences/${kind}/${id}/`, { licence, note })
		);
	} catch (error) {
		if (error instanceof ApiError) {
			const detail = (error.body as { detail?: unknown } | null)?.detail;
			throw new LicenceChangeError(typeof detail === 'string' ? detail : 'licence_failed');
		}
		throw error;
	}
}

// ---- the caller's own content, all at once (backend `licensing/bulk.py`, 2026-10-22) ----------

const KINDS: LicensedKind[] = ['exercise', 'solution_entry', 'material', 'concept_article'];

interface RawMyItem {
	kind: string;
	id: string;
	title?: string;
	licence: string;
	allowed?: string[];
	blocked_reason?: string;
	exercise_id?: string;
	material_id?: string;
	concept_slug?: string;
	entry_kind?: string;
	part_label?: string;
}

interface RawMine {
	kinds: Record<string, { items: RawMyItem[]; truncated: boolean }>;
	limit_per_kind: number;
	max_per_request: number;
}

function mapMyItem(kind: LicensedKind, raw: RawMyItem): MyLicensedItem {
	return {
		kind,
		id: String(raw.id),
		title: raw.title ?? '',
		licence: mapLicence(raw.licence),
		allowed: (raw.allowed ?? []).map((key) => mapLicence(key)),
		blockedReason: raw.blocked_reason ?? '',
		exerciseId: raw.exercise_id ?? '',
		materialId: raw.material_id ?? '',
		conceptSlug: raw.concept_slug ?? '',
		entryKind: raw.entry_kind ?? '',
		partLabel: raw.part_label ?? ''
	};
}

export async function getMyLicences(lang: string): Promise<MyLicences> {
	const raw = await apiClient.get<RawMine>(`/licences/mine/?lang=${encodeURIComponent(lang)}`);
	const byKind = {} as MyLicences['byKind'];
	for (const kind of KINDS) {
		const group = raw.kinds?.[kind];
		byKind[kind] = {
			items: (group?.items ?? []).map((item) => mapMyItem(kind, item)),
			truncated: Boolean(group?.truncated)
		};
	}
	return { byKind, limitPerKind: raw.limit_per_kind, maxPerRequest: raw.max_per_request || 500 };
}

/** Widen many items at once. The selection is sent in chunks of `maxPerRequest`, one after the
 *  other; each item's outcome is the rules' own answer. A whole-request refusal (a malformed
 *  request, or the hourly bound — 429) stops there and is thrown as a `LicenceChangeError` with
 *  what was already done kept in `done`. */
export class BulkLicenceError extends LicenceChangeError {
	constructor(
		reason: string,
		public done: BulkLicenceResult[]
	) {
		super(reason);
	}
}

export async function bulkChangeLicence(
	to: Licence,
	items: { kind: LicensedKind; id: string }[],
	maxPerRequest = 500
): Promise<BulkLicenceResult[]> {
	const done: BulkLicenceResult[] = [];
	for (let i = 0; i < items.length; i += maxPerRequest) {
		const chunk = items.slice(i, i + maxPerRequest);
		try {
			const raw = await apiClient.post<{
				results: { kind: string; id: string; ok: boolean; reason?: string }[];
			}>('/licences/bulk/', { to, items: chunk });
			for (const r of raw.results ?? []) {
				done.push({
					kind: r.kind as LicensedKind,
					id: String(r.id),
					ok: Boolean(r.ok),
					reason: r.reason ?? ''
				});
			}
		} catch (error) {
			if (error instanceof ApiError) {
				const detail = (error.body as { detail?: unknown } | null)?.detail;
				const reason =
					error.status === 429
						? 'licence_bulk_throttled'
						: typeof detail === 'string'
							? detail
							: 'licence_failed';
				throw new BulkLicenceError(reason, done);
			}
			throw error;
		}
	}
	return done;
}
