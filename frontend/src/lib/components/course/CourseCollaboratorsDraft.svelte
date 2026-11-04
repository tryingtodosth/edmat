<script lang="ts" module>
	import type { InviteRole, StaffRole } from '$lib/types/course';

	/** What the create form hands its page: the people to add straight onto the staff (somebody the
	 *  founder already shares a roster with — `PersonPicker`), and the addresses to mail an invite
	 *  to (`backend/courses/mailinvite.py`). The page runs both after the course exists. */
	export interface CollaboratorsDraft {
		people: { userId: string; displayName: string; role: Exclude<StaffRole, 'owner'> }[];
		emails: string[];
		emailRole: InviteRole;
	}

	export function emptyCollaborators(): CollaboratorsDraft {
		return { people: [], emails: [], emailRole: 'assistant' };
	}
</script>

<script lang="ts">
	// "Who runs this with you" on the create form (owner, 2026-11-02: "adding collaborators from that
	// place — with whom you are connected, or adding by mail"). Collects, never sends: the course does
	// not exist yet, so the page adds the people and mails the invitations once it does — through the
	// same endpoints the course page's staff panel uses, so there is no second way in.
	//
	// The licence line is the point of putting this next to the licence picker: somebody invited to
	// help write a course writes under its licence, and they are told so before they accept
	// (`courses/join/[token]`).
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { splitAddresses } from '$lib/utils/emailAddresses';
	import PersonPicker from '$lib/components/shared/PersonPicker.svelte';
	import { getPeopleSuggestions } from '$lib/services/people';
	import { getMyMail } from '$lib/services/mail';
	import type { Licence } from '$lib/types/licence';
	import { licenceShort } from '$lib/utils/labels';

	let {
		value = $bindable(),
		licence
	}: {
		value: CollaboratorsDraft;
		/** The licence the form currently has chosen — what collaborators will write under. */
		licence: Licence;
	} = $props();

	let picked = $state('');
	let pickedRole = $state<Exclude<StaffRole, 'owner'>>('assistant');
	let emailText = $state('');
	let names = $state<Record<string, string>>({});
	// null while unknown — the line about confirming appears only once we know it is needed.
	let confirmed = $state<boolean | null>(null);

	onMount(() => {
		getPeopleSuggestions()
			.then((rows) => (names = Object.fromEntries(rows.map((p) => [p.id, p.displayName]))))
			.catch(() => {});
		getMyMail()
			.then((mail) => (confirmed = mail.emailConfirmed))
			.catch(() => (confirmed = null));
	});

	// The picker's choice IS the add — one fewer click, and the list below is where it is undone.
	$effect(() => {
		const id = picked;
		if (!id) return;
		if (!value.people.some((p) => p.userId === id)) {
			value.people = [
				...value.people,
				{ userId: id, displayName: names[id] ?? `#${id}`, role: pickedRole }
			];
		}
		picked = '';
	});

	function onEmails() {
		value.emails = splitAddresses(emailText);
	}

	function remove(userId: string) {
		value.people = value.people.filter((p) => p.userId !== userId);
	}
</script>

<fieldset class="collab" data-testid="course-collaborators">
	<legend>{m.courseCollab_legend()}</legend>
	<!-- "Who runs it with you (optional)" -->
	<p class="hint">{m.courseCollab_hint()}</p>
	<!-- "People you already share a course, an event or a project with are added straight away. Anyone else gets an invitation by email." -->

	<div class="row">
		<div class="grow">
			<PersonPicker
				bind:value={picked}
				id="course-collab-person"
				exclude={value.people.map((p) => p.userId)}
			/>
		</div>
		<label class="role">
			<span>{m.course_staff_role()}</span>
			<!-- "Role" -->
			<select bind:value={pickedRole}>
				<option value="assistant">{m.course_role_assistant()}</option>
				<option value="admin">{m.course_role_admin()}</option>
			</select>
		</label>
	</div>

	{#if value.people.length > 0}
		<ul class="people">
			{#each value.people as person (person.userId)}
				<li>
					<span class="name">{person.displayName}</span>
					<select
						bind:value={person.role}
						aria-label={m.course_staff_role()}
						data-testid="collab-role"
					>
						<option value="assistant">{m.course_role_assistant()}</option>
						<option value="admin">{m.course_role_admin()}</option>
					</select>
					<button type="button" class="link" onclick={() => remove(person.userId)}
						>{m.courseCollab_remove()}</button
					>
					<!-- "Remove" -->
				</li>
			{/each}
		</ul>
	{/if}

	<div class="row">
		<label class="field grow">
			<span>{m.courseCollab_emailLabel()}</span>
			<!-- "Invite by email" -->
			<textarea
				rows="2"
				bind:value={emailText}
				oninput={onEmails}
				placeholder={m.courseCollab_emailPlaceholder()}
				data-testid="collab-emails"></textarea>
			<!-- "anna@example.com, jan@example.com" -->
		</label>
		<label class="role">
			<span>{m.courseCollab_emailRole()}</span>
			<!-- "They join as" -->
			<select bind:value={value.emailRole}>
				<option value="assistant">{m.course_role_assistant()}</option>
				<option value="admin">{m.course_role_admin()}</option>
				<option value="participant">{m.courseCollab_roleParticipant()}</option>
				<!-- "Participant" -->
			</select>
		</label>
	</div>
	<p class="hint">{m.courseCollab_emailHint()}</p>
	<!-- "One invitation per address, valid once for 14 days. We never say whether an address already has an account." -->
	{#if value.emails.length > 0 && confirmed === false}
		<p class="hint hint--attention" data-testid="collab-confirm-first">
			{m.courseCollab_confirmFirst()}
			<!-- "Invitations go out in your name, so confirm your own email address first." -->
			<a href={resolve('/settings')}>{m.courseCollab_confirmLink()}</a>
			<!-- "Settings" -->
		</p>
	{/if}

	{#if value.people.length > 0 || value.emails.length > 0}
		<p class="hint" data-testid="collab-licence">
			{m.courseCollab_underLicence({ licence: licenceShort(licence) })}
			<!-- "They will write under this course’s licence, {licence}, and are told so before they accept." -->
		</p>
	{/if}
</fieldset>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.collab {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		margin: 0;
		min-width: 0;
	}
	legend {
		font-size: var(--font-size-sm);
		font-weight: 600;
		padding: 0 var(--space-1);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.grow {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.field,
	.role {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.hint--attention {
		color: var(--text-primary);
	}
	.people {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		li {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			flex-wrap: wrap;
			font-size: var(--font-size-sm);
		}
	}
	.name {
		font-weight: 500;
	}
	select,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font: inherit;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		font-size: var(--font-size-xs);
	}
</style>
