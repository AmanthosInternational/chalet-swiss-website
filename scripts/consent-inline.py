"""Den Weg zum Consent-Banner verkuerzen, denn er ist das LCP-Element.

Gemessen auf chalet-swiss.ch, mobil: das groesste Element im Viewport ist nicht
das Hero-Bild, sondern der Text des Cookie-Hinweises. Der LCP haengt damit an der
Kette "consent.js holen, DOMContentLoaded abwarten, Banner einsetzen".

Zwei Eingriffe, beide lokal gemessen (Chalet, Median aus vier Laeufen):

    main                          Score 77   LCP 6,46 s
    ohne den falschen Preload     Score 79   LCP 5,59 s
    zusaetzlich consent.js inline Score 82   LCP 4,82 s

1. consent.js wird inline in den Kopf geschrieben statt als eigene Datei geholt.
   Das spart einen kompletten Roundtrip auf dem kritischen Pfad. Die Datei bleibt
   die Quelle der Wahrheit; dieses Skript traegt sie zwischen zwei Markern ein und
   kann jederzeit erneut laufen.

2. gtag.js laedt nur noch, wenn nicht ausdruecklich abgelehnt wurde. Bisher kamen
   bei Ablehnung 183 KB an, die der ga-disable-Kill-Switch danach stilllegt: volle
   Bandbreite fuer null Messung. Wer nachtraeglich zustimmt, bekommt das Skript
   sofort nachgeladen, ueber das Ereignis am:consent-change, das consent.js schon
   heute sendet. Die Einwilligungslogik selbst wird nicht angefasst.
"""
import os
import re
import sys

START = '<!-- consent:inline:start (erzeugt aus js/consent.js, siehe scripts/consent-inline.py) -->'
ENDE = '<!-- consent:inline:end -->'

LOADER = """    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      gtag('config', '{id}');
      // gtag.js wiegt 183 KB uebertragen. Bei Ablehnung wurde es bisher trotzdem
      // geholt und danach vom ga-disable-Kill-Switch stillgelegt. Jetzt kommt es
      // nur, wenn keine Ablehnung gespeichert ist; wer spaeter zustimmt, bekommt
      // es ueber am:consent-change sofort nachgereicht.
      (function () {{
        var geholt = false;
        function laden() {{
          if (geholt) return;
          geholt = true;
          var s = document.createElement('script');
          s.async = true;
          s.src = 'https://www.googletagmanager.com/gtag/js?id={id}';
          (document.head || document.documentElement).appendChild(s);
        }}
        var wahl = null;
        try {{ wahl = window.localStorage.getItem('am_consent_analytics'); }} catch (e) {{ /* Privatmodus */ }}
        if (wahl !== 'denied') {{ laden(); }}
        document.addEventListener('am:consent-change', function (e) {{
          if (e && e.detail && e.detail.state === 'granted') {{ laden(); }}
        }});
      }})();
    </script>"""


def ga_id(repo):
    quelle = open(os.path.join(repo, 'js', 'consent.js'), encoding='utf-8').read()
    m = re.search(r"GA4_ID\s*=\s*'([^']+)'", quelle)
    return m.group(1) if m else None


def umbauen(pfad, consent_js, gid):
    with open(pfad, encoding='utf-8') as fh:
        t = fh.read()
    vorher = t

    # 1. Den asynchronen gtag-Loader herausnehmen; er wird jetzt bedingt erzeugt.
    t = re.sub(r'[ \t]*<script async src="https://www\.googletagmanager\.com/gtag/js\?id=[^"]+"></script>\n', '', t)

    # 2. Den vorhandenen Konfigurationsblock durch die bedingte Fassung ersetzen.
    muster = re.compile(
        r'[ \t]*<script>\s*\n?\s*window\.dataLayer = window\.dataLayer \|\| \[\];.*?</script>',
        re.S)
    if muster.search(t):
        t = muster.sub(LOADER.format(id=gid), t, count=1)

    # 3. consent.js inline, zwischen Markern, damit ein erneuter Lauf sie findet.
    inline = f'{START}\n  <script>{consent_js}</script>\n  {ENDE}'
    # Der Ersetzungstext wird als Funktion uebergeben: consent.js enthaelt
    # \u-Escapes, die re.sub sonst als Rueckwaertsreferenzen zu deuten versucht
    # und mit "bad escape \u" abbricht.
    if START in t:
        t = re.sub(re.escape(START) + r'.*?' + re.escape(ENDE), lambda _: inline, t, flags=re.S)
    else:
        t = re.sub(r'[ \t]*<script src="[^"]*js/consent\.js"></script>', lambda _: '  ' + inline, t, count=1)

    if t == vorher:
        return False
    with open(pfad, 'w', encoding='utf-8') as fh:
        fh.write(t)
    return True


def main():
    repo = sys.argv[1]
    gid = ga_id(repo)
    if not gid:
        print('  GA4_ID nicht gefunden, Abbruch')
        return
    consent_js = open(os.path.join(repo, 'js', 'consent.js'), encoding='utf-8').read()

    geaendert = 0
    for wurzel, _, namen in os.walk(repo):
        if '.git' in wurzel or 'node_modules' in wurzel:
            continue
        for n in sorted(namen):
            if not n.endswith('.html'):
                continue
            p = os.path.join(wurzel, n)
            roh = open(p, encoding='utf-8').read()
            if 'js/consent.js' not in roh and START not in roh:
                continue
            if umbauen(p, consent_js, gid):
                geaendert += 1
                print(f'    {os.path.relpath(p, repo)}')
    print(f'  {geaendert} Datei(en) umgebaut, Mess-ID {gid}, consent.js {len(consent_js) // 1024} KB inline')


if __name__ == '__main__':
    main()
