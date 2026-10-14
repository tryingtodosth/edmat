// Chapter: the two boards — somebody needs help, somebody is offering it.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Help wanted, and offering help',
	lead: [
		'Two boards, two questions. "Help wanted" is what a course, an event or a material needs done. "Volunteering offers" is who is willing to do something and what. Nothing on either is paid.'
	],
	steps: [
		{
			heading: 'What is being asked for',
			tryHref: '/needs',
			body: [
				'Each posting says what kind of help it is — general help, expertise, equipment, a venue — how many people are wanted, whether it can be done remotely, and roughly how many hours it is. It also says what it is *for*, because a posting always belongs to something: a course, an event, a material, an organisation.',
				'Filter by kind, by skill level, or to remote-only work, or search the text.'
			],
			screenshot: {
				src: '/guide/help/01-needs.png',
				alt: 'The Help wanted board: filters by kind and skill level with a "Remote only" tick and a search box, and one posting — "Somebody to read through the week 3 notes", on Analiza od zera, Expertise, 1 wanted, Remote, about 3 hours.'
			}
		},
		{
			heading: 'Offering to do it',
			body: [
				'Opening a posting shows the whole of it and, if it is still open, lets you offer. You say in a sentence why you, and the person running the thing accepts or declines.',
				'A posting fills up: "0 of 1 filled" becomes "1 of 1", and it stops being open.'
			]
		},
		{
			heading: 'Posting one',
			body: [
				'A need is not posted from the board — it is posted from the thing that needs the help. On the page of a course, event, material or organisation you run there is a "Help wanted" panel with a "Post a need" button, and what you write there appears on the board.',
				'That is also why a posting on something private stays private: the board only shows needs on things the reader can see in the first place.'
			],
			screenshot: {
				src: '/guide/help/03-post-a-need.png',
				alt: 'The Help wanted panel on a course page, with the posting "Somebody to read through the week 3 notes" marked Expertise, Open, 0 of 1 filled, and a "Post a need" button.'
			}
		},
		{
			heading: 'The other side of it',
			tryHref: '/volunteering',
			tryFlag: 'volunteering',
			body: [
				'The volunteering board is the supply side: people saying what they can help with, how much time they have, and which languages they can do it in. The "Speaks…" filter is that last one.',
				'Your own offer is written and withdrawn from "My volunteering offers" in your account menu. It is deliberately a separate board from help wanted, because "I need somebody" and "I can do something" are two different questions and mixing them makes both harder to read.'
			],
			screenshot: {
				src: '/guide/help/02-volunteering.png',
				alt: 'The Volunteering offers board: a line saying nothing here is paid, filters including "Speaks…", and one offer — "I can proofread maths in Polish and English" by Michał Zieliński, Remote.'
			}
		}
	]
};

const PL: GuideChapterDoc = {
	title: 'Szukamy pomocy i oferty pomocy',
	lead: [
		'Dwie tablice, dwa pytania. „Szukamy pomocy” to to, czego potrzebuje kurs, wydarzenie albo materiał. „Oferty wolontariatu” to kto i w czym chce pomóc. Nic na żadnej z nich nie jest płatne.'
	],
	steps: [
		{
			heading: 'O co ktoś prosi',
			tryHref: '/needs',
			body: [
				'Każde ogłoszenie mówi, jakiego rodzaju to pomoc — ogólna, fachowa, sprzęt, lokal — ile osób jest potrzebnych, czy da się to zrobić zdalnie i ile mniej więcej godzin zajmie. Mówi też, *do czego* jest, bo ogłoszenie zawsze należy do czegoś: kursu, wydarzenia, materiału, organizacji.',
				'Filtruj po rodzaju, po wymaganym poziomie albo do pracy wyłącznie zdalnej, albo przeszukaj treść.'
			],
			screenshot: {
				src: '/guide/help/01-needs.png',
				alt: 'Tablica „Help wanted”: filtry rodzaju i poziomu z polem „Remote only” oraz wyszukiwarką, a pod nimi jedno ogłoszenie — „Somebody to read through the week 3 notes” przy kursie Analiza od zera, Expertise, 1 osoba, zdalnie, około 3 godzin.'
			}
		},
		{
			heading: 'Zgłoszenie się',
			body: [
				'Otwarcie ogłoszenia pokazuje je w całości i, jeśli wciąż jest otwarte, pozwala się zgłosić. Piszesz jednym zdaniem, dlaczego Ty, a osoba prowadząca przyjmuje albo odmawia.',
				'Ogłoszenie się zapełnia: „0 of 1 filled” zmienia się w „1 of 1” i przestaje być otwarte.'
			]
		},
		{
			heading: 'Wystawienie ogłoszenia',
			body: [
				'Ogłoszenia nie wystawia się z tablicy, tylko z tego, co potrzebuje pomocy. Na stronie prowadzonego przez Ciebie kursu, wydarzenia, materiału albo organizacji jest panel „Help wanted” z przyciskiem „Post a need”, a to, co tam napiszesz, pojawia się na tablicy.',
				'Dlatego właśnie ogłoszenie przy czymś niepublicznym zostaje niepubliczne: tablica pokazuje tylko potrzeby przy rzeczach, które czytelnik i tak może zobaczyć.'
			],
			screenshot: {
				src: '/guide/help/03-post-a-need.png',
				alt: 'Panel „Help wanted” na stronie kursu, z ogłoszeniem „Somebody to read through the week 3 notes” oznaczonym Expertise, Open, 0 of 1 filled, i przyciskiem „Post a need”.'
			}
		},
		{
			heading: 'Druga strona',
			tryHref: '/volunteering',
			tryFlag: 'volunteering',
			body: [
				'Tablica wolontariatu to strona podaży: ludzie piszą, w czym mogą pomóc, ile mają czasu i w jakich językach dadzą radę. Filtr „Speaks…” dotyczy tego ostatniego.',
				'Własną ofertę pisze się i wycofuje z „My volunteering offers” w menu konta. To celowo osobna tablica od „szukamy pomocy”, bo „potrzebuję kogoś” i „mogę coś zrobić” to dwa różne pytania, a zmieszane utrudniają czytanie obu.'
			],
			screenshot: {
				src: '/guide/help/02-volunteering.png',
				alt: 'Tablica „Volunteering offers”: zdanie o tym, że nic tu nie jest płatne, filtry z „Speaks…” i jedna oferta — „I can proofread maths in Polish and English” od Michała Zielińskiego, zdalnie.'
			}
		}
	]
};

export function helpChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
