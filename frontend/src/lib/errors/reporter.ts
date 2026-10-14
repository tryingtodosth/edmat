// EdMat's own browser error reporter (2026-10-14, `LINKING-AND-ERRORS.md` §3.3; server half
// `backend/analytics/client_errors.py`). It tells the team that the site broke in somebody's
// browser, and nothing about who.
//
// THE CONTRACT — the owner approved it on the condition that it needs no consent banner, so every
// line below is load-bearing:
//
// - Sends only on an actual error, and only: the message (500 chars), the stack with every URL cut
//   to its path (no origin, query or fragment), the kind, the route TEMPLATE (`/exercises/[id]`,
//   never the address), the build id and the interface locale (`pl`/`en`).
// - Never: an account id or token (the beacon carries no `Authorization`), the page URL, query or
//   referrer, screen/viewport/timezone/language list, breadcrumbs, console output, DOM, form values.
// - NOTHING is written to the device: no cookie, no localStorage/sessionStorage/IndexedDB. The
//   per-load cap and dedupe live in this module's memory and die with the page. No retry, no queue.
// - Nothing at all under `navigator.globalPrivacyControl === true` or `doNotTrack === '1'`.
// - At most 5 reports per page load; an identical one (message + first frame) is sent once.
// - Errors that are only a browser extension's, and the opaque cross-origin "Script error.", are
//   dropped — they carry nothing we can fix.
// - Never throws. A reporter that crashes the page it is reporting on is worse than none.
//
// Loaded lazily (root layout `onMount` and `hooks.client.ts` `handleError` both `import()` it), so
// it costs the entry bundle nothing but the two import calls.

import { browser, version } from '$app/environment';
import { page } from '$app/state';
import { getLocale } from '$lib/paraglide/runtime';
import { sendClientError, type ClientErrorReport } from '$lib/services/clientErrors';
import { featureFlagsStore } from '$lib/state/featureFlags.svelte';

export const MAX_REPORTS_PER_LOAD = 5;
const MAX_MESSAGE = 500;
const MAX_STACK = 4096;
const MAX_BODY_BYTES = 8000;

let sent = 0;
const seen = new Set<string>();
let installed = false;

const URL_TOKEN = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s()<>"']+/g;
const POSITION = /(?::\d+){1,2}$/;

/** `https://edmat.net/_app/x.js?v=1#a:3:9` → `/_app/x.js:3:9`. The same rule as the server's
 *  `client_errors.strip_urls`, which re-applies it: a frame's `:line:col` stays, nothing else
 *  of the address does. */
export function stripUrls(text: string): string {
	return text.replace(URL_TOKEN, (token) => {
		let rest = token.slice(token.indexOf('://') + 3);
		let suffix = '';
		const position = POSITION.exec(rest);
		if (position && rest.slice(0, position.index).includes('/')) {
			suffix = position[0];
			rest = rest.slice(0, position.index);
		}
		const slash = rest.indexOf('/');
		const path = (slash >= 0 ? rest.slice(slash) : '/').split(/[?#]/, 1)[0] || '/';
		return path + suffix;
	});
}

function objects(): boolean {
	const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
	return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

function fromExtensionOnly(stack: string): boolean {
	const frames = stack.split('\n').filter((line) => line.includes('://'));
	return frames.length > 0 && frames.every((line) => line.includes('-extension://'));
}

function describe(value: unknown): { message: string; stack: string } {
	if (value instanceof Error) {
		return { message: `${value.name}: ${value.message}`, stack: String(value.stack ?? '') };
	}
	if (typeof value === 'string') return { message: value, stack: '' };
	try {
		return { message: String(value), stack: '' };
	} catch {
		return { message: '(unprintable)', stack: '' };
	}
}

function firstFrame(stack: string): string {
	return stack.split('\n').find((line) => /^\s*at\s|@/.test(line) && line.includes('/')) ?? '';
}

/** Build, check and send one report. `routeId` comes from SvelteKit's `handleError` when it has
 *  one; otherwise the current page's route template is read. */
export function report(
	kind: ClientErrorReport['kind'],
	error: unknown,
	message?: string,
	routeId?: string | null
): void {
	try {
		if (!browser || sent >= MAX_REPORTS_PER_LOAD || objects()) return;
		if (featureFlagsStore.isLoaded && !featureFlagsStore.isEnabled('client_errors')) return;
		const described = describe(error);
		const rawMessage = (message || described.message || '').trim();
		const rawStack = described.stack;
		if (!rawMessage || fromExtensionOnly(rawStack)) return;
		if (rawMessage.endsWith('Script error.') && !rawStack) return;

		const body: ClientErrorReport = {
			kind,
			message: stripUrls(rawMessage).slice(0, MAX_MESSAGE),
			stack: stripUrls(rawStack).slice(0, MAX_STACK),
			route: (routeId ?? page.route.id ?? '') || '(unknown)',
			build: version,
			locale: getLocale() === 'en' ? 'en' : 'pl'
		};
		const key = `${body.message}\n${firstFrame(body.stack)}`;
		if (seen.has(key)) return;
		seen.add(key);

		// The server refuses a body over 8 KB; a stack of multi-byte text could pass 4096 characters
		// and still be over it, so shrink until it fits rather than lose the report.
		const size = () => new Blob([JSON.stringify(body)]).size;
		while (size() > MAX_BODY_BYTES && body.stack.length > 0) {
			body.stack = body.stack.slice(0, Math.floor(body.stack.length / 2));
		}
		sent += 1;
		sendClientError(body);
	} catch {
		// Never let the reporter be the next error.
	}
}

function onError(event: ErrorEvent): void {
	report('error', event.error, event.error ? undefined : event.message);
}

function onRejection(event: PromiseRejectionEvent): void {
	report('rejection', event.reason);
}

/** Attach the two window listeners, once. Called from the root layout's `onMount`. */
export function install(): void {
	if (!browser || installed) return;
	installed = true;
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
}
