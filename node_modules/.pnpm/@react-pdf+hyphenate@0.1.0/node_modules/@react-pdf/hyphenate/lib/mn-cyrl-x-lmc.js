import patterns from 'hyphen/patterns/mn-cyrl-x-lmc.js';
import createHyphenator from './index.js';

const { hyphenate, syllables } = createHyphenator(patterns);

export { hyphenate, syllables, patterns };
