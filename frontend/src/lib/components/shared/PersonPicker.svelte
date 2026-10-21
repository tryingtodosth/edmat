<script lang="ts">
	// ONE person, chosen from the people the reader already shares a roster with — or, when the
	// person is somebody they have never shared one with, by the account id from their profile URL
	// (owner, 2026-10-21: "give user a list instead"). There is no people search on this site by
	// design; this is the honest list (`/api/people/suggestions/`, `contests/people.py`), the same
	// one the contest wizard's `RolePicker` offers for several people at once. It is a suggestion
	// and confers nothing: adding somebody is the same write either way.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getPeopleSuggestions } from '$lib/services/people';
	import type { SuggestedPerson } from '$lib/types/people';

	let {
		value = $bindable(''),
		exclude = [],
		id = 'person-picker'
	}: {
		/** The chosen account id, or '' while nobody is chosen. */
		value: string;
		/** Ids already on the roster — not offered again. */
		exclude?: string[];
		id?: string;
	} = $props();

	let people = $state<SuggestedPerson[]>([]);
	let loaded = $state(false);
	let failed = $state(false);
	let query = $state('');
	let manual = $state('');

	onMount(async () => {
		try {
			people = await getPeopleSuggestions();
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	});

	const byId = $derived(new Map(people.map((p) => [p.id, p])));
	const offered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return people
			.filter((p) => !exclude.includes(p.id))
			.filter((p) => !q || p.displayName.toLowerCase().includes(q))
			.slice(0, 8);
	});

	/** "staff with you on {title}" — the same sentences the contest wizard draws. */
	function viaLine(via: string[]): string {
		const parts = via.slice(0, 2).map((entry) => {
			const divider = entry.indexOf(':');
			const kind = divider === -1 ? entry : entry.slice(0, divider);
			const title = divider === -1 ? '' : entry.slice(divider + 1);
			switch (kind) {
				case 'course':
					return m.contests_viaCourse({ title }); // "staff with you on {title}"
				case 'event':
					return m.contests_viaEvent({ title }); // "helps run {title} with you"
				case 'organization':
					return m.contests_viaOrganization({ title }); // "a member of {title} with you"
				case 'project':
					return m.contests_viaProject({ title }); // "co-writes {title} with you"
				default:
					return title;
			}
		});
		const extra = via.length - parts.length;
		return extra > 0
			? `${parts.join('; ')} ${m.contests_viaMore({ count: extra })}`
			: parts.join('; '); // "and {count} more"
	}

	function choose(personId: string) {
		value = personId;
		query = '';
	}
	function useManual() {
		const typed = manual.trim();
		if (/^[0-9]+$/.test(typed)) {
			value = typed;
			manual = '';
		}
	}
	function reset() {
		value = '';
	}
</script>

<div class="person-picker" data-person-picker>
	{#if value}
		<p class="person-picker__chosen">
			<span class="person-picker__name"
				>{byId.get(value)?.displayName ?? m.contests_rolesAccount({ id: value })}</span
			>
			<!-- "Account #{id}" -->
			<button type="button" class="person-picker__change" onclick={reset}
				>{m.ask_tagChange()}</button
			>
			<!-- "Change" -->
		</p>
	{:else}
		<label class="person-picker__label" for={id}>{m.people_pickerLabel()}</label>
		<!-- "Who" -->
		<input
			{id}
			type="text"
			bind:value={query}
			placeholder={m.people_pickerPlaceholder()}
			autocomplete="off"
		/>
		<!-- "Start typing a name…" -->
		{#if !loaded}
			<p class="person-picker__note">{m.contests_rolesLoading()}</p>
		{:else if failed}
			<p class="person-picker__note">{m.common_error_generic()}</p>
		{:else if offered.length > 0}
			<ul class="person-picker__matches" aria-label={m.people_pickerMatches()}>
				<!-- "People you work with" -->
				{#each offered as person (person.id)}
					<li>
						<button type="button" class="person-picker__match" onclick={() => choose(person.id)}>
							<span class="person-picker__match-name">{person.displayName}</span>
							<span class="person-picker__via">{viaLine(person.via)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="person-picker__note">
				{people.length === 0 ? m.people_pickerNobody() : m.people_pickerNoMatch()}
			</p>
			<!-- "You do not share a course, an event or an organisation with anybody yet. Add by account id below." / "Nobody you work with matches that." -->
		{/if}
		<div class="person-picker__manual">
			<label>
				<span>{m.contests_rolesByIdLabel()}</span>
				<!-- "…or by account id" -->
				<input
					type="text"
					inputmode="numeric"
					bind:value={manual}
					onkeydown={(e) => {
						if (e.key !== 'Enter') return;
						e.preventDefault();
						useManual();
					}}
				/>
			</label>
			<button
				type="button"
				class="person-picker__use"
				onclick={useManual}
				disabled={!/^[0-9]+$/.test(manual.trim())}
			>
				{m.people_pickerUseId()}
				<!-- "Use this id" -->
			</button>
			<span class="person-picker__note">{m.course_staff_userIdHint()}</span>
			<!-- "The number in their profile's address." -->
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.person-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		input {
			width: 100%;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.person-picker__label {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.person-picker__chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.person-picker__name {
		@include mix.selected-soft;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
	}
	.person-picker__change,
	.person-picker__use {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
	}
	.person-picker__matches {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 14rem;
		overflow: auto;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
	}
	.person-picker__match {
		@include mix.focus-ring;
		width: 100%;
		text-align: left;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: none;
		border: 0;
		font: inherit;
		color: var(--text-primary);
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.person-picker__match-name {
		font-weight: 600;
	}
	.person-picker__via,
	.person-picker__note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.person-picker__manual {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-1);
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			font-size: var(--font-size-xs);
			font-weight: 600;
			color: var(--text-secondary);
			flex: 1 1 8rem;
		}
	}
</style>
