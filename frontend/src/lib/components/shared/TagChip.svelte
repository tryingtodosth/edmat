<script lang="ts">
	// A tag pill that opens a hover-triggered action menu — "follow, set notifications, save for
	// later, add to different content," per the explicit request. Hover-to-open (desktop) with a
	// leave-delay so moving the pointer from the pill into the menu itself doesn't close it, PLUS
	// click-to-toggle (the accessible/touch fallback — touch has no hover at all, and a plain click
	// is friendlier than relying on hover for keyboard users too). Same outside-click/Escape-close
	// convention every other anchored popover in this app already follows (RandomExerciseButton,
	// NotificationBell) — including NotificationBell's own `composedPath()` fix for the exact "a
	// click inside the menu causes its own target to un-render" race, since "Follow"/"Notify" here
	// have that identical shape (clicking Follow removes the Notify row that used to be a sibling).
	import { resolve } from '$app/paths';
	import type { TaggableKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { tagFollowStore } from '$lib/state/tagFollows.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { getExerciseIdsForTag } from '$lib/services/exercises';
	import { getTagBySlug, removeTagFromContent } from '$lib/services/tags';
	import AddTagToContentModal from './AddTagToContentModal.svelte';
	import ReportButton from './ReportButton.svelte';

	// `appliedTo` — optional, since a caller only ever knows "this tag is currently applied to THIS
	// specific piece of content" when it's rendering the chip on that content's own page/card, not
	// e.g. inside a generic tag-list-everywhere-it-appears view. Both real call sites today
	// (exercises/[id]/+page.svelte, MaterialCard.svelte) always have this — a bare `{tag}` with no
	// `appliedTo` just quietly omits the "Remove" row rather than erroring, so nothing breaks if a
	// future caller genuinely doesn't have a target to remove from.
	let {
		tag,
		appliedTo
	}: {
		tag: string;
		appliedTo?: { kind: TaggableKind; objectId: string; onRemoved: () => void };
	} = $props();

	let open = $state(false);
	let container: HTMLSpanElement | undefined = $state();
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let savingForLater = $state(false);
	let savedMessage = $state('');
	let addingToContent = $state(false);
	let removing = $state(false);
	// Resolved lazily, only once the menu is actually opened while authenticated — every other tag
	// reference in this app is slug-keyed (see `getTagBySlug`'s own doc comment), this is the one
	// spot that needs the real numeric id (Report's own object_id), so it isn't fetched for every
	// rendered chip, only for the ones a user actually interacts with.
	let tagId = $state<string | null>(null);

	function openMenu() {
		clearTimeout(closeTimer);
		open = true;
		if (authStore.isAuthenticated) {
			tagFollowStore.ensureLoaded();
			if (tagId === null) getTagBySlug(tag).then((t) => (tagId = t.id));
		}
	}

	function scheduleClose() {
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => (open = false), 250);
	}

	function toggleMenu() {
		if (open) {
			open = false;
		} else {
			openMenu();
		}
	}

	function handleWindowClick(event: MouseEvent) {
		if (!open || !container) return;
		if (!event.composedPath().includes(container)) open = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}

	async function handleFollowToggle() {
		if (tagFollowStore.isFollowing(tag)) {
			await tagFollowStore.unfollow(tag);
		} else {
			await tagFollowStore.follow(tag);
		}
	}

	async function handleSaveForLater() {
		savingForLater = true;
		savedMessage = '';
		try {
			const ids = await getExerciseIdsForTag(tag);
			const added = guestSetStore.addMany(ids);
			savedMessage = added > 0 ? m.tag_savedCount({ count: added }) : m.tag_savedNone();
		} finally {
			savingForLater = false;
		}
	}

	// The backend endpoint (TagViewSet.apply, DELETE) and this exact service function
	// (removeTagFromContent) already existed — only the menu affordance calling either was missing.
	// No confirmation step, matching "add to different content" right below it: tagging is
	// additive, reversible, low-stakes organizational metadata (TagViewSet.apply's own doc comment),
	// not a destructive action on the content itself.
	async function handleRemove() {
		if (!appliedTo) return;
		removing = true;
		try {
			await removeTagFromContent(tag, appliedTo.kind, appliedTo.objectId);
			open = false;
			appliedTo.onRemoved();
		} finally {
			removing = false;
		}
	}
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<span
	class="tag-chip"
	role="group"
	aria-label={tag}
	bind:this={container}
	onmouseenter={openMenu}
	onmouseleave={scheduleClose}
