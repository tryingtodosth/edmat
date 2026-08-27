// The homepage Activity tab's site-wide feed (GET /api/activity/, community/views.py's
// SiteActivityView) — deliberately near-placeholder, per the owner's own scoping ("almost as
// simple as placeholder — we will improve it later"): the newest public exercises, materials and
// solution/hint entries, merged newest-first server-side.
import { apiClient } from '$lib/api/client';

export interface ActivityItem {
	kind: 'exercise' | 'material' | 'solution_entry';
	entryKind?: 'hint' | 'solution';
	title: string;
	exerciseId?: string;
	materialId?: string;
	actorDisplayName: string;
	createdAt: string;
}

interface RawActivityItem {
	kind: ActivityItem['kind'];
	entry_kind?: 'hint' | 'solution';
	title: string;
	exercise_id?: number;
	material_id?: number;
	actor_display_name: string;
	created_at: string;
}

export async function getSiteActivity(): Promise<ActivityItem[]> {
	const raw = await apiClient.get<RawActivityItem[]>('/activity/');
	return raw.map((item) => ({
		kind: item.kind,
		entryKind: item.entry_kind,
		title: item.title,
		exerciseId: item.exercise_id === undefined ? undefined : String(item.exercise_id),
		materialId: item.material_id === undefined ? undefined : String(item.material_id),
		actorDisplayName: item.actor_display_name,
		createdAt: item.created_at
	}));
}
