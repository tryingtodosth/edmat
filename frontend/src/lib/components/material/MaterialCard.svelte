<script lang="ts">
	import type { Material } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	let { material }: { material: Material } = $props();
</script>

<article class="material-card">
	<h3><MathTitle text={material.title} /></h3>
	<p>{material.description}</p>
	<div class="material-card__footer">
		<span class="muted">{m.material_by({ author: material.author })}</span>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external file URL (the Django media server), not an app route resolve() can express -->
		<a class="download" href={material.fileUrl} target="_blank" rel="noopener noreferrer" download>
			{m.material_download()}
		</a>
	</div>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.material-card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	p {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		flex: 1;
	}
	.material-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.muted {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.download {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>