>
	<button
		type="button"
		class="tag-chip__trigger"
		onclick={toggleMenu}
		aria-expanded={open}
		title={tag}
	>
		#{tag}
	</button>

	{#if open}
		<div
			class="tag-chip__menu"
			role="menu"
			tabindex="-1"
			onmouseenter={() => clearTimeout(closeTimer)}
			onmouseleave={scheduleClose}
		>
			{#if authStore.isAuthenticated}
				<button type="button" class="tag-chip__item" onclick={handleFollowToggle}>
					{tagFollowStore.isFollowing(tag) ? m.tag_unfollow() : m.tag_follow()}
				</button>
				{#if tagFollowStore.isFollowing(tag)}
					<label class="tag-chip__item tag-chip__notify">
						<input
							type="checkbox"
							checked={tagFollowStore.notifyEnabled(tag)}
							onchange={(e) =>
								tagFollowStore.setNotify(tag, (e.currentTarget as HTMLInputElement).checked)}
						/>
						{m.tag_notifyMe()}
					</label>
				{/if}
			{:else}
				<a class="tag-chip__item tag-chip__login" href={resolve('/login')}>
					{m.tag_loginToFollow()}
				</a>
			{/if}

			<button
				type="button"
				class="tag-chip__item"
				onclick={handleSaveForLater}
				disabled={savingForLater}
			>
				{savingForLater ? m.common_loading() : m.tag_saveForLater()}
			</button>
			{#if savedMessage}
				<p class="tag-chip__note">{savedMessage}</p>
			{/if}

			{#if authStore.isAuthenticated}
				<button
					type="button"
					class="tag-chip__item"
					onclick={() => {
						addingToContent = true;
						open = false;
					}}
				>
					{m.tag_addToContent()}
				</button>
			{/if}

			{#if authStore.isAuthenticated && appliedTo}
				<button
					type="button"
					class="tag-chip__item tag-chip__remove"
					onclick={handleRemove}
					disabled={removing}
				>
					{removing ? m.common_loading() : m.tag_removeFromContent()}
				</button>
			{/if}

			{#if authStore.isAuthenticated && tagId}
				<div class="tag-chip__item">
					<ReportButton kind="tag" objectId={tagId} />
				</div>
			{/if}
		</div>
	{/if}
</span>

{#if addingToContent}
	<AddTagToContentModal {tag} onClose={() => (addingToContent = false)} />
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.tag-chip {
		position: relative;
		display: inline-flex;
	}
	.tag-chip__trigger {
		@include mix.focus-ring;
		@include mix.status-pill(var(--accent), var(--accent-soft));
		border: none;
		cursor: pointer;
		font: inherit;
		// Unlike the other status-pill consumers (type/difficulty/source badges — a short, fixed
		// vocabulary), a tag is free-form, uploader-chosen text with no length cap — the real corpus
		// has tags 40+ characters long. The mixin's own `white-space: nowrap` is right for those
		// short badges but lets a long tag stretch the pill arbitrarily wide instead; truncate it here
		// instead, with the full label still available via `title`.
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tag-chip__menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: var(--z-popover);
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-popover);
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		min-width: 200px;
		font-size: var(--font-size-sm);
	}
	.tag-chip__item {
		@include mix.focus-ring;
		background: none;
		border: none;
		text-align: left;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		&:hover:not(:disabled) {
			background: var(--bg-surface-alt);
		}
		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
	}
	.tag-chip__login {
		color: var(--accent);
		font-weight: 600;
	}
	.tag-chip__notify {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.tag-chip__note {
		padding: 2px var(--space-2) var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--status-success);
	}
	.tag-chip__remove {
		color: var(--status-danger);
	}
</style>
