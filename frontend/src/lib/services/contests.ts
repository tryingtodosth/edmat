// `contests` — the only place this app knows how to talk to `backend/contests/`. Components and
// routes never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one fetch.
// Hand-written snake_case <-> camelCase mapping, like every other service here, so a field rename
// breaks in exactly one file.
//
// Two conventions worth knowing before reading:
//
// * **Every read sends `?lang=`.** A contest's problems resolve an exercise's translation
//   server-side, and without the parameter `request_locale` falls back to `pl` and an English
//   reader silently gets the Polish — the same trap `services/goals.ts` and `services/needs.ts`
//   each record.
// * **A refusal is a word, and it comes back in `ApiError.body.detail`.** `refusalWord()` below is
//   the one place that digs it out, so no route has to know the shape; `CONTEST_BLOCK_LABELS` in
//   `lib/utils/labels.ts` turns it into a sentence.

import { getLocale } from '$lib/paraglide/runtime';
import { ApiError, apiClient } from '$lib/api/client';
import { mapTextVersions } from '$lib/services/textVersions';
import type {
	CertificatePayload,
	CompliancePayload,
	Contest,
	ContestBlockReason,
	ContestComplaint,
	ContestCreated,
	ContestDraft,
	ContestPreset,
	ContestProblem,
	ContestRegistrationRow,
	ContestResultRow,
	ContestStaffRole,
	ContestStaffRow,
	ContestStage,
	ContestStatus,
	ContestSubmission,
	JudgingView,
	PresetsPayload,
	RankingRow,
	ResultsPayload,
	RulesPayload,
	RulesSectionRow,
	RulesVersionRow,
	SuggestedPerson
} from '$lib/types/contest';
import type { NodeRef } from '$lib/types/node';

function lang(): string {
	return `lang=${encodeURIComponent(getLocale())}`;
}

/** The refusal word behind a thrown `ApiError`, or null if this was not a refusal with a word.
 *  Every route's catch block goes through here rather than reading `err.body` itself. */
export function refusalWord(error: unknown): ContestBlockReason | null {
	if (error instanceof ApiError && error.body && typeof error.body === 'object') {
		const detail = (error.body as Record<string, unknown>).detail;
		if (typeof detail === 'string') return detail as ContestBlockReason;
	}
	return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any) {
	if (!raw) return null;
	return { id: String(raw.id), displayName: raw.display_name ?? '' };
}

function mapNode(raw: any): NodeRef | null {
	if (!raw) return null;
	return {
		kind: raw.kind,
		id: String(raw.id),
		title: raw.title ?? '',
		isStaff: raw.is_staff ?? false,
		isMember: raw.is_member ?? false,
		canManage: raw.can_manage ?? false,
		openBoard: raw.open_board ?? false,
		...(raw.slug ? { slug: String(raw.slug) } : {})
	};
}

