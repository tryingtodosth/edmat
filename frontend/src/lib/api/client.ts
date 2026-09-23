// The one place that knows how to reach the real Django backend (Phase 2/3, CLAUDE.md Section 13's
// service-layer boundary) — base URL, DRF TokenAuthentication header injection, JSON (de)serialization,
// and turning a non-2xx response into a real, inspectable ApiError instead of a bare thrown string.
// Every lib/services/*.ts function goes through this; nothing outside lib/api/ ever calls fetch()
// directly against the backend.

import { PUBLIC_API_BASE_URL } from '$env/static/public';
import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
import { contentLocalesStore } from '$lib/state/contentLocales.svelte';
import { hiddenCountsStore } from '$lib/state/hiddenCounts.svelte';
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

// The viewing preference (AUDIENCE-BRIEF.md §1) rides on every BROWSE request as `?audience=`, added
// here rather than in each service so that no list can forget it. Only list-shaped paths — a detail
// page still resolves whatever it was linked to, and a preference must never make a shared link 404.
const AUDIENCE_LIST_PATHS = [
	/^\/exercises\/(\?|$)/,
	/^\/exercises\/random\//,
	/^\/branches\/[^/]+\/(exercises|materials)\//,
	/^\/materials\/(\?|$)/,
	/^\/materials\/recommended\//,
	/^\/events\/(\?|$)/,
	/^\/services\/(\?|$)/,
	/^\/courses\/(\?|$)/,
	/^\/activity\/(\?|$)/,
	// The concept hub's own list (CONCEPTS-BRIEF.md §5). A concept's AUDIENCE lives on its
	// articles, so `?audience=` narrows the hub to concepts that actually have a page written for
	// one of the reader's bands (or an `all` one) — and `/concepts/<slug>/` is deliberately not in
	// this list, because a detail page never narrows.
	/^\/concepts\/(\?|$)/
];
// The one shape where these two preferences are not a filter but a CHOICE: a concept's detail.
// `concepts/resolve.py` never narrows — it answers with whatever is published and says how exact
// the answer is — so sending the reader's bands and languages is what makes a primary-school
// reader land on the primary-school article, and what makes the fallback notice mean anything.
// Without them every reader resolves to `university` (`config.audience.DEFAULT_AUDIENCE`) and the
// notice fires for the wrong people. An explicit `?audience=`/`?lang=` in the URL still wins:
// `getConcepts`/`getConcept` set those first and neither is overwritten below. Only the concept
// itself — `/concepts/<slug>/articles/`, `/links/` and the rest are not this shape.
const AUDIENCE_PREFERENCE_PATHS = [/^\/concepts\/[^/?]+\/(\?|$)/];
function withAudience(path: string): string {
	const wanted =
		AUDIENCE_LIST_PATHS.some((re) => re.test(path)) ||
		AUDIENCE_PREFERENCE_PATHS.some((re) => re.test(path));
	if (!wanted) return path;
	let out = path;
	const bands = audienceFilterStore.param;
	if (bands && !/[?&]audience=/.test(out)) {
		out = `${out}${out.includes('?') ? '&' : '?'}audience=${encodeURIComponent(bands)}`;
	}
	// The content-language rule (AUDIENCE-BRIEF.md §5) rides the same hook: every browse list is
	// narrowed to the interface language plus the reader's extras; the server answers with how many
	// it left out, recorded below per path for HiddenLanguagesNotice.
	if (!/[?&]content_locales=/.test(out)) {
		out = `${out}${out.includes('?') ? '&' : '?'}content_locales=${encodeURIComponent(contentLocalesStore.param)}`;
	}
	return out;
}

/** Per-call options that are about the REQUEST rather than about its body.
 *
 * `anonymous` is the whole of the role preview (CONFERENCE-BRIEF.md §3.B): the same GET, with the
 * `Authorization` header simply not set, so the server answers with what it would answer a
 * signed-out visitor. It lives here because this is the only function in the app that attaches
 * that header, and a preview that filtered the response client-side instead would be a guess — the
 * thing it is meant to replace.
 *
 * It is deliberately not "log in as somebody else". No second token is ever minted, nothing is
 * stored, and the viewer's own token is untouched; the page simply asks the API a question without
 * saying who is asking. See `backend/testing/personas.py` for the Facebook "View As" post-mortem
 * that this shape is the answer to.
 *
 * Reads only, by construction: only `get`/`getText` take it. A write with no token is not a
 * preview of anything — it is a 401 — so there is nothing to offer.
 */
export interface RequestOptions {
	anonymous?: boolean;
}

async function request<T>(
	path: string,
	init: RequestInit = {},
	options: RequestOptions = {}
): Promise<T> {
	const headers = new Headers(init.headers);
	// A FormData body (multipart file upload — see `postForm` below) must NEVER get an explicit
	// Content-Type set here: the browser generates one itself (`multipart/form-data;
	// boundary=...`), and the boundary value is only known to the browser's own FormData
	// serialization, not something this function could set correctly by hand.
	if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	const token = tokenStore.value;
	if (token && !options.anonymous) headers.set('Authorization', `Token ${token}`);

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

	const hidden = res.headers.get('X-EdMat-Hidden-Languages');
	if (hidden !== null) hiddenCountsStore.record(path.split('?')[0], Number(hidden) || 0);

	if (res.status === 204) return undefined as T;

	const contentType = res.headers.get('content-type') ?? '';
	const body = contentType.includes('application/json')
		? await res.json()
		: contentType.startsWith('text/')
			? await res.text()
			: undefined;

	if (!res.ok) throw new ApiError(res.status, body);
	return body as T;
}

function toBody(data: unknown): string | undefined {
	return data === undefined ? undefined : JSON.stringify(data);
}

/** A binary response — the one shape `request` above cannot return, because it parses the body.
 *
 * Needed by the tier-checked event-document endpoint (`documents/views.py`), which serves the bytes
 * itself rather than publishing a `/media/` path, so the only way to get at them is a request that
 * carries the token. The caller turns the Blob into an object URL (and revokes it). The header and
 * `credentials: 'omit'` reasoning is identical to `request`'s — see the long note there.
 */
async function requestBlob(path: string): Promise<Blob> {
	const headers = new Headers();
	const token = tokenStore.value;
	if (token) headers.set('Authorization', `Token ${token}`);
	const res = await fetch(`${PUBLIC_API_BASE_URL}${path}`, { headers, credentials: 'omit' });
	if (!res.ok) {
		const contentType = res.headers.get('content-type') ?? '';
		throw new ApiError(
			res.status,
			contentType.includes('application/json') ? await res.json() : undefined
		);
	}
	return res.blob();
}

export const apiClient = {
	get<T>(path: string, options?: RequestOptions): Promise<T> {
		return request<T>(withAudience(path), {}, options);
	},
	/** A text response (an `.ics` export) — same headers, no JSON parse. */
	getText(path: string, options?: RequestOptions): Promise<string> {
		return request<string>(path, {}, options);
	},
	/** The raw bytes of a protected file (an event document). Same headers, no parse at all. */
	getBlob(path: string): Promise<Blob> {
		return requestBlob(path);
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
