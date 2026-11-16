#!/usr/bin/env python3
"""
Builds the project website into _site/ (deployed to GitHub Pages by .github/workflows/pages.yml).

    python3 scripts/build-site.py      # then open _site/index.html

Pages, sitemap and robots.txt are generated here; images, the demo video, the showroom
screenshots and llms.txt are copied from the repository, so the site always matches it.
"""
import html
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "_site"
SITE = "https://davidrot.github.io/ha-html-action-card/"
REPO = "https://github.com/davidrot/ha-html-action-card"
RAW = "https://raw.githubusercontent.com/davidrot/ha-html-action-card/main/"
INSTALL = "https://my.home-assistant.io/redirect/hacs_repository/?owner=davidrot&repository=ha-html-action-card&category=plugin"

CSS = """
:root { --bg: #0f1115; --panel: #171a21; --line: #262b35; --text: #e6e8eb; --muted: #9aa3ae; --accent: #03a9f4; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); }
header, main, footer { max-width: 980px; margin: 0 auto; padding: 0 20px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 18px; padding-bottom: 18px; }
header a.brand { color: var(--text); font-weight: 700; text-decoration: none; }
header nav a { margin-left: 16px; color: var(--muted); text-decoration: none; font-size: 15px; }
header nav a:hover { color: var(--text); }
h1 { font-size: clamp(30px, 5vw, 46px); line-height: 1.15; margin: 28px 0 14px; }
h2 { font-size: 26px; margin: 56px 0 14px; }
h3 { font-size: 19px; margin: 28px 0 8px; }
.lead { font-size: 19px; color: var(--muted); max-width: 760px; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; margin: 22px 0 8px; }
.button { display: inline-block; padding: 11px 18px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; }
.button.primary { background: var(--accent); color: #fff; }
.button.secondary { border: 1px solid var(--line); color: var(--text); }
video, .shot { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); background: #000; }
.media { margin: 28px 0 8px; }
.caption { color: var(--muted); font-size: 14px; margin-top: 6px; }
.blocks { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
.block { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.block code { color: #ffd479; }
.block p { margin: 6px 0 0; color: var(--muted); font-size: 15px; }
.example { display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); gap: 18px; align-items: start; margin: 18px 0; }
.example img { width: 100%; border-radius: 10px; border: 1px solid var(--line); }
@media (max-width: 720px) { .example { grid-template-columns: 1fr; } }
pre { margin: 0; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; font-size: 13.5px; line-height: 1.5; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.gallery a { display: block; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px; color: var(--text); text-decoration: none; }
.gallery img { width: 100%; height: 150px; object-fit: contain; display: block; margin-bottom: 8px; }
.gallery span { display: block; color: var(--muted); font-size: 14px; }
.cases { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.cases a { display: block; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; color: var(--text); text-decoration: none; font-weight: 600; }
.cases a span { display: block; margin-top: 4px; color: var(--muted); font-weight: 400; font-size: 15px; }
.faq h3 { margin-top: 24px; }
.faq p { margin: 4px 0; color: var(--muted); }
ol li, ul li { margin: 6px 0; }
footer { margin-top: 72px; padding-top: 22px; padding-bottom: 40px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
"""

# ---------------------------------------------------------------- content

BLOCKS = [
    ("{{ light.kitchen.state }}", "Insert a live value. Attributes too: {{ light.kitchen.attributes.brightness }}."),
    ('data-show-if="…"', "Show an element only while a condition is true."),
    ('data-action="light.toggle"', "Call any service, toggle, open more-info, navigate or open a URL."),
    ('data-event="hold"', "Choose when: tap, hold, double tap, press and repeat, release."),
]

