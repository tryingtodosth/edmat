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
