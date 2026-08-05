// Sign-in provider drafts, the school picker, and the education/USOS ground — mirrors
// backend/identity/ one-to-one, matching this app's "one lib/services/*.ts per backend app"
// convention.
//
// Worth stating once here rather than at each call site: nothing in this module signs anybody in.
// The providers are drafts, and a draft that quietly authenticated people would be considerably
// worse than an honest button, so there is deliberately no handshake function to call. Real sign-in
// stays where it already is — `authStore.login` (state/auth.svelte.ts).

import type {
	EducationSnapshot,
	ProviderState,
	PublicEducation,
	School
} from '$lib/types/identity';
import { apiClient } from '$lib/api/client';

interface RawProviderState {
	id: string;
	label: string;
	protocol: string;
	status: string;
	scopes: string[];
	authorize_url: string;
	token_url: string;
	userinfo_url: string;
	jwks_url: string;
	uses_pkce: boolean;
	response_mode: string;
	quirk: string;
	blockers: string[];
	callback_requirements: string[];
}

function mapProvider(raw: RawProviderState): ProviderState {
	return {
		id: raw.id as ProviderState['id'],
		label: raw.label,
		protocol: raw.protocol as ProviderState['protocol'],
		status: raw.status as ProviderState['status'],
		scopes: raw.scopes,
		authorizeUrl: raw.authorize_url,
		tokenUrl: raw.token_url,
		userinfoUrl: raw.userinfo_url,
		jwksUrl: raw.jwks_url,
		usesPkce: raw.uses_pkce,
		responseMode: raw.response_mode as ProviderState['responseMode'],
		quirk: raw.quirk,
		blockers: raw.blockers,
		callbackRequirements: raw.callback_requirements
	};
}

/** Every sign-in template and exactly how far each one is.
 *
 * Fetched rather than hardcoded on purpose: the status is computed from the same settings a real
 * client would read, so configuring one is what makes the UI stop calling it a draft — with no copy
 * to remember to edit. Public, since the login page needs it before anyone has an account.
 */
export async function getProviderStates(): Promise<{
	providers: ProviderState[];
	repositoryUrl: string;
}> {
	const raw = await apiClient.get<{ providers: RawProviderState[]; repository_url: string }>(
		'/auth/providers/'
	);
	return { providers: raw.providers.map(mapProvider), repositoryUrl: raw.repository_url };
}

interface RawSchool {
	slug: string;
	name: string;
	short_name: string;
	country: string;
	city: string;
	grade_scale: string;
	runs_usos: boolean;
}