EXAMPLES = {
    "counter": (
        "A counter you tap",
        "docs/images/quick-counter.png",
        """<style>
  button { font-size: 28px; padding: 14px 28px; border: 0; border-radius: 16px;
           background: var(--primary-color); color: white; cursor: pointer; }
</style>
<button data-action="counter.increment" data-entity="counter.coffee">
  ☕ {{ counter.coffee.state }}
</button>""",
    ),
    "light": (
        "A lamp that shows its state",
        "docs/images/quick-light.png",
        """<style>
  .bulb { font-size: 48px; cursor: pointer; filter: grayscale(1) opacity(.4); }
  .bulb.on { filter: drop-shadow(0 0 14px gold); }
</style>
<div class="bulb {{ light.desk.state }}"
     data-action="toggle" data-entity="light.desk">💡</div>
<p>Desk lamp is {{ light.desk.state }}</p>""",
    ),
    "battery": (
        "A battery bar with a warning",
        "docs/images/quick-battery.png",
        """<style>
  .bar { height: 10px; border-radius: 5px; background: #333; }
  .fill { height: 100%; border-radius: 5px; background: #4caf50; }
  .fill.low { background: #f44336; }
</style>
<p>Remote: {{ sensor.remote_battery.state }} %</p>
<div class="bar">
  <div class="fill {{ sensor.remote_battery.state < 20 ? 'low' : '' }}"
       style="width: {{ sensor.remote_battery.state }}%"></div>
</div>
<p data-show-if="sensor.remote_battery.state < 20">⚠️ Replace the battery</p>""",
    ),
}

SHOWROOM = [
    ("turntable", "Turntable", "A media player as a record player."),
    ("pull-cord-lamp", "Pull-cord lamp", "Pull the cord to switch a light."),
    ("kitchen-timer", "Kitchen timer", "Three buttons, backed by a Timer helper."),
    ("camera-control", "Camera control", "The camera picture is the joystick."),
    ("panda", "Panda", "Holds a sign and follows your cursor."),
    ("snake", "Snake", "A game in a dashboard card."),
]

FAQ = [
    ("How do I design my own buttons in Home Assistant without button-card or card-mod YAML?",
     'Add an HTML Action Card and write the button in HTML and CSS, for example <code>&lt;button data-action="light.toggle" data-entity="light.kitchen"&gt;{{ light.kitchen.state }}&lt;/button&gt;</code>. Any look CSS can produce is possible, and the state updates live.'),
    ("Can I use HTML, CSS and JavaScript in a Home Assistant dashboard?",
     "Yes, that is what this card is for. The content is rendered as written inside a Shadow DOM, so your CSS stays in the card. A script block gets a small <code>card</code> API to call services, read states and react to changes."),
    ("How do I build a joystick or touch control for a PTZ camera (Tapo, Reolink, …)?",
     'Use the <a href="use-cases/camera-joystick.html">camera control</a> card: the live picture is the joystick, and pressing an edge moves the camera. For separate arrows, use <code>data-event="press" data-repeat="300" data-action="button.press"</code> with the camera\'s move buttons.'),
    ("How do I let ChatGPT, Claude or another AI create a Home Assistant card?",
     'Paste the <a href="' + REPO + '/blob/main/docs/LLM-PROMPT.md">prompt from the repository</a> into the assistant, describe the card and paste the result into the card editor. The security rating shows what the generated code does. <a href="use-cases/ai-cards.html">More</a>.'),
    ("Is it safe to paste HTML or scripts from the internet?",
     "Nothing is blocked, but the editor rates every card green, yellow or red and lists the reasons: scripts, external resources, network access, sensitive actions without confirmation and more."),
    ("Can a card remember things after a page reload?",
     "Yes. <code>card.store</code> keeps values in the browser, and Home Assistant helpers share them across devices."),
    ("How do I show something only when a sensor has a certain value?",
     'Add <code>data-show-if</code> to any element, for example <code>data-show-if="binary_sensor.window.state == on"</code>.'),
    ("How is this different from button-card, Mushroom or Bubble Card?",
     "Those are excellent cards with their own options and styles. HTML Action Card has no fixed design: you write the markup, so one card covers a joystick, a media player, a timer or a game."),
]

CASES = [
    ("custom-buttons", "Design your own buttons", "Your own look, live states, no YAML options to learn."),
    ("camera-joystick", "Camera joystick", "Steer a PTZ camera by touching its picture."),
    ("ai-cards", "Cards written by AI", "Describe a card to ChatGPT or Claude, paste the result."),
    ("media-player", "Media player as a turntable", "A record player for Spotify, Sonos and more."),
]

