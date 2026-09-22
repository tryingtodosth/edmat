<script lang="ts">
	// The history: every version this reader is allowed to see, newest first.
	//
	// Newest first even though the backend orders by number ascending — a history is read from what
	// happened last. The row says what state it ended in, because "version 4" means something
	// different when it was rejected than when it is the one people are downloading.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import type { MaterialVersion } from '$lib/types/materialProject';
	import { VERSION_KIND_LABELS, VERSION_STATUS_LABELS } from './labels';

	let {
		projectId,
		versions,
		currentNumber = undefined
	}: {
		projectId: string;
		versions: MaterialVersion[];
		/** Drawn as "you are here" rather than linked. */
		currentNumber?: number;
	} = $props();

	let ordered = $derived([...versions].sort((a, b) => b.number - a.number));
</script>

<section class="versions">
	<h2>{m.coauth_versions_heading()}</h2>
	<!-- "Versions" -->
	{#if ordered.length === 0}
		<p class="hint">{m.coauth_versions_empty()}</p>
		<!-- "No versions yet." -->
	{:else}
		<ul>
			{#each ordered as version (version.id)}
				<li class:here={version.number === currentNumber}>
					<div class="row">
						<strong>{m.coauth_versions_number({ number: version.number })}</strong>
						<!-- "Version {number}" -->
						<span class="badge badge--{version.status}"
							>{VERSION_STATUS_LABELS[version.status]()}</span
						>
						<span class="kind">{VERSION_KIND_LABELS[version.kind]()}</span>
						<span class="when">{formatDate(version.publishedAt ?? version.createdAt)}</span>
						{#if version.createdByDisplayName}
							<span class="who">
								{m.coauth_versions_by({ name: version.createdByDisplayName })}
								<!-- "by {name}" -->
							</span>
						{/if}
					</div>
					{#if version.changeNote}
						<p class="note">{version.changeNote}</p>
					{/if}
					<div class="row">
						{#if version.number !== currentNumber}
							<a
								class="open"
								href={resolve('/material-projects/[id]/versions/[number]', {
									id: projectId,
									number: String(version.number)
								})}>{m.coauth_versions_open()}</a
							>
							<!-- "Open" -->
						{/if}
						{#if version.kind === 'file' && version.fileUrl}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- our own media server, not an app route -->
							<a class="open" href={version.fileUrl} download>{m.coauth_versions_download()}</a>
							<!-- "Download" -->
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.versions {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	li {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.here {
		border-color: var(--accent);
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.badge {
		font-size: var(--font-size-xs);
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.badge--published {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.badge--proposed {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.badge--rejected {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.kind,
	.when,
	.who,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.note {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.open {
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
</style>
