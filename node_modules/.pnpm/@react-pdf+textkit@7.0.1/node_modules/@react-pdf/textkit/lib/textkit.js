import { last, isNil, reverse, dropLast as dropLast$2, adjust, compose, repeat } from '@react-pdf/fns';
import bidiFactory from 'bidi-js';
import unicode from 'unicode-properties';
import { syllables } from '@react-pdf/hyphenate/en-us';

/**
 * Scripts requiring NFD decomposition for correct glyph-to-string mapping.
 * In these complex scripts, fontkit's glyph output after OpenType shaping
 * can produce codepoints that don't match the NFC input, making index
 * mapping unreliable. NFD produces codepoints that align with fontkit's output.
 *
 * Latin, Greek, Cyrillic and other simple scripts are excluded because
 * fontkit handles their NFC forms correctly.
 */
const SCRIPTS_NEEDING_DECOMPOSITION = [
    'Bengali',
    'Devanagari',
    'Gujarati',
    'Gurmukhi',
    'Kannada',
    'Khmer',
    'Malayalam',
    'Myanmar',
    'Oriya',
    'Sinhala',
    'Tamil',
    'Telugu',
    'Tibetan',
];
const scriptPattern = SCRIPTS_NEEDING_DECOMPOSITION.map((s) => `\\p{Script=${s}}`).join('|');
const HAS_COMPLEX_SCRIPT = new RegExp(scriptPattern, 'u');
const COMPLEX_SCRIPT_CHARS = new RegExp(`(?:${scriptPattern})+`, 'gu');
/**
 * Selectively applies NFD decomposition only to characters from complex
 * scripts that need it for correct glyph mapping. Other scripts remain
 * in their original (NFC) form since fontkit handles them correctly.
 */
const selectiveNFD = (str) => {
    if (!HAS_COMPLEX_SCRIPT.test(str))
        return str;
    return str.replace(COMPLEX_SCRIPT_CHARS, (match) => match.normalize('NFD'));
};
const isCustomFont = (run) => {
    const font = run.attributes?.font?.[0];
    return !!font && font.type !== 'STANDARD';
};
/**
 * Selectively decomposes Unicode characters in an attributed string.
 * Only characters from complex scripts (Indic, Southeast Asian) are
 * NFD-decomposed for custom fonts. Latin and other simple scripts
 * remain in NFC form.
 *
 * @returns Layout step that transforms an attributed string
 */
const decomposeUnicode = () => {
    return (attributedString) => {
        let string = '';
        let offset = 0;
        let changed = false;
        const runs = [];
        for (let i = 0; i < attributedString.runs.length; i += 1) {
            const run = attributedString.runs[i];
            const rawString = attributedString.string.slice(run.start, run.end);
            const runString = isCustomFont(run) ? selectiveNFD(rawString) : rawString;
            if (runString !== rawString || run.start !== offset)
                changed = true;
            const fragmentLength = runString.length;
            runs.push({
                ...run,
                start: offset,
                end: offset + fragmentLength,
            });
            offset += fragmentLength;
            string += runString;
        }
        if (!changed)
            return attributedString;
        return { ...attributedString, string, runs };
    };
};

/**
 * Create attributed string from text fragments
 *
 * @param fragments - Fragments
 * @returns Attributed string
 */
const fromFragments = (fragments) => {
    let offset = 0;
    const strings = [];
    const runs = [];
    for (let i = 0; i < fragments.length; i += 1) {
        const fragment = fragments[i];
        const fragmentLength = fragment.string.length;
        strings.push(fragment.string);
        runs.push({
            ...fragment,
            start: offset,
            end: offset + fragmentLength,
            attributes: fragment.attributes || {},
        });
        offset += fragmentLength;
    }
    return { string: strings.join(''), runs };
};

const SOFT_HYPHEN$1 = '\u00ad';
/**
 * Default word hyphenation engine used when no one provided.
 * Does not perform word hyphenation at all
 *
 * @param word
 * @returns Same word
 */
const defaultHyphenate = (word) => [word];
/**
 * Remove soft hyphens from word
 *
 * @param word
 * @returns Word without soft hyphens
 */
const removeSoftHyphens = (word) => {
    return word.replaceAll(SOFT_HYPHEN$1, '');
};
/**
 * Wrap words of attribute string
 *
 * @param engines layout engines
 * @param options layout options
 */
const wrapWords = (engines = {}, options = {}) => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string including syllables
     */
    return (attributedString) => {
        const syllables = [];
        const fragments = [];
        const builtinHyphenate = engines.wordHyphenation?.() || defaultHyphenate;
        const hyphenate = options.hyphenationCallback || builtinHyphenate;
        let offset = 0;
        for (let i = 0; i < attributedString.runs.length; i += 1) {
            let string = '';
            const run = attributedString.runs[i];
            const words = attributedString.string
                .slice(run.start, run.end)
                .split(/([ ]+)/g)
                .filter(Boolean);
            for (let j = 0; j < words.length; j += 1) {
                const word = words[j];
                const parts = hyphenate(word, builtinHyphenate).map(removeSoftHyphens);
                syllables.push(...parts);
                string += parts.join('');
            }
            // Modify run start and end based on removed soft hyphens.
            const runOffset = run.end - run.start - string.length;
            const start = run.start - offset;
            const end = run.end - offset - runOffset;
            fragments.push({ ...run, start, end, string });
            offset += runOffset;
        }
        const result = { ...fromFragments(fragments), syllables };
        return result;
    };
};

/**
 * Clone rect
 *
 * @param rect - Rect
 * @returns Cloned rect
 */
const copy = (rect) => {
    return Object.assign({}, rect);
};

/**
 * Partition rect in two in the vertical direction
 *
 * @param rect - Rect
 * @param height - Height
 * @returns Partitioned rects
 */
const partition = (rect, height) => {
    const a = Object.assign({}, rect, { height });
    const b = Object.assign({}, rect, {
        y: rect.y + height,
        height: rect.height - height,
    });
    return [a, b];
};

/**
 * Crop upper section of rect
 *
 * @param height - Height
 * @param rect - Rect
 * @returns Cropped rect
 */
const crop = (height, rect) => {
    const [, result] = partition(rect, height);
    return result;
};

/**
 * Get paragraph block height
 *
 * @param paragraph - Paragraph
 * @returns Paragraph block height
 */
const height$2 = (paragraph) => {
    return paragraph.reduce((acc, block) => acc + block.box.height, 0);
};

/**
 * Calculate run scale
 *
 * @param run - Run
 * @returns Scale
 */
const calculateScale = (run) => {
    const attributes = run.attributes || {};
    const fontSize = attributes.fontSize || 12;
    const font = attributes.font;
    const unitsPerEm = typeof font === 'string' ? null : font?.[0]?.unitsPerEm;
    return unitsPerEm ? fontSize / unitsPerEm : 0;
};
/**
 * Get run scale
 *
 * @param  run
 * @returns Scale
 */
const scale = (run) => {
    return run.attributes?.scale || calculateScale(run);
};

/**
 * Get ligature offset by index
 *
 * Ex. ffi ligature
 *
 *   glyphs:         l  o  f  f  i  m
 *   stringIndices:   0  1  2  2  2  3
 *   offset:         0  0  0  1  2  0
 *
 * @param index
 * @param run - Run
 * @returns Ligature offset
 */
const offset = (index, run) => {
    if (!run)
        return 0;
    const stringIndices = run.stringIndices || [];
    const value = stringIndices[index];
    if (value === undefined)
        return 0;
    let result = 0;
    for (let i = index - 1; i >= 0 && stringIndices[i] === value; i -= 1) {
        result += 1;
    }
    return result;
};

/**
 * Get run font
 *
 * @param run - Run
 * @returns Font
 */
const getFont = (run) => {
    return run.attributes?.font?.[0] || null;
};

/**
 * Slice glyph between codePoints range.
 * Useful for breaking ligatures into individual glyphs.
 *
 * @param start - Start code point index
 * @param end - End code point index
 * @param font - Font to generate new glyphs from
 * @param glyph - Glyph to be sliced
 * @returns Array of sliced glyph parts
 */
const slice$2 = (start, end, font, glyph) => {
    if (!glyph)
        return [];
    if (start === end)
        return [];
    const { codePoints } = glyph;
    if (start === 0 && end === codePoints.length)
        return [glyph];
    if (!font)
        return [glyph];
    const slicedCodePoints = codePoints.slice(start, end);
    const string = String.fromCodePoint(...slicedCodePoints);
    // Force LTR direction to prevent fontkit from reversing the string
    return font.layout(string, undefined, undefined, undefined, 'ltr').glyphs;
};

/**
 * Return last glyph index that maps to the given string index.
 * Falls back to the string index itself if glyphIndices is not present.
 *
 * When multiple consecutive glyphs point to the same string index
 * (e.g. decomposed characters), returns the last glyph in that group.
 *
 * @param index - String index
 * @param run - Run
 * @returns Glyph index
 */
const glyphIndexAt = (index, run) => {
    const glyphIndices = run?.glyphIndices;
    if (!glyphIndices)
        return index;
    // If index is past all glyph mappings, return length (one past end)
    if (glyphIndices.length > 0 &&
        index > glyphIndices[glyphIndices.length - 1]) {
        return glyphIndices.length;
    }
    let low = 0;
    let high = glyphIndices.length - 1;
    let result = index;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (glyphIndices[mid] <= index) {
            result = mid;
            low = mid + 1;
        }
        else {
            high = mid - 1;
        }
    }
    return result;
};

/**
 * Returns new array starting with zero, keeping the same relation between consecutive values.
 *
 * @param array - List of numbers
 * @returns Normalized array starting at zero
 */
const normalize = (array) => {
    if (array.length === 0)
        return [];
    const offset = array[0];
    return array.map((value) => value - offset);
};

/**
 * Slice run between string indices range
 *
 * @param start - String index
 * @param end - String index
 * @param run - Run
 * @returns Sliced run
 */
const slice$1 = (start, end, run) => {
    const runScale = scale(run);
    const font = getFont(run);
    // Get glyph start and end indices
    const startIndex = glyphIndexAt(start, run);
    const endIndex = glyphIndexAt(end - 1, run);
    // Get start and end glyph
    const startGlyph = run.glyphs?.[startIndex];
    const endGlyph = run.glyphs?.[endIndex];
    // Get start ligature chunks (if any)
    const startOffset = offset(start, run);
    const startGlyphs = startOffset > 0 ? slice$2(startOffset, Infinity, font, startGlyph) : [];
    // Get end ligature chunks (if any)
    const endOffset = offset(end, run);
    const endGlyphs = slice$2(0, endOffset, font, endGlyph);
    // Compute new glyphs
    const startGlyphCovers = (run.glyphIndices?.[startIndex] ?? startIndex) >= start;
    const sliceStart = startIndex + (startOffset > 0 || !startGlyphCovers ? 1 : 0);
    const sliceEnd = endIndex + 1 - Math.min(1, endOffset);
    const glyphs = (run.glyphs || []).slice(sliceStart, sliceEnd);
    // Compute new positions
    const glyphPosition = (g) => ({
        xAdvance: g.advanceWidth * runScale,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
    });
    const startPositions = startGlyphs.map(glyphPosition);
    const positions = (run.positions || []).slice(sliceStart, sliceEnd);
    const endPositions = endGlyphs.map(glyphPosition);
    // Compute new string indices
    const stringIndices = normalize((run.stringIndices || []).slice(start, end));
    // Compute new glyph indices
    const startGlyphIndices = startGlyphs.map((_, i) => (run.glyphIndices?.[startIndex] ?? 0) - start + startOffset + i);
    const slicedGlyphIndices = (run.glyphIndices || [])
        .slice(sliceStart, sliceEnd)
        .map((v) => v - start);
    const endGlyphIndices = endGlyphs.map((_, i) => (run.glyphIndices?.[endIndex] ?? 0) - start + i);
    const glyphIndices = [
        startGlyphIndices,
        slicedGlyphIndices,
        endGlyphIndices,
    ].flat();
    return Object.assign({}, run, {
        start: Math.max(run.start + start, 0),
        end: Math.max(Math.min(run.end, run.start + end), 0),
        stringIndices,
        glyphIndices,
        glyphs: [startGlyphs, glyphs, endGlyphs].flat(),
        positions: [startPositions, positions, endPositions].flat(),
    });
};