function mapPreset(raw: any): ContestPreset {
	return {
		key: raw.key,
		nameEn: raw.name_en ?? '',
		namePl: raw.name_pl ?? '',
		summaryEn: raw.summary_en ?? '',
		summaryPl: raw.summary_pl ?? '',
		organiserKind: raw.organiser_kind,
		audience: raw.audience ?? 'all',
		allowsMinors: raw.allows_minors ?? false,
		minorsOnly: raw.minors_only ?? false,
		hasPrize: raw.has_prize ?? false,
		prizeRegime: raw.prize_regime ?? 'none',
		team: raw.team ?? false,
		stages: (raw.stages ?? []).map((s: any) => ({
			key: s.key,
			nameEn: s.name_en ?? '',
			namePl: s.name_pl ?? '',
			mode: s.mode,
			offsetDays: s.offset_days ?? 0,
			durationDays: s.duration_days ?? 1,
			advancement: s.advancement
		})),
		stagesLocked: raw.stages_locked ?? false,
		juryMin: raw.jury_min ?? 1,
		juryRecommended: raw.jury_recommended ?? 3,
		externalReferenceRequired: raw.external_reference_required ?? false,
		staffOnly: raw.staff_only ?? false,
		consumerBlock: raw.consumer_block ?? 'never',
		complaintWindowDays: raw.complaint_window_days ?? 14,
		publicationDefault: raw.publication_default ?? 'initials',
		rulesSections: (raw.rules_sections ?? []).map((s: any) => ({
			key: s.key,
			headingEn: s.heading_en ?? '',
			headingPl: s.heading_pl ?? '',
			required: s.required ?? true,
			law: s.law ?? [],
			guidanceEn: s.guidance_en ?? '',
			guidancePl: s.guidance_pl ?? ''
		})),
		checklist: (raw.checklist ?? []).map((c: any) => ({
			key: c.key,
			titleEn: c.title_en ?? '',
			titlePl: c.title_pl ?? '',
			law: c.law ?? [],
			role: c.role,
			phase: c.phase
		})),
		goalCriteria: raw.goal_criteria ?? [],
		needs: (raw.needs ?? []).map((n: any) => ({
			kind: n.kind,
			titleEn: n.title_en ?? '',
			titlePl: n.title_pl ?? '',
			wantedCount: n.wanted_count ?? 1
		})),
		roles: (raw.roles ?? []).map((r: any) => ({
			role: r.role,
			count: r.count ?? 1,
			required: r.required ?? false
		})),
		info: (raw.info ?? []).map((i: any) => ({ en: i.en ?? '', pl: i.pl ?? '', law: i.law ?? [] }))
	};
}

function mapRegistration(raw: any): ContestRegistrationRow {
	return {
		id: String(raw.id),
		user: mapPerson(raw.user),
		number: raw.number ?? 0,
		initials: raw.initials ?? '',
		status: raw.status,
		affiliation: raw.affiliation ?? '',
		guardianName: raw.guardian_name ?? '',
		hasGuardianConsent: raw.has_guardian_consent ?? false,
		publishName: raw.publish_name ?? false,
		teamName: raw.team_name ?? '',
		acceptedRulesVersion: raw.accepted_rules_version ?? 0,
		createdAt: raw.created_at ?? '',
		decidedAt: raw.decided_at ?? null
	};
}

function mapContest(raw: any): Contest {
	return {
		id: String(raw.id),
		node: mapNode(raw.node),
		title: raw.title ?? '',
		description: raw.description ?? '',
		presetKey: raw.preset_key ?? '',
		preset: raw.preset ? mapPreset(raw.preset) : null,
		organiser: mapPerson(raw.organiser),
		organization: raw.organization ? String(raw.organization) : null,
		status: raw.status,
		visibility: raw.visibility,
		audience: raw.audience ?? 'all',
		allowsMinors: raw.allows_minors ?? false,
		startsAt: raw.starts_at ?? null,
		endsAt: raw.ends_at ?? null,
		registrationOpensAt: raw.registration_opens_at ?? null,
		registrationClosesAt: raw.registration_closes_at ?? null,
		hasPrize: raw.has_prize ?? false,
		prizeClaimDeadline: raw.prize_claim_deadline ?? null,
		prizeDescription: raw.prize_description ?? '',
		prizeTotalValuePln: raw.prize_total_value_pln ?? null,
		prizeRegime: raw.prize_regime ?? 'none',
		organiserIsBusiness: raw.organiser_is_business ?? false,
		externalReferenceUrl: raw.external_reference_url ?? '',
		entryLicence: raw.entry_licence ?? 'none',
		complaintWindowDays: raw.complaint_window_days ?? 14,
		publicationDefault: raw.publication_default ?? 'initials',
		meritCriteria: raw.merit_criteria ?? '',
		dataControllerName: raw.data_controller_name ?? '',
		dataControllerContact: raw.data_controller_contact ?? '',
		accommodationContact: raw.accommodation_contact ?? '',
		team: raw.team ?? false,
		teamSizeMax: raw.team_size_max ?? null,
		capacity: raw.capacity ?? null,
		laureateMinPct: raw.laureate_min_pct ?? 90,
		finalistMinPct: raw.finalist_min_pct ?? 75,
		distinctionCount: raw.distinction_count ?? 0,
		announcedAt: raw.announced_at ?? null,
		resultsPublishedAt: raw.results_published_at ?? null,
		closedAt: raw.closed_at ?? null,
		complaintsCloseAt: raw.complaints_close_at ?? null,
		rulesVersion: raw.rules_version ?? 0,
		resultsArePublished: raw.results_are_published ?? false,
		createdAt: raw.created_at ?? '',
		updatedAt: raw.updated_at ?? '',
		myRole: raw.my_role ?? null,
		isMember: raw.is_member ?? false,
		canManage: raw.can_manage ?? false,
		textVersions: mapTextVersions(raw.text_versions ?? []),
		canScore: raw.can_score ?? false,
		registrationCount: raw.registration_count ?? 0,
		juryCount: raw.jury_count ?? 0,
		stageCount: raw.stage_count ?? 0,
		announceBlockReason: raw.announce_block_reason ?? null,
		registerBlockReason: raw.register_block_reason ?? null,
		myRegistration: raw.my_registration ? mapRegistration(raw.my_registration) : null
	};
}

