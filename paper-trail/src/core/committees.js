import COMMITTEES from '../data/committees.json' with { type: 'json' };
import { companyOf } from './directory.js';
import { createOversight, memberSeats } from '../model/oversight.js';

/** Current committee seats (built by scripts/build-committees.py) and the oversight lookup bound to the company directory. */
export const committees = COMMITTEES;
export const oversight = createOversight({ committees: COMMITTEES, companyOf });
export const seatsOf = bioguide => memberSeats(COMMITTEES, bioguide);

/** Sitting members by chamber: anyone with a seat on one of that chamber's committees. */
const inChamber = ch => new Set(Object.entries(COMMITTEES.members || {}).filter(([, seats]) => seats.some(([code]) => (COMMITTEES.committees[code] || [])[1] === ch)).map(([id]) => id));
const SENATORS = inChamber('senate');
const REPRESENTATIVES = inChamber('house');
export const isSenator = bioguide => SENATORS.has(bioguide);
export const isRepresentative = bioguide => REPRESENTATIVES.has(bioguide);
export const SEATS = { Senate: 100, House: 435 };