/**
 * Get run index that contains passed index
 *
 * @param index - Index
 * @param runs - Runs
 * @returns Run index
 */
const runIndexAt$1 = (index, runs) => {
    if (!runs)
        return -1;
    return runs.findIndex((run) => run.start <= index && index < run.end);
};

/**
 * Filter runs contained between start and end
 *
 * @param start
 * @param end
 * @param runs
 * @returns Filtered runs
 */
const filter = (start, end, runs) => {
    const startIndex = runIndexAt$1(start, runs);
    const endIndex = Math.max(runIndexAt$1(end - 1, runs), startIndex);
    return runs.slice(startIndex, endIndex + 1);
};

/**
 * Subtract scalar to run
 *
 * @param index - Scalar
 * @param run - Run
 * @returns Subtracted run
 */
const subtract = (index, run) => {
    const start = run.start - index;
    const end = run.end - index;
    return Object.assign({}, run, { start, end });
};

/**
 * Slice array of runs
 *
 * @param start - Offset
 * @param end - Offset
 * @param runs
 * @returns Sliced runs
 */
const sliceRuns = (start, end, runs) => {
    const sliceFirstRun = (a) => slice$1(start - a.start, end - a.start, a);
    const sliceLastRun = (a) => slice$1(0, end - a.start, a);
    return runs.map((run, i) => {
        let result = run;
        const isFirst = i === 0;
        const isLast = !isFirst && i === runs.length - 1;
        if (isFirst)
            result = sliceFirstRun(run);
        if (isLast)
            result = sliceLastRun(run);
        return subtract(start, result);
    });
};
/**
 * Slice attributed string between two indices
 *
 * @param start - Offset
 * @param end - Offset
 * @param attributedString - Attributed string
 * @returns Attributed string
 */
const slice = (start, end, attributedString) => {
    if (attributedString.string.length === 0)
        return attributedString;
    const string = attributedString.string.slice(start, end);
    const filteredRuns = filter(start, end, attributedString.runs);
    const slicedRuns = sliceRuns(start, end, filteredRuns);
    return Object.assign({}, attributedString, { string, runs: slicedRuns });
};

const WHITESPACE_REGEX = /\S/;
/**
 * Find index of first non-whitespace character
 *
 * @param string - String to search
 * @returns Index of first non-whitespace character, or -1 if not found
 */
const findCharIndex = (string) => {
    return string.search(WHITESPACE_REGEX);
};
/**
 * Find index of last non-whitespace character
 *
 * @param string - String to search
 * @returns Index of last non-whitespace character, or -1 if not found
 */
const findLastCharIndex = (string) => {
    for (let i = string.length - 1; i >= 0; i -= 1) {
        if (WHITESPACE_REGEX.test(string[i]))
            return i;
    }
    return -1;
};
/**
 * Removes (strips) whitespace from both ends of the attributted string.
 *
 * @param attributedString - Attributed string
 * @returns Attributed string
 */
const trim = (attributedString) => {
    const start = findCharIndex(attributedString.string);
    const end = findLastCharIndex(attributedString.string);
    return slice(start, end + 1, attributedString);
};

/**
 * Returns empty run
 *
 * @returns Empty run
 */
const empty$1 = () => {
    return {
        start: 0,
        end: 0,
        stringIndices: [],
        glyphIndices: [],
        glyphs: [],
        positions: [],
        attributes: {},
    };
};

/**
 * Check if value is a number
 *
 * @param value - Value to check
 * @returns Whether value is a number
 */
const isNumber = (value) => {
    return typeof value === 'number';
};

/**
 * Append glyph indices with given length
 *
 * Ex. appendIndices(3, [0, 1, 2, 2]) => [0, 1, 2, 2, 3, 3, 3]
 *
 * @param length - Length to append
 * @param indices - Glyph indices
 * @returns Extended glyph indices
 */
const appendIndices$1 = (length, indices) => {
    const lastIndex = last(indices);
    const value = isNil(lastIndex) ? 0 : lastIndex + 1;
    const newIndices = Array(length).fill(value);
    return indices.concat(newIndices);
};

/**
 * Append a new glyph index entry to the end of the indices array.
 * The appended value represents the character position of the new glyph,
 * which corresponds to the current string length.
 *
 * @param value - The current string length (character position of the new glyph)
 * @param indices - The existing glyph indices array
 * @returns New array with the appended index
 */
const appendIndices = (value, indices) => {
    return indices.concat([value]);
};

/**
 * Get glyph for a given code point
 *
 * @param codePoint - Unicode code point (0 is treated as invalid)
 * @param font - Font to get glyph from
 * @returns Glyph or null if font/codePoint is invalid
 */
const fromCodePoint = (codePoint, font) => {
    // String fonts (e.g., 'Helvetica') don't support glyph lookup
    if (typeof font === 'string')
        return null;
    // Require valid font and non-zero code point
    if (!font || !codePoint)
        return null;
    return font.glyphForCodePoint(codePoint);
};

/**
 * Append glyph to run
 *
 * @param glyph - Glyph
 * @param run - Run
 * @returns Run with glyph
 */
const appendGlyph = (glyph, run) => {
    const glyphLength = glyph.codePoints?.length || 0;
    const stringLength = run.stringIndices?.length || 0;
    const glyphs = run.glyphs.concat(glyph);
    const stringIndices = appendIndices$1(glyphLength, run.stringIndices);
    const glyphIndices = appendIndices(stringLength, run.glyphIndices);
    const end = run.end + glyphLength;
    if (!run.positions)
        return Object.assign({}, run, { end, glyphs, stringIndices, glyphIndices });
    const positions = run.positions.concat({
        xAdvance: glyph.advanceWidth * scale(run),
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
    });
    return Object.assign({}, run, {
        end,
        glyphs,
        stringIndices,
        glyphIndices,
        positions,
    });
};
/**
 * Append glyph or code point to run
 *
 * @param value - Glyph or codePoint
 * @param run - Run
 * @returns Run with glyph
 */
const append$1 = (value, run) => {
    if (!value)
        return run;
    const font = getFont(run);
    const glyph = isNumber(value) ? fromCodePoint(value, font) : value;
    return appendGlyph(glyph, run);
};

/**
 * Get string from array of code points
 *
 * @param codePoints - Points
 * @returns String
 */
const stringFromCodePoints = (codePoints) => {
    return String.fromCodePoint(...(codePoints || []));
};

/**
 * Append glyph into last run of attributed string
 *
 * @param glyph - Glyph or code point
 * @param attributedString - Attributed string
 * @returns Attributed string with new glyph
 */
const append = (glyph, attributedString) => {
    const codePoints = typeof glyph === 'number' ? [glyph] : glyph?.codePoints;
    const codePointsString = stringFromCodePoints(codePoints || []);
    const string = attributedString.string + codePointsString;
    const firstRuns = attributedString.runs.slice(0, -1);
    const lastRun = last(attributedString.runs) || empty$1();
    const runs = firstRuns.concat(append$1(glyph, lastRun));
    return Object.assign({}, attributedString, { string, runs });
};

const ELLIPSIS_UNICODE = 8230;
const ELLIPSIS_STRING = String.fromCharCode(ELLIPSIS_UNICODE);
/**
 * Get ellipsis codepoint. This may be different in standard and embedded fonts
 *
 * @param font
 * @returns Ellipsis codepoint
 */
const getEllipsisCodePoint = (font) => {
    if (!font.encode)
        return ELLIPSIS_UNICODE;
    const [codePoints] = font.encode(ELLIPSIS_STRING);
    return parseInt(codePoints[0], 16);
};
/**
 * Trucante block with ellipsis
 *
 * @param paragraph - Paragraph
 * @returns Sliced paragraph
 */
const truncate = (paragraph) => {
    const runs = last(paragraph)?.runs || [];
    const font = last(runs)?.attributes?.font[0];
    if (font) {
        const index = paragraph.length - 1;
        const codePoint = getEllipsisCodePoint(font);
        const glyph = font.glyphForCodePoint(codePoint);
        const lastBlock = append(glyph, trim(paragraph[index]));
        return Object.assign([], paragraph, { [index]: lastBlock });
    }
    return paragraph;
};

/**
 * Omit attribute from run
 *
 * @param value - Attribute key
 * @param run - Run
 * @returns Run without ommited attribute
 */
const omit = (value, run) => {
    if (!run.attributes || !(value in run.attributes))
        return run;
    const attributes = Object.assign({}, run.attributes);
    delete attributes[value];
    return Object.assign({}, run, { attributes });
};

/**
 * Get run ascent
 *
 * @param run - Run
 * @returns Ascent
 */
const ascent$1 = (run) => {
    const { font, attachment } = run.attributes;
    const attachmentHeight = attachment?.height || 0;
    const fontAscent = typeof font === 'string' ? 0 : font?.[0]?.ascent || 0;
    return Math.max(attachmentHeight, fontAscent * scale(run));
};

/**
 * Get run descent
 *
 * @param run - Run
 * @returns Descent
 */
const descent = (run) => {
    const font = run.attributes?.font;
    const fontDescent = typeof font === 'string' ? 0 : font?.[0]?.descent || 0;
    return scale(run) * fontDescent;
};

/**
 * Get run lineGap
 *
 * @param run - Run
 * @returns LineGap
 */
const lineGap = (run) => {
    const font = run.attributes?.font;
    const lineGap = typeof font === 'string' ? 0 : font?.[0]?.lineGap || 0;
    return lineGap * scale(run);
};

/**
 * Get run height
 *
 * @param run - Run
 * @returns Height
 */
const height$1 = (run) => {
    const lineHeight = run.attributes?.lineHeight;
    return lineHeight || lineGap(run) + ascent$1(run) - descent(run);
};

/**
 * Returns attributed string height
 *
 * @param attributedString - Attributed string
 * @returns Height
 */
const height = (attributedString) => {
    const reducer = (acc, run) => Math.max(acc, height$1(run));
    return attributedString.runs.reduce(reducer, 0);
};

const ellipseInterval = (cx, cy, rx, ry, y0, y1) => {
    if (y1 <= cy - ry || y0 >= cy + ry)
        return null;
    // The ellipse is widest at the band y closest to its center
    const y = Math.min(Math.max(cy, y0), y1);
    const t = ry === 0 ? 0 : (y - cy) / ry;
    const halfWidth = rx * Math.sqrt(1 - t * t);
    return { x0: cx - halfWidth, x1: cx + halfWidth };
};
const polygonInterval = (points, y0, y1) => {
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (a.y >= y0 && a.y <= y1)
            xs.push(a.x);
        const crossings = [y0, y1];
        for (let j = 0; j < crossings.length; j += 1) {
            const y = crossings[j];
            if ((a.y < y && b.y > y) || (a.y > y && b.y < y)) {
                xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
            }
        }
    }
    if (xs.length === 0)
        return null;
    return { x0: Math.min(...xs), x1: Math.max(...xs) };
};
/**
 * Horizontal extent a shape occupies within the y band [y0, y1].
 * Conservative for polygons: concavities inside a band are filled,
 * matching line-granularity flow in browsers.
 *
 * @param shape - Exclusion shape
 * @param y0 - Band top
 * @param y1 - Band bottom
 * @returns Occupied x interval, or null if the shape misses the band
 */
