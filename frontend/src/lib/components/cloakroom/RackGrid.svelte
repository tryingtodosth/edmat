<script lang="ts">
	// The rail, drawn. One button per hook, in the order the desk typed them — this is both the
	// "pick a free hook" control of the Deposit flow and the live state of the desk, because they
	// are the same picture and keeping them as two would let them disagree.
	//
	// `mode='deposit'` enables the free hooks only; `mode='manage'` enables the taken ones (tapping
	// one is how a clerk hands a coat back to somebody pointing at it, or opens the exception
	// dialog). Neither mode hides the other half: a clerk needs to see the whole rail at once.
	import { m } from '$lib/paraglide/messages.js';
	import type { CloakroomItem } from '$lib/types/cloakroom';

	let {
		racks,
		occupied,
		mode = 'deposit',
		selected = '',
		onpick
	}: {
		racks: string[];
		/** Everything physically ON the rail: `stored`, plus the `unclaimed` items a closed desk
		 * left hanging. A hook with an unclaimed coat on it is not a free hook. */
		occupied: CloakroomItem[];
		mode?: 'deposit' | 'manage';
		selected?: string;
		onpick: (rack: string, item: CloakroomItem | null) => void;
	} = $props();

	const byRack = $derived(new Map(occupied.map((item) => [item.rackLabel, item])));
</script>

<ul class="grid" data-cloakroom-grid>
	{#each racks as rack (rack)}
		{@const item = byRack.get(rack) ?? null}
		<li>
			<button
				type="button"
				class="rack"
				class:taken={item !== null}
				class:picked={selected === rack}
				disabled={mode === 'deposit' ? item !== null : item === null}
				onclick={() => onpick(rack, item)}
			>
				<span class="label">{rack}</span>
				<span class="state">
					{item
						? item.description || m.cloakroom_rackNoDescription() // "no description"
						: m.cloakroom_rackFree()}
				</span>
			</button>
		</li>
	{/each}
</ul>

<style lang="scss">
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rack {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		min-height: 58px;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
	}
	.rack:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.rack.taken {
		background: var(--status-warning-bg);
		border-color: var(--status-warning);
	}
	.rack.picked {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.label {
		font-size: var(--font-size-lg);
		font-weight: 700;
	}
	.state {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
