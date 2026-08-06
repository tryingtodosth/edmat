<script lang="ts">
	// Who runs this course. Readable by anybody in the room — knowing who is teaching you is not
	// privileged information, and a participant needs it to know who to ask. Editing is an
	// administrator's, and the owner row is deliberately immutable from here: somebody has to remain
	// able to delete the course and to grant roles back, and a course whose owner could be removed by
	// a co-admin is a course that can be taken hostage.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { CourseStaffMember, StaffRole, Course } from '$lib/types/course';

	let {
		course,
		staff,
		error = '',
		onadd,
		onrole,
		onremove
	}: {
		course: Course;
		staff: CourseStaffMember[];
		error?: string;
		onadd?: (userId: string, role: Exclude<StaffRole, 'owner'>) => void;
		onrole?: (staffId: string, role: Exclude<StaffRole, 'owner'>) => void;
		onremove?: (staffId: string) => void;
	} = $props();

	let newUserId = $state('');
	let newRole = $state<Exclude<StaffRole, 'owner'>>('assistant');

	const roleLabels: Record<StaffRole, () => string> = {
		owner: m.course_role_owner,
		admin: m.course_role_admin,
		assistant: m.course_role_assistant
	};

	function add(event: SubmitEvent) {
		event.preventDefault();
		const id = newUserId.trim();
		if (!id) return;
		onadd?.(id, newRole);
		newUserId = '';
	}
</script>

<section class="staff">
	<h2>{m.course_staff_heading()}</h2>

	<ul>
		{#each staff as member (member.id)}
			<li>
				<a href={resolve('/users/[id]', { id: member.user.id })}>{member.user.displayName}</a>
				{#if course.canAdminister && member.role !== 'owner' && onrole}
					<select
						value={member.role}
						onchange={(event) =>
							onrole?.(
								member.id,
								(event.currentTarget as HTMLSelectElement).value as Exclude<StaffRole, 'owner'>
							)}
					>
						<option value="assistant">{m.course_role_assistant()}</option>
						<option value="admin">{m.course_role_admin()}</option>
					</select>
				{:else}
					<span class="role">{roleLabels[member.role]()}</span>
				{/if}

				{#if course.canAdminister && member.role !== 'owner' && onremove}
					<button type="button" class="link danger" onclick={() => onremove?.(member.id)}>
						{m.course_staff_remove()}
					</button>
				{/if}
			</li>
		{/each}
	</ul>

	{#if course.canAdminister}
		<p class="hint">{m.course_staff_ownerLocked()}</p>

		<form onsubmit={add}>
			<label class="field">
				<span>{m.course_staff_userId()}</span>
				<input type="text" bind:value={newUserId} inputmode="numeric" required />
				<!-- Honest about the gap rather than pretending: there is no people search in this app
				     yet, so the id from somebody's profile URL is the real way to name them. -->
				<span class="hint">{m.course_staff_userIdHint()}</span>
			</label>
			<label class="field">
				<span>{m.course_staff_role()}</span>
				<select bind:value={newRole}>
					<option value="assistant">{m.course_role_assistant()}</option>
					<option value="admin">{m.course_role_admin()}</option>
				</select>
			</label>
			<button type="submit" class="primary">{m.course_staff_add()}</button>
		</form>

		{#if error}
			<p class="error">{error}</p>
		{/if}
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.staff {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.role {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	form {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger, #c0392b);
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.primary {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--bg-surface);
		cursor: pointer;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-decoration: underline;
		color: var(--text-secondary);
	}
	.danger:hover {
		color: var(--status-danger, #c0392b);
	}
</style>
