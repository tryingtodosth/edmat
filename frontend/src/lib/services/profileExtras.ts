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
			courseSlug: s.course_slug ?? null,
			fieldSlug: s.field_slug ?? null,
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
