"""
Builds docs/USER_MANUAL.pdf.

Typeset in the same Noto Sans and the same DBIM Cinnamon Red the app uses, so
the manual and the thing it documents look like one piece of work. The fonts
come from the app's own node_modules rather than a second copy, which means
they cannot drift apart.

    python docs/build_user_manual.py

Screenshots are read from docs/manual-images/ by filename. A missing one is
skipped with a note rather than failing the build, so the manual can be
regenerated on a machine that has not captured them.
"""

import io
import os
from datetime import date

from reportlab.lib import colors as rl
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, Image, NextPageTemplate, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, 'mobile', 'app', 'node_modules', '@expo-google-fonts', 'noto-sans')
IMG_DIR = os.path.join(ROOT, 'docs', 'manual-images')
OUT = os.path.join(ROOT, 'docs', 'USER_MANUAL.pdf')

# ----------------------------------------------------------------- palette
# DBIM v3 section 2.1, Cinnamon Red - the colour group the app uses.
KEY = rl.HexColor('#771D1D')
DARK = rl.HexColor('#A72626')
MID = rl.HexColor('#D75151')
PALE = rl.HexColor('#FCDADA')
# DBIM 2.2 functional palette.
INK = rl.HexColor('#150202')
GREY1 = rl.HexColor('#C6C6C6')
GREY3 = rl.HexColor('#606060')
LINEN = rl.HexColor('#EBEAEA')
OK = rl.HexColor('#198754')
WARN = rl.HexColor('#FFC107')
ERR = rl.HexColor('#DC3545')
WHITE = rl.HexColor('#FFFFFF')

TEAM = [
    ('Adithya Shyam D', '241IT005'),
    ('Dev Patel', '241IT023'),
    ('Ritesh Bhagat', '241IT063'),
]


def register_fonts():
    """Noto Sans, as DBIM 4.1.1 requires, taken from the app's own copy."""
    faces = {
        'Noto': '400Regular/NotoSans_400Regular.ttf',
        'Noto-Bold': '700Bold/NotoSans_700Bold.ttf',
        'Noto-Semi': '600SemiBold/NotoSans_600SemiBold.ttf',
        'Noto-Med': '500Medium/NotoSans_500Medium.ttf',
    }
    for name, rel in faces.items():
        path = os.path.join(FONT_DIR, rel)
        if not os.path.exists(path):
            print(f'  missing font {rel} - falling back to Helvetica')
            return False
        pdfmetrics.registerFont(TTFont(name, path))
    pdfmetrics.registerFontFamily('Noto', normal='Noto', bold='Noto-Bold')
    return True


HAVE_FONTS = register_fonts()
F = 'Noto' if HAVE_FONTS else 'Helvetica'
FB = 'Noto-Bold' if HAVE_FONTS else 'Helvetica-Bold'
FS = 'Noto-Semi' if HAVE_FONTS else 'Helvetica-Bold'

# ------------------------------------------------------------------ styles
# Sizes follow DBIM 4.3, scaled for print rather than a phone screen.
S = {
    'title': ParagraphStyle('title', fontName=FB, fontSize=30, leading=36, textColor=KEY),
    'subtitle': ParagraphStyle('subtitle', fontName=F, fontSize=13, leading=19, textColor=GREY3),
    'h1': ParagraphStyle('h1', fontName=FB, fontSize=19, leading=25, textColor=KEY,
                         spaceBefore=2, spaceAfter=7),
    'h2': ParagraphStyle('h2', fontName=FS, fontSize=14, leading=20, textColor=DARK,
                         spaceBefore=11, spaceAfter=4),
    'h3': ParagraphStyle('h3', fontName=FS, fontSize=11.5, leading=16, textColor=INK,
                         spaceBefore=8, spaceAfter=3),
    'body': ParagraphStyle('body', fontName=F, fontSize=10, leading=15.5, textColor=INK,
                           alignment=TA_JUSTIFY, spaceAfter=6),
    'lead': ParagraphStyle('lead', fontName=F, fontSize=11, leading=17, textColor=GREY3,
                           spaceAfter=9),
    'step': ParagraphStyle('step', fontName=F, fontSize=10, leading=15, textColor=INK,
                           leftIndent=16, bulletIndent=3, spaceAfter=3.5),
    'bullet': ParagraphStyle('bullet', fontName=F, fontSize=10, leading=15, textColor=INK,
                             leftIndent=14, bulletIndent=3, spaceAfter=3),
    'note': ParagraphStyle('note', fontName=F, fontSize=9.5, leading=14.5, textColor=INK),
    'caption': ParagraphStyle('caption', fontName=F, fontSize=8.5, leading=12,
                              textColor=GREY3, alignment=TA_CENTER, spaceBefore=3),
    'cell': ParagraphStyle('cell', fontName=F, fontSize=9, leading=13, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName=FS, fontSize=9, leading=13, textColor=INK),
    'cellh': ParagraphStyle('cellh', fontName=FS, fontSize=9, leading=13, textColor=WHITE),
    'centre': ParagraphStyle('centre', fontName=F, fontSize=10, leading=15,
                             textColor=GREY3, alignment=TA_CENTER),
}

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