# ---------------------------------------------------------------- helpers

def esc(text):
    return html.escape(text, quote=False)


def page(path, title, description, body, depth=0, extra_head=""):
    up = "../" * depth
    url = SITE + path
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}images/dashboard.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="{up}assets/site.css">
{extra_head}</head>
<body>
<header>
  <a class="brand" href="{up}index.html">HTML Action Card</a>
  <nav><a href="{up}index.html#showroom">Showroom</a><a href="{up}index.html#faq">FAQ</a><a href="{REPO}">GitHub</a></nav>
</header>
<main>
{body}
</main>
<footer>
  HTML Action Card is open source under the MIT license. <a href="{REPO}">Source on GitHub</a> · <a href="{up}llms.txt">llms.txt</a>
</footer>
</body>
</html>
"""


def cta(up=""):
    return f"""<div class="cta">
  <a class="button primary" href="{INSTALL}">Open in Home Assistant</a>
  <a class="button secondary" href="{REPO}">View on GitHub</a>
</div>
<p class="caption">Or in HACS: ⋮ → Custom repositories → <code>{REPO}</code>, type <b>Dashboard</b>.</p>"""


def example(key, up):
    title, image, code = EXAMPLES[key]
    return f"""<h3>{esc(title)}</h3>
<div class="example">
  <img src="{up}{image.removeprefix('docs/')}" alt="{html.escape(title)}" loading="lazy">
  <pre><code>{esc(code)}</code></pre>
</div>"""


def showroom_img(slug, up=""):
    return f"{up}showroom/{slug}.png"


# ---------------------------------------------------------------- pages

def index():
    blocks = "\n".join(
        f'<div class="block"><code>{esc(code)}</code><p>{esc(text)}</p></div>' for code, text in BLOCKS
    )
    gallery = "\n".join(
        f'<a href="{REPO}/tree/main/showroom/{slug}"><img src="{showroom_img(slug)}" alt="{name}" loading="lazy">{name}<span>{text}</span></a>'
        for slug, name, text in SHOWROOM
    )
    cases = "\n".join(
        f'<a href="use-cases/{slug}.html">{name}<span>{text}</span></a>' for slug, name, text in CASES
    )
    faq = "\n".join(f"<h3>{esc(q)}</h3>\n<p>{a}</p>" for q, a in FAQ)
    ld = [
        {
            "@context": "https://schema.org",
            "@type": "SoftwareSourceCode",
            "name": "HTML Action Card",
            "description": "A Home Assistant dashboard card for plain HTML and CSS with live entity states, actions and optional JavaScript.",
            "codeRepository": REPO,
            "programmingLanguage": ["TypeScript", "HTML", "CSS"],
            "license": "https://opensource.org/licenses/MIT",
            "url": SITE,
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ
            ],
        },
    ]
    head = "".join(f'<script type="application/ld+json">{json.dumps(item, ensure_ascii=False)}</script>\n' for item in ld)
    body = f"""<h1>Build your own Home Assistant dashboard cards in plain HTML</h1>
<p class="lead">HTML Action Card renders HTML and CSS with live entity states, tap, hold and press actions, and optional JavaScript. One custom card for every design, instead of a new custom card for every button. Write cards by hand, take one from the showroom, or let an AI write it.</p>
{cta()}
<div class="media">
  <video controls muted playsinline preload="metadata" poster="images/dashboard.png">
    <source src="media/demo.mp4" type="video/mp4">
  </video>
  <p class="caption">The cards running in Home Assistant, adding one, picking its entities in the form, and the security rating.</p>
</div>

<h2>Four building blocks</h2>
<div class="blocks">
{blocks}
</div>
<p>Need more? A <code>&lt;script&gt;</code> block gets a small <code>card</code> API. Cards can declare their entities like a blueprint, so the editor shows a form, and every card gets a security rating that explains what it can do. Nothing is blocked.</p>

<h2>Quick look</h2>
{example("counter", "")}
{example("light", "")}
{example("battery", "")}

<h2 id="showroom">Showroom</h2>
<p>Ready-to-paste cards. Paste one into the card editor and pick your entities in the form.</p>
<div class="gallery">
{gallery}
</div>

