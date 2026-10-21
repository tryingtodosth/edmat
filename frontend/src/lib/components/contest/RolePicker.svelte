<script lang="ts">
	/** **This is "prefilling with current users."**
	 *
	 * The founder's own rosters, offered as the candidates for one role, each with the line that
	 * says why they are being suggested — "staff with you on Analiza I". There is no people search
	 * on this site (root CLAUDE.md, known gaps), so without this a teacher founding a contest that
	 * cannot be announced without three named jurors has to go and find three numeric account ids.
	 *
	 * The id box stays, below, as the fallback the rest of the site uses: the person a founder most
	 * wants on a jury may be somebody they have never shared a roster with, and a picker that
	 * replaced the id box would have made that case impossible rather than inconvenient.
	 *
	 * It is a SUGGESTION list and confers nothing. Adding somebody is the same write either way.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { ContestStaffRole, SuggestedPerson } from '$lib/types/contest';
	import { contestStaffRoleLabel } from '$lib/utils/labels';

	interface Props {
		role: ContestStaffRole;
		/** How many the preset asks for, and whether the contest can be announced without them. */
		count?: number;
		required?: boolean;
		people: SuggestedPerson[];
		loading?: boolean;
		/** The chosen account ids for this role, bound out to the wizard. */
		chosen?: string[];
	}

	let {
		role,
		count = 1,
		required = false,
		people,
		loading = false,
		chosen = $bindable([])
	}: Props = $props();

	let manualId = $state('');
	let manualError = $state('');

	/** The "via" line for one candidate. The server sends `'<kind>:<title>'` and the sentence is
	 *  drawn here, in the reader's own language — a server that sent the English sentence would be
	 *  a third i18n axis nobody asked for (house rule 1). */
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

	function toggle(id: string) {
		chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
	}

	function addManual() {
		manualError = '';
		const value = manualId.trim();
		if (!/^[0-9]+$/.test(value)) {
			manualError = m.contests_rolesIdNumeric(); // "An account id is a number."
			return;
		}
		if (!chosen.includes(value)) chosen = [...chosen, value];
		manualId = '';
	}

	const byId = $derived(new Map(people.map((p) => [p.id, p])));
</script>

<section class="picker">
	<h4>
		{contestStaffRoleLabel(role)()}
		<span class="wanted">
			{required
				? m.contests_rolesWantedRequired({ count })
				: m.contests_rolesWantedOptional({ count })}
			<!-- "{count} needed before it can be announced" / "{count} suggested" -->
		</span>
	</h4>

	{#if chosen.length > 0}
		<ul class="chosen">
			{#each chosen as id (id)}
				<li>
					<span>{byId.get(id)?.displayName ?? m.contests_rolesAccount({ id })}</span>
					<!-- "Account #{id}" -->
					<button type="button" onclick={() => toggle(id)} aria-label={m.contests_rolesRemove()}>
						×
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if loading}
		<p class="hint">{m.contests_rolesLoading()}</p>
		<!-- "Looking for people you already work with…" -->
	{:else if people.length === 0}
		<p class="hint">{m.contests_rolesNoSuggestions()}</p>
		<!-- "You do not share a course, an event, an organisation or a material project with anybody yet, so there is nobody to suggest. Add people by account id below." -->
	{:else}
		<ul class="suggestions">
			{#each people as person (person.id)}
				<li>
					<label>
						<input
							type="checkbox"
							checked={chosen.includes(person.id)}
							onchange={() => toggle(person.id)}
						/>
						<span class="name">{person.displayName}</span>
						<span class="via">{viaLine(person.via)}</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="manual">
		<label>
			<span>{m.contests_rolesByIdLabel()}</span>
			<!-- "…or by account id" -->
			<input type="text" inputmode="numeric" bind:value={manualId} />
		</label>
		<button type="button" onclick={addManual}>{m.contests_rolesAdd()}</button>
		<!-- "Add" -->
	</div>
	{#if manualError}
		<p class="error" role="alert">{manualError}</p>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.picker {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0.7rem 0.9rem;
		background: var(--bg-surface);
	}
	h4 {
		margin: 0 0 0.4rem;
		font-size: var(--font-size-md);
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.wanted {
		font-size: var(--font-size-xs);
		font-weight: 400;
		color: var(--text-secondary);
	}
	.chosen,
	.suggestions {
		list-style: none;
		margin: 0 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.chosen {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chosen li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		// `selected-soft` and not a hand-written pair: this chip is the ON state (tint + accent
		// text + a 1px accent border, which is load-bearing in dark mode). The first draft wrote
		// `--accent-contrast` on `--accent-soft` by hand and drew WHITE TEXT ON A PALE TEAL TINT —
		// invisible, passing `svelte-check`, `eslint` and the build, and found only by looking at
		// the screenshot (frontend/CLAUDE.md: "a filled accent box is a command, never a
		// selection"). `--accent-contrast` belongs on the accent FILL and nowhere else.
		@include mix.selected-soft;
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.2rem 0.1rem 0.45rem;
		font-size: var(--font-size-sm);
	}
	.chosen button {
		border: 0;
		background: none;
		cursor: pointer;
		color: inherit;
		font-size: 1rem;
		line-height: 1;
		padding: 0 0.25rem;
	}
	.suggestions label {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas: 'box name' '. via';
		gap: 0 0.45rem;
		align-items: baseline;
		cursor: pointer;
		font-size: var(--font-size-sm);
	}
	.suggestions input {
		grid-area: box;
	}
	.name {
		grid-area: name;
	}
	.via {
		grid-area: via;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.manual {
		display: flex;
		gap: 0.4rem;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.manual label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.manual input {
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		width: 7rem;
	}
	.manual button {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		cursor: pointer;
	}
	.hint {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.error {
		margin: 0.3rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