const bandInterval = (shape, y0, y1) => {
    let interval;
    if (shape.type === 'ellipse') {
        interval = ellipseInterval(shape.cx, shape.cy, shape.rx, shape.ry, y0, y1);
    }
    else if (shape.type === 'polygon') {
        interval = polygonInterval(shape.points, y0, y1);
    }
    else {
        interval =
            y1 <= shape.y || y0 >= shape.y + shape.height
                ? null
                : { x0: shape.x, x1: shape.x + shape.width };
    }
    if (!interval || interval.x1 - interval.x0 <= 0)
        return null;
    return interval;
};

/**
 * Returns max shape Y coordinate
 *
 * @param shape - Exclusion shape
 * @returns Y coordinate
 */
const maxY = (shape) => {
    if (shape.type === 'ellipse')
        return shape.cy + shape.ry;
    if (shape.type === 'polygon') {
        let max = -Infinity;
        for (let i = 0; i < shape.points.length; i += 1) {
            max = Math.max(max, shape.points[i].y);
        }
        return max;
    }
    return shape.y + shape.height;
};

const getLineFragments = (rect, shapes) => {
    let fragments = [rect];
    for (let i = 0; i < shapes.length; i += 1) {
        const shape = shapes[i];
        const interval = bandInterval(shape, rect.y, rect.y + rect.height);
        if (!interval)
            continue;
        // extend stretches the exclusion to the line edge on the float side,
        // so text never lands between a floated shape and its own margin edge
        const x0 = shape.extend === 'left' ? -Infinity : interval.x0;
        const x1 = shape.extend === 'right' ? Infinity : interval.x1;
        fragments = fragments.reduce((acc, fragment) => {
            const fStart = fragment.x;
            const fEnd = fragment.x + fragment.width;
            if (x1 <= fStart || x0 >= fEnd)
                return acc.concat(fragment);
            const a = Object.assign({}, fragment, { width: x0 - fStart });
            const b = Object.assign({}, fragment, { x: x1, width: fEnd - x1 });
            return acc.concat([a, b].filter((r) => r.width > 0));
        }, []);
    }
    return fragments;
};
const generateLineRects = (container, height) => {
    const { exclusions, ...rect } = container;
    if (!exclusions || exclusions.length === 0)
        return [rect];
    const lineRects = [];
    const maxY$1 = Math.max(...exclusions.map(maxY));
    let currentRect = rect;
    while (currentRect.y < maxY$1) {
        const [lineRect, rest] = partition(currentRect, height);
        const lineRectFragments = getLineFragments(lineRect, exclusions);
        currentRect = rest;
        lineRects.push(...lineRectFragments);
    }
    return [...lineRects, currentRect];
};

const ATTACHMENT_CODE$1 = '\ufffc'; // 65532
/**
 * Remove attachment attribute if no char present
 *
 * @param line - Line
 * @returns Line
 */
const purgeAttachments = (line) => {
    const shouldPurge = !line.string.includes(ATTACHMENT_CODE$1);
    if (!shouldPurge)
        return line;
    // applyDefaultStyles materializes `attachment: null` on every run, so only
    // pay for the omit copy when an attachment is actually set.
    const runs = line.runs.map((run) => run.attributes?.attachment ? omit('attachment', run) : run);
    return Object.assign({}, line, { runs });
};
/**
 * Layout paragraphs inside rectangle
 *
 * @param rects - Rects
 * @param lines - Attributed strings
 * @param indent
 * @returns layout blocks
 */
const layoutLines = (rects, lines, indent) => {
    let rect = rects.shift();
    let currentY = rect.y;
    return lines.map((line, i) => {
        const lineIndent = i === 0 ? indent : 0;
        const style = line.runs?.[0]?.attributes || {};
        const height$1 = Math.max(height(line), style.lineHeight);
        if (currentY + height$1 > rect.y + rect.height && rects.length > 0) {
            rect = rects.shift();
            currentY = rect.y;
        }
        const newLine = {
            string: line.string,
            runs: line.runs,
            box: {
                x: rect.x + lineIndent,
                y: currentY,
                width: rect.width - lineIndent,
                height: height$1,
            },
        };
        currentY += height$1;
        return purgeAttachments(newLine);
    });
};
/**
 * Performs line breaking and layout
 *
 * @param engines - Engines
 * @param options - Layout options
 */
const layoutParagraph = (engines, options = {}) => {
    /**
     * @param container - Container
     * @param paragraph - Attributed string
     * @returns Layout block
     */
    return (container, paragraph) => {
        const height$1 = height(paragraph);
        const indent = paragraph.runs?.[0]?.attributes?.indent || 0;
        const rects = generateLineRects(container, height$1);
        /* A single rect is a uniform measure: prepend the indented first-line
           width and the linebreaker repeats the last entry for the rest. With
           exclusions each rect already maps to one line, so widths must stay
           1:1 with rects — only the first one shrinks by the indent. */
        const availableWidths = rects.map((r) => r.width);
        if (rects.length === 1) {
            availableWidths.unshift(availableWidths[0] - indent);
        }
        else {
            availableWidths[0] -= indent;
        }
        const lines = engines.linebreaker(options)(paragraph, availableWidths);
        return layoutLines(rects, lines, indent);
    };
};

/**
 * Slice block at given height
 *
 * @param height - Height
 * @param paragraph - Paragraph
 * @returns Sliced paragraph
 */
const sliceAtHeight = (height, paragraph) => {
    const newBlock = [];
    let counter = 0;
    for (let i = 0; i < paragraph.length; i += 1) {
        const line = paragraph[i];
        counter += line.box.height;
        if (counter < height) {
            newBlock.push(line);
        }
        else {
            break;
        }
    }
    return newBlock;
};

/**
 * Layout paragraphs inside container until it does not
 * fit anymore, performing line wrapping in the process.
 *
 * @param  engines - Engines
 * @param  options - Layout options
 * @param container - Container
 */
const typesetter = (engines, options, container) => {
    /**
     * @param attributedStrings - Attributed strings (paragraphs)
     * @returns Paragraph blocks
     */
    return (attributedStrings) => {
        const result = [];
        const paragraphs = [...attributedStrings];
        const layout = layoutParagraph(engines, options);
        const maxLines = isNil(container.maxLines) ? Infinity : container.maxLines;
        const truncateEllipsis = container.truncateMode === 'ellipsis';
        let linesCount = maxLines;
        let paragraphRect = copy(container);
        let nextParagraph = paragraphs.shift();
        while (linesCount > 0 && nextParagraph) {
            const paragraph = layout(paragraphRect, nextParagraph);
            const slicedBlock = paragraph.slice(0, linesCount);
            const linesHeight = height$2(slicedBlock);
            const shouldTruncate = truncateEllipsis && paragraph.length !== slicedBlock.length;
            linesCount -= slicedBlock.length;
            if (paragraphRect.height >= linesHeight) {
                result.push(shouldTruncate ? truncate(slicedBlock) : slicedBlock);
                paragraphRect = crop(linesHeight, paragraphRect);
                nextParagraph = paragraphs.shift();
            }
            else {
                result.push(truncate(sliceAtHeight(paragraphRect.height, slicedBlock)));
                break;
            }
        }
        return result;
    };
};

/**
 * Resolve string indices based on glyphs code points.
 * Maps each glyph to its corresponding string index, handling ligatures
 * by assigning the same index to all code points within a ligature.
 *
 * @param glyphs - Array of glyphs (may contain undefined for missing glyphs)
 * @returns Glyph indices array
 */
const resolve$1 = (glyphs = []) => {
    const result = [];
    let currentIndex = 0;
    for (let i = 0; i < glyphs.length; i += 1) {
        const glyph = glyphs[i];
        const codePointCount = glyph?.codePoints?.length || 0;
        for (let j = 0; j < codePointCount; j += 1) {
            result.push(currentIndex);
        }
        currentIndex += 1;
    }
    return result;
};

/**
 * Resolve glyph indices based on glyphs code points.
 * Maps each glyph to its starting character index in the original string,
 * accounting for ligatures where a single glyph represents multiple code points.
 *
 * @param glyphs - Array of glyphs (may contain undefined for missing glyphs)
 * @returns Array of character indices, one per glyph
 */
const resolve = (glyphs = []) => {
    const result = [];
    let currentIndex = 0;
    for (let i = 0; i < glyphs.length; i += 1) {
        const glyph = glyphs[i];
        const length = glyph?.codePoints?.length || 0;
        const value = length === 0 ? result[i - 1] : currentIndex;
        result.push(value);
        currentIndex += length;
    }
    return result;
};

/**
 * Order runs for visual display, applying UAX #9 rule L2: from the highest
 * bidi level down to level 1, reverse every contiguous sequence of runs at
 * that level or above.
 *
 * @param runs - Runs
 * @returns Run indices in visual order
 */
const reorderRuns = (runs) => {
    const levels = runs.map((run) => run.attributes.bidiLevel || 0);
    const order = runs.map((_, index) => index);
    const maxLevel = Math.max(...levels);
    for (let level = maxLevel; level >= 1; level -= 1) {
        let start = 0;
        while (start < order.length) {
            if (levels[order[start]] < level) {
                start += 1;
                continue;
            }
            let end = start + 1;
            while (end < order.length && levels[order[end]] >= level)
                end += 1;
            order.splice(start, end - start, ...order.slice(start, end).reverse());
            start = end;
        }
    }
    return order;
};
/**
 * Reverse the glyphs and characters of a right to left run. Glyphs stay inside
 * their own run, so run attributes are never mixed between runs.
 *
 * @param run - Run
 * @param string - Run substring
 * @returns Reversed run and string
 */
const reverseRun = (run, string) => {
    const glyphs = [...(run.glyphs || [])].reverse();
    const positions = [...(run.positions || [])].reverse();
    return {
        run: {
            ...run,
            glyphs,
            positions,
            stringIndices: resolve$1(glyphs),
            glyphIndices: resolve(glyphs),
        },
        string: Array.from(string).reverse().join(''),
    };
};
const reorderLine = (line) => {
    if (line.runs.length === 0)
        return line;
    const levels = line.runs.map((run) => run.attributes.bidiLevel || 0);
    // No need for bidi reordering
    if (Math.max(...levels) === 0)
        return line;
    let offset = 0;
    let string = '';
    const runs = reorderRuns(line.runs).map((index) => {
        const run = line.runs[index];
        const runString = line.string.slice(run.start, run.end);
        const reversed = levels[index] % 2 === 1 && reverseRun(run, runString);
        const start = offset;
        offset += run.end - run.start;
        string += reversed ? reversed.string : runString;
        return { ...(reversed ? reversed.run : run), start, end: offset };
    });
    return { ...line, runs, string };
};
const reorderParagraph = (paragraph) => paragraph.map(reorderLine);
/**
 * Perform bidi reordering
 *
 * @returns Reordered paragraphs
 */
const bidiReordering = () => {
    /**
     * @param paragraphs - Paragraphs
     * @returns Reordered paragraphs
     */
    return (paragraphs) => paragraphs.map(reorderParagraph);
};

const getCharacterSpacing = (run) => {
    return run.attributes?.characterSpacing || 0;
};
/**
 * Scale run positions
 *
 * @param  run
 * @param  positions
 * @returns Scaled positions
 */
