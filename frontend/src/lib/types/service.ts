// Tutoring/services listings ("Korepetycje") — a user-created, course-scoped offer. See
// backend/services/models.py's own doc comment for the full reasoning, including why this is a
// distinct, fuller thing from `User.offersTutoring` (a bare opt-in badge with no structure) — a
// user can set just that flag, create one or more real Service listings, or both.

export type ServiceCurrency = 'PLN' | 'EUR' | 'USD';

export interface Service {
	id: string;
	providerId: string;
	providerUsername: string;
	providerDisplayName: string;
	title: string;
	description: string;
	// Real Course ids (== slugs, see taxonomy.ts's own note on Course.id), not free text — the whole
	// reason a listing is tied to the taxonomy at all is so a visitor browsing one specific course
	// can discover tutors for THAT course.
	courseIds: string[];
	hourlyRate: number | null; // display-only, this app has no real payment processing anywhere
	currency: ServiceCurrency;
	isActive: boolean;
	averageRating: number | null;
	reviewCount: number;
	createdAt: string;
	updatedAt: string;
}

/** A star rating + optional written review on a tutoring listing — the same shape `Review` already
 * has for an Exercise, just targeting a `Service` instead (`serviceId`, not `exerciseId`). Kept as
 * its own type rather than widening `Review` itself, since a review's target is always exactly one
 * or the other, never either — see `ReviewList.svelte`'s own structural `ReviewLike` prop type,
 * which both this and `Review` already satisfy without needing a shared base interface. */
export interface ServiceReview {
	id: string;
	serviceId: string;
	userId: string;
	rating: number;
	body?: string;
	createdAt: string;
}

/** "Add to watchlist to compare certain listings" — one row per (user, service) the CURRENT user
 * is watching. `service` is embedded in full (not just an id) since the watchlist/comparison view
 * renders straight from this, matching the backend's own `ServiceWatchSerializer.to_representation`
 * reasoning (services/serializers.py). */
export interface ServiceWatch {
	id: string;
	service: Service;
	createdAt: string;
}

/** What creating/editing a listing needs — `hourlyRate` stays a string here (a raw, possibly-empty
 * form-field value) rather than `number | null`, since an in-progress `<input type="number">`
 * binding is far more naturally a string the caller trims/parses once at submit time. */
export interface ServiceDraft {
	title: string;
	description: string;
	courseIds: string[];
	hourlyRate: string;
	currency: ServiceCurrency;
	isActive: boolean;
}
