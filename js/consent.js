/*
 * Chalet Swiss -- Consent Mode v2 und Cookie-Hinweis.
 *
 * Diese Datei laedt SYNCHRON und VOR dem gtag-Loader. Nur so stehen die
 * Consent-Defaults fest, bevor Google Analytics sich konfiguriert. Kein defer,
 * kein async, kein Verschieben ans Seitenende.
 *
 * Regelwerk:
 *   - EWR und Vereinigtes Koenigreich: nichts messen, bis der Gast zustimmt.
 *   - Rest der Welt inklusive Schweiz: messen erlaubt, Widerspruch jederzeit
 *     moeglich (das revDSG verlangt keine vorherige Einwilligung).
 *   - Werbe-Signale sind ueberall und dauerhaft aus. Es gibt keine
 *     Ads-Verknuepfung, damit auch keine DoubleClick-Cookies.
 *   - Ablehnen heisst wirklich nicht messen: zusaetzlich zum Consent-Update
 *     setzen wir Googles offiziellen Kill-Switch ga-disable-<Mess-ID>. Ohne ihn
 *     liefen im "advanced"-Modus weiter cookielose Pings.
 *
 * Alles laeuft in try/catch. Ist localStorage gesperrt, verhaelt sich die Seite
 * wie "noch keine Wahl"; die Datei wirft nie und blockiert nie das Rendern.
 */
(function () {
'use strict';

var GA4_ID = 'G-XKDQLKRSJF';
var LANG_KEY = 'chaletswiss_lang';
var FALLBACK_LANG = 'de';
var STORE_KEY = 'am_consent_analytics';

// EWR (EU-27 plus IS/LI/NO) und das Vereinigte Koenigreich. Die Schweiz steht
// hier bewusst NICHT drin -- siehe Regelwerk oben.
var OPT_IN_REGIONEN = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI',
  'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT',
  'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB'];

// Sichtbare Texte als HTML-Entities statt als Umlaute: Diese Datei wird in
// index.html VOR <meta charset> geladen, die Zeichenkodierung des Dokuments
// steht an der Stelle also noch nicht fest. Entities loest der HTML-Parser auf
// und sind davon unabhaengig.
var TEXTE = {
  de: {
    label: 'Hinweis zur Reichweitenmessung',
    text: 'Wir messen die Nutzung dieser Website mit Google Analytics 4 und den Erfolg unserer Werbung mit dem Meta-Pixel. Den Meta-Pixel laden wir erst nach Ihrer Zustimmung. Ihre Wahl gilt f&uuml;r diesen Browser und l&auml;sst sich jederzeit &auml;ndern.',
    accept: 'Akzeptieren',
    deny: 'Ablehnen',
    link: 'Datenschutz',
    href: '/datenschutz.html'
  },
  en: {
    label: 'Audience measurement notice',
    text: 'We measure how this website is used with Google Analytics 4, and how our advertising performs with the Meta pixel. The Meta pixel only loads once you agree. Your choice applies to this browser and can be changed at any time.',
    accept: 'Accept',
    deny: 'Decline',
    link: 'Privacy policy',
    href: '/privacy.html'
  }
};

// Beide Schaltflaechen teilen sich eine Klasse: gleiche Groesse, gleiche Ebene,
// keine Vorbelegung. Ein Ablehnen-Knopf, der kleiner oder blasser ist als der
// Akzeptieren-Knopf, waere genau das Dark Pattern, das hier nicht sein soll.
var STIL = [
  '.am-consent{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#2C2C2C;color:#FAF8F5;padding:1rem 1.25rem;font:400 .9rem/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.25)}',
  '.am-consent-inner{max-width:960px;margin:0 auto;display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:center;justify-content:space-between}',
  '.am-consent-text{margin:0;flex:1 1 20rem;color:#FAF8F5}',
  '.am-consent-actions{display:flex;gap:.6rem;flex-wrap:wrap}',
  '.am-consent-btn{font:inherit;min-width:9rem;padding:.6rem 1.4rem;border:1px solid #FAF8F5;border-radius:2px;background:transparent;color:#FAF8F5;cursor:pointer}',
  '.am-consent-btn:hover,.am-consent-btn:focus{background:#FAF8F5;color:#2C2C2C}',
  '.am-consent-link{color:#FAF8F5;text-decoration:underline;white-space:nowrap}'
].join('');

window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
if (typeof window.gtag !== 'function') { window.gtag = gtag; }

// 1. Global-Default: alle Nicht-EWR inklusive Schweiz duerfen gemessen werden,
//    Werbe-Signale bleiben ueberall aus.
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'granted'
});

// 2. Regional-Default EWR und UK: alles denied bis zur echten Wahl.
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  region: OPT_IN_REGIONEN
});

function lesen() {
  try {
    var wert = localStorage.getItem(STORE_KEY);
    return (wert === 'granted' || wert === 'denied') ? wert : null;
  } catch (e) { return null; }
}

