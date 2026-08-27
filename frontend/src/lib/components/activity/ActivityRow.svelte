<!-- One feed row: a kind chip, the actor, the target as a link, the time. A kind='post' row
     renders the whole PostCard instead — the post's own words ARE the row. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { FeedItem } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatRelativeDate } from '$lib/utils/format';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import PostCard from './PostCard.svelte';

	let { item }: { item: FeedItem } = $props();

	function kindLabel(): string {
		switch (item.kind) {
			case 'exercise':
				return m.activity_kind_exercise(); // "New exercise"
			case 'material':
				return m.activity_kind_material(); // "New material"
			case 'solution_entry':
				return item.entryKind === 'hint' ? m.activity_kind_hint() : m.activity_kind_solution();
			case 'translation':
				return m.activity_kind_translation(); // "New translation"
			case 'course':
				return m.activity_kind_course(); // "New course"
			case 'event':
				return m.activity_kind_event(); // "New event"
			case 'service':
				return m.activity_kind_service(); // "New tutoring listing"
			case 'review':
				return m.activity_kind_review(); // "New review"
			case 'claim':
				return m.activity_kind_claim(); // "New claim"
			case 'comment':
				return m.activity_kind_comment(); // "New comment"
			default:
				return m.activity_kind_post(); // "Post"
		}
	}

	function href(): string | null {
		if (item.exerciseId) return resolve('/exercises/[id]', { id: item.exerciseId });
		if (item.materialId) return resolve('/materials/[id]', { id: item.materialId });
		if (item.courseId) return resolve('/courses/[id]', { id: item.courseId });
		if (item.eventId) return resolve('/events/[id]', { id: item.eventId });
		if (item.serviceId) return resolve('/services/[id]', { id: item.serviceId });
		if (item.postId) return resolve('/posts/[id]', { id: item.postId });
		return null;
	}
</script>

{#if item.kind === 'post' && item.post}
	<div class="row row--post">
		<PostCard post={item.post} />
	</div>
{:else}
	<div class="row">
		<span class="row__kind">{kindLabel()}</span>
		{#if href()}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built by href(), which calls resolve() itself -->
			<a class="row__title" href={href()}><MathTitle text={item.targetLabel} /></a>
		{:else}
			<span class="row__title"><MathTitle text={item.targetLabel} /></span>
		{/if}
		{#if item.actorDisplayName}
			{#if item.actorId}
				<a class="row__actor" href={resolve('/users/[id]', { id: item.actorId })}
					>{m.activity_by({ name: item.actorDisplayName })}</a
				>
			{:else}
				<span class="row__actor">{m.activity_by({ name: item.actorDisplayName })}</span>
			{/if}
		{/if}
		<span class="row__when">{formatRelativeDate(item.createdAt, getLocale())}</span>
	</div>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.row--post {
		display: block;
	}
	.row__kind {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		flex: 0 0 auto;
	}
	.row__title {
		font-weight: 600;
		min-width: 0;
	}
	a.row__title {
		color: var(--accent);
	}
	.row__actor {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	a.row__actor {
		color: var(--accent);
	}
	.row__when {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
</style>
