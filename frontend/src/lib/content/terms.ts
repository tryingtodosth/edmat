/**
 * The terms of use (regulamin), in full, per locale.
 *
 * Lives in a content file rather than the message catalogue for the same reason `privacy.ts` does —
 * see that file's header: a legal document has to be readable and reviewable AS A DOCUMENT, end to
 * end, in each language. Both locales live here, so neither can be added without the other.
 *
 * **Both language versions are equally authoritative**, and § 22 says that where they differ the
 * reading more favourable to the user wins (KC art. 385 § 2). `privacy.ts` follows the same rule.
 *
 * **Not legal advice, not written by a lawyer, not yet reviewed by IOD UW.** Sources: ANALYTICS-LAW.md
 * §5 (the checklist this follows item by item), LEGAL.md §§2–4, 6, 9, CONTESTS-LAW.md. Every factual
 * claim about what the software does was checked against the code on 2026-10-14.
 *
 * OPEN DECISIONS THE OWNER MUST MAKE BEFORE THIS IS PUBLISHED (also listed in LEGAL.md §10):
 *  1. WHO THE SERVICE PROVIDER IS — decided by the owner 2026-10-14: Ośrodek Komputerowy WF UW.
 *     ANALYTICS-LAW.md §4.2 notes the Ośrodek has no legal personality of its own, so § 2 names it
 *     together with the University it belongs to (and privacy.ts names the University as the GDPR
 *     controller). The UW address is the one on UW's own privacy notices; confirm with IOD UW.
 *  2. THE CONTACT ADDRESS. There is no public contact mailbox; `no-reply@edmat.net` is send-only by
 *     its name. `CONTACT_EN`/`CONTACT_PL` are visible placeholders until one exists.
 *  3. THE CONTENT LICENCE (§ 9). LEGAL.md §2–3 said CC BY-SA 4.0 must not be switched on before a
 *     lawyer has read LEGAL.md §3. This text switches it on for content posted after acceptance,
 *     because the brief for this document asked for the clause. If review has not happened, § 9
 *     must be reduced to the operating licence (point 2) before publication.
 *  4. E-MAIL NOTICES (§ 5, § 19, § 20) are a promise: no mailer for terms changes or closure exists
 *     yet; today only a superuser's `direct` send could do it.
 *  5. DEADLINES (14 days for an answer, 14 days' notice of changes) are common practice, not a
 *     verified legal minimum (ANALYTICS-LAW.md §5.3).
 *
 * `TERMS_VERSION` MUST EQUAL `CURRENT_TERMS_VERSION` in `backend/legal/terms.py` — a
 * `legal.TermsAcceptance` row says which version somebody accepted, and that is only meaningful if
 * this page shows that version. `legal/tests.py: TermsVersionHistoryTests` fails if they drift.
 * Bump both when the substance changes, never for a typo.
 */

import type { PolicySection } from './privacy';

export const TERMS_VERSION = '2026-10-14';

export interface TermsOfUse {
	title: string;
	updated: string;
	intro: string[];
	sections: PolicySection[];
}

// The one datum the law requires (u.ś.u.d.e. art. 5: an electronic address) that does not exist
// yet. Shown verbatim so nobody mistakes the page for finished. See open decision 2 above.
const CONTACT_EN = '[contact e-mail address — to be filled in]';
const CONTACT_PL = '[adres e-mail do kontaktu — do uzupełnienia]';

