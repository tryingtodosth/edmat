<script lang="ts">
	// `/about/account` — what an account is and what its owner controls: opening one and the age
	// check, a guardian's account for a child, sign-in providers, e-mail and the password, the data
	// download and deleting the account. Prose and screenshots from `lib/content/showcase/account.ts`;
	// the body is the shared `ModuleSections`.
	//
	// Accounts have no kill switch, so the page is never "off" as a whole. One section answers to
	// one: sign-in with an outside provider is `social_login` (`backend/sso/`), and says so in a line
	// when it is off. With the switch on and no provider configured the site shows no button either,
	// which the section's own prose says.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { accountShowcaseFor } from '$lib/content/showcase/account';
	import type { FeatureFlagKey } from '$lib/types';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import ModuleSections from '$lib/components/showcase/ModuleSections.svelte';

	const doc = $derived(accountShowcaseFor(getLocale()));
	const FLAGS: Record<string, FeatureFlagKey> = {
		providers: 'social_login'
	};
	// Discussion keys (`backend/community/discussions.py`), taken from the content's own sections.
	const DISCUSSION_SECTIONS = $derived(doc.sections.map((section) => section.key));
</script>

<ShowcasePage {doc} slug="account" discussionSections={DISCUSSION_SECTIONS}>
	<ModuleSections sections={doc.sections} flags={FLAGS} />
</ShowcasePage>
