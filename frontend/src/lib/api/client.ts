// The one place that knows how to reach the real Django backend (Phase 2/3, CLAUDE.md Section 13's
// service-layer boundary) — base URL, DRF TokenAuthentication header injection, JSON (de)serialization,
// and turning a non-2xx response into a real, inspectable ApiError instead of a bare thrown string.
// Every lib/services/*.ts function goes through this; nothing outside lib/api/ ever calls fetch()
// directly against the backend.

import { PUBLIC_API_BASE_URL } from '$env/static/public';
import { tokenStore } from '$lib/state/token.svelte';

/** A non-2xx response, carrying the parsed JSON error body (DRF's own {field: [messages]} shape,
 * or {detail: "..."} for auth/permission failures) so callers can inspect specific fields rather
 * than just a generic message. */
export class ApiError extends Error {
	status: number;
	body: unknown;

	constructor(status: number, body: unknown) {
		super(ApiError.extractMessage(body, status));
		this.status = status;
		this.body = body;
	}

	private static extractMessage(body: unknown, status: number): string {
		if (body && typeof body === 'object') {
			const record = body as Record<string, unknown>;
			if (typeof record.detail === 'string') return record.detail;
			const firstKey = Object.keys(record)[0];
			const firstValue = firstKey ? record[firstKey] : undefined;
			if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') return firstValue[0];
		}
		return `Request failed with status ${status}`;
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	if (init.body !== undefined && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	const token = tokenStore.value;
	if (token) headers.set('Authorization', `Token ${token}`);

	const res = await fetch(`${PUBLIC_API_BASE_URL}${path}`, { ...init, headers });

	if (res.status === 204) return undefined as T;

	const contentType = res.headers.get('content-type') ?? '';
	const body = contentType.includes('application/json') ? await res.json() : undefined;

	if (!res.ok) throw new ApiError(res.status, body);
	return body as T;
}

function toBody(data: unknown): string | undefined {
	return data === undefined ? undefined : JSON.stringify(data);
}

export const apiClient = {
	get<T>(path: string): Promise<T> {
		return request<T>(path);
	},
	post<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, { method: 'POST', body: toBody(data) });
	},
	patch<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, { method: 'PATCH', body: toBody(data) });
	},
	delete<T>(path: string): Promise<T> {
		return request<T>(path, { method: 'DELETE' });
	}
};
