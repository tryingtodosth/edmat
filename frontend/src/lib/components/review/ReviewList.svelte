<script lang="ts">
	import type { Comment, CommentTargetType, ReportKind, User } from '$lib/types';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import StarRating from '$lib/components/shared/StarRating.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';

	// A structural shape (id/userId/rating/body/createdAt), not the full exercise-specific `Review`
	// type — lets this same component render a tutoring listing's own `ServiceReview` too
	// (services/+page.svelte's detail view), without either type needing a shared base interface.
	interface ReviewLike {
		id: string;
		userId: string;
		rating: number;
		body?: string;
		createdAt: string;
		replyCount?: number;
	}

	let {
		reviews,
		usersById,
		showReportButton = true,
		kind = 'review',
		commentTarget
	}: {
		reviews: ReviewLike[];
		usersById: Record<string, User>;
		showReportButton?: boolean;
		// 'review' (community.Review, an Exercise review) by default; the tutoring-listing detail
		// page passes 'service_review' — a genuinely different backend model/report kind sharing
		// this exact same list shape, per `ReviewLike`'s own doc comment above.
		kind?: ReportKind;
		// Which backend thread a reply here belongs to. Optional because it says which of the three
		// review kinds these rows actually are — something `kind` cannot answer (a material review
		// has no report kind at all and falls back to the default). Left out, the rows render
		// exactly as they did before replies existed.
		commentTarget?: CommentTargetType;
	} = $props();

	// Per review id. Only the thread you opened is fetched — a page can carry a dozen reviews, and
	// loading every conversation on every page load to show a handful that anybody opens is a lot
	// of requests for nothing.
	let openIds = $state<Record<string, boolean>>({});
	let threads = $state<Record<string, Comment[]>>({});
	let loading = $state<Record<string, boolean>>({});
	// Reply authors are frequently not in the `usersById` the page assembled for the reviews
	// themselves, so they are resolved here rather than left rendering as a dash.
	let extraUsers = $state<Record<string, User>>({});
	let allUsers = $derived({ ...usersById, ...extraUsers });

	async function resolveAuthors(comments: Comment[]) {
		const missing = [...new Set(comments.map((c) => c.authorId))].filter((id) => !allUsers[id]);
		await Promise.all(
			missing.map(async (id) => {
				const user = await getUserById(id);
				if (user) extraUsers = { ...extraUsers, [id]: user };
			})
		);
	}

	async function loadThread(reviewId: string) {
		if (!commentTarget) return;
		loading = { ...loading, [reviewId]: true };
		try {
			const comments = await getCommentsForTarget(commentTarget, reviewId);
			threads = { ...threads, [reviewId]: comments };
			await resolveAuthors(comments);
		} finally {
			loading = { ...loading, [reviewId]: false };
		}
	}

	async function toggle(reviewId: string) {
		const nowOpen = !openIds[reviewId];
		openIds = { ...openIds, [reviewId]: nowOpen };
		if (nowOpen && threads[reviewId] === undefined) await loadThread(reviewId);
	}

	async function post(reviewId: string, body: string, parentId?: string) {
		if (!commentTarget) return;
		await submitComment(commentTarget, reviewId, authStore.user?.id ?? '', body, parentId);
		// Re-read rather than appending locally: the reply has to land in the right place in the
		// tree, and the server already knows where that is.
		await loadThread(reviewId);
	}

	function replyLabel(review: ReviewLike): string {
		const known = threads[review.id]?.length ?? review.replyCount ?? 0;
		return known > 0 ? m.review_replyCount({ count: String(known) }) : m.review_reply();
	}
</script>

{#if reviews.length === 0}
	<p class="empty">{m.review_noReviews()}</p>
{:else}
	<ul class="review-list">
		{#each reviews as review (review.id)}
			<li class="review">
				<div class="review__top">
					{#if allUsers[review.userId]}
						<a class="review__author" href={resolve('/users/[id]', { id: review.userId })}>
							{allUsers[review.userId].displayName}
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
				<div class="review__actions">
					{#if commentTarget}
						<button
							type="button"
							class="review__replies-toggle"
							aria-expanded={!!openIds[review.id]}
							onclick={() => toggle(review.id)}
						>
							{replyLabel(review)}
						</button>
					{/if}
					{#if showReportButton}
						<ReportButton {kind} objectId={review.id} />
					{/if}
				</div>

				{#if commentTarget && openIds[review.id]}
					<div class="review__thread">
						{#if loading[review.id] && threads[review.id] === undefined}
							<p class="review__loading">{m.common_loading()}</p>
						{:else}
							<DiscussionThread
								comments={threads[review.id] ?? []}
								usersById={allUsers}
								onSubmit={(body, parentId) => post(review.id, body, parentId)}
							/>
						{/if}
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
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.review__replies-toggle {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}
	.review__thread {
		margin-top: var(--space-3);
		padding-left: var(--space-3);
		border-left: 2px solid var(--border-color);
	}
	.review__loading {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
