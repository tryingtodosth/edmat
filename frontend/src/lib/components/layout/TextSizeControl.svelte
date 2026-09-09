<script lang="ts">
	/** "Aa" — cycles the three text sizes (AUDIENCE-BRIEF.md §8). In the header for everybody,
	 * signed in or not: the people who need it most are the least likely to find it in Settings. */
	import { m } from '$lib/paraglide/messages.js';
	import { a11yPrefsStore } from '$lib/state/a11yPrefs.svelte';
	import { authStore } from '$lib/state/auth.svelte';

	const labels = {
		normal: () => m.textSize_normal(),
		large: () => m.textSize_large(),
		larger: () => m.textSize_larger()
	};
	function cycle() {
		const next = a11yPrefsStore.cycleTextSize();
		if (authStore.isAuthenticated) void authStore.updateProfile({ textSize: next });
	}
</script>

<button
	type="button"
	class="text-size"
	onclick={cycle}
	aria-label={m.textSize_control({ current: labels[a11yPrefsStore.textSize]() })}
	title={m.textSize_control({ current: labels[a11yPrefsStore.textSize]() })}
	data-size={a11yPrefsStore.textSize}
>
	<span aria-hidden="true">Aa</span>
</button>

<style lang="scss">
	.text-size {
		min-width: 44px;
		min-height: 44px;
		padding: 0 0.5rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.text-size[data-size='large'] {
		font-size: 1.15em;
	}
	.text-size[data-size='larger'] {
		font-size: 1.3em;
	}
</style>
