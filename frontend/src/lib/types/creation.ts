// The creation gate (learning step F, prompts/07-creation-gate.md) — the four things an account
// FOUNDS here, and why it may not. A hand-maintained mirror of `backend/config/creation.py`
// (`CREATION_KINDS` and the three refusal words); house rule 13 says to say so in both files, and
// that module's docstring names this one.
//
// Everything else — reading, joining, enrolling, attending, booking, and everything already
// created — is untouched by this type. It describes one question asked at four `create` paths.

/** `CREATION_KINDS` in `backend/config/creation.py`, in the same order. `service` is a tutoring
 *  listing: the backend app is still `services` even though its address is `/tutoring` (`/korki`
 *  for a Polish reader) — root CLAUDE.md, "Frontend routes". */
export const CREATION_KINDS = ['course', 'event', 'service', 'organization'] as const;

export type CreationKind = (typeof CREATION_KINDS)[number];

/** The words `creation_block_reason` answers with. `null` means "go ahead" and is not a reason, so
 *  it is not in this union — a refusal is always one of these three (house rule 6). */
export type CreationBlockReason = 'anonymous' | 'minor' | 'verification_required';

/** The body of `GET /api/creation/`: every kind, each `null` or a reason. */
export type CreationStatus = Record<CreationKind, CreationBlockReason | null>;
