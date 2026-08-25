// Where to send somebody after they sign in or register: back to the page they were on when they
// clicked "Log in", not the home page. Remembered in sessionStorage rather than only in memory so a
// hard reload of the login page (a throttled retry, a typo in the URL) keeps the answer; scoped
// to the tab, so one tab's destination never leaks into another's.
//
// An explicit `?next=` on the login/register URL wins over the remembered page, and only
// same-origin paths are ever followed — a full URL or a protocol-relative `//host` is refused, so
// a crafted link cannot bounce a fresh session off to another site.

const KEY = 'edmat.returnTo';
const AUTH_PATHS = ['/login', '/register'];

function isSafePath(path: string | null | undefined): path is string {
	return !!path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

function isAuthPage(path: string): boolean {
	return AUTH_PATHS.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

/** Call from the auth pages' `afterNavigate`: records the in-app page the visitor arrived from.
 * Hopping between /login and /register keeps the earlier destination rather than replacing it. */
export function rememberReturnTo(from: URL | null | undefined): void {
	if (!from) return;
	const path = from.pathname + from.search;
	if (!isSafePath(path) || isAuthPage(from.pathname)) return;
	try {
		sessionStorage.setItem(KEY, path);
	} catch {
		/* storage refused (private mode, quota) — the fallback below still lands somewhere real */
	}
}

/** The destination to use once signed in, and forget it — it belongs to one sign-in. */
export function takeReturnTo(current: URL): string {
	const explicit = current.searchParams.get('next');
	let remembered: string | null = null;
	try {
		remembered = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
	} catch {
		/* see above */
	}
	if (isSafePath(explicit) && !isAuthPage(explicit)) return explicit;
	if (isSafePath(remembered)) return remembered;
	return '/';
}
