/**
 * `/about/materials` — a material, the team that publishes it version by version, the files
 * attached to the work around it, and the licence each thing carries.
 *
 * Written 2026-10-14 against `backend/{materials,coauthoring,materials_coop,attachments,licensing}/`
 * and their CLAUDE.md files. **The licence section states facts about the feature and nothing
 * else** — which licences exist, which is the default, which way a change may go — and recommends
 * none of them, by the owner's instruction for this page. It is not legal advice and does not
 * pretend to be.
 *
 * Two honesty notes the screenshots themselves make: the seeded corpus material carries the
 * "Rights not yet clarified" line (`licensing/licences.py: UNKNOWN`), and its file says "not
 * scanned — no scanner was available", which is the development machine telling the truth (house
 * rule 10). The project screenshot starts below the current-version card on purpose: the material
 * page already shows it, and the seeded file keeps its uploader's original filename.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseModuleDoc } from './index';

const EN: ShowcaseModuleDoc = {
	title: 'Materials, co-authored',
	description:
		'How teaching materials work on EdMat: a file, a link or a text with the topics it covers, a team that publishes it one accepted version at a time, attachments on the work around it, and the licence every item carries.',
	lead: [
		'A material is anything you teach or learn from that is not a single exercise: lecture notes, a course script, past papers, a formula sheet. It is a file, a link or a text written on the site, filed under a subject, and it says which topics it covers and which it assumes you already know.',
		'Every material has a team behind it, even if the team is one person. A change is a new version that somebody on the team accepted, and the history of versions stays readable.'
	],
	points: [
		{
			heading: 'Uploads are rebuilt, not stored as sent',
			body: 'Pictures are decoded and re-encoded, so nothing hidden in the original file survives. A PDF is checked against what it claims to be, size-capped, and scanned for viruses where a scanner is installed — and where none is, the page says “not scanned” rather than “clean”.'
		},
		{
			heading: 'A version is accepted, not just saved',
			body: 'Anybody can propose a change to a material; the team decides. A material’s first publication goes past a moderator first.'
		},
		{
			heading: 'Every item says what you may do with it',
			body: 'Exercises, solutions, materials and concept articles each carry a licence, shown on the page. It can be changed only towards more open, and every change is recorded.'
		}
	],
	tryIt: [
		{ label: 'Browse materials', route: '/materials' },
		{ label: 'Projects looking for co-authors', route: '/material-projects' }
	],
	// Screenshots of the running site (`e2e/showcase-screens.mjs`), each looked at before it was used.
	shots: [
		{
			src: '/showcase/materials/01-material.png',
			focus: [260, 1020],
			width: 1280,
			height: 974,
			route: '/materials',
			linkLabel: 'Browse materials',
			alt: 'Screenshot of the material “Analiza Matematyczna II – skrypt”, a course script for university level: a Download button, the topics it covers (multivariable derivatives, norms, limits and continuity, and 28 more), what it requires (Stokes’ theorem), a Preview box with “Show preview”, the line “Rights not yet clarified — shown here for study only. Do not copy it elsewhere.”, and a Cooperation card showing version 1, its owner, and counts of co-authors, versions and comments.',
			caption:
				'A material from the seeded corpus: what it covers and requires, a preview on request, its licence line — this one’s rights are not yet clarified — and the team behind it.'
		},
		{
			src: '/showcase/materials/02-project.png',
			focus: [260, 1020],
			width: 1280,
			height: 894,
			route: '/material-projects',
			linkLabel: 'See projects looking for co-authors',
			alt: 'Screenshot of the same material’s project page as its owner sees it: “Save a new version”, a Versions list with version 1 marked Published, an “About the material” box with its type and author, a Co-authors box listing the owner and a field to add somebody by account id, and Invite links with a label, a maximum number of uses, an expiry date and “Create a link”.',
			caption:
				'The team’s side: the versions, the people on it, and invite links that can be limited by uses and by date.'
		}
	],
	sections: [
		{
			key: 'material',
			heading: 'What a material carries',
			body: [
				'A material has a type, a level, a subject, an author and a source, and either a file — PDF, an image, LaTeX source or a word-processor document, up to 25 MB — a link, or a text written on the site. A hosted PDF can be previewed in the page, loaded only when you ask for it.',
				'Under it sit claims about what it covers and what it requires, each a topic at a depth. Anybody signed in can add one; others vote on whether it is accurate and how much it matters, and each claim has its own discussion. Readers can also rate the material and talk under it.'
			]
		},
		{
			key: 'coauthoring',
			heading: 'Writing it together',
			body: [
				'A material is published through a project: an owner, co-authors, and a list of versions. Editing is turn by turn — saving on top of a version somebody else has already replaced is refused, so nobody overwrites anybody by accident. People outside the team can propose a version; the team accepts it, which publishes it and retires the previous one, or turns it down, which keeps the record but not the file.',
				'People join a team through an invite link — which can be limited to a number of uses and an expiry date, and revoked — or by asking, with a short statement of what they want to do. A project can be open to proposals, open only on request, or closed. Under-16s can propose versions but never own a project.'
			],
			sample: {
				caption:
					'One material’s versions, invented for this page, newest first: a proposal from outside the team waiting for a decision, the published version, the one it replaced, and a proposal that was turned down — still listed, without its file.',
				rows: [
					{
						label: 'Version 4',
						title: 'Proposed by a reader: fixes in chapter 3',
						note: 'proposed'
					},
					{ label: 'Version 3', title: 'Week 8 added', note: 'published' },
					{ label: 'Version 2', title: 'First full draft', note: 'superseded' },
					{ label: 'Version 1', title: 'A rewrite nobody asked for', note: 'rejected' }
				]
			}
		},
		{
			key: 'attachments',
			heading: 'Attachments on the work around it',
			body: [
				'Files, short written notes and links can be attached to an organisation, a material, a contest, and to the rows of their boards — a task, a plan, a help-wanted post, a goal, a poll — as well as to comments. Each attachment says who may see it: everybody, members, the team, or only the people running it. An attachment can ask to be read, and then records who confirmed reading which version.',
				'Withdrawing one keeps its record rather than deleting it. Not offered yet: attachments on course and event pages, which still use their own older files and documents panels; replacing an attachment from the page (the server can, the page does not offer it); and choosing an existing drawing to attach.'
			]
		},
		{
			key: 'licences',
			heading: 'Licences',
			body: [
				'Every exercise, solution, material and concept article carries one of the licences below, and the page shows it in a line near the top. Unless the author picks something else, what is created on the site is “EdMat only” (all rights reserved); the author can change it, but only towards more open — never back — and every change is recorded with what it was before. A change is refused once other people’s versions are part of the item.',
				'For your own work — an exercise with no source, a material written here — EdMat suggests CC BY 4.0, and the form pre-selects it: others may build on it as long as they name you. The choice is still the author’s, and “Licences, and what EdMat counts” explains each option.'
			],
			facts: [
				{ term: 'CC0 1.0', detail: 'Public domain dedication.' },
				{ term: 'CC BY 4.0', detail: 'Creative Commons Attribution 4.0 International.' },
				{
					term: 'CC BY-SA 4.0',
					detail: 'Creative Commons Attribution-ShareAlike 4.0 International.'
				},
				{
					term: 'CC BY-NC 4.0',
					detail: 'Creative Commons Attribution-NonCommercial 4.0 International.'
				},
				{
					term: 'CC BY-NC-SA 4.0',
					detail: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.'
				},
				{
					term: 'EdMat only (all rights reserved)',
					detail:
						'The author keeps every right; EdMat may show it under its terms of use, § 9. What applies when nothing else is chosen.'
				},
				{
					term: 'Rights not yet clarified',
					detail: 'Set by staff, never chosen by a user: the seeded corpus, shown for study only.'
				}
			]
		}
	],
	closing:
		'No “no derivatives” licence is offered, because a translation is a derivative and translating content is one of the things this site exists to do.'
};

const PL: ShowcaseModuleDoc = {
	title: 'Materiały pisane wspólnie',
	description:
		'Jak działają materiały dydaktyczne w EdMacie: plik, link albo tekst z tematami, które omawia, zespół, który publikuje go po jednej zaakceptowanej wersji, załączniki do pracy wokół niego i licencja, którą ma każda rzecz.',
	lead: [
		'Materiał to wszystko, z czego się uczy albo czego się uczy, a co nie jest pojedynczym zadaniem: notatki z wykładu, skrypt, stare kolokwia, ściąga ze wzorami. To plik, link albo tekst napisany w serwisie, przypisany do przedmiotu, z informacją, które tematy omawia i co trzeba wiedzieć wcześniej.',
		'Za każdym materiałem stoi zespół, nawet jeśli to jedna osoba. Zmiana to nowa wersja, którą ktoś z zespołu zaakceptował, a historia wersji zostaje do przeczytania.'
	],
	points: [
		{
			heading: 'Przesłane pliki są odbudowywane, a nie zapisywane w oryginale',
			body: 'Obrazy są dekodowane i kodowane od nowa, więc nic ukrytego w oryginalnym pliku nie przetrwa. PDF jest sprawdzany, czy jest tym, za co się podaje, ma limit rozmiaru i jest skanowany antywirusem tam, gdzie skaner jest zainstalowany — a tam, gdzie go nie ma, strona pisze „nie przeskanowano”, a nie „czysty”.'
		},
		{
			heading: 'Wersję się akceptuje, a nie tylko zapisuje',
			body: 'Każdy może zaproponować zmianę w materiale; decyduje zespół. Pierwsza publikacja materiału przechodzi najpierw przez moderatora.'
		},
		{
			heading: 'Każda rzecz mówi, co wolno z nią zrobić',
			body: 'Zadania, rozwiązania, materiały i artykuły o pojęciach mają licencję, pokazaną na stronie. Można ją zmienić tylko na bardziej otwartą, a każda zmiana jest zapisywana.'
		}
	],
	tryIt: [
		{ label: 'Przejrzyj materiały', route: '/materials' },
		{ label: 'Projekty szukające współautorów', route: '/material-projects' }
	],
	shots: [
		{
			src: '/showcase/materials/01-material.png',
			focus: [260, 1020],
			width: 1280,
			height: 974,
			route: '/materials',
			linkLabel: 'Przejrzyj materiały',
			alt: 'Zrzut ekranu materiału „Analiza Matematyczna II – skrypt”, skryptu na poziomie uniwersyteckim: przycisk Download, tematy, które omawia (pochodna funkcji wielu zmiennych, normy, granice i ciągłość i 28 innych), czego wymaga (twierdzenie Stokesa), ramka Preview z przyciskiem „Show preview”, linia „Rights not yet clarified — shown here for study only. Do not copy it elsewhere.” i karta Cooperation z wersją 1, właścicielką oraz liczbą współautorów, wersji i komentarzy.',
			caption:
				'Materiał z bazy startowej: co omawia i czego wymaga, podgląd na życzenie, linia z licencją — w tym przypadku prawa nie są jeszcze wyjaśnione — i zespół, który za nim stoi.'
		},
		{
			src: '/showcase/materials/02-project.png',
			focus: [260, 1020],
			width: 1280,
			height: 894,
			route: '/material-projects',
			linkLabel: 'Zobacz projekty szukające współautorów',
			alt: 'Zrzut ekranu strony projektu tego samego materiału, tak jak widzi ją właścicielka: „Save a new version”, lista Versions z wersją 1 oznaczoną Published, ramka „About the material” z typem i autorem, ramka Co-authors z właścicielką i polem do dodania kogoś po numerze konta oraz Invite links z etykietą, maksymalną liczbą użyć, datą ważności i przyciskiem „Create a link”.',
			caption:
				'Strona zespołu: wersje, ludzie w zespole i linki z zaproszeniem, które można ograniczyć liczbą użyć i datą.'
		}
	],
	sections: [
		{
			key: 'material',
			heading: 'Co niesie materiał',
			body: [
				'Materiał ma typ, poziom, przedmiot, autora i źródło, a do tego plik — PDF, obraz, źródło LaTeX-a albo dokument edytora tekstu, do 25 MB — link albo tekst napisany w serwisie. PDF trzymany w serwisie można obejrzeć na stronie; podgląd ładuje się dopiero, gdy o niego poprosisz.',
				'Pod materiałem są deklaracje, co omawia i czego wymaga — każda to temat na określonym poziomie. Każda zalogowana osoba może dodać deklarację; inni głosują, czy jest trafna i jak bardzo ważna, a każda deklaracja ma własną dyskusję. Materiał można też ocenić i o nim porozmawiać.'
			]
		},
		{
			key: 'coauthoring',
			heading: 'Pisanie razem',
			body: [
				'Materiał publikuje się przez projekt: właściciel, współautorzy i lista wersji. Edycja idzie po kolei — zapisanie na wersji, którą ktoś inny już zastąpił, jest odrzucane, więc nikt nikomu przypadkiem niczego nie nadpisze. Osoby spoza zespołu mogą zaproponować wersję; zespół ją akceptuje — wtedy zostaje opublikowana, a poprzednia odchodzi — albo odrzuca, i wtedy zostaje zapis, ale nie plik.',
				'Do zespołu dołącza się przez link z zaproszeniem — który można ograniczyć liczbą użyć i datą ważności oraz unieważnić — albo prosząc o dołączenie, z krótkim opisem tego, co chcesz robić. Projekt może być otwarty na propozycje, otwarty tylko na prośbę albo zamknięty. Osoby poniżej 16 lat mogą proponować wersje, ale nigdy nie są właścicielami projektu.'
			],
			sample: {
				caption:
					'Wersje jednego materiału, wymyślone na potrzeby tej strony, od najnowszej: propozycja spoza zespołu czekająca na decyzję, wersja opublikowana, ta, którą zastąpiła, i propozycja odrzucona — wciąż na liście, ale bez pliku.',
				rows: [
					{
						label: 'Wersja 4',
						title: 'Propozycja czytelnika: poprawki w rozdziale 3',
						note: 'zaproponowana'
					},
					{ label: 'Wersja 3', title: 'Dodany tydzień 8', note: 'opublikowana' },
					{ label: 'Wersja 2', title: 'Pierwsza pełna wersja robocza', note: 'zastąpiona' },
					{ label: 'Wersja 1', title: 'Przeróbka, o którą nikt nie prosił', note: 'odrzucona' }
				]
			}
		},
		{
			key: 'attachments',
			heading: 'Załączniki do pracy wokół niego',
			body: [
				'Pliki, krótkie notatki i linki można dołączyć do organizacji, materiału, konkursu i do wierszy ich tablic — zadania, planu, prośby o pomoc, celu, głosowania — a także do komentarzy. Każdy załącznik mówi, kto może go zobaczyć: wszyscy, członkowie, zespół albo tylko osoby prowadzące. Załącznik może prosić o przeczytanie i wtedy zapisuje, kto potwierdził przeczytanie której wersji.',
				'Wycofany załącznik zostaje w zapisie, a nie jest kasowany. Czego jeszcze nie ma: załączników na stronach kursów i wydarzeń, które wciąż używają własnych, starszych paneli plików i dokumentów; podmiany załącznika ze strony (serwer to umie, strona tego nie oferuje); i wyboru istniejącego rysunku jako załącznika.'
			]
		},
		{
			key: 'licences',
			heading: 'Licencje',
			body: [
				'Każde zadanie, rozwiązanie, materiał i artykuł o pojęciu ma jedną z licencji poniżej, a strona pokazuje ją w linii u góry. Jeśli autor nie wybierze inaczej, to, co powstaje w serwisie, jest „Tylko EdMat” (wszelkie prawa zastrzeżone); autor może to zmienić, ale tylko na bardziej otwartą licencję — nigdy z powrotem — a każda zmiana jest zapisywana razem z tym, co było wcześniej. Zmiana jest odrzucana, gdy w danej rzeczy są już wersje innych osób.',
				'Dla własnej pracy — zadania bez źródła, materiału napisanego tutaj — EdMat proponuje CC BY 4.0 i formularz zaznacza ją z góry: inni mogą na niej budować, jeśli wskażą Cię jako autora. Wybór nadal należy do autora, a strona „Licencje i to, co EdMat liczy” opisuje każdą z opcji.'
			],
			facts: [
				{ term: 'CC0 1.0', detail: 'Przekazanie do domeny publicznej.' },
				{ term: 'CC BY 4.0', detail: 'Creative Commons Uznanie autorstwa 4.0 Międzynarodowe.' },
				{
					term: 'CC BY-SA 4.0',
					detail:
						'Creative Commons Uznanie autorstwa – Na tych samych warunkach 4.0 Międzynarodowe.'
				},
				{
					term: 'CC BY-NC 4.0',
					detail: 'Creative Commons Uznanie autorstwa – Użycie niekomercyjne 4.0 Międzynarodowe.'
				},
				{
					term: 'CC BY-NC-SA 4.0',
					detail:
						'Creative Commons Uznanie autorstwa – Użycie niekomercyjne – Na tych samych warunkach 4.0 Międzynarodowe.'
				},
				{
					term: 'Tylko EdMat (wszelkie prawa zastrzeżone)',
					detail:
						'Autor zachowuje wszystkie prawa; EdMat może to pokazywać na podstawie regulaminu, § 9. Obowiązuje, gdy nie wybrano nic innego.'
				},
				{
					term: 'Prawa niewyjaśnione',
					detail:
						'Ustawia ją zespół serwisu, użytkownik nigdy jej nie wybiera: baza startowa, pokazywana tylko do nauki.'
				}
			]
		}
	],
	closing:
		'Nie ma licencji „bez utworów zależnych”, bo tłumaczenie jest utworem zależnym, a tłumaczenie treści to jedna z rzeczy, dla których ten serwis istnieje.'
};

export function materialsShowcaseFor(locale: string): ShowcaseModuleDoc {
	return locale === 'pl' ? PL : EN;
}
