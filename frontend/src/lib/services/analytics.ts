// Usage analytics (backend `analytics/`, 2026-10-14) — the staff dashboard at /moderation/analytics.
// Staff only: the API answers 401 without a session and 403 to a signed-in account that is not
// staff, exactly as the Mail tab's does.

import { apiClient } from '$lib/api/client';
import type {
	AnalyticsClientErrors,
	AnalyticsClients,
	AnalyticsCohorts,
	AnalyticsCommunity,
	AnalyticsContent,
	AnalyticsCoverage,
	AnalyticsDays,
	AnalyticsHealth,
	AnalyticsModeration,
	AnalyticsOverview,
	AnalyticsTraffic,
	RecomputeResult
} from '$lib/types/analytics';

export const ANALYTICS_DAYS: AnalyticsDays[] = [7, 30, 90, 365];

// Objects whose KEYS are data (a registry key, a locale, a status class) rather than field names:
// their keys are kept as the server sent them, only the values inside are converted.
const DATA_KEYED = new Set(['activity', 'features', 'translated', 'statuses']);

const toCamel = (key: string): string => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** snake_case → camelCase, recursively, leaving the keys of `DATA_KEYED` maps alone. The payloads
 *  are plain JSON trees with no ids to stringify (every id the dashboard links to already arrives
 *  as a string), so one walk is the whole mapper. */
function camelize(value: unknown, keepKeys = false): unknown {
	if (Array.isArray(value)) return value.map((v) => camelize(v));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
			out[keepKeys ? key : toCamel(key)] = camelize(inner, !keepKeys && DATA_KEYED.has(key));
		}
		return out;
	}
	return value;
}

async function read<T>(endpoint: string, days: AnalyticsDays, extra = ''): Promise<T> {
	const raw = await apiClient.get<unknown>(`/analytics/${endpoint}/?days=${days}${extra}`);
	return camelize(raw) as T;
}

export const getOverview = (days: AnalyticsDays) => read<AnalyticsOverview>('overview', days);
export const getTraffic = (days: AnalyticsDays) => read<AnalyticsTraffic>('traffic', days);
export const getContent = (days: AnalyticsDays, lang: string) =>
	read<AnalyticsContent>('content', days, `&lang=${encodeURIComponent(lang)}`);
export const getCommunity = (days: AnalyticsDays) => read<AnalyticsCommunity>('community', days);
export const getModeration = (days: AnalyticsDays) => read<AnalyticsModeration>('moderation', days);
export const getCoverage = (days: AnalyticsDays, lang: string) =>
	read<AnalyticsCoverage>('coverage', days, `&lang=${encodeURIComponent(lang)}`);
export const getCohorts = (days: AnalyticsDays) => read<AnalyticsCohorts>('cohorts', days);
export const getClients = (days: AnalyticsDays) => read<AnalyticsClients>('clients', days);
/** Browser error reports: the top error groups for the period (`backend/analytics/client_errors.py`). */
export const getClientErrors = (days: AnalyticsDays) =>
	read<AnalyticsClientErrors>('client-errors', days);
export const getHealth = () => read<AnalyticsHealth>('health', 30);

/** Recount yesterday and today now — the same delete-and-recount the nightly command does. */
export async function recomputeAnalytics(): Promise<RecomputeResult> {
	return camelize(await apiClient.post<unknown>('/analytics/recompute/')) as RecomputeResult;
}
