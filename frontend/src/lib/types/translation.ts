// The management layer's text in several languages (backend `translations/`, 2026-10-08).
//
// A task, a plan, a plan step, a need, a poll and a poll option each carry these two blocks:
// `language` says which language the text you just received actually is and what else exists,
// `textVersions` is every version, which is what the side-by-side editor fills its two columns
// from.
//
// THIS MIRRORS `backend/translations/resolve.py`, and that file says so from its side.

/** What `language` answers. Everything here is derived per request from the rows — nothing is
 *  stored. */
export interface LanguageReading {
	/** Which language the `title`/`description` you were handed actually are. `''` means nobody has
	 *  written a version at all, so the row's own column was used — every management row from
	 *  before this existed, and the one case where there is nothing to say about language. */
	locale: string;
	/** What was asked for (`?lang=`). */
	requestedLocale: string;
	/** We could not give you your own language. The page says so, rather than letting a reader
	 *  think the Polish they are looking at is the English. */
	isFallback: boolean;
	/** Every language somebody has written, sorted. */
	available: string[];
	/** The language it was written in — the one the row's own column mirrors. */
	originalLocale: string;
	/** "The Polish is 4 minutes newer than the English you are reading." `null` whenever there is
	 *  nothing to say: one language, you are on the newest one, or both were written in the same
	 *  submission — which is what the side-by-side editor is for. Seconds, because the wording is
	 *  an interface string and belongs in the message catalogue, not in the API. */
	newerElsewhere: { locale: string; seconds: number } | null;
}

/** One written version, for the editor. */
export interface TextVersion {
	locale: string;
	isOriginal: boolean;
	heading: string;
	body: string;
	updatedAt: string;
}

/** The kinds `backend/translations/targets.py` knows. Two of them are the mirror image of each
 *  other: a poll option has a heading and no body, an organisation a body and no heading (its
 *  `name` is a registered name and the same in every language). */
export type TranslatableKind =
	'task' | 'plan' | 'plan_step' | 'need' | 'poll' | 'poll_option' | 'organization';

/** A row that carries the two blocks. Every management type extends this, so one editor and one
 *  note component serve all six. */
export interface Translated {
	language: LanguageReading;
	textVersions: TextVersion[];
}

/** The empty reading, for a row from an endpoint that does not send the blocks yet — the honest
 *  "nothing has been written here", which is also what the backend answers for such a row. */
export const NO_LANGUAGE_READING: LanguageReading = {
	locale: '',
	requestedLocale: '',
	isFallback: false,
	available: [],
	originalLocale: '',
	newerElsewhere: null
};

// ---- the raw API shapes -----------------------------------------------------------------------
//
// `services/polls.ts` is the one management service with no mapper — it returns the API's own
// snake_case and `types/poll.ts` is written to match (an inconsistency that predates this change
// and is not worth a refactor of `PollsPanel` to undo). So the raw blocks get names of their own
// here, rather than a second hand-written copy inside `poll.ts`, and a component converts with
// `mapLanguageReading` / `mapTextVersions` at the point of use.

export interface RawLanguageReading {
	locale: string;
	requested_locale: string;
	is_fallback: boolean;
	available: string[];
	original_locale: string;
	newer_elsewhere: { locale: string; seconds: number } | null;
}

export interface RawTextVersion {
	locale: string;
	is_original: boolean;
	heading: string;
	body: string;
	updated_at: string;
}
