/**
 * The privacy policy, in full, per locale.
 *
 * **A deliberate exception to this project's "every user-facing string is a message key" rule
 * (CLAUDE.md Section 8/10), for a reason specific to legal text.** That rule exists so no string is
 * ever English-only — a purpose this file satisfies exactly, since both locales live here and a new
 * one cannot be added without adding both. What it would cost to follow literally is the thing that
 * matters most about a privacy policy: it has to be readable, and reviewable, AS A DOCUMENT. Split
 * across ~50 keys interleaved with button labels in `en.json`, neither language version can be read
 * end to end, which is exactly what a lawyer, a data protection officer, or a student exercising
 * their rights needs to do with it. `terms.ts` (the regulamin) follows the same pattern.
 *
 * The two versions are equally authoritative — the Polish one is not a translation of the English
 * one in any legal sense, and both are shown at the same URL depending on the reader's own locale.
 *
 * **This document is not legal advice and was not written by a lawyer.** It was rewritten on
 * 2026-10-14 against ANALYTICS-LAW.md §6 (the gap list) and checked against the code on that day.
 * Things it states as commitments that the code or the server does NOT yet guarantee — fix these
 * before publishing, or change the sentence (house rule 10):
 *  - the 30/90-day log retention and the 25-month statistics limit run from
 *    `deploy/cron/edmat-analytics` (rollup_analytics + enforce_log_retention) — true once that cron
 *    file is installed on webek4, not before; the same goes for the browser error reports' 30/90
 *    days ("Error reports", 2026-10-14), which `rollup_analytics` purges
 *    (backend/analytics/client_errors.py);
 *  - the ~2-hour life of sign-in attempts: `sso_purge` runs on each sign-in start AND hourly from
 *    `deploy/cron/edmat-retention` — true once that file is installed;
 *  - the 12-month view-history and mail retention, the 30-day anonymous-comment IP hash and the
 *    14-day deletion grace period: `enforce_data_retention` and `erase_due_accounts`, nightly from
 *    `deploy/cron/edmat-retention` (backend/accounts/retention.py, erasure.py) — the same caveat;
 *  - "notices about changes to the terms" by e-mail: there is no mailer for them yet (a `direct`
 *    send by a superuser is the only way today);
 *  - (resolved 2026-10-14) removing a deleted moderator's name from the decision record:
 *    `accounts/erasure.py` runs `pseudonymise_actor` as part of every erasure.
 * Decided by the owner 2026-10-14 (second answer, superseding the first): the STUDENTS provide the
 * service and are the GDPR controller; Ośrodek Komputerowy WF UW provides and oversees the servers
 * (a processor, art. 28 — a written agreement with it is still owed). Because the controller is not
 * a public authority, the basis for security, statistics and the rest is art. 6(1)(f), not the
 * 6(1)(e) "public task" ANALYTICS-LAW.md §4 recommended for a university controller.
 * The team stays anonymous for now and is reached through the issues form or OKWF (owner).
 * Still open (also LEGAL.md §10): a contact mailbox, the art. 28 agreement with the Ośrodek. The sign-in
 * providers' EU entities and their Data Privacy Framework status are from memory, unverified.
 */

export interface PolicySection {
	/** Optional so a long section can continue under the previous heading (terms.ts § 3). */
	heading?: string;
	/** Rendered as paragraphs. */
	body?: string[];
	/** Rendered as a bulleted list under the paragraphs. */
	bullets?: string[];
	/** Rendered as a two-column table. */
	table?: { columns: [string, string]; rows: [string, string][] };
}

export interface PrivacyPolicy {
	title: string;
	updated: string;
	intro: string[];
	sections: PolicySection[];
}

/** Change this whenever the policy's own substance changes, not on a typo fix. Readers who were
 * told one thing need to be able to tell that they are now being told another. */
export const POLICY_LAST_UPDATED = '2026-11-02';

// Placeholders for data the law requires (GDPR art. 13(1)(a)–(b)) that the project does not have
// yet. Visible on purpose; see the header.
// Owner's decision 2026-10-14: the team stays anonymous "at least for now", reachable through the
// site or through OKWF. The issues form is private by default (issues/models.py `is_public`).
const CONTACT_EN =
	'through the “Report issue” form at the top of every page (only the team sees your message unless you choose to publish it; leave an e-mail address if you want an answer), or by post through Ośrodek Komputerowy Wydziału Fizyki UW, ul. Pasteura 5, 02-093 Warszawa';
const CONTACT_PL =
	'przez formularz „Zgłoś błąd” u góry każdej strony (wiadomość widzi tylko zespół, chyba że sam zdecydujesz się ją opublikować; podaj adres e-mail, jeśli chcesz dostać odpowiedź) albo pocztą za pośrednictwem Ośrodka Komputerowego Wydziału Fizyki UW, ul. Pasteura 5, 02-093 Warszawa';
const IOD_EN = 'iod@adm.uw.edu.pl';
const IOD_PL = 'iod@adm.uw.edu.pl';

