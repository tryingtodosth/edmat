<script lang="ts">
	// The owner-only list behind the profile tile's "+ N unpublished": every exercise this account
	// contributed that is not shown to anyone right now. Same route shape as every other detail page
	// here — no `+page.ts`, an `$effect` keyed off `page.params.id` with the id-changed guard — and
	// the same honesty as the API behind it: the server hands a non-owner an empty list, so the page
	// also says in words that it is not theirs rather than showing "nothing here" to the wrong person.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { ResolvedExercise } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getMyUnpublishedExercises } from '$lib/services/exercises';
	import { authStore } from '$lib/state/auth.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';

	let exercises = $state<ResolvedExercise[]>([]);
	let loading = $state(true);
	let loadedForId: string | undefined;

	const isMe = $derived(Boolean(authStore.user && authStore.user.id === page.params.id));

	async function load(id: string) {
		if (id === loadedForId) return;
		loadedForId = id;
		loading = true;
		exercises = isMe ? await getMyUnpublishedExercises(getLocale()) : [];
		loading = false;
	}

	$effect(() => {
		// Re-run once the session resolves too: on a hard visit `authStore.init()` is still in flight
		// when this first fires, and a page that decided "not yours" from a not-yet-loaded session
		// would never look again.
		if (authStore.isAuthenticated) loadedForId = undefined;
		load(page.params.id!);
	});
</script>

<svelte:head>
	<title>{m.profile_unpublished_heading()} · {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
		<a href={resolve('/users/[id]', { id: page.params.id! })}>{m.profile_unpublished_back()}</a>
		<!-- "Back to profile" -->
	</nav>
	<h1>{m.profile_unpublished_heading()}</h1>
	<!-- "Unpublished exercises" -->

	{#if !isMe}
		<p class="muted">{m.profile_unpublished_notYours()}</p>
		<!-- "Only the account holder can see their unpublished exercises." -->
	{:else}
		<p class="muted">{m.profile_unpublished_intro()}</p>
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if exercises.length === 0}
			<p class="muted">{m.profile_unpublished_empty()}</p>
			<!-- "Everything you contributed is published." -->
		{:else}
			<div class="grid">
				{#each exercises as exercise (exercise.id)}
					<ExerciseCard {exercise} />
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb a {
		color: var(--accent);
	}
	.muted {
		color: var(--text-secondary);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-2);
	}
</style>
