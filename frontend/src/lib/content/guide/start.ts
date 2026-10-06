// Chapter: getting started — the bar, the language, the audience chips, an account, the menu.
// See `types.ts` for why both languages live in one file.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Getting started',
	lead: [
		'Nothing here needs an account to read. This chapter is the five minutes before that: what the front page offers, how to put the site into your language, how to say who the content is for, and what changes once you do sign up.'
	],
	steps: [
		{
			heading: 'The front page',
			body: [
				'A search box, a row of age bands, and tabs across the newest exercises, materials, concepts, courses, tutoring and events. The search box looks inside statements and titles, so "całka" or "Cauchy" is a reasonable thing to type into it.',
				'Everything below the tabs is a card. A card is a link; the small + on an exercise card puts it straight into your set without opening it.'
			],
			screenshot: {
				src: '/guide/start/01-home.png',
				alt: 'The EdMat front page: the search box, the row of age bands, the content tabs, and the first exercise cards under "Top rated".'
			}
		},
		{
			heading: 'The bar at the top',
			body: [
				'Left: the sections — exercises, help wanted, tutoring, about, and a calendar icon for events. Right: the theme switch, the reading-size button marked "Aa", the language picker, and your saved set under the bookmark.',
				'The language picker changes the interface only. Which languages of *content* you are shown is a separate setting, and the two are deliberately independent: you may well want the English interface and the Polish original of an exercise.'
			],
			screenshot: {
				src: '/guide/start/02-header.png',
				alt: 'The top bar: the EdMat logo, the section links, and on the right the theme, reading size, language picker, saved set and the log-in links.'
			}
		},
		{
			heading: 'Say who you are reading for',
			body: [
				'The chips under the search box narrow everything on the front page to one age band — early years, primary, secondary, university, adult learners, seniors. "Everything" is the default and means no narrowing at all.',
				'A chosen band is remembered in this browser. Signed in, it becomes a setting on your account instead, so it follows you between machines.'
			],
			screenshot: {
				src: '/guide/start/03-audience.png',
				alt: 'The band chips: Everything, Early years, Primary school, Secondary school, University, Adult learners, Seniors.'
			}
		},
		{
			heading: 'Making an account',
			body: [
				'A display name, an email, a year of birth, a password and the language you would rather read. The year of birth is asked for one reason — to find out whether you are old enough to open an account by yourself — and is not stored; only the answer is.',
				'If you are under 16, a parent or guardian creates the account from their own settings page. There is no email on a child account and nothing is ever sent to one.',
				'Password reset does not work yet: there is no mail server behind this site, so the reset page honestly accepts the address and does nothing with it.'
			],
			screenshot: {
				src: '/guide/start/04-register.png',
				alt: 'The sign-up form: display name, email, year of birth, password and preferred interface language, with a Sign up button.'
			}
		},
		{
			heading: 'Your own menu',
			body: [
				'Once signed in, your name opens the menu that holds everything that belongs to you: your profile, your schedule and agenda, the materials you co-author, volunteering, your tasks, organisations and work, and your settings.',
				'The "+ Add…" button beside it is the short way to announce an event or put up a tutoring listing. Courses and organisations are started from their own pages instead.'
			],
			screenshot: {
				src: '/guide/start/05-account-menu.png',
				alt: 'The account menu open: Profile, My schedule, My agenda, Co-authoring, Volunteering, My volunteering offers, My tasks, My organisations, My work, Settings, Report issue, Log out.'
			}
		}
	],
	note: 'The pictures in this manual are of the English interface and of a test database. The names in them belong to demonstration accounts, not to real people.'
};

