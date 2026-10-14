<script lang="ts" module>
	import type { CreationKind } from '$lib/types/creation';
	import type { FeatureFlagKey } from '$lib/types';

	/**
	 * The one next step an empty page offers. Exactly one of `href` (already passed through
	 * `resolve()` by the caller) or `onclick` (a dialog, a tab, a composer on the same page).
	 */
	export interface EmptyStateAction {
		label: string;
		href?: string;
		onclick?: () => void;
		/** The founding act behind it (`config/creation.py`): drawn only when the server said yes. */
		creation?: CreationKind;
		/** The kill switch the destination lives behind. */
		flag?: FeatureFlagKey;
		/** Needs an account. A signed-out reader gets a sign-in link in its place. */
		signedIn?: boolean;
	}

	/**
	 * The manual's chapters, by URL segment. A hand-kept copy of the slugs in
	 * `lib/content/guide/index.ts: GUIDE_CHAPTERS` rather than an import of it: that module pulls in
	 * every chapter's full text (~125 KB of prose), and this component sits on thirteen hubs. Only
	 * the slugs a hub actually links are listed — add one here when a hub needs it, after checking
	 * `GUIDE_CHAPTERS` has it. `e2e/empty-states.mjs` follows every link and fails on a slug the
	 * chapter page does not know.
	 */
	export type EmptyStateGuide =
		| 'exercises'
		| 'events'
		| 'tutoring'
		| 'concepts'
		| 'help'
		| 'messages'
		| 'flashcards'
		| 'contests';
</script>

<script lang="ts">
	// What an empty page says (2026-10-14, the empty-states pass). Before this, half the hubs said
	// "Nothing here yet" and stopped, which tells a first-time reader neither what the page is for
	// nor what to do about it being empty. This says both, in that order:
	//
	//   1. one sentence about what the page is for — never "nothing here";
	//   2. at most ONE primary action, and only one the reader can actually use: the creation gate
	//      (`creationStore`, which answers false until the server has said yes), the feature switch
	//      (with the moderator bypass `FeatureGate` and the backend both have) and the session are
	//      all asked here, so no hub can forget one (house rule 3 — never draw a button that fails);
	//   3. a "How this works →" link to the manual chapter, or an example page in the showcase.
	//
	// **"Nothing exists" and "your filter matched nothing" are different pages.** With `filtered`
	// set, this draws "nothing matches" and a "Clear filters" button instead of a create button:
	// offering to create a contest to somebody who has just narrowed the list to cancelled ones
	// answers a question they did not ask.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { creationStore } from '$lib/state/creation.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { ShowcaseSlug } from '$lib/content/showcase';

	let {
		message,
		action,
		guide,
		showcase,
		filtered = false,
		onclear,
		name
	}: {
		/** What this page is for. Ignored while `filtered` is on. */
		message: string;
		action?: EmptyStateAction;
		guide?: EmptyStateGuide;
		/** Used only when there is no `guide`: an example page under `/about/`. */
		showcase?: ShowcaseSlug;
		/** A filter is narrowing the list: say so and offer to clear it. */
		filtered?: boolean;
		onclear?: () => void;
		/** `data-empty-state` — what e2e scripts find it by. */
		name: string;
	} = $props();

	// Every showcase page, by literal route: `resolve()` refuses a route that does not exist, so a
	// slug added to `ShowcaseSlug` without its page fails `svelte-check` here rather than 404ing.
	const SHOWCASE_HREF: Record<ShowcaseSlug, string> = {
		exercises: resolve('/about/exercises'),
		flashcards: resolve('/about/flashcards'),
		'learning-record': resolve('/about/learning-record'),
		courses: resolve('/about/courses'),
		schools: resolve('/about/schools'),
		concepts: resolve('/about/concepts'),
		events: resolve('/about/events'),
		contests: resolve('/about/contests'),
		'goals-and-work': resolve('/about/goals-and-work'),
		tutoring: resolve('/about/tutoring'),
		materials: resolve('/about/materials'),
		conference: resolve('/about/conference')
	};

	const flagOn = $derived(
		!action?.flag || featureFlagsStore.isEnabled(action.flag) || authStore.isModerator
	);
	const needsAccount = $derived(Boolean(action?.signedIn || action?.creation));

	/** `'action'` draws the button, `'signIn'` the door to an account, `null` nothing at all. */
	const actionState = $derived.by((): 'action' | 'signIn' | null => {
		if (!action || !flagOn) return null;
		// While the session is being restored nothing is known, and a sign-in link shown to somebody
		// who is about to turn out signed in is the flash every gated page here already avoids.
		if (needsAccount && authStore.restoring) return null;
		if (needsAccount && !authStore.isAuthenticated) return 'signIn';
		if (action.creation && !creationStore.allows(action.creation)) return null;
		return 'action';
	});

	const howHref = $derived(
		guide
			? resolve('/about/guide/[chapter]', { chapter: guide })
			: showcase
				? SHOWCASE_HREF[showcase]
				: null
	);
</script>

<div class="empty-state" data-empty-state={name} data-empty-kind={filtered ? 'filtered' : 'empty'}>
	{#if filtered}
		<p class="empty-state__message">{m.empty_filteredNothing()}</p>
		<!-- "Nothing matches these filters." -->
		{#if onclear}
			<div class="empty-state__actions">
				<button type="button" class="empty-state__secondary" onclick={onclear}>
					{m.empty_clearFilters()}
					<!-- "Clear filters" -->
				</button>
			</div>
		{/if}
	{:else}
		<p class="empty-state__message">{message}</p>
		{#if actionState || howHref}
			<div class="empty-state__actions">
				{#if actionState === 'action' && action}
					{#if action.href}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href it already resolved (the prop's own contract); the rule cannot see across a prop -->
						<a class="empty-state__primary" href={action.href} data-empty-action>{action.label}</a>
					{:else}
						<button
							type="button"
							class="empty-state__primary"
							onclick={action.onclick}
							data-empty-action
						>
							{action.label}
						</button>
					{/if}
				{:else if actionState === 'signIn'}
					<a class="empty-state__secondary" href={resolve('/login')} data-empty-signin>
						{m.empty_signInToStart()}
						<!-- "Sign in to get started" -->
					</a>
				{/if}
				{#if howHref}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built by resolve() above, from a literal route -->
					<a class="empty-state__how" href={howHref} data-empty-how>
						{guide ? m.empty_howItWorks() : m.empty_seeAnExample()}
						<!-- "How this works →" / "See an example →" -->
					</a>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// A quiet panel rather than a line of grey text: it has to read as "this is the page, and here
	// is what to do", not as a status message that something failed to load. Dashed, like the
	// pending pill, because an empty list is "not settled yet", not an error.
	.empty-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 46rem;
		padding: var(--space-4);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface-alt);
	}
	.empty-state__message {
		margin: 0;
		color: var(--text-primary);
		line-height: 1.5;
	}
	.empty-state__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
	}
	.empty-state__primary {
		@include mix.button-primary;
		text-decoration: none;
	}
	.empty-state__secondary {
		@include mix.button-secondary;
		text-decoration: none;
	}
	.empty-state__how {
		@include mix.focus-ring;
		color: var(--accent);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	@media (max-width: 480px) {
		.empty-state {
			padding: var(--space-3);
		}
		// A full-width button is easier to hit with a thumb, and the link sits under it rather than
		// wrapping to a ragged second line beside it.
		.empty-state__actions {
			flex-direction: column;
			align-items: stretch;
		}
		.empty-state__how {
			align-self: flex-start;
		}
	}
</style>
