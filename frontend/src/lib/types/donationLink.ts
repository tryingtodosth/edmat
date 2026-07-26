// "Users can set multiple donation links that [a visitor] can choose from" — payment rails
// (PayPal/PayU/BLIK/card/Apple Pay/Google Pay) and "buy me a coffee"-style tip services alike, plus
// a free-text 'other' catch-all. See backend/accounts/models.py's DonationLink for the full
// reasoning, including why this shows on a public profile regardless of that profile's own privacy
// setting (adding one is itself the opt-in to show it).
export type DonationPlatform =
	| 'paypal'
	| 'payu'
	| 'blik'
	| 'card'
	| 'applePay'
	| 'googlePay'
	| 'buyMeACoffee'
	| 'koFi'
	| 'patreon'
	| 'githubSponsors'
	| 'bankTransfer'
	| 'other';

export interface DonationLink {
	id: string;
	platform: DonationPlatform;
	label: string; // optional override — blank means "use the platform's own name"
	displayLabel: string; // server-resolved: label || the platform's own display name, never blank
	url: string;
	order: number;
}
