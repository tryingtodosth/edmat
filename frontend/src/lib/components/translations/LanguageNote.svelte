<script lang="ts">
	// The one line that tells a reader which language they are actually looking at, and whether
	// somebody has written a newer version in the other one.
	//
	// Both halves come from the server's own reading (`backend/translations/resolve.py`); nothing is
	// guessed here. The gap arrives in SECONDS because the wording is an interface string — this is
	// the file that turns 240 into "4 minutes", in both catalogues.
	//
	// It draws nothing in the ordinary case, which is most of the time: one language, or the reader
	// is on the newest one, or both were written in the same submission — which is exactly what
	// `TranslateFields` exists to make the normal outcome.
	import { m } from '$lib/paraglide/messages.js';
	import type { LanguageReading } from '$lib/types/translation';

	let { language }: { language: LanguageReading } = $props();

	/** Coarse on purpose: "4 minutes" and "2 days" are the answers somebody acts on; "3 minutes and
	 *  51 seconds" is noise. Rounded DOWN, so the note never claims more of a gap than there is. */
	const gap = $derived.by(() => {
		const seconds = language.newerElsewhere?.seconds ?? 0;
		if (seconds <= 0) return '';
		if (seconds < 60 * 60)
			return m.language_gapMinutes({ count: Math.max(1, Math.floor(seconds / 60)) });
		// "{count} min"
		if (seconds < 60 * 60 * 24) return m.language_gapHours({ count: Math.floor(seconds / 3600) });
		// "{count} h"
		return m.language_gapDays({ count: Math.floor(seconds / 86400) });
		// "{count} days"
	});

	const upper = (locale: string) => locale.toUpperCase();
</script>

{#if language.newerElsewhere}
	<p class="note note--stale">
		{m.language_newerElsewhere({ locale: upper(language.newerElsewhere.locale), gap })}
		<!-- "A newer version exists in {locale} — {gap} newer than the one you are reading." -->
	</p>
{:else if language.isFallback && language.locale}
	<p class="note">
		{m.language_fallback({
			shown: upper(language.locale),
			wanted: upper(language.requestedLocale)
		})}
		<!-- "Shown in {shown}: nobody has written the {wanted} version yet." -->
	</p>
{/if}

<style lang="scss">
	.note {
		margin: 0.25rem 0 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	// "Drifted" is what `--status-warning` means in this codebase's colour vocabulary
	// (frontend/CLAUDE.md): near / stuck / short / drifted. Two languages out of step is drift.
	.note--stale {
		color: var(--status-warning);
	}
</style>
