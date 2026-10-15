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
	import { getMyExerciseSubmissions } from '$lib/services/submissions';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let exercises = $state<ResolvedExercise[]>([]);
	// What was SENT and is not published yet — waiting for a moderator, or not accepted. Those are not
	// exercises at all until a moderator approves them, so the list above never had them, and this page
	// said "everything you contributed is published" to somebody with a submission still in the queue
	// (first-visitor audit, finding 5). Counted here and listed on `/submit/mine`, where they live.
	let waiting = $state(0);
	let notAccepted = $state(0);
	let loading = $state(true);
	let loadedForId: string | undefined;

	const submissionsOn = $derived(
		featureFlagsStore.isEnabled('exercise_submissions') || authStore.isModerator
	);

	const isMe = $derived(Boolean(authStore.user && authStore.user.id === page.params.id));

	async function load(id: string) {
		if (id === loadedForId) return;
		loadedForId = id;
		loading = true;
		const [unpublished, sent] = await Promise.all([
			isMe ? getMyUnpublishedExercises(getLocale()) : Promise.resolve([]),
			// A refusal here (the switch off, a network blip) must not take the exercises list down
			// with it: the counts are an addition to this page, not its subject.
			isMe && submissionsOn
				? getMyExerciseSubmissions(getLocale()).catch(() => [])
				: Promise.resolve([])
		]);
		exercises = unpublished;
		waiting = sent.filter((s) => s.status === 'pending').length;
		notAccepted = sent.filter((s) => s.status === 'rejected').length;
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
	<title>{pageTitle(m.profile_unpublished_heading())}</title>
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
		{:else}
			{#if waiting > 0 || notAccepted > 0}
				<div class="sent">
					{#if waiting > 0}
						<p>{m.wp14a_unpublished_waiting({ count: waiting })}</p>
						<!-- "{count} exercise you sent is waiting for a moderator." (plural) -->
					{/if}
					{#if notAccepted > 0}
						<p>{m.wp14a_unpublished_notAccepted({ count: notAccepted })}</p>
						<!-- "{count} exercise you sent was not accepted." (plural) -->
					{/if}
					<a href={resolve('/submit/mine')}>{m.wp14a_unpublished_seeSent()}</a>
					<!-- "See what you've sent, and the moderator's reasons →" -->
				</div>
			{/if}
			{#if exercises.length === 0}
				<p class="muted">
					{waiting > 0 || notAccepted > 0
						? m.wp14a_unpublished_emptyPublished()
						: m.profile_unpublished_empty()}
					<!-- "Nothing you've published has been hidden or removed." / "Everything you contributed is published." -->
				</p>
			{:else}
				<div class="grid">
					{#each exercises as exercise (exercise.id)}
						<ExerciseCard {exercise} />
					{/each}
				</div>
			{/if}
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
	.sent {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--status-info);
		border-radius: var(--radius-md);
		background: var(--status-info-bg);
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-2);
	}
</style>