function mapStage(raw: any): ContestStage {
	return {
		id: String(raw.id),
		order: raw.order ?? 0,
		key: raw.key ?? '',
		title: raw.title ?? '',
		description: raw.description ?? '',
		mode: raw.mode ?? 'online',
		event: raw.event ? { id: String(raw.event.id), title: raw.event.title ?? '' } : null,
		opensAt: raw.opens_at ?? null,
		closesAt: raw.closes_at ?? null,
		advancement: raw.advancement ?? 'final',
		advanceCount: raw.advance_count ?? null,
		advanceThreshold: raw.advance_threshold ?? null,
		status: raw.status ?? 'scheduled',
		advancedAt: raw.advanced_at ?? null,
		maxPoints: raw.max_points ?? 0,
		problemCount: raw.problem_count ?? 0,
		problemsVisible: raw.problems_visible ?? false,
		submissionCount: raw.submission_count ?? 0,
		advancedCount: raw.advanced_count ?? 0
	};
}

function mapProblem(raw: any): ContestProblem {
	return {
		id: String(raw.id),
		exercise: {
			id: String(raw.exercise?.id ?? ''),
			number: raw.exercise?.number ?? 0,
			branch: raw.exercise?.branch ?? '',
			difficulty: raw.exercise?.difficulty ?? ''
		},
		order: raw.order ?? 0,
		points: raw.points ?? 1,
		title: raw.title ?? '',
		statement: raw.statement ?? '',
		resolvedLocale: raw.resolved_locale ?? '',
		visibleFrom: raw.visible_from ?? null
	};
}

function mapSubmission(raw: any): ContestSubmission {
	return {
		id: raw.id ? String(raw.id) : null,
		registration: {
			id: String(raw.registration?.id ?? ''),
			number: raw.registration?.number ?? 0,
			teamName: raw.registration?.team_name ?? '',
			user: raw.registration?.user ? mapPerson(raw.registration.user) : null
		},
		status: raw.status ?? 'draft',
		submittedAt: raw.submitted_at ?? null,
		advanced: raw.advanced ?? false,
		answers: (raw.answers ?? []).map((a: any) => ({
			id: a.id ? String(a.id) : null,
			problemId: String(a.problem_id),
			text: a.text ?? '',
			attachmentId: a.attachment_id ? String(a.attachment_id) : null,
			updatedAt: a.updated_at ?? null
		})),
		points: raw.points ?? 0,
		scoredProblems: raw.scored_problems ?? 0,
		updatedAt: raw.updated_at ?? null
	};
}

function mapResult(raw: any): ContestResultRow {
	return {
		id: String(raw.id),
		rank: raw.rank ?? 0,
		totalPoints: raw.total_points ?? 0,
		maxPoints: raw.max_points ?? 0,
		title: raw.title ?? 'participant',
		displayName: raw.display_name ?? '',
		registrationNumber: raw.registration_number ?? 0,
		isMe: raw.is_me ?? false,
		publishedAt: raw.published_at ?? ''
	};
}

