import { m } from '$lib/paraglide/messages.js';
import type { ProviderState } from '$lib/types/identity';

/** The name a sign-in provider is shown under. A brand name is the brand's own and is never
 * translated; the one provider that is not a brand — institutional sign-in — is words, and words
 * come from the catalogue (house rule 1). The backend's `label` for it is English ("University
 * account"), which is how the Polish register form came to say "Kontynuuj przez University account"
 * (first-visitor audit, finding 18). Keyed on the provider's `id`, the code the backend sends. */
export function providerLabel(provider: Pick<ProviderState, 'id' | 'label'>): string {
	if (provider.id === 'school') return m.wp14a_provider_school(); // "your university account"
	return provider.label;
}
