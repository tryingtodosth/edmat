export interface Review {
	id: string;
	exerciseId: string;
	userId: string;
	rating: number; // 1-5
	body?: string;
	createdAt: string;
}
