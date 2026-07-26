import type { DonationLink } from './donationLink';
import type { NotificationType } from './notification';

export interface User {
	id: string;
	displayName: string;
	email: string;
	avatarUrl?: string;
	joinedAt: string | null; // null only ever appears on a PublicProfile view of a privacy-gated profile
	isVerifiedContributor: boolean;
	isModerator: boolean;
	preferredLocale: string;
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
	notifyOnCommentReply?: boolean;
	notifyOnModerationDecision?: boolean;
	notifyOnContentAction?: boolean;
	// Finer-grained than the three notifyOn* booleans above, layered on TOP of them — a type in
	// here is suppressed even when its own coarse category is otherwise on (see
	// accounts/models.py's Profile.muted_notification_types for the full reasoning). Same
	// undefined-for-a-stranger's-profile treatment as the three fields above.
	mutedNotificationTypes?: NotificationType[];
}
