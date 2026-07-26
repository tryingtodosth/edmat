import type { DonationLink, DonationPlatform } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapDonationLink, type RawDonationLink } from '$lib/api/mappers';

const PLATFORM_TO_RAW: Record<DonationPlatform, string> = {
	paypal: 'paypal',
	payu: 'payu',
	blik: 'blik',
	card: 'card',
	applePay: 'apple_pay',
	googlePay: 'google_pay',
	buyMeACoffee: 'buy_me_a_coffee',
	koFi: 'ko_fi',
	patreon: 'patreon',
	githubSponsors: 'github_sponsors',
	bankTransfer: 'bank_transfer',
	other: 'other'
};

/** Self-service CRUD for the CURRENT user's own donation links — reading someone ELSE's list
 * happens as part of getUserById()'s own resolved User.donationLinks, not through this module. */
export async function getMyDonationLinks(): Promise<DonationLink[]> {
	const raw = await apiClient.get<RawDonationLink[]>('/donation-links/');
	return raw.map(mapDonationLink);
}

export async function createDonationLink(input: {
	platform: DonationPlatform;
	label?: string;
	url: string;
	order?: number;
}): Promise<DonationLink> {
	const raw = await apiClient.post<RawDonationLink>('/donation-links/', {
		platform: PLATFORM_TO_RAW[input.platform],
		label: input.label ?? '',
		url: input.url,
		order: input.order ?? 0
	});
	return mapDonationLink(raw);
}

export async function updateDonationLink(
	id: string,
	patch: Partial<{ platform: DonationPlatform; label: string; url: string; order: number }>
): Promise<DonationLink> {
	const body: Record<string, unknown> = {};
	if (patch.platform !== undefined) body.platform = PLATFORM_TO_RAW[patch.platform];
	if (patch.label !== undefined) body.label = patch.label;
	if (patch.url !== undefined) body.url = patch.url;
	if (patch.order !== undefined) body.order = patch.order;
	const raw = await apiClient.patch<RawDonationLink>(
		`/donation-links/${encodeURIComponent(id)}/`,
		body
	);
	return mapDonationLink(raw);
}

export async function deleteDonationLink(id: string): Promise<void> {
	await apiClient.delete(`/donation-links/${encodeURIComponent(id)}/`);
}
