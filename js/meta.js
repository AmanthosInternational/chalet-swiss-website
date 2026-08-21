/*
 * Meta-Pixel und Klick-ID-Erfassung.
 *
 * Zwei Aufgaben, die unabhaengig voneinander funktionieren:
 *
 *  1. Klick-IDs merken. Kommt ein Gast ueber eine Anzeige, haengt in der URL ein
 *     `gclid` (Google) oder `fbclid` (Meta). Ohne Erfassung ist beim Abschluss
 *     der Buchung nicht mehr feststellbar, welche Anzeige sie gebracht hat.
 *     Das braucht KEIN Pixel und laeuft deshalb ab sofort.
 *
 *  2. Das Meta-Pixel. Es laedt nur, wenn unten eine PIXEL_ID eingetragen ist.
 *     Solange die Konstante leer ist, ist dieser Teil vollstaendig still: kein
 *     Script von Meta, kein Cookie, kein Ereignis. So kann die Datei stehen,
 *     bevor das Werbekonto eingerichtet ist.
 *
 * Meta ist hier strikt Opt-in, anders als Google Analytics. Grund: `fbq` kennt
 * keine Regionslogik wie der Google Consent Mode, und `_fbp`/`_fbc` sind
 * Marketing-, nicht Analyse-Cookies. Ohne ausdrueckliche Zustimmung geht nichts
 * raus und wird nichts gespeichert.
 */
