<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { issueReportStore } from '$lib/state/issueReport.svelte';

	const canIssues = $derived(featureFlagsStore.isEnabled('issues') || authStore.isModerator);
</script>

<footer class="site-footer no-print">
	<div class="site-footer__row">
		<p>{m.common_appName()} — {m.nav_tagline()}</p>
		<p class="muted">{m.footer_sourceNote()}</p>
		<p class="muted">{m.footer_phaseNote()}</p>
		<!-- With no consent banner, this link is the site's standing disclosure — so it belongs
		     somewhere permanent and on every page, not behind a dialog. -->
		<p class="site-footer__links">
			<a href={resolve('/privacy')}>{m.footer_privacy()}</a>
			<!-- Beside the privacy link rather than in the navbar: both are standing explanations of how
			     the site treats you, wanted occasionally and never mid-task. -->
			<a href={resolve('/levels')}>{m.footer_levels()}</a>
			{#if canIssues}
				<a href={resolve('/issues')}>{m.footer_issues()}</a>
				<!-- "Reported issues" -->
				<button type="button" class="linklike" onclick={() => issueReportStore.open()}>
					{m.nav_reportIssue()}
				</button>
			{/if}
		</p>
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
	.site-footer__links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}
	.linklike {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
