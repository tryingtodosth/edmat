// YouTube and Vimeo videos inside content — recognised from a plain link, played only on a click.
//
// **Storage holds the URL, never an `<iframe>`.** Somebody writes (or pastes) a video's ordinary
// address on a line of its own; `renderContent.ts` turns that paragraph into a click-to-play box,
// and the box becomes a player only when the reader asks for it (`mountVideoPlayer` below, wired
// by `MathContent` and `VideoEmbed`). So the sanitizer is NOT widened to iframes on either side
// (`config/sanitize.py`, DOMPurify), a link written into prose stays a link, and the same text reads
// as a working URL in a mail, an export or anywhere else that does not run this file.
//
// **Why click-to-play and not a player straight away:** loading YouTube's or Vimeo's player hands the
// reader's IP address to Google or Vimeo and lets them set their own cookies and storage. EdMat has
// no consent banner (`LEGAL.md` "Cookies", `ANALYTICS-LAW.md` §3), so nothing may load from a third
// party until the reader asks for exactly that — at which point it is a service they requested (PKE
// art. 399 ust. 3 pkt 2). The box also carries no thumbnail, because a thumbnail is fetched from
// the same companies. YouTube is played from `youtube-nocookie.com` and Vimeo with `dnt=1`, which
// reduces what they keep; it does not make the request anonymous, and `/privacy` says so.
//
// Every value that reaches an iframe `src` is re-validated here at click time, not trusted from the
// DOM: content allows raw HTML, so anybody can WRITE a `<div class="video-embed" data-video-id=…>`
// by hand. The most forged markup can do is embed some other YouTube or Vimeo video — exactly what
// pasting its link does.

export type VideoProvider = 'youtube' | 'vimeo';

export interface VideoRef {
	provider: VideoProvider;
	id: string;
	/** Start offset in whole seconds, when the link carried one (`?t=90`, `#t=1m30s`). */
	start?: number;
	/** Vimeo's privacy hash for an unlisted video (`vimeo.com/123/abcdef`, `?h=abcdef`). */
	hash?: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i;

export const PROVIDER_NAMES: Record<VideoProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo' };
export const PLAYER_HOSTS: Record<VideoProvider, string> = {
	youtube: 'youtube-nocookie.com',
	vimeo: 'player.vimeo.com'
};

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds; anything else → undefined. */
function parseStart(raw: string | null | undefined): number | undefined {
	if (!raw) return undefined;
	if (/^\d+$/.test(raw)) return Number(raw) || undefined;
	const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
	if (!m || !(m[1] || m[2] || m[3])) return undefined;
	const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
	return total || undefined;
}

/**
 * A YouTube or Vimeo address → which video, or null for anything else (including a channel, a
 * playlist on its own, or a lookalike host). Only https/http, only the providers' own hosts.
 */
export function parseVideoUrl(raw: string): VideoRef | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	const parts = url.pathname.split('/').filter(Boolean);
	const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
	const start = parseStart(
		url.searchParams.get('t') ?? url.searchParams.get('start') ?? hashParams.get('t')
	);

	let id: string | undefined;
	if (host === 'youtu.be') {
		id = parts[0];
	} else if (
		host === 'youtube.com' ||
		host === 'm.youtube.com' ||
		host === 'music.youtube.com' ||
		host === 'youtube-nocookie.com'
	) {
		if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
		else if (parts.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0]))
			id = parts[1];
	}
	if (id !== undefined) {
		return YOUTUBE_ID.test(id) ? { provider: 'youtube', id, ...(start ? { start } : {}) } : null;
	}

	if (host === 'vimeo.com' || host === 'player.vimeo.com') {
		// vimeo.com/123, vimeo.com/123/hash, player.vimeo.com/video/123, and the channel/group/
		// showcase forms whose last numeric segment is the video.
		let vid: string | undefined;
		let hash: string | undefined;
		if (host === 'player.vimeo.com') {
			if (parts[0] === 'video') vid = parts[1];
		} else if (parts.length >= 1 && VIMEO_ID.test(parts[0])) {
			vid = parts[0];
			if (parts[1] && VIMEO_HASH.test(parts[1])) hash = parts[1];
		} else if (['channels', 'groups', 'showcase', 'album'].includes(parts[0])) {
			const last = parts[parts.length - 1];
			if (parts.length >= 3 && VIMEO_ID.test(last)) vid = last;
		}
		hash ??= url.searchParams.get('h') ?? undefined;
		if (!vid || !VIMEO_ID.test(vid)) return null;
		return {
			provider: 'vimeo',
			id: vid,
			...(hash && VIMEO_HASH.test(hash) ? { hash } : {}),
			...(start ? { start } : {})
		};
	}
	return null;
}

