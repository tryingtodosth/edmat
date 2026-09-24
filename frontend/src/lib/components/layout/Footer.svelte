<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { issueReportStore } from '$lib/state/issueReport.svelte';

	const canIssues = $derived(featureFlagsStore.isEnabled('issues') || authStore.isModerator);
	// Conference step A (CONFERENCE-BRIEF.md §3.A): the venue DIRECTORY belongs here rather than in
	// the header nav — a reader browsing exercises has no reason to be offered a list of buildings,
	// while an organiser looking for somewhere to hold something goes looking for it. The Add… menu
	// carries the other half, for people who actually run a building.
	const canVenues = $derived(featureFlagsStore.isEnabled('venues') || authStore.isModerator);
</script>

<footer class="site-footer no-print">
	<div class="site-footer__row">
		<p>{m.common_appName()} — {m.nav_tagline()}</p>
		<p class="muted">{m.footer_sourceNote()}</p>
		<p class="muted">{m.footer_phaseNote()}</p>
		<!-- With no consent banner, this link is the site's standing disclosure — so it belongs
		     somewhere permanent and on every page, not behind a dialog. -->
		<p class="site-footer__links">
			<!-- The landing page. First in the row: "what is this?" comes before "what does it store?". -->
			<a href={resolve('/about')}>{m.footer_about()}</a>
			<!-- "About EdMat" -->
			<a href={resolve('/privacy')}>{m.footer_privacy()}</a>
			<!-- Beside the privacy link rather than in the navbar: both are standing explanations of how
			     the site treats you, wanted occasionally and never mid-task. -->
			<a href={resolve('/levels')}>{m.footer_levels()}</a>
			<!-- Never gated by `canIssues`/any FeatureFlag, deliberately — see backend/legal/models.py's
			     own doc comment: this is a standing DSA notice-and-action channel, not a product feature
			     somebody might turn off to quiet down bug reports. -->
			<a href={resolve('/legal')}>{m.footer_legal()}</a>
			{#if canVenues}
				<a href={resolve('/venues')}>{m.venues_browseTitle()}</a>
				<!-- "Venues" -->
			{/if}
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
	// Phone widths only, and for the same reason as the drawer's own bottom padding (Header.svelte):
	// an in-app browser — Facebook Messenger's, where this was reported — draws a toolbar over the
	// bottom edge of the viewport, and this row is the end of the document, so its links (privacy,
	// the DSA notice channel, reporting an issue) are the one place on the site that cannot be
	// scrolled out from under it. `env(safe-area-inset-bottom)` covers the device's own chrome and
	// is 0 everywhere else, so the fixed part is what actually does the work here.
	@media (max-width: 720px) {
		.site-footer__row {
			padding-bottom: calc(var(--space-6) + var(--space-3) + env(safe-area-inset-bottom, 0px));
		}
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
