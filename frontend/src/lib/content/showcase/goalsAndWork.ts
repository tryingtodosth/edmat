/**
 * `/about/goals-and-work` — the management layer: goals and their definitions of done, plans,
 * tasks, help wanted, polls with a written decision, and the one page that gathers what is waiting
 * on you.
 *
 * Written 2026-10-14 against the merged code (`backend/{goals,plans,tasks,needs,decisions,work}/`
 * and their CLAUDE.md files), not a brief — every claim below was checked there. Two things it is
 * careful about:
 *   - none of these apps sends a notification (no `notify(` call in any of them), so the page never
 *     says anybody "is told" anything;
 *   - goals, plans and polls have no site-wide list — each is reached through the course, event,
 *     material, organisation or contest it hangs on — so the "Try it" row names the pages that do
 *     exist (`/about`'s open board, `/tasks`, `/needs`, `/work`).
 *
 * The goal in the first screenshot is the only row `e2e/showcase-screens.mjs` writes: the
 * development database had no goal anywhere, so one was put on the invented demo conference and
 * the caption says so.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseModuleDoc } from './index';

const EN: ShowcaseModuleDoc = {
	title: 'Goals, plans and the work behind them',
	description:
		'How a course, an event or an organisation on EdMat keeps its goals, plans, tasks, help-wanted posts and polls in one place — and how each person sees what is waiting on them.',
	lead: [
		'Anything people run together on EdMat — a course, an event, a material, an organisation, a contest — can carry the work that goes into it: goals that say what “done” means, plans of steps, a task board, posts asking for help, and polls whose result is written down as a decision.',
		'None of it is a separate project tool you have to move into. It hangs on the thing it is about, it is readable by whoever can see that thing, and the people who run it are the ones who can change it.'
	],
	points: [
		{
			heading: 'A goal is met when its conditions are, not when somebody says so',
			body: 'A goal carries a short checklist — its definition of done. Ticking the last line marks the goal met; unticking one re-opens it. Nobody can set “met” by hand, and a goal with no conditions can never be met.'
		},
		{
			heading: 'Everything hangs on something',
			body: 'There is no site-wide list of goals, plans or polls. Each lives on the course, event, material, organisation or contest it belongs to, and is read there — which is also the only place it makes sense.'
		},
		{
			heading: 'Nothing here sends you messages',
			body: 'None of these features notifies anybody yet. What is waiting on you is gathered on one page, “My work”, which you open when you choose to.'
		}
	],
	tryIt: [
		{ label: 'See the EdMat team’s own board', route: '/about' },
		{ label: 'Browse help wanted', route: '/needs' },
		{ label: 'Your tasks', route: '/tasks' },
		{ label: 'My work', route: '/work' }
	],
	// Screenshots of the running site (`e2e/showcase-screens.mjs`), each looked at before it was used.
	shots: [
		{
			src: '/showcase/goals-and-work/01-goal.png',
			focus: [264, 1016],
			width: 1280,
			height: 445,
			route: '/conference',
			linkLabel: 'Open the demo conference',
			alt: 'Screenshot of a goal page on the demonstration conference: the goal “TEST=FAKE: registration without a queue on day two”, marked Open, 2 of 3 met, a one-line description, and a “Definition of done” of three conditions — two ticked and struck through, each with “Met — recorded by Anna Organiser”, the third unticked. Under them: “A goal is met when every condition is. Nobody ticks it directly.”',
			caption:
				'A goal on the invented demo conference, with two of its three conditions met — so it is still open.'
		},
		{
			src: '/showcase/goals-and-work/02-tasks.png',
			focus: [230, 1050],
			width: 1280,
			height: 695,
			route: '/tasks',
			alt: 'Screenshot of “My tasks”, section “Waiting on you”: three task cards from the TEST=FAKE P5 colour-pass sandbox event. The first, marked Urgent, is overdue and To do; the second, marked High, is overdue and In progress; the third is due later and To do. Each shows who is on it, with Start or Send to review, Cancel it, Edit, Add a step, Delete and Open the task.',
			caption:
				'Your tasks across everything you help run: priority, due date, who is on it, and the next step each one can take.'
		},
		{
			src: '/showcase/goals-and-work/03-needs.png',
			focus: [100, 1180],
			width: 1280,
			height: 673,
			route: '/needs',
			alt: 'Screenshot of the Help wanted board: filters for kind, scope, remote only and a search box, then seven open posts — four on EdMat itself (testing the manual, telling students and teachers about EdMat, founders for the association, the “AI-assisted” score), two on a sandbox event and one on a course — each with its kind, how many people are wanted and whether it is remote.',
			caption:
				'The public help-wanted board: what courses, events, materials and organisations are asking for, and how many people each one needs.'
		},
		{
			src: '/showcase/goals-and-work/04-work.png',
			focus: [200, 1080],
			width: 1280,
			height: 1000,
			route: '/work',
			alt: 'Screenshot of “My work — Everything waiting on you in one place”: a section “Events I’m hosting” with one event, “Material proposals” with one version to review, and “Assigned tasks” with overdue tasks marked by a red dot, their due dates and their state in words (“To do”).',
			caption:
				'My work: one page per person, grouped by kind, with a coloured dot for how urgent each item is. Sections with nothing in them are left out.'
		}
	],
	sections: [
		{
			key: 'goals',
			heading: 'Goals and their definition of done',
			body: [
				'Whoever runs a course, an event, a material, an organisation or a contest can write goals for it, in order. Each goal is a title, a description and a list of conditions — one sentence each. People on the team tick conditions as they become true; the goal turns “met” by itself when the last one is ticked and back to “open” if one is unticked.',
				'A goal can also be abandoned, by hand. It is never deleted: an abandoned goal stays readable, so a plan or a task that pointed at it still makes sense later.'
			],
			sample: {
				caption:
					'One goal, invented for this page, and the work that points at it: two of its three conditions are met, a plan and two tasks say they serve it, and a help-wanted post asks for the people the last condition needs.',
				title: 'Goal: every week of the course has a worked example sheet',
				rows: [
					{ label: 'Condition', title: 'Sheets for weeks 1–6 are published', note: 'met' },
					{ label: 'Condition', title: 'Every sheet has a reviewed solution', note: 'met' },
					{ label: 'Condition', title: 'Sheets for weeks 7–12 are published', note: 'open' },
					{ label: 'Plan', title: 'Second half of term', note: 'serves this goal' },
					{ label: 'Task', title: 'Draft the week 8 sheet', note: 'in review' },
					{ label: 'Task', title: 'Check the week 9 answers', note: 'to do' },
					{ label: 'Help wanted', title: 'Two people to proof-read sheets', note: '1 of 2' }
				]
			}
		},
		{
			key: 'plans-and-tasks',
			heading: 'Plans and tasks',
			body: [
				'A plan is an ordered list of steps, each of which can have sub-steps one level deep, a due date and a status: pending, in progress, done or skipped. A plan is a draft that only the team sees until it is made active. Readers can suggest a step; somebody who edits the plan accepts the suggestion — it becomes a step — or turns it down.',
				'Tasks sit on the same thing’s board, one column per status: to do, in progress, in review, done, and cancelled. A task has a priority, an optional due date and sub-tasks. Whoever runs the thing assigns people to it, choosing from the people already on its team. A plan and a task can each say which goal they serve.'
			]
		},
		{
			key: 'needs',
			heading: 'Help wanted',
			body: [
				'A help-wanted post says what kind of help — general help, expertise, equipment, a venue — how many people, roughly how many hours, whether it can be done remotely, and by when. People apply, once each, and the team accepts or declines. When as many applications are accepted as people were wanted, the post counts as fulfilled; that, too, is never set by hand. Nothing on it is paid.',
				'There is a second board for the other direction: volunteering offers, where a person says what they can help with. You cannot apply to an offer, only write to its author, and nothing matches offers to posts automatically yet.'
			]
		},
		{
			key: 'polls',
			heading: 'Polls and decisions',
			body: [
				'A poll has one or several choices, can be anonymous, and is open either to the team only or to everybody taking part (enrolled, attending or co-authoring). It opens with at least two options. It is closed by hand by whoever runs the thing, who writes down the decision that came of it — a closing time only stops new votes, it does not close the poll.',
				'Before it closes, only the people running it see the count; everybody else sees the result once it is closed.'
			]
		},
		{
			key: 'work',
			heading: 'My work',
			body: [
				'One page per signed-in person gathers what is waiting on them from every part of the site: events they host or attend, requests to join a course, material proposals to review, shifts, tutoring bookings, assigned tasks, applications to help-wanted posts, plan steps due in the next two weeks, open polls, flashcards due today and contest work. Each line has a dot for how urgent it is, and a section with nothing in it is not drawn.'
			]
		},
		{
			key: 'open-board',
			heading: 'An open board, and what is not built yet',
			body: [
				'An organisation can make its board public. EdMat’s own organisation does: its tasks, help-wanted posts, plans and polls are on the About page, readable by anybody, changeable only by the people on its team.',
				'Not built yet, so as not to promise it: notifications from any of this; a list of every goal, plan or poll across the site; dependencies between steps or a timeline view; quorums, ranked voting or polls that close themselves; and a people search — someone is added to an organisation’s team by their account number (courses and co-authored materials also have invite links).'
			]
		}
	],
	closing:
		'All of this is the same few rules applied to many things: a status that something else decides is derived and never typed in, a refusal says why, and a page you cannot see simply does not exist for you.'
};

const PL: ShowcaseModuleDoc = {
	title: 'Cele, plany i praca za nimi',
	description:
		'Jak kurs, wydarzenie albo organizacja w EdMacie trzyma w jednym miejscu cele, plany, zadania, prośby o pomoc i głosowania — i jak każda osoba widzi, co czeka właśnie na nią.',
	lead: [
		'Wszystko, co ludzie prowadzą w EdMacie razem — kurs, wydarzenie, materiał, organizacja, konkurs — może nieść pracę, która w to idzie: cele mówiące, co znaczy „gotowe”, plany złożone z kroków, tablicę zadań, ogłoszenia z prośbą o pomoc i głosowania, których wynik zostaje zapisany jako decyzja.',
		'To nie jest osobne narzędzie do projektów, do którego trzeba się przenieść. Wszystko wisi na tym, czego dotyczy, czytać może każdy, kto widzi tę rzecz, a zmieniać — osoby, które ją prowadzą.'
	],
	points: [
		{
			heading: 'Cel jest osiągnięty, gdy spełnione są jego warunki, a nie gdy ktoś tak powie',
			body: 'Cel ma krótką listę kontrolną — swoją definicję ukończenia. Zaznaczenie ostatniej pozycji oznacza cel jako osiągnięty, a odznaczenie którejś otwiera go z powrotem. Nikt nie ustawia „osiągnięty” ręcznie, a cel bez warunków nigdy nie zostanie osiągnięty.'
		},
		{
			heading: 'Wszystko na czymś wisi',
			body: 'Nie ma jednej listy wszystkich celów, planów czy głosowań w serwisie. Każde żyje na kursie, wydarzeniu, materiale, organizacji albo konkursie, do którego należy, i tam się je czyta — bo tylko tam ma sens.'
		},
		{
			heading: 'Nic z tego nie wysyła powiadomień',
			body: 'Żadna z tych funkcji jeszcze nikogo nie powiadamia. To, co czeka na ciebie, jest zebrane na jednej stronie, „Moja praca”, którą otwierasz, kiedy chcesz.'
		}
	],
	tryIt: [
		{ label: 'Zobacz tablicę zespołu EdMatu', route: '/about' },
		{ label: 'Przejrzyj prośby o pomoc', route: '/needs' },
		{ label: 'Twoje zadania', route: '/tasks' },
		{ label: 'Moja praca', route: '/work' }
	],
	shots: [
		{
			src: '/showcase/goals-and-work/01-goal.png',
			focus: [264, 1016],
			width: 1280,
			height: 445,
			route: '/conference',
			linkLabel: 'Otwórz konferencję demonstracyjną',
			alt: 'Zrzut ekranu strony celu na konferencji demonstracyjnej: cel „TEST=FAKE: registration without a queue on day two”, oznaczony Open, 2 of 3 met, jednozdaniowy opis i „Definition of done” z trzema warunkami — dwa zaznaczone i przekreślone, każdy z dopiskiem „Met — recorded by Anna Organiser”, trzeci niezaznaczony. Pod nimi: „A goal is met when every condition is. Nobody ticks it directly.”',
			caption:
				'Cel na wymyślonej konferencji demonstracyjnej: spełnione dwa z trzech warunków — więc wciąż jest otwarty.'
		},
		{
			src: '/showcase/goals-and-work/02-tasks.png',
			focus: [230, 1050],
			width: 1280,
			height: 695,
			route: '/tasks',
			alt: 'Zrzut ekranu „My tasks”, sekcja „Waiting on you”: trzy karty zadań z wydarzenia TEST=FAKE P5 colour-pass sandbox. Pierwsza, oznaczona Urgent, jest po terminie i ma stan To do; druga, oznaczona High, jest po terminie i w toku; trzecia ma późniejszy termin. Na każdej widać, kto się nią zajmuje, i przyciski Start albo Send to review, Cancel it, Edit, Add a step, Delete i Open the task.',
			caption:
				'Twoje zadania ze wszystkiego, co pomagasz prowadzić: priorytet, termin, kto się tym zajmuje i jaki może być następny krok.'
		},
		{
			src: '/showcase/goals-and-work/03-needs.png',
			focus: [100, 1180],
			width: 1280,
			height: 673,
			route: '/needs',
			alt: 'Zrzut ekranu tablicy „Help wanted”: filtry rodzaju, zakresu, „tylko zdalnie” i pole wyszukiwania, a pod nimi siedem otwartych ogłoszeń — cztery od samego EdMatu (testowanie podręcznika, mówienie o EdMacie uczniom i nauczycielom, założyciele stowarzyszenia, wskaźnik „AI-assisted”), dwa z wydarzenia testowego i jedno z kursu — każde z rodzajem pomocy, liczbą potrzebnych osób i informacją, czy można zdalnie.',
			caption:
				'Publiczna tablica próśb o pomoc: czego potrzebują kursy, wydarzenia, materiały i organizacje, i ile osób szuka każde z nich.'
		},
		{
			src: '/showcase/goals-and-work/04-work.png',
			focus: [200, 1080],
			width: 1280,
			height: 1000,
			route: '/work',
			alt: 'Zrzut ekranu „My work — Everything waiting on you in one place”: sekcja „Events I’m hosting” z jednym wydarzeniem, „Material proposals” z jedną wersją do przejrzenia i „Assigned tasks” z zadaniami po terminie oznaczonymi czerwoną kropką, z datami i stanem opisanym słowami („To do”).',
			caption:
				'Moja praca: jedna strona dla każdej osoby, pogrupowana według rodzaju, z kolorową kropką mówiącą, jak pilna jest każda pozycja. Puste sekcje się nie pokazują.'
		}
	],
	sections: [
		{
			key: 'goals',
			heading: 'Cele i ich definicja ukończenia',
			body: [
				'Osoby prowadzące kurs, wydarzenie, materiał, organizację albo konkurs mogą zapisać dla niego cele, w ustalonej kolejności. Cel to tytuł, opis i lista warunków — każdy w jednym zdaniu. Osoby z zespołu zaznaczają warunki, gdy stają się prawdą; cel sam zmienia się na „osiągnięty”, gdy zaznaczony zostanie ostatni, i wraca do „otwarty”, gdy któryś zostanie odznaczony.',
				'Cel można też ręcznie porzucić. Nigdy nie jest usuwany: porzucony cel da się dalej przeczytać, więc plan albo zadanie, które na niego wskazywały, wciąż mają sens.'
			],
			sample: {
				caption:
					'Jeden cel, wymyślony na potrzeby tej strony, i praca, która na niego wskazuje: spełnione są dwa z trzech warunków, plan i dwa zadania mówią, że mu służą, a ogłoszenie z prośbą o pomoc szuka osób, których wymaga ostatni warunek.',
				title: 'Cel: każdy tydzień kursu ma arkusz z rozwiązanymi przykładami',
				rows: [
					{ label: 'Warunek', title: 'Arkusze na tygodnie 1–6 są opublikowane', note: 'spełniony' },
					{
						label: 'Warunek',
						title: 'Każdy arkusz ma sprawdzone rozwiązanie',
						note: 'spełniony'
					},
					{ label: 'Warunek', title: 'Arkusze na tygodnie 7–12 są opublikowane', note: 'otwarty' },
					{ label: 'Plan', title: 'Druga połowa semestru', note: 'służy temu celowi' },
					{ label: 'Zadanie', title: 'Szkic arkusza na tydzień 8', note: 'do przejrzenia' },
					{ label: 'Zadanie', title: 'Sprawdzić odpowiedzi z tygodnia 9', note: 'do zrobienia' },
					{
						label: 'Prośba o pomoc',
						title: 'Dwie osoby do korekty arkuszy',
						note: '1 z 2'
					}
				]
			}
		},
		{
			key: 'plans-and-tasks',
			heading: 'Plany i zadania',
			body: [
				'Plan to uporządkowana lista kroków; każdy może mieć podkroki (jeden poziom w dół), termin i stan: oczekuje, w toku, zrobione albo pominięte. Dopóki plan nie zostanie uruchomiony, jest szkicem widocznym tylko dla zespołu. Czytelnicy mogą zaproponować krok; osoba, która edytuje plan, przyjmuje propozycję — wtedy staje się krokiem — albo ją odrzuca.',
				'Zadania leżą na tablicy tej samej rzeczy, po jednej kolumnie na stan: do zrobienia, w toku, do przejrzenia, zrobione i anulowane. Zadanie ma priorytet, opcjonalny termin i podzadania. Osoby prowadzące przypisują do niego ludzi spośród tych, którzy już są w zespole. Plan i zadanie mogą wskazać, któremu celowi służą.'
			]
		},
		{
			key: 'needs',
			heading: 'Prośby o pomoc',
			body: [
				'Ogłoszenie z prośbą o pomoc mówi, jakiej pomocy trzeba — ogólnej, eksperckiej, sprzętu, miejsca — ilu osób, mniej więcej na ile godzin, czy da się to zrobić zdalnie i do kiedy. Chętni zgłaszają się, każda osoba raz, a zespół przyjmuje albo odrzuca zgłoszenia. Gdy przyjętych zgłoszeń jest tyle, ile było potrzebnych osób, ogłoszenie uznaje się za spełnione — tego też nikt nie ustawia ręcznie. Nic tu nie jest płatne.',
				'Jest też druga tablica, w drugą stronę: oferty wolontariatu, w których ktoś pisze, w czym może pomóc. Do oferty nie da się zgłosić, można tylko napisać do jej autora, i na razie nic nie łączy ofert z ogłoszeniami automatycznie.'
			]
		},
		{
			key: 'polls',
			heading: 'Głosowania i decyzje',
			body: [
				'Głosowanie ma jeden albo kilka wyborów, może być anonimowe i jest otwarte albo tylko dla zespołu, albo dla wszystkich biorących udział (zapisanych, uczestniczących, współautorów). Otwiera się, gdy ma co najmniej dwie opcje. Zamyka je ręcznie osoba prowadząca i zapisuje decyzję, która z niego wynikła — czas zamknięcia tylko blokuje nowe głosy, nie zamyka głosowania.',
				'Dopóki głosowanie trwa, wyniki widzą tylko osoby prowadzące; wszyscy inni widzą je po zamknięciu.'
			]
		},
		{
			key: 'work',
			heading: 'Moja praca',
			body: [
				'Każda zalogowana osoba ma jedną stronę, która zbiera to, co na nią czeka, ze wszystkich części serwisu: wydarzenia, które prowadzi albo na które idzie, prośby o dołączenie do kursu, propozycje materiałów do przejrzenia, dyżury, rezerwacje korepetycji, przypisane zadania, zgłoszenia do próśb o pomoc, kroki planów z terminem w najbliższych dwóch tygodniach, otwarte głosowania, fiszki na dziś i pracę przy konkursach. Każda pozycja ma kropkę mówiącą, jak jest pilna, a pusta sekcja w ogóle się nie rysuje.'
			]
		},
		{
			key: 'open-board',
			heading: 'Otwarta tablica i to, czego jeszcze nie ma',
			body: [
				'Organizacja może upublicznić swoją tablicę. Organizacja samego EdMatu tak robi: jej zadania, prośby o pomoc, plany i głosowania są na stronie „O EdMacie”, każdy może je czytać, a zmieniać mogą tylko osoby z jej zespołu.',
				'Czego jeszcze nie ma, żeby niczego nie obiecywać: powiadomień o czymkolwiek z tej strony; listy wszystkich celów, planów czy głosowań w serwisie; zależności między krokami i widoku osi czasu; kworum, głosowania rankingowego i głosowań zamykających się samodzielnie; i wyszukiwarki osób — do zespołu organizacji dodaje się kogoś po numerze konta (kursy i materiały pisane wspólnie mają też linki z zaproszeniem).'
			]
		}
	],
	closing:
		'Wszystko to są te same zasady zastosowane do wielu rzeczy: stan, o którym decyduje coś innego, jest wyliczany, a nie wpisywany; odmowa zawsze mówi dlaczego; a strona, której nie możesz zobaczyć, po prostu dla ciebie nie istnieje.'
};

export function goalsAndWorkShowcaseFor(locale: string): ShowcaseModuleDoc {
	return locale === 'pl' ? PL : EN;
}
