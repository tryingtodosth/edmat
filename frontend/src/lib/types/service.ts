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
	createdAt: string;
	updatedAt: string;
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