const scalePositions = (run, positions) => {
    const runScale = scale(run);
    const characterSpacing = getCharacterSpacing(run);
    return positions.map((position, i) => {
        const isLast = i === positions.length;
        const xSpacing = isLast ? 0 : characterSpacing;
        return {
            xAdvance: position.xAdvance * runScale + xSpacing,
            yAdvance: position.yAdvance * runScale,
            xOffset: position.xOffset * runScale,
            yOffset: position.yOffset * runScale,
            advanceWidth: position.advanceWidth,
        };
    });
};
/**
 * Create glyph run
 *
 * @param string string
 */
const layoutRun = (string) => {
    /**
     * @param run - Run
     * @returns Glyph run
     */
    return (run) => {
        const { start, end, attributes = {} } = run;
        const { font, features } = attributes;
        if (!font)
            return {
                ...run,
                glyphs: [],
                stringIndices: [],
                glyphIndices: [],
                positions: [],
            };
        const runString = string.slice(start, end);
        if (typeof font === 'string')
            throw new Error('Invalid font');
        // passing LTR To force fontkit to not reverse the string
        const glyphRun = font[0].layout(runString, features, undefined, undefined, 'ltr');
        const positions = scalePositions(run, glyphRun.positions);
        const stringIndices = resolve$1(glyphRun.glyphs);
        const glyphIndices = resolve(glyphRun.glyphs);
        const result = {
            ...run,
            positions,
            stringIndices,
            glyphIndices,
            glyphs: glyphRun.glyphs,
        };
        return result;
    };
};
/**
 * Generate glyphs for single attributed string
 */
const generateGlyphs = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string with glyphs
     */
    return (attributedString) => {
        const runs = attributedString.runs.map(layoutRun(attributedString.string));
        const res = Object.assign({}, attributedString, { runs });
        return res;
    };
};

/**
 * Resolves yOffset for run
 *
 * @param run - Run
 * @returns Run
 */
const resolveRunYOffset = (run) => {
    if (!run.positions)
        return run;
    const unitsPerEm = run.attributes?.font?.[0]?.unitsPerEm || 0;
    const yOffset = (run.attributes?.yOffset || 0) * unitsPerEm;
    // Positions are created fresh by generateGlyphs earlier in this same
    // pipeline (and justification mutates them later), so in-place is safe.
    for (let i = 0; i < run.positions.length; i += 1) {
        run.positions[i].yOffset = yOffset;
    }
    return run;
};
/**
 * Resolves yOffset for multiple paragraphs
 */
const resolveYOffset = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string
     */
    return (attributedString) => {
        const runs = attributedString.runs.map(resolveRunYOffset);
        const res = Object.assign({}, attributedString, { runs });
        return res;
    };
};

/**
 * Sort runs in ascending order
 *
 * @param runs
 * @returns Sorted runs
 */
const sort = (runs) => {
    return runs.sort((a, b) => a.start - b.start || a.end - b.end);
};

/**
 * Is run empty (start === end)
 *
 * @param run - Run
 * @returns Is run empty
 */
const isEmpty = (run) => {
    return run.start === run.end;
};

/**
 * Sort points in ascending order
 * @param a - First point
 * @param b - Second point
 * @returns Sort order
 */
const sortPoints = (a, b) => {
    return a[1] - b[1] || a[3] - b[3];
};
/**
 * @param runs
 * @returns Points
 */
const generatePoints = (runs) => {
    const result = [];
    for (let i = 0; i < runs.length; i += 1) {
        const run = runs[i];
        result.push(['start', run.start, run.attributes, i], ['end', run.end, run.attributes, i]);
    }
    return result.sort(sortPoints);
};
/**
 * @param runs
 * @returns Merged runs
 */
const mergeRuns = (runs) => {
    return runs.reduce((acc, run) => {
        const attributes = Object.assign({}, acc.attributes, run.attributes);
        return Object.assign({}, run, { attributes });
    }, {});
};
/**
 * @param runs
 * @returns Grouped runs
 */
const groupEmptyRuns = (runs) => {
    const groups = runs.reduce((acc, run) => {
        if (!acc[run.start])
            acc[run.start] = [];
        acc[run.start].push(run);
        return acc;
    }, []);
    return Object.values(groups);
};
/**
 * @param runs
 * @returns Flattened runs
 */
const flattenEmptyRuns = (runs) => {
    return groupEmptyRuns(runs).map(mergeRuns);
};
/**
 * @param runs
 * @returns Flattened runs
 */
const flattenRegularRuns = (runs) => {
    const res = [];
    const points = generatePoints(runs);
    let start = -1;
    const stack = [];
    for (let i = 0; i < points.length; i += 1) {
        const [type, offset, attributes] = points[i];
        // Merging the active attributes only when a segment is emitted avoids
        // rebuilding them on every point, most wastefully when several runs
        // end at the same offset and no segment follows.
        if (start !== -1 && start < offset) {
            res.push({
                start,
                end: offset,
                attributes: Object.assign({}, ...stack),
                stringIndices: [],
                glyphIndices: [],
                glyphs: [],
                positions: [],
            });
        }
        if (type === 'start') {
            stack.push(attributes);
        }
        else {
            for (let j = 0; j < stack.length; j += 1) {
                if (stack[j] === attributes)
                    stack.splice(j--, 1);
            }
        }
        start = offset;
    }
    return res;
};
/**
 * Flatten many runs
 *
 * @param runs
 * @returns Flattened runs
 */
const flatten = (runs = []) => {
    const emptyRuns = flattenEmptyRuns(runs.filter((run) => isEmpty(run)));
    const regularRuns = flattenRegularRuns(runs.filter((run) => !isEmpty(run)));
    return sort(emptyRuns.concat(regularRuns));
};

/**
 * Returns empty attributed string
 *
 * @returns Empty attributed string
 */
const empty = () => ({ string: '', runs: [] });

/**
 * Performs font substitution and script itemization on attributed string
 *
 * @param engines - engines
 */
const preprocessRuns = (engines) => {
    /**
     * @param attributedString - Attributed string
     * @returns Processed attributed string
     */
    return (attributedString) => {
        if (isNil(attributedString))
            return empty();
        const { string } = attributedString;
        const { fontSubstitution, scriptItemizer, bidi } = engines;
        const { runs: itemizationRuns } = scriptItemizer()(attributedString);
        const { runs: substitutedRuns } = fontSubstitution()(attributedString);
        const { runs: bidiRuns } = bidi()(attributedString);
        const runs = attributedString.runs
            .concat(bidiRuns)
            .concat(itemizationRuns)
            .concat(substitutedRuns);
        return { string, runs: flatten(runs) };
    };
};

/**
 * Get attributed string start value
 *
 * @param attributedString - Attributed string
 * @returns Start
 */
const start = (attributedString) => {
    const { runs } = attributedString;
    return runs.length === 0 ? 0 : runs[0].start;
};

/**
 * Get attributed string end value
 *
 * @param attributedString - Attributed string
 * @returns End
 */
const end = (attributedString) => {
    const { runs } = attributedString;
    return runs.length === 0 ? 0 : last(runs).end;
};

/**
 * Get attributed string length
 *
 * @param attributedString - Attributed string
 * @returns End
 */
const length$1 = (attributedString) => {
    return end(attributedString) - start(attributedString);
};

/**
 * Breaks attributed string into paragraphs
 */
const splitParagraphs = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Paragraphs attributed strings
     */
    return (attributedString) => {
        const paragraphs = [];
        let start = 0;
        let breakPoint = attributedString.string.indexOf('\n') + 1;
        while (breakPoint > 0) {
            paragraphs.push(slice(start, breakPoint, attributedString));
            start = breakPoint;
            breakPoint = attributedString.string.indexOf('\n', breakPoint) + 1;
        }
        if (start === 0) {
            paragraphs.push(attributedString);
        }
        else if (start < attributedString.string.length) {
            paragraphs.push(slice(start, length$1(attributedString), attributedString));
        }
        return paragraphs;
    };
};

/**
 * Return positions advance width
 *
 * @param positions - Positions
 * @returns {number} advance width
 */
const advanceWidth$2 = (positions) => {
    return positions.reduce((acc, pos) => acc + (pos.xAdvance || 0), 0);
};

/**
 * Return run advance width
 *
 * @param run - Run
 * @returns Advance width
 */
const advanceWidth$1 = (run) => {
    return advanceWidth$2(run.positions || []);
};

/**
 * Returns attributed string advancewidth
 *
 * @param attributedString - Attributed string
 * @returns Advance width
 */
const advanceWidth = (attributedString) => {
    const reducer = (acc, run) => acc + advanceWidth$1(run);
    return attributedString.runs.reduce(reducer, 0);
};

/**
 * ASCII code for space character.
 * Note: Only space (32) is considered whitespace for typographic layout purposes,
 * not tabs, newlines, or other control characters.
 */
const SPACE_CODE = 32;
/**
 * Check if glyph contains a space character
 *
 * @param glyph - Glyph
 * @returns Whether glyph contains a space
 */
const isWhiteSpace$1 = (glyph) => {
    const codePoints = glyph?.codePoints || [];
    return codePoints.includes(SPACE_CODE);
};

/**
 * Check if run is entirely whitespace
 *
 * @param run - Run
 * @returns Whether run is entirely whitespace
 */
const isWhiteSpace = (run) => {
    const glyphs = run?.glyphs || [];
    return glyphs.length > 0 && glyphs.every(isWhiteSpace$1);
};

/**
 * Get white space leading positions
 *
 * @param run - Run
 * @returns White space leading positions
 */
const leadingPositions = (run) => {
    const glyphs = run.glyphs || [];
    const positions = run.positions || [];
    const leadingWhitespaces = glyphs.findIndex((g) => !isWhiteSpace$1(g));
    return leadingWhitespaces === -1
        ? positions
        : positions.slice(0, leadingWhitespaces);
};
/**
 * Get run leading white space offset
 *
 * @param run - Run
 * @returns Leading white space offset
 */
const leadingOffset$1 = (run) => {
    if (!run)
        return 0;
    const positions = leadingPositions(run);
    return positions.reduce((acc, pos) => acc + (pos.xAdvance || 0), 0);
};

/**
 * Get attributed string leading white space offset
 *
 * @param attributedString - Attributed string
 * @returns Leading white space offset
 */
const leadingOffset = (attributedString) => {
    const runs = attributedString.runs || [];
    let offset = 0;
    for (const run of runs) {
        offset += leadingOffset$1(run);
        if (!isWhiteSpace(run))
            break;
    }
    return offset;
};

/**
 * Get white space trailing positions
 *
 * @param run run
 * @returns White space trailing positions
 */
const trailingPositions = (run) => {
    const glyphs = reverse(run.glyphs || []);
    const positions = reverse(run.positions || []);
    const leadingWhitespaces = glyphs.findIndex((g) => !isWhiteSpace$1(g));
    return leadingWhitespaces === -1
        ? positions
        : positions.slice(0, leadingWhitespaces);
};
/**
 * Get run trailing white space offset
 *
 * @param run - Run
 * @returns Trailing white space offset
 */
const trailingOffset$1 = (run) => {
    if (!run)
        return 0;
    const positions = trailingPositions(run);
    return positions.reduce((acc, pos) => acc + (pos.xAdvance || 0), 0);
};

/**
 * Get attributed string trailing white space offset
 *
 * @param attributedString - Attributed string
 * @returns Trailing white space offset
 */
const trailingOffset = (attributedString) => {
    const runs = attributedString.runs || [];
    let offset = 0;
    for (let i = runs.length - 1; i >= 0; i -= 1) {
        const run = runs[i];
        offset += trailingOffset$1(run);
        if (!isWhiteSpace(run))
            break;
    }
    return offset;
};

/**
 * Drop last char of run
 *
 * @param run - Run
 * @returns Run without last char
 */
const dropLast$1 = (run) => {
    return slice$1(0, run.end - run.start - 1, run);
};

