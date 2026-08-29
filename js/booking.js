/*
 * Chalet Swiss Internet Booking Engine (IBE)
 * Version 2.0 — Kurtaxe (city tax) is shown and charged online (brutto pricing).
 * Version 1.0 (city tax collected at check-in) is preserved on the `main` branch.
 */
(function () {
'use strict';

var IBE_VERSION = '2.0';
var API_BASE = window.CHALETSWISS_API_BASE || 'https://amanthos-website-api.onrender.com';
var PROPERTY_ID = 'HCSI';
try { console.info('Chalet Swiss IBE v' + IBE_VERSION + ' (city tax brutto)'); } catch (e) {}

// Warteschlange von gtag.js. Der GTM-Container ist weg; die Zeile bleibt, weil
// gtag.js denselben window.dataLayer benutzt und ihn vorfinden muss.
window.dataLayer = window.dataLayer || [];
// Plausible: dieselbe Event-Taxonomie wie GTM, aber ausschliesslich mit einer
// abschliessenden Merkmals-Whitelist. Keine IDs, keine Namen, keine E-Mail --
// booking_id, reservation_id, promo_code und error_message bleiben draussen.
function plausibleEvent(name, data) {
  try {
    window.plausible = window.plausible || function () {
      (window.plausible.q = window.plausible.q || []).push(arguments);
    };
    var props = {};
    ['location', 'nights', 'step'].forEach(function (k) {
      if (data && data[k] !== undefined) props[k] = data[k];
    });
    var opts = { props: props };
    // Umsatz nur an der bestaetigten Buchung. select_offer und begin_checkout
    // tragen ebenfalls total_price, sind aber kein Erloes -- wer sie mitzaehlt,
    // meldet jede Angebotsansicht als Umsatz und zaehlt dreifach.
    // payment_completed waere fachlich richtiger, traegt im Code aber keinen
    // Betrag; der Umsatz zaehlt deshalb bestaetigte, nicht bezahlte Buchungen.
    if (name === 'booking_confirmed' && data &&
        typeof data.total_price === 'number' && data.total_price > 0) {
      opts.revenue = { amount: data.total_price, currency: data.currency || 'CHF' };
    }
    window.plausible(name, opts);
  } catch (e) { /* Analytics darf die Buchungsstrecke nie brechen */ }
}

// GA4: dieselbe Event-Taxonomie, uebersetzt auf die GA4-Standardnamen. Die
// Parameterliste je Ereignis ist abschliessend -- das data-Objekt wird NIE als
// Ganzes durchgereicht, sonst wandern check_in, promo_code oder error_message
// unbemerkt mit. Verboten bleiben Namen, E-Mail, Telefon, Reisedaten,
// Gutscheincodes, Fehlertexte und jeder Formularinhalt; einzige zulaessige
// Kennung ist transaction_id (die Buchungsnummer, damit ein Umsatz nicht
// doppelt gezaehlt wird).
function ga4Event(name, data) {
  try {
    if (typeof window.gtag !== 'function') return;
    var d = data || {};
    var waehrung = d.currency || 'CHF';
    switch (name) {
      case 'search_availability':
        // guests ist die Zahl der Erwachsenen, keine Personenangabe; children
        // und die Reisedaten bleiben bewusst draussen.
        window.gtag('event', 'search_availability', {
          location: d.location,
          guests: d.guests
        });
        break;
      case 'view_offers':
        window.gtag('event', 'view_item_list', {
          item_list_name: d.location,
          offer_count: d.offer_count
        });
        break;
      case 'select_offer':
        window.gtag('event', 'select_item', {
          currency: waehrung,
          items: [{
            item_name: d.rate_name,
            item_category: d.unit_type,
            item_variant: d.category,
            price: d.total_price,
            quantity: 1
          }]
        });
        break;
      case 'begin_checkout':
        window.gtag('event', 'begin_checkout', {
          currency: waehrung,
          value: (d.total_price || 0) + (d.extras_total || 0),
          items: [{ item_name: d.rate_name, quantity: 1 }]
        });
        break;
      case 'submit_booking':
        window.gtag('event', 'submit_booking', {
          location: d.location,
          rate_name: d.rate_name
        });
        break;
      case 'booking_confirmed':
        window.gtag('event', 'purchase', {
          transaction_id: d.booking_id,
          value: d.total_price,
          currency: waehrung
        });
        break;
      case 'payment_initiated':
        window.gtag('event', 'payment_initiated', { transaction_id: d.booking_id });
        break;
      case 'payment_completed':
        // Bewusst ohne value: der Umsatz zaehlt genau einmal, am purchase.
        // Dieselbe Entscheidung wie im Plausible-Revenue-Kommentar oben.
        window.gtag('event', 'payment_completed', { transaction_id: d.booking_id });
        break;
      case 'booking_cancelled_no_payment':
        // reservation_id des Callsites bleibt draussen, nur die Buchungsnummer.
        window.gtag('event', 'booking_cancelled_no_payment', { transaction_id: d.booking_id });
        break;
      case 'booking_error':
        // Kein error_message: Freitext kann Eingaben des Gastes enthalten.
        window.gtag('event', 'booking_error', { step: d.step });
        break;
      case 'promo_code_applied':
        // Ohne Parameter: Gutscheincodes verlassen den Browser nicht.
        window.gtag('event', 'promo_code_applied');
        break;
      default:
        break;
    }
  } catch (e) { /* Analytics darf die Buchungsstrecke nie brechen */ }
}

// Google Ads: eigene Kennung, eigener Transport, unabhaengig von GA4. Bis zum
// 29.08.2026 kamen die Kauf-Conversions dieser Seite als GA4-Import aus einer
// fremden Property (483757067), die nicht uns gehoert. Dieses Ereignis macht uns
// davon unabhaengig. Es haengt am booking_confirmed und nicht am
// payment_completed: die Adyen-Zahlung verlaesst auf dem Handy die Seite und kehrt
// ohne verwertbaren Zustand zurueck, dort wuerde payment_completed nie feuern.
// Gezaehlt wird die bestaetigte Reservierung; um Stornos und Nichtanreisen
// korrigiert der woechentliche ROAS-Report aus echten Apaleo-Umsaetzen.
var ADS_CONVERSION_ID = 'AW-702540316';
var ADS_CONVERSION_LABEL = 'WUE8CKyJg4kcEJzU_84C';

function adsEvent(name, data) {
  try {
    if (typeof window.gtag !== 'function') return;
    if (name !== 'booking_confirmed') return;
    var d = data || {};
    window.gtag('event', 'conversion', {
      send_to: ADS_CONVERSION_ID + '/' + ADS_CONVERSION_LABEL,
      value: d.total_price || 0,
      currency: d.currency || 'CHF',
      transaction_id: d.booking_id || ''
    });
  } catch (e) { /* Analytics darf die Buchungsstrecke nie brechen */ }
}

function gtmPush(event, data) {
  try { plausibleEvent(event, data); } catch (e) { /* nie die Buchung brechen */ }
  try { ga4Event(event, data); } catch (e) { /* nie die Buchung brechen */ }
  try { adsEvent(event, data); } catch (e) { /* nie die Buchung brechen */ }
  // dataLayer.push entfernt: gtag.js nutzt denselben dataLayer, ein
  // {event:...}-Push wuerde Ereignisse doppelt ausloesen (GTM ist weg, der
  // Transport ist tot).
  try { if (window.amMeta) window.amMeta.event(event, data); } catch (e) { /* nie die Buchung brechen */ }
}

var selectedOffer = null;
var currentOffers = [];
var searchParams = {};

// Apaleo rate plan code → IBE display mapping for HCSI (Chalet Swiss)
// Codes come from Apaleo /booking/offers (offer.ratePlanCode / ratePlanId).
// Mapping handles: category fallback (if Apaleo doesn't classify), friendly
// display name, and optional discount badge.
var RATE_PLAN_MAP = {
  'NONREFBB_IBE': {
    category: 'Non-Refundable',
    displayKey: 'booking.rateplan_nonrefbb_ibe',
    displayFallback: 'Loyalty Rate — Non-Refundable',
    discountBadgeKey: 'booking.rateplan_loyalty_badge',
    discountBadgeFallback: '11% Loyalty Discount'
  },
  'STANDARDBB_IBE': {
    category: 'Refundable',
    displayKey: 'booking.rateplan_standardbb_ibe',
    displayFallback: 'Standard Rate — Free Cancellation',
    discountBadgeKey: 'booking.rateplan_loyalty_badge',
    discountBadgeFallback: '11% Loyalty Discount'
  }
};

function getRatePlanMapping(offer) {
  var code = (offer.ratePlanCode || offer.ratePlanId || '').toString().toUpperCase();
  // Tolerate property-prefixed codes ("HCSI-NONREFBB_IBE") or extra suffixes
  var direct = RATE_PLAN_MAP[code];
  if (direct) return direct;
  for (var key in RATE_PLAN_MAP) {
    if (RATE_PLAN_MAP.hasOwnProperty(key) && code.indexOf(key) !== -1) return RATE_PLAN_MAP[key];
  }
  return null;
}

// Apaleo unit group name → IBE display name mapping.
// Apaleo returns the raw unit group name (varies per property setup); we
// override it client-side so the availability cards match the room names
// used on the rest of the website. `match` tests run case-insensitive
// against the trimmed Apaleo name; first hit wins, so put more specific
// patterns first.
var UNIT_GROUP_NAME_MAP = [
  { match: ['superior twin balcony', 'superior twin balkon', 'superior zwillingszimmer', 'superior doppel oder twin', 'superior doppelzimmer mit balkon und bergblick', 'superior double or twin', 'superior double room with balcony'], nameKey: 'rooms.name_superior_twin', fallback: 'Superior Double or Twin with Mountain View' },
  { match: ['superior double', 'superior doppel', 'superior doppelzimmer', 'double with balcony', 'doppel mit balkon', 'doppelzimmer mit balkon'], nameKey: 'rooms.name_superior_double', fallback: 'Double with Balcony' },
  { match: ['standard double', 'standard doppel', 'doppelzimmer standard', 'standard double/twin', 'standard doppel/twin', 'standard double / twin', 'standard doppel / twin'], nameKey: 'rooms.name_standard_double', fallback: 'Standard Double / Twin' },
  { match: ['family room 4', 'familienzimmer 4', 'familienzimmer (4)', 'familienzimmer 4 bett', 'family room 4 bed'], nameKey: 'rooms.name_family_4', fallback: 'Family Room 4 Bed' },
  { match: ['family room 3', 'familienzimmer 3', 'familienzimmer (3)', 'familienzimmer 3 bett', 'family room 3 bed'], nameKey: 'rooms.name_family_3', fallback: 'Family Room 3 Bed' },
  { match: ['single room', 'einzelzimmer'], nameKey: 'rooms.name_single', fallback: 'Single Room' }
];

function getDisplayUnitGroupName(apaleoName) {
  var raw = (apaleoName || '').toString().trim().toLowerCase();
  if (!raw) return apaleoName || '';
  for (var i = 0; i < UNIT_GROUP_NAME_MAP.length; i++) {
    var entry = UNIT_GROUP_NAME_MAP[i];
    for (var j = 0; j < entry.match.length; j++) {
      if (raw.indexOf(entry.match[j]) !== -1) {
        var translated = window.t ? window.t(entry.nameKey) : entry.fallback;
        if (translated === entry.nameKey) translated = entry.fallback;
        return translated;
      }
    }
  }
  return apaleoName;
}

function normalizeOffer(offer) {
  if (!offer) return offer;
  var mapping = getRatePlanMapping(offer);
  if (mapping) {
    if (!offer.category) offer.category = mapping.category;
    offer._displayName = window.t ? window.t(mapping.displayKey) : mapping.displayFallback;
    if (offer._displayName === mapping.displayKey) offer._displayName = mapping.displayFallback;
    if (mapping.discountBadgeKey) {
      var badge = window.t ? window.t(mapping.discountBadgeKey) : mapping.discountBadgeFallback;
      if (badge === mapping.discountBadgeKey) badge = mapping.discountBadgeFallback;
      offer._discountBadge = badge;
    }
  } else if (!offer.category) {
    // Generic fallback when ratePlanCode is unknown
    var code2 = (offer.ratePlanCode || offer.ratePlanId || '').toString().toUpperCase();
    if (code2.indexOf('NONREF') !== -1) offer.category = 'Non-Refundable';
    else if (code2.indexOf('REF') !== -1 || code2.indexOf('STANDARD') !== -1) offer.category = 'Refundable';
  }
  offer._displayUnitGroupName = getDisplayUnitGroupName(offer.unitGroupName);
  return offer;
}

// Promo codes validated server-side
var PROMO_CODES = {};
var appliedPromo = null;

// Upsell add-ons configuration
var UPSELL_ITEMS = [
  { id: 'wine_red', icon: '\uD83C\uDF77', nameKey: 'booking.upsell_wine_red', descKey: 'booking.upsell_wine_red_desc', nameFallback: 'Rotwein (Flasche)', descFallback: 'Ausgewählter Schweizer Rotwein', price: 49.90 },
  { id: 'wine_white', icon: '\uD83E\uDD42', nameKey: 'booking.upsell_wine_white', descKey: 'booking.upsell_wine_white_desc', nameFallback: 'Weisswein (Flasche)', descFallback: 'Frischer Schweizer Weisswein', price: 49.90 },
  { id: 'beer', icon: '\uD83C\uDF7A', nameKey: 'booking.upsell_beer', descKey: 'booking.upsell_beer_desc', nameFallback: 'Bier (regional)', descFallback: 'Regionales Bier aus der Region', price: 6.90 },
  { id: 'roses_champagne', icon: '\uD83C\uDF39', nameKey: 'booking.upsell_roses_champagne', descKey: 'booking.upsell_roses_champagne_desc', nameFallback: 'Rosen & Champagner', descFallback: 'Rosenstrauss mit Champagner — bereit im Zimmer', price: 99.90 },
  { id: 'fondue_1', icon: '\uD83E\uDDC0', nameKey: 'booking.upsell_fondue_1', descKey: 'booking.upsell_fondue_1_desc', nameFallback: 'Fondue für 1', descFallback: 'Käsefondue für eine Person', price: 26.90 },
  { id: 'fondue_2', icon: '\uD83E\uDDC0', nameKey: 'booking.upsell_fondue_2', descKey: 'booking.upsell_fondue_2_desc', nameFallback: 'Fondue für 2', descFallback: 'Käsefondue für zwei Personen', price: 49.90 },
  { id: 'fondue_2_wine', icon: '\uD83C\uDF77', nameKey: 'booking.upsell_fondue_2_wine', descKey: 'booking.upsell_fondue_2_wine_desc', nameFallback: 'Fondue für 2 mit Wein', descFallback: 'Käsefondue für zwei inkl. Flasche Wein', price: 99.90 },
  { id: 'raclette_1', icon: '\uD83E\uDDC0', nameKey: 'booking.upsell_raclette_1', descKey: 'booking.upsell_raclette_1_desc', nameFallback: 'Raclette für 1', descFallback: 'Original Walliser Raclette für eine Person', price: 23.90 },
  { id: 'towels', icon: '\uD83D\uDEC1', nameKey: 'booking.upsell_towels', descKey: 'booking.upsell_towels_desc', nameFallback: 'Extra Handtücher', descFallback: 'Pro Nacht / Stück', price: 5, perDay: true },
  { id: 'blankets', icon: '\uD83D\uDECF\uFE0F', nameKey: 'booking.upsell_blankets', descKey: 'booking.upsell_blankets_desc', nameFallback: 'Extra Decke & Kissen', descFallback: 'Pro Nacht / Stück', price: 10, perDay: true },
  { id: 'locker', icon: '\uD83D\uDD12', nameKey: 'booking.upsell_locker', descKey: 'booking.upsell_locker_desc', nameFallback: 'Schliessfach', descFallback: 'Pro Tag', price: 5, perDay: true },
  { id: 'parking', icon: '\uD83C\uDD7F\uFE0F', nameKey: 'booking.upsell_parking', descKey: 'booking.upsell_parking_desc', nameFallback: 'Parkplatz', descFallback: 'Pro Tag', price: 5, perDay: true },
];
var selectedUpsells = {};

// Currency rounding — all CHF amounts go through this to avoid floating-point drift
function roundCHF(n) { return Math.round(n * 100) / 100; }

// City tax (Kurtaxe). The backend returns Apaleo's city tax for the searched
// adults only; scale it to all persons (incl. children) since every person pays
// the same per-night rate. Charged on top of the room, never discounted.
function getOfferCityTax(offer) {
  if (!offer || !offer.cityTax || !offer.cityTax.amount) return 0;
  var base = offer.cityTax.amount;
  var adults = parseInt(searchParams.adults) || 1;
  var children = parseInt(searchParams.children) || 0;
  if (adults <= 0) return roundCHF(base);
  return roundCHF(base * (adults + children) / adults);
}
function getCityTaxTotal() { return getOfferCityTax(selectedOffer); }

var searchBtn = document.getElementById('bookingSearchBtn');
var bookingSection = document.getElementById('booking');
var offersGrid = document.getElementById('offersGrid');
var offersLoading = document.getElementById('offersLoading');
var guestForm = document.getElementById('guestForm');
var confirmBtn = document.getElementById('confirmBookingBtn');
var cancelBtn = document.getElementById('cancelBookingBtn');
var bookingStatus = document.getElementById('bookingStatus');

// ========== CUSTOM CALENDAR ==========
var checkinEl = document.getElementById('bb-checkin');
var checkoutEl = document.getElementById('bb-checkout');
var nightsBadge = document.getElementById('nightsBadge');
var daterangeWrap = document.getElementById('daterangeWrap');
var daterangeLabel = document.getElementById('daterangeLabel');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function epoch(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

function getLocaleTag() {
  var lang = (window.getLang && window.getLang()) || 'de';
  return lang === 'en' ? 'en-GB' : 'de-CH';
}
function getMonthFull(idx) {
  return new Date(2000, idx, 1).toLocaleString(getLocaleTag(), { month: 'long' });
}
function getMonthShort(idx) {
  return new Date(2000, idx, 1).toLocaleString(getLocaleTag(), { month: 'short' }).replace('.', '');
}
function getDaysHead() {
  // Mon..Sun (week starts on Monday)
  var out = [];
  for (var i = 1; i <= 7; i++) {
    var d = new Date(2024, 0, i); // 2024-01-01 was a Monday
    out.push(d.toLocaleString(getLocaleTag(), { weekday: 'short' }).replace('.', ''));
  }
  return out;
}
function getDayName(jsDayIdx) {
  // jsDayIdx: 0=Sunday..6=Saturday
  var ref = new Date(2024, 0, 7 + jsDayIdx); // 2024-01-07 was Sunday → idx 0
  return ref.toLocaleString(getLocaleTag(), { weekday: 'short' }).replace('.', '');
}

function fmtDate(d) {
  var lang = (window.getLang && window.getLang()) || 'de';
  if (lang === 'en') {
    return getDayName(d.getDay()) + ', ' + getMonthShort(d.getMonth()) + ' ' + d.getDate();
  }
  return getDayName(d.getDay()) + ', ' + d.getDate() + '. ' + getMonthShort(d.getMonth());
}

document.addEventListener('languageChanged', function () {
  try {
    if (typeof updateGuestsLabel === 'function' && document.getElementById('guestsLabel')) {
      updateGuestsLabel();
    }
    if (cal && cal.el) {
      var head = cal.el.querySelector('.cal-head');
      if (head) head.innerHTML = getDaysHead().map(function (d) { return '<span>' + d + '</span>'; }).join('');
      cal.el.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        var v = window.t ? window.t(key) : null;
        if (v && v !== key) el.textContent = v;
      });
      cal.el.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-aria');
        var v = window.t ? window.t(key) : null;
        if (v && v !== key) el.setAttribute('aria-label', v);
      });
      renderCal();
    }
    if (currentOffers && currentOffers.length) {
      currentOffers = currentOffers.map(normalizeOffer);
      if (offersGrid && offersGrid.querySelectorAll('.offer-card').length) {
        renderOffers({ offers: currentOffers, nights: getBookingNights(), adults: searchParams.adults, arrival: searchParams.arrival, departure: searchParams.departure });
      }
    }
    if (typeof syncInputs === 'function') syncInputs();
  } catch (e) {}
});