const PL: GuideChapterDoc = {
	title: 'Pierwsze kroki',
	lead: [
		'Do czytania nie potrzeba tu konta. Ten rozdział to pięć minut przed założeniem konta: co jest na stronie głównej, jak ustawić język, jak powiedzieć, dla kogo mają być treści, i co się zmienia, kiedy już się zarejestrujesz.'
	],
	steps: [
		{
			heading: 'Strona główna',
			body: [
				'Pole wyszukiwania, rząd przedziałów wiekowych i zakładki z najnowszymi zadaniami, materiałami, pojęciami, kursami, korepetycjami i wydarzeniami. Wyszukiwarka zagląda do treści i tytułów, więc „całka” albo „Cauchy” to sensowne hasła.',
				'Wszystko pod zakładkami to kafelki. Kafelek jest odnośnikiem; mały znak + na kafelku zadania wrzuca je do Twojego zestawu bez otwierania.'
			],
			screenshot: {
				src: '/guide/start/01-home.png',
				alt: 'Strona główna EdMatu: pole wyszukiwania, rząd przedziałów wiekowych, zakładki z treściami i pierwsze kafelki zadań pod nagłówkiem „Top rated”.'
			}
		},
		{
			heading: 'Pasek u góry',
			body: [
				'Po lewej działy: zadania, szukamy pomocy, korepetycje, o nas i ikona kalendarza prowadząca do wydarzeń. Po prawej przełącznik motywu, przycisk wielkości tekstu („Aa”), wybór języka i Twój zestaw pod ikoną zakładki.',
				'Wybór języka zmienia tylko interfejs. To, w jakich językach widzisz *treści*, jest osobnym ustawieniem — i to rozdzielenie jest celowe: można chcieć angielskiego interfejsu i polskiego oryginału zadania.'
			],
			screenshot: {
				src: '/guide/start/02-header.png',
				alt: 'Górny pasek: logo EdMat, odnośniki do działów, a po prawej motyw, wielkość tekstu, wybór języka, zestaw i odnośniki do logowania.'
			}
		},
		{
			heading: 'Powiedz, dla kogo czytasz',
			body: [
				'Plakietki pod wyszukiwarką zawężają całą stronę główną do jednego przedziału wieku — wczesne lata, szkoła podstawowa, szkoła średnia, studia, dorośli, seniorzy. „Wszystko” to ustawienie domyślne i nie zawęża niczego.',
				'Wybrany przedział pamięta ta przeglądarka. Po zalogowaniu staje się ustawieniem konta, więc chodzi za Tobą między komputerami.'
			],
			screenshot: {
				src: '/guide/start/03-audience.png',
				alt: 'Plakietki przedziałów wiekowych: Everything, Early years, Primary school, Secondary school, University, Adult learners, Seniors.'
			}
		},
		{
			heading: 'Zakładanie konta',
			body: [
				'Nazwa wyświetlana, e-mail, rok urodzenia, hasło i język, w którym wolisz czytać. Rok urodzenia służy jednemu: sprawdzeniu, czy możesz samodzielnie założyć konto — i nie jest zapisywany, zapisywana jest tylko odpowiedź.',
				'Jeśli masz mniej niż 16 lat, konto zakłada rodzic lub opiekun ze swoich ustawień. Konto dziecka nie ma adresu e-mail i nic nigdy na nie nie jest wysyłane.',
				'Odzyskiwanie hasła jeszcze nie działa: za tą stroną nie stoi serwer pocztowy, więc formularz uczciwie przyjmuje adres i nic z nim nie robi.'
			],
			screenshot: {
				src: '/guide/start/04-register.png',
				alt: 'Formularz rejestracji: nazwa wyświetlana, e-mail, rok urodzenia, hasło i preferowany język interfejsu, z przyciskiem „Sign up”.'
			}
		},
		{
			heading: 'Twoje własne menu',
			body: [
				'Po zalogowaniu Twoje nazwisko otwiera menu ze wszystkim, co należy do Ciebie: profil, grafik i plan dnia, współtworzone materiały, wolontariat, zadania do zrobienia, organizacje, panel pracy i ustawienia.',
				'Przycisk „+ Add…” obok to krótka droga do ogłoszenia wydarzenia albo wystawienia ogłoszenia korepetycyjnego. Kursy i organizacje zakłada się z ich własnych stron.'
			],
			screenshot: {
				src: '/guide/start/05-account-menu.png',
				alt: 'Otwarte menu konta: Profile, My schedule, My agenda, Co-authoring, Volunteering, My volunteering offers, My tasks, My organisations, My work, Settings, Report issue, Log out.'
			}
		}
	],
	note: 'Zrzuty w tym podręczniku pokazują interfejs po angielsku i bazę testową. Nazwiska na nich należą do kont demonstracyjnych, a nie do prawdziwych osób.'
};

export function startChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
