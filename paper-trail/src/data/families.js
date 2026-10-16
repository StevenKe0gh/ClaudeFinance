/**
 * Business stakes and roles of the Trump and Kushner families in companies,
 * compiled from news reports and filings. Stakes change and some reports
 * are a year old, so every row carries when it was reported and its source.
 * Compiled 16 October 2026 from web search results; check the source before
 * relying on a figure.
 */
export const FAMILY_ASOF = '2026-10-16';

export const FAMILY_STAKES = [
  {
    family: 'Trump', who: 'Donald J. Trump (revocable trust; Donald Trump Jr. trustee)', ticker: 'DJT', company: 'Trump Media & Technology Group', sector: 'Media and social',
    what: 'About 114.75 million shares, the largest disclosed direct holding', reported: '2026',
    src: [['TradingKey', 'https://www.tradingkey.com/analysis/stocks/us-stocks/261819707-trump-family-public-stock-crypto-holdings-2026-tradingkey']]
  },
  {
    family: 'Trump', who: 'Eric Trump (co-founder), Donald Trump Jr. (investor)', ticker: 'ABTC', company: 'American Bitcoin', sector: 'Crypto and bitcoin mining',
    what: 'Eric Trump reported at 7.3% to 9.3%; shares fell about 80% after the September 2025 debut', reported: '2025–2026',
    src: [['Wikipedia', 'https://en.wikipedia.org/wiki/American_Bitcoin'], ['Fortune', 'https://fortune.com/2026/02/09/trump-family-crypto-portfolio-american-bitcoin-melania-memecoin-world-liberty-financial/']]
  },
  {
    family: 'Trump', who: 'Eric Trump and Donald Trump Jr. (advisory board)', ticker: 'DOMH', company: 'Dominari Holdings', sector: 'Financial services',
    what: 'Advisers since February 2025; together reported holding 2.9 million shares; Dominari owns about 23 million American Bitcoin shares', reported: 'April 2025',
    src: [['NewsTRACS', 'https://newstracs.com/category/dominari'], ['Yahoo Finance', 'https://finance.yahoo.com/news/trump-backed-bitcoin-mining-stock-235434906.html']]
  },
  {
    family: 'Trump', who: 'Donald Trump Jr.', ticker: 'TZUP', company: 'Thumzup Media', sector: 'Crypto and bitcoin mining',
    what: 'About 350,000 shares, roughly $4 million at the time; the company keeps a crypto treasury', reported: 'July 2025',
    src: [['The Block', 'https://www.theblock.co/post/361885/thumzup-xrp-sol-doge-more-bitcoin-treasury-trump-jr']]
  },
  {
    family: 'Trump', who: 'Donald Trump Jr. (director)', ticker: 'PSQH', company: 'PSQ Holdings', sector: 'Retail and e-commerce',
    what: 'Board member since December 2024; his firm 1789 Capital backs conservative-market companies', reported: 'December 2024',
    src: [['Fortune', 'https://fortune.com/2024/12/03/donald-trump-jr-psq-holdings-stock-price']]
  },
  {
    family: 'Trump', who: 'Donald Trump Jr. (board nominee, consultant)', ticker: 'PEW', company: 'GrabAGun Digital', sector: 'Retail and e-commerce',
    what: 'Nominated to the board after the merger; consultant since December 2024', reported: 'March 2025',
    src: [['Business Wire', 'https://www.businesswire.com/news/home/20250324856942/en/GrabAGun-Nominates-Donald-Trump-Jr.-and-Post-Closing-Board-of-Directors-and-Advances-Plans-for-Upcoming-Public-Listing']]
  },
  {
    family: 'Trump', who: 'Donald Trump Jr. (advisory board)', ticker: 'UMAC', company: 'Unusual Machines', sector: 'Defense and drones',
    what: '200,000 shares under his advisory agreement', reported: 'November 2024',
    src: [['NBC', 'https://nbcchicago.com/news/business/money-report/drone-maker-unusual-machines-shares-soar-after-donald-trump-jr-joins-advisory-board/3611106']]
  },
  {
    family: 'Trump', who: 'Trump family', ticker: null, company: 'World Liberty Financial', sector: 'Crypto and bitcoin mining',
    what: 'Family crypto venture (WLFI token, USD1 stablecoin); not a listed stock', reported: '2025–2026',
    src: [['DL News', 'https://www.dlnews.com/articles/people-culture/how-donald-trump-crypto-empire-fared-in-2025/']]
  },
  {
    family: 'Kushner', who: 'Jared Kushner (Affinity Partners)', ticker: null, company: 'Electronic Arts', sector: 'Video games',
    what: 'About 1.1% after the $55 billion buyout with Saudi PIF and Silver Lake closed on 4 August 2026; EA is no longer listed', reported: 'August 2026',
    src: [['Yahoo Finance', 'https://finance.yahoo.com/markets/stocks/articles/pif-silver-lake-jared-kushners-124313128.html'], ['Wikipedia', 'https://en.wikipedia.org/wiki/Leveraged_buyout_of_Electronic_Arts']]
  },
  {
    family: 'Kushner', who: 'Jared Kushner (Affinity Partners)', ticker: null, company: 'Phoenix Financial (Tel Aviv)', sector: 'Insurance and finance',
    what: 'Largest shareholder at about 7.4% after selling 2.5%; listed in Tel Aviv, not in the US', reported: '2025–2026',
    src: [['Globes', 'https://en.globes.co.il/en/article-1001550617'], ['Ynet', 'https://www.ynetnews.com/business/article/byukn3rsfg']]
  },
  {
    family: 'Kushner', who: 'Joshua Kushner (Thrive Capital)', ticker: 'AMZN', company: 'Amazon', sector: 'Retail and e-commerce',
    what: 'About $215 million of shares, disclosed in a regulatory filing', reported: 'August 2026',
    src: [['Bloomberg Law', 'https://news.bgov.com/bankruptcy-law/joshua-kushners-thrive-capital-invests-215-million-in-amazon']]
  },
  {
    family: 'Kushner', who: 'Joshua Kushner (Thrive Capital)', ticker: null, company: 'OpenAI and other private AI companies', sector: 'AI',
    what: 'Early and repeated OpenAI investor; Thrive closed a fund of more than $10 billion in February 2026', reported: '2026',
    src: [['TechCrunch', 'https://techcrunch.com/2026/02/17/thrive-raises-10b-for-new-fund-its-largest-yet/'], ['Wikipedia', 'https://en.wikipedia.org/wiki/Thrive_Capital']]
  }
];