var cal = {
  checkin: null, checkout: null,
  selecting: null,
  month: new Date().getMonth(),
  year: new Date().getFullYear(),
  hoverDate: null,
  el: null
};

function tFallback(key, fb) {
  if (!window.t) return fb;
  var v = window.t(key);
  return (v && v !== key) ? v : fb;
}

function buildCalendar() {
  var div = document.createElement('div');
  div.id = 'calDropdown';
  div.className = 'cal-dropdown';
  div.innerHTML =
    '<div class="cal-picks">' +
      '<button class="cal-pick" data-pick="tonight" data-i18n="booking.cal_pick_tonight">' + tFallback('booking.cal_pick_tonight', 'Heute Nacht') + '</button>' +
      '<button class="cal-pick" data-pick="weekend" data-i18n="booking.cal_pick_weekend">' + tFallback('booking.cal_pick_weekend', 'Dieses WE') + '</button>' +
      '<button class="cal-pick" data-pick="next-weekend" data-i18n="booking.cal_pick_next_weekend">' + tFallback('booking.cal_pick_next_weekend', 'Nächstes WE') + '</button>' +
      '<button class="cal-pick" data-pick="week" data-i18n="booking.cal_pick_week">' + tFallback('booking.cal_pick_week', '1 Woche') + '</button>' +
    '</div>' +
    '<div class="cal-nav">' +
      '<button class="cal-nav-btn cal-prev" data-i18n-aria="booking.cal_prev_month" aria-label="' + tFallback('booking.cal_prev_month', 'Vorheriger Monat') + '">\u2039</button>' +
      '<span class="cal-title"></span>' +
      '<button class="cal-nav-btn cal-next" data-i18n-aria="booking.cal_next_month" aria-label="' + tFallback('booking.cal_next_month', 'Nächster Monat') + '">\u203A</button>' +
    '</div>' +
    '<div class="cal-head">' + getDaysHead().map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
    '<div class="cal-body"></div>' +
    '<div class="cal-foot"><span class="cal-info"></span></div>';
  document.body.appendChild(div);
  cal.el = div;

  div.querySelector('.cal-prev').addEventListener('click', function (e) {
    e.stopPropagation();
    cal.month--;
    if (cal.month < 0) { cal.month = 11; cal.year--; }
    renderCal();
  });
  div.querySelector('.cal-next').addEventListener('click', function (e) {
    e.stopPropagation();
    cal.month++;
    if (cal.month > 11) { cal.month = 0; cal.year++; }
    renderCal();
  });

  div.querySelectorAll('.cal-pick').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      quickPick(this.dataset.pick);
    });
  });

  div.querySelector('.cal-body').addEventListener('click', function (e) {
    var btn = e.target.closest('button.cal-day');
    if (!btn || btn.classList.contains('disabled') || btn.classList.contains('empty')) return;
    e.preventDefault();
    e.stopPropagation();
    var d = parseInt(btn.dataset.day);
    pickDate(new Date(cal.year, cal.month, d, 12, 0, 0));
  });

  div.querySelector('.cal-body').addEventListener('mouseover', function (e) {
    var btn = e.target.closest('button.cal-day');
    if (!btn || btn.classList.contains('disabled') || btn.classList.contains('empty')) return;
    if (cal.selecting !== 'checkout') return;
    var d = parseInt(btn.dataset.day);
    var hDate = new Date(cal.year, cal.month, d, 12, 0, 0);
    if (cal.checkin && epoch(hDate) <= epoch(cal.checkin)) return;
    if (cal.hoverDate && epoch(cal.hoverDate) === epoch(hDate)) return;
    cal.hoverDate = hDate;
    updateRangeHighlight();
  });
  div.querySelector('.cal-body').addEventListener('mouseleave', function () {
    if (cal.hoverDate) {
      cal.hoverDate = null;
      updateRangeHighlight();
    }
  });

  document.addEventListener('click', function (e) {
    if (!cal.el || !cal.el.classList.contains('open')) return;
    if (cal.el.contains(e.target)) return;
    if (daterangeWrap && (e.target === daterangeWrap || daterangeWrap.contains(e.target))) return;
    closeCal();
  });

  window.addEventListener('scroll', function () {
    if (cal.el && cal.el.classList.contains('open') && cal.selecting) positionCal(cal.selecting);
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (cal.el && cal.el.classList.contains('open') && cal.selecting) positionCal(cal.selecting);
  });
}