function mapComplaint(raw: any): ContestComplaint {
	return {
		id: String(raw.id),
		registrationNumber: raw.registration_number ?? 0,
		text: raw.text ?? '',
		status: raw.status ?? 'open',
		answer: raw.answer ?? '',
		answeredBy: mapPerson(raw.answered_by),
		answeredAt: raw.answered_at ?? null,
		createdAt: raw.created_at ?? '',
		isMine: raw.is_mine ?? false
	};
}

function mapRulesSection(raw: any): RulesSectionRow {
	return {
		id: String(raw.id),
		key: raw.key,
		order: raw.order ?? 0,
		body: raw.body ?? '',
		heading: { en: raw.heading?.en ?? raw.key, pl: raw.heading?.pl ?? raw.key },
		guidance: { en: raw.guidance?.en ?? '', pl: raw.guidance?.pl ?? '' },
		law: raw.law ?? [],
		required: raw.required ?? true
	};
}

function mapRulesVersion(raw: any): RulesVersionRow {
	return {
		id: String(raw.id),
		number: raw.number ?? 0,
		publishedAt: raw.published_at ?? '',
		publishedBy: mapPerson(raw.published_by),
		snapshot: raw.snapshot ?? []
	};
}

function mapCompliance(raw: any): CompliancePayload {
	return {
		preset: raw.preset ?? '',
		items: (raw.items ?? []).map((i: any) => ({
			key: i.key,
			state: i.state,
			law: i.law ?? [],
			detail: i.detail ?? i.key
		})),
		tax: {
			applies: raw.tax?.applies ?? false,
			regime: raw.tax?.regime,
			valuePln: raw.tax?.value_pln ?? null,
			thresholdPln: raw.tax?.threshold_pln,
			aboveThreshold: raw.tax?.above_threshold,
			grossUpPln: raw.tax?.gross_up_pln ?? null,
			law: raw.tax?.law ?? []
		},
		notLegalAdvice: raw.not_legal_advice ?? false
	};
}

/** camelCase draft -> the snake_case body. Only the keys the caller actually set are sent, so the
 *  server fills the rest from the preset rather than being handed a wall of nulls. */
function draftToBody(draft: ContestDraft): Record<string, unknown> {
	const map: Record<string, string> = {
		title: 'title',
		description: 'description',
		presetKey: 'preset_key',
		organization: 'organization',
		visibility: 'visibility',
		audience: 'audience',
		allowsMinors: 'allows_minors',
		startsAt: 'starts_at',
		endsAt: 'ends_at',
		registrationOpensAt: 'registration_opens_at',
		registrationClosesAt: 'registration_closes_at',
		hasPrize: 'has_prize',
		prizeClaimDeadline: 'prize_claim_deadline',
		prizeDescription: 'prize_description',
		prizeTotalValuePln: 'prize_total_value_pln',
		prizeRegime: 'prize_regime',
		organiserIsBusiness: 'organiser_is_business',
		externalReferenceUrl: 'external_reference_url',
		entryLicence: 'entry_licence',
		complaintWindowDays: 'complaint_window_days',
		publicationDefault: 'publication_default',
		meritCriteria: 'merit_criteria',
		dataControllerName: 'data_controller_name',
		dataControllerContact: 'data_controller_contact',
		accommodationContact: 'accommodation_contact',
		team: 'team',
		teamSizeMax: 'team_size_max',
		capacity: 'capacity',
		laureateMinPct: 'laureate_min_pct',
		finalistMinPct: 'finalist_min_pct',
		distinctionCount: 'distinction_count'
	};
	const body: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(map)) {
		const value = (draft as Record<string, unknown>)[key];
		if (value !== undefined) body[field] = value;
	}
	return body;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- presets and people --------------------------------------------------------------------

export async function getContestPresets(): Promise<PresetsPayload> {
	const raw = await apiClient.get<Record<string, unknown>>('/contest-presets/');
	return {
		law: (raw.law ?? {}) as PresetsPayload['law'],
		presets: ((raw.presets ?? []) as unknown[]).map(mapPreset)
	};
}

