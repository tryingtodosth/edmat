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
	import { providerLabel } from './providerLabel';

	let providers = $state<ProviderState[]>([]);
	let repositoryUrl = $state('');
	let schools = $state<School[]>([]);
	let open = $state<ProviderState | null>(null);
	let selectedSchool = $state('');

	// Apple has no text glyph that renders everywhere: U+F8FF is a private-use code point that only
	// Apple's own fonts draw, so on everything else the card had a blank where its icon should be
	// (WP14a). It gets the same SVG mark `SsoButtons` already draws for the real Apple button.
	const ICONS: Record<string, string> = {
		school: '🎓',
		google: 'G',
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
					<span class="icon" aria-hidden="true">
						{#if provider.id === 'apple'}
							<svg viewBox="0 0 814 1000" width="14" height="16" fill="currentColor">
								<path
									d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
								/>
							</svg>
						{:else}
							{ICONS[provider.id] ?? '•'}
						{/if}
					</span>
					<span class="label"
						>{m.auth_providers_continueWith({ provider: providerLabel(provider) })}</span
					>
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
