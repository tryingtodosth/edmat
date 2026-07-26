<script lang="ts">
	// The settings page's own CRUD surface for "users can set multiple donation links that [a
	// visitor] can choose from" — list, a small add form, per-row delete. No reordering UI (the
	// `order` field exists and is honored by the public display, but hand-editing it via drag-and-
	// drop is more than this first pass needs — new links just append after whatever's already
	// there via a simple incrementing `order`).
	import type { DonationLink, DonationPlatform } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		DONATION_PLATFORMS,
		DONATION_PLATFORM_ICONS,
		DONATION_PLATFORM_LABELS
	} from '$lib/utils/labels';
	import {
		createDonationLink,
		deleteDonationLink,
		getMyDonationLinks
	} from '$lib/services/donationLinks';

	let links = $state<DonationLink[]>([]);
	let loading = $state(true);
	let platform = $state<DonationPlatform>('paypal');
	let label = $state('');
	let url = $state('');
	let submitting = $state(false);
	let error = $state('');

	async function load() {
		loading = true;
		links = await getMyDonationLinks();
		loading = false;
	}
	load();

	async function handleAdd(event: SubmitEvent) {
		event.preventDefault();
		if (!url.trim()) return;
		submitting = true;
		error = '';
		try {
			const nextOrder = links.length > 0 ? Math.max(...links.map((l) => l.order)) + 1 : 0;
			const created = await createDonationLink({
				platform,
				label: label.trim(),
				url: url.trim(),
				order: nextOrder
			});
			links = [...links, created];
			label = '';
			url = '';
		} catch {
			error = m.donation_addFailed();
		} finally {
			submitting = false;
		}
	}

	async function handleDelete(id: string) {
		const previous = links;
		links = links.filter((l) => l.id !== id);
		try {
			await deleteDonationLink(id);
		} catch {
			links = previous;
		}
	}
</script>

<div class="donation-editor">
	{#if loading}
		<p class="hint">{m.common_loading()}</p>
	{:else}
		{#if links.length > 0}
			<ul class="link-list">
				{#each links as link (link.id)}
					<li class="link-row">
						<span aria-hidden="true">{DONATION_PLATFORM_ICONS[link.platform]}</span>
						<span class="link-row__label">{link.displayLabel}</span>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external donation platform URL, not an app route resolve() can express -->
						<a class="link-row__url" href={link.url} target="_blank" rel="noopener noreferrer">
							{link.url}
						</a>
						<button
							type="button"
							class="remove"
							onclick={() => handleDelete(link.id)}
							aria-label={m.common_delete()}>&times;</button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">{m.donation_none()}</p>
		{/if}

		<form class="add-form" onsubmit={handleAdd}>
			<select bind:value={platform} aria-label={m.donation_platformLabel()}>
				{#each DONATION_PLATFORMS as p (p)}
					<option value={p}>{DONATION_PLATFORM_LABELS[p]()}</option>
				{/each}
			</select>
			<input
				type="text"
				bind:value={label}
				placeholder={m.donation_labelPlaceholder()}
				aria-label={m.donation_labelPlaceholder()}
			/>
			<input
				type="url"
				bind:value={url}
				placeholder={m.donation_urlPlaceholder()}
				aria-label={m.donation_urlPlaceholder()}
				required
			/>
			<button type="submit" disabled={submitting}>{m.donation_add()}</button>
		</form>
		{#if error}
			<p class="error">{error}</p>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.donation-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.link-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.link-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		font-size: var(--font-size-sm);
	}
	.link-row__label {
		font-weight: 600;
		flex-shrink: 0;
	}
	.link-row__url {
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.remove {
		@include mix.focus-ring;
		background: none;
		border: none;
		color: var(--status-danger);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		flex-shrink: 0;
	}
	.add-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		select,
		input {
			@include mix.focus-ring;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
			font-size: var(--font-size-sm);
		}
		input[type='url'] {
			flex: 1;
			min-width: 160px;
		}
		button {
			@include mix.button-secondary;
		}
	}
	.error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
</style>