# ------------------------------------------------------------- page frames
def cover_page(canvas, doc):
    canvas.saveState()
    # A broad band of the key colour, the way DBIM uses it for a footer.
    canvas.setFillColor(KEY)
    canvas.rect(0, PAGE_H - 85 * mm, PAGE_W, 85 * mm, stroke=0, fill=1)
    canvas.setFillColor(DARK)
    canvas.rect(0, PAGE_H - 89 * mm, PAGE_W, 4 * mm, stroke=0, fill=1)
    canvas.setFillColor(KEY)
    canvas.rect(0, 0, PAGE_W, 16 * mm, stroke=0, fill=1)
    canvas.restoreState()


def body_page(canvas, doc):
    canvas.saveState()
    # A thin rule and the running title, so a printed page says where it is.
    canvas.setStrokeColor(GREY1)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, PAGE_H - 14 * mm, PAGE_W - MARGIN, PAGE_H - 14 * mm)
    canvas.setFont(F, 8)
    canvas.setFillColor(GREY3)
    canvas.drawString(MARGIN, PAGE_H - 12 * mm, 'Ambulance Booking System · User Manual')
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 12 * mm, 'Team 16 · IT303')

    canvas.setStrokeColor(GREY1)
    canvas.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
    canvas.setFillColor(KEY)
    canvas.setFont(FB, 9)
    canvas.drawCentredString(PAGE_W / 2, 9 * mm, str(canvas.getPageNumber()))
    canvas.restoreState()


# ---------------------------------------------------------------- builders
def rule(colour=GREY1, space=5):
    t = Table([['']], colWidths=[CONTENT_W], rowHeights=[0.6])
    t.setStyle(TableStyle([('LINEBELOW', (0, 0), (-1, -1), 0.6, colour)]))
    return [Spacer(1, space), t, Spacer(1, space + 2)]


def steps(items):
    """Numbered steps, the shape both reference manuals use."""
    return [Paragraph(text, S['step'], bulletText=f'{i}.')
            for i, text in enumerate(items, 1)]


def bullets(items):
    return [Paragraph(t, S['bullet'], bulletText='•') for t in items]


def callout(title, text, tone=MID, fill=PALE, width=None):
    """A box for the thing somebody will otherwise get wrong."""
    inner = [Paragraph(f'<font color="#{tone.hexval()[2:]}"><b>{title}</b></font>', S['note']),
             Spacer(1, 2.5),
             Paragraph(text, S['note'])]
    t = Table([[inner]], colWidths=[width or CONTENT_W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), fill),
        ('LEFTPADDING', (0, 0), (-1, -1), 11),
        ('RIGHTPADDING', (0, 0), (-1, -1), 11),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('LINEBEFORE', (0, 0), (0, -1), 3, tone),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 9)]


def table(rows, widths=None, head=True):
    w = widths or [CONTENT_W * 0.3, CONTENT_W * 0.7]
    data = []
    for i, row in enumerate(rows):
        style = S['cellh'] if (head and i == 0) else S['cell']
        data.append([Paragraph(str(c), style) for c in row])

    t = Table(data, colWidths=w, repeatRows=1 if head else 0)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, GREY1),
    ]
    if head:
        cmds += [('BACKGROUND', (0, 0), (-1, 0), KEY),
                 ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LINEN])]
    else:
        cmds += [('ROWBACKGROUNDS', (0, 0), (-1, -1), [WHITE, LINEN])]
    t.setStyle(TableStyle(cmds))
    return [Spacer(1, 3), t, Spacer(1, 9)]