export async function getPeopleSuggestions(): Promise<SuggestedPerson[]> {
	const raw = await apiClient.get<{ people: { id: number; display_name: string; via: string[] }[] }>(
		'/contests/people-suggestions/'
	);
	return (raw.people ?? []).map((row) => ({
		id: String(row.id),
		displayName: row.display_name ?? '',
		via: row.via ?? []
	}));
}

// ---- contests ------------------------------------------------------------------------------

export interface ContestQuery {
	mine?: boolean;
	status?: ContestStatus[];
	preset?: string[];
	q?: string;
}

export async function getContests(query: ContestQuery = {}): Promise<Contest[]> {
	const parts = [lang()];
	if (query.mine) parts.push('mine=1');
	if (query.status?.length) parts.push(`status=${encodeURIComponent(query.status.join(','))}`);
	if (query.preset?.length) parts.push(`preset=${encodeURIComponent(query.preset.join(','))}`);
	if (query.q) parts.push(`q=${encodeURIComponent(query.q)}`);
	const rows = await apiClient.get<unknown[]>(`/contests/?${parts.join('&')}`);
	return rows.map(mapContest);
}

export async function getContest(id: string): Promise<Contest> {
	return mapContest(await apiClient.get(`/contests/${id}/?${lang()}`));
}

export async function createContest(draft: ContestDraft): Promise<ContestCreated> {
	const raw = await apiClient.post<Record<string, unknown>>('/contests/', draftToBody(draft));
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const personalisation = (raw.personalisation ?? {}) as any;
	/* eslint-enable @typescript-eslint/no-explicit-any */
	return {
		...mapContest(raw),
		personalisation: {
			preset: personalisation.preset ?? '',
			created: {
				plan: personalisation.created?.plan ? String(personalisation.created.plan) : null,
				goal: personalisation.created?.goal ? String(personalisation.created.goal) : null,
				tasks: (personalisation.created?.tasks ?? []).map(String),
				needs: (personalisation.created?.needs ?? []).map(String),
				polls: (personalisation.created?.polls ?? []).map(String)
			},
			skipped: personalisation.skipped ?? []
		}
	};
}

export async function updateContest(id: string, draft: ContestDraft): Promise<Contest> {
	return mapContest(await apiClient.patch(`/contests/${id}/`, draftToBody(draft)));
}

export async function announceContest(id: string): Promise<Contest> {
	return mapContest(await apiClient.post(`/contests/${id}/announce/`));
}

export async function transitionContest(id: string, status: ContestStatus): Promise<Contest> {
	return mapContest(await apiClient.post(`/contests/${id}/transition/`, { status }));
}

export async function deleteContest(id: string): Promise<void> {
	await apiClient.delete(`/contests/${id}/`);
}

// ---- staff ---------------------------------------------------------------------------------

