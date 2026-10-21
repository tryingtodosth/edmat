/** One person the server suggests because the reader already shares a roster with them — a
 * course's staff, an event's staff, an organisation, a material project (`contests/people.py`,
 * served to every surface at `/api/people/suggestions/` since 2026-10-21). `via` is the server's
 * `'<kind>:<title>'` entries; the sentence is drawn here, in the reader's language. */
export interface SuggestedPerson {
	id: string;
	displayName: string;
	via: string[];
}
