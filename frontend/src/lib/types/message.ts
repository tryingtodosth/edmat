// Real user-to-user messaging (backend/messaging/ — a thin DRF wrapper over django-postman's own
// Message model, see that app's own services.py doc comment for why). A visitor reaches out to a
// Service listing's own provider through this, not a bespoke "contact form" — an ordinary Message
// with the provider as `recipientId`.

export interface Message {
	id: string;
	senderId: string;
	senderUsername: string;
	senderDisplayName: string;
	recipientId: string;
	recipientUsername: string;
	recipientDisplayName: string;
	subject: string;
	body: string;
	sentAt: string;
	readAt: string | null;
	isRead: boolean;
	// null only for a brand-new, top-level message that has no reply yet — the backend promotes a
	// message into being its own thread root (thread_id = its own id) the instant the FIRST reply
	// arrives (messaging/services.py's own reply_to_message, copied verbatim from django-postman's
	// own BaseWriteForm._save thread-linking logic).
	parentId: string | null;
	threadId: string | null;
	repliesCount: number;
}

export type MessageFolder = 'inbox' | 'sent' | 'archives' | 'trash';
