<script lang="ts">
	// The four sign-in templates, offered beside the real email+password form rather than instead of
	// it. Clicking one opens the connection-state modal — see ConnectionStateModal.svelte for why
	// that is a fetch rather than a hardcoded notice.
	//
	// The school button additionally asks WHICH institution before it can say anything useful,
	// because USOS is a per-university deployment: whether a connection is even possible is a
	// different answer at UW than at an art academy that runs no installation. That is the "school
	// selection" half of this feature, and it is genuinely load-bearing rather than decorative.
	import { m } from '$lib/paraglide/messages.js';
	import { getProviderStates, getSchools } from '$lib/services/identity';
	import type { ProviderState, School } from '$lib/types/identity';
	import ConnectionStateModal from './ConnectionStateModal.svelte';

	let providers = $state<ProviderState[]>([]);
	let repositoryUrl = $state('');
	let schools = $state<School[]>([]);
	let open = $state<ProviderState | null>(null);
	let selectedSchool = $state('');

	const ICONS: Record<string, string> = {
		school: '🎓',
		google: 'G',
		apple: '',
		github: '⌥'
	};

	$effect(() => {
		// Fire-and-forget on mount. A failure here must never block the real login form beside it,
		// so the buttons simply do not appear rather than the page showing an error for a feature
		// that is explicitly a draft.
		getProviderStates()
			.then((res) => {
				providers = res.providers;
				repositoryUrl = res.repositoryUrl;
			})
			.catch(() => {});
		getSchools()
			.then((res) => (schools = res))
			.catch(() => {});
	});

	let chosen = $derived(schools.find((s) => s.slug === selectedSchool));
</script>

{#if providers.length}
	<div class="providers">
		<p class="intro">{m.auth_providers_intro()}</p>
		<div class="grid">
			{#each providers as provider (provider.id)}
				<button type="button" class="provider" onclick={() => (open = provider)}>
					<span class="icon" aria-hidden="true">{ICONS[provider.id] ?? '•'}</span>
					<span class="label">{m.auth_providers_continueWith({ provider: provider.label })}</span>
					{#if provider.status === 'draft'}
						<!-- Said on the button itself, not only inside the modal. Someone who never opens
						     one should still not be misled into thinking it will sign them in. -->
						<span class="badge">{m.auth_providers_draftBadge()}</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if open}
	<ConnectionStateModal provider={open} {repositoryUrl} onClose={() => (open = null)}>
		{#snippet extra()}
			{#if open?.id === 'school'}
				<section class="school-pick">
					<label class="field">
						<span>{m.auth_providers_schoolLabel()}</span>
						<select bind:value={selectedSchool}>
							<option value="">{m.auth_providers_schoolPlaceholder()}</option>
							{#each schools as school (school.slug)}
								<option value={school.slug}>{school.name} ({school.shortName})</option>
							{/each}
						</select>
					</label>
					{#if chosen}
						<p class="school-note">
							{chosen.runsUsos
								? m.auth_providers_schoolRunsUsos({ school: chosen.shortName })
								: m.auth_providers_schoolNoUsos({ school: chosen.shortName })}
						</p>
					{:else}
						<p class="school-note">{m.auth_providers_schoolNotListed()}</p>
					{/if}
				</section>
			{/if}
		{/snippet}
	</ConnectionStateModal>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.providers {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.intro {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-align: center;
	}
	.grid {
		display: grid;
		gap: var(--space-2);
	}
	.provider {
		@include mix.focus-ring;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		cursor: pointer;
		text-align: left;
		&:hover {
			border-color: var(--accent);
		}
	}
	.icon {
		width: 1.4rem;
		text-align: center;
		font-weight: 700;
	}
	.label {
		flex: 1;
		font-size: var(--font-size-sm);
	}
	.badge {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
	}
	.school-pick {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
	}
	.school-note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