export async function getContestStaff(id: string): Promise<ContestStaffRow[]> {
	const rows = await apiClient.get<unknown[]>(`/contests/${id}/staff/`);
	/* eslint-disable @typescript-eslint/no-explicit-any */
	return rows.map((raw: any) => ({
		id: String(raw.id),
		user: mapPerson(raw.user),
		role: raw.role,
		addedAt: raw.added_at ?? ''
	}));
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function addContestStaff(
	id: string,
	userId: string,
	role: ContestStaffRole
): Promise<ContestStaffRow> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.post<any>(`/contests/${id}/staff/`, {
		user_id: Number(userId),
		role
	});
	return { id: String(raw.id), user: mapPerson(raw.user), role: raw.role, addedAt: raw.added_at };
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function removeContestStaff(staffId: string): Promise<void> {
	await apiClient.delete(`/contest-staff/${staffId}/`);
}

// ---- stages and problems -------------------------------------------------------------------

export async function getStages(contestId: string): Promise<ContestStage[]> {
	const rows = await apiClient.get<unknown[]>(`/contests/${contestId}/stages/?${lang()}`);
	return rows.map(mapStage);
}

export async function getStage(stageId: string): Promise<ContestStage> {
	return mapStage(await apiClient.get(`/contest-stages/${stageId}/?${lang()}`));
}

export interface StageDraft {
	title?: string;
	description?: string;
	mode?: 'online' | 'onsite';
	opensAt?: string | null;
	closesAt?: string | null;
	advancement?: ContestStage['advancement'];
	advanceCount?: number | null;
	advanceThreshold?: number | null;
	order?: number;
	key?: string;
}

function stageBody(draft: StageDraft): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.title !== undefined) body.title = draft.title;
	if (draft.description !== undefined) body.description = draft.description;
	if (draft.mode !== undefined) body.mode = draft.mode;
	if (draft.opensAt !== undefined) body.opens_at = draft.opensAt;
	if (draft.closesAt !== undefined) body.closes_at = draft.closesAt;
	if (draft.advancement !== undefined) body.advancement = draft.advancement;
	if (draft.advanceCount !== undefined) body.advance_count = draft.advanceCount;
	if (draft.advanceThreshold !== undefined) body.advance_threshold = draft.advanceThreshold;
	if (draft.order !== undefined) body.order = draft.order;
	if (draft.key !== undefined) body.key = draft.key;
	return body;
}

export async function createStage(contestId: string, draft: StageDraft): Promise<ContestStage> {
	return mapStage(await apiClient.post(`/contests/${contestId}/stages/`, stageBody(draft)));
}

export async function updateStage(stageId: string, draft: StageDraft): Promise<ContestStage> {
	return mapStage(await apiClient.patch(`/contest-stages/${stageId}/`, stageBody(draft)));
}

export async function deleteStage(stageId: string): Promise<void> {
	await apiClient.delete(`/contest-stages/${stageId}/`);
}

export async function openStage(stageId: string): Promise<ContestStage> {
	return mapStage(await apiClient.post(`/contest-stages/${stageId}/open/`));
}

export async function closeStage(stageId: string): Promise<ContestStage> {
	return mapStage(await apiClient.post(`/contest-stages/${stageId}/close/`));
}

export async function advanceStage(stageId: string): Promise<{ advanced: number; stage: ContestStage }> {
	const raw = await apiClient.post<{ advanced: number; stage: unknown }>(
		`/contest-stages/${stageId}/advance/`
	);
	return { advanced: raw.advanced ?? 0, stage: mapStage(raw.stage) };
}

/** 404 before the stage opens, for anybody who is not staff — which is not an error to report but
 *  the honest answer, so the caller branches on it. */
export async function getProblems(stageId: string): Promise<ContestProblem[] | null> {
	try {
		const rows = await apiClient.get<unknown[]>(`/contest-stages/${stageId}/problems/?${lang()}`);
		return rows.map(mapProblem);
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	}
}

export async function addProblem(
	stageId: string,
	exerciseId: string,
	points: number
): Promise<ContestProblem> {
	return mapProblem(
		await apiClient.post(`/contest-stages/${stageId}/problems/`, {
			exercise_id: Number(exerciseId),
			points
		})
	);
}

export async function removeProblem(problemId: string): Promise<void> {
	await apiClient.delete(`/contest-problems/${problemId}/`);
}

// ---- registrations -------------------------------------------------------------------------

export async function getRegistrations(contestId: string): Promise<ContestRegistrationRow[]> {
	const rows = await apiClient.get<unknown[]>(`/contests/${contestId}/registrations/`);
	return rows.map(mapRegistration);
}

export interface RegisterPayload {
	affiliation?: string;
	guardianName?: string;
	guardianConsent?: boolean;
	publishName?: boolean;
	teamName?: string;
}

export async function registerForContest(
	contestId: string,
	payload: RegisterPayload
): Promise<ContestRegistrationRow> {
	return mapRegistration(
		await apiClient.post(`/contests/${contestId}/registrations/`, {
			affiliation: payload.affiliation ?? '',
			guardian_name: payload.guardianName ?? '',
			guardian_consent: payload.guardianConsent ?? false,
			publish_name: payload.publishName ?? false,
			team_name: payload.teamName ?? ''
		})
	);
}

