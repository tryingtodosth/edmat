<script lang="ts">
	// The course BOARD (owner, 2026-10-21: "some sort of discussion board … for people to be able to
	// post pdfs, imgs, notes, comments, links, etc, and link and be linked to specific
	// courses/subcourses"). A board post IS a post (`activity.Post`) — the thing the tag page lists
	// and `/ask` writes — that references this course (`ref_course`); what this tab adds is the
	// reading from the course's side: `GET /api/posts/?course=<id>`, every post about this course
	// or one under it (its versions and subcourses, any depth), newest first. A post made from
	// here still lives in its tag, where the people who follow the tag see it — the board is a view
	// of the same posts, not a second place to keep them.
	//
	// Files, pictures, notes and links ride on a post through `attachments/`, and the composer on
	// `/ask?course=` offers them; a row here says how many it carries. Behind the `posts` switch —
	// the tab itself is only offered when it is on (the course page decides).
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { getPostsForCourse } from '$lib/services/activity';
	import { authStore } from '$lib/state/auth.svelte';
	import PostCard from '$lib/components/activity/PostCard.svelte';
	import type { Post } from '$lib/types';
	import type { Course } from '$lib/types/course';

	let { course }: { course: Course } = $props();

	const PAGE_SIZE = 20;
	let posts = $state<Post[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let failed = $state(false);
	let hasMore = $state(false);

	async function load(id: string, append = false) {
		if (append) loadingMore = true;
		else loading = true;
		failed = false;
		try {
			const fetched = await getPostsForCourse(id, {
				beforeId: append && posts.length > 0 ? posts[posts.length - 1].id : undefined,
				limit: PAGE_SIZE
			});
			if (loadedFor !== id) return;
			posts = append ? [...posts, ...fetched] : fetched;
			hasMore = fetched.length === PAGE_SIZE;
		} catch (e) {
			if (!(e instanceof ApiError && e.status === 404)) failed = true;
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	// Trap 2 in frontend/CLAUDE.md: a load keyed on an id needs the id-changed guard.
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const id = course.id;
		if (id === loadedFor) return;
		loadedFor = id;
		posts = [];
		load(id);
	});

	function removed(id: string) {
		posts = posts.filter((p) => p.id !== id);
	}
</script>

<section class="board" aria-labelledby="course-board-heading" data-course-board>
	<div class="head">
		<h2 id="course-board-heading">{m.course_board_heading()}</h2>
		<!-- "Board" -->
		{#if authStore.isAuthenticated}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus a query string -->
			<a class="post-here" href={`${resolve('/ask')}?course=${course.id}`}>
				{m.course_board_post()}
				<!-- "Post about this course" -->
			</a>
		{/if}
	</div>
	<p class="hint">{m.course_board_hint()}</p>
	<!-- "Questions, notes, files and links about this course and its subcourses. Every post also lives in its tag, where people who follow the tag see it." -->

	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if failed}
		<p class="status">{m.common_error_generic()}</p>
	{:else if posts.length === 0}
		<p class="status">{m.course_board_empty()}</p>
		<!-- "Nothing posted about this course yet." -->
	{:else}
		<ul class="posts">
			{#each posts as post (post.id)}
				<li>
					{#if post.refCourseId && post.refCourseId !== course.id}
						<p class="about">
							{m.course_board_aboutSubcourse({ title: post.refCourseTitle ?? '' })}
							<!-- "In the subcourse “{title}”" -->
						</p>
					{/if}
					<PostCard {post} onDeleted={removed} />
				</li>
			{/each}
		</ul>
		{#if hasMore}
			<button
				type="button"
				class="secondary"
				disabled={loadingMore}
				onclick={() => load(course.id, true)}
			>
				{loadingMore ? m.common_loading() : m.activity_loadMore()}
			</button>
		{/if}
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.board {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.post-here {
		@include mix.button-primary;
		text-decoration: none;
	}
	.hint,
	.status,
	.about {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.posts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.about {
		margin-bottom: var(--space-1);
	}
	.secondary {
		@include mix.button-secondary;
		align-self: flex-start;
	}
</style>
