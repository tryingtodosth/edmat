<script lang="ts">
	import type { Review, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import StarRating from '$lib/components/shared/StarRating.svelte';

	let { reviews, usersById }: { reviews: Review[]; usersById: Record<string, User> } = $props();
</script>

{#if reviews.length === 0}
	<p class="empty">{m.review_noReviews()}</p>
{:else}
	<ul class="review-list">
		{#each reviews as review (review.id)}
			<li class="review">
				<div class="review__top">
					<span class="review__author">{usersById[review.userId]?.displayName ?? '—'}</span>
					<StarRating value={review.rating} />
					<span class="review__date">{formatRelativeDate(review.createdAt, getLocale())}</span>
				</div>
				{#if review.body}
					<p class="review__body">{review.body}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style lang="scss">
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.review-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.review {
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-3);
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.review__top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.review__author {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.review__date {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin-left: auto;
	}
	.review__body {
		margin-top: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