export async function decideRegistration(
	registrationId: string,
	decision: 'accepted' | 'declined'
): Promise<ContestRegistrationRow> {
	return mapRegistration(
		await apiClient.post(`/contest-registrations/${registrationId}/decide/`, { decision })
	);
}

export async function withdrawRegistration(registrationId: string): Promise<ContestRegistrationRow> {
	return mapRegistration(await apiClient.post(`/contest-registrations/${registrationId}/withdraw/`));
}

export async function disqualifyRegistration(
	registrationId: string
): Promise<ContestRegistrationRow> {
	return mapRegistration(
		await apiClient.post(`/contest-registrations/${registrationId}/disqualify/`)
	);
}

/** The separate, revocable consent. Its own call on purpose — withdrawing it must never look like
 *  withdrawing from the contest. */
export async function setPublishName(
	registrationId: string,
	publishName: boolean
): Promise<ContestRegistrationRow> {
	return mapRegistration(
		await apiClient.patch(`/contest-registrations/${registrationId}/publish-name/`, {
			publish_name: publishName
		})
	);
}

// ---- submissions and scoring ---------------------------------------------------------------

export async function getMySubmission(stageId: string): Promise<ContestSubmission> {
	return mapSubmission(await apiClient.get(`/contest-stages/${stageId}/submission/`));
}

export async function saveMySubmission(
	stageId: string,
	answers: { problemId: string; text: string; attachmentId?: string | null }[]
): Promise<ContestSubmission> {
	return mapSubmission(
		await apiClient.put(`/contest-stages/${stageId}/submission/`, {
			answers: answers.map((a) => ({
				problem_id: Number(a.problemId),
				text: a.text,
				attachment_id: a.attachmentId ? Number(a.attachmentId) : null
			}))
		})
	);
}

export async function submitMySubmission(stageId: string): Promise<ContestSubmission> {
	return mapSubmission(await apiClient.post(`/contest-stages/${stageId}/submit/`));
}

export async function getJudgingView(stageId: string): Promise<JudgingView> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.get<any>(`/contest-stages/${stageId}/submissions/?${lang()}`);
	return {
		stage: mapStage(raw.stage),
		problems: (raw.problems ?? []).map(mapProblem),
		submissions: (raw.submissions ?? []).map((row: any) => ({
			...mapSubmission(row),
			scores: (row.scores ?? []).map((cell: any) => ({
				problem: String(cell.problem),
				juror: mapPerson(cell.juror),
				points: cell.points ?? 0,
				note: cell.note ?? ''
			}))
		}))
	};
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function saveScores(
	submissionId: string,
	scores: { problem: string; points: number; note?: string }[]
): Promise<ContestSubmission & { scores: { problem: string; points: number; note: string }[] }> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.post<any>(`/contest-submissions/${submissionId}/scores/`, {
		scores: scores.map((s) => ({ problem: Number(s.problem), points: s.points, note: s.note ?? '' }))
	});
	return {
		...mapSubmission(raw),
		scores: (raw.scores ?? []).map((cell: any) => ({
			problem: String(cell.problem),
			points: cell.points ?? 0,
			note: cell.note ?? ''
		}))
	};
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

// ---- results, ranking, complaints ----------------------------------------------------------

export async function getResults(contestId: string): Promise<ResultsPayload> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.get<any>(`/contests/${contestId}/results/`);
	/* eslint-enable @typescript-eslint/no-explicit-any */
	return {
		publishedAt: raw.published_at ?? null,
		complaintsCloseAt: raw.complaints_close_at ?? null,
		complainBlockReason: raw.complain_block_reason ?? null,
		results: (raw.results ?? []).map(mapResult)
	};
}

