<script lang="ts">
	// One attachment's own page: the file, what people made of it, and a thread about it.
	//
	// The thread is deliberately its own, not the course discussion and not a material's public
	// review page. A conversation about last year's exam paper belongs with the paper — mixed into
	// the course-wide discussion it drowns whatever else is being talked about, and it has no
	// business on a site-wide material page, because an attachment is not corpus.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Attachment, AttachmentReview } from '$lib/types/course';
	import {
		getAttachment,
		getAttachmentComments,
		getAttachmentReviews,
		postAttachmentComment,
		reviewAttachment
	} from '$lib/services/course';

	let attachment = $state<Attachment | undefined>(undefined);
	let reviews = $state<AttachmentReview[]>([]);
	let comments = $state<{ id: string; body: string; author: string; createdAt: string }[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');

	let myRating = $state(0);
	let myReviewBody = $state('');
	let commentDraft = $state('');

	const courseId = $derived(page.params.id!);
	const attachmentId = $derived(page.params.attachmentId!);

	/** Bytes as something a person reads. Kilobytes on the way up rather than kibibytes, matching
	 * what a file manager shows — the difference is not worth a footnote on a download link. */
	function readableSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	/* eslint-disable @typescript-eslint/no-explicit-any */
	function mapComment(raw: any) {
		return {
			id: String(raw.id),
			body: raw.body,
			author: raw.author?.display_name ?? raw.author?.username ?? '',
			createdAt: raw.created_at
		};
	}
	/* eslint-enable @typescript-eslint/no-explicit-any */

	async function load() {
		loading = true;
		notFound = false;
		const found = await getAttachment(courseId, attachmentId);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		attachment = found;
		reviews = await getAttachmentReviews(courseId, attachmentId);
		comments = (await getAttachmentComments(courseId, attachmentId)).map(mapComment);
		// Pre-fill with whatever this person already said, so the form edits rather than looking
		// like a second review they are about to leave.
		const mine = reviews.find((r) => r.author.id === authStore.user?.id);
		myRating = mine?.rating ?? 0;
		myReviewBody = mine?.body ?? '';
		loading = false;
	}

	$effect(() => {
		if (attachmentId) load();
	});

	async function submitReview(event: SubmitEvent) {
		event.preventDefault();
		if (!myRating) return;
		error = '';
		try {
			await reviewAttachment(courseId, attachmentId, myRating, myReviewBody);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function submitComment(event: SubmitEvent) {
		event.preventDefault();
		const body = commentDraft.trim();
		if (!body) return;
		error = '';
		try {
			await postAttachmentComment(courseId, attachmentId, body);
			commentDraft = '';
			comments = (await getAttachmentComments(courseId, attachmentId)).map(mapComment);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<svelte:head>
	<title>{attachment?.title ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if notFound}
		<p class="status">{m.course_attachment_notFound()}</p>
	{:else if attachment}
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/courses/[id]', { id: courseId })}>{m.course_backToCourse()}</a>
		</nav>

		<header>
			<h1>{attachment.title}</h1>
			<p class="meta">
				{readableSize(attachment.sizeBytes)}
				{#if attachment.uploadedBy}
					· {attachment.uploadedBy.displayName}
				{/if}
			</p>
			{#if attachment.description}
				<p>{attachment.description}</p>
			{/if}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- a media-server URL, not an
			     app route, so there is nothing for resolve() to resolve. -->
			<a class="download" href={attachment.fileUrl} download>
				{m.course_attachment_download()}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</header>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<section>
			<h2>{m.course_attachment_reviewsHeading()}</h2>
			{#if attachment.averageRating === null}
				<!-- "No ratings yet" rather than 0.0 — a zero is a rating somebody gave. -->
				<p class="status">{m.course_attachment_noReviews()}</p>
			{:else}
				<p class="rating">
					{attachment.averageRating} ★ ({attachment.reviewCount})
				</p>
			{/if}

			<ul class="reviews">
				{#each reviews as review (review.id)}
					<li>
						<strong>{review.author.displayName}</strong>
						<span class="stars">{review.rating} ★</span>
						{#if review.body}<p>{review.body}</p>{/if}
					</li>
				{/each}
			</ul>

			{#if authStore.user}
				<form onsubmit={submitReview}>
					<label class="field">
						<span>{m.course_attachment_yourRating()}</span>
						<select bind:value={myRating}>
							<option value={0} disabled>—</option>
							{#each [1, 2, 3, 4, 5] as value (value)}
								<option {value}>{value} ★</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>{m.course_attachment_yourReview()}</span>
						<textarea bind:value={myReviewBody} rows="3"></textarea>
					</label>
					<button type="submit" class="primary" disabled={!myRating}>
						{m.course_attachment_submitReview()}
					</button>
				</form>
			{/if}
		</section>

		<section>
			<h2>{m.course_attachment_discussionHeading()}</h2>
			<p class="hint">{m.course_attachment_discussionHint()}</p>
			<ul class="comments">
				{#each comments as comment (comment.id)}
					<li>
						<strong>{comment.author}</strong>
						<p>{comment.body}</p>
					</li>
				{:else}
					<li class="status">{m.course_attachment_noComments()}</li>
				{/each}
			</ul>
			{#if authStore.user}
				<form onsubmit={submitComment}>
					<textarea bind:value={commentDraft} rows="3"></textarea>
					<button type="submit" class="primary">{m.course_attachment_post()}</button>
				</form>
			{/if}
		</section>
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
		}
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-lg);
		margin-bottom: var(--space-2);
	}
	.meta,
	.status,
	.hint {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--danger, crimson);
	}
	.download {
		display: inline-block;
		margin-top: var(--space-2);
		color: var(--accent);
		font-weight: 600;
	}
	.reviews,
	.comments {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.stars {
		color: var(--text-secondary);
		margin-left: var(--space-1);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}
	form textarea,
	form select {
		width: 100%;
	}
</style>
