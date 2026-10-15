/**
 * `/about/licences-and-data` — the licence every piece of content carries, and what EdMat counts
 * about the people who use it.
 *
 * Written 2026-10-15 (WP6). **The licence half carries an owner decision, verbatim: "as for license
 * cc-by"** — EdMat suggests CC BY 4.0 for work that is plainly the author's own, which is exactly
 * what the forms already pre-select (`components/shared/LicencePicker.svelte`, HISTORY §17CL): an
 * exercise that names no source, and a material written in the editor from scratch. The server's
 * default stays "EdMat only" (`backend/licensing/licences.py: DEFAULT_LICENCE`) — a suggestion is
 * the form's, never the server's — and this page says both. `/about/materials` lists the same
 * options without recommending one; this is the page that says which one EdMat suggests and why.
 *
 * Every licence claim was checked against `backend/licensing/` (registry, `at_least_as_open`,
 * `change_block_reason`) and `/terms` § 9 (`content/terms.ts`); every data claim against
 * `ANALYTICS-LAW.md`, `backend/analytics/CLAUDE.md` and `/privacy` ("Usage statistics", "Error
 * reports", "What is stored on your device"). Where those documents say it in full, the "Try it"
 * row links them rather than this page paraphrasing loosely. **No analytics picture**, on purpose:
 * the dashboard is staff-only and shows real counts.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseModuleDoc } from './index';

const EN: ShowcaseModuleDoc = {
	title: 'Licences, and what EdMat counts',
	description:
		'Which licence your work on EdMat carries and why CC BY 4.0 is suggested for your own work, what “rights not yet clarified” means for the seeded corpus, and the statistics EdMat keeps without putting anything in your browser.',
	lead: [
		'Two questions people ask about any site that holds their work: what may others do with what I write here, and what does the site record about me while I do it? This page answers both, briefly, and links the terms of use and the privacy policy for the full text.',
		'Short version: you keep the copyright and choose a licence for each thing you publish — for your own work EdMat suggests CC BY 4.0. And the site counts how it is used from its own server records, in totals, with nothing placed in your browser for it, which is why there is no cookie banner.'
	],
	points: [
		{
			heading: 'Suggested for your own work: CC BY 4.0',
			body: 'Anyone may reuse it, as long as they name you. The form pre-selects it when what you are publishing is plainly yours; you can always choose something else.'
		},
		{
			heading: 'A licence only ever opens up',
			body: 'You can change your item’s licence to a more open one at any time, never to a narrower one, because copies people already took keep the licence they were taken under.'
		},
		{
			heading: 'Statistics without your browser',
			body: 'Counts are made on the server from requests your browser sends anyway. No cookie, no tracking script, no visitor id — and fewer than ten people are never shown as a number.'
		}
	],
	tryIt: [
		{ label: 'Submit an exercise', route: '/submit' },
		{ label: 'Add a material', route: '/submit-material' },
		{ label: 'Terms of use, § 9', route: '/terms' },
		{ label: 'Privacy policy', route: '/privacy' }
	],
	// Screenshots of the running site (`e2e/showcase-screens.mjs`), each looked at before it was used.
	shots: [
		{
			src: '/showcase/licences-and-data/01-picker.png',
			focus: [320, 960],
			width: 1280,
			height: 862,
			route: '/submit',
			linkLabel: 'Open the exercise form',
			alt: 'Screenshot of the Licence box on the exercise form. It says “Who else may reuse what you publish here? You keep the copyright either way. You can make the licence more open later, but never narrower.” and “Suggested: CC BY 4.0, because this is your own work, written here. Others may build on it as long as they name you. You can choose differently.” Six options follow, each with a one-line summary and links to what it means and its legal code: CC0 1.0, CC BY 4.0 (selected, tagged “Suggested”), CC BY-SA 4.0, CC BY-NC 4.0, CC BY-NC-SA 4.0 and EdMat only.',
			caption:
				'The licence picker on a new exercise that names no source: CC BY 4.0 is selected and tagged “Suggested”, with the reason above it. Naming a source switches it back to “EdMat only”.'
		},
		{
			src: '/showcase/licences-and-data/02-cc-by.png',
			focus: [250, 1030],
			width: 1280,
			height: 215,
			route: '/disciplines',
			linkLabel: 'Browse exercises',
			alt: 'Screenshot of an exercise statement, “Compute 1 + 1.”, with a line under it: “© Ola Nowak · Licensed under CC BY 4.0 since Wednesday, October 14, 2026 — Anyone may copy, change and use it for any purpose, even commercially, as long as they name you.”',
			caption:
				'The licence line under a statement published under CC BY 4.0: who holds the copyright, the licence, since when, and what it allows in one sentence. (A test exercise on the development copy of the site.)'
		},
		{
			src: '/showcase/licences-and-data/03-corpus.png',
			focus: [250, 1030],
			width: 1280,
			height: 194,
			route: '/disciplines',
			linkLabel: 'Browse exercises',
			alt: 'Screenshot of a statement from the seeded corpus, “Oblicz” followed by the integral of e to the minus x squared from minus to plus infinity, with the line “Rights not yet clarified — shown here for study only. Do not copy it elsewhere.”',
			caption:
				'An exercise from the seeded corpus: its rights are not yet clarified, so it is shown for study only and carries no licence at all.'
		}
	],
	sections: [
		{
			key: 'suggested',
			heading: 'What EdMat suggests: CC BY 4.0',
			body: [
				'You keep the copyright in what you create, whatever you choose. The licence says what everybody else may do with it. For work that is plainly your own, EdMat suggests Creative Commons Attribution 4.0 — CC BY 4.0.',
				'CC BY lets anyone copy your work, share it, change it, translate it and build on it, for any purpose, even commercially — as long as they name you as the author, link the licence and say if they changed something. That is all it asks. A teacher can print your exercise for a class, another student can write a better solution on top of it, a site somewhere else can carry it, and your name goes with it every time. It is a common choice for open educational material, and it cannot be withdrawn once given, which is what lets people rely on it.',
				'The form suggests it in two places: on a new exercise that names no source (source type “other”, no source name), and on a material version written in the editor with no source address. There the picker pre-selects CC BY 4.0, tags it “Suggested” and says why. Name a source and it moves back to “EdMat only”, with a note that the work may be somebody else’s; once you pick a licence yourself, the form never moves it again. What is selected when you publish is your choice, not the site’s: if nothing else is chosen, the server applies “EdMat only”.'
			]
		},
		{
			key: 'options',
			heading: 'The other options',
			body: [
				'Every exercise, solution, hint, material and concept article carries one of these, shown in a line under it. Comments, reviews, posts and messages carry no licence of their own; § 9 of the terms covers them.'
			],
			facts: [
				{
					term: 'CC0 1.0',
					detail:
						'Public domain dedication: anyone may copy, change and use it for any purpose, even commercially, without having to name you.'
				},
				{
					term: 'CC BY-SA 4.0',
					detail:
						'Anyone may copy, change and use it for any purpose, as long as they name you and share their changes under the same licence.'
				},
				{
					term: 'CC BY-NC 4.0',
					detail:
						'Anyone may copy and change it for non-commercial purposes, as long as they name you.'
				},
				{
					term: 'CC BY-NC-SA 4.0',
					detail:
						'Anyone may copy and change it for non-commercial purposes, as long as they name you and share their changes under the same licence.'
				},
				{
					term: 'EdMat only',
					detail:
						'You keep all rights. EdMat may only host, show, translate for display and archive it, as § 9 of the terms says; nobody else may reuse it without asking you. This is what applies whenever nothing else is chosen.'
				}
			]
		},
		{
			key: 'only-wider',
			heading: 'Only ever more open',
			body: [
				'You can change the licence of your own item at any time — from “EdMat only” to CC BY 4.0, say, or from CC BY-SA 4.0 to CC BY 4.0 — but never to a narrower one. A Creative Commons licence, once granted, cannot be withdrawn: anybody who took a copy keeps the licence it carried then, so a label that moved backwards would describe a limit the work no longer has. CC BY-NC and CC BY-SA each forbid something the other allows, so neither can become the other.',
				'Every change is recorded, and the line under the item says since when its licence applies. Once somebody else’s version or revision is part of an item, it cannot be relicensed without them. A translation carries the licence of the exercise it translates, as it stood when the translation was written; a solution is its author’s own work and carries its own.'
			],
			sample: {
				caption:
					'One invented exercise’s licence history, newest first: published under “EdMat only”, opened to CC BY-SA 4.0 a week later, then to CC BY 4.0. Each step is more open than the last; a step back would be refused and would leave no row.',
				title: 'Licence history',
				rows: [
					{ label: '20 Nov', title: 'CC BY-SA 4.0 → CC BY 4.0', note: 'current' },
					{ label: '12 Nov', title: 'EdMat only → CC BY-SA 4.0', note: 'changed' },
					{ label: '5 Nov', title: 'Published under EdMat only', note: 'first grant' }
				]
			}
		},
		{
			key: 'corpus',
			heading: 'The seeded corpus: rights not yet clarified',
			body: [
				'The exercises EdMat started from — around 740, collected from University of Warsaw mathematics and computer-science courses — with their hints and solutions, and the course materials that came with them, carry a different mark: “Rights not yet clarified — shown here for study only. Do not copy it elsewhere.” Nobody has yet established who holds the rights to them, so neither EdMat nor anybody else grants a licence on them. You cannot choose this mark for your own work; only the site’s staff set it.',
				'If you hold the rights to one of these items, tell us — the terms of use say how — and it will be marked with the licence you grant, or removed.'
			]
		},
		{
			key: 'statistics',
			heading: 'What EdMat counts, and what it does not',
			body: [
				'To know what to improve, a nightly job on EdMat’s own server turns the request log — what every website receives simply by being asked for a page — into daily totals. Nothing is collected in your browser for this: no cookie, no local storage, no script that reports back, no visitor id. Because nothing is placed on or read from your device for statistics, Polish law (art. 399 of the Electronic Communications Law) asks no consent for it — and so there is no cookie banner, because there is nothing that needs one. What the site does keep in your browser (the sign-in token, the language you chose) is there for features you use, and the privacy policy lists every item.',
				'Only the site’s staff see the statistics. The privacy policy has the full list and how long each thing is kept.'
			],
			facts: [
				{
					term: 'Counted',
					detail:
						'Requests per kind of page, whether they worked and how fast; how often each content page was opened; the name of the site people came from; browser, system and device in coarse classes; how many searches; how many signed-in accounts were active, and how many stay active week after week.'
				},
				{
					term: 'Never counted',
					detail:
						'Your IP address, your account, your browser string, full addresses, or what you searched for. A visitor who is not signed in is never counted as a person, only as requests.'
				},
				{
					term: 'Small numbers',
					detail: 'Any count of people under 10 is shown as “fewer than 10”, never as a number.'
				},
				{
					term: 'Left out',
					detail:
						'Accounts of under-16s are never in the counts of people, and staff accounts are not counted as people either. Automated traffic is counted separately.'
				},
				{
					term: 'Your signal',
					detail:
						'If your browser sends “Global Privacy Control” or “Do Not Track”, every request that carries it is left out of the statistics entirely. It is still logged for security, because that purpose remains.'
				},
				{
					term: 'Kept',
					detail: 'The daily totals hold no personal data and are kept for up to 25 months.'
				}
			]
		},
		{
			key: 'error-reports',
			heading: 'When something breaks in your browser',
			body: [
				'If a page fails or a button throws an error, your browser sends EdMat a short technical report so the fault can be found: the error message, where in EdMat’s own code it happened (file paths only), which kind of page you were on — “an exercise page”, never which exercise — and the app version. Your browser family is worked out on the server and the browser string thrown away.',
				'The report carries no account, no identifier and no page address, and nothing is stored on your device for it — no cookie, no storage. At most five are sent from one page, only when something actually goes wrong, and none at all if your browser sends “Global Privacy Control” or “Do Not Track”. Single reports are kept 30 days, their counts 90. It has its own switch, so it can be turned off without touching anything else.'
			]
		},
		{
			key: 'not-yet',
			heading: 'Not built yet',
			body: ['Said plainly, so that nobody has to find it out by tripping over it:'],
			facts: [
				{
					term: 'Suggestions',
					detail:
						'The suggestion appears only where the form can tell the work is yours. The solution and hint composer has no source field, so it suggests nothing, and neither does the concept-article editor; the material form cannot tell a file you wrote from somebody else’s.'
				},
				{
					term: 'No licence yet',
					detail:
						'Flashcard decks, photo albums, sketches and chemistry drawings carry no licence. A deck’s cards are copies of exercises whose licences differ, so one deck licence would misdescribe them.'
				},
				{
					term: 'Remixing',
					detail: 'Nothing checks whether two licences may be combined in one new piece of work.'
				},
				{
					term: 'Opting out',
					detail:
						'There is no switch in Settings to leave the statistics; the browser signal above does it automatically, or you can write to us.'
				}
			]
		}
	],
	closing:
		'None of this is legal advice, and it is not a substitute for the documents: the terms of use, § 9, are the licence agreement itself, and the privacy policy is the full account of what is processed, why and for how long. If this page and either of them ever disagree, they are right.'
};

const PL: ShowcaseModuleDoc = {
	title: 'Licencje i to, co EdMat liczy',
	description:
		'Jaką licencję ma twoja praca w EdMacie i dlaczego dla własnej pracy sugerujemy CC BY 4.0, co znaczy „prawa niewyjaśnione” przy bazie startowej i jakie statystyki EdMat prowadzi bez umieszczania czegokolwiek w twojej przeglądarce.',
	lead: [
		'Dwa pytania, które warto zadać każdemu serwisowi, który przechowuje twoją pracę: co inni mogą zrobić z tym, co tu piszę, i co serwis o mnie zapisuje, kiedy to robię? Ta strona odpowiada krótko na oba i odsyła do regulaminu i polityki prywatności po pełny tekst.',
		'W skrócie: prawa autorskie zostają przy tobie, a dla każdej publikowanej rzeczy wybierasz licencję — dla własnej pracy EdMat sugeruje CC BY 4.0. A to, jak serwis jest używany, liczymy z zapisów na własnym serwerze, w sumach, bez umieszczania czegokolwiek w twojej przeglądarce — i dlatego nie ma banera o ciasteczkach.'
	],
	points: [
		{
			heading: 'Dla własnej pracy sugerujemy CC BY 4.0',
			body: 'Każdy może z niej korzystać, o ile poda ciebie jako autora. Formularz zaznacza ją z góry, gdy to, co publikujesz, jest wyraźnie twoje; zawsze możesz wybrać coś innego.'
		},
		{
			heading: 'Licencja może się tylko otwierać',
			body: 'Licencję swojej rzeczy możesz w każdej chwili zmienić na bardziej otwartą, ale nigdy na węższą, bo kopie, które ktoś już pobrał, zachowują licencję z chwili pobrania.'
		},
		{
			heading: 'Statystyki bez twojej przeglądarki',
			body: 'Liczymy na serwerze, z żądań, które przeglądarka i tak wysyła. Żadnych ciasteczek, skryptów śledzących ani identyfikatora odwiedzającego — a mniej niż dziesięć osób nigdy nie jest pokazywane jako liczba.'
		}
	],
	tryIt: [
		{ label: 'Dodaj zadanie', route: '/submit' },
		{ label: 'Dodaj materiał', route: '/submit-material' },
		{ label: 'Regulamin, § 9', route: '/terms' },
		{ label: 'Polityka prywatności', route: '/privacy' }
	],
	shots: [
		{
			src: '/showcase/licences-and-data/01-picker.png',
			focus: [320, 960],
			width: 1280,
			height: 862,
			route: '/submit',
			linkLabel: 'Otwórz formularz zadania',
			alt: 'Zrzut ekranu pola Licence w formularzu zadania. Napis „Who else may reuse what you publish here? You keep the copyright either way. You can make the licence more open later, but never narrower.” i „Suggested: CC BY 4.0, because this is your own work, written here. Others may build on it as long as they name you. You can choose differently.” Dalej sześć opcji, każda z jednozdaniowym opisem i linkami do wyjaśnienia i tekstu prawnego: CC0 1.0, CC BY 4.0 (zaznaczona, z dopiskiem „Suggested”), CC BY-SA 4.0, CC BY-NC 4.0, CC BY-NC-SA 4.0 i EdMat only.',
			caption:
				'Wybór licencji przy nowym zadaniu bez podanego źródła: zaznaczona jest CC BY 4.0 z dopiskiem „Sugerowana” i uzasadnieniem nad listą. Podanie źródła przełącza z powrotem na „Tylko EdMat”.'
		},
		{
			src: '/showcase/licences-and-data/02-cc-by.png',
			focus: [250, 1030],
			width: 1280,
			height: 215,
			route: '/disciplines',
			linkLabel: 'Przeglądaj zadania',
			alt: 'Zrzut ekranu treści zadania „Compute 1 + 1.” z linią pod spodem: „© Ola Nowak · Licensed under CC BY 4.0 since Wednesday, October 14, 2026 — Anyone may copy, change and use it for any purpose, even commercially, as long as they name you.”',
			caption:
				'Linia z licencją pod treścią opublikowaną na CC BY 4.0: kto ma prawa autorskie, jaka licencja, od kiedy i co pozwala robić — w jednym zdaniu. (Zadanie testowe na roboczej kopii serwisu.)'
		},
		{
			src: '/showcase/licences-and-data/03-corpus.png',
			focus: [250, 1030],
			width: 1280,
			height: 194,
			route: '/disciplines',
			linkLabel: 'Przeglądaj zadania',
			alt: 'Zrzut ekranu treści zadania z bazy startowej, „Oblicz” i całka z e do minus x kwadrat od minus do plus nieskończoności, z linią „Rights not yet clarified — shown here for study only. Do not copy it elsewhere.”',
			caption:
				'Zadanie z bazy startowej: prawa nie są jeszcze wyjaśnione, więc jest pokazywane tylko do nauki i nie ma żadnej licencji.'
		}
	],
	sections: [
		{
			key: 'suggested',
			heading: 'Co sugeruje EdMat: CC BY 4.0',
			body: [
				'Prawa autorskie do tego, co tworzysz, zostają przy tobie, cokolwiek wybierzesz. Licencja mówi, co mogą z tym zrobić wszyscy inni. Dla pracy, która jest wyraźnie twoja, EdMat sugeruje licencję Creative Commons Uznanie autorstwa 4.0 — CC BY 4.0.',
				'CC BY pozwala każdemu kopiować twoją pracę, udostępniać ją, zmieniać, tłumaczyć i budować na niej, w dowolnym celu, także komercyjnym — pod warunkiem że poda ciebie jako autora, wskaże licencję i zaznaczy, jeśli coś zmienił. Nic więcej. Nauczycielka może wydrukować twoje zadanie dla klasy, ktoś inny może dopisać do niego lepsze rozwiązanie, inny serwis może je u siebie pokazać — a twój podpis idzie za nim za każdym razem. To częsty wybór przy otwartych materiałach edukacyjnych, a raz udzielonej licencji nie da się odwołać — i właśnie dlatego można na niej polegać.',
				'Formularz sugeruje ją w dwóch miejscach: przy nowym zadaniu bez podanego źródła (rodzaj źródła „inne”, bez nazwy źródła) i przy wersji materiału napisanej w edytorze bez adresu źródła. Wtedy wybór licencji ma z góry zaznaczoną CC BY 4.0, z dopiskiem „Sugerowana” i wyjaśnieniem dlaczego. Gdy podasz źródło, wybór wraca na „Tylko EdMat” z uwagą, że to może być cudza praca; gdy raz samodzielnie wskażesz licencję, formularz już jej nie przestawi. Licencja zaznaczona w chwili publikacji to twój wybór, nie serwisu: jeśli nic innego nie wybrano, serwer stosuje „Tylko EdMat”.'
			]
		},
		{
			key: 'options',
			heading: 'Pozostałe możliwości',
			body: [
				'Każde zadanie, rozwiązanie, wskazówka, materiał i artykuł o pojęciu ma jedną z nich, pokazaną w linii pod spodem. Komentarze, recenzje, wpisy i wiadomości nie mają własnej licencji; obejmuje je § 9 regulaminu.'
			],
			facts: [
				{
					term: 'CC0 1.0',
					detail:
						'Przekazanie do domeny publicznej: każdy może kopiować, zmieniać i wykorzystywać w dowolnym celu, także komercyjnie, bez podawania autora.'
				},
				{
					term: 'CC BY-SA 4.0',
					detail:
						'Każdy może kopiować, zmieniać i wykorzystywać w dowolnym celu, o ile poda autora i udostępni swoje zmiany na tej samej licencji.'
				},
				{
					term: 'CC BY-NC 4.0',
					detail: 'Każdy może kopiować i zmieniać w celach niekomercyjnych, o ile poda autora.'
				},
				{
					term: 'CC BY-NC-SA 4.0',
					detail:
						'Każdy może kopiować i zmieniać w celach niekomercyjnych, o ile poda autora i udostępni swoje zmiany na tej samej licencji.'
				},
				{
					term: 'Tylko EdMat',
					detail:
						'Zachowujesz wszystkie prawa. EdMat może utwór jedynie przechowywać, wyświetlać, tłumaczyć na potrzeby wyświetlania i archiwizować, zgodnie z § 9 regulaminu; nikt inny nie może go wykorzystać bez twojej zgody. Obowiązuje zawsze, gdy nie wybrano innej licencji.'
				}
			]
		},
		{
			key: 'only-wider',
			heading: 'Tylko w stronę większej otwartości',
			body: [
				'Licencję własnej rzeczy możesz zmienić w każdej chwili — na przykład z „Tylko EdMat” na CC BY 4.0 albo z CC BY-SA 4.0 na CC BY 4.0 — ale nigdy na węższą. Udzielonej licencji Creative Commons nie można odwołać: kto pobrał kopię, zachowuje licencję, na której ją pobrał, więc oznaczenie cofnięte wstecz opisywałoby ograniczenie, którego praca już nie ma. CC BY-NC i CC BY-SA zabraniają czegoś, na co druga pozwala, więc żadna nie może stać się drugą.',
				'Każda zmiana jest zapisywana, a linia pod rzeczą mówi, od kiedy obowiązuje jej licencja. Gdy w rzeczy jest już cudza wersja albo poprawka, nie można jej przelicencjonować bez tej osoby. Tłumaczenie ma licencję tłumaczonego zadania z chwili, gdy je napisano; rozwiązanie jest samodzielną pracą autora i ma własną.'
			],
			sample: {
				caption:
					'Wymyślona historia licencji jednego zadania, od najnowszego: opublikowane jako „Tylko EdMat”, tydzień później otwarte na CC BY-SA 4.0, potem na CC BY 4.0. Każdy krok jest bardziej otwarty od poprzedniego; krok wstecz zostałby odrzucony i nie zostawiłby żadnego wpisu.',
				title: 'Historia licencji',
				rows: [
					{ label: '20 lis', title: 'CC BY-SA 4.0 → CC BY 4.0', note: 'obowiązuje' },
					{ label: '12 lis', title: 'Tylko EdMat → CC BY-SA 4.0', note: 'zmiana' },
					{ label: '5 lis', title: 'Publikacja jako Tylko EdMat', note: 'pierwsza licencja' }
				]
			}
		},
		{
			key: 'corpus',
			heading: 'Baza startowa: prawa niewyjaśnione',
			body: [
				'Zadania, od których EdMat zaczął — około 740, zebranych z zajęć z matematyki i informatyki na Uniwersytecie Warszawskim — razem ze wskazówkami i rozwiązaniami oraz materiałami z tych zajęć, mają inne oznaczenie: „Prawa autorskie jeszcze niewyjaśnione — pokazujemy to wyłącznie do nauki. Nie kopiuj tego gdzie indziej.” Nikt jeszcze nie ustalił, do kogo należą do nich prawa, więc ani EdMat, ani nikt inny nie udziela na nie licencji. Tego oznaczenia nie można wybrać dla własnej pracy; ustawia je tylko zespół serwisu.',
				'Jeśli masz prawa do którejś z tych rzeczy, daj nam znać — regulamin mówi, jak — a oznaczymy ją licencją, której udzielisz, albo ją usuniemy.'
			]
		},
		{
			key: 'statistics',
			heading: 'Co EdMat liczy, a czego nie',
			body: [
				'Żeby wiedzieć, co poprawić, nocne zadanie na własnym serwerze EdMatu zamienia dziennik żądań — to, co każda strona dostaje po prostu dlatego, że ktoś o nią poprosił — w dzienne sumy. Nic nie jest w tym celu zbierane w twojej przeglądarce: żadnych ciasteczek, pamięci lokalnej, skryptu, który coś odsyła, ani identyfikatora odwiedzającego. Ponieważ na potrzeby statystyk nic nie jest zapisywane na twoim urządzeniu ani z niego odczytywane, polskie prawo (art. 399 Prawa komunikacji elektronicznej) nie wymaga na to zgody — i dlatego nie ma banera o ciasteczkach: nie ma niczego, co by go wymagało. To, co serwis jednak trzyma w przeglądarce (token logowania, wybrany język), służy funkcjom, z których korzystasz, a polityka prywatności wymienia każdą taką rzecz.',
				'Statystyki widzi tylko zespół serwisu. Pełna lista i to, jak długo co jest przechowywane, są w polityce prywatności.'
			],
			facts: [
				{
					term: 'Liczone',
					detail:
						'Żądania według rodzaju strony, czy się udały i jak szybko; jak często otwierano każdą stronę z treścią; nazwa strony, z której ktoś przyszedł; przeglądarka, system i urządzenie w ogólnych klasach; liczba wyszukiwań; ile zalogowanych kont było aktywnych i ile zostaje aktywnych tydzień po tygodniu.'
				},
				{
					term: 'Nigdy nieliczone',
					detail:
						'Twój adres IP, twoje konto, pełny opis przeglądarki, pełne adresy ani to, czego szukano. Osoba niezalogowana nigdy nie jest liczona jako osoba, tylko jako żądania.'
				},
				{
					term: 'Małe liczby',
					detail:
						'Każda liczba osób mniejsza niż 10 jest pokazywana jako „mniej niż 10”, nigdy jako liczba.'
				},
				{
					term: 'Pomijane',
					detail:
						'Konta osób poniżej 16 lat nigdy nie wchodzą do liczb osób, a konta zespołu też nie są liczone jako osoby. Ruch automatyczny jest liczony osobno.'
				},
				{
					term: 'Twój sygnał',
					detail:
						'Jeśli przeglądarka wysyła „Global Privacy Control” albo „Do Not Track”, każde żądanie z tym sygnałem jest całkowicie pomijane w statystykach. Nadal trafia do dziennika bezpieczeństwa, bo ten cel pozostaje.'
				},
				{
					term: 'Przechowywane',
					detail: 'Dzienne sumy nie zawierają danych osobowych i są przechowywane do 25 miesięcy.'
				}
			]
		},
		{
			key: 'error-reports',
			heading: 'Kiedy coś się psuje w przeglądarce',
			body: [
				'Jeśli strona nie działa albo przycisk zgłasza błąd, przeglądarka wysyła do EdMatu krótki raport techniczny, żeby dało się znaleźć usterkę: komunikat błędu, miejsce w kodzie EdMatu, gdzie wystąpił (tylko ścieżki plików), rodzaj strony — „strona zadania”, nigdy które zadanie — i wersję aplikacji. Rodzinę przeglądarki ustala serwer, a pełny opis przeglądarki odrzuca.',
				'Raport nie zawiera konta, identyfikatora ani adresu strony, a na twoim urządzeniu nic się w tym celu nie zapisuje — żadnych ciasteczek ani pamięci. Z jednej strony wychodzi najwyżej pięć raportów i tylko wtedy, gdy coś naprawdę się zepsuje, a żaden, jeśli przeglądarka wysyła „Global Privacy Control” albo „Do Not Track”. Pojedyncze raporty są przechowywane 30 dni, ich liczby 90. Raporty mają własny wyłącznik, więc można je wyłączyć, nie ruszając niczego innego.'
			]
		},
		{
			key: 'not-yet',
			heading: 'Czego jeszcze nie ma',
			body: ['Mówimy wprost, żeby nikt nie musiał się o tym przekonać na własnej skórze:'],
			facts: [
				{
					term: 'Sugestie',
					detail:
						'Sugestia pojawia się tylko tam, gdzie formularz może poznać, że praca jest twoja. Edytor rozwiązań i wskazówek nie ma pola źródła, więc niczego nie sugeruje, podobnie jak edytor artykułów o pojęciach; formularz materiału nie odróżni pliku, który napisano samodzielnie, od cudzego.'
				},
				{
					term: 'Jeszcze bez licencji',
					detail:
						'Talie fiszek, albumy zdjęć, szkice i rysunki chemiczne nie mają licencji. Fiszki w talii to kopie zadań o różnych licencjach, więc jedna licencja talii źle by je opisywała.'
				},
				{
					term: 'Łączenie',
					detail: 'Nic nie sprawdza, czy dwie licencje można połączyć w jednej nowej pracy.'
				},
				{
					term: 'Rezygnacja',
					detail:
						'W Ustawieniach nie ma przełącznika, który wyłącza cię ze statystyk; robi to automatycznie sygnał przeglądarki opisany wyżej, albo możesz do nas napisać.'
				}
			]
		}
	],
	closing:
		'Nic z tego nie jest poradą prawną i nie zastępuje dokumentów: § 9 regulaminu to sama umowa licencyjna, a polityka prywatności to pełny opis tego, co jest przetwarzane, po co i jak długo. Gdyby ta strona i któryś z nich kiedyś się różniły, rację mają one.'
};

export function licencesAndDataShowcaseFor(locale: string): ShowcaseModuleDoc {
	return locale === 'pl' ? PL : EN;
}
