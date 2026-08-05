import type { User } from '$lib/types';
import type { PublicEducation } from '$lib/types/identity';
import { apiClient, ApiError } from '$lib/api/client';
import { mapUser, type RawProfile } from '$lib/api/mappers';
import { mapPublicEducation } from './identity';

export async function getUserById(id: string): Promise<User | undefined> {
	try {
		const raw = await apiClient.get<RawProfile>(`/users/${encodeURIComponent(id)}/`);
		return mapUser(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

/** The education claim on a public profile — null unless that account consented to show it.
 *
 * Deliberately its own function rather than a field on `User`: it rides on the same response, but
 * most accounts have none at all, and keeping it off the shared `User` type stops every component
 * that touches a user from having to think about somebody's transcript. Returns null both when
 * there is nothing and when consent withholds everything, so the caller renders no section rather
 * than an empty heading implying something is being hidden.
 */
export async function getUserEducation(id: string): Promise<PublicEducation | null> {
	try {
		const raw = await apiClient.get<{ education?: unknown }>(`/users/${encodeURIComponent(id)}/`);
		return mapPublicEducation(raw.education);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}
