/**
 * The content licence of one piece of content — an exercise, a hint or solution, a material, a
 * concept article (backend `licensing/`, 2026-10-14). Mirrors `backend/licensing/licences.py` by
 * hand; `utils/labels.ts` (`LICENCES`, `LICENCE_FACTS`) carries the per-key facts and says so too.
 *
 * `unknown` is never a person's choice — it is the seeded corpus and imports whose rights are not
 * clarified, shown "for study only". `edmat-only` is the default: nothing opened to the world
 * without the author choosing it.
 */
export type Licence =
	| 'cc0-1.0'
	| 'cc-by-4.0'
	| 'cc-by-sa-4.0'
	| 'cc-by-nc-4.0'
	| 'cc-by-nc-sa-4.0'
	| 'edmat-only'
	| 'unknown';

/** Every key, in the registry's order — the runtime half of the type above, for the mapper's
 *  "is this a key I know?" check. */
export const LICENCE_KEYS = [
	'cc0-1.0',
	'cc-by-4.0',
	'cc-by-sa-4.0',
	'cc-by-nc-4.0',
	'cc-by-nc-sa-4.0',
	'edmat-only',
	'unknown'
] as const satisfies readonly Licence[];

/** The CONTENT kinds — what `/settings/licences` lists and the bulk change walks
 *  (`licensing/targets.py: LICENSED_KINDS`). */
export type LicensedKind = 'exercise' | 'solution_entry' | 'material' | 'concept_article';

/** Every kind `/api/licences/<kind>/<id>/` answers for (`ALL_LICENSED_KINDS`): the content kinds,
 *  plus a course's own licence and a file uploaded into a course (2026-11-02). Not listed in bulk. */
export type LicenceTargetKind = LicensedKind | 'course' | 'course_attachment';

/** How a work linked into a container sits with the container's licence
 *  (`backend/licensing/licences.py: compare_to_container`, mirrored by hand — house rule 13).
 *  `same` and `wider` need no word; the other three get a quiet note (`labels.ts:
 *  licenceRelationNote`). */
export type LicenceRelation = 'same' | 'wider' | 'narrower' | 'different' | 'unclear';

export interface LicenceChangeRow {
	from: Licence;
	to: Licence;
	changedAt: string;
	asStaff: boolean;
	note: string;
}

/** `GET /api/licences/<kind>/<id>/` — the line under a work, and its author's change control. */
export interface LicenceReading {
	licence: Licence;
	since: string | null;
	history: LicenceChangeRow[];
	canChange: boolean;
	/** Every licence the caller could move this item to right now (only ever wider). */
	allowed: Licence[];
}

/** One of the caller's own posted items in `GET /api/licences/mine/` (`licensing/bulk.py`). */
export interface MyLicensedItem {
	kind: LicensedKind;
	id: string;
	title: string;
	licence: Licence;
	/** What the rules would let the caller move it to right now — only ever wider. */
	allowed: Licence[];
	/** Why `allowed` is empty (`licence_other_contributors`, `licence_already_most_open`, …). */
	blockedReason: string;
	/** Where it lives: the exercise (for an exercise, a hint or a solution), the material, the concept. */
	exerciseId: string;
	materialId: string;
	conceptSlug: string;
	/** A hint or a solution, and the part it belongs to. */
	entryKind: string;
	partLabel: string;
}

export interface MyLicences {
	byKind: Record<LicensedKind, { items: MyLicensedItem[]; truncated: boolean }>;
	limitPerKind: number;
	maxPerRequest: number;
}

/** One item's outcome in `POST /api/licences/bulk/`. */
export interface BulkLicenceResult {
	kind: LicensedKind;
	id: string;
	ok: boolean;
	/** Set when `ok` is false — the rules' own word. */
	reason: string;
}