export async function getRanking(contestId: string): Promise<RankingRow[]> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.get<any>(`/contests/${contestId}/ranking/`);
	return (raw.rows ?? []).map((row: any) => ({
		rank: row.rank ?? 0,
		registration: String(row.registration),
		number: row.number ?? 0,
		totalPoints: row.total_points ?? 0,
		maxPoints: row.max_points ?? 0,
		stagesEntered: row.stages_entered ?? 0,
		title: row.title ?? 'participant'
	}));
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function publishResults(contestId: string): Promise<Contest> {
	return mapContest(await apiClient.post(`/contests/${contestId}/publish-results/`));
}

export async function unpublishResults(contestId: string): Promise<Contest> {
	return mapContest(await apiClient.post(`/contests/${contestId}/unpublish-results/`));
}

export async function getComplaints(contestId: string): Promise<ContestComplaint[]> {
	const rows = await apiClient.get<unknown[]>(`/contests/${contestId}/complaints/`);
	return rows.map(mapComplaint);
}

export async function lodgeComplaint(contestId: string, text: string): Promise<ContestComplaint> {
	return mapComplaint(await apiClient.post(`/contests/${contestId}/complaints/`, { text }));
}

export async function answerComplaint(
	complaintId: string,
	answer: string
): Promise<ContestComplaint> {
	return mapComplaint(await apiClient.post(`/contest-complaints/${complaintId}/answer/`, { answer }));
}

export async function withdrawComplaint(complaintId: string): Promise<ContestComplaint> {
	return mapComplaint(await apiClient.post(`/contest-complaints/${complaintId}/withdraw/`));
}

// ---- the regulamin, the panel, the certificate ---------------------------------------------

export async function getContestRules(contestId: string): Promise<RulesPayload> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.get<any>(`/contests/${contestId}/rules/`);
	/* eslint-enable @typescript-eslint/no-explicit-any */
	return { version: raw.version ?? 0, sections: (raw.sections ?? []).map(mapRulesSection) };
}

export async function saveContestRules(
	contestId: string,
	sections: { key: string; order: number; body: string }[]
): Promise<RulesPayload> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.put<any>(`/contests/${contestId}/rules/`, { sections });
	/* eslint-enable @typescript-eslint/no-explicit-any */
	return { version: raw.version ?? 0, sections: (raw.sections ?? []).map(mapRulesSection) };
}

export async function publishContestRules(contestId: string): Promise<RulesVersionRow> {
	return mapRulesVersion(await apiClient.post(`/contests/${contestId}/rules/publish/`));
}

export async function getRulesVersions(contestId: string): Promise<RulesVersionRow[]> {
	const rows = await apiClient.get<unknown[]>(`/contests/${contestId}/rules/versions/`);
	return rows.map(mapRulesVersion);
}

export async function getRulesVersion(contestId: string, number: number): Promise<RulesVersionRow> {
	return mapRulesVersion(await apiClient.get(`/contests/${contestId}/rules/versions/${number}/`));
}

export async function getCompliance(contestId: string): Promise<CompliancePayload> {
	return mapCompliance(await apiClient.get(`/contests/${contestId}/compliance/`));
}

export async function getContestCertificate(
	contestId: string,
	resultId: string
): Promise<CertificatePayload> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw = await apiClient.get<any>(`/contests/${contestId}/certificate/${resultId}/`);
	/* eslint-enable @typescript-eslint/no-explicit-any */
	return {
		contest: {
			id: String(raw.contest.id),
			title: raw.contest.title ?? '',
			startsAt: raw.contest.starts_at ?? null,
			endsAt: raw.contest.ends_at ?? null,
			presetKey: raw.contest.preset_key ?? '',
			externalReferenceUrl: raw.contest.external_reference_url ?? ''
		},
		organiser: {
			displayName: raw.organiser.display_name ?? '',
			kind: raw.organiser.kind ?? 'person'
		},
		participant: {
			displayName: raw.participant.display_name ?? '',
			affiliation: raw.participant.affiliation ?? ''
		},
		result: {
			id: String(raw.result.id),
			rank: raw.result.rank ?? 0,
			title: raw.result.title ?? 'participant',
			totalPoints: raw.result.total_points ?? 0,
			maxPoints: raw.result.max_points ?? 0,
			publishedAt: raw.result.published_at ?? ''
		}
	};
}