<h2>Use cases</h2>
<div class="cases">
{cases}
</div>

<h2 id="faq">FAQ</h2>
<div class="faq">
{faq}
</div>

<h2>Install</h2>
{cta()}"""
    return page(
        "",
        "HTML Action Card: build Home Assistant dashboard cards in plain HTML and CSS",
        "A Home Assistant custom card for plain HTML and CSS with live entity states, tap/hold actions, optional JavaScript, blueprint-style inputs and a security rating.",
        body,
        extra_head=head,
    )


def custom_buttons():
    body = f"""<h1>Design your own Home Assistant buttons in HTML and CSS</h1>
<p class="lead">Standard cards and most custom cards give you a fixed set of options. With HTML Action Card you write the button the way you imagine it, in plain HTML and CSS, and connect it to Home Assistant with a few attributes. No YAML option tree to learn, no extra card per design.</p>
{cta("../")}
<h2>How it looks</h2>
{example("counter", "../")}
{example("light", "../")}
<h2>What you can use</h2>
<ul>
  <li><code>{{{{ entity.state }}}}</code> and <code>{{{{ entity.attributes.x }}}}</code> for live values, also inside <code>class</code> and <code>style</code>.</li>
  <li><code>data-action</code> for services, <code>toggle</code>, <code>more-info</code>, <code>navigate</code> or a URL.</li>
  <li><code>data-event</code> for tap, hold, double tap, press-and-repeat or release.</li>
  <li><code>data-show-if</code> to show elements only in some states, and <code>data-confirm</code> to ask first.</li>
  <li>Your theme's colours through Home Assistant's CSS variables, such as <code>var(--primary-color)</code>.</li>
</ul>
<p>See all building blocks in the <a href="{REPO}#the-four-building-blocks">README</a>, or start from a card in the <a href="../index.html#showroom">showroom</a>.</p>"""
    return page("use-cases/custom-buttons.html", "Design your own Home Assistant buttons in HTML and CSS",
                "Build custom Home Assistant dashboard buttons in plain HTML and CSS with live states and tap/hold actions, without button-card or card-mod YAML.", body, depth=1)


def camera_joystick():
    joystick = """<div class="pad">
  <button data-event="press" data-repeat="300" data-action="button.press"
          data-entity="button.camera_move_up">▲</button>
  <button data-event="press" data-repeat="300" data-action="button.press"
          data-entity="button.camera_move_left">◀</button>
  <button data-event="press" data-repeat="300" data-action="button.press"
          data-entity="button.camera_move_right">▶</button>
  <button data-event="press" data-repeat="300" data-action="button.press"
          data-entity="button.camera_move_down">▼</button>
</div>"""
    body = f"""<h1>A touch joystick for your PTZ camera in Home Assistant</h1>
<p class="lead">Pan/tilt cameras such as Tapo or Reolink expose move buttons in Home Assistant, but pressing four separate buttons is clumsy. The camera control card from the showroom shows the live picture and turns it into the joystick: press the top, bottom, left or right part of the picture to move the camera, keep pressing to keep moving.</p>
{cta("../")}
<div class="media"><img class="shot" src="{showroom_img("camera-control", "../")}" alt="Camera picture with arrows at the edges for moving the camera" loading="lazy"></div>
<h2>Use it</h2>
<ol>
  <li>Install HTML Action Card and add a new card of type HTML Action Card.</li>
  <li>Paste <a href="{REPO}/blob/main/showroom/camera-control/card.html">card.html</a> into the card editor.</li>
  <li>Pick your camera and its four move buttons in the form. The rating is green: no script, only markup.</li>
</ol>
<h2>Or build classic arrows</h2>
<p><code>data-event="press"</code> with <code>data-repeat</code> keeps the camera moving while you hold the button:</p>
<pre><code>{esc(joystick)}</code></pre>"""
    return page("use-cases/camera-joystick.html", "A touch joystick for your PTZ camera in Home Assistant",
                "Control a Tapo, Reolink or other PTZ camera in Home Assistant by touching its live picture, or build arrow buttons that repeat while held.", body, depth=1)


def ai_cards():
    body = f"""<h1>Let ChatGPT or Claude build your Home Assistant cards</h1>