def shot(name, caption, width=72 * mm):
    """A screenshot, framed and captioned. Missing files are skipped."""
    path = os.path.join(IMG_DIR, name)
    if not os.path.exists(path):
        print(f'  no screenshot {name} - skipped')
        return []

    from reportlab.lib.utils import ImageReader
    iw, ih = ImageReader(path).getSize()
    height = width * ih / iw

    img = Image(path, width=width, height=height)
    frame = Table([[img]], colWidths=[width + 8])
    frame.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.7, GREY1),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('BACKGROUND', (0, 0), (-1, -1), WHITE),
    ]))
    holder = Table([[frame]], colWidths=[CONTENT_W])
    holder.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                                ('RIGHTPADDING', (0, 0), (-1, -1), 0)]))
    return [Spacer(1, 6), holder, Paragraph(caption, S['caption']), Spacer(1, 10)]


PAGES = {}


class Mark(Flowable):
    """
    Records which page it landed on, and draws nothing.

    The contents page has to say where section 4 is, and nothing knows that
    until the document has been laid out once. So the document is built twice:
    the first pass fills PAGES, the second reads it.
    """

    width = 0
    height = 0

    def __init__(self, key):
        super().__init__()
        self.key = key

    def draw(self):
        PAGES[self.key] = self.canv.getPageNumber()


def section(number, title, lead=None):
    out = [Mark(number), Paragraph(f'{number}  {title}', S['h1'])]
    out += rule(MID, 3)
    if lead:
        out.append(Paragraph(lead, S['lead']))
    return out

ASIDE_IMG = 46 * mm
ASIDE_GAP = 7 * mm
ASIDE_TEXT_W = CONTENT_W - ASIDE_IMG - 8 - ASIDE_GAP


def aside(name, caption, blocks, img_w=ASIDE_IMG):
    """
    A screenshot in a narrow left column with text beside it.

    A phone screenshot is more than twice as tall as it is wide, so dropped
    into the middle of a page at any readable width it will not fit in what is
    left and moves to the next page, leaving a hole behind it. Setting it
    beside the text it illustrates uses that height instead of fighting it.
    """
    path = os.path.join(IMG_DIR, name)
    if not os.path.exists(path):
        print(f'  no screenshot {name} - skipped')
        return list(blocks)

    from reportlab.lib.utils import ImageReader
    iw, ih = ImageReader(path).getSize()

    framed = Table([[Image(path, width=img_w, height=img_w * ih / iw)]],
                   colWidths=[img_w + 8])
    framed.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.7, GREY1),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))

    left = [framed, Paragraph(caption, S['caption'])]
    gap = ASIDE_GAP
    t = Table([[left, list(blocks)]],
              colWidths=[img_w + 8 + gap, CONTENT_W - img_w - 8 - gap])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (0, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, -1), gap),
        ('LEFTPADDING', (1, 0), (1, -1), 0),
        ('RIGHTPADDING', (1, 0), (1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 10)]


# =============================================================== the content

def cover():
    return [
        Spacer(1, 22 * mm),
        Paragraph('<font color="#FAAAAA">National Institute of Technology Karnataka, Surathkal</font>',
                  ParagraphStyle('ce', parent=S['subtitle'], fontName=FS, fontSize=10, leading=14)),
        Spacer(1, 7),
        Paragraph('<font color="#FFFFFF">Ambulance Booking System</font>',
                  ParagraphStyle('ct', parent=S['title'], textColor=WHITE, fontSize=28, leading=34)),
        Spacer(1, 4),
        Paragraph('<font color="#FCDADA">User Manual</font>',
                  ParagraphStyle('cs', parent=S['subtitle'], textColor=PALE, fontSize=16, leading=22)),
        Spacer(1, 40 * mm),
        Paragraph('For patients, ambulance crews and the control room', S['lead']),
        Spacer(1, 4),
        Paragraph(
            'This manual explains what each of the three roles can do, and how. '
            'It follows the order somebody meets the app in: signing in first, '
            'then the task that brought them to it.',
            S['body']),
        Spacer(1, 14 * mm),
    ] + table(
        [['Version', '1.0'],
         ['Date', date.today().strftime('%d %B %Y')],
         ['Course', 'IT303 — Software Engineering'],
         ['Department', 'Information Technology, NITK Surathkal'],
         ['Prepared by', '<br/>'.join(f'{n} — {r}' for n, r in TEAM)]],
        widths=[CONTENT_W * 0.28, CONTENT_W * 0.72], head=False)


