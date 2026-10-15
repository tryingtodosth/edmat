// Chapter: the moderation queue, for the people who have it. Written for staff, readable by anyone.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Moderation',
	lead: [
		'This chapter is for the people who review things. It is not hidden from anybody else — knowing what a moderator can and cannot do is part of trusting the result — but the page itself is only there for accounts that have the role.'
	],
	steps: [
		{
			heading: 'One page, one tab per queue',
			tryHref: '/moderation',
			tryFor: 'moderators',
			body: [
				'Reports, new exercises, materials, edit suggestions, translations, concepts, solutions and hints, governors, applications — and Flags, Page discussions and Analytics, which are not queues at all. Each tab carries the number waiting, so the page says at a glance where the work is.',
				'Above the tabs sit the proposed taxonomy entries: a discipline, a subject or a material type somebody needed and typed in. Each can be accepted, merged into an existing one, moved under a different parent, or rejected.'
			],
			screenshot: {
				src: '/guide/moderation/01-queue.png',
				alt: 'The moderation queue tab row, on three lines: Reports, New exercises, Materials, Edit suggestions, Translations, Concepts, Solutions & hints, Governors and Applications, each with the number waiting and a dot where something is; then Flags, Page discussions and Analytics.'
			}
		},
		{
			heading: 'Deciding a submission',
			tryHref: '/moderation?tab=submissions',
			tryFor: 'moderators',
			body: [
				'A submission shows its title, who sent it and for which subject, and its text as it stands. A note is optional and goes to the person who sent it, which is what makes a rejection useful rather than merely final.',
				'A rejected submission is kept, not deleted. The record of what was offered and what was decided is part of the trust model, not clutter.'
			],
			screenshot: {
				src: '/guide/moderation/02-new-exercises.png',
				alt: 'The New exercises tab with one pending submission: the title "Granica ciągu zadanego rekurencyjnie" submitted by Ania Kowalczyk for Analiza matematyczna, its statement, the licence it was offered under (CC BY 4.0), an optional note box, and Approve and Reject buttons.'
			}
		},
		{
			heading: 'Reports',
			tryHref: '/moderation?tab=reports',
			tryFor: 'moderators',
			body: [
				'Content somebody reported, with the reason they gave and how large a share of the people who saw it reported it. Enough reports hide a comment automatically; the Restore and Remove buttons are how a person decides what the count only guessed at.',
				'Illegal content is a separate channel with its own page, because "this breaks the house rules" and "this breaks the law" are not the same claim and must not share a queue.'
			]
		},
		{
			heading: 'Flags — turning a whole feature off',
			tryHref: '/moderation?tab=flags',
			tryFor: 'moderators',
			body: [
				'Every surface on this site has a kill switch, and the Flags tab is where they are. Turning one off hides that feature from everyone except staff — its pages, and also its links, its menu entries and its filter options, because a feature that still shows its buttons has not been hidden.',
				'Nothing is deleted. The tab records who last changed each switch.'
			],
			screenshot: {
				src: '/guide/moderation/03-flags.png',
				alt: 'The Flags tab: a line explaining that kill switches hide a feature from everyone except staff, then rows for the discussions under the standing pages, the age gate, the "AI-assisted" mark, attachments, chemistry drawings and browser error reports, each On with a "Turn off" button.'
			}
		},
		{
			heading: 'Scope',
			body: [
				"Not every moderator sees everything. A governor is scoped to a part of the taxonomy and sees that part's queue, which is why two people can open the same page and honestly see different lists."
			]
		}
	]
};