const EN: TermsOfUse = {
	title: 'Terms of use',
	updated: `Version of ${TERMS_VERSION}, in force from ${TERMS_VERSION}`,
	intro: [
		'These terms set out the rules for using EdMat, a free database of exercises and study materials with a community and a set of tools for courses, events, tutoring and contests grown around it. They are the terms ("regulamin") the Polish Act on Providing Services by Electronic Means requires, and they also contain the information the EU Digital Services Act requires about how content is moderated.',
		'Please read them before creating an account. You can save or print this page at any time, free of charge. How we handle personal data is described separately, in the privacy policy at /privacy.'
	],
	sections: [
		{
			heading: 'The short version (for young users and guardians)',
			bullets: [
				'EdMat is free. Nobody pays to use it and EdMat never takes money from anybody.',
				'You can read exercises and materials without an account. To post, comment or join things you need an account — except comments on the About and manual pages, which anyone can write and which wait for a moderator.',
				'If you are under 16, a parent or guardian creates your account for you. Some things are switched off for younger users to keep them safe: private messages, a public profile, a profile picture, sharing a location, offering tutoring and running events. Your comments and posts are checked by a moderator before others see them.',
				'What you post here is public and other people may reuse and improve it, with your name on it. Only post things you made yourself or are allowed to share.',
				'Be kind and honest. No bullying, no hate, nothing illegal, no copying other people’s work without permission.',
				'If you see something wrong, report it. If we remove something of yours, we will tell you why and you can ask us to look again.'
			]
		},
		{
			heading: '§ 1. Definitions and scope',
			bullets: [
				'"EdMat" or "the service" — the website at edmat.net and its programming interface.',
				'"We" or "the provider" — the service provider named in § 2.',
				'"You" or "the user" — anyone who uses the service, with or without an account.',
				'"Account" — a user account created under § 5, by the user or by a guardian.',
				'"Content" — anything a user puts into the service: exercises, solutions, hints, materials, translations, comments, reviews, posts, listings, events, contests, messages, files and pictures.',
				'"Guardian" — a parent or other legal representative of a minor.'
			],
			body: [
				'These terms apply to everyone who uses EdMat. Browsing without an account is also subject to them, in particular to the rules on content and behaviour (§ 8). The service is provided free of charge.'
			]
		},
		{
			heading: '§ 2. Who provides the service and how to contact us',
			body: [
				'The service is provided by Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego (the Computer Centre of the Faculty of Physics, University of Warsaw), ul. Pasteura 5, 02-093 Warszawa — the “Provider” — a unit of Uniwersytet Warszawski, ul. Krakowskie Przedmieście 26/28, 00-927 Warszawa. EdMat is a student project, built by students of the Faculty.',
				`Contact for anything concerning these terms, a complaint, or your account: ${CONTACT_EN}. The page /legal is our single point of contact for authorities, the European Commission and users under Articles 11 and 12 of the Digital Services Act. You can write to us in Polish or English.`,
				'To report a specific piece of content as illegal, use the form at /legal/notice (§ 12). You do not need an account for that.'
			]
		},
		{
			heading: '§ 3. What EdMat offers',
			body: ['Without an account you can:'],
			bullets: [
				'browse disciplines, subjects and topics, and read exercises with their hints and solutions, study materials and concept articles;',
				'search, filter by language and level, build a temporary exercise set ("My Set") in your browser and print it;',
				'read public course, event, tutoring and contest pages, comment on the About and manual pages (held for a moderator), and send a notice about illegal content.'
			]
		},
		{
			body: ['With an account you can also, as far as each feature is switched on:'],
			bullets: [
				'submit exercises, solutions, hints and study materials, suggest edits and translations, and co-author materials with others;',
				'comment, review, vote, mark content as AI-assisted, and claim which courses an exercise or material covers;',
				'run and join courses, including school-mode courses and completion certificates;',
				'publish tutoring listings and accept or make bookings;',
				'organise and register for events, with programmes, tickets, volunteering and related tools;',
				'organise and enter contests (§ 15);',
				'use flashcards with spaced review, keep a learning record, and share an education profile if you choose to;',
				'write private messages to other adult users;',
				'take part in organisations, tasks, plans, needs, polls, goals and attachments that hang off a course, an event or a material;',
				'receive notifications on the site and, if you switch it on, an e-mail digest of them.'
			]
		},
		{
			body: [
				'Some features can be switched off by the moderators, temporarily or for good, for example while a problem is fixed. Switching a feature off does not delete what you put into it.'
			]
		},
		{
			heading: '§ 4. Technical requirements',
			bullets: [
				'A device connected to the internet with a current web browser that has JavaScript switched on (the current or previous major version of Firefox, Chrome, Edge or Safari, or a browser based on them).',
				'The browser must allow the site to store data locally (local and session storage) and to set one cookie for the interface language; without them you cannot stay signed in. The privacy policy lists everything that is stored and why.',
				'To create an account yourself: an e-mail address you can receive mail at.',
				'Maps on tutoring and event pages are loaded from OpenStreetMap’s servers; a network that blocks them shows no map.',
				'You do not need to install anything.'
			],
			body: [
				'Using any online service carries ordinary risks, such as malicious software or interception of data on an insecure network. Keep your browser up to date and do not use EdMat on a device you do not trust.'
			]
		},
		{
			heading: '§ 5. Your account',
			body: [
				'The agreement for providing the service with an account is concluded when you register and accept these terms, and it lasts for an indefinite time. Browsing without an account needs no agreement and can end at any moment by simply leaving.',
				'When you register, give a real e-mail address and do not pretend to be someone else. An account is for one person; do not share your password. Tell us at once if you think somebody else has access to your account.',
				'We send e-mail only for these purposes: confirming your address, resetting your password, the notification digest if you switch it on, and notices about changes to these terms or to your account. We send no marketing.',
				'User roles such as moderator, verified contributor or node governor are given by the moderators and cannot be claimed by yourself. Creating some things (a course, an event, a tutoring listing, an organisation, a contest) may be limited to verified contributors; the site says so where it applies.'
			]
		},
		{
			heading: '§ 6. Minors and guardians',
			body: [
				'If you are under 16, you cannot create an account yourself. Registration asks for your year of birth only to check this and does not store it. A guardian with their own account creates a child account in Settings; by doing so the guardian accepts these terms on the child’s behalf, including the licence in § 9 for what the child publishes, and is responsible for supervising how the child uses the service.',
				'A guardian can read the child’s comments and posts, remove any of them, suspend the account and delete it. A child’s account is protected by default: it cannot send or receive private messages, have a public profile or a profile picture, share a location, list tutoring or host an event, and its comments and posts are held for a moderator before anyone else sees them. A child’s account cannot sign in with Google, Apple or Microsoft.',
				'If you are 16 or 17, you may register yourself, but under Polish civil law you still have limited legal capacity. By accepting these terms you confirm that a parent or guardian knows that you use EdMat and agrees to these terms, in particular to the licence in § 9.',
				'EdMat shows no advertising to anybody, and so none based on profiling of minors.'
			]
		},
		{
			heading: '§ 7. Signing in with Google, Apple or Microsoft',
			body: [
				'Where we have switched it on, you may create an account or sign in through Google, Apple or Microsoft instead of a password. Using that sign-in is also subject to the provider’s own terms and privacy policy, which you must follow; the provider is a separate company and is responsible for its own processing. We are not responsible for whether the provider’s sign-in is available; if it is not, use your password or password reset (below).',
				'Your EdMat account is an account with us, governed by these terms, whichever way you sign in. Signing up through a provider still asks for your year of birth where we ask it, and the under-16 rule in § 6 applies in the same way.',
				'We never join a provider sign-in to an existing account just because the e-mail addresses match. If the provider’s e-mail address already belongs to an EdMat account, sign in to that account with your password first and connect the provider from Settings. You can disconnect a provider at any time, as long as the account keeps another way to sign in (a password or another provider).',
				'If you lose access to the provider account, you can still get into EdMat through password reset to your confirmed e-mail address, or by writing to us. Apple may give us a private relay address instead of your real one; mail to it reaches you only as long as you keep that relay active.'
			]
		},
		{
			heading: '§ 8. Rules for content and behaviour',
			body: [
				'You may not supply content that is unlawful, and you may not use EdMat in a way that breaks the law or these terms. In particular, do not post or send:'
			],
			bullets: [
				'content that infringes somebody else’s copyright or other rights — for example a full solution sheet, a textbook page or another person’s work copied without permission;',
				'content that is illegal under Polish or EU law, such as incitement to violence or hatred, threats, defamation, child sexual abuse material, or content promoting terrorism;',
				'harassment, bullying, insults, or content that discloses another person’s private data without their consent;',
				'deliberately false or misleading content, including impersonating another person, an institution or a contest organiser;',
				'advertising, spam, or links whose only purpose is promotion;',
				'malicious software, or files and code meant to harm the service or other users;',
				'sexual or violent content unsuitable for an educational site used by minors.'
			]
		},
		{
			body: [
				'Do not attack, overload or probe the service, get around its limits or access controls, collect other users’ data, or use automated tools to create accounts or content. Do not use EdMat to cheat in an ongoing exam or contest where the rules of that exam forbid outside help.'
			]
		},
		{
			heading: '§ 9. Your content and its licence',
			body: [
				'1. You keep the copyright in what you create. You declare that the content you publish is your own, or that you are allowed to publish it on these terms, and that publishing it does not infringe anybody’s rights. If you publish something somebody else made (for example an exercise from a course), say where it comes from in the source field; if you are not sure you may publish it, do not.',
				'2. So that we can run the service, you grant the provider a free, non-exclusive licence, unlimited in time and territory, to use your content in the service in these fields of exploitation: recording and reproducing it by any technique, including digitally; storing it in computer memory and on servers; making it available to the public so that anyone can access it at a place and time of their choosing; displaying, printing and distributing copies of it as part of the service; and translating, adapting, formatting and combining it with other content where the service needs that (for example rendering mathematics, building a study set, or attaching a translation).',
				'3. Content you publish publicly in the database — exercises, solutions, hints, materials and their versions, translations and concept articles — is published under the Creative Commons Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0). By publishing it you grant everyone that licence, in the same fields of exploitation as in point 2 and also for making and sharing derivative works. Others may reuse and improve your work, including outside EdMat, as long as they name you and share their changes under the same licence. Comments, reviews, posts, messages, listings, events and contests are not covered by point 3; only point 2 applies to them.',
				'4. Your personal rights as author (moral rights) cannot be waived under Polish law. You undertake not to exercise them against the ordinary way the service presents and edits content — for example showing your work without your full name if you chose a display name, fixing formatting or typesetting, or showing it beside other people’s improved versions. Attribution is shown under the display name you chose.',
				'5. Points 3 and 4 apply to content published after you accept this version of the terms. Content published earlier is used on the basis of point 2 only.',
				'6. If your account is deleted, content licensed under point 3 may remain published without your name, because others may already rely on the licence. You may ask us to remove it too, and we will unless it has become part of somebody else’s work in a way that cannot be separated.',
				'7. We do not check whether user content is correct, complete or original. Solutions may contain mistakes; treat them as help, not as the authoritative answer.'
			]
		},
		{
			heading: '§ 10. AI-assisted content',
			body: [
				'If you used an AI tool to write or substantially shape a statement, hint, solution, comment or review, mark it as AI-assisted when the site offers you that option. Other readers can also say how likely they think it is that a piece of content was AI-assisted, and once enough of them agree the content shows a mark. A moderator can fix the mark with a stated reason. The mark is information for readers, not a penalty, and it never removes anything on its own. You remain responsible for AI-assisted content exactly as for anything else you publish.'
			]
		},
		{
			heading: '§ 11. How content is moderated',
			body: [
				'We restrict content or accounts only for breaking the law or these terms, and we act diligently, objectively and proportionately, with regard to the rights and legitimate interests of everyone involved, including freedom of expression and of science and teaching. These are the tools we use:'
			],
			bullets: [
				'Review before publication. New exercises, materials, translations and edit suggestions wait in a queue until a moderator (a person) accepts them. That review is about fitting the site and its format, not a legal assessment of every submission.',
				'Holds for minors. Comments and posts by under-16 accounts, pictures posted to a younger audience, and anonymous comments on standing pages are held until a moderator lets them through.',
				'Reports. Any signed-in user can report content. A moderator decides: leave it, restore it, or remove it.',
				'Automatic hiding — the one automated step. An exercise — or a review, hint, solution, post or comment attached to one — is hidden automatically, without a person deciding, when at least 3 different users have reported it and the reports reach 20% of the signed-in users who have opened that exercise. A moderator then reviews it and either restores it or removes it; the author, where there is one, is told at once that it was hidden.',
				'Automatic refusals of a form: a contest whose stage descriptions or judging criteria use words describing a draw or lottery is refused until they are reworded (§ 15), files are checked and re-encoded, and pictures and text are cleaned of code. These are checks of form, not of opinions.',
				'Scoped moderators (node governors), appointed by the moderators, can moderate only within one discipline, subject or study material.',
				'Moderators can hide or remove content, close a contest or event page from public view, take away a role, and suspend or end an account (§ 14, § 19).'
			]
		},
		{
			heading: '§ 12. Notices of illegal content',
			body: [
				'Anyone, with or without an account, can tell us that a specific piece of content is illegal using the form at /legal/notice. A notice should give the exact address of the content, explain why you consider it illegal, give a contact e-mail address, and confirm that you believe it in good faith. Each notice is reviewed by a person. We tell you what we decided and why, and if we act on it, the author of the content is told too.'
			]
		},
		{
			heading: '§ 13. Reasons for decisions and how to contest them',
			body: [
				'Whenever we remove, hide or limit your content, or suspend or end your account, we tell you, with a statement of reasons: what we did and how far it reaches, the facts we relied on, whether an automated step was involved, which law or which provision of these terms it is based on, and how you can contest it. Exceptions are only those the law allows, for example when we have no way to reach you.',
				`You can contest such a decision, and the decision on a notice you sent, free of charge, within 6 months of being told about it, by writing to ${CONTACT_EN} or by replying in the thread of the notice. Say which decision you contest and why. Your complaint is decided by a person — where possible not the one who made the original decision — never by an automated step alone, and you receive a reasoned answer without undue delay, at the latest within 14 days. If the complaint shows the decision was wrong, we reverse it.`,
				'You may also take the dispute to an out-of-court dispute settlement body certified under Article 21 of the Digital Services Act (the European Commission publishes the list); we will engage with it in good faith. From 6 November 2026 you can also complain to the President of the Office of Electronic Communications (Prezes UKE), Poland’s Digital Services Coordinator. None of this limits your right to go to court.'
			]
		},
		{
			heading: '§ 14. Misuse',
			body: [
				'After a prior warning, we suspend for a reasonable period the account of a user who frequently provides manifestly illegal content. In the same way we suspend the handling of notices and complaints from a person who frequently sends manifestly unfounded ones. We decide case by case, considering how many such items or notices there were in absolute terms and in proportion to everything the person posted or sent in the past year, how serious they were and what consequences they had, and, where it can be seen, what the person intended. The suspension comes with a statement of reasons under § 13 and can be contested in the same way.'
			]
		},
		{
			heading: '§ 15. Contests',
			body: [
				'A contest on EdMat is organised solely by the user or institution named as its organiser on the contest page. The organiser alone makes the public promise of any prize (Articles 919–921 of the Polish Civil Code), alone decides who may enter and how entries are judged, alone is responsible for entrants’ personal data as its controller, and alone carries any tax duties connected with prizes.',
				'EdMat only provides the technical means. It is not a party to the promise, does not fund or hold prizes, takes no entry fees, does not check that a prize exists or will be given, and is not liable for a prize. A dispute about a prize or a result is between the entrant and the organiser. A contest may not contain any element of chance (a draw or lottery), and may not require any payment to enter.',
				'By publishing a contest the organiser declares that its rules are lawful and that it holds every right and consent it relies on, including a guardian’s consent for each entrant under 16 and consent to publish a winner’s full name. We may remove a contest that breaks the law or these terms, under § 11 and § 13. A contest removed by us is hidden, not cancelled; cancelling a contest is the organiser’s own act.'
			]
		},
		{
			heading: '§ 16. Tutoring, bookings, events, courses and messages',
			body: [
				'EdMat lets users find each other; it is not a party to what they agree. A tutoring arrangement, a booking, an event or a course is an arrangement between the users concerned. EdMat processes no payments and takes no money for any of them; if users agree on a fee, they settle it between themselves and are responsible for their own obligations, including taxes.',
				'An organiser who collects information from participants (for example registration answers or accessibility needs) may use it only to run that event or course and must handle it lawfully. Listings and events must describe truthfully what is offered.',
				'Private messages are for communication between adult users. They are encrypted on our server, and we do not read them, except where the law requires it. Do not use them for spam or harassment; you can tell us about such a message at the contact address in § 2.'
			]
		},
		{
			heading: '§ 17. Responsibility',
			body: [
				'We try to keep EdMat available and working, but it is a free service run by a university unit, and it may be unavailable at times — for example for maintenance, updates or because of a failure. We will announce planned longer breaks on the site when we can.',
				'We host content that users provide. We are not responsible for that content as long as we do not know that it is illegal and, once we learn of it, act on it promptly. We are not responsible for the correctness of exercises and solutions written by users, or for arrangements between users (§ 15, § 16).',
				'You are responsible for the content you publish and for how you use the service. Nothing in these terms excludes or limits any liability that cannot be excluded or limited under the law, in particular liability for damage caused intentionally, or any right you have as a consumer.'
			]
		},
		{
			heading: '§ 18. Complaints about the service',
			body: [
				`If the service does not work as these terms describe, you can complain by writing to ${CONTACT_EN}. Please describe the problem, say when it happened, and give a way to answer you (the e-mail address you write from is enough). We answer within 14 days of receiving the complaint, by e-mail or the way you asked. Complaints about a moderation decision follow § 13.`
			]
		},
		{
			heading: '§ 19. Ending the agreement',
			body: [
				`You can end the agreement at any time, without giving a reason and free of charge, by asking us to delete your account at ${CONTACT_EN}. Until a delete button exists in Settings, deletion is done by a person, and we confirm it when it is done. A guardian can delete a child’s account directly in Settings. What happens to your content is set out in § 9 point 6 and in the privacy policy.`,
				'We can end the agreement only for a serious reason: a serious or repeated breach of these terms or of the law, in particular after a warning has had no effect; using the account to attack the service or other users; or a court or authority order. We give 14 days’ notice, except where the breach is so serious, or the safety of others or of the service so much at risk, that the account must be suspended at once. Either way you receive a statement of reasons and can contest it (§ 13).',
				'If we decide to close the service altogether, we will announce it at least 30 days in advance on the site and by e-mail to confirmed addresses.'
			]
		},
		{
			heading: '§ 20. Changes to these terms',
			body: [
				'We may change these terms only for an important reason: a change in the law or in an authority’s decision that affects the service; a new feature, or a feature changed or withdrawn; a security need; or the need to describe the service more clearly or correct a mistake.',
				'We announce a change at least 14 days before it takes effect, on the site and by e-mail to every account with a confirmed address, together with the new text and a summary of what changed. If you do not accept the change, you can end the agreement free of charge before it takes effect (§ 19). Changes required at once by law or by an authority may take effect sooner, and we will say so. Every earlier version is kept, and we will send it to you on request.'
			]
		},
		{
			heading: '§ 21. Personal data',
			body: [
				'How we handle personal data, on which legal basis, for how long, and what your rights are is described in the privacy policy at /privacy. The privacy policy is information, not part of the agreement you accept.'
			]
		},
		{
			heading: '§ 22. Law, disputes and final provisions',
			body: [
				'These terms are governed by Polish law. If you are a consumer living in another country, you keep the protection that the mandatory law of that country gives you.',
				'A dispute is decided by the court competent under the general rules of law; nothing here takes away your right to sue in the court the law gives you. If you are a consumer you may also use out-of-court ways of settling a dispute, for example a municipal or district consumer ombudsman (rzecznik konsumentów) or mediation by the Trade Inspection (Inspekcja Handlowa). The EU online dispute resolution (ODR) platform no longer operates.',
				'These terms are available in Polish and English, and both versions are equally binding. If they differ, the reading more favourable to the user applies.',
				`These terms are in force from ${TERMS_VERSION}.`
			]
		}
	]
};

