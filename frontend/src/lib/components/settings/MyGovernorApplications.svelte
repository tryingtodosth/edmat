<script lang="ts">
	/**
	 * What the applicant sees: where each of their applications stands, and the way to withdraw one.
	 *
	 * A pending application shows its position in the queue AND the sentence saying nobody can buy a
	 * better one. Both halves matter: the number alone invites the question, and this is the honest
	 * answer to it.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getMyApplications, withdrawApplication } from '$lib/services/governorApplications';
	import type { GovernorApplication, GovernorNodeKind } from '$lib/types/governorApplication';

	let applications = $state<GovernorApplication[]>([]);
	let loading = $state(true);
	let busy = $state<Record<string, boolean>>({});

	onMount(async () => {
		applications = await getMyApplications().catch(() => []);
		loading = false;
	});

	function kindLabel(kind: GovernorNodeKind): string {
		if (kind === 'discipline') return m.govapp_kind_discipline();
		if (kind === 'branch') return m.govapp_kind_branch();
		return m.govapp_kind_material();
	}

	function statusLabel(application: GovernorApplication): string {
		if (application.status === 'approved') return m.govapp_status_approved();
		if (application.status === 'declined') return m.govapp_status_declined();
		if (application.status === 'withdrawn') return m.govapp_status_withdrawn();
		return m.govapp_status_pending();
	}

	async function withdraw(application: GovernorApplication) {
		busy = { ...busy, [application.id]: true };
		try {
			const updated = await withdrawApplication(application.id);
			applications = applications.map((row) => (row.id === updated.id ? updated : row));
		} catch {
			// Nothing to say beyond the row not changing — the only real failure here is somebody
			// else having decided it a moment earlier, which the next load shows correctly.
		} finally {
			busy = { ...busy, [application.id]: false };
		}
	}
</script>

{#if !loading}
	{#if applications.length === 0}
		<p class="field-hint">{m.govapp_mineEmpty()}</p>
	{:else}
		<ul class="applications">
			{#each applications as application (application.id)}
				<li class="application">
					<span class="application__what">
						{m.govapp_appliedFor({
							kind: kindLabel(application.kind),
							name: application.nodeLabel
						})}
					</span>
					<span class="application__status">{statusLabel(application)}</span>
					{#if application.status === 'pending' && application.queuePosition !== null}
						<span class="application__position">
							{m.govapp_position({ position: application.queuePosition })}
						</span>
					{/if}
					{#if application.decisionNote}
						<span class="application__note">{application.decisionNote}</span>
					{/if}
					{#if application.status === 'pending'}
						<button
							type="button"
							disabled={busy[application.id]}
							onclick={() => withdraw(application)}
						>
							{m.govapp_withdraw()}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="field-hint">{m.govapp_noPriority()}</p>
	{/if}
{/if}

<style lang="scss">
	.applications {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.application {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);

		button {
			min-height: 44px;
			padding: 0 var(--space-3);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			cursor: pointer;
		}
	}
	.application__what {
		font-weight: 600;
	}
	.application__status,
	.application__position,
	.application__note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.field-hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