<p class="lead">AI assistants write excellent HTML and CSS, but they struggle with the options of each custom card. HTML Action Card takes what they are good at: describe the card, get HTML back, paste it. A security rating then shows what the generated code does before you use it.</p>
{cta("../")}
<h2>Three steps</h2>
<ol>
  <li>Paste the <a href="{REPO}/blob/main/docs/LLM-PROMPT.md">prompt from the repository</a> into ChatGPT, Claude or another assistant. It explains the syntax.</li>
  <li>Describe the card: “A remote for my TV with big round buttons, volume on hold, entity media_player.living_room.”</li>
  <li>Paste the answer into the card editor. Declared entities appear as a form, the rating appears on top.</li>
</ol>
<div class="media"><img class="shot" src="../images/editor.png" alt="Card editor with the security rating on top and an entity picker" loading="lazy">
<p class="caption">The editor: rating with reasons on top, the card's inputs as a form below.</p></div>
<h2>Why a rating instead of a sandbox</h2>
<p>Pasted code should be understood, not silently changed. The rating is green for plain markup, yellow for scripts, external resources or sensitive actions without confirmation, and red for things like iframes, external scripts or network and storage access. Every finding names the line. Nothing is blocked: you decide.</p>"""
    return page("use-cases/ai-cards.html", "Let ChatGPT or Claude build your Home Assistant cards",
                "Generate Home Assistant dashboard cards with an AI assistant: describe the card, paste the HTML, and check it with the built-in security rating.", body, depth=1)


def media_player():
    body = f"""<h1>A turntable for your Home Assistant media player</h1>
<p class="lead">Any media player as a record player: the album cover spins on the label, the vinyl takes on the cover's colour, and the tone arm lowers onto the record while music plays and follows the song. Tap the record to play or pause, drag the arm to jump within the song.</p>
{cta("../")}
<div class="media"><img class="shot" src="{showroom_img("turntable", "../")}" alt="Turntable card with the album cover spinning on a red record" loading="lazy" style="max-width:440px"></div>
<h2>Use it</h2>
<ol>
  <li>Install HTML Action Card and add a new card of type HTML Action Card.</li>
  <li>Paste <a href="{REPO}/blob/main/showroom/turntable/card.html">card.html</a> into the card editor.</li>
  <li>Pick your media player in the form. It works with players that report a title and cover, such as Spotify, Sonos or Music Assistant; seeking needs a player that supports it.</li>
</ol>
<p>No media player at hand? Home Assistant's demo integration provides some: add <code>media_player:</code> with <code>- platform: demo</code> to <code>configuration.yaml</code>.</p>
<p>More cards like this: the <a href="../index.html#showroom">showroom</a>.</p>"""
    return page("use-cases/media-player.html", "A turntable for your Home Assistant media player",
                "Show any Home Assistant media player as a spinning record player with album cover, tone arm and tap-to-pause, as one HTML card.", body, depth=1)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    (OUT / "use-cases").mkdir()
    (OUT / "showroom").mkdir()
    (OUT / "assets" / "site.css").write_text(CSS.lstrip())
    (OUT / "index.html").write_text(index())
    pages = {"custom-buttons": custom_buttons, "camera-joystick": camera_joystick, "ai-cards": ai_cards, "media-player": media_player}
    for slug, build in pages.items():
        (OUT / "use-cases" / f"{slug}.html").write_text(build())

    # copied, not duplicated in the repository
    shutil.copytree(DOCS / "images", OUT / "images")
    shutil.copytree(DOCS / "media", OUT / "media")
    for slug, _, _ in SHOWROOM:
        shutil.copyfile(ROOT / "showroom" / slug / "screenshot.png", OUT / "showroom" / f"{slug}.png")
    shutil.copyfile(ROOT / "llms.txt", OUT / "llms.txt")

    urls = [SITE] + [f"{SITE}use-cases/{slug}.html" for slug in pages]
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls)
        + "</urlset>\n"
    )
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}sitemap.xml\n")
    (OUT / ".nojekyll").write_text("")
    print(f"site written to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
