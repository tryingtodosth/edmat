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
	| 'eventPosted';

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
	note: string;
	isRead: boolean;
	createdAt: string;
}