function positionCal(mode) {
  if (!cal.el) return;
  var wrap = daterangeWrap;
  if (!wrap) return;
  var rect = wrap.getBoundingClientRect();
  var calW = 320;
  var calH = cal.el.offsetHeight || 400;
  // Center under the dates field
  var left = rect.left + (rect.width / 2) - (calW / 2);
  var top = rect.bottom + 10;
  // Keep within viewport
  if (left + calW > window.innerWidth - 16) left = window.innerWidth - calW - 16;
  if (left < 16) left = 16;
  if (top + calH > window.innerHeight - 16) top = rect.top - calH - 10;
  cal.el.style.left = left + 'px';
  cal.el.style.top = top + 'px';
}

function openCal(mode) {
  if (!cal.el) buildCalendar();
  cal.selecting = mode;
  var ref = mode === 'checkin' ? cal.checkin : (cal.checkout || cal.checkin);
  if (ref) { cal.month = ref.getMonth(); cal.year = ref.getFullYear(); }
  renderCal();
  positionCal(mode);
  cal.el.classList.add('open');
}

function closeCal() {
  if (cal.el) cal.el.classList.remove('open');
  cal.hoverDate = null;
}

function pickDate(date) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  if (date < today) return;

  if (cal.selecting === 'checkin') {
    // Set check-in, clear checkout if it's before the new checkin
    cal.checkin = date;
    if (cal.checkout && epoch(cal.checkout) <= epoch(date)) cal.checkout = null;
    cal.selecting = 'checkout';
    syncInputs();
    renderCal();
  } else {
    // Checkout mode
    if (!cal.checkin || epoch(date) <= epoch(cal.checkin)) {
      // Clicked on or before checkin → treat as new checkin
      cal.checkin = date;
      cal.checkout = null;
      cal.selecting = 'checkout';
      syncInputs();
      renderCal();
    } else {
      // Valid checkout date → set it and close
      cal.checkout = date;
      syncInputs();
      closeCal();
    }
  }
}

function quickPick(type) {
  var today = new Date(); today.setHours(12, 0, 0, 0);
  var dow = today.getDay();
  if (type === 'tonight') {
    cal.checkin = new Date(today);
    cal.checkout = new Date(today.getTime() + 86400000);
  } else if (type === 'weekend') {
    var d2f = (5 - dow + 7) % 7;
    if (d2f === 0 && dow === 5) d2f = 0; else if (d2f === 0) d2f = 7;
    var fri = new Date(today); fri.setDate(today.getDate() + d2f);
    cal.checkin = fri;
    cal.checkout = new Date(fri.getTime() + 2 * 86400000);
  } else if (type === 'next-weekend') {
    var d2f = (5 - dow + 7) % 7; if (d2f <= 0) d2f += 7; d2f += 7;
    var fri = new Date(today); fri.setDate(today.getDate() + d2f);
    cal.checkin = fri;
    cal.checkout = new Date(fri.getTime() + 2 * 86400000);
  } else if (type === 'week') {
    var d2f = (5 - dow + 7) % 7; if (d2f < 2) d2f += 7;
    var fri = new Date(today); fri.setDate(today.getDate() + d2f);
    cal.checkin = fri;
    cal.checkout = new Date(fri.getTime() + 7 * 86400000);
  }
  syncInputs();
  closeCal();
}

function renderCal() {
  if (!cal.el) return;
  cal.el.querySelector('.cal-title').textContent = getMonthFull(cal.month) + ' ' + cal.year;
  var infoKey = cal.selecting === 'checkin' ? 'booking.calendar_select_checkin' : 'booking.calendar_select_checkout';
  var infoFallback = cal.selecting === 'checkin' ? 'Anreisedatum wählen' : 'Abreisedatum wählen';
  cal.el.querySelector('.cal-info').textContent = window.t ? window.t(infoKey) : infoFallback;

  var first = new Date(cal.year, cal.month, 1);
  var daysInMonth = new Date(cal.year, cal.month + 1, 0).getDate();
  var startDow = (first.getDay() + 6) % 7;
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var html = '';
  for (var i = 0; i < startDow; i++) html += '<span class="cal-day empty"></span>';

  for (var d = 1; d <= daysInMonth; d++) {
    var date = new Date(cal.year, cal.month, d, 12, 0, 0);
    var t = epoch(date);
    var cls = 'cal-day';
    // Only truly disable past dates — everything else is clickable
    if (date < today) {
      cls += ' disabled';
    }
    if (d === today.getDate() && cal.month === today.getMonth() && cal.year === today.getFullYear()) cls += ' today';
    if (cal.checkin && t === epoch(cal.checkin)) cls += ' selected';
    if (cal.checkout && t === epoch(cal.checkout)) cls += ' selected';
    var rangeEnd = cal.checkout || cal.hoverDate;
    if (cal.checkin && rangeEnd && t > epoch(cal.checkin) && t < epoch(rangeEnd)) cls += ' in-range';
    html += '<button type="button" class="' + cls + '" data-day="' + d + '">' + d + '</button>';
  }
  cal.el.querySelector('.cal-body').innerHTML = html;

  var prevBtn = cal.el.querySelector('.cal-prev');
  var now = new Date();
  prevBtn.style.opacity = (cal.year === now.getFullYear() && cal.month === now.getMonth()) ? '.2' : '';
  prevBtn.style.pointerEvents = (cal.year === now.getFullYear() && cal.month === now.getMonth()) ? 'none' : '';
}

function updateRangeHighlight() {
  if (!cal.el) return;
  var days = cal.el.querySelectorAll('.cal-day[data-day]');
  var rangeEnd = cal.checkout || cal.hoverDate;
  for (var i = 0; i < days.length; i++) {
    var d = parseInt(days[i].dataset.day);
    var t = epoch(new Date(cal.year, cal.month, d, 12, 0, 0));
    if (cal.checkin && rangeEnd && t > epoch(cal.checkin) && t < epoch(rangeEnd)) {
      days[i].classList.add('in-range');
    } else {
      days[i].classList.remove('in-range');
    }
  }
}

function syncInputs() {
  if (checkinEl) {
    checkinEl.dataset.date = cal.checkin ? toISO(cal.checkin) : '';
  }
  if (checkoutEl) {
    checkoutEl.dataset.date = cal.checkout ? toISO(cal.checkout) : '';
  }
  if (daterangeLabel) {
    if (cal.checkin && cal.checkout) {
      daterangeLabel.textContent = fmtDate(cal.checkin) + '  \u2192  ' + fmtDate(cal.checkout);
      daterangeLabel.classList.add('has-value');
    } else if (cal.checkin) {
      daterangeLabel.textContent = fmtDate(cal.checkin) + '  \u2192  ...';
      daterangeLabel.classList.add('has-value');
    } else {
      daterangeLabel.textContent = window.t ? window.t('booking_bar.set_dates') : 'Reisedaten festlegen';
      daterangeLabel.classList.remove('has-value');
    }
  }
  updateNightsBadge();
}

function updateNightsBadge() {
  if (!nightsBadge) return;
  if (cal.checkin && cal.checkout) {
    var nights = Math.round((epoch(cal.checkout) - epoch(cal.checkin)) / 86400000);
    if (nights > 0) {
      var nightLbl = nights === 1
        ? tFallback('booking.night', 'Nacht')
        : tFallback('booking.nights', 'Nächte');
      nightsBadge.textContent = nights + ' ' + nightLbl;
      nightsBadge.classList.add('visible');
      return;
    }
  }
  nightsBadge.classList.remove('visible');
}

// Attach date range click handler
if (daterangeWrap) {
  daterangeWrap.addEventListener('click', function (e) {
    e.stopPropagation();
    if (guestsDropdown && guestsDropdown.classList.contains('open')) guestsDropdown.classList.remove('open');
    if (cal.el && cal.el.classList.contains('open')) {
      closeCal();
      return;
    }
    // If only checkin is set, continue with checkout; otherwise start fresh with checkin
    var mode = (cal.checkin && !cal.checkout) ? 'checkout' : 'checkin';
    // If both dates are already set, reset and start fresh
    if (cal.checkin && cal.checkout) {
      cal.checkin = null;
      cal.checkout = null;
      syncInputs();
      mode = 'checkin';
    }
    openCal(mode);
  });
}

// No smart defaults — start clean like chaletswiss.ch
buildCalendar();

// ========== GUESTS DROPDOWN (Adults + Children) ==========
var guestsWrap = document.getElementById('guestsWrap');
var guestsLabel = document.getElementById('guestsLabel');
var guestInput = document.getElementById('bb-guests');
var childInput = document.getElementById('bb-children');
var guestsDropdown = null;

