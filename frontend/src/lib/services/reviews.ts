import type { Review } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapReview, type RawReview } from '$lib/api/mappers';

export async function getReviewsForExercise(exerciseId: string): Promise<Review[]> {
	const raw = await apiClient.get<RawReview[]>(
		`/exercises/${encodeURIComponent(exerciseId)}/reviews/`
	);
	const reviews = raw.map(mapReview);
	reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return reviews;
}

// `userId` stays a parameter for call-site compatibility, but the backend already scopes a review
// to whoever the auth token belongs to (Review.author = request.user, exercises/views.py's own
// `reviews` action) — sending someone else's id here couldn't attribute the review to them anyway.
export async function submitReview(
	exerciseId: string,
	_userId: string,
	rating: number,
	body?: string
): Promise<Review> {
	const raw = await apiClient.post<RawReview>(
		`/exercises/${encodeURIComponent(exerciseId)}/reviews/`,
		{
			rating,
			body: body?.trim() || ''
		}
	);
	return mapReview(raw);
}
