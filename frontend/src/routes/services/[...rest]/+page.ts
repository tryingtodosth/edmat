// `/services` was this route's address until 2026-10-01; it is `/tutoring` now (and `/korki` for
// a Polish reader). This is the forwarding address, and it exists because the rename is being
// deployed to a site that has been live under the old one: a listing shared in a message, a link
// in somebody's notes, a browser bookmark — all of them point at `/services/…` and would
// otherwise land on a 404 page that tells the reader nothing about where the thing went.
//
// A rest parameter rather than four routes: it matches `/services` itself (a rest param matches
// zero segments) as well as `/services/12`, `/services/new` and `/services/watchlist`, so one
// file covers everything that ever existed under the old prefix, including anything somebody
// bookmarked before `watchlist` moved.
//
// **308, not 302.** The address changed permanently and the method must be preserved; a browser
// and a crawler should both stop asking for the old one.
//
// `localizeHref` rather than a bare string, so a Polish reader following an old `/services/12`
// link lands on `/korki/12` and not on an English address they did not choose.
//
// NOT prerendered: there is nothing to render, and a rest-parameter route has no entries to
// enumerate — the SPA fallback serves it and this `load` runs in the browser.
import { redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import type { PageLoad } from './$types';

export const prerender = false;

export const load: PageLoad = ({ params, url }) => {
	const rest = params.rest ? `/${params.rest}` : '';
	redirect(308, localizeHref(`/tutoring${rest}`) + url.search + url.hash);
};
