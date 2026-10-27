type Patterns = {
    patterns: string[];
    exceptions: string[];
};
type Hyphenator = {
    /**
     * Insert soft hyphens at every legal break.
     */
    hyphenate: (word: string) => string;
    /**
     * Split a word into the syllables it may break into.
     */
    syllables: (word: string) => string[];
};
/**
 * Build a hyphenator for a language's pattern set.
 *
 * @param source - Language patterns, as shipped by `hyphen/patterns/*`
 * @returns Hyphenator
 */
declare const createHyphenator: (source: Patterns) => Hyphenator;

export { type Hyphenator, type Patterns, createHyphenator as default };