def contents():
    titles = [
        ('1', 'Before you start'),
        ('2', 'Getting an account'),
        ('3', 'For patients — booking an ambulance'),
        ('4', 'For ambulance crews — the dispatch console'),
        ('5', 'For the control room'),
        ('6', 'Reporting somebody'),
        ('7', 'If something goes wrong'),
    ]
    data = [[Paragraph(f'<b>{n}</b>', S['cell']), Paragraph(t, S['cell']),
             Paragraph(f'<para align="right">{PAGES.get(n, "—")}</para>', S['cell'])]
            for n, t in titles]
    t = Table(data, colWidths=[12 * mm, CONTENT_W - 32 * mm, 20 * mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, GREY1),
    ]))
    return [Paragraph('Contents', S['h1'])] + rule(MID, 3) + [Spacer(1, 4), t]


def s1_before():
    out = section('1', 'Before you start',
                  'One app serves all three roles. Which one you get is decided by the '
                  'account you sign in with, not by a separate download.')

    out += aside(
        '01-choose-role.jpg',
        'Figure 1 — the first screen.',
        [Paragraph('What you need', S['h2'])] + bullets([
            'An Android phone, and the <b>Ambulance Booking</b> app installed on it.',
            'An email address you can open on that phone — the app sends a code to it '
            'when you register, and you cannot finish without reading that code.',
            'A mobile number. It is not used to sign in; it is what the ambulance crew '
            'ring if they cannot find you.',
            'A working internet connection. The app talks to a server for everything.',
        ]) + [Spacer(1, 6), Paragraph(
            'Choose the role you are signing in as. If you choose the wrong one, go back '
            'and choose again — nothing is decided until you sign in.', S['body'])])

    out += [Paragraph('The three roles', S['h2'])]
    out += table([
        ['Role', 'What it is for'],
        ['<b>Book an ambulance</b>', 'Patients and their families. Request an ambulance, '
         'watch it approach, pay, and rate the trip.'],
        ['<b>Drive an ambulance</b>', 'Drivers and operators. Go on duty, accept requests, '
         'move a trip through its stages, see earnings.'],
        ['<b>Control room</b>', 'Administrators. Verify ambulances, watch every live booking, '
         'read reports and run the figures.'],
    ], widths=[CONTENT_W * 0.33, CONTENT_W * 0.67])

    out += callout(
        'In a real emergency',
        'This app is a demonstration built for a university course. In a life-threatening '
        'emergency, call <b>108</b> directly. The app says the same thing on every screen '
        'it can.', ERR, rl.HexColor('#FBE3E5'))
    return out


def s2_account():
    out = section('2', 'Getting an account',
                  'Registering proves your email address. Nothing is created until you answer '
                  'the code that is sent to it, so an account always has an address behind it '
                  'that somebody has actually read.')

    out += [Paragraph('2.1  Registering', S['h2'])]
    out += steps([
        'Open the app and choose your role.',
        'Tap <b>Register</b>.',
        'Enter your full name, mobile number, email address and a password.',
        'Tap <b>Email me a code</b>. Nothing has been created yet at this point.',
        'Open your email and find the six-digit code. It is valid for five minutes.',
        'Type the code into the app and tap <b>Verify and create account</b>.',
    ])
    out += [Paragraph(
        'You are signed in as soon as the code is accepted. If you register as a driver or '
        'an operator, there is one more step — see section 4.1.', S['body'])]

    out += [Paragraph('Choosing a password', S['h3'])]
    out += [Paragraph(
        'The app refuses a password that is easy to guess, and tells you why as you type '
        'rather than after you submit. It will not accept one that is shorter than eight '
        'characters, appears on the list of most commonly used passwords, is one character '
        'repeated or a simple run, or contains your own name, number or email address.',
        S['body'])]
    out += [Paragraph(
        'Either a long passphrase or a shorter mix of letters, digits and symbols will do. '
        '"correct horse battery staple" is accepted; "Password1!" is not.',
        S['body'])]

    out += aside(
        '02-sign-in.jpg',
        'Figure 2 — signing in.',
        [Paragraph('2.2  Signing in', S['h2'])] + bullets([
            '<b>With a password</b> — enter your email address <i>or</i> your mobile '
            'number, and your password.',
            '<b>With a code</b> — tap <b>OTP</b>, enter your email address, and the app '
            'emails you a code to sign in with. Useful if you have forgotten your '
            'password and do not want to reset it.',
        ]) + [Paragraph('2.3  If you forget your password', S['h2'])] + steps([
            'On the sign-in screen, tap <b>Forgot password?</b>',
            'Enter your email address and tap <b>Email me a reset code</b>.',
            'Enter the code from your email and choose a new password.',
        ]) + callout(
            'Resetting signs you out everywhere',
            'Every session on every device ends. That is deliberate: if somebody else knew '
            'your password, leaving them signed in would defeat the reset.',
            width=ASIDE_TEXT_W))
    return out