function buildGuestsDropdown() {
  var div = document.createElement('div');
  div.id = 'guestsDropdown';
  div.className = 'guests-dropdown';
  div.innerHTML =
    '<div class="guests-row">' +
      '<span class="guests-row-label" data-i18n="booking_bar.adults">Erwachsene</span>' +
      '<div class="guests-stepper">' +
        '<button type="button" class="guests-step" id="adultMinus" aria-label="Weniger">\u2212</button>' +
        '<span class="guests-count" id="adultCount">2</span>' +
        '<button type="button" class="guests-step" id="adultPlus" aria-label="Mehr">+</button>' +
      '</div>' +
    '</div>' +
    '<div class="guests-row">' +
      '<span class="guests-row-label" data-i18n="booking_bar.children">Kinder</span>' +
      '<div class="guests-stepper">' +
        '<button type="button" class="guests-step" id="childMinus" aria-label="Weniger">\u2212</button>' +
        '<span class="guests-count" id="childCount">0</span>' +
        '<button type="button" class="guests-step" id="childPlus" aria-label="Mehr">+</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(div);
  guestsDropdown = div;

  // Apply translations to dropdown labels if loaded
  div.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    var val = window.t ? window.t(key) : null;
    if (val && val !== key) el.textContent = val;
  });

  // Update on language change
  document.addEventListener('languageChanged', function () {
    if (!guestsDropdown) return;
    guestsDropdown.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = window.t ? window.t(key) : null;
      if (val && val !== key) el.textContent = val;
    });
    updateGuestsLabel();
  });

  div.querySelector('#adultMinus').addEventListener('click', function (e) { e.stopPropagation(); updateGuestCount('adults', -1); });
  div.querySelector('#adultPlus').addEventListener('click', function (e) { e.stopPropagation(); updateGuestCount('adults', 1); });
  div.querySelector('#childMinus').addEventListener('click', function (e) { e.stopPropagation(); updateGuestCount('children', -1); });
  div.querySelector('#childPlus').addEventListener('click', function (e) { e.stopPropagation(); updateGuestCount('children', 1); });

  document.addEventListener('click', function (e) {
    if (!guestsDropdown || !guestsDropdown.classList.contains('open')) return;
    if (guestsDropdown.contains(e.target)) return;
    if (guestsWrap && (e.target === guestsWrap || guestsWrap.contains(e.target))) return;
    closeGuestsDropdown();
  });

  window.addEventListener('scroll', function () {
    if (guestsDropdown && guestsDropdown.classList.contains('open')) positionGuestsDropdown();
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (guestsDropdown && guestsDropdown.classList.contains('open')) positionGuestsDropdown();
  });
}

// HCSI (Chalet Swiss): höchste Belegung = 4 (Family Room 4 Bed, 1-4).
// Immer mind. 1 Erwachsener; Kinder = Max - Erwachsene; Total <= Max.
function updateGuestCount(type, dir) {
  var MAX = 4;
  var adults = parseInt(guestInput.value) || 1;
  var children = parseInt(childInput.value) || 0;
  if (type === 'adults') {
    var na = Math.max(1, Math.min(MAX, adults + dir));
    if (na + children > MAX) na = Math.max(1, MAX - children);
    guestInput.value = na;
    var el = document.getElementById('adultCount');
    if (el) el.textContent = na;
  } else {
    var nc = Math.max(0, Math.min(MAX - adults, children + dir));
    childInput.value = nc;
    var el = document.getElementById('childCount');
    if (el) el.textContent = nc;
  }
  updateGuestsLabel();
}

function updateGuestsLabel() {
  if (!guestsLabel) return;
  var adults = parseInt(guestInput.value) || 1;
  var children = parseInt(childInput.value) || 0;
  var label = adults + ' ' + (adults === 1 ? (window.t ? window.t('booking.adult_singular') : 'Erwachsener') : (window.t ? window.t('booking.adults_plural') : 'Erwachsene'));
  if (children > 0) {
    label += ', ' + children + ' ' + (children === 1 ? (window.t ? window.t('booking.child_singular') : 'Kind') : (window.t ? window.t('booking.children_plural') : 'Kinder'));
  }
  guestsLabel.textContent = label;
  guestsLabel.classList.add('has-value');
}

function positionGuestsDropdown() {
  if (!guestsDropdown || !guestsWrap) return;
  var rect = guestsWrap.getBoundingClientRect();
  var ddW = 260;
  var left = rect.left + (rect.width / 2) - (ddW / 2);
  var top = rect.bottom + 10;
  if (left + ddW > window.innerWidth - 16) left = window.innerWidth - ddW - 16;
  if (left < 16) left = 16;
  if (top + guestsDropdown.offsetHeight > window.innerHeight - 16) top = rect.top - guestsDropdown.offsetHeight - 10;
  guestsDropdown.style.left = left + 'px';
  guestsDropdown.style.top = top + 'px';
}

function openGuestsDropdown() {
  if (!guestsDropdown) buildGuestsDropdown();
  positionGuestsDropdown();
  guestsDropdown.classList.add('open');
}

function closeGuestsDropdown() {
  if (guestsDropdown) guestsDropdown.classList.remove('open');
}

if (guestsWrap) {
  guestsWrap.addEventListener('click', function (e) {
    e.stopPropagation();
    if (cal.el && cal.el.classList.contains('open')) closeCal();
    if (guestsDropdown && guestsDropdown.classList.contains('open')) {
      closeGuestsDropdown();
    } else {
      openGuestsDropdown();
    }
  });
}


function showValidation(el, msg) {
  if (!el) return;
  var existing = el.parentElement.querySelector('.validation-msg');
  if (existing) existing.remove();
  var span = document.createElement('span');
  span.className = 'validation-msg';
  span.textContent = msg;
  span.style.cssText = 'color:var(--color-error);font-size:.78rem;font-weight:500;margin-top:.25rem;display:block;';
  span.setAttribute('role', 'alert');
  el.parentElement.appendChild(span);
  el.style.borderColor = 'var(--color-error)';
  el.focus();
  el.addEventListener('input', function handler() {
    el.style.borderColor = '';
    var m = el.parentElement.querySelector('.validation-msg');
    if (m) m.remove();
    el.removeEventListener('input', handler);
  });
}

// Wake backend on idle
function wakeBackend() {
  fetch(API_BASE + '/health', { mode: 'cors' }).catch(function () {});
}
if ('requestIdleCallback' in window) {
  requestIdleCallback(wakeBackend);
} else {
  setTimeout(wakeBackend, 3000);
}

// Inline validation on blur
['guest-first', 'guest-last', 'guest-email'].forEach(function (id) {
  var field = document.getElementById(id);
  if (!field) return;
  field.addEventListener('blur', function () {
    var val = this.value.trim();
    var existing = this.parentElement.querySelector('.validation-msg');
    if (existing) existing.remove();
    this.style.borderColor = '';
    if (!val) {
      showValidation(this, window.t ? window.t('booking.validation_required') : 'Dieses Feld ist erforderlich.');
    } else if (id === 'guest-email' && !isValidEmail(val)) {
      showValidation(this, window.t ? window.t('booking.validation_valid_email') : 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
    } else {
      this.style.borderColor = 'var(--color-success)';
    }
  });
});

// Promo code
var applyPromoBtn = document.getElementById('applyPromoBtn');
if (applyPromoBtn) {
  applyPromoBtn.addEventListener('click', applyPromoCode);
}
var promoInput = document.getElementById('promoCodeInput');
if (promoInput) {
  promoInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyPromoCode(); }
  });
}

// Search button
if (searchBtn) {
  searchBtn.addEventListener('click', function () {
    var checkin = document.getElementById('bb-checkin');
    var checkout = document.getElementById('bb-checkout');
    var guests = document.getElementById('bb-guests');
    var childrenEl = document.getElementById('bb-children');
    var checkinVal = checkin ? (checkin.dataset.date || '') : '';
    var checkoutVal = checkout ? (checkout.dataset.date || '') : '';
    var guestsVal = guests ? guests.value : '2';
    var childrenVal = childrenEl ? childrenEl.value : '0';

    if (!checkinVal || !checkoutVal) {
      // Open calendar to let user pick dates
      if (daterangeWrap) daterangeWrap.click();
      return;
    }
    if (checkoutVal <= checkinVal) {
      cal.checkin = null; cal.checkout = null; syncInputs();
      if (daterangeWrap) daterangeWrap.click();
      return;
    }

    searchParams = {
      propertyId: PROPERTY_ID,
      arrival: checkinVal,
      departure: checkoutVal,
      adults: guestsVal,
      children: childrenVal,
    };
    gtmPush('search_availability', {
      location: 'Hotel Chalet Swiss',
      check_in: checkinVal,
      check_out: checkoutVal,
      guests: guestsVal,
    });
    fetchOffers();
  });
}

function showSkeletonCards() {
  if (!offersGrid) return;
  var html = '';
  for (var s = 0; s < 3; s++) {
    html += '<div class="skeleton-card" aria-hidden="true">';
    html += '<div class="skeleton skeleton-line w-40"></div>';
    html += '<div class="skeleton skeleton-line h-md w-60"></div>';
    html += '<div class="skeleton skeleton-line w-80"></div>';
    html += '<div class="skeleton skeleton-line h-lg w-40"></div>';
    html += '<div class="skeleton skeleton-line w-60"></div>';
    html += '<div class="skeleton skeleton-line h-btn w-100"></div>';
    html += '</div>';
  }
  offersGrid.innerHTML = html;
}

