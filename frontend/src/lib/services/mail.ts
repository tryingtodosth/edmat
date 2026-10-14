// Mail for no-reply@edmat.net (backend `mail/`, 2026-10-14): the account holder's half — confirming
// an address, resetting a password, the notification digest switch — and the superuser's Mail tab
// in /moderation, which lists what was sent and what arrived.

import { apiClient } from '$lib/api/client';

// ---- the account holder ------------------------------------------------------------------------

export type MyMail = { email: string; emailConfirmed: boolean; notificationDigest: boolean };

type RawMyMail = { email: string; email_confirmed: boolean; notification_digest: boolean };

function toMyMail(raw: RawMyMail): MyMail {
	return {
		email: raw.email,
		emailConfirmed: raw.email_confirmed,
		notificationDigest: raw.notification_digest
	};
}

export async function getMyMail(): Promise<MyMail> {
	return toMyMail(await apiClient.get<RawMyMail>('/auth/me/mail/'));
}

export async function setNotificationDigest(enabled: boolean): Promise<MyMail> {
	return toMyMail(
		await apiClient.patch<RawMyMail>('/auth/me/mail/', { notification_digest: enabled })
	);
}

export async function resendConfirmation(): Promise<void> {
	await apiClient.post('/auth/confirm-email/resend/');
}

/** Throws `ApiError` with `detail` 'expired' | 'invalid' | 'changed' on a link that does not work. */
export async function confirmEmail(token: string): Promise<void> {
	await apiClient.post('/auth/confirm-email/', { token });
}

/** Always resolves the same way whether or not the address has an account — on purpose. */
export async function requestPasswordReset(email: string): Promise<void> {
	await apiClient.post('/auth/password-reset/', { email });
}

export async function confirmPasswordReset(
	uid: string,
	token: string,
	password: string
): Promise<void> {
	await apiClient.post('/auth/password-reset/confirm/', { uid, token, password });
}

// ---- the superuser's Mail tab ------------------------------------------------------------------

/** Mirrors `OutboundEmail.STATUSES` / `KINDS` in backend `mail/models.py` — a hand-kept copy. */
export type OutboundStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'console';
export type OutboundKind =
	'confirm_email' | 'password_reset' | 'notification_digest' | 'test' | 'direct';

export type MailStatus = {
	transport: string;
	fromAddress: string;
	smtpHost: string;
	imapConfigured: boolean;
	imapHost: string;
	queued: number;
	failed: number;
	lastFetchedAt: string | null;
};

export type OutboundEmail = {
	id: string;
	kind: OutboundKind;
	status: OutboundStatus;
	to: string;
	username: string | null;
	subject: string;
	body?: string;
	attempts: number;
	error: string;
	transport: string;
	createdAt: string;
	sentAt: string | null;
};

export type InboundAttachment = { filename: string; contentType: string; size: number };

export type InboundEmail = {
	id: string;
	fromAddress: string;
	to: string;
	subject: string;
	date: string | null;
	body?: string;
	bodyTruncated: boolean;
	size: number;
	attachments: InboundAttachment[];
	fetchedAt: string;
};

type RawStatus = {
	transport: string;
	from_address: string;
	smtp_host: string;
	imap_configured: boolean;
	imap_host: string;
	queued: number;
	failed: number;
	last_fetched_at: string | null;
};

type RawOutbound = {
	id: number;
	kind: OutboundKind;
	status: OutboundStatus;
	to: string;
	username: string | null;
	subject: string;
	body?: string;
	attempts: number;
	error: string;
	transport: string;
	created_at: string;
	sent_at: string | null;
};

type RawInbound = {
	id: number;
	from_address: string;
	to: string;
	subject: string;
	date: string | null;
	body?: string;
	body_truncated: boolean;
	size: number;
	attachments: { filename: string; content_type: string; size: number }[];
	fetched_at: string;
};

function toOutbound(raw: RawOutbound): OutboundEmail {
	return {
		id: String(raw.id),
		kind: raw.kind,
		status: raw.status,
		to: raw.to,
		username: raw.username,
		subject: raw.subject,
		body: raw.body,
		attempts: raw.attempts,
		error: raw.error,
		transport: raw.transport,
		createdAt: raw.created_at,
		sentAt: raw.sent_at
	};
}

function toInbound(raw: RawInbound): InboundEmail {
	return {
		id: String(raw.id),
		fromAddress: raw.from_address,
		to: raw.to,
		subject: raw.subject,
		date: raw.date,
		body: raw.body,
		bodyTruncated: raw.body_truncated,
		size: raw.size,
		attachments: (raw.attachments ?? []).map((a) => ({
			filename: a.filename,
			contentType: a.content_type,
			size: a.size
		})),
		fetchedAt: raw.fetched_at
	};
}

export async function getMailStatus(): Promise<MailStatus> {
	const raw = await apiClient.get<RawStatus>('/mail/status/');
	return {
		transport: raw.transport,
		fromAddress: raw.from_address,
		smtpHost: raw.smtp_host,
		imapConfigured: raw.imap_configured,
		imapHost: raw.imap_host,
		queued: raw.queued,
		failed: raw.failed,
		lastFetchedAt: raw.last_fetched_at
	};
}

function query(params: Record<string, string>): string {
	const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
	const text = search.toString();
	return text ? `?${text}` : '';
}

export async function listOutbound(
	filters: { q?: string; status?: string; kind?: string } = {}
): Promise<OutboundEmail[]> {
	const rows = await apiClient.get<RawOutbound[]>(
		`/mail/outbound/${query({ q: filters.q ?? '', status: filters.status ?? '', kind: filters.kind ?? '' })}`
	);
	return rows.map(toOutbound);
}

export async function getOutbound(id: string): Promise<OutboundEmail> {
	return toOutbound(await apiClient.get<RawOutbound>(`/mail/outbound/${id}/`));
}

export async function retryOutbound(id: string): Promise<OutboundEmail> {
	return toOutbound(await apiClient.post<RawOutbound>(`/mail/outbound/${id}/retry/`));
}

export async function sendTestMail(to: string): Promise<OutboundEmail> {
	return toOutbound(await apiClient.post<RawOutbound>('/mail/test/', { to }));
}

export async function listInbound(q = ''): Promise<InboundEmail[]> {
	const rows = await apiClient.get<RawInbound[]>(`/mail/inbound/${query({ q })}`);
	return rows.map(toInbound);
}

export async function getInbound(id: string): Promise<InboundEmail> {
	return toInbound(await apiClient.get<RawInbound>(`/mail/inbound/${id}/`));
}

/** Resolves to how many new messages were copied; throws `ApiError` (503, `detail` =
 *  'not_configured' | 'login_failed' | 'unreachable') when the mailbox cannot be read. */
export async function fetchInbox(): Promise<number> {
	const raw = await apiClient.post<{ fetched: number }>('/mail/inbound/fetch/');
	return raw.fetched;
}