def s3_patient():
    out = section('3', 'For patients — booking an ambulance',
                  'Four tabs: <b>Book</b>, <b>Track</b>, <b>Trips</b> and <b>Account</b>.')

    out += aside(
        '03-book-pin.jpg',
        'Figure 3 — the booking screen.',
        [Paragraph('3.1  Setting where you are', S['h2']),
         Paragraph('This is the most important thing on the screen, so the app offers three '
                   'ways to do it and you can use whichever is quickest.', S['body'])]
        + bullets([
            '<b>Use my current location</b> — reads your GPS. The quickest, when it works. '
            'If a fix is slow the app uses your last known position rather than waiting '
            'for ever.',
            '<b>Move the map</b> — the pin stays in the middle of the map while the map '
            'moves under it. Put the pin where you are and the address below updates.',
            '<b>Search an address</b> — type a landmark, such as <i>NITK Surathkal main '
            'gate</i>, and pick from the results.',
        ]))

    out += callout(
        'Get this right before anything else',
        'The address under the pin is where the ambulance is sent. Check it reads somewhere '
        'you recognise before you request.')

    out += [Paragraph('3.2  Choosing the kind of ambulance', S['h2'])]
    out += table([
        ['Choose', 'When'],
        ['<b>EMG — Emergency</b>', 'You need an ambulance now and do not know which kind. '
         'Every ambulance nearby is alerted at once and the first to accept comes.'],
        ['<b>BLS</b> — Basic Life Support', 'Oxygen, a stretcher and a trained attendant.'],
        ['<b>ALS</b> — Advanced Life Support', 'Ventilator, defibrillator and a paramedic.'],
        ['<b>ICU</b> — Mobile ICU', 'Critical care with full monitoring.'],
        ['<b>PTV</b> — Patient Transport', 'A planned, non-emergency transfer.'],
    ], widths=[CONTENT_W * 0.36, CONTENT_W * 0.64])

    out += aside(
        '04-ambulance-types.jpg',
        'Figure 4 — the five kinds.',
        [Paragraph('<b>If you are unsure, choose Emergency.</b> The other four go to one '
                   'ambulance at a time, in order; an emergency goes to all of them '
                   'together, which is faster.', S['body']),
         Paragraph('3.3  Requesting it', S['h2'])] + steps([
            'Add the patient name and a short note if you can — the note reaches the crew '
            'with the request, and "chest pain, conscious" tells them more than nothing does.',
            'Check the indicative fare. The final invoice is worked out from the distance '
            'actually travelled, so it will not match exactly.',
            'Tap <b>Request</b>.',
        ]) + [Paragraph('The app moves to <b>Track</b> while it looks for an ambulance. Each '
                        'one has 45 seconds to answer before the request moves to the next.',
                        S['body'])])

    out += [Paragraph('3.4  Watching it come', S['h2'])]
    out += [Paragraph(
        'Once an ambulance accepts, <b>Track</b> shows it moving on the map with an estimated '
        'arrival time that updates as it travels, the driver\'s name and vehicle, and the trip '
        'stages as they are reached.', S['body'])]
    out += bullets([
        '<b>Call driver</b> puts you through on the phone. Use it if they cannot find you.',
        '<b>Cancel</b> is available until the patient is on board.',
    ])

    out += [Paragraph('3.5  Afterwards', S['h2'])]
    out += bullets([
        'The invoice appears under <b>Trips</b>, itemised: base fare, distance, any '
        'surcharge and tax.',
        'Pay by UPI, card, net banking or cash on completion.',
        'Rate the trip from one to five stars, with a comment if you want.',
        'If something was wrong, you can report it — see section 6.',
    ])
    return out


