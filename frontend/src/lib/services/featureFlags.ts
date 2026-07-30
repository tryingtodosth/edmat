// Platform-wide moderator kill switches (backend moderation/views.py's FeatureFlagViewSet). `list`
// is AllowAny — every part of the app (staff or not, logged in or not) needs to know the current
// state — `setFeatureFlag` is IsAdminUser-only server-side; a non-staff call throws a real ApiError
// the caller (the moderation page's own Flags tab) surfaces, matching this app's own established
// error-handling convention (grantNodeGovernor's own try/catch, moderation/+page.svelte).

import type { FeatureFlag, FeatureFlagKey } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapFeatureFlag, type RawFeatureFlag } from '$lib/api/mappers';

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
	const raw = await apiClient.get<RawFeatureFlag[]>('/feature-flags/');
	return raw.map(mapFeatureFlag);
}

export async function setFeatureFlag(
	key: FeatureFlagKey,
	isEnabled: boolean
): Promise<FeatureFlag> {
	const raw = await apiClient.patch<RawFeatureFlag>(`/feature-flags/${encodeURIComponent(key)}/`, {
		is_enabled: isEnabled
	});
	return mapFeatureFlag(raw);
}
