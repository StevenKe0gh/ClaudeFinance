# Paper Trail

Follow the money into the market. Paper Trail pulls SEC Form 4 insider purchases, congressional trades, the President's disclosed trades, top-fund 13F moves, lobbying and federal contracts from Quiver Quant, scores each company for evidence of informed buying, keeps only stocks a German retail investor can buy, checks your own depot against the same filings, and reviews how you trade.

It runs as a claude.ai artifact on the viewer's own Quiver Quant connector, so there is no API key in the page and no server to run. A Claude Code routine refreshes it every morning at 07:47 Berlin time and on demand: it writes a brief, US quotes, Yahoo Finance price history and company logos into the artifact's database ([jobs/README.md](jobs/README.md)).

| View | What it is for |
|---|---|
| **Home** | The front page: what Paper Trail does, the strongest buyable signals, what Congress holds most and what the President's accounts are buying. Visitors without the Quiver connector land here and see the latest saved run instead of an empty screen |
| **Radar** | The whole workflow in one window. A radar puts the strongest signals closest to the centre (angle = sector, bubble size = dollars bought, colour = insiders, Congress or both, an amber diamond when a buyer's committee oversees the company). Pick one to read a plain-language story with what insiders paid against today's price, then add it to your plan or skip it; the $10k plan strip on top redraws as you decide. Keys: <kbd>←</kbd>/<kbd>→</kbd>, <kbd>A</kbd> add, <kbd>X</kbd> skip, <kbd>Enter</kbd> dossier |
| **Briefing** | The morning page: the daily brief, today's strongest signals with price moves, changes since yesterday, alerts on your holdings, and the daily job's status with a **Run now** button |
| **Signals** | A ranked screen with filters, a score breakdown for any row, and daily activity you can drag to filter by date |
| **Policy** | Bills and federal money that move stocks. **Who profits?** traces an event or policy (say, a US–Russia diesel deal) to the US-listed companies likely to gain or lose: Claude searches bills, checks each candidate's federal awards, lobbying and buying in your screen, and draws the money flow with confidence and evidence per company. Below it: companies where new bills or large awards meet congressional or insider buying, your depot or your plan (a bill's own sponsor trading the company comes first); the largest federal awards of the last 60 days; the newest bills that name companies; and topic watches that follow bills through five stages from introduction to law |
| **Congress holdings** | What sitting senators and representatives most likely own, ranked by how many of them hold each stock, with the party split, money put in, 90-day activity and every holder. Above it, the **influence map** plots the 30 most-held stocks by lobbying spend against members holding them, with bubble size for federal awards |
| **Trump and Kushner** | The family business stakes and roles (Trump Media, American Bitcoin, Dominari, Affinity Partners, Thrive Capital and more) with sources, and the President's own disclosed trades summed by sector with the biggest net purchases and sales |
| **Dossier** | Opens when you click a company. One ticker in depth: timeline, insider and Congress ledgers, whale moves, federal awards, lobbying, ownership, news, and a memo from Claude |
| **Member** | Opens when you click a member of Congress: net worth, a year of trades, late filings, overlap with current signals |
| **Holdings** | Your Finanzfluss depot with logos, weights and gains; every US-listed holding checked against 90 days of insider filings and a year of congressional trades |
| **Trade review** | What your own transactions show: what you did well, what cost you money and what to watch, each with the trades behind it and a euro impact; plus a coaching note from Claude |
| **Plan** | Size a budget across your picks with a cash reserve and a per-position cap; keep notes; export CSV |

### Congress holdings

Members disclose trades, not portfolios, so holdings are estimated: a stock counts as held when a member, a spouse or a child bought it and has not reported selling all of it since. Sizes are the midpoints of the disclosed ranges, at cost. The Senate estimate replays every Senate trade since 2020 (about 5,000). The House files far more (one managed account alone reported 11,800 trades since 2024), so its estimate starts with the current Congress on 3 January 2025 and misses older positions that were never traded since. Only sitting members count, matched by their committee seats. The owner's page computes both once a day and saves them, so visitors without the connector see the same estimate.