export async function getSchools(): Promise<School[]> {
	const raw = await apiClient.get<{ schools: RawSchool[] }>('/schools/');
	return raw.schools.map((s) => ({
		slug: s.slug,
		name: s.name,
		shortName: s.short_name,
		country: s.country,
		city: s.city,
		gradeScale: s.grade_scale as School['gradeScale'],
		runsUsos: s.runs_usos
	}));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSnapshot(raw: any): EducationSnapshot {
	const e = raw.education;
	return {
		education: {
			school: e.school,
			schoolLabel: e.school_label,
			otherSchoolName: e.other_school_name,
			verification: e.verification,
			status: e.status,
			programme: e.programme,
			studyYear: e.study_year,
			usosConnected: e.usos_connected,
			usosStudentNumber: e.usos_student_number,
			usosScopes: e.usos_scopes ?? [],
			shareSchool: e.share_school,
			shareDiploma: e.share_diploma,
			shareGrades: e.share_grades,
			diplomas: (e.diplomas ?? []).map((d: any) => ({
				id: d.id,
				title: d.title,
				level: d.level,
				programme: d.programme,
				issuedOn: d.issued_on,
				finalGrade: d.final_grade
			})),
			grades: (e.grades ?? []).map((g: any) => ({
				id: g.id,
				code: g.code,
				name: g.name,
				term: g.term,
				ects: g.ects,
				value: g.value,
				scale: g.scale,
				courseSlug: g.course_slug ?? null
			}))
		},
		standing: {
			tier: raw.standing.tier,
			usosTier: raw.standing.usos_tier,
			reasons: raw.standing.reasons,
			skillSeeds: (raw.standing.skill_seeds ?? []).map((s: any) => ({
				courseSlug: s.course_slug,
				courseName: s.course_name,
				ects: s.ects,
				basis: s.basis
			})),
			average: raw.standing.average ?? null
		},
		usos: {
			protocol: raw.usos.protocol,
			isMock: raw.usos.is_mock,
			configuredSchools: raw.usos.configured_schools,
			baseScopes: raw.usos.base_scopes,
			gradesScope: raw.usos.grades_scope,
			schoolRunsUsos: raw.usos.school_runs_usos,
			capabilities: raw.usos.capabilities,
			blockers: raw.usos.blockers,
			grants: raw.usos.grants
		},
		schoolEmailEligible: raw.school_email_eligible
	};
}

export function mapPublicEducation(raw: any): PublicEducation | null {
	if (!raw) return null;
	return {
		school: raw.school,
		verification: raw.verification,
		status: raw.status,
		programme: raw.programme,
		diplomas: (raw.diplomas ?? []).map((d: any) => ({
			title: d.title,
			programme: d.programme,
			issuedOn: d.issued_on,
			finalGrade: d.final_grade
		})),
		grades: (raw.grades ?? []).map((g: any) => ({
			name: g.name,
			term: g.term,
			ects: g.ects,
			value: g.value,
			scale: g.scale,
			courseSlug: g.course_slug ?? null
		})),
		average: raw.average ?? null
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getEducation(): Promise<EducationSnapshot> {
	return mapSnapshot(await apiClient.get('/education/me/'));
}

/** Declaring an institution, and the three consents. Deliberately one endpoint: they are edited on
 * the same screen, and separating them would mean two round trips to answer one question. */
export async function updateEducation(patch: {
	school?: string;
	otherSchoolName?: string;
	programme?: string;
	shareSchool?: boolean;
	shareDiploma?: boolean;
	shareGrades?: boolean;
}): Promise<EducationSnapshot> {
	const body: Record<string, unknown> = {};
	if (patch.school !== undefined) body.school = patch.school;
	if (patch.otherSchoolName !== undefined) body.other_school_name = patch.otherSchoolName;
	if (patch.programme !== undefined) body.programme = patch.programme;
	if (patch.shareSchool !== undefined) body.share_school = patch.shareSchool;
	if (patch.shareDiploma !== undefined) body.share_diploma = patch.shareDiploma;
	if (patch.shareGrades !== undefined) body.share_grades = patch.shareGrades;
	return mapSnapshot(await apiClient.patch('/education/me/', body));
}

/** Thrown when USOS simply is not connectable yet, carrying the real reasons rather than a code.
 * The caller is a UI whose entire job at that moment is to explain the state, so the state is the
 * error. */
export class UsosUnavailableError extends Error {
	constructor(public readonly blockers: string[]) {
		super('USOS is not connected');
	}
}

export async function connectUsos(includeGrades: boolean): Promise<EducationSnapshot> {
	try {
		return mapSnapshot(
			await apiClient.post('/education/usos/connect/', { include_grades: includeGrades })
		);
	} catch (e) {
		const body = (e as { body?: { blockers?: string[] } }).body;
		if (body?.blockers) throw new UsosUnavailableError(body.blockers);
		throw e;
	}
}

export async function disconnectUsos(): Promise<EducationSnapshot> {
	return mapSnapshot(await apiClient.delete('/education/usos/connect/'));
}

/** Transfer a diploma or a transcript. Importing is not publishing — this touches no consent. */
export async function importFromUsos(kind: 'diploma' | 'grades'): Promise<EducationSnapshot> {
	return mapSnapshot(await apiClient.post('/education/usos/import/', { kind }));
}

/** Delete an imported transcript outright, as distinct from merely un-publishing it. */
export async function removeImportedGrades(): Promise<EducationSnapshot> {
	return mapSnapshot(await apiClient.delete('/education/grades/'));
}
