<script lang="ts">
	/** Who helps run this event — the `CourseStaffPanel` shape. Adding is by account id (the
	 * profile URL's number), the same honest stopgap the course panel documents: there is no
	 * people search yet. The host's row is shown but never removable (the backend refuses too). */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { EventStaffMember, EventStaffRole } from '$lib/types/event';

	let {
		staff,
		error = '',
		onadd,
		onrole,
		onremove
	}: {
		staff: EventStaffMember[];
		error?: string;
		onadd: (userId: string, role: EventStaffRole) => void;
		onrole: (staffId: string, role: EventStaffRole) => void;
		onremove: (staffId: string) => void;
	} = $props();

	let newUserId = $state('');
	let newRole = $state<EventStaffRole>('organiser');
	const roleLabels: Record<EventStaffRole, () => string> = {
		organiser: m.events_role_organiser, // "Organiser"
		reviewer: m.events_role_reviewer, // "Reviewer"
		volunteer: m.events_role_volunteer // "Volunteer"
	};
	function add(e: SubmitEvent) {
		e.preventDefault();
		const id = newUserId.trim();
		if (!id) return;
		onadd(id, newRole);
		newUserId = '';
	}
</script>

<section class="staff-panel">
	<h3>{m.events_staffHeading()}</h3>
	<p class="hint">{m.events_staffHint()}</p>
	<ul class="staff-list">
		{#each staff as row (row.id)}
			<li>
				<a href={resolve('/users/[id]', { id: row.user.id })}>{row.user.displayName}</a>
				{#if row.isHost}
					<span class="pill">{m.events_role_host()}</span>
				{:else}
					<select
						value={row.role}
						aria-label={m.events_staffRoleFor({ name: row.user.displayName })}
						onchange={(e) => onrole(row.id, e.currentTarget.value as EventStaffRole)}
					>
						{#each Object.keys(roleLabels) as r (r)}
							<option value={r}>{roleLabels[r as EventStaffRole]()}</option>
						{/each}
					</select>
					<button type="button" class="link danger" onclick={() => onremove(row.id)}>
						{m.common_remove()}
					</button>
				{/if}
			</li>
		{/each}
	</ul>
	<form class="add" onsubmit={add}>
		<input
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			placeholder={m.events_staffUserIdPlaceholder()}
			bind:value={newUserId}
			aria-label={m.events_staffUserIdPlaceholder()}
		/>
		<select bind:value={newRole} aria-label={m.events_staffRole()}>
			{#each Object.keys(roleLabels) as r (r)}
				<option value={r}>{roleLabels[r as EventStaffRole]()}</option>
			{/each}
		</select>
		<button type="submit">{m.events_staffAdd()}</button>
	</form>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style lang="scss">
	.staff-panel {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0 0 0.25rem;
	}
	.hint,
	.error {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.error {
		color: var(--status-danger);
	}
	.staff-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
		display: grid;
		gap: 0.4rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.add {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		color: var(--accent);
		font: inherit;
	}
	.danger {
		color: var(--status-danger);
	}
</style>
