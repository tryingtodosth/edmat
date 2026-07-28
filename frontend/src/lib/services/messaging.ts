// Real user-to-user messaging (backend/messaging/ — a thin DRF wrapper over django-postman, see
// that app's own services.py doc comment). Every function here is authenticated-only, matching the
// backend's own MessageViewSet (there's no anonymous/visitor messaging path in this app).

import type { Message, MessageFolder } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapMessage, type RawMessage } from '$lib/api/mappers';

export async function getMessages(folder: MessageFolder = 'inbox'): Promise<Message[]> {
	const raw = await apiClient.get<RawMessage[]>(`/messages/?folder=${folder}`);
	return raw.map(mapMessage);
}

/** A single message — marks it read server-side as a side effect if the caller is its own
 * recipient and it isn't already (messaging/views.py's own `retrieve`, the natural "opening a
 * message marks it read" behavior any real messaging UI has). 404 (not found, or the caller is
 * neither its sender nor recipient) resolves to `undefined`, same "swallow a 404, let the caller
 * render its own not-found state" convention `getMaterialById`/`getExerciseById` already follow. */
export async function getMessage(id: string): Promise<Message | undefined> {
	try {
		const raw = await apiClient.get<RawMessage>(`/messages/${encodeURIComponent(id)}/`);
		return mapMessage(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

/** Every message in the same conversation as `id`, oldest first — the thread view's own single
 * data source. Does NOT mark anything read on its own (only `getMessage`'s own `retrieve` does) —
 * callers that want the whole visible thread marked read call `getMessage` per still-unread row
 * themselves (see routes/messages/[id]/+page.svelte). */
export async function getThread(id: string): Promise<Message[]> {
	const raw = await apiClient.get<RawMessage[]>(`/messages/${encodeURIComponent(id)}/thread/`);
	return raw.map(mapMessage);
}

export async function sendMessage(
	recipientId: string,
	subject: string,
	body: string
): Promise<Message> {
	const raw = await apiClient.post<RawMessage>('/messages/', {
		recipient_id: Number(recipientId),
		subject,
		body
	});
	return mapMessage(raw);
}

export async function replyToMessage(
	parentId: string,
	body: string,
	subject?: string
): Promise<Message> {
	const raw = await apiClient.post<RawMessage>(`/messages/${encodeURIComponent(parentId)}/reply/`, {
		body,
		...(subject ? { subject } : {})
	});
	return mapMessage(raw);
}

export async function getUnreadMessageCount(): Promise<number> {
	const res = await apiClient.get<{ unread_count: number }>('/messages/unread-count/');
	return res.unread_count;
}
