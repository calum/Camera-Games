// The list of levels, in the order they are played. To add a level: create src/levels/<id>.js (copy
// _template.js), import it here and put it in the list. docs/ADDING-GAMES.md walks through it.
/** @import { Level } from '../types.js' */
import bubbles from './bubbles.js';
import dodge from './dodge.js';
import jump from './jump.js';
import dance from './dance.js';
import dig from './dig.js';
import avalanche from './avalanche.js';
import wall from './wall.js';
import meteor from './meteor.js';
import balloons from './balloons.js';
import duckjump from './duckjump.js';
import freeze from './freeze.js';
import snowball from './snowball.js';
import fly from './fly.js';
import bomb from './bomb.js';

/** @type {Level[]} */
// Favourites (dodging, jumping) are spread out; the still-pose Dance party comes last.
export const LEVELS = [bubbles, dodge, jump, dig, duckjump, meteor, avalanche, balloons, freeze, wall, snowball, fly, bomb, dance];