def s4_driver():
    out = section('4', 'For ambulance crews — the dispatch console',
                  'Four tabs: <b>Console</b>, <b>Trip</b>, <b>Earnings</b> and <b>Profile</b>.')

    out += [Paragraph('4.1  Adding your ambulance', S['h2'])]
    out += [Paragraph(
        'A new driver or operator cannot receive anything until the control room has seen '
        'their vehicle. Straight after registering you are asked for it.', S['body'])]
    out += steps([
        'Enter the registration number as printed on the plate, without spaces.',
        'Choose what the ambulance is: BLS, ALS, ICU or PTV.',
        'Add the licence number and a link to scanned documents if you have them.',
        'Tap <b>Submit for verification</b>.',
    ])
    out += callout(
        'Until an administrator verifies you',
        'The console stays locked and you will receive no requests at all. It unlocks by '
        'itself the moment the control room verifies you — you do not need to sign out and '
        'back in, and you do not need to keep checking.')

    out += aside(
        '05-driver-console.jpg',
        'Figure 5 — the console, off duty.',
        [Paragraph('4.2  Going on duty', S['h2']),
         Paragraph('Use the switch at the top of <b>Console</b>. While you are on duty the '
                   'app reports your position about every twenty seconds, which is how you '
                   'are matched to somebody nearby.', S['body']),
         Paragraph('An ambulance whose app has stopped reporting for fifteen minutes is '
                   'taken off duty automatically, because the system cannot send a patient '
                   'to a vehicle it cannot locate. If that happens you are told, and you '
                   'simply go on duty again.', S['body']),
         Paragraph('4.3  Answering a request', S['h2']),
         Paragraph('A request arrives as a card with a countdown, and your phone sounds and '
                   'vibrates. You have <b>45 seconds</b>; after that it goes to the next '
                   'ambulance.', S['body'])]
        + bullets([
            'A card marked <b>EMERGENCY</b> went to every ambulance nearby at once. The '
            'first to accept takes it, so hesitating costs you the job rather than '
            'delaying it.',
            'Declining passes it straight on. It does not count against you.',
        ]))

    out += callout(
        'Alerts only work while the app is running',
        'Backgrounded is fine — your phone will still sound. But if the app is swiped away '
        'from recent apps, nothing can reach it. Leave it running while you are on duty.',
        WARN, rl.HexColor('#FFF4D6'))

    out += [Paragraph('4.4  Running the trip', S['h2'])]
    out += [Paragraph(
        'The <b>Trip</b> tab shows the pickup, the route and your own position, and moves '
        'through the stages one at a time. You cannot skip one.', S['body'])]
    out += table([
        ['Stage', 'Tap when'],
        ['<b>On the way</b>', 'You set off towards the pickup.'],
        ['<b>Arrived</b>', 'You reach the pickup point.'],
        ['<b>On board</b>', 'The patient is in the ambulance. <b>The fare starts counting '
         'from here.</b>'],
        ['<b>Complete</b>', 'The patient has been handed over. The invoice is raised.'],
    ], widths=[CONTENT_W * 0.3, CONTENT_W * 0.7])
    out += callout(
        'On board and Complete decide the fare',
        'The distance billed is measured between those two taps, from your GPS — not from '
        'anything the app is told. Tapping <b>On board</b> late, or <b>Complete</b> early, '
        'costs you the difference.')

    out += [Paragraph('4.5  Earnings', S['h2'])]
    out += [Paragraph(
        'The <b>Earnings</b> tab totals what has settled and what is outstanding, with '
        'a fortnight\'s history and every past trip. Each trip there can also be reported '
        '— see section 6.', S['body'])]
    return out


