// Shared label maps for the two closed-enum Exercise fields (difficulty, source type) — extracted
// once a THIRD component (RandomExerciseButton, after FiltersSidebar and the submit form) needed the
// exact same lists, per this codebase's own "three strikes" convention for when a duplicated pattern
// earns a shared utility.

import type { Difficulty, DonationPlatform, MaterialType, SourceType } from '$lib/types';
import { m } from '$lib/paraglide/messages.js';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_LABELS: Record<Difficulty, () => string> = {
	easy: m.difficulty_easy,
	medium: m.difficulty_medium,
	hard: m.difficulty_hard
};

export const SOURCE_TYPES: SourceType[] = ['exercises', 'midterm', 'exam', 'other'];

export const SOURCE_TYPE_LABELS: Record<SourceType, () => string> = {
	exercises: m.sourceType_exercises,
	midterm: m.sourceType_midterm,
	exam: m.sourceType_exam,
	other: m.sourceType_other
};

// Shared between the settings page's own donation-link editor and the public profile's display of
// someone else's — same list, one source, rather than two independently-drifting copies.
export const DONATION_PLATFORMS: DonationPlatform[] = [
	'paypal',
	'payu',
	'blik',
	'card',
	'applePay',
	'googlePay',
	'buyMeACoffee',
	'koFi',
	'patreon',
	'githubSponsors',
	'bankTransfer',
	'other'
];

export const DONATION_PLATFORM_LABELS: Record<DonationPlatform, () => string> = {
	paypal: m.donation_platform_paypal,
	payu: m.donation_platform_payu,
	blik: m.donation_platform_blik,
	card: m.donation_platform_card,
	applePay: m.donation_platform_applePay,
	googlePay: m.donation_platform_googlePay,
	buyMeACoffee: m.donation_platform_buyMeACoffee,
	koFi: m.donation_platform_koFi,
	patreon: m.donation_platform_patreon,
	githubSponsors: m.donation_platform_githubSponsors,
	bankTransfer: m.donation_platform_bankTransfer,
	other: m.donation_platform_other
};

// A plain emoji per platform, not a real icon-font/SVG-sprite dependency — this app has never
// pulled in an icon library (the notification bell/random-dice buttons above already use bare
// emoji too), so a donation link's own platform marker follows the same convention rather than
// introducing a new one just for this.
export const DONATION_PLATFORM_ICONS: Record<DonationPlatform, string> = {
	paypal: '💳',
	payu: '💳',
	blik: '📱',
	card: '💳',
	applePay: '🍎',
	googlePay: '🇬',
	buyMeACoffee: '☕',
	koFi: '☕',
	patreon: '🎁',
	githubSponsors: '💜',
	bankTransfer: '🏦',
	other: '🔗'
};

// Material.type was never actually rendered anywhere in the UI before "expand material types" —
// a real, worthwhile gap to close alongside the expansion itself (an expanded-but-invisible enum
// wouldn't let a visitor tell a script from a practice test at a glance). MaterialCard.svelte is
// the one real consumer today.
export const MATERIAL_TYPE_LABELS: Record<MaterialType, () => string> = {
	script: m.materialType_script,
	examCollection: m.materialType_examCollection,
	midtermCollection: m.materialType_midtermCollection,
	exerciseCollection: m.materialType_exerciseCollection,
	formulaSheet: m.materialType_formulaSheet,
	lectureSlides: m.materialType_lectureSlides,
	solutionGuide: m.materialType_solutionGuide,
	syllabus: m.materialType_syllabus,
	practiceTest: m.materialType_practiceTest,
	recording: m.materialType_recording,
	textbookExcerpt: m.materialType_textbookExcerpt,
	codeDataset: m.materialType_codeDataset,
	other: m.materialType_other
};