const EN: PrivacyPolicy = {
	title: 'Privacy policy',
	updated: `Last updated: ${POLICY_LAST_UPDATED}`,
	intro: [
		'EdMat is a study resource run within the Faculty of Physics, University of Warsaw. This page explains exactly what the service records about you, why, on what legal basis, how long it keeps it, who else receives it, and what you can ask us to do about it.',
		'We do not use a cookie banner, and that is a deliberate decision rather than an omission. EdMat shows no advertising, sells no data, and lets no third party track you. Everything stored on your own device is something a feature you use needs, and all of it is listed below. We do count how the site is used, to improve it — but only on our own server, from records it keeps anyway, without anything placed on your device and without recognising you as a returning visitor. If we ever add something that genuinely requires your consent, we will ask you for it at that moment, in the place it applies.'
	],
	sections: [
		{
			heading: 'Who is responsible for your data',
			body: [
				'EdMat is a student project, run by a group of students of the University of Warsaw. They decide what the service does with your data, and are therefore its controller within the meaning of the GDPR.',
				'The service runs on servers of Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego (the Computer Centre of the Faculty of Physics, University of Warsaw), ul. Pasteura 5, 02-093 Warszawa, which provides and oversees them and processes the data stored on them on our behalf.',
				`Contact about this policy or your data: ${CONTACT_EN}. For anything concerning the University's servers you can also write to the University of Warsaw's data protection officer (Inspektor Ochrony Danych): ${IOD_EN}.`
			]
		},
		{
			heading: 'What we process, why, and on what basis',
			body: [
				'"GDPR" below is Regulation (EU) 2016/679. Where we process data to perform the agreement with you — running your account, for instance — the basis is Article 6(1)(b). Where we do it to keep the service secure and to make it better, the basis is our legitimate interest (Article 6(1)(f)): we are a small student project that has to fight spam and abuse and wants to know which parts of it actually help people learn. We weigh that interest against yours, keep only what that purpose needs, and you can object (Article 21).'
			],
			table: {
				columns: ['Purpose — and the data it uses', 'Legal basis'],
				rows: [
					[
						'Your account and signing in — username, e-mail address, password (stored only as a hash), display name, interface language and the settings you choose',
						'Performing the agreement under the terms of use (Art. 6(1)(b))'
					],
					[
						'Publishing what you contribute — exercises, solutions, materials, translations, comments, reviews, votes, claims, posts, and the "AI-assisted" mark and votes — under your display name',
						'Performing the agreement (Art. 6(1)(b))'
					],
					[
						'Courses, events, tutoring listings and bookings, contests, organisations, flashcards, your learning record and the education profile you choose to fill in',
						'Performing the agreement (Art. 6(1)(b)); publishing a contest winner’s full name only with consent (Art. 6(1)(a))'
					],
					['Private messages between users', 'Performing the agreement (Art. 6(1)(b))'],
					[
						'E-mail: confirming your address, password reset, the notification digest you switch on, notices about changes to the terms; and keeping a copy of mail sent to our address',
						'Performing the agreement (Art. 6(1)(b)); the copy of incoming mail — our legitimate interest (Art. 6(1)(f))'
					],
					[
						'Accounts of children under 16 and their guardians — that an account is a minor’s, and who the guardian is',
						'Art. 8 GDPR, through the guardian acting for the child; performing the agreement (Art. 6(1)(b))'
					],
					[
						'Keeping the service secure and working — the request log and the record of moderation and administrative actions',
						'Our legitimate interest in keeping the service secure (Art. 6(1)(f); see Recital 49), together with the duty to secure processing (Art. 32 GDPR)'
					],
					[
						'Moderation, reports and notices of illegal content, statements of reasons and complaints',
						'Legal obligations under the Digital Services Act, Arts 16–17 and 20 (Art. 6(1)(c)), and the terms of use (Art. 6(1)(b))'
					],
					[
						'Usage statistics to improve the service, computed from the request log',
						'Our legitimate interest (Art. 6(1)(f)); statistical use compatible with the original purpose (Arts 5(1)(b) and 89(1))'
					],
					[
						'Which exercises and materials you have opened while signed in — to avoid recommending the same material twice and to weigh reports against how many people saw an exercise',
						'Performing the agreement (Art. 6(1)(b)) and our legitimate interest (Art. 6(1)(f))'
					],
					[
						'Suggesting the interface language on your first visit, from the country of your IP address',
						'Our legitimate interest (Art. 6(1)(f))'
					],
					[
						'Comments written without an account on the About and manual pages — the text, the name you type, and a one-way salted hash of your IP address used only to limit how fast one address can post',
						'Our legitimate interest (Art. 6(1)(f)); the hash also protects the service (Art. 32)'
					],
					[
						'Signing in with Google, Apple, GitHub, Facebook or Microsoft, if you choose to',
						'Performing the agreement (Art. 6(1)(b)) — you chose the method'
					]
				]
			}
		},
		{
			heading: 'What you have to give us',
			body: [
				'To create an account yourself you need a username, an e-mail address and a password; without them we cannot create the account. Registration also asks your year of birth, only to check whether you are 16 or older — the answer decides what happens next and is not stored. Everything else (a display name, a profile, an education profile, a picture) is optional.'
			]
		},
		{
			heading: 'What is stored on your device',
			body: [
				'These are all the things EdMat writes to your browser. Each one serves a feature you use; none is used to track you, none is shared with anyone, and no other website can read them. Because they are needed for the service you asked for, Polish law (Article 399(3) of the Electronic Communications Law) does not require consent for them. Most of them never leave your browser; the exceptions are the sign-in token, the language cookie, your chosen levels and content languages (sent as part of page requests, so lists can be filtered), and the one-time sign-in key.'
			],
			table: {
				columns: ['What (where)', 'Why'],
				rows: [
					[
						'edmat-auth-token (local storage)',
						'Keeps you signed in; sent to our server with each request. Removed when you log out.'
					],
					[
						'PARAGLIDE_LOCALE (cookie)',
						'The interface language, so the first paint is in the right one. Kept for 400 days.'
					],
					[
						'edmat.localeChoice, edmat.localeGuess (local storage)',
						'A language you picked yourself; and the language we suggested on your first visit (see "Language suggestion"), so we do not ask again.'
					],
					[
						'edmat-theme, edmat.textSize, edmat.highContrast (local storage)',
						'Light or dark mode, text size and high contrast.'
					],
					[
						'edmat.audienceFilter, edmat.contentLocales (local storage)',
						'The levels and the content languages you chose to see.'
					],
					[
						'edmat.editorMode, edmat.coopLayout, edmat-materials-ui-mode, edmat-open-sections (local storage)',
						'Interface preferences: which editor, which layout, which sections are open.'
					],
					['edmat.exerciseSort.sort (local storage)', 'The order you chose for exercise lists.'],
					[
						'edmat.returnTo (session storage, this tab only)',
						'The page to go back to after you sign in. Removed once used, or when the tab closes.'
					],
					[
						'edmat.sso.browserKey (session storage, this tab only)',
						'A one-time random key that ties a sign-in through Google, Apple, GitHub, Facebook or Microsoft to the tab that started it. Removed when the sign-in finishes, or when the tab closes.'
					],
					[
						'edmat-guest-set (local storage)',
						'"My Set" while you are not signed in, so it survives a reload.'
					],
					[
						'edmat-browsing-history (local storage)',
						'Exercises you recently opened, used only so the random picker does not hand you the same one twice.'
					],
					[
						'edmat-cache:… (local storage)',
						'Copies of some public lists (subjects, events, courses, listings), so pages open faster and work offline for a while. Removed when you log out.'
					],
					[
						'edmat-scan (IndexedDB)',
						'Only on an event’s door-scanner page, for volunteers: scans not yet sent and a copy of the check-in list (attendees’ names), so the door works without a connection. Scans are removed once sent; the list copy is replaced the next time the page loads it, and stays until then or until you clear the site’s data.'
					],
					[
						'Nothing stored — an error report is only sent',
						'When a page breaks, your browser sends us a short error report (see "Error reports" below). Nothing is written to your device for it, and nothing is sent under Global Privacy Control or Do Not Track.'
					]
				]
			}
		},
		{
			body: [
				'If you are signed in, some of these preferences (levels, content languages, editor, text size, contrast) are also saved in your account so they follow you to another device.'
			]
		},
		{
			heading: 'What the server records',
			body: [
				'Every website receives certain information simply by being asked for a page. EdMat keeps a record of each request to keep the service working and secure — to investigate errors and to detect abuse such as password-guessing — and, in reduced form, for the statistics below.'
			],
			bullets: [
				'Your IP address',
				'The date and time of the request',
				'Which page or endpoint was requested — with its filter, sort and location parameters, but never search terms — and whether it succeeded',
				'How long it took to serve',
				"Your browser's self-reported name and version, and the address of the page you arrived from",
				'Your account, if you were signed in at the time',
				'Whether your browser asked not to be tracked (the "Global Privacy Control" or "Do Not Track" signal)'
			]
		},
		{
			heading: 'What the server deliberately does not record',
			bullets: [
				"What you searched for. Search terms are removed before anything is written down — what you are studying is nobody else's business.",
				'Anything you send to the sign-in, registration or password endpoints, including your password.',
				'The content of your requests, and your cookies. Nor the sign-in token — with one exception we have yet to remove: the connection that delivers live notifications carries the token in its address, and the log currently keeps that address.',
				'Any identifier that would let us recognise you as a returning visitor when you are not signed in (the one stored trace is the salted IP hash on a comment you write without an account, above). We do not fingerprint devices, and there is an automated test in the codebase that fails if anyone tries to add one.'
			]
		},
		{
			heading: 'Usage statistics',
			body: [
				'To find out what to improve, a nightly job on our own server turns the request log into daily counts: requests per kind of page with their outcome (success, error, refused) and how fast they were served, how often each exercise, material or other content page was opened, which websites people came from (the site’s name only, never the full address), which browser, system and kind of device were used (in coarse classes — "Firefox", "Android", "mobile"), how many searches were made (never what was searched), how many signed-in accounts were active on a day, and how many accounts created in a given week are still active in later weeks. Accounts of under-16s are never included in those two counts, and automated traffic is counted separately. Beside these, the staff dashboard shows totals read straight from the main database — registrations, the share of confirmed e-mail addresses, contributions, how fast the moderation queues move, and how much of the curriculum the exercises cover.',
				'The counts contain no IP address, no account, no browser string and no full addresses. The browser class is worked out from each request on its own and never combined with the IP address. Visitors who are not signed in are never counted as people, only as requests. Any count of people smaller than 10 is shown as "fewer than 10". Nothing is placed on your device for this, no script reports anything from your browser, and nothing is shared with anyone. Only the site’s staff see the statistics. We keep the daily counts for up to 25 months; the request log they come from is kept as described under "How long it is kept".',
				'The basis is our legitimate interest in improving the service (Art. 6(1)(f) GDPR) — knowing which pages are used, which break and which are slow, counted only in aggregate. You can object at any time (Art. 21). The simplest way: turn on "Global Privacy Control" or "Do Not Track" in your browser — every request that carries the signal is left out of the statistics entirely (it is still logged for security, because that purpose remains). You can also object by writing to us; there is no switch for it in Settings yet.'
			]
		},
		{
			heading: 'Error reports',
			body: [
				'When the site breaks in your browser — a page fails to load or a button throws an error — your browser sends us a short technical report: the error message, where in our code it happened, which page type you were on (for example "an exercise page", not which exercise), the app version and your browser family. It contains no account, no identifier and no address of the page, and nothing is stored on your device — no cookie, no local storage, nothing. We use it only to find and fix faults, on the basis of our legitimate interest in a working service (Art. 6(1)(f) GDPR), keep individual reports for 30 days and counts for 90 days, and share them with no one. If your browser sends a Global Privacy Control or Do Not Track signal, no report is sent.',
				'Your browser family (for example "Firefox") is worked out on our server from the request itself, and the browser string is then discarded. Like every request, the one that delivers a report is entered in the request log described above; the report itself is kept apart from it, without your IP address. At most five reports are sent from one page, only when something actually goes wrong.'
			]
		},
		{
			heading: 'Language suggestion',
			body: [
				'On your first visit, your browser asks our server which language to start in. The server looks up the country of your IP address in a database stored on the server itself — no outside service is asked — and answers "Polish" unless the country is known and is not Poland, in which case it offers English once. The country is not stored anywhere; your browser keeps only the answer (edmat.localeGuess, above).'
			]
		},
		{
			heading: 'Private messages',
			body: [
				'The text of private messages is stored encrypted (AES-256-GCM) on our server. This is not end-to-end encryption: the key is held on the same server, so the people who administer it could technically read a message. We do not read messages, and there is no moderator view of them in the application; we would decrypt one only if the law required it. The subject line is not encrypted, and some messages written before encryption was switched on may still be stored unencrypted. There is no way to delete a single message yet. When you delete your account, the conversations you had stay with the other person — they are that person’s records too — and show “Deleted account” instead of your name; your own copy goes with your account.'
			]
		},
		{
			heading: 'Signing in with Google, Apple, GitHub, Facebook or Microsoft',
			body: [
				'If you choose to sign in through one of these providers (each appears only once we have set it up), the provider sends us, once, a signed sign-in token containing: an identifier for your account with them, the provider’s own identifier, for Microsoft also your organisation’s and your account’s identifiers, your e-mail address and whether the provider has verified it (Apple may give a private relay address instead of your real one), and your name (Apple only the first time). While the link exists we keep the provider, those identifiers, the e-mail address at the time of linking and whether it was verified, when you linked it and when you last signed in with it. We never store the provider’s access or refresh tokens, your picture, or your year of birth. Your name is used only to suggest a display name, which you can change before it is saved. If the provider has not verified the address, the account is created with the address unconfirmed and we send a confirmation e-mail. A sign-in in progress leaves short-lived records — the attempt (10 minutes), a one-time login code (2 minutes) and, for a new account, a sign-up ticket holding the e-mail address and name (30 minutes) — each deleted about an hour after it expires. Accounts are never joined just because e-mail addresses match. If the address already belongs to an EdMat account, we first ask you to prove that account is yours — with its password, or with a one-time link sent to its confirmed address (valid 30 minutes and usable only in the browser where you started) — and only then connect the provider and sign you in. While you decide, we keep a short-lived record of the request (the provider’s identifiers, the address and the account it matched), valid 30 minutes and deleted about an hour after it expires. After any connection we e-mail the account to say so. Accounts run by a parent or guardian are never connected this way. Disconnecting a provider deletes the link and leaves a note in our administrative record. An account that signs in only through a provider can set a password in Settings.',
				'GitHub and Facebook do not send a signed token; once, at sign-in, we ask them for your account details instead. From GitHub: your numeric account identifier, your login, your name and your e-mail addresses with which one is primary and verified — we keep only the identifier and the primary verified address, never the login or the other addresses. From Facebook: the identifier Facebook gives your account for EdMat only, your name, and your e-mail address if you allow it — always treated as unverified, so we send a confirmation e-mail. In both cases the access token is used once and thrown away.',
				'The provider (for users in the EU: Google Ireland Limited, Apple Distribution International Ltd., GitHub, Inc., Meta Platforms Ireland Limited or Microsoft Ireland Operations Limited) is a separate controller for its own part: it learns that you use EdMat, under its own privacy policy. These companies are, or belong to groups, based in the United States, so data may be transferred there under the EU–US Data Privacy Framework. You can disconnect a provider from your account, as long as the account keeps another way to sign in.',
				'To delete the data EdMat holds about you — including after signing in with Facebook or any other provider — open Settings → Your data and your account (/settings/account) and choose “Delete my account”, or write to us. Disconnecting a provider there removes its link at once; deleting the account removes everything described under “Your rights” below. Removing EdMat from the apps connected to your Facebook, Google, Apple or GitHub account stops the provider from signing you in here, but does not by itself delete your EdMat account.'
			]
		},
		{
			heading: 'E-mail',
			body: [
				'We send mail from no-reply@edmat.net: the confirmation of your address, a password reset when you ask for one, the notification digest if you switch it on (at most once an hour), and notices about changes to the terms. No marketing. Every message we send is recorded (recipient, subject, text, and whether it was delivered) so we can retry failures and answer "did you send me that?". A confirmation or reset link is never stored in that record. Mail sent to our address is copied into the service as text so that it can be answered; attachments are not kept, only their name, type and size.',
				"When somebody who runs a course invites you to it by your e-mail address, we send you one message on their behalf: their name, the course, the role you are invited to and the link. Their account must have a confirmed address, the text is fixed (they cannot add a message of their own), and we never tell them whether your address belongs to an account here. Your address is kept on the invitation for 30 days so that it can say who it went to and refuse a duplicate; after that it is removed. The basis is the course organiser's and our legitimate interest in letting people be invited to a course (Art. 6(1)(f) GDPR); if you do not answer, nothing else is sent.",
				'Our mail is handled by OVH SAS (Roubaix, France), which provides the mailbox and the mail server and processes it on our behalf, in the European Union. The record of mail we sent is deleted 12 months after the message, and the copy of incoming mail 12 months after it arrived; when you delete your account, the record of mail sent to you is deleted with it.'
			]
		},
		{
			heading: 'Children and guardians',
			body: [
				'If you are under 16, your account is made for you by a parent or guardian, and we know only that the account is a minor’s and who the guardian is — not your age or birthday. Your guardian can read your comments and posts, remove any of them, pause your account or delete it (it is switched off at once and deleted after 14 days, and your guardian can take it back until then). You cannot delete the account yourself — ask your guardian — but you can download your data in Settings → Your data and your account. A child’s account cannot send or get private messages, cannot have a public profile or a picture, cannot share a location, cannot sign in with Google, Apple or Microsoft, and its comments and posts are checked by a moderator first. We never show ads to anyone.',
				'If you are a guardian: you act for the child under Article 8 GDPR, and you can exercise every right below on the child’s behalf. A child’s data that you enter (the username and display name) comes from you.'
			]
		},
		{
			heading: 'Content you post publicly',
			body: [
				'Exercises, translations, comments, reviews, tutoring listings, events, contests and profile information are visible to other users by design, under whatever display name you chose. Please treat anything you post as public. What other people write — a comment that mentions you, a registration managed by an event organiser — can also contain data about you; you can ask us about it in the same way.'
			]
		},
		{
			heading: 'Who else receives data',
			bullets: [
				'Other users see what you publish, and the people you deal with see what that needs: an event or course organiser sees what you gave when you registered, a contest organiser sees your entry (for contest entries the organiser decides what is collected and is responsible for it; we only provide the tool), a tutor sees your booking.',
				'OVH SAS processes our e-mail on our behalf (above).',
				'OpenStreetMap: map pictures on tutoring and event pages are loaded by your browser directly from the OpenStreetMap Foundation’s servers (United Kingdom), which therefore see your IP address. When somebody searches for an address while creating a listing, our server sends only the search text to OpenStreetMap’s Nominatim service — not who is asking. The UK has an EU adequacy decision.',
				'YouTube (Google) and Vimeo: a video inside an exercise, a material or an article is shown as a box with a play button, and nothing is loaded from them until you press it. Pressing it loads their player in your browser — YouTube’s from youtube-nocookie.com, Vimeo’s with its “do not track” setting — and from then on that company sees your IP address and may store data on your device under its own privacy policy, as a separate controller. Both are US companies.',
				'Google, Apple, GitHub, Facebook or Microsoft, only if you sign in through them (above).',
				'Courts and public authorities, when the law obliges us to hand data over.'
			],
			body: [
				'EdMat sends no data to advertisers or analytics companies, and sells no data to anyone.'
			]
		},
		{
			heading: 'How long it is kept',
			table: {
				columns: ['Data', 'Retention'],
				rows: [
					[
						'Full IP address in the request log',
						'30 days, then shortened so it identifies a network rather than a household'
					],
					['The rest of the request log', '90 days, then deleted'],
					['Daily usage statistics (no personal data)', 'Up to 25 months'],
					['Browser error reports', '30 days; their daily counts 90 days'],
					[
						'Sign-in attempts, login codes and sign-up tickets for sign-in providers',
						'Between 2 and 30 minutes, deleted about an hour after expiry'
					],
					[
						'Your account, its settings, your private data and your messages',
						'Until you delete the account; then switched off at once and erased 14 days later'
					],
					[
						'Content you published (exercises, solutions, translations, materials, comments, reviews)',
						'After the account is deleted: openly licensed content stays, under “Deleted account”; “EdMat only” content stays or is hidden — your choice'
					],
					['Which exercises and materials you opened', '12 months, then deleted'],
					[
						'The e-mail record and the copy of incoming mail',
						'12 months, then deleted; mail sent to you is deleted with your account'
					],
					[
						'Record of moderation decisions and administrative actions',
						'Kept after the account is deleted, with the person’s name removed'
					],
					[
						'The IP hash of a comment written without an account',
						'30 days, then removed (the comment stays until it is removed)'
					],
					[
						'The address a course invitation was e-mailed to',
						'30 days, then removed from the invitation'
					],
					[
						'Notices of illegal content and the decisions on them',
						'Kept, because a decision can be contested and reviewed'
					]
				]
			}
		},
		{
			heading: 'Decisions made automatically',
			body: [
				'No decision that has legal or similarly significant effects on you is made solely by automated means. One moderation step is automatic, and you should know about it: an exercise — or a review, hint, solution, post or comment attached to one — is hidden automatically when at least 3 different users have reported it and the reports reach 20% of the signed-in users who opened that exercise. Its author, where there is one, is told at once, and a moderator then reviews it and restores or removes it. Contributions by under-16 accounts and comments written without an account are held for a moderator automatically because of the account type, not because of anything they say.'
			]
		},
		{
			heading: 'Your rights',
			body: [
				`Under the GDPR you can ask us for access to your data and a copy of it; to correct it; to delete it; to restrict its processing; to receive the data you gave us in a machine-readable format and have it sent to someone else (portability, for data processed under the agreement or consent); and you can object to processing based on our legitimate interest (Art. 21), including the statistics. Where something is based on your consent, you can withdraw it at any time, as easily as you gave it; this does not affect what was done before. Write to us ${CONTACT_EN}, or to the data protection officer. We answer within one month.`,
				'You can do two of these yourself, at any time, in Settings → Your data and your account. “Download my data” gives you one machine-readable file (JSON, every field described) with everything we hold about you: your profile and settings, your contributions, comments and reviews, your private messages decrypted, bookings, registrations, study sets and flashcards, notifications, your acceptance of the terms, the sign-in providers you linked (never their tokens) and the last 90 days of our request log about you. Other people appear in it only under the name the site showed you. “Delete my account” asks for your password, shows you exactly what will be deleted and what will stay, then switches the account off at once and erases it 14 days later; until then, signing in, or the link in the e-mail we send you, cancels it. If you run a course, event, contest or organisation that other people are still in, you are asked to hand it over or close it first.',
				'What deleting the account does: your profile, settings, sign-in methods, private sets, history, notifications and everything private to you are deleted. What you published under a Creative Commons licence stays, under “Deleted account” instead of your name: that licence cannot be taken back, and others may already have copies they are allowed to keep. What you published under “EdMat only” (or with no declared licence) is your choice, asked before you confirm: keep it published under “Deleted account”, or remove it — it is then hidden from everyone, while comments and links to it stay so that nobody’s discussion breaks. An item that also holds somebody else’s work (a co-author’s version or revision) and translations of other people’s exercises stay either way. Comments, reviews and posts stay under “Deleted account”. For anything that stays, you can still ask us to remove a particular item, and we will unless it has become part of someone else’s work. Records other people rely on — a moderation decision, a vote counted in a result, a jury’s score, a booking the other side had, a conversation that is also the other person’s — are kept under “Deleted account” too. The account itself becomes an empty record with a number instead of a name; that number still shows that several contributions came from the same, deleted account.',
				'You also have the right to complain to the Polish data protection authority: Prezes Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa.',
				'One limit is worth stating plainly rather than leaving you to discover it: if you have acted as a moderator, the record of the decisions you made is kept even after your account is deleted, with your name removed from it. This is because those decisions can be contested and reviewed by others, and a decision nobody can examine cannot be challenged by the person it affected.'
			]
		},
		{
			heading: 'Changes to this policy',
			body: [
				'If this policy changes in substance, the date at the top will change with it, and if the change affects what we do with data you already gave us, we will tell account holders with a confirmed e-mail address. We will not quietly broaden what we collect without saying so here first.'
			]
		}
	]
};

