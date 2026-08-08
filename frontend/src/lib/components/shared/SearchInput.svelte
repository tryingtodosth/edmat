<script lang="ts">
	// A search box that submits — deliberately not the debounced, filter-as-you-type kind.
	//
	// The browse pages already have that one, and it is right there: the list is on screen and each
	// keystroke narrows it. This is the other kind, for the two places where searching means leaving
	// where you are and going to results — the homepage hero and the search page itself. Typing
	// there should not fire a request per keystroke against a corpus of 742 exercises, and it should
	// not navigate until somebody says so.
	//
	// Enter is guarded against an in-progress IME composition, where Enter means "accept this
	// candidate" rather than "submit" — see lib/utils/textInput.ts. Without it the first word of
	// every Chinese, Japanese or Korean query is eaten.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { isComposingKey } from '$lib/utils/textInput';

	let {
		value = '',
		placeholder = '',
		label,
		autofocus = false,
		onsubmit
	}: {
		value?: string;
		placeholder?: string;
		/** The accessible name. Required: the field renders no visible label, and a search box
		 * announced only as "edit text" is one a screen-reader user has to guess at. */
		label: string;
		autofocus?: boolean;
		onsubmit: (query: string) => void;
	} = $props();

	// Seeded from the prop and owned from then on, so typing is not fought by a parent that keeps
	// handing back the last submitted query.
	let draft = $state(untrack(() => value));
	let lastSeen = untrack(() => value);
	$effect(() => {
		if (value !== lastSeen) {
			lastSeen = value;
			draft = value;
		}
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit(draft);
	}
</script>

<form class="search-input" role="search" onsubmit={submit}>
	<label class="search-input__field">
		<span class="visually-hidden">{label}</span>
		<svg
			class="search-input__icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.5-3.5" />
		</svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="search"
			bind:value={draft}
			{placeholder}
			{autofocus}
			onkeydown={(e) => {
				if (e.key === 'Enter' && isComposingKey(e)) e.preventDefault();
			}}
		/>
	</label>
	<button type="submit">{m.common_search()}</button>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.search-input {
		display: flex;
		gap: var(--space-2);
		width: 100%;
	}

	.search-input__field {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
	}

	.search-input__icon {
		position: absolute;
		left: 0.7rem;
		width: 18px;
		height: 18px;
		color: var(--text-secondary);
		pointer-events: none;
	}

	input {
		@include mix.focus-ring;
		width: 100%;
		padding: var(--space-2) var(--space-3) var(--space-2) 2.4rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: inherit;
		font-size: var(--font-size-base);
	}

	button {
		@include mix.button-primary;
		padding: var(--space-2) var(--space-3);
		white-space: nowrap;
	}

	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
