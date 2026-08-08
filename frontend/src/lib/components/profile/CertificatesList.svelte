<script lang="ts">
	// Credentials a third party issued, and which this site has only the holder's word for.
	//
	// The link is the point of the row, so it renders as an underlined link rather than a button: it is
	// how a reader checks the claim, and there is nothing else here that can. An expired credential is
	// still shown, and labelled — dropping it would be rewriting somebody's history, while showing it
	// silently as current would be the misleading half of the same mistake.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import type { Certificate } from '$lib/types/profileExtras';

	let { certificates }: { certificates: Certificate[] } = $props();
</script>

{#if certificates.length === 0}
	<p class="empty">{m.profile_certificatesEmpty()}</p>
	<!-- "Nothing added yet." -->
{:else}
	<ul class="certificates">
		{#each certificates as certificate (certificate.id)}
			<li class="certificate">
				<div class="certificate__top">
					<h3>{certificate.title}</h3>
					{#if certificate.isExpired}
						<span class="badge badge--expired">{m.profile_certificateExpired()}</span>
						<!-- "Expired" -->
					{/if}
				</div>
				{#if certificate.issuer}
					<p class="certificate__issuer">{certificate.issuer}</p>
				{/if}
				<p class="certificate__meta">
					{#if certificate.issuedOn}
						<span
							>{m.profile_certificateIssued({
								date: formatDate(certificate.issuedOn, getLocale())
							})}</span
						>
						<!-- "Issued {date}" -->
					{/if}
					{#if certificate.expiresOn}
						<span
							>{m.profile_certificateExpires({
								date: formatDate(certificate.expiresOn, getLocale())
							})}</span
						>
						<!-- "Valid until {date}" -->
					{:else}
						<span>{m.profile_certificateNoExpiry()}</span>
						<!-- "No expiry" -->
					{/if}
					{#if certificate.credentialId}
						<span>{m.profile_certificateId({ id: certificate.credentialId })}</span>
						<!-- "No. {id}" -->
					{/if}
				</p>
				{#if certificate.url}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- the issuer's own verification
					     page, an external URL no app route can express. `nofollow` because it is
					     user-submitted, matching what material source links already do. -->
					<a
						class="certificate__link"
						href={certificate.url}
						target="_blank"
						rel="noopener nofollow"
					>
						{m.profile_certificateVerify()}
						<!-- "Check it with the issuer" -->
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</li>
		{/each}
	</ul>
{/if}
<p class="note">{m.profile_certificatesNote()}</p>

<!-- "Added by the account holder. EdMat does not verify these — follow the link if there is one." -->

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.certificates {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.certificate {
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 2px;
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.certificate__top {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		h3 {
			font-size: var(--font-size-base);
		}
	}
	.badge--expired {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.certificate__issuer {
		font-size: var(--font-size-sm);
	}
	.certificate__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.certificate__link {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		color: var(--accent);
		// The global reset removes anchor underlines; a plain text link needs one back or a reader has
		// no reason to think it can be followed.
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.empty,
	.note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.note {
		font-size: var(--font-size-xs);
		font-style: italic;
	}
</style>
