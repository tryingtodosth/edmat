<script lang="ts">
	import type { ReportKind, User } from '$lib/types';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import StarRating from '$lib/components/shared/StarRating.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';

	// A structural shape (id/userId/rating/body/createdAt), not the full exercise-specific `Review`
	// type — lets this same component render a tutoring listing's own `ServiceReview` too
	// (services/+page.svelte's detail view), without either type needing a shared base interface.
	interface ReviewLike {
		id: string;
		userId: string;
		rating: number;
		body?: string;
		createdAt: string;
	}

	let {
		reviews,
		usersById,
		showReportButton = true,
		kind = 'review'
	}: {
		reviews: ReviewLike[];
		usersById: Record<string, User>;
		showReportButton?: boolean;
		// 'review' (community.Review, an Exercise review) by default; the tutoring-listing detail
		// page passes 'service_review' — a genuinely different backend model/report kind sharing
		// this exact same list shape, per `ReviewLike`'s own doc comment above.
		kind?: ReportKind;
	} = $props();
</script>

{#if reviews.length === 0}
	<p class="empty">{m.review_noReviews()}</p>
{:else}
	<ul class="review-list">
		{#each reviews as review (review.id)}
			<li class="review">
				<div class="review__top">
					{#if usersById[review.userId]}
						<a class="review__author" href={resolve('/users/[id]', { id: review.userId })}>
							{usersById[review.userId].displayName}
						</a>
					{:else}
						<span class="review__author">—</span>
					{/if}
					<StarRating value={review.rating} />
					<span class="review__date">{formatRelativeDate(review.createdAt, getLocale())}</span>
				</div>
				{#if review.body}
					<p class="review__body">{review.body}</p>
				{/if}
				{#if showReportButton}
					<div class="review__actions">
						<ReportButton {kind} objectId={review.id} />
					</div>
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
		&:hover {
			text-decoration: underline;
		}
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
	.review__actions {
		margin-top: var(--space-1);
	}
</style>
