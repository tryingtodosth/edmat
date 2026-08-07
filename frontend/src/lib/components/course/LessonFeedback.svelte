<script lang="ts">
	// A discussion and a rating panel for one lesson or one chapter.
	//
	// One component for both, because the two differ only in which endpoint they call and which
	// words label them — a second copy would be a second place for the lazy-load guard and the
	// author resolution to drift apart. What it is NOT is the course-wide thread, which lives on the
	// course page: the whole point of these is that a question about Tuesday stays with Tuesday.
	//
	// Nothing here loads until somebody opens it. A twelve-week course draws a dozen of these, and
	// fetching every thread and every rating on page load would be a dozen requests for content
	// almost nobody expands.
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import { mapComment } from '$lib/api/mappers';
	import { getUserById } from '$lib/services/users';
	import {
		getCourseTargetComments,
		getCourseTargetReviews,
		postCourseTargetComment,
		reviewCourseTarget,
		type CourseFeedbackTarget
	} from '$lib/services/course';
	import type { Comment, User } from '$lib/types';
	import type { CourseFeedbackReview, RatingSummary } from '$lib/types/course';

	let {
		courseId,
		target,
		targetId,
		summary,
		canWrite,
		canReadDiscussion,
		onrated
	}: {
		courseId: string;
		target: CourseFeedbackTarget;
		targetId: string;
		summary: RatingSummary;
		/** Whether this person is actually in the course. Reading a public course is open to the
		 * internet; posting into it and rating it are not. */
		canWrite: boolean;
		canReadDiscussion: boolean;
		/** So the caller can refresh the summary it owns — this component never mutates its props. */
		onrated?: () => void;
	} = $props();

	let open = $state(false);
	let loaded = $state(false);
	let loading = $state(false);
	let comments = $state<Comment[]>([]);
	let reviews = $state<CourseFeedbackReview[]>([]);
	let usersById = $state<Record<string, User>>({});
	let myRating = $state(0);
	let myBody = $state('');
	let saving = $state(false);
	let error = $state('');

	const targetType = $derived(target === 'lesson' ? 'courseLesson' : 'courseChapter');

	/** Author names for the thread, resolved once per unseen id — the same shape the course page
	 * and the tutoring listing already use, rather than a third way of doing it. */
	async function loadCommentAuthors(rows: Comment[]) {
		const unique = [...new Set(rows.map((c) => c.authorId))].filter((id) => id && !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function load() {
		if (loaded || loading) return;
		loading = true;
		try {
			// Settled together rather than awaited in sequence: they are independent requests, and
			// one failing should not decide whether the other renders. A 403 on the thread is the
			// feature working — the course simply does not let this person read it — so it must not
			// take the ratings down with it.
			const [thread, rated] = await Promise.allSettled([
				canReadDiscussion
					? getCourseTargetComments(courseId, target, targetId)
					: Promise.resolve([]),
				getCourseTargetReviews(courseId, target, targetId)
			]);
			if (thread.status === 'fulfilled') {
				comments = (thread.value as unknown[]).map((raw) =>
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					mapComment(raw as any, targetType, targetId)
				);
				await loadCommentAuthors(comments);
			}
			if (rated.status === 'fulfilled') {
				reviews = rated.value;
				const mine = reviews.find((r) => r.author.id === authStore.user?.id);
				if (mine) {
					myRating = mine.rating;
					myBody = mine.body;
				}
			}
			loaded = true;
		} finally {
			loading = false;
		}
	}

	function toggle() {
		open = !open;
		if (open) void load();
	}

	async function postComment(body: string, parentId?: string) {
		await postCourseTargetComment(courseId, target, targetId, body, parentId);
		const rows = await getCourseTargetComments(courseId, target, targetId);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		comments = (rows as unknown[]).map((raw) => mapComment(raw as any, targetType, targetId));
		await loadCommentAuthors(comments);
	}

	async function submitRating(e: SubmitEvent) {
		e.preventDefault();
		if (myRating < 1) return;
		saving = true;
		error = '';
		try {
			await reviewCourseTarget(courseId, target, targetId, myRating, myBody);
			reviews = await getCourseTargetReviews(courseId, target, targetId);
			onrated?.();
		} catch {
			error = m.courseFeedback_saveError();
		} finally {
			saving = false;
		}
	}
</script>

<div class="feedback">
	<button type="button" class="feedback__toggle" onclick={toggle} aria-expanded={open}>
		<span class="chev" class:chev--open={open} aria-hidden="true">▸</span>
		{target === 'lesson' ? m.courseFeedback_lessonHeading() : m.courseFeedback_chapterHeading()}
		{#if summary.count > 0}
			<!-- Only when somebody has actually rated it. "0 ratings" on every session of every
			     course is noise on a page that already has plenty. -->
			<span class="pill" title={m.courseFeedback_ratingCount({ count: summary.count })}>
				★ {summary.average} · {summary.count}
			</span>
		{/if}
	</button>

	{#if open}
		<div class="feedback__body">
			{#if loading}
				<p class="muted">{m.common_loading()}</p>
			{:else}
				<section class="feedback__ratings">
					<h4>{m.courseFeedback_ratingsHeading()}</h4>
					{#if canWrite}
						<form class="rate" onsubmit={submitRating}>
							<div class="stars" role="radiogroup" aria-label={m.courseFeedback_yourRating()}>
								{#each [1, 2, 3, 4, 5] as star (star)}
									<button
										type="button"
										role="radio"
										aria-checked={myRating === star}
										aria-label={m.courseFeedback_starLabel({ count: star })}
										class="star"
										class:star--on={star <= myRating}
										onclick={() => (myRating = star)}
									>
										★
									</button>
								{/each}
							</div>
							<input
								type="text"
								bind:value={myBody}
								maxlength="2000"
								placeholder={m.courseFeedback_bodyPlaceholder()}
							/>
							<button type="submit" class="link" disabled={saving || myRating < 1}>
								{saving ? m.common_loading() : m.courseFeedback_save()}
							</button>
						</form>
						{#if error}
							<p class="error">{error}</p>
						{/if}
					{:else}
						<p class="muted">{m.courseFeedback_membersOnly()}</p>
					{/if}

					{#if reviews.length === 0}
						<p class="muted">{m.courseFeedback_noRatings()}</p>
					{:else}
						<ul class="reviews">
							{#each reviews as review (review.id)}
								<li>
									<span class="reviews__stars" aria-hidden="true">
										{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
									</span>
									<span class="reviews__who">{review.author.displayName}</span>
									{#if review.body}
										<div class="reviews__body"><MathContent source={review.body} /></div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section class="feedback__discussion">
					<h4>{m.courseFeedback_discussionHeading()}</h4>
					{#if !canReadDiscussion}
						<p class="muted">{m.courseFeedback_discussionClosed()}</p>
					{:else if canWrite}
						<DiscussionThread {comments} {usersById} onSubmit={postComment} />
					{:else}
						<!-- Readable, not writable: the same split the course thread already makes. -->
						<p class="muted">{m.courseFeedback_readOnly()}</p>
						<DiscussionThread {comments} {usersById} onSubmit={() => {}} />
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.feedback {
		margin-top: var(--space-2);
	}

	.feedback__toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: none;
		border: none;
		padding: var(--space-1) 0;
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;

		&:hover {
			color: var(--accent);
		}
	}

	.chev {
		display: inline-block;
		transition: transform 0.15s ease;
	}
	.chev--open {
		transform: rotate(90deg);
	}

	.pill {
		background: var(--bg-surface-alt);
		border-radius: 999px;
		padding: 0 var(--space-2);
		font-size: 0.75rem;
	}

	.feedback__body {
		border-left: 2px solid var(--border-color);
		margin-top: var(--space-2);
		padding-left: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	h4 {
		margin: 0 0 var(--space-2) 0;
		font-size: 0.9rem;
	}

	.rate {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);

		input {
			flex: 1 1 12rem;
			min-width: 0;
		}
	}

	.stars {
		display: inline-flex;
	}

	.star {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1.15rem;
		line-height: 1;
		padding: 0 0.05rem;
		color: var(--border-color);

		&--on {
			color: var(--status-warning);
		}
	}

	.reviews {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		li {
			font-size: 0.9rem;
		}
	}

	.reviews__stars {
		color: var(--status-warning);
		margin-right: var(--space-2);
	}

	.reviews__who {
		color: var(--text-secondary);
		font-size: 0.85rem;
	}

	.reviews__body {
		margin-top: var(--space-1);
	}

	.muted {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin: 0 0 var(--space-2) 0;
	}

	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
