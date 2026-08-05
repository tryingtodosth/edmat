// Tutoring/services listings ("Korepetycje") — a user-created, course-scoped offer. See
// backend/services/models.py's own doc comment for the full reasoning, including why this is a
// distinct, fuller thing from `User.offersTutoring` (a bare opt-in badge with no structure) — a
// user can set just that flag, create one or more real Service listings, or both.

import type { AvailabilityMode } from './booking';

export type ServiceCurrency = 'PLN' | 'EUR' | 'USD';

/** How the tutoring actually happens. A single union rather than a pair of `isOnline`/`isInPerson`
 * booleans — two booleans make an illegal fourth state representable (neither set, a listing nobody
 * can attend) that every read site would then have to defend against.
 *
 * `hybrid` is a real third answer, not a convenience: "online, or in person if you come to Warsaw"
 * is a common offer, and it deliberately matches BOTH filters rather than neither. */
export type ServiceDeliveryMode = 'online' | 'inPerson' | 'hybrid';

/** Where an in-person or hybrid listing takes place. Absent entirely for online-only listings —
 * the backend actively clears these when a listing switches to online, so a stale pin can never
 * outlive the tutoring it described. */
export interface ServiceLocation {
	/** Human-readable address, stored rather than re-derived: reverse-geocoding on every render
	 * would hammer Nominatim for a string that never changes, which its usage policy forbids. */
	label: string;
	lat: number;
	lon: number;
}

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
	deliveryMode: ServiceDeliveryMode;
	/** Set only for `inPerson`/`hybrid` listings; `undefined` for online-only ones. */
	location?: ServiceLocation;
	/** How the availability shown on this listing is computed — see AvailabilityMode (booking.ts).
	 * On the offering rather than on the tutor because one person genuinely wants both at once: a
	 * carefully-managed exam-prep listing where every hour shown is really free, and a general
	 * "office hours, come and ask" one advertising a standing window they triage by hand. */
	availabilityMode: AvailabilityMode;
	/** What one session is, which is what turns a published window into bookable slots. */
	sessionMinutes: number;
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
	deliveryMode: ServiceDeliveryMode;
	// Only meaningful for `inPerson`/`hybrid`. Kept as three flat fields rather than a nested
	// `ServiceLocation` because the picker sets them independently — coordinates land the instant the
	// pin drops, while the label arrives later from the reverse lookup (and may never arrive at all if
	// that lookup fails, which must not lose the coordinates).
	locationLabel: string;
	locationLat: number | null;
	locationLon: number | null;
	availabilityMode: AvailabilityMode;
	// A string, not a number, for the same reason `hourlyRate` is one: an in-progress form field is
	// naturally a string the caller parses once at submit time, and `bind:value` on a
	// `type="number"` input silently hands back a real JS number instead — the exact runtime bug
	// CLAUDE.md's own ServiceForm note already records having shipped once.
	sessionMinutes: string;
}
