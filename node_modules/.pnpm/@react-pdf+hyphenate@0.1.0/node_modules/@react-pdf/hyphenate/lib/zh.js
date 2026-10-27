import patterns from 'hyphen/patterns/zh-latn-pinyin.js';
import createHyphenator from './index.js';

const { hyphenate, syllables } = createHyphenator(patterns);

export { hyphenate, syllables, patterns };
