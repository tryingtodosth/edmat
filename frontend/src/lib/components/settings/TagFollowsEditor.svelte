<script lang="ts">
	// "My followed tags" — the settings page's own list-and-manage surface for TagFollow rows, the
	// same "a dedicated editor embedded as its own settings section" shape DonationLinksEditor.svelte
	// already established (list, per-row actions, no separate route/nav-link needed). Following/
	// muting has always worked per-tag from the hover menu (TagChip.svelte); what was missing was
	// ever seeing everything followed AT ONCE in one place, which is exactly what this closes —
	// nothing new on the backend or in tagFollowStore's own mutation methods, only a new `list`
	// getter (tagFollows.svelte.ts) and this rendering surface on top of what already existed.
	import { m } from '$lib/paraglide/messages.js';
	import { tagFollowStore } from '$lib/state/tagFollows.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { getExerciseIdsForTag } from '$lib/services/exercises';

	tagFollowStore.ensureLoaded();

	let savingTag = $state<string | null>(null);
	let savedMessage = $state<Record<string, string>>({});

	async function handleSaveForLater(tag: string) {
		savingTag = tag;
		savedMessage = { ...savedMessage, [tag]: '' };
		try {
			const ids = await getExerciseIdsForTag(tag);
			const added = guestSetStore.addMany(ids);
			savedMessage = {
				...savedMessage,
				[tag]: added > 0 ? m.tag_savedCount({ count: added }) : m.tag_savedNone()
			};
		} finally {
			savingTag = null;
		}
	}
</script>

<div class="tag-follows-editor">
	{#if !tagFollowStore.loaded}
		<p class="hint">{m.common_loading()}</p>
	{:else if tagFollowStore.list.length === 0}
		<p class="hint">{m.tagFollows_none()}</p>
	{:else}
		<ul class="follow-list">
			{#each tagFollowStore.list as follow (follow.tag)}
				<li class="follow-row">
					<span class="follow-row__tag">#{follow.tag}</span>

					<label class="follow-row__notify">
						<input
							type="checkbox"
							checked={follow.notify}
							onchange={(e) =>
								tagFollowStore.setNotify(follow.tag, (e.currentTarget as HTMLInputElement).checked)}
						/>
						{m.tag_notifyMe()}
					</label>

					<button
						type="button"
						class="follow-row__action"
						onclick={() => handleSaveForLater(follow.tag)}
						disabled={savingTag === follow.tag}
					>
						{savingTag === follow.tag ? m.common_loading() : m.tag_saveForLater()}
					</button>

					<button
						type="button"
						class="follow-row__remove"
						onclick={() => tagFollowStore.unfollow(follow.tag)}
						aria-label={m.tag_unfollow()}>&times;</button
					>

					{#if savedMessage[follow.tag]}
						<p class="follow-row__note">{savedMessage[follow.tag]}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.tag-follows-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.follow-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.follow-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		font-size: var(--font-size-sm);
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
		}
	}
	.follow-row__tag {
		@include mix.status-pill(var(--accent), var(--accent-soft));
		font-weight: 600;
	}
	.follow-row__notify {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.follow-row__action {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
		padding: 2px var(--space-2);
	}
	.follow-row__remove {
		@include mix.focus-ring;
		background: none;
		border: none;
		color: var(--status-danger);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		margin-left: auto;
	}
	.follow-row__note {
		flex-basis: 100%;
		font-size: var(--font-size-xs);
		color: var(--status-success);
		margin: 0;
	}
</style>