const PL: PrivacyPolicy = {
	title: 'Polityka prywatności',
	updated: `Ostatnia aktualizacja: ${POLICY_LAST_UPDATED}`,
	intro: [
		'EdMat to serwis edukacyjny prowadzony na Wydziale Fizyki Uniwersytetu Warszawskiego. Ta strona wyjaśnia dokładnie, co serwis o Tobie zapisuje, po co, na jakiej podstawie prawnej, jak długo to przechowuje, kto jeszcze to otrzymuje i o co możesz nas poprosić.',
		'Nie używamy baneru zgody na pliki cookie — i jest to świadoma decyzja, a nie przeoczenie. EdMat nie wyświetla reklam, nie sprzedaje danych i nie pozwala nikomu z zewnątrz Cię śledzić. Wszystko, co zapisujemy na Twoim urządzeniu, jest potrzebne funkcji, z której korzystasz, i jest wymienione poniżej. Liczymy, jak serwis jest używany, żeby go ulepszać — ale wyłącznie na własnym serwerze, z zapisów, które i tak powstają, bez umieszczania czegokolwiek na Twoim urządzeniu i bez rozpoznawania Cię jako powracającego gościa. Jeśli kiedykolwiek pojawi się coś, co naprawdę wymaga Twojej zgody, poprosimy o nią w tym momencie i w tym miejscu, którego dotyczy.'
	],
	sections: [
		{
			heading: 'Kto odpowiada za Twoje dane',
			body: [
				'EdMat jest projektem studenckim, który prowadzi grupa studentów Uniwersytetu Warszawskiego. To oni decydują, co serwis robi z Twoimi danymi, i dlatego są ich administratorem w rozumieniu RODO.',
				'Serwis działa na serwerach Ośrodka Komputerowego Wydziału Fizyki Uniwersytetu Warszawskiego, ul. Pasteura 5, 02-093 Warszawa, który je udostępnia i nadzoruje oraz przetwarza przechowywane na nich dane w naszym imieniu.',
				`Kontakt w sprawie tej polityki lub Twoich danych: ${CONTACT_PL}. W sprawach dotyczących serwerów Uniwersytetu możesz też napisać do Inspektora Ochrony Danych Uniwersytetu Warszawskiego: ${IOD_PL}.`
			]
		},
		{
			heading: 'Co przetwarzamy, po co i na jakiej podstawie',
			body: [
				'„RODO" oznacza poniżej rozporządzenie (UE) 2016/679. Tam, gdzie przetwarzamy dane, by wykonać umowę z Tobą — np. prowadzić Twoje konto — podstawą jest art. 6 ust. 1 lit. b. Tam, gdzie robimy to po to, by serwis działał bezpiecznie i był coraz lepszy, podstawą jest nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f): jesteśmy małym projektem studenckim, który musi bronić się przed spamem i nadużyciami i chce wiedzieć, które jego części naprawdę pomagają się uczyć. Ważymy ten interes z Twoimi interesami, zachowujemy tylko to, czego ten cel wymaga, a Ty możesz wnieść sprzeciw (art. 21).'
			],
			table: {
				columns: ['Cel — i dane, których dotyczy', 'Podstawa prawna'],
				rows: [
					[
						'Twoje konto i logowanie — nazwa użytkownika, adres e-mail, hasło (przechowywane wyłącznie jako skrót), nazwa wyświetlana, język interfejsu i wybrane ustawienia',
						'Wykonanie umowy zawartej na podstawie regulaminu (art. 6 ust. 1 lit. b)'
					],
					[
						'Publikowanie Twojego wkładu — zadań, rozwiązań, materiałów, tłumaczeń, komentarzy, recenzji, głosów, wskazań, wpisów oraz oznaczeń „z pomocą AI" i głosów na nie — pod Twoją nazwą wyświetlaną',
						'Wykonanie umowy (art. 6 ust. 1 lit. b)'
					],
					[
						'Kursy, wydarzenia, ogłoszenia korepetycji i rezerwacje, konkursy, organizacje, fiszki, zapis nauki oraz profil edukacyjny, jeśli go wypełnisz',
						'Wykonanie umowy (art. 6 ust. 1 lit. b); publikacja pełnego imienia i nazwiska zwycięzcy konkursu tylko za zgodą (art. 6 ust. 1 lit. a)'
					],
					['Prywatne wiadomości między użytkownikami', 'Wykonanie umowy (art. 6 ust. 1 lit. b)'],
					[
						'E-mail: potwierdzenie adresu, reset hasła, włączone przez Ciebie zestawienie powiadomień, informacje o zmianach regulaminu; oraz kopia poczty przychodzącej na nasz adres',
						'Wykonanie umowy (art. 6 ust. 1 lit. b); kopia poczty przychodzącej — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f)'
					],
					[
						'Konta dzieci poniżej 16 lat i ich opiekunów — informacja, że konto należy do osoby małoletniej, i kto jest jej opiekunem',
						'Art. 8 RODO — przez opiekuna działającego za dziecko; wykonanie umowy (art. 6 ust. 1 lit. b)'
					],
					[
						'Bezpieczeństwo i prawidłowe działanie serwisu — dziennik zapytań oraz zapis działań moderacyjnych i administracyjnych',
						'Nasz prawnie uzasadniony interes w bezpieczeństwie serwisu (art. 6 ust. 1 lit. f; zob. motyw 49) wraz z obowiązkiem zabezpieczenia przetwarzania (art. 32 RODO)'
					],
					[
						'Moderacja, zgłoszenia i powiadomienia o nielegalnych treściach, uzasadnienia decyzji i skargi',
						'Obowiązki prawne z Aktu o usługach cyfrowych, art. 16–17 i 20 (art. 6 ust. 1 lit. c), oraz regulamin (art. 6 ust. 1 lit. b)'
					],
					[
						'Statystyki korzystania z serwisu, służące jego ulepszaniu, liczone z dziennika zapytań',
						'Nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f); wykorzystanie statystyczne zgodne z pierwotnym celem (art. 5 ust. 1 lit. b i art. 89 ust. 1)'
					],
					[
						'Które zadania i materiały otworzyłeś jako zalogowany — żeby nie polecać dwa razy tego samego i żeby odnosić zgłoszenia do liczby osób, które zadanie widziały',
						'Wykonanie umowy (art. 6 ust. 1 lit. b) i nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f)'
					],
					[
						'Podpowiedź języka interfejsu przy pierwszej wizycie, na podstawie kraju adresu IP',
						'Nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f)'
					],
					[
						'Komentarze pisane bez konta na stronie „O projekcie" i w podręczniku — treść, wpisana nazwa oraz jednokierunkowy, solony skrót adresu IP, służący wyłącznie do ograniczania, jak szybko z jednego adresu można publikować',
						'Nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f); skrót służy też bezpieczeństwu serwisu (art. 32)'
					],
					[
						'Logowanie przez Google, Apple, GitHub, Facebook lub Microsoft, jeśli je wybierzesz',
						'Wykonanie umowy (art. 6 ust. 1 lit. b) — sam wybierasz ten sposób'
					]
				]
			}
		},
		{
			heading: 'Co musisz nam podać',
			body: [
				'Aby samodzielnie założyć konto, potrzebujesz nazwy użytkownika, adresu e-mail i hasła; bez nich nie możemy utworzyć konta. Formularz rejestracji pyta też o rok urodzenia, wyłącznie po to, by sprawdzić, czy masz co najmniej 16 lat — odpowiedź decyduje o dalszym kroku i nie jest zapisywana. Wszystko inne (nazwa wyświetlana, profil, profil edukacyjny, zdjęcie) jest dobrowolne.'
			]
		},
		{
			heading: 'Co jest zapisywane na Twoim urządzeniu',
			body: [
				'To wszystko, co EdMat zapisuje w Twojej przeglądarce. Każda z tych rzeczy służy funkcji, z której korzystasz; żadna nie służy do śledzenia, żadna nie jest nikomu udostępniana i żadna inna strona nie może jej odczytać. Ponieważ są one niezbędne do świadczenia usługi, o którą prosisz, polskie prawo (art. 399 ust. 3 Prawa komunikacji elektronicznej) nie wymaga na nie zgody. Większość z nich nigdy nie opuszcza Twojej przeglądarki; wyjątkami są token logowania, plik cookie z językiem, wybrane poziomy i języki treści (wysyłane jako część zapytań o strony, by można było filtrować listy) oraz jednorazowy klucz logowania.'
			],
			table: {
				columns: ['Co (gdzie)', 'Po co'],
				rows: [
					[
						'edmat-auth-token (pamięć lokalna)',
						'Utrzymuje Twoje zalogowanie; wysyłany na nasz serwer z każdym zapytaniem. Usuwany przy wylogowaniu.'
					],
					[
						'PARAGLIDE_LOCALE (plik cookie)',
						'Język interfejsu, żeby strona od razu wyświetliła się we właściwym. Przechowywany 400 dni.'
					],
					[
						'edmat.localeChoice, edmat.localeGuess (pamięć lokalna)',
						'Język wybrany przez Ciebie; oraz język zaproponowany przy pierwszej wizycie (zob. „Podpowiedź języka"), żebyśmy nie pytali ponownie.'
					],
					[
						'edmat-theme, edmat.textSize, edmat.highContrast (pamięć lokalna)',
						'Tryb jasny lub ciemny, rozmiar tekstu i wysoki kontrast.'
					],
					[
						'edmat.audienceFilter, edmat.contentLocales (pamięć lokalna)',
						'Wybrane poziomy i języki treści.'
					],
					[
						'edmat.editorMode, edmat.coopLayout, edmat-materials-ui-mode, edmat-open-sections (pamięć lokalna)',
						'Ustawienia interfejsu: który edytor, jaki układ, które sekcje są rozwinięte.'
					],
					['edmat.exerciseSort.sort (pamięć lokalna)', 'Wybrana kolejność list zadań.'],
					[
						'edmat.returnTo (pamięć sesji, tylko ta karta)',
						'Strona, na którą wrócić po zalogowaniu. Usuwana po użyciu albo po zamknięciu karty.'
					],
					[
						'edmat.sso.browserKey (pamięć sesji, tylko ta karta)',
						'Jednorazowy losowy klucz, który wiąże logowanie przez Google, Apple, GitHub, Facebook lub Microsoft z kartą, w której się zaczęło. Usuwany po zakończeniu logowania albo po zamknięciu karty.'
					],
					[
						'edmat-guest-set (pamięć lokalna)',
						'„Mój zestaw", gdy nie jesteś zalogowany, żeby przetrwał odświeżenie strony.'
					],
					[
						'edmat-browsing-history (pamięć lokalna)',
						'Ostatnio otwierane zadania — wyłącznie po to, by losowanie nie podało Ci dwa razy tego samego.'
					],
					[
						'edmat-cache:… (pamięć lokalna)',
						'Kopie niektórych publicznych list (przedmiotów, wydarzeń, kursów, ogłoszeń), żeby strony otwierały się szybciej i działały przez jakiś czas bez sieci. Usuwane przy wylogowaniu.'
					],
					[
						'edmat-scan (IndexedDB)',
						'Tylko na stronie skanera wejściówek wydarzenia, dla wolontariuszy: jeszcze niewysłane skany i kopia listy uczestników (imiona i nazwiska), żeby wejście działało bez połączenia. Skany są usuwane po wysłaniu; kopia listy jest zastępowana przy kolejnym jej pobraniu i pozostaje do tego czasu albo do wyczyszczenia danych strony.'
					],
					[
						'Nic nie jest zapisywane — raport o błędzie jest tylko wysyłany',
						'Gdy strona się zepsuje, przeglądarka wysyła nam krótki raport o błędzie (zob. „Raporty o błędach" niżej). Nic nie jest w tym celu zapisywane na Twoim urządzeniu, a przy Global Privacy Control lub Do Not Track nic nie jest wysyłane.'
					]
				]
			}
		},
		{
			body: [
				'Jeśli jesteś zalogowany, część tych ustawień (poziomy, języki treści, edytor, rozmiar tekstu, kontrast) jest zapisywana także na Twoim koncie, żeby działała na innym urządzeniu.'
			]
		},
		{
			heading: 'Co zapisuje serwer',
			body: [
				'Każdy serwis internetowy otrzymuje pewne informacje już przez samo zapytanie o stronę. EdMat zachowuje zapis każdego zapytania, aby serwis działał poprawnie i bezpiecznie — aby badać błędy i wykrywać nadużycia, takie jak próby odgadywania haseł — a w ograniczonej postaci także na potrzeby opisanych niżej statystyk.'
			],
			bullets: [
				'Twój adres IP',
				'Data i godzina zapytania',
				'Która strona lub który zasób był żądany — wraz z parametrami filtrowania, sortowania i lokalizacji, ale nigdy z wyszukiwaną frazą — i czy zapytanie się powiodło',
				'Czas obsługi zapytania',
				'Nazwa i wersja przeglądarki podana przez nią samą oraz adres strony, z której przyszedłeś',
				'Twoje konto, jeśli w tym momencie byłeś zalogowany',
				'Czy przeglądarka poprosiła o nieśledzenie (sygnał „Global Privacy Control" lub „Do Not Track")'
			]
		},
		{
			heading: 'Czego serwer świadomie nie zapisuje',
			bullets: [
				'Treści wyszukiwania. Wpisane frazy są usuwane, zanim cokolwiek zostanie zapisane — to, czego się uczysz, nie jest niczyją sprawą.',
				'Niczego, co wysyłasz do logowania, rejestracji lub zmiany hasła, w tym samego hasła.',
				'Zawartości Twoich zapytań ani Twoich plików cookie. Ani tokenu logowania — z jednym wyjątkiem, którego jeszcze nie usunęliśmy: połączenie dostarczające powiadomienia na żywo przekazuje token w adresie, a dziennik obecnie ten adres zachowuje.',
				'Żadnego identyfikatora, który pozwoliłby rozpoznać Cię jako powracającego gościa, gdy nie jesteś zalogowany (jedynym zapisywanym śladem jest solony skrót IP przy komentarzu napisanym bez konta, powyżej). Nie stosujemy odcisku palca urządzenia, a w kodzie znajduje się automatyczny test, który nie przejdzie, jeśli ktoś spróbuje taki identyfikator dodać.'
			]
		},
		{
			heading: 'Statystyki korzystania z serwisu',
			body: [
				'Żeby wiedzieć, co ulepszać, nocne zadanie na naszym własnym serwerze zamienia dziennik zapytań w dzienne liczby: zapytania według rodzaju strony wraz z ich wynikiem (sukces, błąd, odmowa) i czasem obsługi, ile razy otwarto każde zadanie, materiał lub inną stronę z treścią, z jakich stron przychodzą odwiedzający (tylko nazwa strony, nigdy pełny adres), jakiej przeglądarki, systemu i rodzaju urządzenia używano (w zgrubnych klasach — „Firefox", „Android", „telefon"), ile było wyszukiwań (nigdy czego szukano), ile zalogowanych kont było aktywnych danego dnia i ile kont założonych w danym tygodniu jest aktywnych w kolejnych tygodniach. Konta osób poniżej 16 lat nigdy nie są wliczane do tych dwóch liczb, a ruch automatyczny jest liczony osobno. Obok tego panel zespołu pokazuje sumy odczytywane wprost z głównej bazy danych — rejestracje, odsetek potwierdzonych adresów e-mail, wkład użytkowników, tempo pracy kolejek moderacji i to, jaką część programu obejmują zadania.',
				'Te liczby nie zawierają adresu IP, konta, opisu przeglądarki ani pełnych adresów. Klasa przeglądarki jest ustalana z każdego zapytania osobno i nigdy nie jest łączona z adresem IP. Niezalogowani goście nigdy nie są liczeni jako osoby, tylko jako zapytania. Każda liczba osób mniejsza niż 10 jest pokazywana jako „mniej niż 10". Nic nie jest w tym celu zapisywane na Twoim urządzeniu, żaden skrypt niczego nie wysyła z Twojej przeglądarki i nic nie jest nikomu udostępniane. Statystyki widzi wyłącznie zespół serwisu. Dzienne liczby przechowujemy do 25 miesięcy; dziennik zapytań, z którego powstają, przechowujemy tak, jak opisano w części „Jak długo to przechowujemy".',
				'Podstawą jest nasz prawnie uzasadniony interes w ulepszaniu serwisu (art. 6 ust. 1 lit. f RODO) — wiedza o tym, które strony są używane, które się psują, a które działają wolno, liczona wyłącznie zbiorczo. W każdej chwili możesz wnieść sprzeciw (art. 21). Najprościej: włącz w przeglądarce „Global Privacy Control" lub „Do Not Track" — każde zapytanie z tym sygnałem jest całkowicie pomijane w statystykach (nadal trafia do dziennika na potrzeby bezpieczeństwa, bo ten cel pozostaje). Sprzeciw możesz też wnieść, pisząc do nas; w Ustawieniach nie ma jeszcze do tego przełącznika.'
			]
		},
		{
			heading: 'Raporty o błędach',
			body: [
				'Gdy strona zepsuje się w Twojej przeglądarce — nie wczyta się albo przycisk zgłosi błąd — przeglądarka wysyła nam krótki raport techniczny: treść błędu, miejsce w naszym kodzie, w którym wystąpił, rodzaj strony (np. „strona zadania", a nie które zadanie), wersję aplikacji i rodzinę przeglądarki. Raport nie zawiera konta, identyfikatora ani adresu strony i nic nie jest zapisywane na Twoim urządzeniu — żadnego ciasteczka, żadnej pamięci lokalnej, nic. Używamy go wyłącznie do wykrywania i naprawiania usterek, na podstawie naszego prawnie uzasadnionego interesu w działającej usłudze (art. 6 ust. 1 lit. f RODO); pojedyncze raporty przechowujemy 30 dni, a liczniki 90 dni, i nikomu ich nie udostępniamy. Jeśli przeglądarka wysyła sygnał Global Privacy Control lub Do Not Track, raport nie jest wysyłany.',
				'Rodzinę przeglądarki (np. „Firefox") ustala nasz serwer na podstawie samego zapytania, a opis przeglądarki jest następnie odrzucany. Jak każde zapytanie, to, które dostarcza raport, trafia do opisanego wyżej dziennika zapytań; sam raport jest przechowywany osobno, bez Twojego adresu IP. Z jednej strony wysyłanych jest najwyżej pięć raportów i tylko wtedy, gdy coś naprawdę pójdzie nie tak.'
			]
		},
		{
			heading: 'Podpowiedź języka',
			body: [
				'Przy pierwszej wizycie Twoja przeglądarka pyta nasz serwer, w jakim języku zacząć. Serwer sprawdza kraj Twojego adresu IP w bazie przechowywanej na samym serwerze — nie pyta żadnej usługi zewnętrznej — i odpowiada „polski", chyba że kraj jest znany i nie jest to Polska; wtedy jednorazowo proponuje angielski. Kraj nie jest nigdzie zapisywany; przeglądarka zachowuje tylko odpowiedź (edmat.localeGuess, powyżej).'
			]
		},
		{
			heading: 'Prywatne wiadomości',
			body: [
				'Treść prywatnych wiadomości jest przechowywana na naszym serwerze w postaci zaszyfrowanej (AES-256-GCM). Nie jest to szyfrowanie end-to-end: klucz znajduje się na tym samym serwerze, więc osoby, które go administrują, mogłyby technicznie odczytać wiadomość. Nie czytamy wiadomości, a aplikacja nie ma widoku wiadomości dla moderatorów; odszyfrowalibyśmy wiadomość tylko wtedy, gdyby wymagało tego prawo. Temat wiadomości nie jest szyfrowany, a część wiadomości napisanych przed włączeniem szyfrowania może nadal być przechowywana bez szyfrowania. Nie da się jeszcze usunąć pojedynczej wiadomości. Gdy usuniesz konto, Twoje rozmowy zostają u drugiej osoby — to także jej zapis — z napisem „Konto usunięte” zamiast Twojego imienia; Twoja kopia znika razem z kontem.'
			]
		},
		{
			heading: 'Logowanie przez Google, Apple, GitHub, Facebook lub Microsoft',
			body: [
				'Jeśli zdecydujesz się logować przez jednego z tych dostawców (każdy pojawia się dopiero wtedy, gdy go skonfigurujemy), dostawca jednorazowo przesyła nam podpisany token logowania zawierający: identyfikator Twojego konta u niego, własny identyfikator dostawcy, w przypadku Microsoftu także identyfikatory Twojej organizacji i konta, Twój adres e-mail wraz z informacją, czy go zweryfikował (Apple może przekazać adres przekierowujący zamiast prawdziwego), oraz imię i nazwisko (Apple tylko za pierwszym razem). Dopóki powiązanie istnieje, przechowujemy dostawcę, te identyfikatory, adres e-mail z chwili powiązania i informację, czy był zweryfikowany, datę powiązania i datę ostatniego logowania. Nigdy nie przechowujemy tokenów dostępu ani odświeżania od dostawcy, Twojego zdjęcia ani roku urodzenia. Imię i nazwisko służy wyłącznie do zaproponowania nazwy wyświetlanej, którą możesz zmienić przed zapisaniem. Jeśli dostawca nie zweryfikował adresu, konto powstaje z niepotwierdzonym adresem i wysyłamy e-mail z prośbą o potwierdzenie. Trwające logowanie pozostawia krótkotrwałe zapisy — próbę (10 minut), jednorazowy kod logowania (2 minuty) i, przy nowym koncie, bilet rejestracji z adresem e-mail i imieniem (30 minut) — każdy usuwany około godziny po wygaśnięciu. Konta nigdy nie są łączone tylko dlatego, że zgadzają się adresy e-mail. Jeśli adres należy już do konta EdMat, najpierw prosimy o potwierdzenie, że to konto jest Twoje — jego hasłem albo jednorazowym linkiem wysłanym na jego potwierdzony adres (ważnym 30 minut i działającym tylko w przeglądarce, w której zaczęto logowanie) — i dopiero wtedy łączymy dostawcę i logujemy Cię. Na czas decyzji przechowujemy krótkotrwały zapis tej prośby (identyfikatory od dostawcy, adres i konto, do którego pasował), ważny 30 minut i usuwany około godziny po wygaśnięciu. Po każdym połączeniu wysyłamy o tym e-mail na adres konta. Kont prowadzonych przez rodzica lub opiekuna nigdy nie łączymy w ten sposób. Odłączenie dostawcy usuwa powiązanie i zostawia wpis w naszym rejestrze działań administracyjnych. Konto logujące się wyłącznie przez dostawcę może ustawić hasło w Ustawieniach.',
				'GitHub i Facebook nie przesyłają podpisanego tokenu; zamiast tego przy logowaniu jednorazowo pytamy je o dane Twojego konta. Od GitHuba: numeryczny identyfikator konta, login, imię i nazwisko oraz adresy e-mail wraz z informacją, który jest główny i zweryfikowany — zachowujemy tylko identyfikator i główny zweryfikowany adres, nigdy loginu ani pozostałych adresów. Od Facebooka: identyfikator, który Facebook nadaje Twojemu kontu wyłącznie na potrzeby EdMat, imię i nazwisko oraz adres e-mail, jeśli na to pozwolisz — zawsze traktowany jako niezweryfikowany, więc wysyłamy e-mail z prośbą o potwierdzenie. W obu przypadkach token dostępu jest użyty raz i odrzucony.',
				'Dostawca (dla użytkowników w UE: Google Ireland Limited, Apple Distribution International Ltd., GitHub, Inc., Meta Platforms Ireland Limited lub Microsoft Ireland Operations Limited) jest odrębnym administratorem w swoim zakresie: dowiaduje się, że korzystasz z EdMat, i przetwarza to według własnej polityki prywatności. Firmy te mają siedzibę lub należą do grup z siedzibą w Stanach Zjednoczonych, więc dane mogą być tam przekazywane na podstawie ramowego porozumienia UE–USA w sprawie ochrony danych (Data Privacy Framework). Możesz odłączyć dostawcę od konta, o ile zachowa ono inny sposób logowania.',
				'Aby usunąć dane, które EdMat o Tobie przechowuje — także po logowaniu przez Facebooka lub innego dostawcę — otwórz Ustawienia → Twoje dane i konto (/settings/account) i wybierz „Usuń moje konto” albo napisz do nas. Odłączenie tam dostawcy od razu usuwa jego powiązanie; usunięcie konta usuwa wszystko, co opisujemy niżej w części „Twoje prawa”. Usunięcie EdMat z aplikacji połączonych z Twoim kontem Facebook, Google, Apple lub GitHub sprawia, że dostawca przestaje Cię tu logować, ale samo w sobie nie usuwa Twojego konta w EdMat.'
			]
		},
		{
			heading: 'Poczta e-mail',
			body: [
				'Wysyłamy pocztę z adresu no-reply@edmat.net: potwierdzenie adresu, reset hasła na Twoją prośbę, zestawienie powiadomień, jeśli je włączysz (najwyżej raz na godzinę), oraz informacje o zmianach regulaminu. Żadnych reklam. Każda wysłana wiadomość jest zapisywana (odbiorca, temat, treść i czy została dostarczona), żebyśmy mogli ponowić nieudaną wysyłkę i odpowiedzieć na pytanie „czy to wy wysłaliście?". Link potwierdzający lub resetujący nigdy nie jest w tym zapisie przechowywany. Poczta przychodząca na nasz adres jest kopiowana do serwisu jako tekst, żeby można było na nią odpowiedzieć; załączniki nie są przechowywane, a jedynie ich nazwa, typ i rozmiar.',
				'Gdy osoba prowadząca kurs zaprosi Cię do niego na Twój adres e-mail, wysyłamy w jej imieniu jedną wiadomość: jej imię, nazwę kursu, rolę, w jakiej Cię zaprasza, i link. Jej konto musi mieć potwierdzony adres, treść jest stała (nie można dopisać własnej wiadomości) i nigdy nie mówimy jej, czy Twój adres należy do konta w serwisie. Twój adres jest przechowywany przy zaproszeniu przez 30 dni, żeby było widać, do kogo poszło, i żeby nie wysłać go drugi raz; potem jest usuwany. Podstawą jest prawnie uzasadniony interes prowadzącego kurs i nasz w umożliwieniu zapraszania do kursów (art. 6 ust. 1 lit. f RODO); jeśli nie odpowiesz, nic więcej nie wyślemy.',
				'Naszą pocztę obsługuje OVH SAS (Roubaix, Francja), które zapewnia skrzynkę i serwer pocztowy i przetwarza ją w naszym imieniu, na terenie Unii Europejskiej. Zapis wysłanej poczty usuwamy po 12 miesiącach od wysłania wiadomości, a kopię poczty przychodzącej po 12 miesiącach od jej otrzymania; gdy usuniesz konto, zapis poczty wysłanej do Ciebie znika razem z nim.'
			]
		},
		{
			heading: 'Dzieci i opiekunowie',
			body: [
				'Jeśli masz mniej niż 16 lat, Twoje konto zakłada rodzic lub opiekun, a my wiemy tylko, że konto należy do osoby małoletniej i kto jest jej opiekunem — nie znamy Twojego wieku ani daty urodzenia. Opiekun może czytać Twoje komentarze i wpisy, usuwać je, wstrzymać Twoje konto albo je usunąć (konto jest od razu wyłączane i usuwane po 14 dniach, a do tego czasu opiekun może to cofnąć). Sam nie możesz usunąć konta — poproś opiekuna — ale możesz pobrać swoje dane w Ustawieniach → Twoje dane i Twoje konto. Konto dziecka nie może wysyłać ani odbierać prywatnych wiadomości, nie może mieć publicznego profilu ani zdjęcia, nie może udostępniać lokalizacji ani logować się przez Google, Apple czy Microsoft, a jego komentarze i wpisy najpierw sprawdza moderator. Nikomu nie wyświetlamy reklam.',
				'Jeśli jesteś opiekunem: działasz za dziecko na podstawie art. 8 RODO i możesz w jego imieniu wykonywać wszystkie opisane niżej prawa. Dane dziecka, które wpisujesz (nazwę użytkownika i nazwę wyświetlaną), pochodzą od Ciebie.'
			]
		},
		{
			heading: 'Treści publikowane publicznie',
			body: [
				'Zadania, tłumaczenia, komentarze, recenzje, ogłoszenia korepetycji, wydarzenia, konkursy oraz informacje profilowe są z założenia widoczne dla innych użytkowników pod wybraną przez Ciebie nazwą. Traktuj wszystko, co publikujesz, jako jawne. To, co piszą inni — komentarz, który Cię dotyczy, zapis prowadzony przez organizatora wydarzenia — także może zawierać Twoje dane; możesz zapytać nas o nie w ten sam sposób.'
			]
		},
		{
			heading: 'Kto jeszcze otrzymuje dane',
			bullets: [
				'Inni użytkownicy widzą to, co publikujesz, a osoby, z którymi masz do czynienia, widzą to, czego to wymaga: organizator wydarzenia lub kursu widzi to, co podałeś przy zapisie, organizator konkursu widzi Twoje zgłoszenie (o tym, jakie dane zgłoszeń są zbierane, decyduje i odpowiada za nie organizator; my dostarczamy tylko narzędzie), korepetytor widzi Twoją rezerwację.',
				'OVH SAS przetwarza naszą pocztę w naszym imieniu (powyżej).',
				'OpenStreetMap: obrazy map na stronach korepetycji i wydarzeń Twoja przeglądarka pobiera bezpośrednio z serwerów OpenStreetMap Foundation (Wielka Brytania), które widzą więc Twój adres IP. Gdy ktoś wyszukuje adres przy tworzeniu ogłoszenia, nasz serwer wysyła do usługi Nominatim OpenStreetMap wyłącznie tekst wyszukiwania — nie informację, kto pyta. Wobec Wielkiej Brytanii obowiązuje decyzja UE stwierdzająca odpowiedni stopień ochrony.',
				'YouTube (Google) i Vimeo: film w zadaniu, materiale lub artykule jest pokazywany jako pole z przyciskiem odtwarzania i nic nie jest od nich pobierane, dopóki go nie naciśniesz. Naciśnięcie wczytuje w Twojej przeglądarce ich odtwarzacz — YouTube z youtube-nocookie.com, Vimeo z ustawieniem „nie śledź” — i od tej chwili ta firma widzi Twój adres IP i może zapisywać dane na Twoim urządzeniu na zasadach własnej polityki prywatności, jako odrębny administrator. Obie są firmami amerykańskimi.',
				'Google, Apple, GitHub, Facebook lub Microsoft — tylko jeśli logujesz się przez nich (powyżej).',
				'Sądy i organy publiczne, gdy prawo zobowiązuje nas do przekazania danych.'
			],
			body: [
				'EdMat nie przekazuje żadnych danych reklamodawcom ani firmom analitycznym i nikomu nie sprzedaje danych.'
			]
		},
		{
			heading: 'Jak długo to przechowujemy',
			table: {
				columns: ['Dane', 'Okres przechowywania'],
				rows: [
					[
						'Pełny adres IP w dzienniku zapytań',
						'30 dni, następnie skracany tak, by wskazywał sieć, a nie gospodarstwo domowe'
					],
					['Pozostała część dziennika zapytań', '90 dni, następnie usuwana'],
					['Dzienne statystyki korzystania (bez danych osobowych)', 'Do 25 miesięcy'],
					['Raporty o błędach z przeglądarki', '30 dni; ich dzienne liczniki 90 dni'],
					[
						'Próby logowania, kody logowania i bilety rejestracji przez dostawców logowania',
						'Od 2 do 30 minut, usuwane około godziny po wygaśnięciu'
					],
					[
						'Twoje konto, jego ustawienia, Twoje prywatne dane i wiadomości',
						'Do usunięcia konta; wtedy od razu wyłączane i kasowane 14 dni później'
					],
					[
						'Opublikowane przez Ciebie treści (zadania, rozwiązania, tłumaczenia, materiały, komentarze, recenzje)',
						'Po usunięciu konta: treści na otwartej licencji zostają, z napisem „Konto usunięte”; treści „Tylko EdMat” zostają albo są ukrywane — według Twojego wyboru'
					],
					['Informacja, które zadania i materiały otworzyłeś', '12 miesięcy, następnie usuwana'],
					[
						'Zapis wysłanej poczty i kopia poczty przychodzącej',
						'12 miesięcy, następnie usuwane; poczta wysłana do Ciebie znika razem z kontem'
					],
					[
						'Zapis decyzji moderacyjnych i działań administracyjnych',
						'Przechowywany po usunięciu konta, z usuniętym imieniem i nazwiskiem osoby'
					],
					[
						'Skrót IP komentarza napisanego bez konta',
						'30 dni, następnie usuwany (komentarz zostaje do czasu jego usunięcia)'
					],
					[
						'Adres, na który wysłano zaproszenie do kursu',
						'30 dni, następnie usuwany z zaproszenia'
					],
					[
						'Zgłoszenia nielegalnych treści i decyzje w ich sprawie',
						'Przechowywane, ponieważ decyzję można zakwestionować i poddać weryfikacji'
					]
				]
			}
		},
		{
			heading: 'Decyzje podejmowane automatycznie',
			body: [
				'Żadna decyzja wywołująca wobec Ciebie skutki prawne lub w podobny sposób istotnie na Ciebie wpływająca nie jest podejmowana wyłącznie w sposób zautomatyzowany. Jeden krok moderacji jest automatyczny i warto o nim wiedzieć: zadanie — albo powiązana z nim recenzja, wskazówka, rozwiązanie, wpis lub komentarz — jest ukrywane automatycznie, gdy zgłosiło je co najmniej 3 różnych użytkowników, a liczba zgłoszeń osiągnie 20% liczby zalogowanych użytkowników, którzy otworzyli to zadanie. Autor, jeśli jest znany, jest o tym od razu informowany, a moderator następnie je sprawdza i przywraca albo usuwa. Wpisy kont osób poniżej 16 lat oraz komentarze pisane bez konta są automatycznie wstrzymywane do sprawdzenia przez moderatora ze względu na rodzaj konta, a nie na ich treść.'
			]
		},
		{
			heading: 'Twoje prawa',
			body: [
				`Na podstawie RODO możesz żądać dostępu do swoich danych i ich kopii, ich sprostowania, usunięcia, ograniczenia przetwarzania, otrzymania danych, które nam przekazałeś, w formacie nadającym się do odczytu maszynowego i przesłania ich komuś innemu (przenoszenie — dla danych przetwarzanych na podstawie umowy lub zgody), a także wnieść sprzeciw wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie (art. 21), w tym wobec statystyk. Jeśli coś opiera się na Twojej zgodzie, możesz ją w każdej chwili wycofać, równie łatwo, jak ją wyraziłeś; nie wpływa to na to, co zrobiono wcześniej. Napisz do nas ${CONTACT_PL} albo do Inspektora Ochrony Danych. Odpowiadamy w ciągu miesiąca.`,
				'Dwie z tych rzeczy możesz zrobić sam, w każdej chwili, w Ustawieniach → Twoje dane i Twoje konto. „Pobierz moje dane” daje jeden plik w formacie do odczytu maszynowego (JSON, z opisem każdego pola) ze wszystkim, co o Tobie przechowujemy: profilem i ustawieniami, Twoim wkładem, komentarzami i recenzjami, odszyfrowanymi prywatnymi wiadomościami, rezerwacjami, zapisami, zestawami i fiszkami, powiadomieniami, akceptacją regulaminu, połączonymi dostawcami logowania (nigdy ich tokenami) i ostatnimi 90 dniami naszego dziennika zapytań dotyczącego Ciebie. Inne osoby występują w nim tylko pod nazwą, którą pokazywał Ci serwis. „Usuń moje konto” prosi o hasło, pokazuje dokładnie, co zostanie usunięte, a co zostanie, po czym od razu wyłącza konto i kasuje je 14 dni później; do tego czasu zalogowanie się albo link z wysłanego przez nas e-maila anuluje usunięcie. Jeśli prowadzisz kurs, wydarzenie, konkurs lub organizację, w których wciąż są inni, najpierw poprosimy Cię o ich przekazanie lub zamknięcie.',
				'Co robi usunięcie konta: Twój profil, ustawienia, sposoby logowania, prywatne zestawy, historia, powiadomienia i wszystko, co prywatne, zostaje usunięte. To, co opublikowałeś na licencji Creative Commons, zostaje, z napisem „Konto usunięte” zamiast Twojego imienia: tej licencji nie da się cofnąć, a inni mogą już mieć kopie, które wolno im zachować. O tym, co opublikowałeś z licencją „Tylko EdMat” (albo bez zadeklarowanej licencji), decydujesz Ty — pytamy przed potwierdzeniem: zostawić to opublikowane z napisem „Konto usunięte” czy usunąć; usunięte treści zostają ukryte przed wszystkimi, a komentarze i odnośniki do nich zostają, żeby niczyja dyskusja się nie urwała. Treść, która zawiera także pracę kogoś innego (wersję lub poprawkę współautora), oraz tłumaczenia cudzych zadań zostają w każdym przypadku. Komentarze, recenzje i wpisy zostają z napisem „Konto usunięte”. O usunięcie konkretnej treści, która zostaje, nadal możesz nas poprosić — zrobimy to, chyba że stała się częścią cudzej pracy. Zapisy, na których polegają inni — decyzja moderacyjna, głos policzony w wyniku, ocena jury, rezerwacja drugiej strony, rozmowa, która jest także drugiej osoby — również zostają z napisem „Konto usunięte”. Samo konto staje się pustym zapisem z numerem zamiast nazwy; ten numer wciąż pokazuje, że kilka treści pochodzi od tego samego, usuniętego konta.',
				'Masz również prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa.',
				'Jedno ograniczenie warto powiedzieć wprost, zamiast pozostawiać je do odkrycia: jeśli działałeś jako moderator, zapis podjętych przez Ciebie decyzji pozostaje także po usunięciu konta, z usuniętym Twoim imieniem i nazwiskiem. Decyzje te można bowiem kwestionować i poddawać weryfikacji, a decyzji, której nikt nie może zbadać, nie da się zakwestionować osobie, której dotyczyła.'
			]
		},
		{
			heading: 'Zmiany tej polityki',
			body: [
				'Jeśli polityka zmieni się co do istoty, zmieni się także data na górze strony, a jeśli zmiana dotyczy tego, co robimy z danymi już nam przekazanymi, poinformujemy o niej posiadaczy kont z potwierdzonym adresem e-mail. Nie rozszerzymy po cichu zakresu zbieranych danych bez uprzedniego opisania tego tutaj.'
			]
		}
	]
};

/** Falls back to English for any locale that has no version yet — an untranslated policy in a
 * language the reader understands is far better than no policy at all. */
export function privacyPolicyFor(locale: string): PrivacyPolicy {
	return locale === 'pl' ? PL : EN;
}