def s5_admin():
    out = section('5', 'For the control room',
                  'Five tabs: <b>Overview</b>, <b>Bookings</b>, <b>Fleet</b>, '
                  '<b>Providers</b> and <b>More</b>. Everything updates live.')

    out += aside(
        'admin-dashboard.jpg',
        'Figure 6 — the dispatch overview.',
        [Paragraph('5.1  Overview', S['h2']),
         Paragraph('The operational picture, refreshing itself as things happen. Nothing '
                   'here needs to be reloaded.', S['body'])]
        + bullets([
            '<b>Awaiting a match</b> — requests still being offered to ambulances.',
            '<b>Trips in progress</b> — assigned, through to on board.',
            '<b>Ambulances free</b> — verified, on duty, and reporting position: the ones '
            'that could actually be dispatched right now.',
            '<b>Not reporting</b> — on duty but their app has gone quiet. These need '
            'chasing: they cannot be dispatched.',
        ]))

    out += [Paragraph('5.2  Verifying an ambulance', S['h2'])]
    out += steps([
        'Open <b>Providers</b> and filter by <b>PENDING</b>.',
        'Open the one you are checking and read the registration, licence and documents.',
        'Choose <b>Verify</b> or <b>Reject</b>, with a remark saying why.',
    ])
    out += [Paragraph(
        'The driver is told at once and their console unlocks on its own. An unverified '
        'ambulance receives no requests at all, so this is what puts a vehicle into service.',
        S['body'])]

    out += aside(
        '06-admin-more.jpg',
        'Figure 7 — the control room menu.',
        [Paragraph('5.3  Watching and rescuing bookings', S['h2'])] + bullets([
            '<b>Bookings</b> lists everything, filterable by status, type or date.',
            'Opening one shows the full case file: who asked, every ambulance offered it '
            'and what they said, the GPS trace, the invoice, the rating and every alert sent.',
            '<b>Re-dispatch</b> runs matching again on a booking that failed.',
            '<b>Force cancel</b> closes one that is stuck.',
        ]) + [Paragraph('5.4  Everything else', S['h2']),
              Paragraph('The rest of the control room sits behind <b>More</b>, listed '
                        'below.', S['body'])])

    out += table([
        ['Under More', 'What it holds'],
        ['<b>Passenger reports</b>', 'Complaints from crews and from patients, and what to '
         'do about them. See section 6.'],
        ['<b>Reports</b>', 'Response time, demand by type, revenue and provider performance '
         'over a date range.'],
        ['<b>Alert log</b>', 'Every WhatsApp, email and push the system has sent. Fills live.'],
        ['<b>Audit trail</b>', 'Every decision and action in order, including your own.'],
        ['<b>Accounts</b>', 'Every patient, driver and operator. Suspend or reinstate.'],
    ], widths=[CONTENT_W * 0.3, CONTENT_W * 0.7])
    return out


def s6_reports():
    out = section('6', 'Reporting somebody',
                  'A hoax call takes an ambulance somebody else needed, and a crew who '
                  'behaves badly should answer for it. Either side can report the other, '
                  'and the process is the same both ways.')

    out += callout(
        'Reporting is not a punishment',
        'Filing a report changes nothing about the other person\'s account. It goes to the '
        'control room, who decide. Nobody is suspended because you say so.')

    out += [Paragraph('6.1  A crew reporting a passenger', S['h2'])]
    out += steps([
        'Open <b>Earnings</b> and find the trip.',
        'Tap <b>Report this passenger</b>.',
        'Choose what happened: hoax call, did not turn up, abusive, refused to pay, '
        'or something else.',
        'Add what happened — brief and factual is best — and send it.',
    ])

    out += [Paragraph('6.2  A patient reporting a crew', S['h2'])]
    out += steps([
        'Open <b>Trips</b> and find the trip.',
        'Tap <b>Report this ambulance</b>.',
        'Choose what happened: never arrived, unsafe driving, rude or abusive, asked for '
        'more than the fare, or the state of the vehicle.',
        'Add what happened and send it.',
    ])
    out += [Paragraph(
        'In both directions you can only report a trip you were part of, only once, and '
        'only once it is over.', S['body'])]

    out += [Paragraph('6.3  How the control room rules on it', S['h2'])]
    out += [Paragraph(
        'Open <b>Passenger reports</b> under <b>More</b>. Each one shows who it is about, '
        'who said so, what they said, and — the part that matters — <b>how many other '
        'reports name the same person, and how many were upheld</b>. One complaint is an '
        'incident; four are a pattern.', S['body'])]
    out += table([
        ['Decision', 'What it does'],
        ['<b>Dismiss</b>', 'No action. A report found baseless costs the person nothing, '
         'so no penalty can be attached to a dismissal.'],
        ['<b>Uphold — warn</b>', 'Recorded against them, nothing more.'],
        ['<b>Uphold — suspend</b>', 'Signed out everywhere and locked out. A suspended driver '
         'is also taken off duty, so no further requests reach them. Reversible from '
         '<b>Accounts</b>.'],
        ['<b>Uphold — delete</b>', 'Name, number and email erased and the account locked. '
         'Their bookings, invoices and the report itself are kept — the record has to '
         'outlive the person. Not reversible.'],
    ], widths=[CONTENT_W * 0.28, CONTENT_W * 0.72])
    out += [Paragraph(
        'Whoever filed the report is told the outcome either way.', S['body'])]
    return out