/** Is this a well-formed reference? The gate in front of every iframe `src`. */
function isValid(v: VideoRef): boolean {
	if (v.provider === 'youtube') return YOUTUBE_ID.test(v.id);
	if (v.provider !== 'vimeo' || !VIMEO_ID.test(v.id)) return false;
	return v.hash === undefined || VIMEO_HASH.test(v.hash);
}

/** The player address — only ever built from a validated reference. Autoplays, because the click
 * that loads it IS the request to play. */
export function playerSrc(v: VideoRef): string | null {
	if (!isValid(v)) return null;
	const start = v.start && Number.isInteger(v.start) && v.start > 0 ? v.start : undefined;
	if (v.provider === 'youtube') {
		const q = new URLSearchParams({ autoplay: '1', rel: '0' });
		if (start) q.set('start', String(start));
		return `https://www.youtube-nocookie.com/embed/${v.id}?${q}`;
	}
	const q = new URLSearchParams({ autoplay: '1', dnt: '1' });
	if (v.hash) q.set('h', v.hash);
	return `https://player.vimeo.com/video/${v.id}?${q}${start ? `#t=${start}s` : ''}`;
}

/** The video's own page, for the "open on YouTube" link. */
export function watchUrl(v: VideoRef): string {
	if (v.provider === 'youtube') {
		return `https://www.youtube.com/watch?v=${v.id}${v.start ? `&t=${v.start}s` : ''}`;
	}
	return `https://vimeo.com/${v.id}${v.hash ? `/${v.hash}` : ''}${v.start ? `#t=${v.start}s` : ''}`;
}

/** The player iframe's permissions — shared by `mountVideoPlayer` and `VideoEmbed.svelte`. */
export const PLAYER_ALLOW =
	'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write';
/** YouTube refuses to play (error 153) without a referrer; this sends only our origin. */
export const PLAYER_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** Reads a reference back off a click-to-play box's `data-*` attributes; null unless it is valid. */
export function readVideoData(el: HTMLElement): VideoRef | null {
	const provider = el.dataset.videoProvider;
	const id = el.dataset.videoId ?? '';
	if (provider !== 'youtube' && provider !== 'vimeo') return null;
	const start = el.dataset.videoStart ? Number(el.dataset.videoStart) : undefined;
	const v: VideoRef = {
		provider,
		id,
		...(el.dataset.videoHash ? { hash: el.dataset.videoHash } : {}),
		...(start && Number.isInteger(start) && start > 0 ? { start } : {})
	};
	return isValid(v) ? v : null;
}

/**
 * Builds the player iframe through the DOM (never through an HTML string) and puts it where the
 * box's frame is. Returns false when the box does not describe a real video, in which case nothing
 * is loaded and the box stays as it was.
 */
export function mountVideoPlayer(box: HTMLElement, title: string): boolean {
	const ref = readVideoData(box);
	const src = ref && playerSrc(ref);
	const frame = box.querySelector<HTMLElement>('.video-embed__frame');
	if (!ref || !src || !frame) return false;
	const iframe = document.createElement('iframe');
	iframe.src = src;
	iframe.title = title;
	iframe.allow = PLAYER_ALLOW;
	iframe.allowFullscreen = true;
	iframe.referrerPolicy = PLAYER_REFERRER_POLICY;
	frame.replaceChildren(iframe);
	box.classList.add('video-embed--playing');
	return true;
}
