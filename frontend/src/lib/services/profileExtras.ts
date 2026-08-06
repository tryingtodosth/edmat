// Profile experience/skills and the derived activity feed — mirrors backend/accounts/profile_extras.py.

import type { ActivityFeed, ExperienceEntry, SkillEntry } from '$lib/types/profileExtras';
import { apiClient } from '$lib/api/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getUserExtras(
	userId: string
): Promise<{ experience: ExperienceEntry[]; skills: SkillEntry[] }> {
	const raw = await apiClient.get<any>(`/users/${encodeURIComponent(userId)}/extras/`);
	return {
		experience: (raw.experience ?? []).map((e: any) => ({
			id: String(e.id),
			kind: e.kind,
			title: e.title,
			organisation: e.organisation,
			startedOn: e.started_on,
			endedOn: e.ended_on,
			description: e.description,
			order: e.order
		})),
		skills: (raw.skills ?? []).map((s: any) => ({
			id: String(s.id),
			label: s.label,
			level: s.level,
			evidence: s.evidence,
			branchSlug: s.branch_slug ?? null,
			disciplineSlug: s.discipline_slug ?? null,
			order: s.order
		}))
	};
}

export async function getUserActivity(userId: string): Promise<ActivityFeed> {
	const raw = await apiClient.get<any>(`/users/${encodeURIComponent(userId)}/activity/`);
	return {
		items: (raw.items ?? []).map((i: any) => ({
			kind: i.kind,
			title: i.title,
			exerciseId:
				i.exercise_id !== undefined && i.exercise_id !== null ? String(i.exercise_id) : undefined,
			taughtCourseId:
				i.taught_course_id !== undefined && i.taught_course_id !== null
					? String(i.taught_course_id)
					: undefined,
			rating: i.rating,
			tags: i.tags ?? [],
			createdAt: i.created_at ?? null
		})),
		tags: raw.tags ?? [],
		kinds: raw.kinds ?? []
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* --- editing your own --------------------------------------------------------------------------
 * These write to `/me/...`, which is scoped to the signed-in account server-side — the id of the
 * profile being looked at is deliberately never sent. That is what makes it safe to put edit
 * controls on the public profile page: the page you are viewing has no say in whose rows change.
 */

function experienceBody(entry: Partial<ExperienceEntry>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (entry.kind !== undefined) body.kind = entry.kind;
	if (entry.title !== undefined) body.title = entry.title;
	if (entry.organisation !== undefined) body.organisation = entry.organisation;
	// A cleared date input must travel as null rather than '' — a blank string is not a date.
	if (entry.startedOn !== undefined) body.started_on = entry.startedOn || null;
	if (entry.endedOn !== undefined) body.ended_on = entry.endedOn || null;
	if (entry.description !== undefined) body.description = entry.description;
	if (entry.order !== undefined) body.order = entry.order;
	return body;
}

function skillBody(entry: Partial<SkillEntry>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (entry.label !== undefined) body.label = entry.label;
	if (entry.level !== undefined) body.level = entry.level;
	if (entry.order !== undefined) body.order = entry.order;
	// `evidence` is deliberately never sent: 'registry' means an institution said so, and the API
	// refuses to let anybody type it. Anything this form creates is self-declared by definition.
	return body;
}

export async function createExperience(entry: Partial<ExperienceEntry>): Promise<void> {
	await apiClient.post('/me/experience/', experienceBody(entry));
}

export async function updateExperience(id: string, entry: Partial<ExperienceEntry>): Promise<void> {
	await apiClient.patch(`/me/experience/${id}/`, experienceBody(entry));
}

export async function deleteExperience(id: string): Promise<void> {
	await apiClient.delete(`/me/experience/${id}/`);
}

export async function createSkill(entry: Partial<SkillEntry>): Promise<void> {
	await apiClient.post('/me/skills/', skillBody(entry));
}

export async function updateSkill(id: string, entry: Partial<SkillEntry>): Promise<void> {
	await apiClient.patch(`/me/skills/${id}/`, skillBody(entry));
}

export async function deleteSkill(id: string): Promise<void> {
	await apiClient.delete(`/me/skills/${id}/`);
}

/** Swap two neighbours' `order` values.
 *
 * Two PATCHes rather than a bulk reorder endpoint, because none exists and the list is short. It is
 * not atomic: a failure between them leaves both rows holding the same order, which the list's own
 * secondary sort still renders sensibly rather than losing anything.
 */
export async function swapOrder(
	kind: 'experience' | 'skill',
	a: { id: string; order: number },
	b: { id: string; order: number }
): Promise<void> {
	const update = kind === 'experience' ? updateExperience : updateSkill;
	await update(a.id, { order: b.order });
	await update(b.id, { order: a.order });
}
