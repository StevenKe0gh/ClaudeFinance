# ClaudeFinance

## Paper Trail

`paper-trail/index.html` is a claude.ai artifact that ranks stocks by recent congressional and corporate insider buying, opens a filing dossier for any ticker, and splits a budget across the stocks you pick.

- **Signals:** scores every stock with congressional purchases or insider open-market purchases (SEC Form 4 code P) in the last 30, 60 or 90 days, and flags patterns such as insider clusters, C-suite buys, bipartisan buying and filings past the STOCK Act's 45-day deadline.
- **Deep dive:** congressional trades, insider trades, federal contracts, lobbying, off-exchange short volume, ownership and news for one ticker, plus a memo written by Claude from that data.
- **Plan:** splits a cash amount (default $10,000) across your picks by signal score or equally, with a cash reserve and a per-stock cap, and exports the plan as CSV.

Data comes from the viewer's own Quiver Quant connector on claude.ai, so the page holds no API key. It only loads live data when opened on claude.ai by an account with that connector.
