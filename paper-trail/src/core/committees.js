import COMMITTEES from '../data/committees.json' with { type: 'json' };
import { companyOf } from './directory.js';
import { createOversight, memberSeats } from '../model/oversight.js';

/** Current committee seats (built by scripts/build-committees.py) and the oversight lookup bound to the company directory. */
export const committees = COMMITTEES;
export const oversight = createOversight({ committees: COMMITTEES, companyOf });
export const seatsOf = bioguide => memberSeats(COMMITTEES, bioguide);