### Trump and Kushner families

The President's trades come from his STOCK Act reports (Quiver's `get_trump_trades`); outside managers run the accounts. Quiver's ticker is often wrong for funds and bonds, so those are classified by name. Family stakes and roles are compiled from news reports and filings in `src/data/families.js`, each with its date and source; they are not updated automatically.

### Whales

Every company's Radar card and dossier show what **Berkshire Hathaway** and ten top hedge funds did with it in their latest 13F filings: new positions, adds, trims and exits, plus stakes they hold. **Briefing → Whale moves** lists their newest buys across all stocks, and the Radar tags a company **Whale buying** when one of them added it in the last two reported quarters.

The ten are the best-performing concentrated stock pickers of 2025 by reported return: Perceptive Advisors (+82%), D1 Capital (+33.7%), TCI (+27%), Whale Rock (+27%), Appaloosa (+23.3%), Pershing Square (+20.9%), Viking Global (+18%), and Situational Awareness, Lone Pine and Coatue (first-half 2025 figures only). Multi-strategy, quant and macro funds such as Bridgewater, D.E. Shaw, Citadel and Millennium are left out on purpose: they hold thousands of hedged positions, so their 13F lines say little about conviction. The list lives in `src/model/whales.js`.

Limits: 13F filings arrive 45 days after a quarter ends. Paper Trail reads them from Quiver's fund-update posts and each stock's top 100 owners, because Quiver's full 13F dataset needs a higher subscription tier. Quiver posts its own headlines for Berkshire, Pershing Square, Appaloosa and Situational Awareness, though not for every quarter (its newest Berkshire posts cover Q4 2025). Moves by the other funds show only when they rank among a stock's largest that quarter, and stakes only when the fund is among the top 100 holders.

### Buying from Germany

Paper Trail only suggests what you can buy. Pick your brokers (Scalable Capital, Trade Republic, Revolut) from the command palette or any **Change brokers** link. None of them publishes an instrument list the page can read, so each company gets an estimate per broker:

- **Not buyable:** US-listed ETFs and closed-end funds. EU rules (PRIIPs) block them for retail clients because they have no key information document. These drop out of the radar, the default Signals view, the desk brief and the daily picks.
- **Unlikely:** SPACs, stocks not listed on NYSE or Nasdaq, and micro caps under $50M.
- **Uncertain:** small caps ($50–300M), business development companies and US pipeline partnerships.
- **Likely:** other US-listed companies worth $300M or more at Scalable and Trade Republic. At Revolut, only those worth $10B or more, since its US list is curated.

When you look a stock up in your broker's app, mark it **✓ Can buy** or **✕ Not there** on its Radar card or dossier. Your answer replaces the estimate and syncs across devices.

Keyboard: <kbd>⌘K</kbd> command palette, <kbd>G</kbd> then a letter to switch views, <kbd>J</kbd>/<kbd>K</kbd>/<kbd>Enter</kbd> in the screen, <kbd>B</kbd> desk brief, <kbd>?</kbd> for the full list.

## Development

```bash
npm ci
npm test         # unit tests for the data and model layers
npm run build    # writes dist/index.html
npm run check    # CI: fails if dist/index.html is out of date

node scripts/build-directory.mjs     # refresh company names, sectors and industries
python3 scripts/build-committees.py  # refresh committee seats (needs PyYAML)
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, connector behaviour, pipeline, state, persistence, capabilities.
- [docs/SIGNAL_MODEL.md](docs/SIGNAL_MODEL.md): every factor, weight, adjustment and tier, with calibration notes and limitations.

### Importing a depot

In Finanzfluss, open the depot, select the whole page and copy it, then paste it into **Holdings → Import from Finanzfluss**. Paste the Buchungen (transactions) pages and the dashboard the same way; transactions are merged and de-duplicated, so pasting a page twice is harmless. The depot is stored in the artifact database under owner-only rules.

This is a research tool, not investment advice. Filings show what people did, not why.
