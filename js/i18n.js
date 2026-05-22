/**
 * Hotel Chalet Swiss — i18n Engine
 * Supports: DE, EN
 */
(function () {
  'use strict';

  var SUPPORTED_LANGS = {
    de: { name: 'German', native: 'DE' },
    en: { name: 'English', native: 'EN' },
  };

  var DEFAULT_LANG = 'de';
  var STORAGE_KEY = 'chaletswiss_lang';
  var currentLang = DEFAULT_LANG;
  var translations = {};
  var basePath = '';

  function detectBasePath() {
    var scripts = document.querySelectorAll('script[src*="i18n.js"]');
    if (scripts.length > 0) {
      var src = scripts[0].getAttribute('src');
      basePath = src.replace(/js\/i18n\.js.*$/, '');
    }
  }

  function detectLanguage() {
    // URL param ?lang=xx
    try {
      var urlParams = new URLSearchParams(window.location.search);
      var urlLang = urlParams.get('lang');
      if (urlLang && SUPPORTED_LANGS[urlLang.toLowerCase()]) {
        var lang = urlLang.toLowerCase();
        localStorage.setItem(STORAGE_KEY, lang);
        return lang;
      }
    } catch (e) {}

    // localStorage
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS[stored]) return stored;

    // Browser language
    var browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    var shortLang = browserLang.split('-')[0];
    if (SUPPORTED_LANGS[shortLang]) return shortLang;

    return DEFAULT_LANG;
  }

  function loadTranslation(lang, callback) {
    if (translations[lang]) {
      callback(translations[lang]);
      return;
    }
    var url = basePath + 'locales/' + lang + '.json';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try { translations[lang] = JSON.parse(xhr.responseText); }
          catch (e) { translations[lang] = {}; }
        } else {
          translations[lang] = {};
        }
        callback(translations[lang]);
      }
    };
    xhr.send();
  }

  function applyTranslations(dict) {
    var elements = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var key = el.getAttribute('data-i18n');
      var value = getNestedValue(dict, key);
      if (value) {
        if (el.hasAttribute('data-i18n-attr')) {
          el.setAttribute(el.getAttribute('data-i18n-attr'), value);
        } else {
          el.textContent = value;
        }
      }
    }

    // Placeholders
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var p = 0; p < placeholders.length; p++) {
      var pel = placeholders[p];
      var pval = getNestedValue(dict, pel.getAttribute('data-i18n-placeholder'));
      if (pval) pel.setAttribute('placeholder', pval);
    }

    // Aria labels
    var ariaLabels = document.querySelectorAll('[data-i18n-aria]');
    for (var a = 0; a < ariaLabels.length; a++) {
      var ael = ariaLabels[a];
      var aval = getNestedValue(dict, ael.getAttribute('data-i18n-aria'));
      if (aval) ael.setAttribute('aria-label', aval);
    }

    document.documentElement.setAttribute('lang', currentLang);

    var metaDesc = document.querySelector('meta[name="description"]');
    var descValue = getNestedValue(dict, 'meta.description');
    if (metaDesc && descValue) metaDesc.setAttribute('content', descValue);

    var titleValue = getNestedValue(dict, 'meta.title');
    if (titleValue) document.title = titleValue;
  }

  function getNestedValue(obj, key) {
    var parts = key.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
      if (current === undefined || current === null) return null;
      current = current[parts[i]];
    }
    return current;
  }

  function switchLanguage(lang) {
    if (!SUPPORTED_LANGS[lang]) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    loadTranslation(lang, function (dict) {
      applyTranslations(dict);
      updateSelector();
      var event;
      try { event = new CustomEvent('languageChanged', { detail: { lang: lang } }); }
      catch (e) { event = document.createEvent('CustomEvent'); event.initCustomEvent('languageChanged', true, true, { lang: lang }); }
      document.dispatchEvent(event);
    });
  }

  function buildSelector() {
    var container = document.getElementById('langSelector');
    if (!container) return;

    var html = '<button class="lang-toggle" aria-label="Select language" aria-expanded="false">';
    html += '<span class="lang-current">' + SUPPORTED_LANGS[currentLang].native + '</span>';
    html += '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l4 4 4-4"/></svg>';
    html += '</button>';
    html += '<div class="lang-dropdown" role="listbox" aria-label="Language selection">';

    var langs = Object.keys(SUPPORTED_LANGS);
    for (var i = 0; i < langs.length; i++) {
      var code = langs[i];
      var info = SUPPORTED_LANGS[code];
      var isActive = code === currentLang ? ' active' : '';
      html += '<button class="lang-option' + isActive + '" data-lang="' + code + '" role="option"';
      html += code === currentLang ? ' aria-selected="true"' : ' aria-selected="false"';
      html += '>' + info.native + '</button>';
    }
    html += '</div>';
    container.innerHTML = html;

    var toggle = container.querySelector('.lang-toggle');
    var dropdown = container.querySelector('.lang-dropdown');

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen);
    });

    var options = container.querySelectorAll('.lang-option');
    for (var j = 0; j < options.length; j++) {
      options[j].addEventListener('click', function () {
        switchLanguage(this.getAttribute('data-lang'));
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    }

    document.addEventListener('click', function () {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function updateSelector() {
    var container = document.getElementById('langSelector');
    if (!container) return;
    var currentEl = container.querySelector('.lang-current');
    if (currentEl) currentEl.textContent = SUPPORTED_LANGS[currentLang].native;
    var options = container.querySelectorAll('.lang-option');
    for (var i = 0; i < options.length; i++) {
      var isActive = options[i].getAttribute('data-lang') === currentLang;
      options[i].classList.toggle('active', isActive);
      options[i].setAttribute('aria-selected', isActive);
    }
  }

  // Global translate function
  window.t = function (key, replacements) {
    var dict = translations[currentLang] || translations[DEFAULT_LANG] || {};
    var value = getNestedValue(dict, key);
    if (!value) {
      var fallback = translations[DEFAULT_LANG] || {};
      value = getNestedValue(fallback, key);
    }
    if (!value) return key;
    if (replacements) {
      var keys = Object.keys(replacements);
      for (var i = 0; i < keys.length; i++) {
        value = value.replace(new RegExp('\\{' + keys[i] + '\\}', 'g'), replacements[keys[i]]);
      }
    }
    return value;
  };

  window.getLang = function () { return currentLang; };

  function dispatchLanguageChanged() {
    var event;
    try { event = new CustomEvent('languageChanged', { detail: { lang: currentLang } }); }
    catch (e) { event = document.createEvent('CustomEvent'); event.initCustomEvent('languageChanged', true, true, { lang: currentLang }); }
    document.dispatchEvent(event);
  }

  function init() {
    detectBasePath();
    currentLang = detectLanguage();
    loadTranslation(DEFAULT_LANG, function () {
      if (currentLang !== DEFAULT_LANG) {
        loadTranslation(currentLang, function (dict) {
          applyTranslations(dict);
          buildSelector();
          dispatchLanguageChanged();
        });
      } else {
        applyTranslations(translations[DEFAULT_LANG]);
        buildSelector();
        dispatchLanguageChanged();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
