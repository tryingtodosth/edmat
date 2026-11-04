<script lang="ts">
	// "One chip, two marks" — the owner's decision of 2026-10-07, kept literally: a three-people
	// icon on top ("the community thinks this is AI-assisted") and a single-person icon below it
	// ("the author marked it"), each lighting on its own, so the chip says WHO is claiming it. A
	// single tri-state badge would have lost exactly that, and "the author told us" and "readers
	// suspect" are claims with very different standing.
	//
	// **It draws nothing until one of the two marks is actually lit** (or a moderator has fixed the
	// reading, which is a statement by a person too). That is stricter than "somebody has voted",
	// and deliberately so: a chip reading "80%" off ONE vote looks like a figure the community
	// arrived at, which is the opposite of what `MIN_VOTES_FOR_COMMUNITY_MARK` exists to say. Below
	// the threshold there is no claim to show — the dialog says "not enough people have looked"
	// to anybody who opens it, and the person who voted still sees their own vote there.
	//
	// It follows that the percentage on this chip is never unattributed: it is shown only when the
	// author, the readers or a moderator is standing behind it.
	//
	// **It reads "N% AI" on its face, and on every exercise and material it is ALWAYS there**
	// (owner, 2026-11-02: *"it doesnt even have AI in/near the badge"*, then *"(percentage% AI) that
	// should be in each exercise/material"*). Until then the word lived only in the title and the
	// chip drew nothing on unclaimed content. `always` (the exercise and the material pages) draws
	// it unconditionally; everywhere else — a hint, a comment, a review — it still appears only once
	// somebody claims something, because "0% AI" under every comment is noise, not information.
	//
	// The printed number is `shownScore`, NOT `score`, and the rule lives in the backend
	// (`provenance/rules.py: _shown`): it is the score only when a moderator, the author or at least
	// three readers stand behind it, and 0 otherwise — so "always shown" did not undo the rule above
	// about one vote looking like a community. `basis` says which, and the title says it in words.
	import { m } from '$lib/paraglide/messages.js';
	import type { AssistanceReading, AssistanceTargetKind } from '$lib/types/provenance';
	import { useAiAssistance } from './aiAssistance.svelte';
	import AiAssistModal from './AiAssistModal.svelte';

	let {
		kind,
		id,
		always = false,
		interactive = true
	}: {
		kind: AssistanceTargetKind;
		id: string;
		/** Draw it even when nobody has claimed anything ("0% AI") — the exercise and material pages. */
		always?: boolean;
		/** False on a list card: the chip is a LABEL there, not a button. A card is clickable as a
		 *  whole (`ExerciseCard`'s `openExercise`), and a dialog opened from inside it would be one
		 *  stray click on its padding away from navigating; the reading and the vote are one click
		 *  further, on the content's own page. */
		interactive?: boolean;
	} = $props();

	const assistance = useAiAssistance();

	// Registration is idempotent and cheap, and re-runs freely — which it does, on every unrelated
	// state change in the subtree (frontend/CLAUDE.md trap 2). The holder coalesces.
	$effect(() => {
		assistance?.register(kind, id);
	});

	const reading = $derived(assistance?.reading(kind, id));
	const claimed = $derived(
		!!reading && (reading.authorMarked || reading.communityMarked || reading.locked)
	);

	let open = $state(false);

	const label = $derived.by(() => {
		if (!reading) return '';
		// On a card there is nothing to open, so the "open it to…" half is left off.
		if (reading.basis === 'none')
			return interactive ? m.aiAssist_chip_none() : m.aiAssist_chip_noneShort();
		// "Nobody has marked this as AI-assisted — open it to give your reading" / "…as AI-assisted"
		if (reading.basis === 'too_few')
			return interactive ? m.aiAssist_chip_tooFew() : m.aiAssist_chip_tooFewShort();
		// "Not enough readers have weighed in yet — open it to give yours" / "…weighed in yet"
		if (reading.authorMarked && reading.communityMarked) return m.aiAssist_chip_both();
		// "Marked AI-assisted by its author, and readers agree"
		if (reading.authorMarked) return m.aiAssist_chip_author();
		// "The author marked this as AI-assisted"
		if (reading.communityMarked) return m.aiAssist_chip_community();
		// "Readers think this was written with AI"
		if (reading.basis === 'readers') return m.aiAssist_chip_readers();
		// "Readers’ reading of how much AI helped write this"
		// Neither mark lit and the chip still drawn means a moderator has fixed the reading.
		return m.aiAssist_lockedShort();
		// "A moderator has fixed this reading"
	});
