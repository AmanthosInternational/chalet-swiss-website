// Budget je Kategorie. Ein einzelner --budget-Wert bindet ALLE Kategorien auf
// denselben Wert; am 21.08.2026 riss deshalb SEO statt Performance, weil die
// AGB-Seiten `noindex, follow` tragen und damit zwangslaeufig auf 0,54 kommen.
// Das ist Absicht und kein Mangel.
//
// Performance 65: hergeleitet aus dem niedrigsten live gemessenen Lauf minus rund
// zehn Punkten. Der Puffer ist noetig, weil dieselbe Seite ueber fuenf Laeufe um bis
// zu 16 Punkte streut; ein Budget auf dem Median waere in der Haelfte der Laeufe rot
// und binnen einer Woche ignoriert. Es soll eine echte Verschlechterung fangen,
// nicht das Rauschen.
export default {
  ci: {
    budget: {
      performance: 65,
      accessibility: 90,
      'best-practices': 75,
      seo: 50,
    },
  },
}
