<script lang="ts">
	// How open this material's cooperation is, and what the team says to newcomers. Managers only
	// (the page draws it only for them; the API refuses everybody else with 403). Three radios
	// with a sentence each rather than a `<select>` of three words, because the words alone do
	// not say who may do what.
	import { m } from '$lib/paraglide/messages.js';
	import { updateCoopSettings } from '$lib/services/materialsCoop';
	import type { CoopOverview, CoopPolicy } from '$lib/types/materialsCoop';
	import { coopErrorMessage, POLICY_HINTS, POLICY_LABELS } from './labels';

	let {
		materialId,
		overview,
		onsaved
	}: { materialId: string; overview: CoopOverview; onsaved: (next: CoopOverview) => void } =
		$props();

	const POLICIES: CoopPolicy[] = ['open', 'request', 'closed'];

	// The form starts from the saved values and owns them from then on — the one-time capture is
	// the point, not an oversight.
	// svelte-ignore state_referenced_locally
	let policy = $state<CoopPolicy>(overview.policy);
	// svelte-ignore state_referenced_locally
	let welcomeNote = $state(overview.welcomeNote);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		notice = '';
		try {
			const next = await updateCoopSettings(materialId, { policy, welcomeNote });
			notice = m.coop_settings_saved(); // "Saved."
			onsaved(next);
		} catch (e) {
			error = coopErrorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<form class="settings" onsubmit={save}>
	<fieldset>
		<legend>{m.coop_settings_policyLegend()}</legend>
		<!-- "Who may change this material" -->
		{#each POLICIES as option (option)}
			<label class="option" class:option--active={policy === option}>
				<input type="radio" name="policy" value={option} bind:group={policy} />
				<span class="option__text">
					<strong>{POLICY_LABELS[option]()}</strong>
					<span class="option__hint">{POLICY_HINTS[option]()}</span>
				</span>
			</label>
		{/each}
	</fieldset>

	<label class="note">
		<span>{m.coop_settings_noteLabel()}</span>
		<!-- "A note for people who want to help" -->
		<textarea rows="4" bind:value={welcomeNote} placeholder={m.coop_settings_notePlaceholder()}
		></textarea>
		<!-- "What this material needs next, how the team works, what a good proposal looks like…" -->
	</label>

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}

	<button type="submit" class="primary" disabled={busy}>
		{m.common_save()}
		<!-- "Save" -->
	</button>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	legend {
		font-weight: 600;
		margin-bottom: var(--space-2);
	}
	.option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		cursor: pointer;
		input {
			margin-top: 4px;
		}
	}
	.option--active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.option__text {
		display: flex;
		flex-direction: column;
	}
	.option__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.note {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-weight: 600;
		textarea {
			font: inherit;
			font-weight: 400;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
		min-height: 44px;
	}
	.error {
		margin: 0;
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
</style>