/**
 * Drop last glyph
 *
 * @param attributedString - Attributed string
 * @returns Attributed string with new glyph
 */
const dropLast = (attributedString) => {
    const string = dropLast$2(attributedString.string);
    const runs = adjust(-1, dropLast$1, attributedString.runs);
    return Object.assign({}, attributedString, { string, runs });
};

const ALIGNMENT_FACTORS = { center: 0.5, right: 1 };
/**
 * Remove new line char at the end of line if present
 *
 * @param line
 * @returns Line
 */
const removeNewLine = (line) => {
    return last(line.string) === '\n' ? dropLast(line) : line;
};
const getOverflowLeft = (line) => {
    return leadingOffset(line) + (line.overflowLeft || 0);
};
const getOverflowRight = (line) => {
    return trailingOffset(line) + (line.overflowRight || 0);
};
/**
 * Ignore whitespace at the start and end of a line for alignment
 *
 * @param line
 * @returns Line
 */
const adjustOverflow = (line) => {
    const overflowLeft = getOverflowLeft(line);
    const overflowRight = getOverflowRight(line);
    const x = line.box.x - overflowLeft;
    const width = line.box.width + overflowLeft + overflowRight;
    const box = Object.assign({}, line.box, { x, width });
    return Object.assign({}, line, { box, overflowLeft, overflowRight });
};
/**
 * Performs line justification by calling appropiate engine
 *
 * @param engines - Engines
 * @param options - Layout options
 * @param align - Text align
 */
const justifyLine$1 = (engines, options, align) => {
    /**
     * @param line - Line
     * @returns Line
     */
    return (line) => {
        const lineWidth = advanceWidth(line);
        const alignFactor = ALIGNMENT_FACTORS[align] || 0;
        const remainingWidth = Math.max(0, line.box.width - lineWidth);
        const shouldJustify = align === 'justify' || lineWidth > line.box.width;
        const x = line.box.x + remainingWidth * alignFactor;
        const box = Object.assign({}, line.box, { x });
        const newLine = Object.assign({}, line, { box });
        return shouldJustify ? engines.justification(options)(newLine) : newLine;
    };
};
const finalizeLine = (line) => {
    let lineAscent = 0;
    let lineDescent = 0;
    let lineHeight = 0;
    let lineXAdvance = 0;
    const runs = line.runs.map((run) => {
        const height = height$1(run);
        const ascent = ascent$1(run);
        const descent$1 = descent(run);
        const xAdvance = advanceWidth$1(run);
        lineHeight = Math.max(lineHeight, height);
        lineAscent = Math.max(lineAscent, ascent);
        lineDescent = Math.max(lineDescent, descent$1);
        lineXAdvance += xAdvance;
        return Object.assign({}, run, { height, ascent, descent: descent$1, xAdvance });
    });
    return Object.assign({}, line, {
        runs,
        height: lineHeight,
        ascent: lineAscent,
        descent: lineDescent,
        xAdvance: lineXAdvance,
    });
};
/**
 * Finalize line by performing line justification
 * and text decoration (using appropiate engines)
 *
 * @param engines - Engines
 * @param options - Layout options
 */
const finalizeBlock = (engines, options) => {
    /**
     * @param line - Line
     * @param i - Line index
     * @param lines - Total lines
     * @returns Line
     */
    return (line, index, lines) => {
        const isLastFragment = index === lines.length - 1;
        const style = line.runs?.[0]?.attributes || {};
        const align = isLastFragment ? style.alignLastLine : style.align;
        return compose(finalizeLine, engines.textDecoration(), justifyLine$1(engines, options, align), adjustOverflow, removeNewLine)(line);
    };
};
/**
 * Finalize line block by performing line justification
 * and text decoration (using appropiate engines)
 *
 * @param engines - Engines
 * @param options - Layout options
 */
const finalizeFragments = (engines, options) => {
    /**
     * @param paragraphs - Paragraphs
     * @returns Paragraphs
     */
    return (paragraphs) => {
        const blockFinalizer = finalizeBlock(engines, options);
        return paragraphs.map((paragraph) => paragraph.map(blockFinalizer));
    };
};

const ATTACHMENT_CODE = 0xfffc; // 65532
const isReplaceGlyph = (glyph) => glyph.codePoints.includes(ATTACHMENT_CODE);
/**
 * Resolve attachments of run
 *
 * @param run
 * @returns Run
 */
const resolveRunAttachments = (run) => {
    if (!run.positions)
        return run;
    const glyphs = run.glyphs || [];
    const attachment = run.attributes?.attachment;
    if (!attachment)
        return run;
    const positions = run.positions.map((position, i) => {
        const glyph = glyphs[i];
        if (attachment.width && isReplaceGlyph(glyph)) {
            return Object.assign({}, position, { xAdvance: attachment.width });
        }
        return Object.assign({}, position);
    });
    return Object.assign({}, run, { positions });
};
/**
 * Resolve attachments for multiple paragraphs
 */
const resolveAttachments = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string
     */
    return (attributedString) => {
        const runs = attributedString.runs.map(resolveRunAttachments);
        const res = Object.assign({}, attributedString, { runs });
        return res;
    };
};

/**
 * @param attributes - Attributes
 * @returns Attributes with defaults
 */
const applyAttributes = (a) => {
    return {
        align: a.align || (a.direction === 'rtl' ? 'right' : 'left'),
        alignLastLine: a.alignLastLine || (a.align === 'justify' ? 'left' : a.align || 'left'),
        attachment: a.attachment || null,
        backgroundColor: a.backgroundColor || null,
        bullet: a.bullet || null,
        characterSpacing: a.characterSpacing || 0,
        color: a.color || 'black',
        direction: a.direction || 'ltr',
        features: a.features || [],
        fill: a.fill !== false,
        font: a.font || [],
        fontSize: a.fontSize || 12,
        hangingPunctuation: a.hangingPunctuation || false,
        hyphenationFactor: a.hyphenationFactor || 0,
        indent: a.indent || 0,
        justificationFactor: a.justificationFactor || 1,
        lineHeight: a.lineHeight || null,
        lineSpacing: a.lineSpacing || 0,
        link: a.link || null,
        marginLeft: a.marginLeft || a.margin || 0,
        marginRight: a.marginRight || a.margin || 0,
        opacity: a.opacity,
        paddingTop: a.paddingTop || a.padding || 0,
        paragraphSpacing: a.paragraphSpacing || 0,
        script: a.script || null,
        shrinkFactor: a.shrinkFactor || 0,
        strike: a.strike || false,
        strikeColor: a.strikeColor || a.color || 'black',
        strikeStyle: a.strikeStyle || 'solid',
        stroke: a.stroke || false,
        underline: a.underline || false,
        underlineColor: a.underlineColor || a.color || 'black',
        underlineStyle: a.underlineStyle || 'solid',
        verticalAlign: a.verticalAlign || null,
        wordSpacing: a.wordSpacing || 0,
        yOffset: a.yOffset || 0,
    };
};
/**
 * Apply default style to run
 *
 * @param run - Run
 * @returns Run with default styles
 */
const applyRunStyles = (run) => {
    const attributes = applyAttributes(run.attributes);
    return Object.assign({}, run, { attributes });
};
/**
 * Apply default attributes for an attributed string
 */
const applyDefaultStyles = () => {
    return (attributedString) => {
        const string = attributedString.string || '';
        const runs = (attributedString.runs || []).map(applyRunStyles);
        return { string, runs };
    };
};

/**
 * Apply scaling and yOffset for verticalAlign 'sub' and 'super'.
 */
const verticalAlignment = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string
     */
    return (attributedString) => {
        attributedString.runs.forEach((run) => {
            const { attributes } = run;
            const { verticalAlign } = attributes;
            if (verticalAlign === 'sub') {
                attributes.yOffset = -0.2;
            }
            else if (verticalAlign === 'super') {
                attributes.yOffset = 0.4;
            }
        });
        return attributedString;
    };
};

const bidi$1 = bidiFactory();
/**
 * @param runs
 * @returns Bidi levels
 */
const getBidiLevels = (runs) => {
    return runs.reduce((acc, run) => {
        const length = run.end - run.start;
        const levels = repeat(run.attributes.bidiLevel, length);
        return acc.concat(levels);
    }, []);
};
/**
 * Perform bidi mirroring
 */
const mirrorString = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string
     */
    return (attributedString) => {
        const levels = getBidiLevels(attributedString.runs);
        let updatedString = '';
        attributedString.string.split('').forEach((char, index) => {
            const isRTL = levels[index] % 2 === 1;
            const mirroredChar = isRTL
                ? bidi$1.getMirroredCharacter(attributedString.string.charAt(index))
                : null;
            updatedString += mirroredChar || char;
        });
        const result = {
            ...attributedString,
            string: updatedString,
        };
        return result;
    };
};

/**
 * A LayoutEngine is the main object that performs text layout.
 * It accepts an AttributedString and a Container object
 * to layout text into, and uses several helper objects to perform
 * various layout tasks. These objects can be overridden to customize
 * layout behavior.
 */
const layoutEngine = (engines) => {
    return (attributedString, container, options = {}) => {
        const processParagraph = compose(resolveYOffset(), resolveAttachments(), verticalAlignment(), generateGlyphs(), wrapWords(engines, options), mirrorString(), preprocessRuns(engines));
        const processParagraphs = (paragraphs) => paragraphs.map(processParagraph);
        return compose(finalizeFragments(engines, options), bidiReordering(), typesetter(engines, options, container), processParagraphs, splitParagraphs(), applyDefaultStyles(), decomposeUnicode())(attributedString);
    };
};

const bidi = bidiFactory();
const bidiEngine = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string
     */
    return (attributedString) => {
        const { string } = attributedString;
        const direction = attributedString.runs[0]?.attributes.direction;
        const { levels } = bidi.getEmbeddingLevels(string, direction);
        let lastLevel = null;
        let lastIndex = 0;
        let index = 0;
        const runs = [];
        for (let i = 0; i < levels.length; i += 1) {
            const level = levels[i];
            if (level !== lastLevel) {
                if (lastLevel !== null) {
                    runs.push({
                        start: lastIndex,
                        end: index,
                        attributes: { bidiLevel: lastLevel },
                    });
                }
                lastIndex = index;
                lastLevel = level;
            }
            index += 1;
        }
        if (lastIndex < string.length) {
            runs.push({
                start: lastIndex,
                end: string.length,
                attributes: { bidiLevel: lastLevel },
            });
        }
        const result = { string, runs };
        return result;
    };
};