def s7_trouble():
    out = section('7', 'If something goes wrong')

    out += table([
        ['What you see', 'What to do'],
        ['<b>The server did not answer within a minute</b>',
         'The backend sleeps when unused and takes about fifty seconds to wake. Try again — '
         'it will be quick the second time.'],
        ['<b>Cannot reach the server</b>',
         'Check the phone is online. If you are running your own backend, check the address '
         'on the sign-in screen under <b>Backend … Change</b>.'],
        ['<b>No GPS fix yet</b>',
         'Move somewhere with a clearer view of the sky, or set the position on the map '
         'instead. The app will not wait for ever.'],
        ['<b>Your code never arrives</b>',
         'Check the spelling of the address and look in spam. A made-up domain will never '
         'deliver.'],
        ['<b>No ambulance could be assigned</b>',
         'None was free within fifteen kilometres. Try again, choose <b>Emergency</b> so '
         'every nearby ambulance is asked at once, or call 108.'],
        ['<b>The driver console stays locked</b>',
         'The ambulance has not been verified yet. It unlocks on its own; nothing needs '
         'restarting.'],
        ['<b>No alert when a request arrives</b>',
         'Open <b>Profile</b>, then <b>Alerts</b>, and tap <b>Send a test alert</b>. Alerts need the app '
         'to be running — backgrounded is fine, closed is not.'],
        ['<b>Your account is suspended</b>',
         'An administrator has suspended it after a report. Contact the control room.'],
    ], widths=[CONTENT_W * 0.33, CONTENT_W * 0.67])

    out += [Paragraph('Demonstration accounts', S['h2'])]
    out += [Paragraph(
        'The seeded database ships with these, for trying the app without registering.',
        S['body'])]
    out += table([
        ['Role', 'Sign in with'],
        ['Patient', '9800000001 / user123'],
        ['Driver (ALS)', '9700000002 / driver123'],
        ['Driver (ICU)', '9700000003 / driver123'],
        ['Control room', '9000000001 / admin123'],
    ], widths=[CONTENT_W * 0.33, CONTENT_W * 0.67])

    out += rule(GREY1, 10)
    out += [
        Paragraph('Ambulance Booking System — Team 16', S['centre']),
        Spacer(1, 3),
        Paragraph(' · '.join(f'{n} ({r})' for n, r in TEAM), S['centre']),
        Spacer(1, 3),
        Paragraph('Department of Information Technology<br/>'
                  'National Institute of Technology Karnataka, Surathkal', S['centre']),
    ]
    return out


# ================================================================== assemble

def story():
    out = []
    out += cover()
    out += [NextPageTemplate('body'), PageBreak()]
    out += contents()
    for part in (s1_before, s2_account, s3_patient, s4_driver,
                 s5_admin, s6_reports, s7_trouble):
        out += [PageBreak()]
        out += part()
    return out


def document(target):
    doc = BaseDocTemplate(
        target, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
        title='Ambulance Booking System — User Manual',
        author='Team 16 — Adithya Shyam D, Dev Patel, Ritesh Bhagat',
        subject='IT303 Software Engineering',
        creator='docs/build_user_manual.py',
    )
    frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id='body')
    doc.addPageTemplates([
        PageTemplate(id='cover', frames=[frame], onPage=cover_page),
        PageTemplate(id='body', frames=[frame], onPage=body_page),
    ])
    return doc


def build():
    # First pass is thrown away; it exists only to find out what page each
    # section begins on, which the contents page then quotes.
    document(io.BytesIO()).build(story())
    document(OUT).build(story())

    size = os.path.getsize(OUT) / 1024
    print(f'built {OUT} ({size:.0f} KB)')
    print('  sections on pages: ' + ', '.join(f'{k}->{v}' for k, v in sorted(PAGES.items())))


if __name__ == '__main__':
    build()
