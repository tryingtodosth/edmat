<script lang="ts">
	/** One panel folded to a line.
	 *
	 * The owner, 2026-10-08: *"simplify and clean as rn its overwehalming: most things should be
	 * hidden under some kind of expandable sth"*, on an event or a course page. An `/events/[id]`
	 * mounts sixteen panels below the hero (programme, contributions, registration fields,
	 * registrations, staff, venue, checklist, documents, tickets, rota, cloakroom, the seven
	 * management panels, deck placements, related courses, updates, roster) and every one of them
	 * drew at full height, so the attendee list was four screens below the date.
	 *
	 * **Used INSIDE a panel, never wrapped around one from the page.** A panel decides for itself
	 * whether it has anything to draw — its own kill switch, and whether this reader may see what it
	 * holds — and house rule 3 says a killed feature takes its own surface away rather than leaving
	 * a sign where it used to be. A fold wrapped around a panel from the outside cannot know that,
	 * so it would leave a header with nothing behind it. A panel that loads first and then renders
	 * this can also put its own count on the line, which is the whole value of a shut section: a
	 * reader decides whether to open it from what the line says.
	 *
	 * **The body is destroyed while shut**, not hidden with `hidden`. The data is already loaded by
	 * the panel above, so what is saved is DOM, KaTeX typesetting and the layout of several hundred
	 * nodes — which is the cost the owner was actually complaining about. The trade is that a form
	 * left half-written inside a section is gone if you shut it, and that is the right way round:
	 * shutting a section is the reader saying they are done with it.
	 *
	 * **Nothing here is `<details>`.** The native element cannot put a count and an action menu on
	 * its summary line without nesting interactive content inside a `<summary>` (a real a11y
	 * problem, not a style one), and its open state does not survive a reload. A button with
	 * `aria-expanded` and `aria-controls` is the same promise, kept.
	 */
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { foldedSections } from '$lib/state/foldedSections.svelte';

	let {
		key,
		title,
		count = null,
		note = null,
		openByDefault = false,
		level = 2,
		onopen,
		actions,
		children
	}: {
		/** The section's NAME, not its title — it is the localStorage key, so it must not change
		 * with the interface language, and it is shared by every page that draws this section. */
		key: string;
		title: string;
		/** Shown on the shut line, which is how a reader decides whether to open it. `0` is drawn:
		 * "Needs 0" is an answer, and a missing badge is not. */
		count?: number | string | null;
		/** One short phrase after the title for a section whose count is not the point ("3 met"). */
		note?: string | null;
		openByDefault?: boolean;
		/** `2` on a page whose panels are top-level, `3` inside one that already has an `<h2>`. */
		level?: 2 | 3;
		/** Fired when the section becomes open, including on first render if the reader had left it
		 * open. For a panel that only fetches what it shows — the body is destroyed while shut, so a
		 * panel cannot see the click itself. The callback must be idempotent; it fires again every
		 * time the section is reopened. */
		onopen?: () => void;
		/** Drawn on the header line, right of the title, and only while the section is open — an
		 * "Add…" menu on a shut line is a control for something you cannot see. */
		actions?: Snippet;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const bodyId = `fold-${uid}`;
	const open = $derived(foldedSections.isOpen(key, openByDefault));
	$effect(() => {
		if (open) onopen?.();
	});
</script>

<section class="fold" class:fold--open={open} data-fold={key}>
	<div class="fold__head">
		<svelte:element this={`h${level}`} class="fold__heading">
			<button
				type="button"
				class="fold__toggle"
				aria-expanded={open}
				aria-controls={bodyId}
				onclick={() => foldedSections.toggle(key, openByDefault)}
			>
				<span class="fold__chevron" aria-hidden="true"></span>
				<span class="fold__title">{title}</span>
				{#if count !== null && count !== ''}
					<span class="fold__count">{count}</span>
				{/if}
				{#if note}
					<span class="fold__note">{note}</span>
				{/if}
				<span class="fold__hint">
					{open ? m.fold_collapse() : m.fold_expand()}
					<!-- "Hide" / "Show" -->
				</span>
			</button>
		</svelte:element>
		{#if actions && open}
			<div class="fold__actions">{@render actions()}</div>
		{/if}
	</div>
	<div id={bodyId} class="fold__body">
		{#if open}{@render children()}{/if}
	</div>
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.fold {
		@include mix.card-surface;
		overflow: hidden;
	}

	.fold__head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		// The header is the whole hit area when there are no actions, so the padding lives on the
		// button rather than here — a 40px line the reader has to aim at the middle of is the thing
		// that makes a folded page feel worse than an unfolded one.
		padding-right: var(--space-3);
	}

	.fold__heading {
		flex: 1 1 auto;
		margin: 0;
		min-width: 0;
		font-size: inherit;
		font-weight: inherit;
	}

	.fold__toggle {
		@include mix.focus-ring;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-3);
		background: none;
		border: 0;
		border-radius: var(--radius-md);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;

		&:hover {
			background: var(--bg-surface-alt);
		}
		&:hover .fold__hint {
			opacity: 1;
		}
	}

	.fold__chevron {
		flex: none;
		width: 0;
		height: 0;
		border-top: 5px solid transparent;
		border-bottom: 5px solid transparent;
		border-left: 7px solid var(--text-secondary);
		transition: transform 120ms ease;
		// The triangle rotates about its own middle, which is a third of its width from the point.
		transform-origin: 35% 50%;

		.fold--open & {
			transform: rotate(90deg);
		}
	}

	.fold__title {
		font-size: var(--font-size-base);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fold__count {
		@include mix.neutral-pill;
		flex: none;
	}

	.fold__note,
	.fold__hint {
		font-size: var(--font-size-sm);
		font-weight: 400;
		color: var(--text-secondary);
	}

	.fold__note {
		flex: none;
	}

	.fold__hint {
		// Present for a pointer that hovers and for a keyboard that focuses, and never the thing a
		// screen reader announces — `aria-expanded` on the button already says it, and saying it
		// twice reads as two different controls.
		margin-left: auto;
		flex: none;
		opacity: 0;
		transition: opacity 120ms ease;

		.fold__toggle:focus-visible & {
			opacity: 1;
		}
	}

	.fold__actions {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.fold__body:not(:empty) {
		padding: 0 var(--space-3) var(--space-3);
	}
</style>