const INFINITY = 10000;
const skipPastGlueAndPenalty = (nodes, start) => {
    let j = start + 1;
    for (; j < nodes.length; j++) {
        if (nodes[j].type !== 'glue' && nodes[j].type !== 'penalty') {
            break;
        }
    }
    return nodes[j - 1];
};
const getNextBreakpoint = (subnodes, widths, lineNumber) => {
    let position = null;
    let minimumBadness = Infinity;
    const sum = { width: 0, stretch: 0, shrink: 0 };
    const lineLength = widths[Math.min(lineNumber, widths.length - 1)];
    const calculateRatio = (node) => {
        const stretch = 'stretch' in node ? node.stretch : null;
        if (sum.width < lineLength) {
            if (!stretch)
                return INFINITY;
            return sum.stretch - stretch > 0
                ? (lineLength - sum.width) / sum.stretch
                : INFINITY;
        }
        const shrink = 'shrink' in node ? node.shrink : null;
        if (sum.width > lineLength) {
            if (!shrink)
                return INFINITY;
            return sum.shrink - shrink > 0
                ? (lineLength - sum.width) / sum.shrink
                : INFINITY;
        }
        return 0;
    };
    let hyphenWidth = 0;
    for (let i = 0; i < subnodes.length; i += 1) {
        const node = subnodes[i];
        if (node.type === 'box') {
            sum.width += node.width;
        }
        if (node.type === 'glue') {
            sum.width += node.width;
            sum.stretch += node.stretch;
            sum.shrink += node.shrink;
        }
        const potentialEndOfLine = skipPastGlueAndPenalty(subnodes, i);
        hyphenWidth =
            potentialEndOfLine.type === 'penalty' ? potentialEndOfLine.width : 0;
        if (sum.width - sum.shrink + hyphenWidth > lineLength) {
            if (position === null) {
                let j = i === 0 ? i + 1 : i;
                while (j < subnodes.length &&
                    (subnodes[j].type === 'glue' || subnodes[j].type === 'penalty')) {
                    j++;
                }
                position = j - 1;
            }
            break;
        }
        if (node.type === 'penalty' || node.type === 'glue') {
            const ratio = calculateRatio(node);
            const penalty = node.type === 'penalty' ? node.penalty : 0;
            const badness = 100 * Math.abs(ratio) ** 3 + penalty;
            if (minimumBadness >= badness) {
                position = i;
                minimumBadness = badness;
            }
        }
    }
    return sum.width - sum.shrink + hyphenWidth > lineLength ? position : null;
};
const applyBestFit = (nodes, widths) => {
    let count = 0;
    let lineNumber = 0;
    let subnodes = nodes;
    const breakpoints = [0];
    while (subnodes.length > 0) {
        const breakpoint = getNextBreakpoint(subnodes, widths, lineNumber);
        if (breakpoint !== null) {
            count += breakpoint;
            breakpoints.push(count);
            subnodes = subnodes.slice(breakpoint + 1, subnodes.length);
            count++;
            lineNumber++;
        }
        else {
            subnodes = [];
        }
    }
    return breakpoints;
};

/* eslint-disable max-classes-per-file */
class LinkedListNode {
    data;
    prev;
    next;
    constructor(data) {
        this.data = data;
        this.prev = null;
        this.next = null;
    }
}
class LinkedList {
    static Node = LinkedListNode;
    head;
    tail;
    listSize;
    listLength;
    constructor() {
        this.head = null;
        this.tail = null;
        this.listSize = 0;
        this.listLength = 0;
    }
    isLinked(node) {
        return !((node &&
            node.prev === null &&
            node.next === null &&
            this.tail !== node &&
            this.head !== node) ||
            this.isEmpty());
    }
    size() {
        return this.listSize;
    }
    isEmpty() {
        return this.listSize === 0;
    }
    first() {
        return this.head;
    }
    last() {
        return this.last;
    }
    forEach(callback) {
        let node = this.head;
        while (node !== null) {
            callback(node);
            node = node.next;
        }
    }
    at(i) {
        let node = this.head;
        let index = 0;
        if (i >= this.listLength || i < 0) {
            return null;
        }
        while (node !== null) {
            if (i === index) {
                return node;
            }
            node = node.next;
            index += 1;
        }
        return null;
    }
    insertAfter(node, newNode) {
        if (!this.isLinked(node))
            return this;
        newNode.prev = node;
        newNode.next = node.next;
        if (node.next === null) {
            this.tail = newNode;
        }
        else {
            node.next.prev = newNode;
        }
        node.next = newNode;
        this.listSize += 1;
        return this;
    }
    insertBefore(node, newNode) {
        if (!this.isLinked(node))
            return this;
        newNode.prev = node.prev;
        newNode.next = node;
        if (node.prev === null) {
            this.head = newNode;
        }
        else {
            node.prev.next = newNode;
        }
        node.prev = newNode;
        this.listSize += 1;
        return this;
    }
    push(node) {
        if (this.head === null) {
            this.unshift(node);
        }
        else {
            this.insertAfter(this.tail, node);
        }
        return this;
    }
    unshift(node) {
        if (this.head === null) {
            this.head = node;
            this.tail = node;
            node.prev = null;
            node.next = null;
            this.listSize += 1;
        }
        else {
            this.insertBefore(this.head, node);
        }
        return this;
    }
    remove(node) {
        if (!this.isLinked(node))
            return this;
        if (node.prev === null) {
            this.head = node.next;
        }
        else {
            node.prev.next = node.next;
        }
        if (node.next === null) {
            this.tail = node.prev;
        }
        else {
            node.next.prev = node.prev;
        }
        this.listSize -= 1;
        return this;
    }
}

/**
 * Licensed under the new BSD License.
 * Copyright 2009-2010, Bram Stein
 * All rights reserved.
 */
function breakpoint(position, demerits, line, fitnessClass, totals, previous) {
    return {
        position,
        demerits,
        line,
        fitnessClass,
        totals: totals || {
            width: 0,
            stretch: 0,
            shrink: 0,
        },
        previous,
    };
}
function computeCost(nodes, lineLengths, sum, end, active, currentLine) {
    let width = sum.width - active.totals.width;
    let stretch = 0;
    let shrink = 0;
    // If the current line index is within the list of linelengths, use it, otherwise use
    // the last line length of the list.
    const lineLength = currentLine < lineLengths.length
        ? lineLengths[currentLine - 1]
        : lineLengths[lineLengths.length - 1];
    if (nodes[end].type === 'penalty') {
        width += nodes[end].width;
    }
    // Calculate the stretch ratio
    if (width < lineLength) {
        stretch = sum.stretch - active.totals.stretch;
        if (stretch > 0) {
            return (lineLength - width) / stretch;
        }
        return linebreak.infinity;
    }
    // Calculate the shrink ratio
    if (width > lineLength) {
        shrink = sum.shrink - active.totals.shrink;
        if (shrink > 0) {
            return (lineLength - width) / shrink;
        }
        return linebreak.infinity;
    }
    // perfect match
    return 0;
}
// Add width, stretch and shrink values from the current
// break point up to the next box or forced penalty.
function computeSum(nodes, sum, breakPointIndex) {
    const result = {
        width: sum.width,
        stretch: sum.stretch,
        shrink: sum.shrink,
    };
    for (let i = breakPointIndex; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (node.type === 'glue') {
            result.width += node.width;
            result.stretch += node.stretch;
            result.shrink += node.shrink;
        }
        else if (node.type === 'box' ||
            (node.type === 'penalty' &&
                node.penalty === -linebreak.infinity &&
                i > breakPointIndex)) {
            break;
        }
    }
    return result;
}
function findBestBreakpoints(activeNodes) {
    const breakpoints = [];
    if (activeNodes.size() === 0)
        return [];
    let tmp = { data: { demerits: Infinity } };
    // Find the best active node (the one with the least total demerits.)
    activeNodes.forEach((node) => {
        if (node.data.demerits < tmp.data.demerits) {
            tmp = node;
        }
    });
    while (tmp !== null) {
        breakpoints.push(tmp.data.position);
        tmp = tmp.data.previous;
    }
    return breakpoints.reverse();
}
/**
 * @param nodes
 * @param availableWidths
 * @param tolerance
 * @preserve Knuth and Plass line breaking algorithm in JavaScript
 */
const linebreak = (nodes, availableWidths, tolerance) => {
    // Demerits are used as a way to penalize bad line breaks
    //  - line: applied to each line, depending on how much spaces need to stretch or shrink
    //  - flagged: applied when consecutive lines end in hyphenation
    //  - fitness: algorithm groups lines into fitness classes based on how loose or tight the spacing is.
    //             if a paragraph has consecutive lines from different fitness classes,
    //             a fitness demerit is applied to maintain visual consistency.
    const options = {
        demerits: { line: 10, flagged: 100, fitness: 3000 },
        tolerance: tolerance || 3,
    };
    const activeNodes = new LinkedList();
    const sum = { width: 0, stretch: 0, shrink: 0 };
    const lineLengths = availableWidths;
    // Add an active node for the start of the paragraph.
    activeNodes.push(new LinkedList.Node(breakpoint(0, 0, 0, 0, undefined, null)));
    // Candidates for each fitness class, reset per active-node group. Reused
    // across iterations to avoid allocating in the algorithm's hottest loop.
    const candidates = [
        { active: undefined, demerits: Infinity },
        { active: undefined, demerits: Infinity },
        { active: undefined, demerits: Infinity },
        { active: undefined, demerits: Infinity },
    ];
    // The main loop of the algorithm
    function mainLoop(node, index, nodes) {
        let active = activeNodes.first();
        // The inner loop iterates through all the active nodes with line < currentLine and then
        // breaks out to insert the new active node candidates before looking at the next active
        // nodes for the next lines. The result of this is that the active node list is always
        // sorted by line number.
        while (active !== null) {
            let currentLine = 0;
            for (let i = 0; i < candidates.length; i += 1) {
                candidates[i].active = undefined;
                candidates[i].demerits = Infinity;
            }
            // Iterate through the linked list of active nodes to find new potential active nodes and deactivate current active nodes.
            while (active !== null) {
                currentLine = active.data.line + 1;
                const ratio = computeCost(nodes, lineLengths, sum, index, active.data, currentLine);
                // Deactive nodes when the distance between the current active node and the
                // current node becomes too large (i.e. it exceeds the stretch limit and the stretch
                // ratio becomes negative) or when the current node is a forced break (i.e. the end
                // of the paragraph when we want to remove all active nodes, but possibly have a final
                // candidate active node---if the paragraph can be set using the given tolerance value.)
                if (ratio < -1 ||
                    (node.type === 'penalty' && node.penalty === -linebreak.infinity)) {
                    activeNodes.remove(active);
                }
                // If the ratio is within the valid range of -1 <= ratio <= tolerance calculate the
                // total demerits and record a candidate active node.
                if (ratio >= -1 && ratio <= options.tolerance) {
                    const absRatio = Math.abs(ratio);
                    const badness = 100 * absRatio * absRatio * absRatio;
                    const lineDemerits = options.demerits.line + badness;
                    let demerits = lineDemerits * lineDemerits;
                    // Positive penalty
                    if (node.type === 'penalty' && node.penalty >= 0) {
                        demerits += node.penalty * node.penalty;
                        // Negative penalty but not a forced break
                    }
                    else if (node.type === 'penalty' &&
                        node.penalty !== -linebreak.infinity) {
                        demerits -= node.penalty * node.penalty;
                    }
                    if (node.type === 'penalty' &&
                        nodes[active.data.position].type === 'penalty') {
                        demerits +=
                            options.demerits.flagged *
                                node.flagged *
                                // @ts-expect-error node is penalty here
                                nodes[active.data.position].flagged;
                    }
                    // Calculate the fitness class for this candidate active node.
                    let currentClass;
                    if (ratio < -0.5) {
                        currentClass = 0;
                    }
                    else if (ratio <= 0.5) {
                        currentClass = 1;
                    }
                    else if (ratio <= 1) {
                        currentClass = 2;
                    }
                    else {
                        currentClass = 3;
                    }
                    // Add a fitness penalty to the demerits if the fitness classes of two adjacent lines differ too much.
                    if (Math.abs(currentClass - active.data.fitnessClass) > 1) {
                        demerits += options.demerits.fitness;
                    }
                    // Add the total demerits of the active node to get the total demerits of this candidate node.
                    demerits += active.data.demerits;
                    // Only store the best candidate for each fitness class
                    if (demerits < candidates[currentClass].demerits) {
                        candidates[currentClass].active = active;
                        candidates[currentClass].demerits = demerits;
                    }
                }
                active = active.next;
                // Stop iterating through active nodes to insert new candidate active nodes in the active list
                // before moving on to the active nodes for the next line.
                // Line numbers are equivalent once the last distinct line length is reached.
                // Grouping them allows dominated candidates to be discarded together.
                if (active !== null &&
                    active.data.line >= currentLine &&
                    currentLine < lineLengths.length) {
                    break;
                }
            }
            const tmpSum = computeSum(nodes, sum, index);
            for (let fitnessClass = 0; fitnessClass < candidates.length; fitnessClass += 1) {
                const candidate = candidates[fitnessClass];
                if (candidate.demerits === Infinity)
                    continue;
                const newNode = new LinkedList.Node(breakpoint(index, candidate.demerits, candidate.active.data.line + 1, fitnessClass, tmpSum, candidate.active));
                if (active !== null) {
                    activeNodes.insertBefore(active, newNode);
                }
                else {
                    activeNodes.push(newNode);
                }
            }
        }
    }
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.type === 'box') {
            sum.width += node.width;
        }
        else if (node.type === 'glue') {
            const precedesBox = index > 0 && nodes[index - 1].type === 'box';
            if (precedesBox)
                mainLoop(node, index, nodes);
            sum.width += node.width;
            sum.stretch += node.stretch;
            sum.shrink += node.shrink;
        }
        else if (node.type === 'penalty' && node.penalty !== linebreak.infinity) {
            mainLoop(node, index, nodes);
        }
    }
    return findBestBreakpoints(activeNodes);
};
linebreak.infinity = 10000;
linebreak.glue = (width, start, end, stretch, shrink) => ({
    type: 'glue',
    start,
    end,
    width,
    stretch,
    shrink,
});
linebreak.box = (width, start, end, hyphenated = false) => ({
    type: 'box',
    width,
    start,
    end,
    hyphenated,
});
linebreak.penalty = (width, penalty, flagged) => ({
    type: 'penalty',
    width,
    penalty,
    flagged,
});

