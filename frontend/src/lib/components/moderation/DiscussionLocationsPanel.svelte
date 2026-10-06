<script lang="ts">
	/**
	 * The moderator's switches for the standing pages' discussions
	 * (`backend/community/discussions.py`, `/api/discussion-locations/`).
	 *
	 * Its own component rather than a tenth branch inside `routes/moderation/+page.svelte`, which is
	 * already past a thousand lines: everything this tab does — loading, the three switches per row,
	 * adding a location nobody has written at yet — is self-contained, and the page only has to add
	 * a tab button and render this.
	 *
	 * What it shows is each ROW, not each location's effective policy. A row set to `staff` and a
	 * row inheriting `staff` from its page are different things to change, and a panel that folded
	 * the page's ceiling into every section would leave a moderator unable to tell which one to
	 * edit — `DiscussionLocationSerializer`'s docstring argues this from the server's side.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { DISCUSSION_AUDIENCES, DISCUSSION_AUDIENCE_LABELS } from '$lib/utils/labels';
	import {
		createDiscussionLocation,
		listDiscussionLocations,
		updateDiscussionLocation
	} from '$lib/services/discussions';
	import type { DiscussionAudience, DiscussionLocationRow } from '$lib/types/discussion';

	let rows = $state<DiscussionLocationRow[]>([]);
	let loading = $state(true);
	let error = $state('');
	let pending = $state<Record<string, boolean>>({});

	let newPage = $state('');
	let newSection = $state('');
	let addError = $state('');
	let adding = $state(false);

	// An initial load in `onMount`-shaped code rather than at component top level: this component is
	// only ever rendered inside an already-authenticated moderation page, but a top-level service
	// call would also run during prerendering, where there is no origin to fetch from
	// (`frontend/CLAUDE.md`, "First paint").
	$effect(() => {
		let cancelled = false;
		listDiscussionLocations()
			.then((loaded) => {
				if (!cancelled) rows = loaded;
			})
			.catch(() => {
				if (!cancelled) error = m.discussions_loadFailed();
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	async function change(
		row: DiscussionLocationRow,
		changes: { isEnabled?: boolean; audience?: DiscussionAudience; moderated?: boolean }
	) {
		error = '';
		pending = { ...pending, [row.id]: true };
		try {
			const saved = await updateDiscussionLocation(row.id, changes);
			rows = rows.map((r) => (r.id === saved.id ? saved : r));
		} catch {
			error = m.discussions_saveFailed(); // "That change could not be saved."
		} finally {
			pending = { ...pending, [row.id]: false };
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		addError = '';
		adding = true;
		try {
			const created = await createDiscussionLocation({
				page: newPage.trim(),
				section: newSection.trim()
			});
			// Replace rather than append when it already exists: adding a location somebody has
			// already written at is the same statement, not a second row (the server's
			// `unique_together` says so too), and a duplicate in this list would be a lie.
			rows = [...rows.filter((r) => r.id !== created.id), created].sort((a, b) =>
				a.key.localeCompare(b.key)
			);
			newPage = '';
			newSection = '';
		} catch {
			addError = m.discussions_addFailed();
		} finally {
			adding = false;
		}
	}
</script>

<div class="locations-panel">
	<p class="locations-intro">{m.discussions_tabLead()}</p>
	{#if error}<p class="locations-error" role="alert">{error}</p>{/if}

	<form class="locations-add" onsubmit={add}>
		<h3>{m.discussions_addLocation()}</h3>
		<!-- "Add a location" -->
		<div class="locations-add__fields">
			<input
				type="text"
				bind:value={newPage}
				placeholder={m.discussions_addPagePlaceholder()}
				aria-label={m.discussions_colLocation()}
				required
			/>
			<input
				type="text"
				bind:value={newSection}
				placeholder={m.discussions_addSectionPlaceholder()}
				aria-label={m.discussions_colLocation()}
			/>
			<button type="submit" class="approve" disabled={adding}>
				{m.discussions_addSubmit()}
			</button>
		</div>
		{#if addError}<p class="locations-error" role="alert">{addError}</p>{/if}
	</form>

	{#if loading}
		<p class="locations-muted">{m.common_loading()}</p>
	{:else if rows.length === 0}
		<p class="locations-muted">{m.discussions_noLocations()}</p>
		<!-- "No location has been written at or configured yet." -->
	{:else}
		<ul class="locations-list">
			{#each rows as row (row.id)}
				<li class="location-row">
					<div class="location-row__who">
						<span class="location-row__key">{row.key}</span>
						{#if !row.section}
							<span class="location-row__scope">{m.discussions_wholePage()}</span>
							<!-- "the whole page" — this row is also the ceiling over every section on it. -->
						{/if}
						<span class="location-row__counts">
							{m.discussions_colComments()}: {row.commentCount}
							{#if row.heldCount > 0}
								· <strong>{m.discussions_colHeld()}: {row.heldCount}</strong>
							{/if}
						</span>
						{#if row.updatedByDisplayName}
							<span class="location-row__meta">
								{m.moderation_flags_lastChangedBy({ name: row.updatedByDisplayName })}
							</span>
						{/if}
					</div>

					<div class="location-row__controls">
						<label>
							{m.discussions_colAudience()}
							<select
								value={row.audience}
								disabled={pending[row.id]}
								onchange={(e) =>
									change(row, { audience: e.currentTarget.value as DiscussionAudience })}
							>
								{#each DISCUSSION_AUDIENCES as audience (audience)}
									<option value={audience}>{DISCUSSION_AUDIENCE_LABELS[audience]()}</option>
								{/each}
							</select>
						</label>

						<label class="location-row__check">
							<input
								type="checkbox"
								checked={row.moderated}
								disabled={pending[row.id]}
								onchange={(e) => change(row, { moderated: e.currentTarget.checked })}
							/>
							{m.discussions_colModerated()}
							<!-- "Held for review" -->
						</label>

						<button
							type="button"
							class={row.isEnabled ? 'reject' : 'approve'}
							disabled={pending[row.id]}
							onclick={() => change(row, { isEnabled: !row.isEnabled })}
						>
							{row.isEnabled ? m.moderation_flags_turnOff() : m.moderation_flags_turnOn()}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	.locations-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.locations-intro,
	.locations-muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.locations-error {
		color: var(--danger, #b00020);
		font-size: var(--font-size-sm);
	}
	.locations-add {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		h3 {
			margin: 0;
			font-size: var(--font-size-base);
		}
	}
	.locations-add__fields {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		input {
			flex: 1 1 14rem;
			min-width: 0;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--surface);
			color: var(--text-primary);
			font: inherit;
		}
	}
	.locations-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.location-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
	}
	.location-row__who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.location-row__key {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-size-sm);
		overflow-wrap: anywhere;
	}
	.location-row__scope,
	.location-row__counts,
	.location-row__meta {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.location-row__controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
		}
		select {
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--surface);
			color: var(--text-primary);
			font: inherit;
		}
	}
	.location-row__check {
		flex-direction: row !important;
		align-items: center;
		gap: var(--space-1) !important;
	}
</style>
