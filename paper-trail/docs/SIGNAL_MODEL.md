# Signal model (`conviction-2`)

The model ranks **evidence of informed buying**. It does not forecast returns, it uses no price data, and it has not been backtested. Its job is to sort a few hundred tickers so a person can spend their attention on the ones whose filings look most like deliberate, informed purchases.

## Inputs (per ticker, for the selected window)

- **Form 4 code-P rows.** Open-market purchases by officers, directors and 10% owners.
- **Congressional purchases.** Filed in the window, plus Quiver's per-ticker counts of buys and sales.
- **Convergence data.** Congressional purchase counts over the last 90 days.
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
| Congress dollars | midpoint of reported ranges | log scale, $15K → 0, $1M → 1 |
| Bipartisan | Democrats and Republicans both bought | 0 or 1 |
| Convergence | insiders bought, and Congress bought in the window (1) or in the last 90 days (0.7) | — |
| Freshness | age of the latest buy | 0.5^(age/10) |

**Score** = 100 × Σ weight × factor × adjustment ÷ Σ weights. The **Balanced** preset weights them 20 / 18 / 8 / 14 / 10 / 5 / 3 / 12 / 10, in table order. The **Insider-first** and **Congress-first** presets shift weight between the two groups, and any weight can be changed on the Model page.

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

| Tier | Score | Meaning |
|---|---|---|
| A | ≥ 50 | Strongest evidence |
| B | ≥ 38 | Solid evidence |
| C | ≥ 25 | Some evidence |
| D | < 25 | Weak or mechanical |

All three cut-offs can be changed on the Model page.

## Flags

Flags are explanations, not score inputs. Green flags mark things that make buying more informative: C-suite cluster, insider cluster, accumulation at changing prices, new positions, convergence, bipartisan buying. Amber flags mark reasons for caution: offering-priced, fixed price, purchase program, outsized stake jump, Form 4 filed more than 4 days late, periodic transaction report (PTR) filed past 45 days, same-day offsetting trades, net insider selling.

## Calibration

These numbers come from the 30 days to 2026-10-09: 1,452 unique Form 4 purchases and 170 congressional purchases (62 of them with no ticker), scored with Balanced weights before the insider-selling check:

- **Distribution.** 6 in tier A and 33 in B, with the long tail in C and D.
- **Correctly discounted.** Offering allocations (SBLK, GREE, ACCV, VENU), a CEO’s fixed-price buys filed three weeks late (COE), purchase programs (TSM, BBD, SPG), a $0.01 unit-mismatch line (UXIN) and a $10 trillion data error (SLBT) all score low or are dropped.
- **Ranked near the top.** Clustered open-market buying by senior insiders (for example GME, RWT, DKS, FUL, BORR).

## Known limitations

- **No market data.** There are no prices, returns, valuation or volatility. A strong filing signal can already be priced in.
- **Congressional data is late and coarse.** Disclosures arrive up to 45 days after the trade and give dollar ranges, not amounts.
- **Company names.** Form 4 rows carry no issuer name, so purely insider-driven tickers can show without a company name until the dossier finds one.
- **Coverage.** Enrichment covers only the top 15. Every other ticker's score ignores insider selling unless you open its dossier.