function fetchOffers() {
  if (!bookingSection || !offersGrid || !offersLoading) return;
  bookingSection.style.display = 'block';
  offersGrid.innerHTML = '';
  if (guestForm) guestForm.style.display = 'none';
  if (bookingStatus) bookingStatus.style.display = 'none';
  selectedOffer = null;
  showSkeletonCards();

  setTimeout(function () {
    bookingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);

  var query = '';
  var keys = Object.keys(searchParams);
  for (var i = 0; i < keys.length; i++) {
    if (i > 0) query += '&';
    query += encodeURIComponent(keys[i]) + '=' + encodeURIComponent(searchParams[keys[i]]);
  }

  fetch(API_BASE + '/api/offers?' + query, { mode: 'cors' })
  .then(function (res) {
    if (!res.ok) {
      return res.json().then(function (errData) {
        throw new Error(errData.error || 'Failed to fetch offers (HTTP ' + res.status + ')');
      }).catch(function () {
        throw new Error('Failed to fetch offers (HTTP ' + res.status + ')');
      });
    }
    return res.json();
  })
  .then(function (data) {
    offersLoading.style.display = 'none';
    currentOffers = (data.offers || []).map(normalizeOffer);
    gtmPush('view_offers', {
      location: 'Hotel Chalet Swiss',
      offer_count: currentOffers.length,
    });
    if (currentOffers.length === 0) {
      offersGrid.innerHTML = '<div class="no-offers"><p>' + (window.t ? window.t('booking.no_offers') : 'Keine Verfügbarkeit für die gewählten Daten. Bitte versuchen Sie andere Daten.') + '</p></div>';
      return;
    }
    renderOffers(data);
  })
  .catch(function (err) {
    offersLoading.style.display = 'none';
    gtmPush('booking_error', { error_message: err.message || 'Unknown error', step: 'fetch_offers' });
    var msg = window.t ? window.t('booking.unable_to_check') : 'Verfügbarkeit kann momentan nicht geprüft werden.';
    if (err.message && err.message.indexOf('Failed to fetch') !== -1) {
      msg = window.t ? window.t('booking.server_waking') : 'Unser Buchungsserver startet gerade (~30 Sekunden beim ersten Laden). Bitte klicken Sie gleich nochmal auf "Suchen".';
    }

    var noOffersDiv = document.createElement('div');
    noOffersDiv.className = 'no-offers';
    noOffersDiv.setAttribute('role', 'alert');

    var msgP = document.createElement('p');
    msgP.textContent = msg;
    msgP.style.cssText = 'font-size:.95rem;color:var(--color-text);margin-bottom:.5rem;font-weight:500;';
    noOffersDiv.appendChild(msgP);

    var helpP = document.createElement('p');
    helpP.style.cssText = 'font-size:.82rem;color:var(--color-text-muted);margin-bottom:1rem;';
    helpP.textContent = window.t ? window.t('booking.error_help') : 'Bitte versuchen Sie es erneut oder kontaktieren Sie uns unter chaletswiss@amanthos.com';
    noOffersDiv.appendChild(helpP);

    var retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-accent';
    retryBtn.style.marginTop = '.5rem';
    retryBtn.innerHTML = (window.t ? window.t('booking.try_again') : 'Erneut versuchen');
    retryBtn.addEventListener('click', function () {
      var sb = document.getElementById('bookingSearchBtn');
      if (sb) sb.click();
    });
    noOffersDiv.appendChild(retryBtn);

    offersGrid.innerHTML = '';
    offersGrid.appendChild(noOffersDiv);
    console.error('Offers error:', err);
  });
}

function renderOffers(data) {
  var html = '';
  var nights = data.nights || 1;

  var nightLabel = nights === 1 ? (window.t ? window.t('booking.night') : 'Nacht') : (window.t ? window.t('booking.nights') : 'Nächte');
  var adultLabel = data.adults == 1 ? (window.t ? window.t('booking.adult_singular') : 'Erwachsener') : (window.t ? window.t('booking.adults_plural') : 'Erwachsene');
  var childrenCount = parseInt(searchParams.children) || 0;
  var guestSummary = data.adults + ' ' + adultLabel;
  if (childrenCount > 0) {
    var childLabel = childrenCount === 1 ? (window.t ? window.t('booking.child_singular') : 'Kind') : (window.t ? window.t('booking.children_plural') : 'Kinder');
    guestSummary += ', ' + childrenCount + ' ' + childLabel;
  }

  html += '<div class="offers-summary">';
  html += '<div class="offers-summary-dates">' + escapeHtml(data.arrival) + ' &mdash; ' + escapeHtml(data.departure) + '</div>';
  html += '<div class="offers-summary-detail">' + nights + ' ' + nightLabel + ' &middot; ' + guestSummary + '</div>';
  html += '</div>';

  var refundable = currentOffers.filter(function (o) { return o.category === 'Refundable'; });
  var nonRefundable = currentOffers.filter(function (o) { return o.category === 'Non-Refundable'; });

  if (nonRefundable.length > 0) {
    html += '<h4 class="offers-category-title">' + (window.t ? window.t('booking.best_price_label') : 'Bester Preis') + '</h4>';
    html += '<div class="offers-grid-wrap">';
    nonRefundable.forEach(function (offer) {
      html += renderOfferCard(offer, 'non-refundable', currentOffers.indexOf(offer), true);
    });
    html += '</div>';
  }
  if (refundable.length > 0) {
    html += '<h4 class="offers-category-title">' + (window.t ? window.t('booking.flexible_label') : 'Flexibel') + '</h4>';
    html += '<div class="offers-grid-wrap">';
    refundable.forEach(function (offer) {
      html += renderOfferCard(offer, 'refundable', currentOffers.indexOf(offer), false);
    });
    html += '</div>';
  }

  offersGrid.innerHTML = html;
  offersGrid.querySelectorAll('.offer-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var idx = parseInt(this.getAttribute('data-index'));
      selectOffer(idx);
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var idx = parseInt(this.getAttribute('data-index'));
        selectOffer(idx);
      }
    });
  });
}

// Storno-Bedingung aus Apaleo cancellationFee + Kategorie in lesbaren Text uebersetzen.
// Frueher zeigte die Karte nur "Bester Preis"/"Flexibel"; der Gast soll die konkrete
// Bedingung (inkl. Frist) sehen.
function formatPolicyDate(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var day = ('0' + d.getDate()).slice(-2);
  var mon = ('0' + (d.getMonth() + 1)).slice(-2);
  return day + '.' + mon + '.' + d.getFullYear();
}
function getCancellationPolicy(offer) {
  if (!offer) return { free: false, text: '' };
  if (offer.category === 'Non-Refundable') {
    return { free: false, text: tFallback('booking.policy_nonref', 'Nicht erstattbar, keine kostenlose Stornierung') };
  }
  var fee = offer.cancellationFee || {};
  var due = fee.dueDateTime ? formatPolicyDate(fee.dueDateTime) : '';
  if (due) {
    return { free: true, text: tFallback('booking.policy_free_until', 'Kostenlose Stornierung bis') + ' ' + due };
  }
  return { free: true, text: tFallback('booking.policy_free', 'Kostenlose Stornierung') };
}
function cancellationPolicyHtml(offer) {
  var pol = getCancellationPolicy(offer);
  if (!pol.text) return '';
  var icon = pol.free
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  return '<div class="offer-cancel-policy" style="font-size:.78rem;color:var(--color-text-muted);margin:.1rem 0 .4rem;display:flex;align-items:center;gap:.35rem;line-height:1.3;">'
    + icon + '<span>' + escapeHtml(pol.text) + '</span></div>';
}

function renderOfferCard(offer, categoryClass, index, isBestPrice) {
  var total = offer.totalGrossAmount || {};
  var perNight = offer.averagePerNight || {};
  var currency = 'CHF';
  var totalAmount = total.amount ? (Math.round(total.amount * 100) / 100).toFixed(2) : '\u2014';
  var perNightAmount = perNight.amount ? (Math.round(perNight.amount * 100) / 100).toFixed(2) : '\u2014';

  var unitName = offer._displayUnitGroupName || offer.unitGroupName || '';
  var html = '<div class="offer-card' + (isBestPrice ? ' best-price' : '') + '" data-index="' + index + '" tabindex="0" role="button" aria-label="' + escapeHtml(unitName) + '">';
  html += '<div class="offer-card-top">';
  html += '<div class="offer-unit">' + escapeHtml(unitName || (window.t ? window.t('booking.room') : 'Zimmer')) + '</div>';
  html += '<span class="offer-category ' + categoryClass + '">' + (categoryClass === 'refundable' ? (window.t ? window.t('booking.flexible') : 'Flexibel') : (window.t ? window.t('booking.best_price_tag') : 'Bester Preis')) + '</span>';
  html += '</div>';
  var rateLabel = offer._displayName || offer.ratePlanName || '';
  html += '<div class="offer-rate-name">' + escapeHtml(rateLabel) + '</div>';
  if (offer._discountBadge) {
    html += '<div class="offer-discount-badge">' + escapeHtml(offer._discountBadge) + '</div>';
  }
  html += cancellationPolicyHtml(offer);
  html += '<div class="offer-bottom">';
  html += '<div>';
  html += '<div class="offer-pricing">';
  html += '<div class="offer-price">CHF ' + perNightAmount + ' <small>' + (window.t ? window.t('booking.per_night') : '/ Nacht') + '</small></div>';
  html += '<div class="offer-total">CHF ' + totalAmount + ' ' + (window.t ? window.t('booking.total') : 'total') + '</div>';
  var cardCityTax = getOfferCityTax(offer);
  if (cardCityTax > 0 && total.amount) {
    var cardBrutto = roundCHF(total.amount + cardCityTax);
    html += '<div class="offer-citytax" style="font-size:.74rem;color:var(--color-text-muted);margin-top:.2rem;">+ CHF ' + cardCityTax.toFixed(2) + ' ' + tFallback('booking.citytax', 'Kurtaxe') + '</div>';
    html += '<div class="offer-brutto" style="font-size:.85rem;font-weight:700;color:var(--color-primary);margin-top:.1rem;">CHF ' + cardBrutto.toFixed(2) + ' ' + tFallback('booking.summary_total', 'Gesamt') + '</div>';
  }
  html += '</div>';
  html += '<div class="offer-trust">';
  html += '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ';
  html += (window.t ? window.t('booking.best_rate_guaranteed') : 'Bestpreis-Garantie');
  html += '</div>';
  html += '</div>';
  html += '<div class="offer-select-btn">' + (window.t ? window.t('booking.select') : 'Auswählen') + '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function selectOffer(index) {
  selectedOffer = currentOffers[index];
  if (!selectedOffer || !guestForm) return;

  gtmPush('select_offer', {
    rate_name: selectedOffer.ratePlanName || '',
    category: selectedOffer.category || '',
    total_price: selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.amount : 0,
    currency: selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.currency : 'CHF',
    unit_type: selectedOffer.unitGroupName || ''
  });

  offersGrid.querySelectorAll('.offer-card').forEach(function (card) {
    card.classList.toggle('selected', parseInt(card.getAttribute('data-index')) === index);
  });

  guestForm.style.display = 'block';
  if (bookingStatus) bookingStatus.style.display = 'none';

  appliedPromo = null;
  selectedUpsells = {};
  var promoMsg = document.getElementById('promoMessage');
  if (promoMsg) promoMsg.textContent = '';
  var promoInp = document.getElementById('promoCodeInput');
  if (promoInp) promoInp.value = '';
  updatePriceDisplay();
  renderUpsells();

  gtmPush('begin_checkout', {
    rate_name: selectedOffer.ratePlanName || '',
    total_price: selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.amount : 0,
    currency: selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.currency : 'CHF',
    extras_total: getUpsellTotal()
  });

  guestForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Upsell rendering
function renderUpsells() {
  var grid = document.getElementById('upsellGrid');
  if (!grid) return;
  var html = '';
  UPSELL_ITEMS.forEach(function (item) {
    var name = window.t ? window.t(item.nameKey) : item.nameFallback;
    var desc = window.t ? window.t(item.descKey) : item.descFallback;
    if (name === item.nameKey) name = item.nameFallback;
    if (desc === item.descKey) desc = item.descFallback;
    html += '<div class="upsell-card" data-upsell-id="' + item.id + '" tabindex="0" role="checkbox" aria-checked="false">';
    html += '<span class="upsell-card-icon">' + item.icon + '</span>';
    html += '<div class="upsell-card-info">';
    html += '<div class="upsell-card-name">' + escapeHtml(name) + '</div>';
    html += '<div class="upsell-card-desc">' + escapeHtml(desc) + '</div>';
    html += '</div>';
    var priceCents = Math.round(item.price * 100);
    var priceLabel = 'CHF ' + (priceCents / 100).toFixed(2);
    if (item.perDay) priceLabel += ' / ' + (window.t ? window.t('booking.per_day') : 'Tag');
    html += '<span class="upsell-card-price">' + priceLabel + '</span>';
    html += '<div class="upsell-card-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>';
    html += '</div>';
  });
  grid.innerHTML = html;

  grid.querySelectorAll('.upsell-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var id = this.dataset.upsellId;
      if (selectedUpsells[id]) {
        delete selectedUpsells[id];
        this.classList.remove('selected');
        this.setAttribute('aria-checked', 'false');
      } else {
        var item = UPSELL_ITEMS.find(function (u) { return u.id === id; });
        if (item) {
          selectedUpsells[id] = item;
          this.classList.add('selected');
          this.setAttribute('aria-checked', 'true');
        }
      }
      updatePriceDisplay();
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
    });
  });
}

