// Chapter: the inbox and the notification list — the two ways this site talks to you.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Messages and notifications',
	lead: [
		'Two different things. A message is one person writing to another. A notification is the site telling you that something you care about happened. Both are read here and nothing is sent to your email, because there is no mail server behind this site yet.'
	],
	steps: [
		{
			heading: 'The inbox',
			body: [
				'Inbox and Sent, and a row per conversation: who, what about, and when. A dot marks what you have not read.',
				"Messaging can be turned off site-wide, and a minor's account cannot send or receive at all — a decision made in the account model, not hidden in the interface."
			],
			screenshot: {
				src: '/guide/messages/01-inbox.png',
				alt: 'The Messages page: a "New message" button, the Inbox and Sent tabs, and one conversation from Kasia Wiśniewska titled "About your analysis tutoring hours".'
			}
		},
		{
			heading: 'A conversation',
			body: [
				'Every message in the thread, oldest first, and a box to answer in. "Back to inbox" is at the top.'
			],
			screenshot: {
				src: '/guide/messages/02-thread.png',
				alt: 'A message thread: the subject "About your analysis tutoring hours", one message from Kasia Wiśniewska about taking the Tuesday 17:00 slot, and a reply box with a Send button.'
			}
		},
		{
			heading: 'Writing to somebody',
			body: [
				'There is no "write to anybody" box, because there is no people search yet. You start a message from where you met them: the "Contact" link on a tutoring listing, or the message link on somebody\'s profile. Opening /messages/new on its own says exactly that.',
				'Arriving from one of those links, the form already knows who it is to; you add a subject and the message.'
			],
			screenshot: {
				src: '/guide/messages/03-compose.png',
				alt: 'The New message form with "To: Kasia Wiśniewska" filled in, a Subject field reading "About Tuesday", an empty Message box and a Send button.'
			}
		},
		{
			heading: 'Notifications',
			body: [
				'Everything the site has to tell you, newest first, with a dot on the unread ones and "Mark all as read" at the top: a submission decided, somebody joining your course, somebody asking to book an hour, an event you are going to being moved or called off.',
				'Which of them you want is set per kind in your settings. The bell in the bar carries the count and updates without a reload.'
			],
			screenshot: {
				src: '/guide/messages/04-notifications.png',
				alt: 'The Notifications page with one unread entry: "Michał Zieliński asked to book a session — Analiza — dyżur konsultacyjny", with the hour quoted underneath and "37 seconds ago".'
			}
		}
	],
	note: 'Nothing is emailed. Until a mail server is configured, a notification only exists on this page and in the bell.'
};

const PL: GuideChapterDoc = {
	title: 'Wiadomości i powiadomienia',
	lead: [
		'To dwie różne rzeczy. Wiadomość to jedna osoba pisząca do drugiej. Powiadomienie to serwis mówiący Ci, że stało się coś, na czym Ci zależy. Jedno i drugie czyta się tutaj i nic nie idzie na e-mail, bo za tą stroną nie stoi jeszcze serwer pocztowy.'
	],
	steps: [
		{
			heading: 'Skrzynka',
			body: [
				'Odebrane i wysłane, a w nich wiersz na rozmowę: kto, o czym i kiedy. Kropka oznacza to, czego jeszcze nie przeczytałeś.',
				'Wiadomości można wyłączyć dla całego serwisu, a konto osoby niepełnoletniej nie może ich ani wysyłać, ani odbierać — to decyzja wpisana w model kont, a nie ukryta w interfejsie.'
			],
			screenshot: {
				src: '/guide/messages/01-inbox.png',
				alt: 'Strona wiadomości: przycisk „New message”, zakładki Inbox i Sent oraz jedna rozmowa od Kasi Wiśniewskiej zatytułowana „About your analysis tutoring hours”.'
			}
		},
		{
			heading: 'Rozmowa',
			body: [
				'Wszystkie wiadomości w wątku, od najstarszej, i pole do odpowiedzi. „Back to inbox” jest na górze.'
			],
			screenshot: {
				src: '/guide/messages/02-thread.png',
				alt: 'Wątek wiadomości: temat „About your analysis tutoring hours”, jedna wiadomość od Kasi Wiśniewskiej o wtorkowej godzinie 17:00 i pole odpowiedzi z przyciskiem Send.'
			}
		},
		{
			heading: 'Napisanie do kogoś',
			body: [
				'Nie ma pola „napisz do kogokolwiek”, bo nie ma jeszcze wyszukiwarki osób. Wiadomość zaczyna się tam, gdzie kogoś spotkałeś: od odnośnika „Contact” przy ogłoszeniu korepetycyjnym albo od odnośnika na czyimś profilu. Samo wejście na /messages/new mówi dokładnie to.',
				'Wchodząc z takiego odnośnika, formularz już wie, do kogo pisze; Ty dokładasz temat i treść.'
			],
			screenshot: {
				src: '/guide/messages/03-compose.png',
				alt: 'Formularz nowej wiadomości z wypełnionym „To: Kasia Wiśniewska”, tematem „About Tuesday”, pustym polem treści i przyciskiem Send.'
			}
		},
		{
			heading: 'Powiadomienia',
			body: [
				'Wszystko, co serwis ma Ci do powiedzenia, od najnowszego, z kropką przy nieprzeczytanych i przyciskiem „Mark all as read” u góry: rozstrzygnięte zgłoszenie, ktoś dołączył do Twojego kursu, ktoś prosi o godzinę, wydarzenie, na które się wybierasz, zostało przesunięte albo odwołane.',
				'To, które z nich chcesz dostawać, ustawia się osobno dla każdego rodzaju w ustawieniach. Dzwonek na pasku nosi licznik i odświeża się bez przeładowania strony.'
			],
			screenshot: {
				src: '/guide/messages/04-notifications.png',
				alt: 'Strona powiadomień z jednym nieprzeczytanym wpisem: „Michał Zieliński asked to book a session — Analiza — dyżur konsultacyjny”, pod nim godzina i „37 seconds ago”.'
			}
		}
	],
	note: 'Nic nie jest wysyłane e-mailem. Dopóki nie skonfigurowano serwera pocztowego, powiadomienie istnieje tylko na tej stronie i w dzwonku.'
};

export function messagesChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
