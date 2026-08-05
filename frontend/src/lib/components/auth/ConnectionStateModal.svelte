<script lang="ts">
	// What clicking a sign-in button actually does today: it tells you the truth about that
	// connection instead of pretending to perform it.
	//
	// Everything rendered here arrives from `GET /api/auth/providers/`, which computes it from the
	// same settings a real client would read. That is the whole reason this is a fetch rather than
	// a paragraph in this file: the day somebody registers an application and configures a client
	// id, this modal stops calling that provider a draft on its own, with no copy to remember to
	// update. A hardcoded "coming soon" would have gone stale the moment the work was done.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import type { ProviderState } from '$lib/types/identity';

	let {
		provider,
		repositoryUrl,
		onClose,
		/** Only the school provider uses this — it is the one whose state genuinely depends on
		 * WHICH institution, since USOS is a per-university deployment rather than one service. */
		extra
	}: {
		provider: ProviderState;
		repositoryUrl: string;
		onClose: () => void;
		extra?: import('svelte').Snippet;
	} = $props();

	const protocolLabel: Record<ProviderState['protocol'], string> = {
		oidc: 'OpenID Connect',
		oauth2: 'OAuth 2.0',
		saml: 'SAML 2.0'
	};
</script>

<ModalShell title={m.auth_connection_title({ provider: provider.label })} {onClose}>
	<p class="lead">
		{provider.status === 'draft'
			? m.auth_connection_draftLead({ provider: provider.label })
			: m.auth_connection_configuredLead({ provider: provider.label })}
	</p>

	{#if extra}
		{@render extra()}
	{/if}

	<section class="block">
		<h3>{m.auth_connection_whatIsReady()}</h3>
		<dl class="facts">
			<div>
				<dt>{m.auth_connection_protocol()}</dt>
				<dd>{protocolLabel[provider.protocol]}</dd>
			</div>
			{#if provider.scopes.length}
				<div>
					<dt>{m.auth_connection_scopes()}</dt>
					<dd><code>{provider.scopes.join(' ')}</code></dd>
				</div>
			{/if}
			{#if provider.authorizeUrl}
				<div>
					<dt>{m.auth_connection_endpoint()}</dt>
					<dd><code>{provider.authorizeUrl}</code></dd>
				</div>
			{/if}
			{#if provider.responseMode === 'form_post'}
				<div>
					<dt>{m.auth_connection_responseMode()}</dt>
					<dd><code>form_post</code></dd>
				</div>
			{/if}
		</dl>
		<!-- The per-provider quirk. Deliberately given as much room as the endpoints: it is the
		     thing that actually breaks a first integration, and it is not discoverable from a URL. -->
		<p class="quirk">{provider.quirk}</p>
	</section>

	{#if provider.blockers.length}
		<section class="block">
			<h3>{m.auth_connection_whatIsMissing()}</h3>
			<ul class="blockers">
				{#each provider.blockers as blocker (blocker)}
					<li>{blocker}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="block">
		<h3>{m.auth_connection_callbackChecks()}</h3>
		<p class="hint">{m.auth_connection_callbackHint()}</p>
		<ul class="checks">
			{#each provider.callbackRequirements as requirement (requirement)}
				<li>{requirement}</li>
			{/each}
		</ul>
	</section>

	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external absolute URL (the GitHub repository), supplied by the API rather than being an internal route; resolve() applies to app routes only -->
	<a class="repo" href={repositoryUrl} target="_blank" rel="noopener noreferrer">
		{m.auth_connection_repoLink()}
	</a>
</ModalShell>

<style lang="scss">
	.lead {
		font-size: var(--font-size-sm);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		h3 {
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		div {
			display: flex;
			gap: var(--space-2);
			align-items: baseline;
		}
		dt {
			min-width: 8rem;
			color: var(--text-secondary);
		}
		dd {
			word-break: break-all;
		}
	}
	code {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-size-xs);
	}
	.quirk {
		font-size: var(--font-size-sm);
		border-left: 3px solid var(--accent);
		padding-left: var(--space-3);
	}
	.hint,
	.blockers,
	.checks {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.blockers,
	.checks {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-left: var(--space-4);
		list-style: disc;
	}
	.blockers li {
		color: var(--text-primary);
	}
	.repo {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--accent);
	}
</style>