function getBookingNights() {
  if (!searchParams.arrival || !searchParams.departure) return 1;
  var d1 = new Date(searchParams.arrival + 'T00:00:00');
  var d2 = new Date(searchParams.departure + 'T00:00:00');
  var nights = Math.round((d2 - d1) / 86400000);
  return nights > 0 ? nights : 1;
}

function getUpsellTotal() {
  var totalCents = 0;
  var nights = getBookingNights();
  Object.keys(selectedUpsells).forEach(function (id) {
    var item = selectedUpsells[id];
    var priceCents = Math.round(item.price * 100);
    totalCents += item.perDay ? priceCents * nights : priceCents;
  });
  return totalCents / 100;
}

function getUpsellComment() {
  var items = [];
  var nights = getBookingNights();
  Object.keys(selectedUpsells).forEach(function (id) {
    var item = selectedUpsells[id];
    var priceCents = Math.round(item.price * 100);
    if (item.perDay && nights > 1) {
      var totalCents = priceCents * nights;
      items.push(item.nameFallback + ' (CHF ' + (priceCents / 100).toFixed(2) + ' x ' + nights + ' = CHF ' + (totalCents / 100).toFixed(2) + ')');
    } else {
      items.push(item.nameFallback + ' (CHF ' + (priceCents / 100).toFixed(2) + ')');
    }
  });
  return items.length > 0 ? ' | Add-ons: ' + items.join(', ') : '';
}

// Promo code functions — validated server-side
function applyPromoCode() {
  var input = document.getElementById('promoCodeInput');
  var msg = document.getElementById('promoMessage');
  if (!input || !msg) return;
  var code = input.value.trim().toUpperCase();
  if (!code) { msg.textContent = window.t ? window.t('booking.promo_enter') : 'Bitte geben Sie einen Promo-Code ein.'; msg.style.color = 'var(--color-error)'; return; }
  msg.textContent = window.t ? window.t('booking.promo_checking') : 'Wird geprüft...';
  msg.style.color = 'var(--color-text-muted)';
  fetch(API_BASE + '/api/validate-promo', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({code: code, propertyId: PROPERTY_ID}),
    mode: 'cors',
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.valid) {
      appliedPromo = {code: code, discount: data.discount, label: data.label};
      if (data.fixedPrice != null) appliedPromo.fixedPrice = data.fixedPrice;
      msg.textContent = (window.t ? window.t('booking.promo_applied') : 'Promo-Code eingelöst!') + ' -' + data.label;
      msg.style.color = '#059669';
      gtmPush('promo_code_applied', { promo_code: code, discount: data.label });
    } else {
      appliedPromo = null;
      msg.textContent = window.t ? window.t('booking.promo_invalid') : 'Ungültiger Promo-Code.';
      msg.style.color = 'var(--color-error)';
    }
    updatePriceDisplay();
  })
  .catch(function() {
    msg.textContent = window.t ? window.t('booking.error_connection') : 'Verbindungsfehler. Bitte versuchen Sie es erneut.';
    msg.style.color = 'var(--color-error)';
  });
}

function getDiscountedTotal() {
  if (!selectedOffer || !selectedOffer.totalGrossAmount || !appliedPromo) return null;
  var totalCents;
  if (appliedPromo.fixedPrice != null) {
    totalCents = Math.round(appliedPromo.fixedPrice * 100);
  } else {
    totalCents = Math.round(selectedOffer.totalGrossAmount.amount * 100);
    totalCents = Math.round(totalCents * (1 - appliedPromo.discount));
  }
  return { amount: totalCents / 100, currency: selectedOffer.totalGrossAmount.currency };
}

// Compute the cents breakdown for the selected offer. Promo applies to
// room + add-ons only; the city tax (Kurtaxe) is a tax and is never discounted.
function getPriceBreakdown() {
  if (!selectedOffer || !selectedOffer.totalGrossAmount) return null;
  var roomCents = Math.round(selectedOffer.totalGrossAmount.amount * 100);
  var upsellCents = Math.round(getUpsellTotal() * 100);
  var cityTaxCents = Math.round(getCityTaxTotal() * 100);
  var promoCents = 0;
  if (appliedPromo) {
    if (appliedPromo.fixedPrice != null) {
      promoCents = (roomCents + upsellCents) - Math.round(appliedPromo.fixedPrice * 100);
    } else {
      promoCents = Math.round((roomCents + upsellCents) * appliedPromo.discount);
    }
    if (promoCents < 0) promoCents = 0;
  }
  var roomUpsellNet = (roomCents + upsellCents) - promoCents;
  return {
    currency: selectedOffer.totalGrossAmount.currency || 'CHF',
    roomCents: roomCents,
    upsellCents: upsellCents,
    cityTaxCents: cityTaxCents,
    promoCents: promoCents,
    roomUpsellNet: roomUpsellNet,         // what the room+add-ons cost after promo
    totalCents: roomUpsellNet + cityTaxCents,  // brutto grand total
  };
}

