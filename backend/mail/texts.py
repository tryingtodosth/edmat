"""The words in every message this app sends, in the two interface languages.

Kept as Python rather than in `frontend/messages/*.json` because the server writes these and the
frontend never sees them — but house rule 1 still holds: a message with no Polish is unfinished.
`tests.TextsTests` checks that every key exists in both.

The link is never in here: each body that needs one carries `OutboundEmail.LINK_MARKER`, which
`services.render_body` replaces at the moment of sending.
"""

from .models import OutboundEmail

L = OutboundEmail.LINK_MARKER

TEXTS = {
    'pl': {
        'confirm_subject': 'EdMat: potwierdź swój adres e-mail',
        'confirm_body': (
            'Cześć {name},\n\n'
            'ktoś (mamy nadzieję, że Ty) założył konto na EdMat z tym adresem. '
            'Żeby go potwierdzić, otwórz ten link:\n\n'
            f'{L}\n\n'
            'Link jest ważny przez 7 dni. Jeśli to nie Ty, zignoruj tę wiadomość — bez potwierdzenia '
            'nie wyślemy na ten adres niczego poza nią.\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'reset_subject': 'EdMat: ustaw nowe hasło',
        'reset_body': (
            'Cześć {name},\n\n'
            'ktoś poprosił o nowe hasło do konta EdMat „{username}”. Żeby je ustawić, otwórz ten link:\n\n'
            f'{L}\n\n'
            'Link działa raz i przestaje działać po 3 dniach albo po zmianie hasła. '
            'Jeśli to nie Ty, zignoruj tę wiadomość — Twoje hasło się nie zmieni.\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'digest_subject': 'EdMat: nowe powiadomienia ({count})',
        'digest_intro': 'Cześć {name},\n\nod ostatniej wiadomości na EdMat pojawiło się {count} nowych powiadomień:\n',
        'digest_more': '… i {count} więcej.',
        'digest_outro': (
            '\nWszystkie: {site}/notifications\n'
            'Wyłącz te wiadomości: {site}/settings\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'erasure_subject': 'EdMat: Twoje konto zostanie usunięte',
        'erasure_body': (
            'Cześć {name},\n\n'
            'poproszono o usunięcie konta EdMat „{username}”. Konto jest już wyłączone, a {date} '
            'zostanie usunięte na stałe.\n\n'
            'Jeśli to pomyłka albo to nie Ty, otwórz ten link, żeby anulować usunięcie:\n\n'
            f'{L}\n\n'
            'Możesz też po prostu zalogować się przed tą datą — zapytamy, czy anulować usunięcie.\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'sso_link_subject': 'EdMat: połączyć {provider} z Twoim kontem?',
        'sso_link_body': (
            'Cześć {name},\n\n'
            'ktoś poprosił o połączenie konta {provider} z kontem EdMat „{username}”, żeby można było '
            'logować się przez {provider}. Jeśli to Ty, otwórz ten link w tej samej przeglądarce, '
            'w której zaczęto logowanie:\n\n'
            f'{L}\n\n'
            'Link działa raz i przez 30 minut. Jeśli to nie Ty, zignoruj tę wiadomość — nic nie '
            'zostanie połączone, a Twoje konto pozostaje bez zmian.\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'sso_linked_subject': 'EdMat: {provider} połączono z Twoim kontem',
        'sso_linked_body': (
            'Cześć {name},\n\n'
            '{date} z kontem EdMat „{username}” połączono konto {provider}. Od teraz można się '
            'przez nie logować.\n\n'
            'Jeśli to nie Ty: odłącz je w Ustawieniach → Metody logowania ({site}/settings) '
            'i zmień hasło ({site}/forgot-password).\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'course_invite_subject': 'EdMat: {inviter} zaprasza Cię do kursu „{course}”',
        'course_invite_body': (
            'Dzień dobry,\n\n'
            '{inviter} zaprasza Cię do kursu „{course}” na EdMat — {role}.\n\n'
            'Żeby dołączyć, otwórz ten link (jeśli nie masz jeszcze konta, możesz je założyć po drodze):\n\n'
            f'{L}\n\n'
            'Zaproszenie działa raz i wygasa {date}. Jeśli nie znasz tej osoby, zignoruj tę wiadomość — '
            'nie wyślemy Ci nic więcej, a Twój adres usuniemy z zaproszenia, gdy przestanie ono działać.\n\n'
            '— EdMat (wiadomość automatyczna, nie odpowiadaj na nią)'
        ),
        'course_invite_role_participant': 'jako uczestnik',
        'course_invite_role_assistant': 'jako asystent prowadzącego',
        'course_invite_role_admin': 'jako współprowadzący (administrator kursu)',
        'test_subject': 'EdMat: wiadomość testowa',
        'test_body': 'To jest wiadomość testowa z EdMat, wysłana z zakładki Poczta w panelu moderacji.\n\n— EdMat',
    },
    'en': {
        'confirm_subject': 'EdMat: confirm your email address',
        'confirm_body': (
            'Hello {name},\n\n'
            'somebody (we hope you) created an EdMat account with this address. '
            'To confirm it, open this link:\n\n'
            f'{L}\n\n'
            'The link is valid for 7 days. If this was not you, ignore this message — without a '
            'confirmation nothing else will be sent to this address.\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'reset_subject': 'EdMat: set a new password',
        'reset_body': (
            'Hello {name},\n\n'
            'somebody asked for a new password for the EdMat account "{username}". To set one, open this link:\n\n'
            f'{L}\n\n'
            'The link works once, and stops working after 3 days or once the password changes. '
            'If this was not you, ignore this message — your password stays as it is.\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'digest_subject': 'EdMat: new notifications ({count})',
        'digest_intro': 'Hello {name},\n\nsince our last message there are {count} new notifications on EdMat:\n',
        'digest_more': '… and {count} more.',
        'digest_outro': (
            '\nAll of them: {site}/notifications\n'
            'Turn these messages off: {site}/settings\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'erasure_subject': 'EdMat: your account will be deleted',
        'erasure_body': (
            'Hello {name},\n\n'
            'somebody asked for the EdMat account "{username}" to be deleted. The account is already '
            'switched off, and on {date} it will be deleted for good.\n\n'
            'If this was a mistake, or not you, open this link to cancel the deletion:\n\n'
            f'{L}\n\n'
            'You can also simply sign in before that date — we will ask whether to cancel it.\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'sso_link_subject': 'EdMat: connect {provider} to your account?',
        'sso_link_body': (
            'Hello {name},\n\n'
            'somebody asked to connect a {provider} account to the EdMat account "{username}", so that '
            'it can sign in with {provider}. If it was you, open this link in the same browser where '
            'the sign-in started:\n\n'
            f'{L}\n\n'
            'The link works once and for 30 minutes. If it was not you, ignore this message — nothing '
            'will be connected and your account stays as it is.\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'sso_linked_subject': 'EdMat: {provider} was connected to your account',
        'sso_linked_body': (
            'Hello {name},\n\n'
            'on {date} a {provider} account was connected to the EdMat account "{username}". It can '
            'now be used to sign in.\n\n'
            'If this was not you: disconnect it in Settings → Sign-in methods ({site}/settings) and '
            'reset your password ({site}/forgot-password).\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'course_invite_subject': 'EdMat: {inviter} invited you to the course "{course}"',
        'course_invite_body': (
            'Hello,\n\n'
            '{inviter} invited you to the course "{course}" on EdMat — {role}.\n\n'
            'To join, open this link (if you have no account yet, you can make one on the way):\n\n'
            f'{L}\n\n'
            'The invitation works once and expires on {date}. If you do not know this person, ignore '
            'this message — we will send you nothing else, and your address is removed from the '
            'invitation once it stops working.\n\n'
            '— EdMat (automated message, please do not reply)'
        ),
        'course_invite_role_participant': 'as a participant',
        'course_invite_role_assistant': 'as an assistant',
        'course_invite_role_admin': 'to help run it (as a course administrator)',
        'test_subject': 'EdMat: test message',
        'test_body': 'This is a test message from EdMat, sent from the Mail tab of the moderation panel.\n\n— EdMat',
    },
}


def text(locale: str, key: str, **values) -> str:
    table = TEXTS['en'] if locale == 'en' else TEXTS['pl']
    template = table[key]
    # str.format would choke on the braces a LaTeX-bearing notification label can carry, and the
    # values are inserted rather than the template being user text — so replace by name.
    for name, value in values.items():
        template = template.replace('{' + name + '}', str(value))
    return template
