// The list of levels, in the order they are played. To add a level: create src/levels/<id>.js (copy
// _template.js), import it here and put it in the list. docs/ADDING-GAMES.md walks through it.
/** @import { Level } from '../types.js' */
import bubbles from './bubbles.js';
import dodge from './dodge.js';
import jump from './jump.js';
import dance from './dance.js';

/** @type {Level[]} */
export const LEVELS = [bubbles, dodge, jump, dance];
