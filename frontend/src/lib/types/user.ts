import type { DonationLink } from './donationLink';
import type { NotificationType } from './notification';

export interface User {
	id: string;
	displayName: string;
	bio?: string;
	email: string;
	avatarUrl?: string;
	joinedAt: string | null; // null only ever appears on a PublicProfile view of a privacy-gated profile
	isVerifiedContributor: boolean;
	isModerator: boolean;
	// The "node governor" feature (nodeGovernor.ts) — a moderator scoped to one Discipline/Branch rather
	// than the whole platform. Deliberately just a cheap flag here, not the actual list of governed
	// nodes — see accounts/serializers.py's ProfileSerializer.get_is_node_governor for why (this
	// response is fetched on every authenticated page load). A frontend that needs to know WHICH
	// node(s) calls listNodeGovernors() instead (lib/services/moderation.ts), already scoped to
	// "my own grants" for a non-staff user by the backend itself.
	isNodeGovernor: boolean;
	preferredLocale: string;
	// Tutoring ("Korepetycje") — a deliberately lightweight, opt-in signal, distinct from a real
	// services.Service listing (service.ts): "I'm open to being asked," shown as a badge on the
	// public profile with a short free-text note, no structured branch tie-in and no rate. Always
	// present on both the current user's own /auth/me/ shape and a stranger's /users/{id} one (see
	// accounts/serializers.py — both ProfileSerializer and PublicProfileSerializer include these
	// two unconditionally, regardless of showProfilePublicly, since opting in to tutoring is itself
	// the point of setting it).
	offersTutoring: boolean;
	tutoringNote: string;
	// Present on the CURRENT user (GET/PATCH /auth/me/) and on any OTHER user resolved via
	// GET /users/{id}/ — undefined only in a context that never asked for a full profile shape
	// (there isn't one today, every mapper call site populates these; kept optional so a future,
	// deliberately trimmed "just the byline" shape wouldn't need to fake them).
	isProfilePublic?: boolean;
	donationLinks?: DonationLink[];
	// Notification/privacy preferences — only ever meaningful (and only ever returned by the
	// backend) for the CURRENT user's own profile; a stranger's own PublicProfile response never
	// includes these at all (accounts/serializers.py's PublicProfileSerializer deliberately excludes
	// them), so they stay undefined when resolving someone else.
	showProfilePublicly?: boolean;
	/** Stored on the profile and recounted server-side on every exercise save/delete
	 * (accounts/counters.py) — NOT counted from the activity feed, which is sliced at 50. */
	exercisesPublishedCount: number;
	/** Exercises of yours that are not shown to anyone (unpublished, auto-hidden, removed). Only
	 * ever a number on your OWN profile; `null`/undefined on anybody else's. */
	exercisesPrivateCount?: number | null;
	/** How this account wants clocks and calendars drawn. Real stored settings rather than something
	 * inferred from `preferredLocale`: the interface language is not a statement about either, and
	 * Intl's own per-locale default would hand an English reader 12-hour and a Sunday-first week
	 * whether they asked for it or not. Defaults live in state/displayPrefs.svelte.ts. */
	timeFormat?: '24h' | '12h';
	weekStartsOn?: 'monday' | 'sunday';
	/** Where the "add to a course" half of the save menu sits relative to the list of sets. Two
	 * defensible answers, and which reads better depends on the screen and on how often somebody
	 * files things into courses — so it is a setting rather than one decision for everybody. */
	saveMenuLayout?: 'beside' | 'above';
	notifyOnCommentReply?: boolean;
	notifyOnModerationDecision?: boolean;
	notifyOnContentAction?: boolean;
	notifyOnCourseActivity?: boolean;
	notifyOnBooking?: boolean;
	notifyOnEvent?: boolean;
	// Finer-grained than the three notifyOn* booleans above, layered on TOP of them — a type in
	// here is suppressed even when its own coarse category is otherwise on (see
	// accounts/models.py's Profile.muted_notification_types for the full reasoning). Same
	// undefined-for-a-stranger's-profile treatment as the three fields above.
	mutedNotificationTypes?: NotificationType[];
}
