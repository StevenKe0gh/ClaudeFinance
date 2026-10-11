# Signal model (`conviction-3`)

The model ranks **evidence of informed buying**. It does not forecast returns, it uses no price data, and it has not been backtested. Its job is to sort a few hundred tickers so a person can spend their attention on the ones whose filings look most like deliberate, informed purchases.

## Inputs (per ticker, for the selected window)

- **Form 4 code-P rows.** Open-market purchases by officers, directors and 10% owners.
- **Congressional purchases.** Filed in the window, plus Quiver's per-ticker counts of buys and sales.
- **Convergence data.** Congressional purchase counts over the last 90 days.
- **Committee seats.** Current committee and subcommittee seats for every member (`src/data/committees.json`, from the public-domain [congress-legislators](https://github.com/unitedstates/congress-legislators) project), matched to Quiver trades by bioguide id.
- **Industry.** The NASDAQ sector and industry of each listing (`src/data/directory.json`).
- **Insider selling (top 15 only).** 90 days of all Form 4 activity, to measure selling.

## Factors

Each factor is normalised to 0–1. `rec(d) = 0.5^(age_days / half_life)`, with a default half-life of 21 days. Role weights: C-suite 1.0, director 0.8, officer 0.7, fund 0.45, holder 0.4.

| Factor | Raw value | Normalisation |
|---|---|---|
| Insider breadth | Σ role weight × rec(last buy) over buyers | 1 − e^(−B/1.6) |
| Insider dollars | Σ $ × role weight × rec over buyers | log scale, $25K → 0, $10M → 1 |
| Stake increase | median % increase in each buyer's holding (new position = 100%, capped at 300%) | ÷ 50%, capped at 1 |
| Seniority | most senior buyer | C-suite 1, officer 0.6, director 0.5, fund 0.25, holder 0.2 |
| Congress breadth | Σ rec(last filing) over members, ignoring same-day buy/sell pairs | 1 − e^(−M/1.4) |
| Congress dollars | midpoint of reported ranges | log scale, $1K → 0, $1M → 1 (the common $1K–15K range ≈ 0.3) |
| Bipartisan | Democrats and Republicans both bought | 0 or 1 |
| Committee oversight | Σ rec(last filing) over buying members whose committee covers the company's industry, × 1.3 for a chair or ranking member | 1 − e^(−O/0.7) |
| Convergence | insiders bought, and Congress bought in the window (1) or in the last 90 days (0.7) | — |
| Freshness | age of the latest buy | 0.5^(age/10) |

**Score** = 100 × Σ weight × factor × adjustment ÷ Σ weights.

| Preset | Insider (breadth / $ / stake / seniority) | Congress (breadth / $ / bipartisan / oversight) | Convergence / freshness | Tiers A / B / C |
|---|---|---|---|---|
| **Congress-led** (default) | 12 / 10 / 5 / 9 | 16 / 9 / 4 / 24 | 12 / 10 | 34 / 27 / 20 |
| Balanced | 20 / 18 / 8 / 14 | 10 / 5 / 3 / 8 | 12 / 10 | 50 / 38 / 25 |
| Insider-first | 25 / 22 / 10 / 17 | 5 / 2 / 1 / 3 | 8 / 10 | 60 / 48 / 35 |
| Congress-first | 8 / 6 / 3 / 5 | 22 / 13 / 8 / 24 | 12 / 10 | 34 / 24 / 15 |

Congress-led puts 53 of 111 weight points on congressional buying, almost half of it on committee oversight: one recent purchase by a member whose committee covers the company scores about as high as a C-suite insider cluster, and two such members outrank almost anything insiders alone can produce. Each preset carries its own tier cut-offs, set so that roughly the top 1% of tickers land in tier A, the next 3% in B and the next 10–15% in C. Any weight or cut-off can be changed on the Model page.

## Committee oversight

A member "oversees" a company when one of their current committee or subcommittee seats covers the company's industry. The mapping (`src/model/oversight.js`) is conservative: a committee counts only for the industries at the core of its jurisdiction.

| Committees | Industries |
|---|---|
| Armed Services, Intelligence, Defense and MilCon appropriations, China select committee | defense and aerospace contractors |
| Financial Services, Banking, Financial Services appropriations | banks, insurers and financial firms; housing (Financial Services, Banking, T-HUD) |
| Energy and Commerce (Health), Ways and Means (Health), Finance, HELP, Aging, Veterans' Affairs, Labor-HHS and Agriculture-FDA appropriations | health care, drugs and medical devices |
| Energy and Commerce (Energy, Environment), Energy and Natural Resources, Natural Resources, Environment and Public Works, Energy-Water and Interior appropriations | energy and utilities; mining and natural resources |
| Energy and Commerce (Communications, Commerce), Commerce, Science, Judiciary, Homeland Security, Intelligence | technology; telecom and media |
| Transportation and Infrastructure, Commerce (Aviation, Surface Transportation), T-HUD appropriations | transportation; construction and infrastructure |
| Agriculture (both chambers), Agriculture-FDA appropriations | agriculture and food |

Subcommittees without their own entry inherit their parent committee's industries. Seats are current ones, so a trade made before a member changed committees is judged by today's seats. Refresh the roster with `python3 scripts/build-committees.py` after committee assignments change.

## Adjustments

These multiply the insider part, the Congress part or both. Convergence takes the smaller of the two.

| Pattern | Rule | × |
|---|---|---|
| Offering-priced | 3+ insiders on one day at one price, or 2 with a round price, identical share counts, or $5M+ together | 0.55 |
| Fixed price | one buyer, 3+ lines over 2+ days, 80%+ at one price (tenders, negotiated deals) | 0.50 |
| Purchase program | 8+ buyers with median < $15K, or 10+ lines with median < $5K | 0.35 |
| Outsized stake jump | a buyer more than quintuples their holding with $1M+ (conversions, placements) | 0.70 |
| Funds or holders only | no officer or director bought | 0.70 |
| Insider selling | sales / (sales + buys) over 90 days, top 15 only | 1 − 0.6 × share |
| Congressional selling | sales / (sales + buys) in the window | 1 − 0.5 × share |

Adjustments on the insider part never take it below 0.2 of its unadjusted value.

## Tiers

| Tier | Meaning |
|---|---|
| A | Strongest evidence |
| B | Solid evidence |
| C | Some evidence |
| D | Weak or mechanical |

Cut-offs depend on the preset (table above) and can be changed on the Model page.

## Flags

Flags are explanations, not score inputs. Green flags mark things that make buying more informative: committee oversight (naming the member and committee), C-suite cluster, insider cluster, accumulation at changing prices, new positions, convergence, bipartisan buying. Amber flags mark reasons for caution: offering-priced, fixed price, purchase program, outsized stake jump, Form 4 filed more than 4 days late, periodic transaction report (PTR) filed past 45 days, same-day offsetting trades, net insider selling.

## Calibration

These numbers come from the 30 days to 2026-10-09: 1,452 unique Form 4 purchases and 170 congressional purchases (62 of them with no ticker), scored with Balanced weights before the insider-selling check:

- **Distribution.** 6 in tier A and 33 in B, with the long tail in C and D.
- **Correctly discounted.** Offering allocations (SBLK, GREE, ACCV, VENU), a CEO’s fixed-price buys filed three weeks late (COE), purchase programs (TSM, BBD, SPG), a $0.01 unit-mismatch line (UXIN) and a $10 trillion data error (SLBT) all score low or are dropped.
- **Ranked near the top.** Clustered open-market buying by senior insiders (for example GME, RWT, DKS, FUL, BORR).

Rechecked on the same 30 days with Congress-led weights and the committee roster: 9 tickers had at least one buyer whose committee oversees the company (for example a House Transportation and Infrastructure member buying Home Depot, a House Intelligence ranking subcommittee member buying Microsoft, a House Ways and Means Health ranking member buying Johnson & Johnson). Home Depot, two bipartisan members one of whom has oversight, became the top-ranked ticker.

## Known limitations

- **No market data.** There are no prices, returns, valuation or volatility. A strong filing signal can already be priced in.
- **Congressional data is late and coarse.** Disclosures arrive up to 45 days after the trade and give dollar ranges, not amounts.
- **Oversight is approximate.** It rests on NASDAQ industry labels and a hand-made committee map. A conglomerate filed under one industry can be overseen by committees the map does not link, and broad committees (Appropriations, Ways and Means, Judiciary) count only for their clearest industries.
- **Company names.** Form 4 rows carry no issuer name, so purely insider-driven tickers can show without a company name until the dossier finds one.
- **Coverage.** Enrichment covers only the top 15. Every other ticker's score ignores insider selling unless you open its dossier.
