import patterns from 'hyphen/patterns/la-x-classic.js';
import createHyphenator from './index.js';

const { hyphenate, syllables } = createHyphenator(patterns);

export { hyphenate, syllables, patterns };
