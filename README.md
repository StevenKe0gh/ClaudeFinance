# ClaudeFinance

## Paper Trail

[`paper-trail/`](paper-trail/) is a disclosure intelligence workstation that runs as a claude.ai artifact. It pulls SEC Form 4 insider purchases and congressional trades through the viewer's Quiver Quant connector, scores every company for evidence of informed buying, and adds:

- dossiers per stock
- a link-analysis graph of buyers and tickers
- profiles of members of Congress
- a tunable scoring model
- a daily briefing, refreshed every morning and on demand by a Claude Code routine
- your own depot (imported from Finanzfluss) checked against the same filings
- a review of your trades: what worked, what cost money, and what to change
- a position planner
- a data-lineage view

It ships with unit tests and a CI check that the built file is current. See [paper-trail/README.md](paper-trail/README.md) for usage and [paper-trail/docs/](paper-trail/docs/) for the architecture and the signal model.
