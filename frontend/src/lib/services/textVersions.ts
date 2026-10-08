// The management layer's bilingual text seam (backend `translations/`). Components and routes
// never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one `fetch()`.
//
// **Named for the endpoint (`/api/text-versions/`) and NOT `translations.ts`**, which is already
// taken, by the exercise-translation workflow (`submitTranslation`, `TranslationDraft`) — a
// genuinely different feature: that one is a stranger's submission a moderator decides on, this one
// is text written by the people who already run the thing. Writing this file as `translations.ts`
// silently replaced that one for about an hour; `svelte-check` is what said so.
//
// **One call writes every language**, which is the whole point: the owner asked for an editor that
// submits the change and its translation together *"so that … there's no sth like 'newer in PL by
// 4 minutes'"*. The backend stamps one timestamp across everything this sends, so two languages
// written here are exactly as new as each other.

import { apiClient } from '$lib/api/client';
import type { LanguageReading, TextVersion, TranslatableKind } from '$lib/types/translation';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapLanguageReading(raw: any): LanguageReading {
	return {
		locale: raw?.locale ?? '',
		requestedLocale: raw?.requested_locale ?? '',
		isFallback: raw?.is_fallback ?? false,
		available: Array.isArray(raw?.available) ? raw.available : [],
		originalLocale: raw?.original_locale ?? '',
		newerElsewhere: raw?.newer_elsewhere
			? { locale: raw.newer_elsewhere.locale, seconds: raw.newer_elsewhere.seconds ?? 0 }
			: null
	};
}

export function mapTextVersion(raw: any): TextVersion {
	return {
		locale: raw?.locale ?? '',
		isOriginal: raw?.is_original ?? false,
		heading: raw?.heading ?? '',
		body: raw?.body ?? '',
		updatedAt: raw?.updated_at ?? ''
	};
}

export function mapTextVersions(raw: any): TextVersion[] {
	return Array.isArray(raw) ? raw.map(mapTextVersion) : [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface VersionDraft {
	/** Both optional, because two kinds have only one of them — see `TranslatableKind`. The server
	 *  reads whichever its own registry entry says it has and ignores the other. */
	heading?: string;
	body?: string;
}

export interface WrittenText {
	heading: string;
	body: string;
	language: LanguageReading;
	textVersions: TextVersion[];
}

/**
 * Write a row's text in every language at once.
 *
 * A language whose heading and body are both blank is deleted server-side — that is how a
 * translation is taken back down, and why the editor can simply send both of its columns every
 * time. A language this call does not mention is left alone.
 */
export async function writeTextVersions(
	kind: TranslatableKind,
	id: string,
	originalLocale: string,
	versions: Record<string, VersionDraft>
): Promise<WrittenText> {
	const raw = await apiClient.put(`/text-versions/${kind}/${id}/`, {
		original_locale: originalLocale,
		versions
	});
	/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
	const body = raw as any;
	return {
		heading: body.heading ?? '',
		body: body.body ?? '',
		language: mapLanguageReading(body.text),
		textVersions: mapTextVersions(body.text_versions)
	};
}
