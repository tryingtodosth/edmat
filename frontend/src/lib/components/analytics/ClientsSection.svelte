<script lang="ts">
	/** Which browsers, systems and devices — as families only (the server never keeps a browser
	 *  string) — the share of requests that were bots, and which other sites send people here. */
	import { m } from '$lib/paraglide/messages.js';
	import { getClients } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import BarList from './BarList.svelte';
	import { formatCount, formatPercent, PRIVACY_K } from './format';
	import { browserLabel, deviceLabel, osLabel } from './labels';
	import Section from './Section.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section id="clients" title={m.analytics_clients_title()} deps={`${days}:${reloadKey}`} load={() => getClients(days)}>
	<!-- "Clients and referrers" -->
	{#snippet children(c)}
		<div class="grid2">
			<div>
				<h3>{m.analytics_clients_browsers()}</h3><!-- "Browsers" -->
				<BarList people items={c.browsers.map((x) => ({ key: x.name, label: browserLabel(x.name), value: x.count }))} />
			</div>
			<div>
				<h3>{m.analytics_clients_os()}</h3><!-- "Operating systems" -->
				<BarList people items={c.os.map((x) => ({ key: x.name, label: osLabel(x.name), value: x.count }))} />
			</div>
			<div>
				<h3>{m.analytics_clients_devices()}</h3><!-- "Devices" -->
				<BarList people items={c.devices.map((x) => ({ key: x.name, label: deviceLabel(x.name), value: x.count }))} />
			</div>
		</div>
		<h3>{m.analytics_clients_bots()}</h3><!-- "Bots" -->
		<p class="note">
			{m.analytics_clients_botsLine({
				share: c.botShare === null ? '—' : formatPercent(c.botShare),
				bots: formatCount(c.botRequests),
				humans: formatCount(c.humanRequests)
			})}<!-- "{share} of requests came from bots ({bots} bot requests, {humans} from browsers)." -->
		</p>
		<h3>{m.analytics_clients_referrers()}</h3><!-- "Referring sites" -->
		{#if c.referrers.length === 0}
			<p class="note">{m.analytics_clients_noReferrers()}</p><!-- "No outside site referred anyone in this period." -->
		{:else}
			<BarList items={c.referrers.map((r) => ({ key: r.host, label: r.host, value: r.count }))} />
		{/if}
		{#if c.referrersOther > 0}
			<p class="note">{m.analytics_clients_referrersOther({ k: PRIVACY_K, count: formatCount(c.referrersOther) })}</p><!-- "Other hosts (each seen fewer than {k} times): {count} requests." -->
		{/if}
		<p class="note">{m.analytics_clients_referrersCaveat()}</p><!-- "EdMat's pages are served as static files, so the server only sees a referrer on API requests, and those mostly come from EdMat's own pages. Outside referrers are rare here by construction." -->
	{/snippet}
</Section>
