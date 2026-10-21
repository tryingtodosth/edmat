import { apiClient } from '$lib/api/client';
import type { SuggestedPerson } from '$lib/types/people';

/** The people this reader already shares a roster with (`GET /api/people/suggestions/`). There is
 * no people search on this site by design (privacy); this is the list every "add a person" form
 * offers instead of a bare account-id box (owner, 2026-10-21: "give user a list instead"). */
export async function getPeopleSuggestions(): Promise<SuggestedPerson[]> {
	const raw = await apiClient.get<{
		people: { id: number; display_name: string; via: string[] }[];
	}>('/people/suggestions/');
	return (raw.people ?? []).map((row) => ({
		id: String(row.id),
		displayName: row.display_name ?? '',
		via: row.via ?? []
	}));
}
