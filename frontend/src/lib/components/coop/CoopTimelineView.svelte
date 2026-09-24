<script lang="ts">
	// Design B, "Timeline": what happened here, newest first, on a dotted rail — 2donet's content
	// history popover and its Report layout's "recent achievements", as one list. Every row is
	// an event the reader could have found by opening the version it names; nothing here is
	// derived from anything they cannot see.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import type { CoopOverview } from '$lib/types/materialsCoop';
	import { TIMELINE_KIND_LABELS } from './labels';
	import MemberAvatar from './MemberAvatar.svelte';

	let { overview, limit = undefined }: { overview: CoopOverview; limit?: number } = $props();

	let events = $derived(limit ? overview.timeline.slice(0, limit) : overview.timeline);
	let more = $derived(overview.timeline.length - events.length);
</script>

{#if events.length === 0}
	<p class="hint">{m.coop_timeline_empty()}</p>
	<!-- "Nothing has happened here yet." -->
{:else}
	<ol class="timeline">
		{#each events as event, i (event.kind + event.at + (event.versionId ?? '') + (event.actorId ?? '') + i)}
			<li class="event event--{event.kind}">
				<span class="dot" aria-hidden="true"></span>
				{#if event.actorId}
					<MemberAvatar userId={event.actorId} displayName={event.actorDisplayName} size={24} />
				{/if}
				<div class="text">
					<p class="line">
						{#if event.actorId}
							<a class="actor" href={resolve('/users/[id]', { id: event.actorId })}
								>{event.actorDisplayName}</a
							>
						{:else}
							<span class="actor">{m.coop_timeline_someone()}</span>
							<!-- "Someone" -->
						{/if}
						{TIMELINE_KIND_LABELS[event.kind]()}
						{#if event.versionNumber !== null}
							<a
								class="version"
								href={resolve('/material-projects/[id]/versions/[number]', {
									id: overview.projectId,
									number: String(event.versionNumber)
								})}>{m.coauth_versions_number({ number: event.versionNumber })}</a
							>
							<!-- "Version {number}" -->
						{/if}
					</p>
					{#if event.label}
						<p class="label">{event.label}</p>
					{/if}
					<time class="when" datetime={event.at}>{formatDate(event.at)}</time>
				</div>
			</li>
		{/each}
	</ol>
	{#if more > 0}
		<p class="hint">{m.coop_timeline_more({ count: more })}</p>
		<!-- "{count} earlier events on the cooperation page" -->
	{/if}
{/if}

<style lang="scss">
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0 0 0 var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border-left: 2px solid var(--border-color);
	}
	.event {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding-left: var(--space-3);
	}
	.dot {
		position: absolute;
		left: calc(-1 * var(--space-2) - 6px);
		top: 6px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--text-secondary);
		border: 2px solid var(--bg-surface);
	}
	.event--version_published .dot {
		background: var(--status-success);
	}
	.event--version_proposed .dot,
	.event--version_drafted .dot {
		background: var(--status-info);
	}
	.event--version_rejected .dot,
	.event--version_withdrawn .dot {
		background: var(--status-danger);
	}
	.event--member_joined .dot {
		background: var(--accent);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.line,
	.label {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.actor {
		font-weight: 600;
		color: var(--text-primary);
	}
	.version {
		color: var(--accent);
	}
	.label {
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.hint {
		margin: 0;
	}
</style>