/**
 * Add scalar to run
 *
 * @param index - Scalar
 * @param run - Run
 * @returns Added run
 */
const add = (index, run) => {
    const start = run.start + index;
    const end = run.end + index;
    return Object.assign({}, run, { start, end });
};

/**
 * Get run length
 *
 * @param run - Run
 * @returns Length
 */
const length = (run) => {
    return run.end - run.start;
};

const concatStringIndices = (runA, runB) => {
    const runAIndices = runA.stringIndices || [];
    const runALastIndex = last(runAIndices) || 0;
    const runBIndices = (runB.stringIndices || []).map((i) => i + runALastIndex + 1);
    return normalize(runAIndices.concat(runBIndices));
};
const concatGlyphIndices = (runA, runB) => {
    const runAIndices = runA.glyphIndices || [];
    const runALength = runA.stringIndices?.length || 0;
    const runBIndices = (runB.glyphIndices || []).map((i) => i + runALength);
    return normalize(runAIndices.concat(runBIndices));
};
/**
 * Concats two runs into one
 *
 * @param runA - First run
 * @param runB - Second run
 * @returns Concatenated run
 */
const concat = (runA, runB) => {
    const end = runA.end + length(runB);
    const glyphs = (runA.glyphs || []).concat(runB.glyphs || []);
    const positions = (runA.positions || []).concat(runB.positions || []);
    const attributes = Object.assign({}, runA.attributes, runB.attributes);
    const stringIndices = concatStringIndices(runA, runB);
    const glyphIndices = concatGlyphIndices(runA, runB);
    return Object.assign({}, runA, {
        end,
        glyphs,
        positions,
        attributes,
        stringIndices,
        glyphIndices,
    });
};

/**
 * Insert glyph to run in the given index
 *
 * @param index - Index
 * @param glyph - Glyph
 * @param run - Run
 * @returns Run with glyph
 */
const insertGlyph$1 = (index, glyph, run) => {
    if (!glyph)
        return run;
    // Split resolves ligature splitting in case new glyph breaks some
    const leadingRun = slice$1(0, index, run);
    const trailingRun = slice$1(index, Infinity, run);
    return concat(append$1(glyph, leadingRun), trailingRun);
};
/**
 * Insert either glyph or code point to run in the given index
 *
 * @param index - Index
 * @param value - Glyph or codePoint
 * @param run - Run
 * @returns Run with glyph
 */
const insert = (index, value, run) => {
    const font = getFont(run);
    const glyph = isNumber(value) ? fromCodePoint(value, font) : value;
    return insertGlyph$1(index, glyph, run);
};

/**
 * Get run index at char index
 *
 * @param index - Char index
 * @param attributedString - Attributed string
 * @returns Run index
 */
const runIndexAt = (index, attributedString) => {
    return runIndexAt$1(index, attributedString.runs);
};

/**
 * Insert glyph into attributed string
 *
 * @param index - Index
 * @param glyph - Glyph or code point
 * @param attributedString - Attributed string
 * @returns Attributed string with new glyph
 */
const insertGlyph = (index, glyph, attributedString) => {
    const runIndex = runIndexAt(index, attributedString);
    // Add glyph to the end if run index invalid
    if (runIndex === -1)
        return append(glyph, attributedString);
    const codePoints = [glyph] ;
    const string = attributedString.string.slice(0, index) +
        stringFromCodePoints(codePoints) +
        attributedString.string.slice(index);
    const runs = attributedString.runs.map((run, i) => {
        if (i === runIndex)
            return insert(index - run.start, glyph, run);
        if (i > runIndex)
            return add(codePoints.length, run);
        return run;
    });
    return Object.assign({}, attributedString, { string, runs });
};

/**
 * Advance width between two string indices
 *
 * @param start - Glyph index
 * @param end - Glyph index
 * @param run - Run
 * @returns Advanced width run
 */
const advanceWidthBetween$1 = (start, end, run) => {
    const runStart = run.start || 0;
    const glyphStartIndex = Math.max(0, glyphIndexAt(start - runStart, run));
    const glyphEndIndex = Math.max(0, glyphIndexAt(end - runStart, run));
    const positions = (run.positions || []).slice(glyphStartIndex, glyphEndIndex);
    return advanceWidth$2(positions);
};

/**
 * Advance width between start and end
 * Does not consider ligature splitting for the moment.
 * Check performance impact on supporting this
 *
 * @param start - Start offset
 * @param end - End offset
 * @param attributedString
 * @returns Advance width
 */
const advanceWidthBetween = (start, end, attributedString) => {
    const runs = filter(start, end, attributedString.runs);
    return runs.reduce((acc, run) => acc + advanceWidthBetween$1(start, end, run), 0);
};

const HYPHEN = 0x002d;
const TOLERANCE_STEPS = 5;
const TOLERANCE_LIMIT = 50;
const opts = {
    width: 3,
    stretch: 6,
    shrink: 9,
};
/**
 * Slice attributed string to many lines
 *
 * @param attributedString - Attributed string
 * @param nodes
 * @param breaks
 * @returns Attributed strings
 */
const breakLines = (attributedString, nodes, breaks) => {
    let start = 0;
    let end = null;
    const lines = [];
    for (const breakPoint of breaks) {
        const node = nodes[breakPoint];
        const prevNode = nodes[breakPoint - 1];
        // Last breakpoint corresponds to K&P mandatory final glue
        if (breakPoint === nodes.length - 1)
            continue;
        let line;
        if (node.type === 'penalty') {
            // @ts-expect-error penalty node will always preceed box or glue node
            end = prevNode.end;
            line = slice(start, end, attributedString);
            line = insertGlyph(line.string.length, HYPHEN, line);
        }
        else {
            end = node.end;
            line = slice(start, end, attributedString);
        }
        start = end;
        lines.push(line);
    }
    lines.push(slice(start, attributedString.string.length, attributedString));
    return lines;
};
/**
 * Return Knuth & Plass nodes based on line and previously calculated syllables
 *
 * @param attributedString - Attributed string
 * @param attributes - Attributes
 * @param options - Layout options
 * @returns ?
 */
const getNodes = (attributedString, { align }, options) => {
    let start = 0;
    const hyphenWidth = 5;
    const { syllables } = attributedString;
    const hyphenPenalty = options.hyphenationPenalty || (align === 'justify' ? 100 : 600);
    const result = syllables.reduce((acc, s, index) => {
        const width = advanceWidthBetween(start, start + s.length, attributedString);
        if (s.trim() === '') {
            const stretch = (width * opts.width) / opts.stretch;
            const shrink = (width * opts.width) / opts.shrink;
            const end = start + s.length;
            // Add glue node. Glue nodes are used to fill the space between words.
            acc.push(linebreak.glue(width, start, end, stretch, shrink));
        }
        else {
            const hyphenated = syllables[index + 1] !== ' ';
            const end = start + s.length;
            // Add box node. Box nodes are used to represent words.
            acc.push(linebreak.box(width, start, end, hyphenated));
            if (syllables[index + 1] && hyphenated) {
                // Add penalty node. Penalty nodes are used to represent hyphenation points.
                acc.push(linebreak.penalty(hyphenWidth, hyphenPenalty, 1));
            }
        }
        start += s.length;
        return acc;
    }, []);
    // Add mandatory final glue
    result.push(linebreak.glue(0, start, start, linebreak.infinity, 0));
    result.push(linebreak.penalty(0, -linebreak.infinity, 1));
    return result;
};
/**
 * @param attributedString - Attributed string
 * @returns Attributes
 */
const getAttributes = (attributedString) => {
    return attributedString.runs?.[0]?.attributes || {};
};
/**
 * Performs Knuth & Plass line breaking algorithm
 * Fallbacks to best fit algorithm if latter not successful
 *
 * @param options - Layout options
 */
const linebreaker = (options) => {
    /**
     * @param attributedString - Attributed string
     * @param availableWidths - Available widths
     * @returns Attributed string
     */
    return (attributedString, availableWidths) => {
        let tolerance = options.tolerance || 4;
        const attributes = getAttributes(attributedString);
        const nodes = getNodes(attributedString, attributes, options);
        let breaks = linebreak(nodes, availableWidths, tolerance);
        // Try again with a higher tolerance if the line breaking failed.
        while (breaks.length === 0 && tolerance < TOLERANCE_LIMIT) {
            tolerance += TOLERANCE_STEPS;
            breaks = linebreak(nodes, availableWidths, tolerance);
        }
        if (breaks.length === 0 || (breaks.length === 1 && breaks[0] === 0)) {
            breaks = applyBestFit(nodes, availableWidths);
        }
        return breakLines(attributedString, nodes, breaks.slice(1));
    };
};

