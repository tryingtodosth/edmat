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
	| 'newTaggedContent';

export interface Notification {
	id: string;
	type: NotificationType;
	actorId?: string; // absent for a system-triggered event (contentAutoHidden has no acting user)
	actorDisplayName: string;
	targetLabel: string;
	exerciseId?: string; // absent when there's nowhere real to link (e.g. a rejected submission)
	materialId?: string; // set instead of exerciseId when a newTaggedContent notification targets a Material
	note: string;
	isRead: boolean;
	createdAt: string;
}