</script>

{#snippet face(reading: AssistanceReading)}
	<span class="marks" aria-hidden="true">
		<!-- The community: three people. Lit when enough readers, confident enough, say so. -->
		<svg class="mark" class:mark--lit={reading.communityMarked} viewBox="0 0 24 10">
			<circle cx="5" cy="3.2" r="2.4" />
			<circle cx="12" cy="2.6" r="2.8" />
			<circle cx="19" cy="3.2" r="2.4" />
			<path d="M0.6 10c0.6-2.4 2.2-3.6 4.4-3.6S9 7.6 9.6 10z" />
			<path d="M6.8 10c0.7-2.8 2.5-4.2 5.2-4.2s4.5 1.4 5.2 4.2z" />
			<path d="M14.4 10c0.6-2.4 2.2-3.6 4.4-3.6S22.8 7.6 23.4 10z" />
		</svg>
		<!-- The author: one person. Lit when they have said a machine helped. -->
		<svg class="mark" class:mark--lit={reading.authorMarked} viewBox="0 0 24 10">
			<circle cx="12" cy="2.8" r="2.8" />
			<path d="M6.4 10c0.8-2.9 2.8-4.3 5.6-4.3s4.8 1.4 5.6 4.3z" />
		</svg>
	</span>
	<span class="score">{m.aiAssist_chip_percent({ percent: reading.shownScore })}</span>
	<!-- "{percent}% AI" -->
	{#if reading.locked}
		<span class="locked" aria-hidden="true" title={m.aiAssist_lockedShort()}>🔒</span>
		<!-- "A moderator has fixed this reading" -->
	{/if}
{/snippet}

{#if reading && (claimed || always)}
	{#if interactive}
		<button
			type="button"
			class="chip"
			class:chip--lit={reading.authorMarked || reading.communityMarked}
			aria-label={`${m.aiAssist_chip_name()} — ${label}`}
			title={label}
			onclick={() => (open = true)}
		>
			{@render face(reading)}
		</button>
	{:else}
		<!-- A label on a list card: an image of a reading, named in full for a screen reader. -->
		<span
			class="chip chip--label"
			class:chip--lit={reading.authorMarked || reading.communityMarked}
			role="img"
			aria-label={`${m.aiAssist_chip_percent({ percent: reading.shownScore })} — ${label}`}
			title={label}
		>
			{@render face(reading)}
		</span>
	{/if}
{/if}

{#if open}
	<AiAssistModal {kind} {id} onClose={() => (open = false)} />
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.chip {
		@include mix.focus-ring;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--border-color);
		border-radius: 999px;
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
		font-size: var(--font-size-xs, 0.75rem);
		line-height: 1.4;
		white-space: nowrap;
		cursor: pointer;
		&:hover {
			border-color: var(--text-secondary);
			color: var(--text-primary);
		}
	}
	// A label does not invite a click: no pointer, no hover change.
	.chip--label {
		cursor: default;
		&:hover {
			border-color: var(--border-color);
			color: var(--text-secondary);
		}
	}
	// Lit means somebody is actually claiming it, which is a caution and not an error: the content
	// may be perfectly good and declared. `--status-warning` is the colour pass's 5.88:1 token.
	.chip--lit {
		border-color: var(--status-warning);
		color: var(--status-warning);
		background: var(--status-warning-bg);
	}
	.marks {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	// Unlit is a COLOUR and not an opacity: frontend/CLAUDE.md's colour vocabulary says never dim
	// content with opacity, and a 25%-alpha glyph is also the first thing to disappear in high
	// contrast. Both icons are `aria-hidden`, so the meaning is carried by the chip's own label and
	// title — these only have to read as on and off.
	.mark {
		width: 0.85rem;
		height: 0.36rem;
		fill: var(--border-color);
	}
	.mark--lit {
		fill: currentColor;
	}
	.score {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.locked {
		font-size: 0.7em;
	}
</style>
