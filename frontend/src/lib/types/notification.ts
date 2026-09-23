// A recipient-scoped activity feed — see backend/notifications/models.py's own module doc comment
// for the full reasoning (denormalized target_label/exercise rather than a resolved-on-read
// GenericForeignKey, no grouping/clustering unlike a sibling project's own NotificationGroup, since
// EdMat's real event volume per user doesn't warrant it yet).
export type NotificationType =
	| 'submissionApproved'
	| 'submissionRejected'
	| 'editSuggestionApproved'
	| 'editSuggestionRejected'
	| 'translationApproved'
	| 'translationRejected'
	// A hint/solution from the pool (exercises.SolutionEntry) accepted or declined by a reviewer.
	| 'solutionEntryApproved'
	| 'solutionEntryRejected'
	| 'commentReply'
	| 'contentAutoHidden'
	| 'contentRestored'
	| 'contentRemoved'
	// A followed tag (TagFollow) got attached to new/existing content — see the backend's own
	// notify_tag_followers. `note` carries the tag itself (`#slug`), since this is the one type
	// whose recipient is a follower rather than a participant in the underlying event.
	| 'newTaggedContent'
	// Courses run by users (classroom/). Six types rather than one, because the recipient and the
	// next action differ per event — an instructor gets the request, the applicant gets the answer.
	| 'courseEnrollmentRequested'
	| 'courseEnrollmentApproved'
	| 'courseEnrollmentDeclined'
	| 'courseRemoved'
	| 'courseNewLesson'
	| 'courseNewPost'
	// Booking a session with a tutor (booking/). Four types, split by recipient: the tutor gets the
	// request, the student gets the answer, and either can be the one told about a cancellation.
	// `bookingCancelled` covers both directions on purpose — the row already records which side did
	// it, so a second type would only duplicate that.
	| 'bookingRequested'
	| 'bookingConfirmed'
	| 'bookingDeclined'
	| 'bookingCancelled'
	// One-off events (events/). The host is told when somebody says they are coming, and the people
	// holding a seat are told when it moves, is called off, or the host posts an update. A decline is
	// not a type — see the backend's own note on why.
	| 'eventAttendance'
	| 'eventUpdated'
	| 'eventCancelled'
	// Kept apart from `eventUpdated` even though both mean "something changed". That one means the
	// time or the place moved and the reader must rearrange their evening; this one means the host
	// wrote something and the reader should go and read it. `note` carries its opening words.
	| 'eventPosted'
	| 'sessionChanged'
	| 'registrationConfirmed'
	| 'registrationWaitlisted'
	| 'registrationPromoted'
	| 'registrationDeclined'
	| 'contributionSubmitted'
	| 'contributionDecided'
	// Emitted by courses/ and moderation/ and never listed here until now, which meant
	// `mapNotification` fell back to `commentReply` and rendered every one of them as a reply to
	// a comment that does not exist.
	| 'courseContributionSubmitted'
	| 'courseContributionApproved'
	| 'courseContributionRejected'
	| 'courseStaffAdded'
	| 'courseInviteUsed'
	| 'materialSubmissionApproved'
	| 'materialSubmissionRejected'
	// A proposed discipline/branch/topic got decided on (taxonomy/). Four, because the reader's next
	// move differs: approved and rejected are finished, while merged and moved both mean "whatever
	// you filed under this is somewhere else now" and `note` says where.
	| 'taxonomyApproved'
	| 'taxonomyMerged'
	| 'taxonomyMoved'
	| 'taxonomyRejected'
	// Staff moved a site issue report the recipient filed under their name (issues/).
	| 'issueStatusChanged'
	// Somebody applied to look after content, and the answer to such an application (moderation/).
	// Both have existed backend-side since the governor-application queue landed and were missing
	// from this union, the type map, the labels and the card — so every one of them arrived, fell
	// through `mapNotification`'s `?? 'commentReply'` fallback, and rendered as a reply to a comment
	// that does not exist. The same drift the course/material block above already records.
	| 'governorApplicationSubmitted'
	| 'governorApplicationDecided'
	// Co-authoring a material (coauthoring/). Seven, split by recipient and by what the reader's
	// next move is: the team is told a proposal arrived, the proposer is told what was decided,
	// everybody is told when a version goes live, and the invite/member/join trio each has a side
	// that acts and a side that waits.
	| 'materialVersionProposed'
	| 'materialVersionDecided'
	| 'materialVersionPublished'
	| 'projectInviteUsed'
	| 'projectMemberAdded'
	| 'projectJoinRequested'
	| 'projectJoinDecided'
	// Staff decided a DSA Art. 16 legal notice the recipient filed (legal/). Deliberately unlinked
	// — a legal notice has no page of its own for anybody but staff/its own notifier, so `note`
	// (the stated reason) is the whole of what this card says, same as a rejected submission.
	| 'legalNoticeDecided'
	// Concepts (concepts/). Three, for the three moments somebody wants to hear about, split the
	// same way co-authoring's are: the reviewers are told a revision is waiting, its author is told
	// what was decided, and the people around an article are told when a new revision went live.
	// Deliberately not one `conceptRevisionChanged` carrying the outcome in `note` — "decide this"
	// and "somebody decided yours" are different jobs for different people.
	| 'conceptRevisionPending'
	| 'conceptRevisionDecided'
	| 'conceptRevisionPublished';

export interface Notification {
	id: string;
	type: NotificationType;
	actorId?: string; // absent for a system-triggered event (contentAutoHidden has no acting user)
	actorDisplayName: string;
	targetLabel: string;
	exerciseId?: string; // absent when there's nowhere real to link (e.g. a rejected submission)
	materialId?: string; // set instead of exerciseId when a newTaggedContent notification targets a Material
	courseId?: string; // set for the branch types, which have neither an exercise nor a material
	eventId?: string; // set for the event types, which have none of the three above
	postId?: string; // a reply on an activity micro-post — the post's page is where to read it
	issueId?: string; // set for issueStatusChanged — the report itself is the page to open
	/** The co-authoring project a notification is about. Carried as well as `materialId`, not
	 * instead of it: a project that has never published anything has no material to point at, and
	 * one that has should send the reader to the material rather than to its history. The card
	 * prefers `materialId` and falls back to this. */
	materialProjectId?: string;
	/** The concept a concept notification is about, as its SLUG — `/concepts/[slug]` is keyed by
	 * the slug, not by the pk, and an article or a revision has no page a stranger can open on its
	 * own. Absent leaves the card pointing at the hub rather than at a dead link. */
	conceptSlug?: string;
	note: string;
	isRead: boolean;
	createdAt: string;
}
