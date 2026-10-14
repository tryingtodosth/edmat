// The content-licence seam (backend `licensing/`, 2026-10-14). Components never fetch
// (frontend/CLAUDE.md's layer boundary); `apiClient` is the one `fetch()`.
//
// The licence KEY rides on every exercise, solution, material and concept article already (the
// mappers read it), so a list never asks this. A detail page asks once, for the two things the key
// alone cannot say: since when, and whether the caller may widen it.

import { ApiError, apiClient } from '$lib/api/client';
import { mapLicence } from '$lib/api/mappers';
import type { Licence, LicenceReading, LicensedKind } from '$lib/types/licence';

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