(function () {
  'use strict';

  // Datenquelle "amanthos pixel" im Business-Portfolio Amanthos (548121105749958).
  // EIN Pixel fuer alle vier Domains, nicht vier einzelne: Bei geschaetzt unter
  // 50 Conversions pro Woche und Haus kaeme keines davon je aus der Lernphase.
  // Leert man die Konstante, ist dieser Teil wieder vollstaendig still.
  var PIXEL_ID = '516536478992095';

  var STORE_KEY = 'am_click_ids';
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;  // Google-Ads-Klickfenster
  var geladen = false;

  function zustimmung() {
    try {
      return window.amConsent && window.amConsent.get() === 'granted';
    } catch (e) { return false; }
  }

  // ---- Klick-IDs -----------------------------------------------------------

  function ausUrl() {
    var out = {};
    try {
      var p = new URLSearchParams(location.search);
      ['gclid', 'fbclid'].forEach(function (k) {
        var v = p.get(k);
        if (v) { out[k] = String(v).slice(0, 512); }
      });
    } catch (e) { /* alte Browser: dann eben nichts */ }
    return out;
  }

  var ausUrlGelesen = ausUrl();

  function gespeichert() {
    if (!zustimmung()) { return {}; }
    try {
      var roh = window.localStorage.getItem(STORE_KEY);
      if (!roh) { return {}; }
      var obj = JSON.parse(roh);
      if (!obj || typeof obj !== 'object') { return {}; }
      // Abgelaufene Eintraege sind wertlos: nach 90 Tagen ordnet Google nichts mehr zu.
      if (!obj.ts || (Date.now() - obj.ts) > MAX_AGE_MS) { return {}; }
      return obj;
    } catch (e) { return {}; }
  }

  function speichern() {
    // Ohne Zustimmung wird nichts geschrieben und nichts gelesen.
    if (!zustimmung()) { return; }
    try {
      var alt = gespeichert();
      var neu = { ts: Date.now() };
      ['gclid', 'fbclid'].forEach(function (k) {
        var v = ausUrlGelesen[k] || alt[k];
        if (v) { neu[k] = v; }
      });
      if (neu.gclid || neu.fbclid) {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(neu));
      }
    } catch (e) { /* Privatmodus: dann haelt die ID nur diese Seite lang */ }
  }

  function cookie(name) {
    try {
      var treffer = (document.cookie || '').split(';').filter(function (c) {
        return c.trim().indexOf(name + '=') === 0;
      });
      return treffer.length ? treffer[0].trim().slice(name.length + 1) : '';
    } catch (e) { return ''; }
  }

  function tracking() {
    if (!zustimmung()) { return null; }
    var alt = gespeichert();
    var out = { consent: 'granted' };
    var gclid = ausUrlGelesen.gclid || alt.gclid;
    var fbclid = ausUrlGelesen.fbclid || alt.fbclid;
    if (gclid) { out.gclid = gclid; }
    if (fbclid) { out.fbclid = fbclid; }

    var fbp = cookie('_fbp');
    if (fbp) { out.fbp = fbp; }
    var fbc = cookie('_fbc');
    if (!fbc && fbclid) {
      // Metas Format, wenn das Pixel den Cookie (noch) nicht gesetzt hat.
      fbc = 'fb.1.' + (alt.ts || Date.now()) + '.' + fbclid;
    }
    if (fbc) { out.fbc = fbc; }

    // consent allein sagt nichts aus — dann lieber gar nichts mitschicken.
    return (out.gclid || out.fbclid || out.fbp || out.fbc) ? out : null;
  }

  // ---- Pixel ---------------------------------------------------------------

  function pixelLaden() {
    if (geladen || !PIXEL_ID) { return; }
    geladen = true;
    try {
      /* eslint-disable */
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
        n.queue = []; t = b.createElement(e); t.async = !0;
        t.src = v; s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */

      // Reihenfolge zaehlt: erst widerrufen, dann initialisieren. So sendet das
      // Pixel nichts und setzt keine Cookies, bis wir ausdruecklich freigeben.
      window.fbq('consent', 'revoke');
      window.fbq('init', PIXEL_ID);
      window.fbq('track', 'PageView');
      if (zustimmung()) { window.fbq('consent', 'grant'); }
    } catch (e) { /* Werbe-Telemetrie bricht nie eine Seite */ }
  }

  var EREIGNISSE = {
    search_availability: function (d) {
      return ['Search', { content_category: d && d.location ? d.location : undefined }];
    },
    select_offer: function (d) {
      return ['ViewContent', { value: d && d.total_price, currency: (d && d.currency) || 'CHF' }];
    },
    begin_checkout: function (d) {
      var wert = (d && d.total_price) || 0;
      if (d && d.extras_total) { wert += d.extras_total; }
      return ['InitiateCheckout', { value: wert, currency: 'CHF' }];
    },
    booking_confirmed: function (d) {
      return ['Purchase', { value: d && d.total_price, currency: (d && d.currency) || 'CHF' }];
    }
  };

  function event(name, data, opts) {
    // Ohne Pixel oder ohne Zustimmung passiert nichts. Bewusst still.
    if (!PIXEL_ID || !zustimmung() || typeof window.fbq !== 'function') { return; }
    var bau = EREIGNISSE[name];
    if (!bau) { return; }  // alles nicht Gelistete bleibt bei uns
    try {
      var teile = bau(data || {});
      var params = teile[1] || {};
      Object.keys(params).forEach(function (k) {
        if (params[k] === undefined || params[k] === null || params[k] === '') { delete params[k]; }
      });
      // Dedup-Klammer zur Server-Meldung: dieselbe Buchungsnummer auf beiden
      // Seiten, sonst zaehlt Meta denselben Kauf zweimal. Die Nummer steckt
      // bereits im data-Objekt (GA4 nutzt sie als transaction_id), deshalb
      // bleiben die Aufrufstellen unveraendert.
      if (!(opts && opts.eventID) && name === 'booking_confirmed' && data && data.booking_id) {
        opts = { eventID: data.booking_id };
      }
      if (opts && opts.eventID) {
        window.fbq('track', teile[0], params, { eventID: String(opts.eventID) });
      } else {
        window.fbq('track', teile[0], params);
      }
    } catch (e) { /* nie werfen */ }
  }

  // ---- Start ---------------------------------------------------------------

  window.amMeta = { event: event, tracking: tracking };

  try {
    speichern();
    // Der Pixel laedt NUR nach erteilter Einwilligung. Schon das Anfordern von
    // fbevents.js uebertraegt IP, User-Agent und Referrer an Meta - das darf erst
    // geschehen, wenn zugestimmt wurde, so sagt es auch das Banner zu.
    // Dieser Aufruf greift den Wiederkehrer mit gespeicherter Zustimmung ab;
    // consent.js meldet jeden spaeteren Wechsel an den Listener darunter, weil
    // meta.js mit defer laedt und damit NACH dem synchronen Erstlauf laeuft.
    if (zustimmung()) { pixelLaden(); }
    document.addEventListener('am:consent-change', function (ev) {
      var state = ev && ev.detail ? ev.detail.state : null;
      if (state === 'granted') {
        speichern();
        pixelLaden();
        try { if (window.fbq) { window.fbq('consent', 'grant'); } } catch (e) {}
      } else {
        try { if (window.fbq) { window.fbq('consent', 'revoke'); } } catch (e) {}
        try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
      }
    });
  } catch (e) { /* nie werfen */ }
})();