var Direction;
(function (Direction) {
    Direction[Direction["GROW"] = 0] = "GROW";
    Direction[Direction["SHRINK"] = 1] = "SHRINK";
})(Direction || (Direction = {}));
const WHITESPACE_PRIORITY = 1;
const LETTER_PRIORITY = 2;
const EXPAND_WHITESPACE_FACTOR = {
    before: 0.5,
    after: 0.5,
    priority: WHITESPACE_PRIORITY,
    unconstrained: false,
};
const EXPAND_CHAR_FACTOR = {
    before: 0.14453125, // 37/256
    after: 0.14453125,
    priority: LETTER_PRIORITY,
    unconstrained: false,
};
const SHRINK_WHITESPACE_FACTOR = {
    before: -0.04296875, // -11/256
    after: -0.04296875,
    priority: WHITESPACE_PRIORITY,
    unconstrained: false,
};
const SHRINK_CHAR_FACTOR = {
    before: -0.04296875,
    after: -0.04296875,
    priority: LETTER_PRIORITY,
    unconstrained: false,
};
const getCharFactor = (direction, options) => {
    const expandCharFactor = options.expandCharFactor || {};
    const shrinkCharFactor = options.shrinkCharFactor || {};
    return direction === Direction.GROW
        ? Object.assign({}, EXPAND_CHAR_FACTOR, expandCharFactor)
        : Object.assign({}, SHRINK_CHAR_FACTOR, shrinkCharFactor);
};
const getWhitespaceFactor = (direction, options) => {
    const expandWhitespaceFactor = options.expandWhitespaceFactor || {};
    const shrinkWhitespaceFactor = options.shrinkWhitespaceFactor || {};
    return direction === Direction.GROW
        ? Object.assign({}, EXPAND_WHITESPACE_FACTOR, expandWhitespaceFactor)
        : Object.assign({}, SHRINK_WHITESPACE_FACTOR, shrinkWhitespaceFactor);
};
const cloneFactor = (f) => ({
    before: f.before,
    after: f.after,
    priority: f.priority,
    unconstrained: f.unconstrained,
});
const factor = (direction, options) => (glyphs) => {
    const charFactor = getCharFactor(direction, options);
    const whitespaceFactor = getWhitespaceFactor(direction, options);
    const factors = [];
    for (let index = 0; index < glyphs.length; index += 1) {
        let f;
        const glyph = glyphs[index];
        if (isWhiteSpace$1(glyph)) {
            f = cloneFactor(whitespaceFactor);
            if (index === glyphs.length - 1) {
                f.before = 0;
                if (index > 0) {
                    factors[index - 1].after = 0;
                }
            }
        }
        else if (glyph.isMark && index > 0) {
            f = cloneFactor(factors[index - 1]);
            f.before = 0;
            factors[index - 1].after = 0;
        }
        else {
            f = cloneFactor(charFactor);
        }
        factors.push(f);
    }
    return factors;
};
const getFactors = (gap, line, options) => {
    const direction = gap > 0 ? Direction.GROW : Direction.SHRINK;
    const getFactor = factor(direction, options);
    const factors = line.runs.reduce((acc, run) => {
        return acc.concat(getFactor(run.glyphs));
    }, []);
    factors[0].before = 0;
    factors[factors.length - 1].after = 0;
    return factors;
};

const KASHIDA_PRIORITY = 0;
const NULL_PRIORITY = 3;
const getDistances = (gap, factors) => {
    let total = 0;
    const priorities = [];
    const unconstrained = [];
    for (let priority = KASHIDA_PRIORITY; priority <= NULL_PRIORITY; priority += 1) {
        priorities[priority] = unconstrained[priority] = 0;
    }
    // sum the factors at each priority
    for (let j = 0; j < factors.length; j += 1) {
        const f = factors[j];
        const sum = f.before + f.after;
        total += sum;
        priorities[f.priority] += sum;
        if (f.unconstrained) {
            unconstrained[f.priority] += sum;
        }
    }
    // choose the priorities that need to be applied
    let highestPriority = -1;
    let highestPrioritySum = 0;
    let remainingGap = gap;
    let priority;
    for (priority = KASHIDA_PRIORITY; priority <= NULL_PRIORITY; priority += 1) {
        const prioritySum = priorities[priority];
        if (prioritySum !== 0) {
            if (highestPriority === -1) {
                highestPriority = priority;
                highestPrioritySum = prioritySum;
            }
            // if this priority covers the remaining gap, we're done
            if (Math.abs(remainingGap) <= Math.abs(prioritySum)) {
                priorities[priority] = remainingGap / prioritySum;
                unconstrained[priority] = 0;
                remainingGap = 0;
                break;
            }
            // mark that we need to use 100% of the adjustment from
            // this priority, and subtract the space that it consumes
            priorities[priority] = 1;
            remainingGap -= prioritySum;
            // if this priority has unconstrained glyphs, let them consume the remaining space
            if (unconstrained[priority] !== 0) {
                unconstrained[priority] = remainingGap / unconstrained[priority];
                remainingGap = 0;
                break;
            }
        }
    }
    // zero out remaining priorities (if any)
    for (let p = priority + 1; p <= NULL_PRIORITY; p += 1) {
        priorities[p] = 0;
        unconstrained[p] = 0;
    }
    // if there is still space left over, assign it to the highest priority that we saw.
    // this violates their factors, but it only happens in extreme cases
    if (remainingGap > 0 && highestPriority > -1) {
        priorities[highestPriority] =
            (highestPrioritySum + (gap - total)) / highestPrioritySum;
    }
    // create and return an array of distances to add to each glyph's advance
    const distances = [];
    for (let index = 0; index < factors.length; index += 1) {
        // the distance to add to this glyph is the sum of the space to add
        // after this glyph, and the space to add before the next glyph
        const f = factors[index];
        const next = factors[index + 1];
        let dist = f.after * priorities[f.priority];
        if (next) {
            dist += next.before * priorities[next.priority];
        }
        // if this glyph is unconstrained, add the unconstrained distance as well
        if (f.unconstrained) {
            dist += f.after * unconstrained[f.priority];
            if (next) {
                dist += next.before * unconstrained[next.priority];
            }
        }
        distances.push(dist);
    }
    return distances;
};

/**
 * Adjust run positions by given distances
 *
 * @param distances
 * @param line
 * @returns Line
 */
const justifyLine = (distances, line) => {
    let index = 0;
    for (const run of line.runs) {
        for (const position of run.positions) {
            position.xAdvance += distances[index++];
        }
    }
    return line;
};
/**
 * A JustificationEngine is used by a Typesetter to perform line fragment
 * justification. This implementation is based on a description of Apple's
 * justification algorithm from a PDF in the Apple Font Tools package.
 *
 * @param options - Layout options
 */
const justification = (options) => {
    /**
     * @param line
     * @returns Line
     */
    return (line) => {
        const gap = line.box.width - advanceWidth(line);
        if (gap === 0)
            return line; // Exact fit
        const factors = getFactors(gap, line, options);
        const distances = getDistances(gap, factors);
        return justifyLine(distances, line);
    };
};

/**
 * Returns attributed string ascent
 *
 * @param attributedString - Attributed string
 * @returns Ascent
 */
const ascent = (attributedString) => {
    const reducer = (acc, run) => Math.max(acc, ascent$1(run));
    return attributedString.runs.reduce(reducer, 0);
};

// The base font size used for calculating underline thickness.
const BASE_FONT_SIZE = 12;
/**
 * A TextDecorationEngine is used by a Typesetter to generate
 * DecorationLines for a line fragment, including underlines
 * and strikes.
 */
const textDecoration = () => (line) => {
    let x = line.overflowLeft || 0;
    const overflowRight = line.overflowRight || 0;
    const maxX = advanceWidth(line) - overflowRight;
    line.decorationLines = [];
    for (let i = 0; i < line.runs.length; i += 1) {
        const run = line.runs[i];
        const width = Math.min(maxX - x, advanceWidth$1(run));
        const thickness = Math.max(0.5, Math.floor(run.attributes.fontSize / BASE_FONT_SIZE));
        if (run.attributes.underline) {
            const rect = {
                x,
                y: ascent(line) + thickness * 2,
                width,
                height: thickness,
            };
            const decorationLine = {
                rect,
                opacity: run.attributes.opacity,
                color: run.attributes.underlineColor || 'black',
                style: run.attributes.underlineStyle || 'solid',
            };
            line.decorationLines.push(decorationLine);
        }
        if (run.attributes.strike) {
            const y = ascent(line) - ascent$1(run) / 3;
            const rect = { x, y, width, height: thickness };
            const decorationLine = {
                rect,
                opacity: run.attributes.opacity,
                color: run.attributes.strikeColor || 'black',
                style: run.attributes.strikeStyle || 'solid',
            };
            line.decorationLines.push(decorationLine);
        }
        x += width;
    }
    return line;
};

const ignoredScripts = ['Common', 'Inherited', 'Unknown'];
/**
 * Resolves unicode script in runs, grouping equal runs together
 */
const scriptItemizer = () => {
    /**
     * @param attributedString - Attributed string
     * @returns Attributed string
     */
    return (attributedString) => {
        const { string } = attributedString;
        let lastScript = 'Unknown';
        let lastIndex = 0;
        let index = 0;
        const runs = [];
        if (!string)
            return empty();
        for (let i = 0; i < string.length; i += 1) {
            const char = string[i];
            const codePoint = char.codePointAt(0);
            const script = unicode.getScript(codePoint);
            if (script !== lastScript && !ignoredScripts.includes(script)) {
                if (lastScript !== 'Unknown') {
                    runs.push({
                        start: lastIndex,
                        end: index,
                        attributes: { script: lastScript },
                    });
                }
                lastIndex = index;
                lastScript = script;
            }
            index += char.length;
        }
        if (lastIndex < string.length) {
            runs.push({
                start: lastIndex,
                end: string.length,
                attributes: { script: lastScript },
            });
        }
        const result = { string, runs: runs };
        return result;
    };
};

const SOFT_HYPHEN = '­';
const wordHyphenation = () => {
    /**
     * @param word - Word
     * @returns Word parts
     */
    return (word) => {
        if (isNil(word))
            return [];
        // Soft hyphens already in the word are the author's call, so they replace
        // the pattern set rather than adding to it.
        if (word.includes(SOFT_HYPHEN))
            return word.split(SOFT_HYPHEN);
        return syllables(word);
    };
};

const IGNORED_CODE_POINTS = [173]; // U+00AD Soft Hyphen
const getFontSize = (run) => run.attributes.fontSize || 12;
const pickFontFromFontStack = (codePoint, fontStack, lastFont) => {
    if (IGNORED_CODE_POINTS.includes(codePoint))
        return lastFont;
    const fontStackWithFallback = [...fontStack, lastFont];
    for (let i = 0; i < fontStackWithFallback.length; i += 1) {
        const font = fontStackWithFallback[i];
        if (font &&
            font.hasGlyphForCodePoint &&
            font.hasGlyphForCodePoint(codePoint)) {
            return font;
        }
    }
    return fontStack.at(-1);
};
const fontSubstitution = () => ({ string, runs }) => {
    let lastFont = null;
    let lastFontSize = null;
    let lastIndex = 0;
    let index = 0;
    const res = [];
    for (let i = 0; i < runs.length; i += 1) {
        const run = runs[i];
        if (string.length === 0) {
            res.push({
                start: 0,
                end: 0,
                attributes: { font: run.attributes.font },
            });
            break;
        }
        const chars = string.slice(run.start, run.end);
        // Iterate by code point so that surrogate pairs (e.g. SIP characters
        // U+10000 and above) are looked up as a single code point in the font
        // stack, not as separate high/low surrogates.
        let j = 0;
        while (j < chars.length) {
            const codePoint = chars.codePointAt(j);
            const charLength = codePoint > 0xffff ? 2 : 1;
            // If the default font does not have a glyph and the fallback font does, we use it
            const font = pickFontFromFontStack(codePoint, run.attributes.font, lastFont);
            const fontSize = getFontSize(run);
            // If anything that would impact res has changed, update it
            if (font !== lastFont ||
                fontSize !== lastFontSize ||
                font.unitsPerEm !== lastFont?.unitsPerEm) {
                if (lastFont) {
                    res.push({
                        start: lastIndex,
                        end: index,
                        attributes: {
                            font: [lastFont],
                            scale: lastFontSize / lastFont.unitsPerEm,
                        },
                    });
                }
                lastFont = font;
                lastFontSize = fontSize;
                lastIndex = index;
            }
            j += charLength;
            index += charLength;
        }
    }
    if (lastIndex < string.length) {
        const fontSize = getFontSize(last(runs));
        res.push({
            start: lastIndex,
            end: string.length,
            attributes: {
                font: [lastFont],
                scale: fontSize / lastFont.unitsPerEm,
            },
        });
    }
    return { string, runs: res };
};

export { bidiEngine as bidi, layoutEngine as default, fontSubstitution, fromFragments, justification, linebreaker, scriptItemizer, textDecoration, wordHyphenation };
