import { raw } from './html.js';

const svg = (d, s = 18) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);

export const ICON = {
  signals: svg('<path d="M3 16V9M8 16V4M13 16v-6M18 16V7"/>'),
  dossier: svg('<path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5M7.5 10h5M7.5 13h5"/>'),
  member: svg('<circle cx="10" cy="7" r="3"/><path d="M4 17c.8-3.2 3.2-5 6-5s5.2 1.8 6 5"/>'),
  portfolio: svg('<path d="M10 3a7 7 0 1 0 7 7h-7z"/><path d="M12.5 2.6A7 7 0 0 1 17.4 7.5H12.5z"/>'),
  radar: svg('<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="4"/><path d="M10 10 15.3 4.7"/><circle cx="13.2" cy="12.6" r="1.3" fill="currentColor" stroke="none"/><circle cx="6.6" cy="7.4" r="1" fill="currentColor" stroke="none"/>'),
  briefing: svg('<path d="M3.5 4.5h13v11h-13z"/><path d="M6.5 8h7M6.5 11h7M6.5 14h4"/><circle cx="15.5" cy="4.5" r="2.2" fill="currentColor" stroke="none"/>'),
  holdings: svg('<path d="M3 6.5h14v9.5H3z"/><path d="M7 6.5V4.5h6v2M3 10.5h14"/>'),
  policy: svg('<path d="M3 17h14M4.5 17v-6.5h11V17M7.5 10.5V17M10 10.5V17M12.5 10.5V17M5 10.5a5 5 0 0 1 10 0M10 3v2.5"/>'),
  trades: svg('<path d="M4 7h10l-3-3M16 13H6l3 3"/>'),
  edit: svg('<path d="M12.5 4.5l3 3L7 16H4v-3z"/>', 14),
  play: svg('<path d="M6 4.5v11l9-5.5z"/>', 14),
  refresh: svg('<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16 3.5v3.5h-3.5"/>', 14),
  spark: svg('<path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M5 5l2.2 2.2M12.8 12.8 15 15M5 15l2.2-2.2M12.8 7.2 15 5"/>', 14),
  plus: svg('<path d="M10 4v12M4 10h12"/>', 14),
  check: svg('<path d="m4 10.5 4 4 8-9"/>', 14),
  open: svg('<path d="M8 4H4v12h12v-4"/><path d="M11 3.5h5.5V9M16.5 3.5 9 11"/>', 14),
  close: svg('<path d="M5 5l10 10M15 5 5 15"/>', 16),
  download: svg('<path d="M10 3v9M6 8.5l4 4 4-4M4 16.5h12"/>', 14)
};
