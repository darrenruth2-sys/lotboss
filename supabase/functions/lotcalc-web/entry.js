// Bundled into lib.js for the lotcalc-web edge function (node build-web.mjs).
import area from '@turf/area';
import { polygon } from '@turf/helpers';
export { webPrice, cleanLead, cleanRing, webSettings } from '../../../src/webquote.js';
export const ringSqft = ring => { try { return area(polygon([ring])) * 10.763910416709722; } catch { return 0; } };
