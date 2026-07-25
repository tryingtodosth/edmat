export interface User {
	id: string;
	displayName: string;
	email: string;
	avatarUrl?: string;
	joinedAt: string;
	isVerifiedContributor: boolean;
	isModerator: boolean;
	preferredLocale: string;
}
