export interface Review {
	id: string;
	exerciseId: string;
	userId: string;
	rating: number; // 1-5
	body?: string;
	createdAt: string;
	// How many comments hang off this review. Carried on the review itself so a conversation
	// under it is visible without opening every review in turn.
	replyCount: number;
}