/*
 * Bereits gesetzte Google-Cookies entfernen.
 *
 * `analytics_storage: denied` und der ga-disable-Kill-Switch verhindern NEUE
 * Cookies und neue Hits. Was schon auf dem Geraet liegt, raeumen sie nicht
 * weg: die Kennung _ga ueberlebt eine Ablehnung sonst zwei Jahre lang.
 *
 * Zwei Fallstricke, die den naiven Einzeiler wirkungslos machen:
 *  - Geloescht wird nur, wenn Name, Pfad UND Domain exakt zur Setzung passen.
 *    GA4 setzt _ga auf der registrierbaren Domain (".example.com"), nicht auf
 *    dem Host. Darum jede Domain-Variante durchgehen.
 *  - Der Name von _ga_<ID> haengt an der Mess-ID, und aus der GTM-Zeit koennen
 *    _gcl_*-Cookies liegen. Darum document.cookie lesen statt Namen raten.
 */
function clearGoogleCookies() {
  try {
    var parts = String(location.hostname || '').split('.');
    var scopes = [''];
    for (var i = 0; i < parts.length - 1; i++) {
      var d = parts.slice(i).join('.');
      scopes.push('; domain=.' + d);
      scopes.push('; domain=' + d);
    }
    var names = { '_ga': true };
    names['_ga_' + String(GA4_ID).replace(/^G-/, '')] = true;
    var raw = document.cookie ? document.cookie.split(';') : [];
    for (var j = 0; j < raw.length; j++) {
      var n = raw[j].split('=')[0].trim();
      if (/^(_ga|_gid|_gat|_gac_|_gcl_)/.test(n)) { names[n] = true; }
    }
    var dead = '=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; max-age=0';
    for (var name in names) {
      if (!Object.prototype.hasOwnProperty.call(names, name)) { continue; }
      for (var k = 0; k < scopes.length; k++) {
        document.cookie = name + dead + scopes[k];
      }
    }
  } catch (e) { /* nie werfen */ }
}

function anwenden(zustand) {
  try {
    if (zustand === 'granted') {
      window['ga-disable-' + GA4_ID] = false;
      gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    } else if (zustand === 'denied') {
      window['ga-disable-' + GA4_ID] = true;
      gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      clearGoogleCookies();
    }
  } catch (e) { /* Consent darf die Seite nie brechen */ }
  // meta.js haengt an dieser Meldung: es laedt mit defer und damit NACH
  // dem synchronen Erstlauf, bekommt spaetere Wechsel aber sofort mit.
  try {
    document.dispatchEvent(new CustomEvent('am:consent-change', { detail: { state: zustand } }));
  } catch (e) { /* nie werfen */ }
}

// 3. Gespeicherte Wahl anwenden, bevor gtag.js ueberhaupt ausgefuehrt wird.
var gespeichert = lesen();
if (gespeichert) { anwenden(gespeichert); }

function sprache() {
  try {
    var gewaehlt = localStorage.getItem(LANG_KEY);
    if (gewaehlt && TEXTE[gewaehlt]) return gewaehlt;
  } catch (e) {}
  try {
    var attr = document.documentElement.getAttribute('lang');
    if (attr && TEXTE[attr.slice(0, 2)]) return attr.slice(0, 2);
  } catch (e) {}
  return FALLBACK_LANG;
}

var knoten = null;

function schliessen() {
  try {
    if (knoten && knoten.parentNode) knoten.parentNode.removeChild(knoten);
  } catch (e) {}
  knoten = null;
}

function zeigen() {
  try {
    if (knoten || !document.body) return;
    if (!document.getElementById('am-consent-stil')) {
      var stil = document.createElement('style');
      stil.id = 'am-consent-stil';
      stil.appendChild(document.createTextNode(STIL));
      document.head.appendChild(stil);
    }
    var t = TEXTE[sprache()] || TEXTE[FALLBACK_LANG];
    knoten = document.createElement('div');
    knoten.className = 'am-consent';
    knoten.setAttribute('role', 'dialog');
    knoten.setAttribute('aria-label', t.label);
    knoten.innerHTML =
      '<div class="am-consent-inner">' +
        '<p class="am-consent-text">' + t.text +
          ' <a class="am-consent-link" href="' + t.href + '">' + t.link + '</a></p>' +
        '<div class="am-consent-actions">' +
          '<button type="button" class="am-consent-btn" data-am-consent="granted">' + t.accept + '</button>' +
          '<button type="button" class="am-consent-btn" data-am-consent="denied">' + t.deny + '</button>' +
        '</div>' +
      '</div>';
    var knoepfe = knoten.querySelectorAll('button[data-am-consent]');
    for (var i = 0; i < knoepfe.length; i++) {
      knoepfe[i].addEventListener('click', function () {
        setzen(this.getAttribute('data-am-consent'));
      });
    }
    document.body.appendChild(knoten);
  } catch (e) { /* ohne Hinweis weiterlaufen ist besser als eine kaputte Seite */ }
}

function setzen(zustand) {
  if (zustand !== 'granted' && zustand !== 'denied') return;
  try { localStorage.setItem(STORE_KEY, zustand); } catch (e) {}
  anwenden(zustand);
  schliessen();
}

window.amConsent = {
  get: function () { return lesen(); },
  set: function (zustand) { setzen(zustand); },
  open: function () { schliessen(); zeigen(); }
};

function start() {
  if (lesen() === null) zeigen();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

// i18n.js meldet jeden Sprachwechsel. Steht der Hinweis noch offen, wird er in
// der neuen Sprache neu aufgebaut.
document.addEventListener('languageChanged', function () {
  if (knoten) { schliessen(); zeigen(); }
});

})();
