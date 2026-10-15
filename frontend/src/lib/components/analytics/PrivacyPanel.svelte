<script lang="ts">
	/** What this dashboard deliberately does not know. Static text — the promises the collection
	 *  makes, in the words a visitor would want them in. Not a Section: it loads nothing. */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { PRIVACY_K } from './format';
</script>

<section class="panel" aria-labelledby="an-privacy">
	<h2 id="an-privacy">{m.analytics_privacy_title()}</h2>
	<!-- "What this dashboard does not know, on purpose" -->
	<ul>
		<li>{m.analytics_privacy_noCookies()}</li>
		<!-- "No cookies, no browser storage, no tracking script and no third party: nothing is installed in a visitor's browser to produce these numbers." -->
		<li>{m.analytics_privacy_noBeacon()}</li>
		<!-- "There is no beacon in the browser, by design. Page-speed measurements taken in the browser (Web Vitals) would need consent, so speed here is measured on the server only." -->
		<li>{m.analytics_privacy_noIdentifiers()}</li>
		<!-- "No IP address and no browser string reaches these numbers: they are reduced to a route, a status, a browser family and a day before they are counted." -->
		<li>{m.analytics_privacy_anonymous()}</li>
		<!-- "Anonymous visitors are not counted as people. No identifier exists to count them by, so they appear only as requests." -->
		<li>{m.analytics_privacy_search()}</li>
		<!-- "Search terms are never recorded; only that a search happened." -->
		<li>{m.analytics_privacy_small({ k: PRIVACY_K })}</li>
		<!-- "Groups of fewer than {k} people are shown as “<{k}”, never as a number." -->
		<li>{m.analytics_privacy_objection()}</li>
		<!-- "Requests from browsers that send Global Privacy Control or Do Not Track are left out of these statistics entirely. They are still written to the security log…" -->
		<li>{m.analytics_privacy_minors()}</li>
		<!-- "Accounts of minors (under 16, or created by a guardian) are not counted in active-account and retention figures." -->
		<li>{m.analytics_privacy_staff()}</li>
		<!-- "Staff accounts (moderators and administrators) and the demonstration accounts the site seeds (addresses at edmat.example, …) are not counted as people — not in active accounts, retention, registrations or the funnel. Their requests still count as traffic." -->
		<li>{m.analytics_privacy_retention()}</li>
		<!-- "Aggregates are kept for at most 25 months and then deleted." -->
	</ul>
	<p>
		<a href={resolve('/privacy')}>{m.analytics_privacy_link()}</a><!-- "Read the privacy policy" -->
	</p>
</section>

<style lang="scss">
	.panel {
		margin-top: var(--space-6);
		padding: var(--space-4);
		background: var(--bg-surface-alt);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-lg);
	}
	ul {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-5);
		display: grid;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	p {
		margin: 0;
		font-size: var(--font-size-sm);
	}
</style>