function updatePriceDisplay() {
  var box = document.getElementById('priceSummary');
  var b = getPriceBreakdown();
  if (!box || !b) { if (box) { box.style.display = 'none'; box.innerHTML = ''; } return; }
  var cur = b.currency;
  function line(label, cents, opts) {
    opts = opts || {};
    var color = opts.muted ? 'var(--color-text-muted)' : 'var(--color-text)';
    var weight = opts.big ? '700' : (opts.muted ? '400' : '500');
    var size = opts.big ? '1.05rem' : '.9rem';
    var sign = opts.negative ? '− ' : '';
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:.18rem 0;color:' + color + ';font-size:' + size + ';font-weight:' + weight + ';">' +
      '<span>' + label + '</span><span>' + sign + cur + ' ' + (Math.abs(cents) / 100).toFixed(2) + '</span></div>';
  }
  var html = '';
  html += line(tFallback('booking.summary_room', 'Zimmer'), b.roomCents, {});
  if (b.upsellCents > 0) html += line(tFallback('booking.summary_addons', 'Add-ons'), b.upsellCents, { muted: true });
  if (b.promoCents > 0) html += line((appliedPromo && appliedPromo.label ? appliedPromo.label + ' ' : '') + tFallback('booking.summary_discount', 'Rabatt'), b.promoCents, { muted: true, negative: true });
  if (b.cityTaxCents > 0) html += line(tFallback('booking.citytax', 'Kurtaxe'), b.cityTaxCents, { muted: true });
  html += '<div style="border-top:1px solid var(--color-border,#e5e5e5);margin:.4rem 0;"></div>';
  html += line(tFallback('booking.summary_total', 'Gesamtbetrag'), b.totalCents, { big: true });
  if (b.cityTaxCents > 0) {
    html += '<div style="font-size:.72rem;color:var(--color-text-muted);margin-top:.3rem;">' + tFallback('booking.citytax_note', 'inkl. Kurtaxe — wird mit der Buchung bezahlt') + '</div>';
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

// Confirm booking
if (confirmBtn) {
  confirmBtn.addEventListener('click', function () {
    if (!selectedOffer) return;
    var firstName = document.getElementById('guest-first').value.trim();
    var lastName = document.getElementById('guest-last').value.trim();
    var email = document.getElementById('guest-email').value.trim();
    var phone = document.getElementById('guest-phone').value.trim();

    if (!firstName || !lastName || !email) {
      showStatus('error', window.t ? window.t('booking.validation_fill_required') : 'Bitte füllen Sie alle Pflichtfelder aus (Vorname, Nachname, E-Mail).');
      return;
    }
    if (!isValidEmail(email)) {
      showStatus('error', window.t ? window.t('booking.validation_valid_email') : 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
      return;
    }

    gtmPush('submit_booking', {
      location: 'Hotel Chalet Swiss',
      rate_name: selectedOffer.ratePlanName || '',
      promo_code: appliedPromo ? appliedPromo.code : '',
    });

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner-inline"></span> ' + (window.t ? window.t('booking.processing') : 'Wird verarbeitet...');
    // Show progress updates
    var progressMsgs = [
      window.t ? window.t('booking.processing') : 'Reservierung wird erstellt...',
      'Zahlungslink wird generiert...',
      'Fast fertig...'
    ];
    var progressIdx = 0;
    var progressTimer = setInterval(function () {
      progressIdx++;
      if (progressIdx < progressMsgs.length) {
        confirmBtn.innerHTML = '<span class="spinner-inline"></span> ' + progressMsgs[progressIdx];
      }
    }, 5000);

    var roomCents = selectedOffer.totalGrossAmount ? Math.round(selectedOffer.totalGrossAmount.amount * 100) : 0;

    var commentParts = ['Booked via chaletswiss.ch'];
    if (appliedPromo) commentParts.push('Promo: ' + appliedPromo.code + ' (' + appliedPromo.label + ' off)');
    commentParts.push(getUpsellComment());

    // Build structured upsell list for folio charges
    var upsellsList = [];
    var bookingNights = getBookingNights();
    Object.keys(selectedUpsells).forEach(function (id) {
      var item = selectedUpsells[id];
      var priceCents = Math.round(item.price * 100);
      var totalCents = item.perDay ? priceCents * bookingNights : priceCents;
      upsellsList.push({ id: item.id, name: item.nameFallback, price: totalCents / 100, unitPrice: item.price, perDay: !!item.perDay, nights: item.perDay ? bookingNights : 1 });
    });

    var upsellCents = Math.round(getUpsellTotal() * 100);
    var fullCents = roomCents + upsellCents;
    if (appliedPromo) {
      if (appliedPromo.fixedPrice != null) {
        fullCents = Math.round(appliedPromo.fixedPrice * 100);
      } else {
        fullCents = Math.round(fullCents * (1 - appliedPromo.discount));
      }
    }

    var payload = {
      propertyId: PROPERTY_ID,
      ratePlanId: selectedOffer.ratePlanId,
      arrival: searchParams.arrival,
      departure: searchParams.departure,
      adults: parseInt(searchParams.adults),
      children: parseInt(searchParams.children) || 0,
      totalAmount: fullCents / 100,
      cityTax: getCityTaxTotal(),
      upsells: upsellsList,
      currency: selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.currency : 'CHF',
      booker: {
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: phone,
      },
      comment: commentParts.join(' | ').replace(/\| $/,'').trim(),
    };

    // Klick-IDs mitschicken, damit der Server die Buchung der Anzeige

    // zuordnen kann. Ohne Einwilligung liefert tracking() null und das

    // Feld entfaellt — der Server sieht dann nichts und tut nichts.

    try {

      var klickIds = window.amMeta && window.amMeta.tracking();

      if (klickIds) { payload.tracking = klickIds; }

    } catch (e) { /* nie die Buchung brechen */ }


    fetch(API_BASE + '/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      clearInterval(progressTimer);
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ' + (window.t ? window.t('booking.confirm_reservation') : 'Reservierung bestätigen');

      if (data.success) {
        var finalTotal = fullCents / 100;
        gtmPush('booking_confirmed', {
          booking_id: data.confirmationId || '',
          reservation_id: data.reservationId || '',
          total_price: finalTotal,
          currency: selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.currency : 'CHF',
          promo_code: appliedPromo ? appliedPromo.code : '',
        });

        guestForm.querySelector('.form-grid').style.display = 'none';
        guestForm.querySelector('.form-actions').style.display = 'none';
        var promoSection = guestForm.querySelector('.promo-code-section');
        if (promoSection) promoSection.style.display = 'none';

        if (data.paymentRequired === false) {
          showFreeBookingConfirmation(data.confirmationId, email);
        } else if (data.paymentLink) {
          showPaymentStep(data.confirmationId, data.paymentLink, email, data);
        } else {
          showPaymentRetry(data.confirmationId, email, data);
        }
      } else {
        gtmPush('booking_error', { error_message: data.error || 'Booking failed', step: 'confirm_booking' });
        showStatus('error', data.error || (window.t ? window.t('booking.error_booking_failed') : 'Buchung fehlgeschlagen. Bitte versuchen Sie es erneut oder kontaktieren Sie uns.'));
      }
    })
    .catch(function (err) {
      clearInterval(progressTimer);
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ' + (window.t ? window.t('booking.confirm_reservation') : 'Reservierung bestätigen');
      showStatus('error', window.t ? window.t('booking.error_connection') : 'Verbindungsfehler. Bitte versuchen Sie es erneut.');
      console.error('Booking error:', err);
    });
  });
}

// Cancel button
if (cancelBtn) {
  cancelBtn.addEventListener('click', function () {
    if (guestForm) guestForm.style.display = 'none';
    selectedOffer = null;
    if (offersGrid) {
      offersGrid.querySelectorAll('.offer-card').forEach(function (card) {
        card.classList.remove('selected');
      });
    }
  });
}

function showStatus(type, message) {
  if (!bookingStatus) return;
  bookingStatus.className = 'booking-status ' + type;
  bookingStatus.textContent = message;
  bookingStatus.style.display = 'block';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getOrCreatePaymentSection() {
  var paymentSection = document.getElementById('paymentStep');
  if (!paymentSection) {
    paymentSection = document.createElement('div');
    paymentSection.id = 'paymentStep';
    paymentSection.className = 'payment-step';
    guestForm.appendChild(paymentSection);
  }
  return paymentSection;
}

function showFreeBookingConfirmation(confirmationId, email) {
  if (bookingStatus) bookingStatus.style.display = 'none';
  var paymentSection = getOrCreatePaymentSection();
  var html = '';
  html += '<div class="payment-step-success" style="border-left:4px solid #059669;background:#ECFDF5;">';
  html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  html += '<div>';
  html += '<h4 style="color:#065F46;">' + (window.t ? window.t('booking.confirmed_title') : 'Buchung bestätigt') + ' — ' + escapeHtml(confirmationId) + '</h4>';
  html += '<p style="font-size:.82rem;color:#059669;margin-top:.25rem;">' + escapeHtml(email) + '</p>';
  html += '</div>';
  html += '</div>';
  html += '<div class="payment-step-action" style="text-align:center;padding:1.5rem;">';
  html += '<p style="font-weight:500;color:var(--color-text);margin-bottom:.75rem;">' + (window.t ? window.t('booking.promo_covers_full') : 'Ihr Promo-Code deckt den vollen Betrag. Ihre Reservierung ist bestätigt!') + '</p>';
  html += '<p style="font-size:.85rem;color:var(--color-text-muted);">' + (window.t ? window.t('booking.confirmation_email') : 'Eine Bestätigungsmail wird an') + ' <strong>' + escapeHtml(email) + '</strong> ' + (window.t ? window.t('booking.sent') : 'gesendet.') + '</p>';
  html += '</div>';
  paymentSection.innerHTML = html;
  paymentSection.style.display = 'block';
  paymentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function pollPaymentStatus(reservationId, bookingId, paymentSection, confirmationId, attempt) {
  attempt = attempt || 0;
  var maxAttempts = 18; // 18 × 10s = 3 minutes of polling
  var checkingText = window.t ? window.t('booking.checking_payment') : '';
  if (!checkingText || checkingText === 'booking.checking_payment') checkingText = 'Zahlungsstatus wird \u00fcberpr\u00fcft...';

  var payBtn = document.getElementById('payNowBtn');
  if (payBtn) {
    payBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><circle cx="12" cy="12" r="10"/></svg> ' + checkingText + ' (' + (attempt + 1) + '/' + maxAttempts + ')';
  }

  fetch(API_BASE + '/api/check-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId: reservationId, bookingId: bookingId }),
    mode: 'cors',
  })
  .then(function (res) { return res.json(); })
  .then(function (data) {
    if (data.paid) {
      var html = '';
      html += '<div class="payment-step-success" style="border-left:4px solid #059669;background:#ECFDF5;">';
      html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      html += '<div>';
      html += '<h4 style="color:#065F46;">' + (window.t ? window.t('booking.payment_success') : 'Zahlung erfolgreich \u2014 Reservierung best\u00e4tigt!') + '</h4>';
      html += '<p style="font-size:.85rem;color:#059669;margin-top:.25rem;">' + (window.t ? window.t('booking.confirmation_email_sent') : 'Eine Best\u00e4tigungsmail wurde an Sie gesendet.') + '</p>';
      html += '</div>';
      html += '</div>';
      paymentSection.innerHTML = html;
      gtmPush('payment_completed', { booking_id: bookingId });
    } else if (attempt < maxAttempts - 1) {
      setTimeout(function () {
        pollPaymentStatus(reservationId, bookingId, paymentSection, confirmationId, attempt + 1);
      }, 10000);
    } else {
      showPaymentUncertain(reservationId, bookingId, paymentSection, confirmationId);
    }
  })
  .catch(function (err) {
    console.error('Check payment error:', err);
    if (attempt < maxAttempts - 1) {
      setTimeout(function () {
        pollPaymentStatus(reservationId, bookingId, paymentSection, confirmationId, attempt + 1);
      }, 10000);
    } else {
      showPaymentUncertain(reservationId, bookingId, paymentSection, confirmationId);
    }
  });
}

function showPaymentUncertain(reservationId, bookingId, paymentSection, confirmationId) {
  var html = '';
  html += '<div class="payment-step-success" style="border-left:4px solid #F59E0B;background:#FFFBEB;">';
  html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  html += '<div>';
  html += '<h4 style="color:#92400E;">' + (window.t ? window.t('booking.payment_not_confirmed_yet') : 'Zahlung noch nicht best\u00e4tigt') + '</h4>';
  html += '<p style="font-size:.85rem;color:#B45309;margin-top:.25rem;">' + (window.t ? window.t('booking.payment_processing_wait') : 'Falls Sie bezahlt haben, kann die Verarbeitung einen Moment dauern. Sie k\u00f6nnen weiter pr\u00fcfen oder uns kontaktieren.') + '</p>';
  html += '</div>';
  html += '</div>';
  html += '<div class="payment-step-action" style="text-align:center;padding:1.5rem;">';
  html += '<button class="btn btn-accent btn-lg" id="keepCheckingBtn" style="font-size:1rem;padding:.85rem 2rem;cursor:pointer;border:none;margin-bottom:.75rem;">';
  html += (window.t ? window.t('booking.keep_checking') : 'Weiter pr\u00fcfen');
  html += '</button>';
  html += '<br>';
  html += '<button class="btn btn-lg" id="cancelReservationBtn" style="font-size:.9rem;padding:.65rem 1.5rem;cursor:pointer;border:1px solid #DC2626;background:transparent;color:#DC2626;border-radius:8px;margin-top:.5rem;">';
  html += (window.t ? window.t('booking.did_not_pay_cancel') : 'Ich habe nicht bezahlt \u2014 Reservierung stornieren');
  html += '</button>';
  html += '<p style="font-size:.82rem;color:var(--color-text-muted);margin-top:1rem;">' + (window.t ? window.t('booking.or_contact') : 'Oder kontaktieren Sie uns:') + ' <a href="mailto:chaletswiss@amanthos.com" style="color:var(--color-primary);">chaletswiss@amanthos.com</a></p>';
  html += '</div>';
  paymentSection.innerHTML = html;

  var keepBtn = document.getElementById('keepCheckingBtn');
  if (keepBtn) {
    keepBtn.addEventListener('click', function () {
      pollPaymentStatus(reservationId, bookingId, paymentSection, confirmationId, 0);
    });
  }

  var cancelBtn = document.getElementById('cancelReservationBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      cancelUnpaidBooking(reservationId, bookingId, paymentSection);
    });
  }
}

function cancelUnpaidBooking(reservationId, bookingId, paymentSection) {
  fetch(API_BASE + '/api/cancel-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId: reservationId, bookingId: bookingId }),
    mode: 'cors',
  })
  .then(function (res) { return res.json(); })
  .then(function (data) {
    if (data.cancelled) {
      var html = '';
      html += '<div class="payment-step-success" style="border-left:4px solid #DC2626;background:#FEF2F2;">';
      html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      html += '<div>';
      html += '<h4 style="color:#991B1B;">' + (window.t ? window.t('booking.cancelled_title') : 'Reservierung storniert') + '</h4>';
      html += '<p style="font-size:.85rem;color:#DC2626;margin-top:.25rem;">' + (window.t ? window.t('booking.cancelled_no_payment') : 'Zahlung nicht abgeschlossen. Ihre Reservierung wurde storniert.') + '</p>';
      html += '</div>';
      html += '</div>';
      html += '<div class="payment-step-action" style="text-align:center;padding:1.5rem;">';
      html += '<p style="font-weight:500;color:var(--color-text);margin-bottom:1rem;">' + (window.t ? window.t('booking.cancelled_rebook') : 'Sie k\u00f6nnen jederzeit eine neue Reservierung vornehmen.') + '</p>';
      html += '<button class="btn btn-accent btn-lg" id="rebookBtn">' + (window.t ? window.t('booking.search_again') : 'Erneut suchen') + '</button>';
      html += '</div>';
      paymentSection.innerHTML = html;

      var rebookBtn = document.getElementById('rebookBtn');
      if (rebookBtn) {
        rebookBtn.addEventListener('click', function () {
          resetBookingFlow();
        });
      }
      gtmPush('booking_cancelled_no_payment', { booking_id: bookingId, reservation_id: reservationId });
    } else if (data.reason === 'paid') {
      var html2 = '';
      html2 += '<div class="payment-step-success" style="border-left:4px solid #059669;background:#ECFDF5;">';
      html2 += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      html2 += '<div>';
      html2 += '<h4 style="color:#065F46;">' + (window.t ? window.t('booking.payment_success') : 'Zahlung erfolgreich \u2014 Reservierung best\u00e4tigt!') + '</h4>';
      html2 += '<p style="font-size:.85rem;color:#059669;margin-top:.25rem;">' + (window.t ? window.t('booking.confirmation_email_sent') : 'Eine Best\u00e4tigungsmail wurde an Sie gesendet.') + '</p>';
      html2 += '</div>';
      html2 += '</div>';
      paymentSection.innerHTML = html2;
      gtmPush('payment_completed', { booking_id: bookingId });
    }
  })
  .catch(function (err) {
    console.error('Cancel booking error:', err);
  });
}

