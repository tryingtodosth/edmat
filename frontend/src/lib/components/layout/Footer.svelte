<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<footer class="site-footer no-print">
	<div class="site-footer__row">
		<p>{m.common_appName()} — {m.nav_tagline()}</p>
		<p class="muted">{m.footer_sourceNote()}</p>
		<p class="muted">{m.footer_phaseNote()}</p>
	</div>
</footer>

<style lang="scss">
	.site-footer {
		border-top: 1px solid var(--border-color);
		margin-top: var(--space-6);
	}
	.site-footer__row {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.muted {
		color: var(--text-secondary);
	}
</style>
