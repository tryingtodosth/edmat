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
	// A FormData body (multipart file upload — see `postForm` below) must NEVER get an explicit
	// Content-Type set here: the browser generates one itself (`multipart/form-data;
	// boundary=...`), and the boundary value is only known to the browser's own FormData
	// serialization, not something this function could set correctly by hand.
	if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	const token = tokenStore.value;
	if (token) headers.set('Authorization', `Token ${token}`);

	// `credentials: 'omit'` — this app is Token-auth only (DRF's TokenAuthentication, via the
	// Authorization header above); no request this client ever makes needs a cookie. Left at
	// fetch()'s own default (`same-origin`) before this, that meant any stray `sessionid` cookie
	// (e.g. from visiting Django's own /admin/ in the same browser) would ride along on every
	// same-origin request once frontend+API share one origin in production (deploy/apache/
	// edmat.conf) — DRF's SessionAuthentication would then authenticate the request as THAT
	// session and enforce CSRF against it, which this client never sends a token for by design,
	// producing a real "CSRF Failed" 403 on an otherwise-correct Token-authenticated request. This
	// exact failure mode was already hit once for registration (LAUNCHCHECKLIST.md's own "First
	// production deployment" notes) and flagged as the right fix but never actually applied —
	// applied now, closing the whole bug class rather than leaving it to resurface per-endpoint.
	const res = await fetch(`${PUBLIC_API_BASE_URL}${path}`, {
		...init,
		headers,
		credentials: 'omit'
	});

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
	// A real file upload (materials.ts's `submitMaterial` — "exams, tests, etc. should be
	// accepted as PDF/PNG/LaTeX/Word documents") — `formData` is passed straight through as the
	// body, bypassing `toBody`'s JSON.stringify entirely; `request`'s own Content-Type guard above
	// is what makes this actually send as a real multipart body instead of broken JSON-encoded
	// FormData.
	postForm<T>(path: string, formData: FormData): Promise<T> {
		return request<T>(path, { method: 'POST', body: formData });
	},
	patch<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, { method: 'PATCH', body: toBody(data) });
	},
	// `postForm`'s counterpart, for editing a record that carries a file. Needed the moment an upload
	// is something you can CHANGE rather than only create — an event post whose picture the host
	// wants to swap has no other route: the file cannot go through `patch`, because JSON has no way
	// to carry it, and doing it as a second POST would mean the post briefly showing the old picture.
	patchForm<T>(path: string, formData: FormData): Promise<T> {
		return request<T>(path, { method: 'PATCH', body: formData });
	},
	// A genuine full-replace call (the materials-requirements governor edit, materials.ts's
	// setMaterialRequirements) — PUT reads more honestly than PATCH for "replace this whole list,"
	// and every prior HTTP-verb helper here already follows the same thin one-liner shape.
	put<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, { method: 'PUT', body: toBody(data) });
	},
	// `data` is optional — every pre-existing caller omits it (a plain DELETE by id-in-URL); the tag
	// "apply"/"un-apply" endpoint (exercises.TagViewSet.apply) is the first that needs a DELETE
	// carrying a real body (which kind/object_id to detach), the same {kind, object_id} shape its
	// own POST sibling already sends — fetch's own RequestInit.body works with any method, this was
	// just never plumbed through until now.
	delete<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, { method: 'DELETE', body: toBody(data) });
	}
};
