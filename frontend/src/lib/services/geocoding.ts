import { apiClient, ApiError } from '$lib/api/client';

/** A place the address lookup found — everything the listing form needs to store a location. */
export interface GeocodeResult {
	label: string;
	lat: number;
	lon: number;
}

export interface GeocodeResponse {
	results: GeocodeResult[];
	/** OSM data is ODbL-licensed; the UI must show this wherever results are displayed. Carried on
	 * the response itself rather than hardcoded here, so the credit cannot drift from the data. */
	attribution: string;
}

interface RawGeocodeResponse {
	results: { label: string; lat: number; lon: number }[];
	attribution: string;
}

/** Thrown when the lookup service itself is unreachable or rate-limited — deliberately distinct
 * from "no results", so the UI can say "try again shortly" rather than "no such address". Confusing
 * the two makes a user retype a perfectly valid address wondering why it is not found. */
export class GeocodingUnavailableError extends Error {}

async function request(query: string): Promise<GeocodeResponse> {
	try {
		const raw = await apiClient.get<RawGeocodeResponse>(`/geocode/${query}`);
		return { results: raw.results ?? [], attribution: raw.attribution ?? '' };
	} catch (e) {
		// 503 is the backend saying Nominatim is down or the global 1-req/sec gate could not be
		// claimed; 429 is this account's own throttle. Both mean "try again", not "not found".
		if (e instanceof ApiError && (e.status === 503 || e.status === 429)) {
			throw new GeocodingUnavailableError(e.message);
		}
		throw e;
	}
}

/** Address text -> candidate places. Backs the search box in the location picker.
 *
 * Note this is called on SUBMIT, never per keystroke: it proxies to Nominatim, whose usage policy
 * caps the whole application at 1 request/second (see backend services/geocoding.py). A
 * search-as-you-type box would blow through that budget on a single user's one address. */
export async function searchAddress(query: string): Promise<GeocodeResponse> {
	const trimmed = query.trim();
	if (!trimmed) return { results: [], attribution: '' };
	return request(`?q=${encodeURIComponent(trimmed)}`);
}

/** Coordinates -> a readable address. Backs clicking or dragging the pin directly, so a tutor who
 * knows where they teach but not its postal address still ends up with a label on their listing. */
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult | null> {
	const response = await request(
		`?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`
	);
	return response.results[0] ?? null;
}
