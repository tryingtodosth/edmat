import type { User } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapUser, type RawProfile } from '$lib/api/mappers';

export async function getUserById(id: string): Promise<User | undefined> {
	try {
		const raw = await apiClient.get<RawProfile>(`/users/${encodeURIComponent(id)}/`);
		return mapUser(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}
