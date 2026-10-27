import patterns from 'hyphen/patterns/cs.js';
import createHyphenator from './index.js';

const { hyphenate, syllables } = createHyphenator(patterns);

export { hyphenate, syllables, patterns };
