# Paper Trail

A disclosure intelligence workstation. It pulls SEC Form 4 insider purchases and congressional trades from Quiver Quant, scores each company for evidence of informed buying, checks your own depot against the same filings, and reviews how you trade.

It runs as a claude.ai artifact on the viewer's own Quiver Quant connector, so there is no API key in the page and no server to run. A Claude Code routine refreshes it every morning at 07:47 Berlin time and on demand: it writes a brief, US quotes, Yahoo Finance price history and company logos into the artifact's database ([jobs/README.md](jobs/README.md)).

| View | What it is for |
|---|---|
| **Radar** | The whole workflow in one window. A radar puts the strongest signals closest to the centre (angle = sector, bubble size = dollars bought, colour = insiders, Congress or both). Pick one to read a plain-language story with what insiders paid against today's price, then add it to your plan or skip it; the $10k plan strip on top redraws as you decide. Keys: <kbd>←</kbd>/<kbd>→</kbd>, <kbd>A</kbd> add, <kbd>X</kbd> skip, <kbd>Enter</kbd> dossier |
| **Briefing** | The morning page: the daily brief, today's strongest signals with price moves, changes since yesterday, alerts on your holdings, and the daily job's status with a **Run now** button |
| **Signals** | A ranked screen with filters, a score breakdown for any row, and daily activity you can drag to filter by date |
| **Link analysis** | A force-directed graph of tickers, insiders and members of Congress; people tied to several tickers stand out as bridges |
| **Dossier** | One ticker in depth: timeline, insider and Congress ledgers, federal awards, lobbying, off-exchange volume, ownership, news, and a memo from Claude |
| **Member** | A member of Congress: net worth, a year of trades, late filings, overlap with current signals |
| **Model** | Tune factor weights, recency half-life and tier cut-offs, and see rank changes against the default |
| **Holdings** | Your Finanzfluss depot with logos, weights and gains; every US-listed holding checked against 90 days of insider filings and a year of congressional trades |
| **Trade review** | What your own transactions show: what you did well, what cost you money and what to watch, each with the trades behind it and a euro impact; plus a coaching note from Claude |
| **Plan** | Size a budget across your picks with a cash reserve and a per-position cap; keep notes; export CSV |
| **Lineage** | Pipeline stages, data-quality drops, runtime capabilities and every request made to Quiver |

Keyboard: <kbd>⌘K</kbd> command palette, <kbd>G</kbd> then a letter to switch views, <kbd>J</kbd>/<kbd>K</kbd>/<kbd>Enter</kbd> in the screen, <kbd>B</kbd> desk brief, <kbd>?</kbd> for the full list.

## Development

```bash
npm ci
npm test         # unit tests for the data and model layers
npm run build    # writes dist/index.html
npm run check    # CI: fails if dist/index.html is out of date
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, connector behaviour, pipeline, state, persistence, capabilities.
- [docs/SIGNAL_MODEL.md](docs/SIGNAL_MODEL.md): every factor, weight, adjustment and tier, with calibration notes and limitations.

### Importing a depot

In Finanzfluss, open the depot, select the whole page and copy it, then paste it into **Holdings → Import from Finanzfluss**. Paste the Buchungen (transactions) pages and the dashboard the same way; transactions are merged and de-duplicated, so pasting a page twice is harmless. The depot is stored in the artifact database under owner-only rules.

This is a research tool, not investment advice. Filings show what people did, not why.
