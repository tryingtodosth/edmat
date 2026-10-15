/**
 * `/about/account` — what an account on EdMat is, and what its owner controls: opening one (and the
 * age gate), accounts a guardian runs for a child, signing in with an outside provider, e-mail and
 * the password, downloading your data and deleting the account.
 *
 * Written 2026-10-15 (WP6) against `backend/accounts/{minors,erasure,password}.py`,
 * `backend/sso/CLAUDE.md`, `backend/mail/CLAUDE.md`, `LEGAL.md` §10 and the two standing documents
 * it must never contradict — `/terms` (§§ 5–7, 19) and `/privacy` (sign-in, e-mail, children,
 * "Your rights"). Where those say it in full, this page says it short and the "Try it" row links
 * them rather than paraphrasing loosely.
 *
 * **Sign-in providers are described, never drawn.** No provider is configured on the development
 * database these screenshots were taken against (`GET /api/auth/sso/providers/` answers `[]`), so
 * the sign-in picture shows the form and the older `identity/` draft cards — each marked "Draft" —
 * and the prose says so. No button is faked anywhere on this page; when the operator configures a
 * provider, the real one appears on `/login` and the screenshot is simply out of date.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseModuleDoc } from './index';

const EN: ShowcaseModuleDoc = {
	title: 'Your account',
	description:
		'What an EdMat account is and what you control: opening one and the age check, accounts a guardian runs for a child, signing in with Google, Apple, GitHub, Facebook or Microsoft, e-mail and passwords, downloading your data and deleting your account.',
	lead: [
		'You can read everything public on EdMat without an account. You need one to write — an exercise, a solution, a comment — to save a set or a deck, or to join a course or an event. An account is a display name, an e-mail address and a way to sign in, and it is yours to take with you or to close.',
		'This page walks through what happens at each step, and which parts you can do yourself in Settings. The terms of use and the privacy policy say the same things in full; where they say it better, the links below go to them.'
	],
	points: [
		{
			heading: 'Your year of birth is asked, never stored',
			body: 'Registration asks for it only to check whether you are old enough to open an account yourself. Under 16, a parent or guardian opens it for you instead.'
		},
		{
			heading: 'Nothing is joined just because an address matches',
			body: 'If you sign in with Google or another provider and the address already belongs to an EdMat account, you first prove that account is yours. The match only proposes; you decide.'
		},
		{
			heading: 'Leaving is yours to do, and to undo',
			body: 'Download everything EdMat holds about you whenever you like. Deleting the account switches it off at once and erases it 14 days later; until then, signing in brings it back.'
		}
	],
	tryIt: [
		{ label: 'Create an account', route: '/register' },
		{ label: 'Log in', route: '/login' },
		{ label: 'Settings: e-mail, password, children', route: '/settings#account' },
		{ label: 'Download your data or delete your account', route: '/settings/account' }
	],
	// Screenshots of the running site (`e2e/showcase-screens.mjs`), each looked at before it was used.
	shots: [
		{
			src: '/showcase/account/01-register.png',
			focus: [400, 880],
			width: 1280,
			height: 1036,
			route: '/register',
			alt: 'Screenshot of “Create an account”: fields for a display name, an e-mail address, the year of birth (with the note “Only used to check you are old enough to open an account yourself. It is not stored.”), a password of at least 8 characters, the preferred interface language, a box to accept the terms of use and the privacy policy, and a Sign up button. Under an “or” line, four sign-in cards — University account, Google, Apple and GitHub — each marked DRAFT.',
			caption:
				'Opening an account. The year of birth is asked and not kept. The cards marked “Draft” under the form are not working buttons: they open a page saying how far each sign-in method is.'
		},
		{
			src: '/showcase/account/02-login.png',
			focus: [400, 880],
			width: 1280,
			height: 705,
			route: '/login',
			alt: 'Screenshot of “Log in”: a field for an e-mail address or username, a password field, a Log in button, the link “Forgotten your password?”, and under an “or” line the same four sign-in cards marked DRAFT, then “No account yet? Sign up”.',
			caption:
				'Signing in, with an e-mail address or a username — a child’s account has only a username. No sign-in provider was set up when this was taken, so only the drafts show.'
		},
		{
			src: '/showcase/account/03-settings.png',
			focus: [380, 900],
			width: 1280,
			height: 737,
			route: '/settings#account',
			linkLabel: 'Open Settings',
			alt: 'Screenshot of three cards in Settings, for a guardian’s account. Email: the address, a “Not confirmed” tag, the note “Until you open the confirmation link, we send nothing else to this address.”, a “Send the confirmation link” button and a box “Email me my unread notifications (at most once an hour)”. Password: “You sign in with a password.” and a “Change password” button. Children: a short explanation of children’s accounts, one child listed by name and username with the buttons “What they wrote”, “Suspend account” and “Delete account”.',
			caption:
				'Settings for a guardian with one child’s account: the e-mail address and the digest, the password, and the child’s account with what the guardian can do. The form to add a child sits just below.'
		},
		{
			src: '/showcase/account/04-data.png',
			focus: [250, 1030],
			width: 1280,
			height: 1014,
			route: '/settings/account',
			alt: 'Screenshot of “Your data and your account”. A “Download your data” card describing the JSON file and a “Download my data” button, “You can download it three times a day.” Below it a red-bordered “Delete your account” card: the account is switched off at once and erased after 14 days, and two lists with counts — “Deleted” (profile, sign-in, notifications, what you opened, study sets and decks, roles, applications, activity feed entries) and “Stays published, without your name” (exercises, solutions, translations, materials; comments, reviews and posts).',
			caption:
				'Your data and your account. Everything under “Delete your account” comes from the same server table that carries the deletion out, with your own counts — so the page cannot promise one thing and do another.'
		},
		{
			src: '/showcase/account/05-delete.png',
			focus: [250, 1030],
			width: 1280,
			height: 587,
			route: '/settings/account',
			alt: 'Screenshot of the end of the deletion card: “Your published content that is not openly licensed — 6 of the things you published are under “EdMat only” (or have no declared licence). You decide what happens to them”, with two choices, keep them published under “Deleted account” or remove them (hidden; comments and links stay), a note that Creative Commons content always stays, and a Confirm form asking for the username and the current password above a “Delete my account” button.',
			caption:
				'Before you confirm: what happens to your “EdMat only” content is your choice. Openly licensed work stays without your name, because that licence cannot be taken back.'
		}
	],
	sections: [
		{
			key: 'register',
			heading: 'Opening an account',
			body: [
				'You give a display name, an e-mail address, a password of at least eight characters and the language you want the site in, and you accept the terms of use. Which version of the terms you accepted, and when, is recorded — whichever way you sign up.',
				'The form also asks for your year of birth, only to check one thing: whether you are 16 or older. It is not stored. If you are under 16, the form does not open an account; it tells you to ask a parent or guardian to open one for you. At 16 or 17 you can register yourself, and the terms ask that a parent or guardian knows you use EdMat.',
				'Right after signing up you get an e-mail with a link to confirm the address. Until you open it, EdMat sends nothing else there.'
			]
		},
		{
			key: 'children',
			heading: 'An account a guardian runs for a child',
			body: [
				'A parent or guardian with their own account opens a child’s account in Settings → Children: a name, a username and a password, and no e-mail address — none is collected for a child. The child signs in with the username. By opening the account the guardian accepts the terms for the child.',
				'A child’s account is protected by default. It cannot send or receive private messages, have a public profile or a picture, share a location, list tutoring or host an event, and its comments and posts wait for a moderator before anyone else sees them. It cannot sign in with Google or any other provider. The guardian can read what the child wrote, remove any of it, suspend the account and delete it.'
			]
		},
		{
			key: 'providers',
			heading: 'Signing in with Google, Apple, GitHub, Facebook or Microsoft',
			body: [
				'Instead of a password you can sign in through one of these providers — but only once the people running EdMat have registered the site with that provider and switched it on. A provider that is not set up shows no button at all. When this page was written (15 October 2026), none was set up yet, so the screenshots above show the form and, below it, older drafts marked “Draft” that only explain what is still missing.',
				'An account is never joined to a provider just because the e-mail addresses match. If the provider’s address already belongs to an EdMat account, you are asked to prove that account is yours — with its password, or with a one-time link sent to its confirmed address that works only in the browser where you started. Only then is the provider connected, and the account gets an e-mail saying so. Accounts a guardian runs are never connected this way.',
				'EdMat keeps the provider’s identifier for your account and the address it gave, never the provider’s access tokens or your picture. In Settings you can disconnect a provider, as long as the account keeps another way in — a password, or another provider. An account that has only ever signed in through a provider can set a password there.'
			]
		},
		{
			key: 'mail',
			heading: 'E-mail and your password',
			body: [
				'Mail comes from no-reply@edmat.net, and only for these things: confirming your address, resetting your password, the notification digest if you switch it on, and notices about your account or the terms. No marketing. A confirmation link is valid for a week; Settings can send a new one.',
				'“Forgotten your password?” on the sign-in page mails you a reset link. The page answers the same whether or not an account has that address, so nobody can use it to find out who is registered. Setting the new password signs you out everywhere and also confirms the address, since you opened the link from that inbox.',
				'The digest is off until you switch it on: at most once an hour, it mails your unread notifications — and only to a confirmed address. The Password card in Settings changes your password (it asks for the current one) or sets one for an account that has none.'
			]
		},
		{
			key: 'export',
			heading: 'Download your data',
			body: [
				'In Settings → Your data and your account, “Download my data” gives you one JSON file with everything EdMat holds about you: your profile and settings, what you wrote and published, your private messages decrypted, bookings, registrations, study sets and flashcards, notifications, the terms you accepted, the sign-in providers you connected (never their tokens) and the last 90 days of the server’s record of your requests. Every field is described inside the file. Other people appear in it only under the name the site showed you.',
				'You can download it three times a day. Files you uploaded are listed with links, not packed into the file.'
			]
		},
		{
			key: 'deletion',
			heading: 'Delete your account',
			body: [
				'“Delete my account” asks you to type your username and your password, and shows you beforehand exactly what will happen, counted from your own data. The account is switched off at once — you are signed out everywhere and your profile is hidden — and erased 14 days later. Until then, signing in (or the link in the e-mail you get, if your address is confirmed) cancels it.',
				'If you still run a course, an event, a contest, an organisation or a project that other people are in, you are asked to hand it over or close it first, and the page lists which. A child cannot delete their own account; the guardian does it from their Settings, in the same way.',
				'The erased account becomes an empty record with a number instead of a name, and everything that stays reads “Deleted account”. The privacy policy lists exactly what goes and what stays.'
			],
			facts: [
				{
					term: 'Deleted',
					detail:
						'What is private to you: profile, settings, sign-in methods, history, notifications, sets and decks, roles, drafts.'
				},
				{
					term: 'Stays, without your name',
					detail:
						'What you published under a Creative Commons licence, and comments, reviews and posts. The licence cannot be taken back; others may already rely on it.'
				},
				{
					term: 'Your choice',
					detail:
						'What you published under “EdMat only” (or with no declared licence): keep it under “Deleted account”, or remove it — hidden from everyone, while comments and links to it stay. Items with somebody else’s work in them stay either way.'
				},
				{
					term: 'Kept as a record',
					detail:
						'What other people rely on: a moderation decision, a vote counted in a result, a jury’s score, a booking the other side had, a conversation that is also theirs.'
				},
				{
					term: 'Ended',
					detail:
						'What is still live with somebody on the other side — a future booking, a seat at an upcoming event, a course enrolment — is cancelled, and they are told.'
				}
			],
			sample: {
				caption:
					'One invented deletion, as a timeline: what happens on the day it is asked for, the fourteen days in which it can still be undone, and the day it becomes final.',
				title: 'Deleting an account',
				rows: [
					{
						label: 'Day 0',
						title: 'Deletion requested: signed out everywhere, profile hidden',
						note: 'switched off'
					},
					{
						label: 'Days 1–13',
						title: 'Signing in, or the link in the e-mail, cancels it',
						note: 'can be undone'
					},
					{
						label: 'Day 14',
						title: 'Erased: the account becomes “Deleted account”',
						note: 'final'
					}
				]
			}
		},
		{
			key: 'not-yet',
			heading: 'Not built yet',
			body: ['Said plainly, so that nobody has to find it out by tripping over it:'],
			facts: [
				{
					term: 'New terms',
					detail:
						'When the terms of use change, nothing asks you to accept the new version yet; the site knows which version you accepted, so the prompt can be built.'
				},
				{
					term: 'Your files',
					detail: 'The data download links your uploaded files rather than packing them into a ZIP.'
				},
				{
					term: 'Providers',
					detail:
						'Facebook’s deauthorise and data-deletion callbacks, and Apple’s server notifications, are not built. Removing EdMat from your Facebook, Google, Apple or GitHub apps stops that sign-in but does not delete your EdMat account — that is done in Settings.'
				},
				{
					term: 'Passwords',
					detail:
						'An account that signs in only through a provider sets a password before it can be deleted. A guardian cannot reset a child’s password by e-mail, because a child’s account has no address.'
				},
				{
					term: 'Your address',
					detail: 'There is no way to change the e-mail address on an account yet.'
				},
				{
					term: 'Removing one item',
					detail:
						'Asking for one openly licensed item to be taken down is done by writing to us, not by a button.'
				}
			]
		}
	],
	closing:
		'Who is responsible for your data, on what basis it is processed and how to complain are in the privacy policy; the agreement itself, including how to end it, is in the terms of use. This page describes the same things and is not a substitute for either.'
};

const PL: ShowcaseModuleDoc = {
	title: 'Twoje konto',
	description:
		'Czym jest konto w EdMacie i co od ciebie zależy: zakładanie konta i sprawdzenie wieku, konta prowadzone przez opiekuna dla dziecka, logowanie przez Google, Apple, GitHub, Facebook albo Microsoft, e-mail i hasło, pobranie swoich danych i usunięcie konta.',
	lead: [
		'Wszystko, co w EdMacie jest publiczne, można czytać bez konta. Konto jest potrzebne, żeby coś napisać — zadanie, rozwiązanie, komentarz — zapisać zestaw, zrobić fiszki, dołączyć do kursu czy wydarzenia. Konto to nazwa wyświetlana, adres e-mail i sposób logowania, i to ty decydujesz, czy je zabrać ze sobą, czy zamknąć.',
		'Ta strona pokazuje po kolei, co dzieje się na każdym kroku i co możesz zrobić samodzielnie w Ustawieniach. Regulamin i polityka prywatności mówią o tym samym w pełnej wersji; tam, gdzie mówią to lepiej, linki poniżej prowadzą właśnie do nich.'
	],
	points: [
		{
			heading: 'Rok urodzenia jest sprawdzany, a nie zapisywany',
			body: 'Formularz rejestracji pyta o niego tylko po to, żeby sprawdzić, czy możesz założyć konto samodzielnie. Poniżej 16 lat konto zakłada za ciebie rodzic albo opiekun.'
		},
		{
			heading: 'Nic nie łączy się tylko dlatego, że adres się zgadza',
			body: 'Jeśli logujesz się przez Google albo innego dostawcę, a ten adres ma już konto w EdMacie, najpierw potwierdzasz, że to konto jest twoje. Zgodny adres to tylko propozycja; decyzja należy do ciebie.'
		},
		{
			heading: 'Odejście zależy od ciebie — jego cofnięcie też',
			body: 'Wszystko, co EdMat o tobie przechowuje, możesz pobrać w każdej chwili. Usunięcie konta od razu je wyłącza, a kasuje po 14 dniach; do tego czasu wystarczy się zalogować, żeby je odzyskać.'
		}
	],
	tryIt: [
		{ label: 'Załóż konto', route: '/register' },
		{ label: 'Zaloguj się', route: '/login' },
		{ label: 'Ustawienia: e-mail, hasło, dzieci', route: '/settings#account' },
		{ label: 'Pobierz swoje dane albo usuń konto', route: '/settings/account' }
	],
	shots: [
		{
			src: '/showcase/account/01-register.png',
			focus: [400, 880],
			width: 1280,
			height: 1036,
			route: '/register',
			alt: 'Zrzut ekranu „Create an account”: pola na nazwę wyświetlaną, adres e-mail, rok urodzenia (z dopiskiem „Only used to check you are old enough to open an account yourself. It is not stored.”), hasło z co najmniej 8 znakami, preferowany język interfejsu, pole akceptacji regulaminu i polityki prywatności oraz przycisk Sign up. Pod linią „or” cztery karty logowania — konto uczelniane, Google, Apple i GitHub — każda oznaczona DRAFT.',
			caption:
				'Zakładanie konta. Rok urodzenia jest sprawdzany, ale nie zapisywany. Karty z dopiskiem „Draft” pod formularzem nie są działającymi przyciskami: otwierają stronę, która mówi, na jakim etapie jest każda metoda logowania.'
		},
		{
			src: '/showcase/account/02-login.png',
			focus: [400, 880],
			width: 1280,
			height: 705,
			route: '/login',
			alt: 'Zrzut ekranu „Log in”: pole na adres e-mail albo nazwę użytkownika, pole hasła, przycisk Log in, link „Forgotten your password?”, a pod linią „or” te same cztery karty logowania oznaczone DRAFT i „No account yet? Sign up”.',
			caption:
				'Logowanie adresem e-mail albo nazwą użytkownika — konto dziecka ma tylko nazwę użytkownika. Kiedy powstawał ten zrzut, żaden dostawca logowania nie był skonfigurowany, więc widać tylko wersje robocze.'
		},
		{
			src: '/showcase/account/03-settings.png',
			focus: [380, 900],
			width: 1280,
			height: 737,
			route: '/settings#account',
			linkLabel: 'Otwórz Ustawienia',
			alt: 'Zrzut ekranu trzech kart w Ustawieniach, na koncie opiekuna. Email: adres, znacznik „Not confirmed”, dopisek „Until you open the confirmation link, we send nothing else to this address.”, przycisk „Send the confirmation link” i pole „Email me my unread notifications (at most once an hour)”. Password: „You sign in with a password.” i przycisk „Change password”. Children: krótkie wyjaśnienie, czym są konta dzieci, jedno dziecko z imieniem i nazwą użytkownika oraz przyciski „What they wrote”, „Suspend account” i „Delete account”.',
			caption:
				'Ustawienia opiekuna z jednym kontem dziecka: adres e-mail i podsumowanie powiadomień, hasło oraz konto dziecka z tym, co opiekun może z nim zrobić. Formularz dodawania dziecka jest tuż pod spodem.'
		},
		{
			src: '/showcase/account/04-data.png',
			focus: [250, 1030],
			width: 1280,
			height: 1014,
			route: '/settings/account',
			alt: 'Zrzut ekranu „Your data and your account”. Karta „Download your data” z opisem pliku JSON, przycisk „Download my data” i „You can download it three times a day.” Pod nią karta „Delete your account” z czerwoną ramką: konto zostaje od razu wyłączone i skasowane po 14 dniach, oraz dwie listy z liczbami — „Deleted” (profil, logowanie, powiadomienia, co otwierano, zestawy i fiszki, role, zgłoszenia, wpisy w aktywności) i „Stays published, without your name” (zadania, rozwiązania, tłumaczenia, materiały; komentarze, recenzje i wpisy).',
			caption:
				'Twoje dane i twoje konto. Wszystko pod „Usuń konto” pochodzi z tej samej tabeli na serwerze, która przeprowadza usunięcie, z liczbami z twoich danych — więc strona nie może obiecać jednego i zrobić czegoś innego.'
		},
		{
			src: '/showcase/account/05-delete.png',
			focus: [250, 1030],
			width: 1280,
			height: 587,
			route: '/settings/account',
			alt: 'Zrzut ekranu końca karty usuwania konta: „Your published content that is not openly licensed — 6 of the things you published are under “EdMat only” (or have no declared licence). You decide what happens to them”, dwie możliwości — zostawić opublikowane jako „Deleted account” albo usunąć (ukryte; komentarze i linki zostają) — dopisek, że treści na licencji Creative Commons zostają zawsze, oraz formularz Confirm z nazwą użytkownika, obecnym hasłem i przyciskiem „Delete my account”.',
			caption:
				'Zanim potwierdzisz: to ty decydujesz, co stanie się z treściami na licencji „Tylko EdMat”. Prace na otwartej licencji zostają bez twojego imienia, bo tej licencji nie da się cofnąć.'
		}
	],
	sections: [
		{
			key: 'register',
			heading: 'Zakładanie konta',
			body: [
				'Podajesz nazwę wyświetlaną, adres e-mail, hasło z co najmniej ośmioma znakami i język, w jakim chcesz używać serwisu, oraz akceptujesz regulamin. To, którą wersję regulaminu zaakceptowano i kiedy, jest zapisywane — niezależnie od sposobu rejestracji.',
				'Formularz pyta też o rok urodzenia, tylko po to, żeby sprawdzić jedno: czy masz co najmniej 16 lat. Rok nie jest zapisywany. Poniżej 16 lat formularz nie założy konta — podpowie, żeby poprosić rodzica albo opiekuna o założenie go za ciebie. W wieku 16 lub 17 lat można zarejestrować się samodzielnie, a regulamin prosi, żeby rodzic albo opiekun wiedział, że korzystasz z EdMatu.',
				'Zaraz po rejestracji przychodzi e-mail z linkiem potwierdzającym adres. Dopóki go nie otworzysz, EdMat nie wysyła na ten adres nic więcej.'
			]
		},
		{
			key: 'children',
			heading: 'Konto, które opiekun prowadzi dla dziecka',
			body: [
				'Rodzic albo opiekun z własnym kontem zakłada konto dziecka w Ustawieniach → Dzieci: imię, nazwa użytkownika i hasło, bez adresu e-mail — dla dziecka żaden nie jest zbierany. Dziecko loguje się nazwą użytkownika. Zakładając konto, opiekun akceptuje regulamin w imieniu dziecka.',
				'Konto dziecka jest domyślnie chronione. Nie może wysyłać ani dostawać prywatnych wiadomości, mieć publicznego profilu ani zdjęcia, udostępniać lokalizacji, ogłaszać korepetycji ani organizować wydarzeń, a jego komentarze i wpisy czekają na moderatora, zanim zobaczy je ktokolwiek inny. Nie może też logować się przez Google ani innego dostawcę. Opiekun może przeczytać, co dziecko napisało, usunąć dowolny wpis, zawiesić konto i je usunąć.'
			]
		},
		{
			key: 'providers',
			heading: 'Logowanie przez Google, Apple, GitHub, Facebook albo Microsoft',
			body: [
				'Zamiast hasła możesz logować się przez jednego z tych dostawców — ale dopiero wtedy, gdy osoby prowadzące EdMat zarejestrują serwis u danego dostawcy i go włączą. Dostawca, który nie jest skonfigurowany, nie pokazuje żadnego przycisku. Kiedy powstawała ta strona (15 października 2026), żaden nie był jeszcze skonfigurowany, więc zrzuty ekranu powyżej pokazują formularz, a pod nim starsze wersje robocze z dopiskiem „Draft”, które tylko wyjaśniają, czego jeszcze brakuje.',
				'Konto nigdy nie zostaje połączone z dostawcą tylko dlatego, że adresy e-mail się zgadzają. Jeśli adres od dostawcy ma już konto w EdMacie, musisz potwierdzić, że to konto jest twoje — jego hasłem albo jednorazowym linkiem wysłanym na potwierdzony adres, który działa tylko w przeglądarce, w której zaczęto logowanie. Dopiero wtedy dostawca zostaje podłączony, a na konto przychodzi o tym e-mail. Kont prowadzonych przez opiekuna nigdy nie łączy się w ten sposób.',
				'EdMat przechowuje identyfikator twojego konta u dostawcy i adres, który podał — nigdy tokenów dostępu dostawcy ani twojego zdjęcia. W Ustawieniach możesz odłączyć dostawcę, o ile konto zachowa inną drogę wejścia: hasło albo innego dostawcę. Konto, które logowało się dotąd tylko przez dostawcę, może tam ustawić hasło.'
			]
		},
		{
			key: 'mail',
			heading: 'E-mail i hasło',
			body: [
				'Poczta przychodzi z no-reply@edmat.net i tylko w tych sprawach: potwierdzenie adresu, reset hasła, podsumowanie powiadomień, jeśli je włączysz, i informacje o twoim koncie albo zmianach regulaminu. Żadnego marketingu. Link potwierdzający jest ważny tydzień; nowy można wysłać z Ustawień.',
				'„Nie pamiętasz hasła?” na stronie logowania wysyła link do zmiany hasła. Strona odpowiada tak samo bez względu na to, czy konto z tym adresem istnieje, więc nie da się w ten sposób sprawdzić, kto jest zarejestrowany. Ustawienie nowego hasła wylogowuje ze wszystkich urządzeń i przy okazji potwierdza adres, bo link otwarto z tej skrzynki.',
				'Podsumowanie jest wyłączone, dopóki go nie włączysz: najwyżej raz na godzinę wysyła nieprzeczytane powiadomienia — i tylko na potwierdzony adres. Karta Hasło w Ustawieniach zmienia hasło (pyta o obecne) albo ustawia je kontu, które go nie ma.'
			]
		},
		{
			key: 'export',
			heading: 'Pobierz swoje dane',
			body: [
				'W Ustawieniach → Twoje dane i twoje konto przycisk „Pobierz moje dane” daje jeden plik JSON ze wszystkim, co EdMat o tobie przechowuje: profil i ustawienia, to, co napisano i opublikowano, prywatne wiadomości w odszyfrowanej postaci, rezerwacje, zapisy, zestawy i fiszki, powiadomienia, zaakceptowany regulamin, podłączonych dostawców logowania (nigdy ich tokeny) i ostatnie 90 dni zapisu twoich żądań na serwerze. Każde pole jest opisane w samym pliku. Inne osoby występują w nim tylko pod nazwą, którą serwis ci pokazywał.',
				'Plik można pobrać trzy razy dziennie. Przesłane pliki są w nim wymienione z linkami, a nie spakowane do środka.'
			]
		},
		{
			key: 'deletion',
			heading: 'Usuń konto',
			body: [
				'„Usuń moje konto” prosi o wpisanie nazwy użytkownika i hasła, a wcześniej pokazuje dokładnie, co się stanie, policzone na twoich danych. Konto zostaje od razu wyłączone — wylogowanie ze wszystkich urządzeń, ukryty profil — i skasowane po 14 dniach. Do tego czasu logowanie (albo link z e-maila, jeśli adres jest potwierdzony) anuluje usunięcie.',
				'Jeśli wciąż prowadzisz kurs, wydarzenie, konkurs, organizację albo projekt, w którym są inne osoby, najpierw trzeba je przekazać albo zamknąć — strona wymienia, które. Dziecko nie może samo usunąć swojego konta; robi to opiekun w swoich Ustawieniach, w ten sam sposób.',
				'Skasowane konto zostaje pustym rekordem z numerem zamiast nazwy, a przy wszystkim, co zostaje, widnieje „Usunięte konto”. Polityka prywatności wymienia dokładnie, co znika, a co zostaje.'
			],
			facts: [
				{
					term: 'Usuwane',
					detail:
						'To, co prywatne: profil, ustawienia, metody logowania, historia, powiadomienia, zestawy i fiszki, role, wersje robocze.'
				},
				{
					term: 'Zostaje, bez twojego imienia',
					detail:
						'To, co opublikowano na licencji Creative Commons, oraz komentarze, recenzje i wpisy. Licencji nie da się cofnąć; inni mogą już z niej korzystać.'
				},
				{
					term: 'Twój wybór',
					detail:
						'To, co opublikowano jako „Tylko EdMat” (albo bez zadeklarowanej licencji): zostawić jako „Usunięte konto” albo usunąć — ukryć przed wszystkimi, przy czym komentarze i linki zostają. Rzeczy z cudzą pracą w środku zostają w obu przypadkach.'
				},
				{
					term: 'Zostaje jako zapis',
					detail:
						'To, na czym polegają inni: decyzja moderacyjna, głos policzony w wyniku, ocena jury, rezerwacja drugiej strony, rozmowa, która jest też ich.'
				},
				{
					term: 'Kończone',
					detail:
						'To, co wciąż trwa z kimś po drugiej stronie — przyszła rezerwacja, miejsce na nadchodzącym wydarzeniu, zapis na kurs — zostaje anulowane, a druga strona dostaje informację.'
				}
			],
			sample: {
				caption:
					'Jedno wymyślone usunięcie konta jako oś czasu: co dzieje się w dniu prośby, czternaście dni, w których da się je jeszcze cofnąć, i dzień, w którym staje się ostateczne.',
				title: 'Usuwanie konta',
				rows: [
					{
						label: 'Dzień 0',
						title: 'Prośba o usunięcie: wylogowanie wszędzie, ukryty profil',
						note: 'wyłączone'
					},
					{
						label: 'Dni 1–13',
						title: 'Zalogowanie albo link z e-maila anuluje usunięcie',
						note: 'do cofnięcia'
					},
					{
						label: 'Dzień 14',
						title: 'Skasowane: konto staje się „Usuniętym kontem”',
						note: 'ostateczne'
					}
				]
			}
		},
		{
			key: 'not-yet',
			heading: 'Czego jeszcze nie ma',
			body: ['Mówimy wprost, żeby nikt nie musiał się o tym przekonać na własnej skórze:'],
			facts: [
				{
					term: 'Nowy regulamin',
					detail:
						'Gdy regulamin się zmienia, nic jeszcze nie prosi o zaakceptowanie nowej wersji; serwis wie, którą wersję zaakceptowano, więc da się to zbudować.'
				},
				{
					term: 'Twoje pliki',
					detail: 'Pobrane dane zawierają linki do przesłanych plików, a nie archiwum ZIP z nimi.'
				},
				{
					term: 'Dostawcy',
					detail:
						'Wywołania Facebooka po odłączeniu aplikacji i prośbie o usunięcie danych ani powiadomienia serwerowe Apple nie są zbudowane. Usunięcie EdMatu z aplikacji podłączonych do konta Facebook, Google, Apple albo GitHub wyłącza to logowanie, ale nie usuwa konta w EdMacie — to robi się w Ustawieniach.'
				},
				{
					term: 'Hasła',
					detail:
						'Konto logujące się tylko przez dostawcę musi ustawić hasło, zanim da się je usunąć. Opiekun nie może zresetować hasła dziecka e-mailem, bo konto dziecka nie ma adresu.'
				},
				{
					term: 'Twój adres',
					detail: 'Nie da się jeszcze zmienić adresu e-mail przypisanego do konta.'
				},
				{
					term: 'Usunięcie jednej rzeczy',
					detail:
						'O zdjęcie jednej rzeczy na otwartej licencji prosi się, pisząc do nas, a nie przyciskiem.'
				}
			]
		}
	],
	closing:
		'Kto odpowiada za twoje dane, na jakiej podstawie są przetwarzane i gdzie złożyć skargę, mówi polityka prywatności; sama umowa, łącznie z tym, jak ją zakończyć, jest w regulaminie. Ta strona opisuje to samo i nie zastępuje żadnego z tych dokumentów.'
};

export function accountShowcaseFor(locale: string): ShowcaseModuleDoc {
	return locale === 'pl' ? PL : EN;
}
