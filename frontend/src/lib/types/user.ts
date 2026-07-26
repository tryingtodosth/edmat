import type { DonationLink } from './donationLink';

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
}