function resetBookingFlow() {
  selectedOffer = null;
  currentOffers = [];
  appliedPromo = null;
  selectedUpsells = {};
  if (guestForm) guestForm.style.display = 'none';
  if (offersGrid) offersGrid.innerHTML = '';
  if (bookingSection) bookingSection.style.display = 'none';
  if (bookingStatus) bookingStatus.style.display = 'none';
  var paymentStep = document.getElementById('paymentStep');
  if (paymentStep) paymentStep.remove();
  if (guestForm) {
    var formGrid = guestForm.querySelector('.form-grid');
    if (formGrid) formGrid.style.display = '';
    var formActions = guestForm.querySelector('.form-actions');
    if (formActions) formActions.style.display = '';
    var promoSec = guestForm.querySelector('.promo-code-section');
    if (promoSec) promoSec.style.display = '';
  }
  var formFields = guestForm ? guestForm.querySelectorAll('input, select, textarea') : [];
  for (var i = 0; i < formFields.length; i++) {
    if (formFields[i].type === 'checkbox') formFields[i].checked = false;
    else formFields[i].value = '';
  }
  var bb = document.getElementById('bookingBar');
  if (bb) bb.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showPaymentStep(confirmationId, paymentLink, email, bookingData) {
  gtmPush('payment_initiated', { booking_id: confirmationId });
  if (bookingStatus) bookingStatus.style.display = 'none';
  var paymentSection = getOrCreatePaymentSection();
  var paymentMsg = window.t ? window.t('booking.payment_instruction') : 'Bitte schliessen Sie jetzt Ihre Zahlung ab, um die Reservierung zu bestätigen. Klicken Sie auf den Button unten.';
  var payBtnText = window.t ? window.t('booking.pay_now') : 'Jetzt Zahlung abschliessen';
  var reservationId = bookingData.reservationId || '';

  var totalText = '';
  var pb = getPriceBreakdown();
  if (pb) {
    totalText = pb.currency + ' ' + (pb.totalCents / 100).toFixed(2);
  }

  var html = '';
  // Warning banner: booking NOT confirmed
  html += '<div style="background:#FEE2E2;border:2px solid #DC2626;border-radius:12px;padding:1rem 1.25rem;margin-bottom:1rem;text-align:center;">';
  html += '<p style="color:#DC2626;font-weight:800;font-size:1.05rem;margin:0;">';
  html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.5" style="vertical-align:middle;margin-right:.4rem;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  html += (window.t ? window.t('booking.not_confirmed_yet') : 'Du hast noch keine g\u00fcltige Buchung!');
  html += '</p>';
  html += '<p style="color:#991B1B;font-size:.85rem;margin:.4rem 0 0;">' + (window.t ? window.t('booking.will_be_cancelled') : 'Ohne Zahlung wird die Buchung in 10 Minuten storniert.') + '</p>';
  html += '</div>';
  // Reservation reference
  html += '<div class="payment-step-success" style="border-left:4px solid #F59E0B;background:#FFFBEB;">';
  html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  html += '<div>';
  html += '<h4 style="color:#92400E;">' + (window.t ? window.t('booking.reservation_created') : 'Reservierung erstellt') + ' — ' + escapeHtml(confirmationId) + '</h4>';
  html += '<p style="font-size:.82rem;color:#B45309;margin-top:.25rem;">' + escapeHtml(email) + '</p>';
  html += '</div>';
  html += '</div>';
  // Payment action area
  html += '<div class="payment-step-action">';
  html += '<p style="font-size:.8rem;color:var(--color-text-muted);margin-bottom:.5rem;font-weight:600;letter-spacing:.5px;">' + (window.t ? window.t('booking.payment_step_indicator') : 'Schritt 2 von 2 \u2014 Zahlung') + '</p>';
  html += '<p style="font-weight:600;color:var(--color-text);margin-bottom:.75rem;font-size:1.05rem;">' + escapeHtml(paymentMsg) + '</p>';
  if (totalText) {
    html += '<p style="font-size:1.8rem;font-weight:800;color:var(--color-primary);font-family:var(--font-heading);margin:.75rem 0;">' + escapeHtml(totalText) + '</p>';
  }
  html += '<style>@keyframes pulse-pay{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}</style>';
  html += '<button id="payNowBtn" class="btn btn-accent btn-lg payment-btn" style="font-size:1.05rem;padding:1rem 1.5rem;font-weight:700;max-width:100%;white-space:normal;word-wrap:break-word;animation:pulse-pay 2s ease-in-out infinite;box-shadow:0 4px 14px rgba(0,0,0,.15);">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> ';
  html += escapeHtml(payBtnText);
  html += '</button>';
  html += '<p style="font-size:.82rem;color:var(--color-text-muted);margin-top:1rem;">' + (window.t ? window.t('booking.payment_secure_note') : 'Es \u00f6ffnet sich ein sicheres Zahlungsfenster. Bitte schliessen Sie die Zahlung dort ab.') + '</p>';
  html += '</div>';

  paymentSection.innerHTML = html;
  paymentSection.style.display = 'block';
  paymentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

  var payBtn = document.getElementById('payNowBtn');
  if (payBtn) {
    payBtn.addEventListener('click', function () {
      // Validate payment link is from trusted domain
      var ALLOWED_PAYMENT_HOSTS = ['eu.adyen.link', 'checkout.adyen.com', 'checkoutshopper-live.adyen.com'];
      try {
        var linkUrl = new URL(paymentLink);
        if (linkUrl.protocol !== 'https:') {
          console.error('Payment URL must be HTTPS'); return;
        }
        if (ALLOWED_PAYMENT_HOSTS.indexOf(linkUrl.hostname) === -1) {
          console.error('Untrusted payment domain: ' + linkUrl.hostname); return;
        }
      } catch (e) { console.error('Invalid payment URL'); return; }

      // Mobile: redirect directly (popups are blocked on most mobile browsers)
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
      if (isMobile) {
        window.location.href = paymentLink;
        return;
      }

      // Desktop: open popup
      var popup = window.open(paymentLink, 'chaletswiss_payment', 'width=900,height=700,scrollbars=yes,resizable=yes');
      if (!popup || popup.closed) {
        window.location.href = paymentLink;
        return;
      }
      payBtn.disabled = true;
      payBtn.textContent = window.t ? window.t('booking.waiting_for_payment') : 'Warte auf Zahlung...';
      var pollTimer = setInterval(function () {
        if (popup.closed) {
          clearInterval(pollTimer);
          // Popup closed — start polling for payment status (never auto-cancel)
          pollPaymentStatus(reservationId, confirmationId, paymentSection, confirmationId, 0);
        }
      }, 2000);
    });
  }
}

function showPaymentRetry(confirmationId, email, bookingData) {
  if (bookingStatus) bookingStatus.style.display = 'none';
  var paymentSection = getOrCreatePaymentSection();

  var totalText = '';
  var pb = getPriceBreakdown();
  if (pb) {
    totalText = pb.currency + ' ' + (pb.totalCents / 100).toFixed(2);
  }

  var html = '';
  html += '<div class="payment-step-success" style="border-left:4px solid #F59E0B;background:#FFFBEB;">';
  html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  html += '<div>';
  html += '<h4 style="color:#92400E;">' + (window.t ? window.t('booking.reservation_created') : 'Reservierung erstellt') + ' — ' + escapeHtml(confirmationId) + '</h4>';
  html += '<p style="font-size:.82rem;color:#DC2626;font-weight:600;margin-top:.25rem;">' + (window.t ? window.t('booking.payment_link_expired') : 'Zahlungslink konnte nicht erstellt werden. Bitte versuchen Sie es erneut.') + '</p>';
  html += '</div>';
  html += '</div>';

  html += '<div class="payment-step-action">';
  html += '<p style="font-weight:500;color:var(--color-text);margin-bottom:.75rem;">' + (window.t ? window.t('booking.payment_instruction') : 'Die Zahlung ist erforderlich, um Ihre Reservierung zu bestätigen.') + '</p>';
  if (totalText) {
    html += '<p style="font-size:1.8rem;font-weight:800;color:var(--color-primary);font-family:var(--font-heading);margin:.75rem 0;">' + escapeHtml(totalText) + '</p>';
  }
  html += '<button id="retryPaymentBtn" class="btn btn-accent btn-lg payment-btn">' + (window.t ? window.t('booking.retry_payment') : 'Zahlungslink erneut erstellen') + '</button>';
  html += '<p style="font-size:.8rem;color:var(--color-text-muted);margin-top:1rem;">' + (window.t ? window.t('booking.or_contact') : 'Oder kontaktieren Sie uns:') + ' <a href="mailto:chaletswiss@amanthos.com" style="color:var(--color-accent);">chaletswiss@amanthos.com</a></p>';
  html += '</div>';

  paymentSection.innerHTML = html;
  paymentSection.style.display = 'block';
  paymentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

  var retryBtn = document.getElementById('retryPaymentBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      retryBtn.disabled = true;
      retryBtn.textContent = window.t ? window.t('booking.processing') : 'Wird verarbeitet...';

      var retryPayload = {
        bookingId: bookingData.confirmationId,
        reservationId: bookingData.reservationId || '',
        propertyId: PROPERTY_ID,
        email: email,
        totalAmount: (function () {
          if (!selectedOffer || !selectedOffer.totalGrossAmount) return 0;
          var roomCents = Math.round(selectedOffer.totalGrossAmount.amount * 100);
          var upsellCents = Math.round(getUpsellTotal() * 100);
          var fullCents = roomCents + upsellCents;
          if (appliedPromo) {
            if (appliedPromo.fixedPrice != null) { fullCents = Math.round(appliedPromo.fixedPrice * 100); }
            else { fullCents = Math.round(fullCents * (1 - appliedPromo.discount)); }
          }
          return fullCents / 100;
        })(),
        currency: selectedOffer && selectedOffer.totalGrossAmount ? selectedOffer.totalGrossAmount.currency : 'CHF',
      };

      fetch(API_BASE + '/api/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
        mode: 'cors',
      })
      .then(function (res) { return res.json(); })
      .then(function (linkData) {
        if (linkData.paymentLink) {
          showPaymentStep(bookingData.confirmationId, linkData.paymentLink, email, bookingData);
        } else {
          retryBtn.disabled = false;
          retryBtn.textContent = window.t ? window.t('booking.retry_payment') : 'Zahlungslink erneut erstellen';
          showStatus('error', linkData.error || (window.t ? window.t('booking.payment_link_expired') : 'Zahlungslink konnte nicht erstellt werden.'));
        }
      })
      .catch(function () {
        retryBtn.disabled = false;
        retryBtn.textContent = window.t ? window.t('booking.retry_payment') : 'Zahlungslink erneut erstellen';
        showStatus('error', window.t ? window.t('booking.error_connection') : 'Verbindungsfehler. Bitte versuchen Sie es erneut.');
      });
    });
  }
}

})();