const PL: TermsOfUse = {
	title: 'Regulamin',
	updated: `Wersja z ${TERMS_VERSION}, obowiązuje od ${TERMS_VERSION}`,
	intro: [
		'Ten regulamin określa zasady korzystania z EdMat — bezpłatnej bazy zadań i materiałów do nauki, wokół której wyrosła społeczność oraz narzędzia do kursów, wydarzeń, korepetycji i konkursów. Jest to regulamin, którego wymaga ustawa o świadczeniu usług drogą elektroniczną, i zawiera także informacje o moderowaniu treści wymagane przez unijny Akt o usługach cyfrowych (DSA).',
		'Przeczytaj go przed założeniem konta. W każdej chwili możesz bezpłatnie zapisać lub wydrukować tę stronę. Sposób przetwarzania danych osobowych opisuje osobno polityka prywatności pod adresem /privacy.'
	],
	sections: [
		{
			heading: 'W skrócie (dla młodszych użytkowników i opiekunów)',
			bullets: [
				'EdMat jest bezpłatny. Nikt nie płaci za korzystanie z niego, a EdMat nigdy od nikogo nie pobiera pieniędzy.',
				'Zadania i materiały możesz czytać bez konta. Żeby coś opublikować, skomentować albo do czegoś dołączyć, potrzebujesz konta — poza komentarzami na stronie „O projekcie" i w podręczniku, które może napisać każdy i które czekają na moderatora.',
				'Jeśli masz mniej niż 16 lat, konto zakłada dla Ciebie rodzic lub opiekun. Dla bezpieczeństwa niektóre funkcje są wtedy wyłączone: prywatne wiadomości, publiczny profil, zdjęcie profilowe, udostępnianie lokalizacji, oferowanie korepetycji i organizowanie wydarzeń. Twoje komentarze i wpisy sprawdza moderator, zanim zobaczą je inni.',
				'To, co tu publikujesz, jest jawne, a inni mogą to wykorzystywać i ulepszać — z Twoim podpisem. Publikuj tylko to, co zrobiłeś sam albo co wolno Ci udostępnić.',
				'Bądź życzliwy i uczciwy. Żadnego nękania, nienawiści, niczego nielegalnego, żadnego kopiowania cudzej pracy bez zgody.',
				'Jeśli widzisz coś złego, zgłoś to. Jeśli usuniemy coś Twojego, powiemy Ci dlaczego, a Ty możesz poprosić, żebyśmy przyjrzeli się temu jeszcze raz.'
			]
		},
		{
			heading: '§ 1. Definicje i zakres',
			bullets: [
				'„EdMat" lub „serwis" — strona internetowa pod adresem edmat.net wraz z jej interfejsem programistycznym.',
				'„My" lub „usługodawca" — usługodawca wskazany w § 2.',
				'„Ty" lub „użytkownik" — każdy, kto korzysta z serwisu, z kontem lub bez niego.',
				'„Konto" — konto użytkownika założone zgodnie z § 5 przez użytkownika albo przez opiekuna.',
				'„Treść" — wszystko, co użytkownik umieszcza w serwisie: zadania, rozwiązania, wskazówki, materiały, tłumaczenia, komentarze, recenzje, wpisy, ogłoszenia, wydarzenia, konkursy, wiadomości, pliki i obrazy.',
				'„Opiekun" — rodzic lub inny przedstawiciel ustawowy osoby małoletniej.'
			],
			body: [
				'Regulamin dotyczy każdego, kto korzysta z EdMat. Przeglądanie bez konta również mu podlega, w szczególności zasadom dotyczącym treści i zachowania (§ 8). Usługi są świadczone nieodpłatnie.'
			]
		},
		{
			heading: '§ 2. Kto świadczy usługę i jak się z nami skontaktować',
			body: [
				'Usługodawcą jest Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego, ul. Pasteura 5, 02-093 Warszawa — jednostka Uniwersytetu Warszawskiego, ul. Krakowskie Przedmieście 26/28, 00-927 Warszawa. EdMat jest projektem studenckim, tworzonym przez studentów Wydziału.',
				`Kontakt we wszystkich sprawach dotyczących regulaminu, reklamacji lub Twojego konta: ${CONTACT_PL}. Strona /legal jest naszym jedynym punktem kontaktowym dla organów, Komisji Europejskiej i użytkowników w rozumieniu art. 11 i 12 Aktu o usługach cyfrowych. Możesz pisać do nas po polsku lub po angielsku.`,
				'Aby zgłosić konkretną treść jako nielegalną, skorzystaj z formularza pod adresem /legal/notice (§ 12). Nie potrzebujesz do tego konta.'
			]
		},
		{
			heading: '§ 3. Co oferuje EdMat',
			body: ['Bez konta możesz:'],
			bullets: [
				'przeglądać kierunki, przedmioty i działy oraz czytać zadania ze wskazówkami i rozwiązaniami, materiały do nauki i artykuły o pojęciach;',
				'wyszukiwać, filtrować według języka i poziomu, budować w przeglądarce tymczasowy zestaw zadań („Mój zestaw") i go drukować;',
				'czytać publiczne strony kursów, wydarzeń, korepetycji i konkursów, komentować stronę „O projekcie" i podręcznik (komentarze czekają na moderatora) oraz wysłać zgłoszenie nielegalnej treści.'
			]
		},
		{
			body: ['Z kontem możesz ponadto, o ile dana funkcja jest włączona:'],
			bullets: [
				'przesyłać zadania, rozwiązania, wskazówki i materiały, proponować poprawki i tłumaczenia oraz współtworzyć materiały z innymi;',
				'komentować, recenzować, głosować, oznaczać treści jako powstałe z pomocą AI i wskazywać, które kursy obejmuje dane zadanie lub materiał;',
				'prowadzić kursy i do nich dołączać, w tym kursy w trybie szkolnym i z zaświadczeniami o ukończeniu;',
				'publikować ogłoszenia korepetycji oraz przyjmować i składać rezerwacje;',
				'organizować wydarzenia i zapisywać się na nie, wraz z programem, biletami, wolontariatem i powiązanymi narzędziami;',
				'organizować konkursy i brać w nich udział (§ 15);',
				'korzystać z fiszek z powtórkami, prowadzić zapis nauki i — jeśli zechcesz — udostępniać profil edukacyjny;',
				'pisać prywatne wiadomości do innych pełnoletnich użytkowników;',
				'uczestniczyć w organizacjach, zadaniach, planach, potrzebach, ankietach, celach i załącznikach powiązanych z kursem, wydarzeniem lub materiałem;',
				'otrzymywać powiadomienia w serwisie, a jeśli to włączysz — także ich zestawienie e-mailem.'
			]
		},
		{
			body: [
				'Moderatorzy mogą czasowo lub na stałe wyłączyć niektóre funkcje, np. na czas usuwania usterki. Wyłączenie funkcji nie usuwa tego, co w niej umieściłeś.'
			]
		},
		{
			heading: '§ 4. Wymagania techniczne',
			bullets: [
				'Urządzenie z dostępem do internetu i aktualną przeglądarką z włączonym JavaScriptem (bieżąca lub poprzednia główna wersja Firefoksa, Chrome, Edge lub Safari albo przeglądarki na nich opartej).',
				'Przeglądarka musi pozwalać stronie na zapis danych lokalnie (pamięć lokalna i pamięć sesji) i ustawienie jednego pliku cookie z językiem interfejsu; bez tego nie da się pozostać zalogowanym. Polityka prywatności wymienia wszystko, co jest zapisywane, i wyjaśnia po co.',
				'Do samodzielnego założenia konta: adres e-mail, na który możesz odbierać pocztę.',
				'Mapy na stronach korepetycji i wydarzeń są pobierane z serwerów OpenStreetMap; w sieci, która je blokuje, mapa się nie wyświetli.',
				'Nie musisz niczego instalować.'
			],
			body: [
				'Korzystanie z każdej usługi internetowej wiąże się ze zwykłymi zagrożeniami, takimi jak złośliwe oprogramowanie czy przechwycenie danych w niezabezpieczonej sieci. Aktualizuj przeglądarkę i nie korzystaj z EdMat na urządzeniu, któremu nie ufasz.'
			]
		},
		{
			heading: '§ 5. Twoje konto',
			body: [
				'Umowa o świadczenie usług z kontem zostaje zawarta z chwilą rejestracji i akceptacji regulaminu i trwa przez czas nieoznaczony. Przeglądanie bez konta nie wymaga zawarcia umowy i kończy się w chwili opuszczenia strony.',
				'Przy rejestracji podaj prawdziwy adres e-mail i nie podszywaj się pod nikogo. Konto jest dla jednej osoby; nie udostępniaj hasła. Jeśli podejrzewasz, że ktoś inny ma dostęp do Twojego konta, od razu nam o tym napisz.',
				'Wysyłamy e-maile wyłącznie w tych celach: potwierdzenie adresu, reset hasła, zestawienie powiadomień (jeśli je włączysz) oraz informacje o zmianach regulaminu lub dotyczące Twojego konta. Nie wysyłamy reklam.',
				'Role, takie jak moderator, zweryfikowany autor czy opiekun działu, nadają moderatorzy; nie można ich przyznać sobie samemu. Tworzenie niektórych rzeczy (kursu, wydarzenia, ogłoszenia korepetycji, organizacji, konkursu) może być zastrzeżone dla zweryfikowanych autorów; serwis informuje o tym w odpowiednim miejscu.'
			]
		},
		{
			heading: '§ 6. Osoby małoletnie i opiekunowie',
			body: [
				'Jeśli masz mniej niż 16 lat, nie możesz samodzielnie założyć konta. Formularz rejestracji pyta o rok urodzenia wyłącznie po to, by to sprawdzić, i go nie zapisuje. Konto dziecka zakłada w Ustawieniach opiekun posiadający własne konto; robiąc to, opiekun akceptuje regulamin w imieniu dziecka, w tym licencję z § 9 na treści publikowane przez dziecko, i odpowiada za nadzór nad tym, jak dziecko korzysta z serwisu.',
				'Opiekun może czytać komentarze i wpisy dziecka, usunąć każdy z nich, zawiesić konto i je usunąć. Konto dziecka jest domyślnie chronione: nie może wysyłać ani odbierać prywatnych wiadomości, mieć publicznego profilu ani zdjęcia profilowego, udostępniać lokalizacji, oferować korepetycji ani organizować wydarzeń, a jego komentarze i wpisy czekają na moderatora, zanim zobaczy je ktokolwiek inny. Konto dziecka nie może logować się przez Google, Apple ani Microsoft.',
				'Jeśli masz 16 lub 17 lat, możesz zarejestrować się samodzielnie, ale według prawa cywilnego nadal masz ograniczoną zdolność do czynności prawnych. Akceptując regulamin, potwierdzasz, że rodzic lub opiekun wie, że korzystasz z EdMat, i zgadza się na ten regulamin, w szczególności na licencję z § 9.',
				'EdMat nie wyświetla nikomu reklam, a więc także reklam opartych na profilowaniu osób małoletnich.'
			]
		},
		{
			heading: '§ 7. Logowanie przez Google, Apple lub Microsoft',
			body: [
				'Tam, gdzie to włączyliśmy, możesz założyć konto lub logować się przez Google, Apple lub Microsoft zamiast hasłem. Korzystanie z takiego logowania podlega także regulaminowi i polityce prywatności dostawcy, których musisz przestrzegać; dostawca jest odrębną firmą i sam odpowiada za przetwarzanie, którego dokonuje. Nie odpowiadamy za dostępność logowania u dostawcy; gdy nie działa, użyj hasła albo resetu hasła (poniżej).',
				'Twoje konto EdMat jest kontem u nas i podlega temu regulaminowi niezależnie od sposobu logowania. Rejestracja przez dostawcę także pyta o rok urodzenia tam, gdzie o niego pytamy, a zasada dotycząca osób poniżej 16 lat z § 6 obowiązuje tak samo.',
				'Nigdy nie łączymy logowania przez dostawcę z istniejącym kontem tylko dlatego, że zgadzają się adresy e-mail. Jeśli adres e-mail od dostawcy należy już do konta EdMat, najpierw zaloguj się na nie hasłem i połącz dostawcę w Ustawieniach. Możesz w każdej chwili odłączyć dostawcę, o ile konto zachowa inny sposób logowania (hasło lub innego dostawcę).',
				'Jeśli stracisz dostęp do konta u dostawcy, nadal możesz wejść do EdMat przez reset hasła wysłany na potwierdzony adres e-mail albo pisząc do nas. Apple może przekazać nam adres przekierowujący zamiast Twojego prawdziwego; poczta wysłana na taki adres dotrze do Ciebie tylko dopóki utrzymujesz to przekierowanie.'
			]
		},
		{
			heading: '§ 8. Zasady dotyczące treści i zachowania',
			body: [
				'Zakazane jest dostarczanie treści o charakterze bezprawnym oraz korzystanie z EdMat w sposób sprzeczny z prawem lub z regulaminem. W szczególności nie publikuj ani nie wysyłaj:'
			],
			bullets: [
				'treści naruszających cudze prawa autorskie lub inne prawa — np. pełnego arkusza rozwiązań, strony z podręcznika lub cudzej pracy skopiowanej bez zgody;',
				'treści nielegalnych w świetle prawa polskiego lub unijnego, takich jak nawoływanie do przemocy lub nienawiści, groźby, zniesławienie, materiały przedstawiające seksualne wykorzystywanie dzieci czy treści propagujące terroryzm;',
				'nękania, zastraszania, obelg ani treści ujawniających prywatne dane innej osoby bez jej zgody;',
				'treści celowo fałszywych lub wprowadzających w błąd, w tym podszywania się pod inną osobę, instytucję lub organizatora konkursu;',
				'reklam, spamu ani linków służących wyłącznie promocji;',
				'złośliwego oprogramowania ani plików i kodu mających zaszkodzić serwisowi lub innym użytkownikom;',
				'treści o charakterze seksualnym lub brutalnym, nieodpowiednich dla serwisu edukacyjnego, z którego korzystają osoby małoletnie.'
			]
		},
		{
			body: [
				'Nie atakuj, nie przeciążaj ani nie testuj zabezpieczeń serwisu, nie obchodź jego limitów ani kontroli dostępu, nie zbieraj danych innych użytkowników i nie używaj narzędzi automatycznych do zakładania kont ani tworzenia treści. Nie używaj EdMat do ściągania na trwającym egzaminie lub konkursie, jeśli jego zasady zabraniają pomocy z zewnątrz.'
			]
		},
		{
			heading: '§ 9. Twoje treści i licencja',
			body: [
				'1. Prawa autorskie do tego, co tworzysz, pozostają przy Tobie. Oświadczasz, że publikowane przez Ciebie treści są Twoje albo że wolno Ci je opublikować na zasadach regulaminu i że ich publikacja nie narusza niczyich praw. Jeśli publikujesz coś, co stworzył ktoś inny (np. zadanie z zajęć), wskaż źródło w polu źródła; jeśli nie masz pewności, czy możesz to opublikować — nie publikuj.',
				'2. Abyśmy mogli prowadzić serwis, udzielasz usługodawcy nieodpłatnej, niewyłącznej licencji, nieograniczonej czasowo ani terytorialnie, na korzystanie z Twoich treści w serwisie na następujących polach eksploatacji: utrwalanie i zwielokrotnianie dowolną techniką, w tym cyfrową; wprowadzanie do pamięci komputera i na serwery; publiczne udostępnianie w taki sposób, aby każdy mógł mieć do nich dostęp w miejscu i czasie przez siebie wybranym; wyświetlanie, drukowanie i rozpowszechnianie egzemplarzy w ramach serwisu; tłumaczenie, opracowanie, formatowanie i łączenie z innymi treściami w zakresie potrzebnym serwisowi (np. składanie wzorów matematycznych, tworzenie zestawu do nauki, dołączanie tłumaczenia).',
				'3. Treści publikowane publicznie w bazie — zadania, rozwiązania, wskazówki, materiały i ich wersje, tłumaczenia oraz artykuły o pojęciach — są udostępniane na licencji Creative Commons Uznanie autorstwa – Na tych samych warunkach 4.0 Międzynarodowe (CC BY-SA 4.0). Publikując je, udzielasz tej licencji każdemu, na polach eksploatacji wymienionych w pkt 2, a także w zakresie tworzenia i rozpowszechniania utworów zależnych. Inni mogą wykorzystywać i ulepszać Twoją pracę, także poza EdMat, o ile wskażą Cię jako autora i udostępnią swoje zmiany na tej samej licencji. Pkt 3 nie obejmuje komentarzy, recenzji, wpisów, wiadomości, ogłoszeń, wydarzeń ani konkursów; do nich stosuje się wyłącznie pkt 2.',
				'4. Autorskich praw osobistych nie można się zrzec według prawa polskiego. Zobowiązujesz się nie wykonywać ich wobec zwykłego sposobu, w jaki serwis prezentuje i redaguje treści — np. pokazywania Twojej pracy bez pełnego imienia i nazwiska, jeśli wybrałeś nazwę wyświetlaną, poprawiania formatowania lub składu albo pokazywania jej obok ulepszonych wersji innych osób. Autorstwo jest wskazywane pod wybraną przez Ciebie nazwą wyświetlaną.',
				'5. Pkt 3 i 4 dotyczą treści opublikowanych po zaakceptowaniu tej wersji regulaminu. Z treści opublikowanych wcześniej korzystamy wyłącznie na podstawie pkt 2.',
				'6. Jeśli Twoje konto zostanie usunięte, treści objęte licencją z pkt 3 mogą pozostać opublikowane bez Twojego imienia, ponieważ inni mogą już korzystać z licencji. Możesz poprosić o ich usunięcie — zrobimy to, chyba że stały się częścią cudzej pracy w sposób, którego nie da się rozdzielić.',
				'7. Nie sprawdzamy, czy treści użytkowników są poprawne, kompletne i oryginalne. Rozwiązania mogą zawierać błędy; traktuj je jako pomoc, a nie wiążącą odpowiedź.'
			]
		},
		{
			heading: '§ 10. Treści powstałe z pomocą AI',
			body: [
				'Jeśli treść, wskazówkę, rozwiązanie, komentarz lub recenzję napisałeś z pomocą narzędzia AI albo narzędzie to w istotny sposób ją ukształtowało, oznacz ją jako powstałą z pomocą AI, gdy serwis daje taką możliwość. Inni czytelnicy również mogą ocenić, na ile prawdopodobne jest, że treść powstała z pomocą AI, a gdy zgodzi się z tym wystarczająco wiele osób, przy treści pojawia się oznaczenie. Moderator może ustalić oznaczenie, podając powód. Oznaczenie jest informacją dla czytelników, a nie karą, i samo niczego nie usuwa. Za treści powstałe z pomocą AI odpowiadasz tak samo jak za wszystko inne, co publikujesz.'
			]
		},
		{
			heading: '§ 11. Jak moderujemy treści',
			body: [
				'Ograniczamy treści lub konta wyłącznie z powodu naruszenia prawa lub regulaminu, działając starannie, obiektywnie i proporcjonalnie, z poszanowaniem praw i uzasadnionych interesów wszystkich zainteresowanych, w tym wolności wypowiedzi oraz wolności nauki i nauczania. Używamy następujących narzędzi:'
			],
			bullets: [
				'Weryfikacja przed publikacją. Nowe zadania, materiały, tłumaczenia i propozycje poprawek czekają w kolejce, dopóki moderator (człowiek) ich nie zaakceptuje. Ta weryfikacja dotyczy dopasowania do serwisu i formy, a nie prawnej oceny każdego zgłoszenia.',
				'Wstrzymanie treści osób małoletnich. Komentarze i wpisy kont osób poniżej 16 lat, obrazy publikowane dla młodszej grupy odbiorców oraz anonimowe komentarze na stronach stałych czekają, aż moderator je przepuści.',
				'Zgłoszenia. Każdy zalogowany użytkownik może zgłosić treść. Moderator decyduje: pozostawić ją, przywrócić albo usunąć.',
				'Automatyczne ukrycie — jedyny zautomatyzowany krok. Zadanie — albo powiązana z nim recenzja, wskazówka, rozwiązanie, wpis lub komentarz — jest ukrywane automatycznie, bez decyzji człowieka, gdy zgłosiło je co najmniej 3 różnych użytkowników, a liczba zgłoszeń osiągnie 20% liczby zalogowanych użytkowników, którzy otworzyli to zadanie. Moderator następnie je sprawdza i przywraca albo usuwa; autor, jeśli jest znany, jest od razu informowany o ukryciu.',
				'Automatyczne odmowy co do formy: konkurs, którego opisy etapów lub kryteria oceny zawierają słowa opisujące losowanie, jest odrzucany do czasu ich przeredagowania (§ 15), pliki są sprawdzane i ponownie kodowane, a z obrazów i tekstu usuwany jest kod. Są to kontrole formy, a nie poglądów.',
				'Moderatorzy o ograniczonym zakresie (opiekunowie działów), wyznaczani przez moderatorów, mogą moderować tylko w obrębie jednego kierunku, przedmiotu lub materiału.',
				'Moderatorzy mogą ukryć lub usunąć treść, zamknąć publiczny dostęp do strony konkursu lub wydarzenia, odebrać rolę oraz zawiesić lub zakończyć konto (§ 14, § 19).'
			]
		},
		{
			heading: '§ 12. Zgłoszenia nielegalnych treści',
			body: [
				'Każdy, z kontem lub bez, może poinformować nas, że konkretna treść jest nielegalna, za pomocą formularza pod adresem /legal/notice. Zgłoszenie powinno zawierać dokładny adres treści, wyjaśnienie, dlaczego uważasz ją za nielegalną, kontaktowy adres e-mail oraz oświadczenie, że działasz w dobrej wierze. Każde zgłoszenie rozpatruje człowiek. Informujemy Cię o decyzji i jej uzasadnieniu, a jeśli podejmiemy działanie — informujemy także autora treści.'
			]
		},
		{
			heading: '§ 13. Uzasadnienie decyzji i jak je zakwestionować',
			body: [
				'Za każdym razem, gdy usuwamy, ukrywamy lub ograniczamy Twoją treść albo zawieszamy lub kończymy Twoje konto, informujemy Cię o tym wraz z uzasadnieniem: co zrobiliśmy i w jakim zakresie, na jakich faktach się opieraliśmy, czy brał w tym udział krok zautomatyzowany, na jakim przepisie prawa lub postanowieniu regulaminu decyzja się opiera i jak możesz ją zakwestionować. Wyjątki są tylko takie, na jakie pozwala prawo, np. gdy nie mamy jak się z Tobą skontaktować.',
				`Możesz zakwestionować taką decyzję, a także decyzję w sprawie wysłanego przez Ciebie zgłoszenia, bezpłatnie, w terminie 6 miesięcy od otrzymania informacji o niej, pisząc na adres ${CONTACT_PL} albo odpowiadając w wątku zgłoszenia. Wskaż, którą decyzję kwestionujesz i dlaczego. Twoją skargę rozpatruje człowiek — w miarę możliwości inny niż ten, który podjął pierwotną decyzję — nigdy wyłącznie krok zautomatyzowany, a uzasadnioną odpowiedź otrzymasz bez zbędnej zwłoki, najpóźniej w ciągu 14 dni. Jeśli skarga wykaże, że decyzja była błędna, cofamy ją.`,
				'Możesz też skierować spór do pozasądowego organu rozstrzygania sporów certyfikowanego na podstawie art. 21 Aktu o usługach cyfrowych (ich listę publikuje Komisja Europejska); będziemy z nim współpracować w dobrej wierze. Od 6 listopada 2026 r. możesz także złożyć skargę do Prezesa Urzędu Komunikacji Elektronicznej (Prezesa UKE), polskiego koordynatora do spraw usług cyfrowych. Nic z powyższego nie ogranicza Twojego prawa do drogi sądowej.'
			]
		},
		{
			heading: '§ 14. Nadużycia',
			body: [
				'Po uprzednim ostrzeżeniu zawieszamy na rozsądny okres konto użytkownika, który często dostarcza treści w oczywisty sposób nielegalne. W ten sam sposób zawieszamy rozpatrywanie zgłoszeń i skarg osoby, która często wysyła zgłoszenia lub skargi w oczywisty sposób bezzasadne. Decydujemy indywidualnie, biorąc pod uwagę liczbę takich treści lub zgłoszeń — bezwzględnie i w stosunku do wszystkiego, co dana osoba opublikowała lub wysłała w ostatnim roku — ich wagę i skutki oraz, jeśli da się to ustalić, zamiar tej osoby. Zawieszenie następuje z uzasadnieniem zgodnie z § 13 i można je zakwestionować w ten sam sposób.'
			]
		},
		{
			heading: '§ 15. Konkursy',
			body: [
				'Konkurs w EdMat organizuje wyłącznie użytkownik lub instytucja wskazana na stronie konkursu jako organizator. Wyłącznie organizator składa przyrzeczenie publiczne nagrody (art. 919–921 Kodeksu cywilnego), wyłącznie on decyduje, kto może wziąć udział i jak oceniane są prace, wyłącznie on odpowiada za dane osobowe uczestników jako ich administrator i wyłącznie na nim ciążą obowiązki podatkowe związane z nagrodami.',
				'EdMat zapewnia jedynie środki techniczne. Nie jest stroną przyrzeczenia, nie finansuje ani nie przechowuje nagród, nie pobiera opłat za udział, nie sprawdza, czy nagroda istnieje lub zostanie wydana, i nie odpowiada za nagrodę. Spór o nagrodę lub wynik toczy się między uczestnikiem a organizatorem. Konkurs nie może zawierać żadnego elementu losowego (losowania) ani wymagać jakiejkolwiek opłaty za udział.',
				'Publikując konkurs, organizator oświadcza, że jego zasady są zgodne z prawem i że ma wszystkie prawa i zgody, na które się powołuje, w tym zgodę opiekuna każdego uczestnika poniżej 16 lat oraz zgodę na opublikowanie pełnego imienia i nazwiska zwycięzcy. Możemy usunąć konkurs naruszający prawo lub regulamin, zgodnie z § 11 i § 13. Usunięty przez nas konkurs zostaje ukryty, a nie odwołany; odwołanie konkursu jest czynnością organizatora.'
			]
		},
		{
			heading: '§ 16. Korepetycje, rezerwacje, wydarzenia, kursy i wiadomości',
			body: [
				'EdMat pomaga użytkownikom się znaleźć; nie jest stroną tego, co między sobą ustalą. Korepetycje, rezerwacja, wydarzenie czy kurs to ustalenie między zainteresowanymi użytkownikami. EdMat nie obsługuje płatności i nie pobiera za nie żadnych pieniędzy; jeśli użytkownicy umówią się na wynagrodzenie, rozliczają się bezpośrednio i sami odpowiadają za swoje obowiązki, w tym podatkowe.',
				'Organizator, który zbiera informacje od uczestników (np. odpowiedzi w formularzu zapisu lub potrzeby dostępności), może ich używać wyłącznie do przeprowadzenia danego wydarzenia lub kursu i musi postępować z nimi zgodnie z prawem. Ogłoszenia i wydarzenia muszą zgodnie z prawdą opisywać to, co oferują.',
				'Prywatne wiadomości służą komunikacji między pełnoletnimi użytkownikami. Na naszym serwerze są szyfrowane i ich nie czytamy, chyba że wymaga tego prawo. Nie używaj ich do spamu ani nękania; o takiej wiadomości możesz nas poinformować pod adresem kontaktowym z § 2.'
			]
		},
		{
			heading: '§ 17. Odpowiedzialność',
			body: [
				'Staramy się, by EdMat był dostępny i działał, ale jest to bezpłatna usługa prowadzona przez jednostkę uczelni i czasami może być niedostępny — np. z powodu konserwacji, aktualizacji lub awarii. Planowane dłuższe przerwy w miarę możliwości zapowiadamy w serwisie.',
				'Przechowujemy treści dostarczane przez użytkowników. Nie odpowiadamy za te treści, dopóki nie wiemy o ich bezprawnym charakterze, a po uzyskaniu takiej wiedzy niezwłocznie działamy. Nie odpowiadamy za poprawność zadań i rozwiązań napisanych przez użytkowników ani za ustalenia między użytkownikami (§ 15, § 16).',
				'Za publikowane treści i sposób korzystania z serwisu odpowiadasz Ty. Żadne postanowienie regulaminu nie wyłącza ani nie ogranicza odpowiedzialności, której według prawa nie można wyłączyć ani ograniczyć, w szczególności za szkodę wyrządzoną umyślnie, ani żadnych praw przysługujących Ci jako konsumentowi.'
			]
		},
		{
			heading: '§ 18. Reklamacje',
			body: [
				`Jeśli serwis nie działa tak, jak opisuje to regulamin, możesz złożyć reklamację, pisząc na adres ${CONTACT_PL}. Opisz problem, podaj, kiedy wystąpił, i wskaż, jak mamy Ci odpowiedzieć (wystarczy adres e-mail, z którego piszesz). Odpowiadamy w ciągu 14 dni od otrzymania reklamacji, e-mailem lub w sposób, o który poprosisz. Skargi na decyzje moderacyjne rozpatrujemy zgodnie z § 13.`
			]
		},
		{
			heading: '§ 19. Rozwiązanie umowy',
			body: [
				`Możesz w każdej chwili, bez podania przyczyny i bezpłatnie, rozwiązać umowę, prosząc o usunięcie konta pod adresem ${CONTACT_PL}. Dopóki w Ustawieniach nie ma przycisku usuwania konta, usuwa je człowiek, a my potwierdzamy, gdy to nastąpi. Opiekun może usunąć konto dziecka bezpośrednio w Ustawieniach. Co dzieje się z Twoimi treściami, określa § 9 pkt 6 i polityka prywatności.`,
				'Możemy rozwiązać umowę tylko z ważnego powodu: poważnego lub powtarzającego się naruszenia regulaminu lub prawa, w szczególności gdy ostrzeżenie nie przyniosło skutku; używania konta do ataków na serwis lub innych użytkowników; albo nakazu sądu lub organu. Zachowujemy 14-dniowy okres wypowiedzenia, chyba że naruszenie jest tak poważne albo bezpieczeństwo innych lub serwisu tak zagrożone, że konto trzeba zawiesić natychmiast. W każdym przypadku otrzymasz uzasadnienie i możesz je zakwestionować (§ 13).',
				'Jeśli zdecydujemy o całkowitym zamknięciu serwisu, ogłosimy to co najmniej 30 dni wcześniej w serwisie i e-mailem na potwierdzone adresy.'
			]
		},
		{
			heading: '§ 20. Zmiany regulaminu',
			body: [
				'Możemy zmienić regulamin wyłącznie z ważnej przyczyny: zmiany prawa lub decyzji organu, która dotyczy serwisu; wprowadzenia nowej funkcji albo zmiany lub wycofania istniejącej; potrzeby bezpieczeństwa; albo potrzeby jaśniejszego opisania usługi lub poprawienia błędu.',
				'O zmianie informujemy co najmniej 14 dni przed jej wejściem w życie, w serwisie oraz e-mailem na każde konto z potwierdzonym adresem, wraz z nowym tekstem i podsumowaniem zmian. Jeśli nie akceptujesz zmiany, możesz bezpłatnie rozwiązać umowę przed jej wejściem w życie (§ 19). Zmiany wymagane natychmiast przez prawo lub organ mogą wejść w życie wcześniej i wtedy to zaznaczymy. Każda wcześniejsza wersja jest przechowywana i prześlemy ją na Twoją prośbę.'
			]
		},
		{
			heading: '§ 21. Dane osobowe',
			body: [
				'Sposób przetwarzania danych osobowych, jego podstawy prawne, okresy przechowywania i Twoje prawa opisuje polityka prywatności pod adresem /privacy. Polityka prywatności ma charakter informacyjny i nie jest częścią akceptowanej przez Ciebie umowy.'
			]
		},
		{
			heading: '§ 22. Prawo właściwe, spory i postanowienia końcowe',
			body: [
				'Regulamin podlega prawu polskiemu. Jeśli jesteś konsumentem mieszkającym w innym państwie, zachowujesz ochronę, jaką dają Ci bezwzględnie obowiązujące przepisy tego państwa.',
				'Spory rozstrzyga sąd właściwy według przepisów ogólnych; nic w regulaminie nie odbiera Ci prawa do wytoczenia powództwa przed sądem, który wskazuje prawo. Jako konsument możesz też skorzystać z pozasądowych sposobów rozwiązywania sporów, np. z pomocy miejskiego lub powiatowego rzecznika konsumentów albo mediacji Inspekcji Handlowej. Unijna platforma internetowego rozstrzygania sporów (ODR) nie działa już.',
				'Regulamin jest dostępny w języku polskim i angielskim, a obie wersje są jednakowo wiążące. Jeśli się różnią, stosuje się wykładnię korzystniejszą dla użytkownika.',
				`Regulamin obowiązuje od ${TERMS_VERSION}.`
			]
		}
	]
};

export function termsOfUseFor(locale: string): TermsOfUse {
	return locale === 'pl' ? PL : EN;
}
