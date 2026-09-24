/**
 * Poll types — decisions step (MANAGEMENT-BRIEF.md §3.E)
 * Mirrored from backend: decisions/models.py
 */

export interface PollOption {
	id: number;
	text: string;
	order: number;
	count: number;
}

export type PollMode = 'single' | 'multiple';
export type PollStatus = 'draft' | 'open' | 'closed';
export type PollEligibility = 'staff' | 'members';

export interface Poll {
	id: number;
	question: string;
	description: string;
	mode: PollMode;
	anonymous: boolean;
	eligibility: PollEligibility;
	opens_at: string | null;
	closes_at: string | null;
	status: PollStatus;
	decision_note: string;
	closed_by_id: number | null;
	closed_at: string | null;
	created_by_id: number;
	created_at: string;
	options: PollOption[];
	content_type_id: number;
	object_id: number;
}

export interface PollResults {
	options: Array<{ id: number; text: string; count: number }>;
	ballots: Array<{ id: number; user_id: number; cast_at: string }>;
	eligible_count: number;
}