const PL: GuideChapterDoc = {
	title: 'Moderacja',
	lead: [
		'Ten rozdział jest dla osób, które sprawdzają zgłoszenia. Nie jest przed nikim ukryty — wiedza o tym, co moderator może, a czego nie, jest częścią zaufania do efektu — ale sama strona istnieje tylko dla kont z tą rolą.'
	],
	steps: [
		{
			heading: 'Jedna strona, jedna zakładka na kolejkę',
			tryHref: '/moderation',
			tryFor: 'moderators',
			body: [
				'Zgłoszenia naruszeń, nowe zadania, materiały, propozycje poprawek, tłumaczenia, pojęcia, rozwiązania i wskazówki, zarządcy, podania — oraz Flags, Page discussions i Analytics, które kolejkami wcale nie są. Każda zakładka niesie liczbę oczekujących, więc strona od razu mówi, gdzie jest robota.',
				'Nad zakładkami stoją propozycje taksonomii: kierunek, przedmiot albo typ materiału, którego ktoś potrzebował i wpisał. Każdą można przyjąć, scalić z istniejącą, przenieść pod inny element albo odrzucić.'
			],
			screenshot: {
				src: '/guide/moderation/01-queue.png',
				alt: 'Pasek zakładek kolejki moderacyjnej w trzech wierszach: Reports, New exercises, Materials, Edit suggestions, Translations, Concepts, Solutions & hints, Governors i Applications, każda z liczbą oczekujących i kropką tam, gdzie coś czeka; dalej Flags, Page discussions i Analytics.'
			}
		},
		{
			heading: 'Rozstrzyganie zgłoszenia',
			tryHref: '/moderation?tab=submissions',
			tryFor: 'moderators',
			body: [
				'Zgłoszenie pokazuje tytuł, kto je przysłał i do którego przedmiotu, oraz treść w obecnej postaci. Notatka jest opcjonalna i trafia do autora — i to ona sprawia, że odrzucenie jest przydatne, a nie tylko ostateczne.',
				'Odrzucone zgłoszenie zostaje, a nie znika. Zapis tego, co zaproponowano i co postanowiono, jest częścią modelu zaufania, a nie śmieciem.'
			],
			screenshot: {
				src: '/guide/moderation/02-new-exercises.png',
				alt: 'Zakładka New exercises z jednym oczekującym zgłoszeniem: tytuł „Granica ciągu zadanego rekurencyjnie” od Ani Kowalczyk do przedmiotu Analiza matematyczna, treść zadania, licencja, na jakiej je zgłoszono (CC BY 4.0), pole notatki oraz przyciski Approve i Reject.'
			}
		},
		{
			heading: 'Zgłoszenia naruszeń',
			tryHref: '/moderation?tab=reports',
			tryFor: 'moderators',
			body: [
				'Treści, które ktoś zgłosił, z podanym powodem i z informacją, jaka część osób, które je widziały, je zgłosiła. Wystarczająco wiele zgłoszeń ukrywa komentarz automatycznie; przyciski Restore i Remove są tym, czym człowiek rozstrzyga to, co licznik tylko oszacował.',
				'Treści niezgodne z prawem mają osobny kanał i własną stronę, bo „to łamie regulamin” i „to łamie prawo” to dwa różne zarzuty i nie mogą dzielić jednej kolejki.'
			]
		},
		{
			heading: 'Flags — wyłączanie całej funkcji',
			tryHref: '/moderation?tab=flags',
			tryFor: 'moderators',
			body: [
				'Każda powierzchnia tego serwisu ma wyłącznik, a zakładka Flags jest miejscem, gdzie one są. Wyłączenie ukrywa daną funkcję przed wszystkimi poza personelem — jej strony, a także odnośniki, pozycje w menu i opcje filtrów, bo funkcja, która wciąż pokazuje swoje przyciski, nie została ukryta.',
				'Nic nie jest kasowane. Zakładka zapisuje, kto ostatnio zmienił każdy przełącznik.'
			],
			screenshot: {
				src: '/guide/moderation/03-flags.png',
				alt: 'Zakładka Flags: zdanie wyjaśniające, że wyłączniki ukrywają funkcję przed wszystkimi poza personelem, a niżej wiersze dyskusji pod stałymi stronami, bramki wieku, oznaczenia „AI-assisted”, załączników, rysunków chemicznych i zgłoszeń błędów z przeglądarki — każdy „On” z przyciskiem „Turn off”.'
			}
		},
		{
			heading: 'Zakres',
			body: [
				'Nie każdy moderator widzi wszystko. Zarządca ma przypisany fragment taksonomii i widzi kolejkę tego fragmentu — dlatego dwie osoby mogą otworzyć tę samą stronę i uczciwie zobaczyć różne listy.'
			]
		}
	]
};

export function moderationChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
