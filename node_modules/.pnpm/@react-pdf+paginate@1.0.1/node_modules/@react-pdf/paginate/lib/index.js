const isLazy$1 = (item) => item.kind === 'lazy';

const isColumn = (item) => item.kind === 'column';

const isRow = (item) => item.kind === 'row';

const isPenalty = (item) => item.kind === 'penalty';

// Measures the children still to place (fragment.children), not the
// original item's — a continuation is shorter than the item it came from.
const height = (fragment) => {
    const { item } = fragment;
    if (isPenalty(item) || isLazy$1(item))
        return 0;
    if (isRow(item)) {
        return fragment.children.reduce((acc, child) => Math.max(acc, height(child)), 0);
    }
    if (isColumn(item)) {
        return fragment.children.reduce((acc, child) => acc + height(child), 0);
    }
    return item.height;
};

const isForbidPenalty = (item) => isPenalty(item) && item.type === 'forbid';

const CONTINUE = () => ({ kind: 'continue' });
const REWIND = () => ({ kind: 'rewind' });
const DECLINE = () => ({ kind: 'decline' });
const DONE = (result) => ({
    kind: 'done',
    result,
});

// How far down a set of placements reached. Not the same as the state's
// usedHeight, which still counts items a rewind took back off the page.
const reach = (placed) => placed.reduce((acc, item) => Math.max(acc, item.y + item.height), 0);

const toFragments = (items) => items.map((item) => ({
    item,
    isFirst: true,
    children: isRow(item) || isColumn(item) ? toFragments(item.children) : [],
}));

const isRepeat = (item) => 'repeat' in item && item.repeat === true;

const fullyPlaced = (placed, item) => placed.some((p) => p.item === item && p.part.isLast);
// Fresh copies of the repeat children that fully placed on this page, to
// head the continuation. Mid-split and unplaced items carry over on their
// own; materialized ones re-emit their source lazy for the next page.
const repeatFragments = (fragment, inner, contentAbove) => {
    // A fill that placed only repeats, with nothing but repeats above it,
    // would recur identically forever — stop repeating so content can advance.
    // Below real content the page was just nearly full; keep repeating.
    const isRepeatPlacement = (p) => isRepeat(p.item) ||
        fragment.children.some((f) => f.origin !== undefined && f.item === p.item);
    if (!contentAbove &&
        inner.placed.length > 0 &&
        inner.placed.every(isRepeatPlacement))
        return [];
    const sources = [];
    for (const child of fragment.children) {
        if (child.origin !== undefined) {
            const { origin } = child;
            if (sources.includes(origin))
                continue;
            const output = fragment.children.filter((f) => f.origin === origin);
            if (output.every((f) => fullyPlaced(inner.placed, f.item)))
                sources.push(origin);
            continue;
        }
        if (isRepeat(child.item) && fullyPlaced(inner.placed, child.item)) {
            sources.push(child.item);
        }
    }
    return toFragments(sources);
};

// A placement that pins nothing but repeats to the page: the repeat itself,
// or a container part whose entire placed content is repeats.
const isRepeatPlaced = (placed) => isRepeat(placed.item) ||
    (!!placed.children?.length && placed.children.every(isRepeatPlaced));

// Has non-repeat content been placed above this point on the page?
// Materialized items match via their origin, where the repeat flag lives.
const hasContentAbove = (state) => {
    const fromRepeatLazy = (placed) => state.fragments.some((f) => f.origin !== undefined && isRepeat(f.origin) && f.item === placed.item);
    return (state.contentAbove ||
        state.placed.some((p) => !isRepeatPlaced(p) && !fromRepeatLazy(p)));
};

// Fill the column's children into the space left on the page. Declines when
// nothing places, so the column moves whole to the next page.
const fit$3 = (state, fragment, index) => {
    const { isFirst } = fragment;
    const item = fragment.item;
    const availableHeight = state.height - state.usedHeight;
    if (availableHeight <= 0)
        return DECLINE();
    // Children may only force-place if this column is the first thing on the
    // page; anywhere else, moving to the next page is still an option.
    const canForce = state.canForce && state.placed.length === 0;
    const contentAbove = hasContentAbove(state);
    const inner = fill(fragment.children, availableHeight, state.pageNumber, canForce, contentAbove);
    const broke = inner.remaining.length > 0;
    if (broke && inner.placed.length === 0) {
        // Nothing placed. If every child remains, the column doesn't fit here — decline.
        if (inner.remaining.length === fragment.children.length)
            return DECLINE();
        // Fewer remaining means a forced break fired before anything
        // placed: end the page, keeping isFirst for the continuation.
        const remaining = [
            { item, isFirst, children: inner.remaining },
            ...state.fragments.slice(index + 1),
        ];
        return DONE({ placed: state.placed, remaining });
    }
    state.placed.push({
        item,
        y: state.usedHeight,
        height: broke ? availableHeight : reach(inner.placed),
        part: { isFirst, isLast: !broke },
        children: inner.placed,
    });
    if (!broke)
        return CONTINUE();
    const repeats = repeatFragments(fragment, inner, contentAbove);
    const continuation = {
        item,
        isFirst: false,
        children: [...repeats, ...inner.remaining],
    };
    return DONE({
        placed: state.placed,
        remaining: [continuation, ...state.fragments.slice(index + 1)],
    });
};

const fit$2 = (state, fragment) => {
    const item = fragment.item;
    if (state.usedHeight + item.height > state.height)
        return DECLINE();
    state.placed.push({
        item,
        y: state.usedHeight,
        height: item.height,
        part: { isFirst: fragment.isFirst, isLast: true },
    });
    return CONTINUE();
};

// Spacers behave exactly like leaves everywhere in the engine; the separate
// kind only exists so consumers can tell spacing apart from content.
const isLeaf = (item) => item.kind === 'leaf' || item.kind === 'spacer';

// Place every row child side by side at y=0. A break is one horizontal cut
// through all children at `height`: each keeps what fits above the line, and
// only children with leftovers reappear in the continuation. Returns null
// when a child can't fit or break — the whole row moves together.
const place = (rowFragment, height$1, pageNumber, canForce = false, contentAbove = false) => {
    const placed = [];
    const remaining = [];
    for (const childFragment of rowFragment.children) {
        const child = childFragment.item;
        const { isFirst } = childFragment;
        if (isRow(child) || isColumn(child)) {
            const inner = fill(childFragment.children, height$1, pageNumber, canForce, contentAbove);
            const broke = inner.remaining.length > 0;
            // Children sit side by side, so one contributing nothing can't be
            // fixed by breaking — the whole row has to move.
            if (broke && inner.placed.length === 0)
                return null;
            placed.push({
                item: child,
                y: 0,
                height: broke ? height$1 : reach(inner.placed),
                part: { isFirst, isLast: !broke },
                children: inner.placed,
            });
            if (broke) {
                const repeats = repeatFragments(childFragment, inner, contentAbove);
                remaining.push({
                    item: child,
                    isFirst: false,
                    children: [...repeats, ...inner.remaining],
                });
            }
            continue;
        }
        // A leaf taller than the cut line must split exactly there; declining
        // would leave this child behind while its siblings move on.
        if (isLeaf(child) && child.height > height$1) {
            const split = child.split?.(height$1) ?? null;
            if (split === null)
                return null;
            placed.push({
                item: split.current,
                y: 0,
                height: height$1,
                part: { isFirst, isLast: false },
            });
            remaining.push({ item: split.next, isFirst: false, children: [] });
            continue;
        }
        placed.push({
            item: child,
            y: 0,
            height: height({ item: child, children: [] }),
            part: { isFirst, isLast: true },
        });
    }
    return { placed, remaining };
};
// Place the row's children into the space left on the page. Declines when
// any child can't fit or break, so the row moves whole to the next page.
const fit$1 = (state, fragment, index) => {
    const { isFirst } = fragment;
    const item = fragment.item;
    const availableHeight = state.height - state.usedHeight;
    if (availableHeight <= 0)
        return DECLINE();
    const canForce = state.canForce && state.placed.length === 0;
    const contentAbove = hasContentAbove(state);
    const inner = place(fragment, availableHeight, state.pageNumber, canForce, contentAbove);
    if (inner === null)
        return DECLINE();
    const broke = inner.remaining.length > 0;
    // A row slice is a break at the page bottom — not allowed inside a window.
    if (broke && state.height < state.forbidUntil)
        return DECLINE();
    state.placed.push({
        item,
        y: state.usedHeight,
        height: broke
            ? availableHeight
            : inner.placed.reduce((acc, child) => Math.max(acc, child.height), 0),
        part: { isFirst, isLast: !broke },
        children: inner.placed,
    });
    if (!broke)
        return CONTINUE();
    const continuation = {
        item,
        isFirst: false,
        children: inner.remaining,
    };
    return DONE({
        placed: state.placed,
        remaining: [continuation, ...state.fragments.slice(index + 1)],
    });
};

// Attempt to place the fragment at the current position. Declines when it
// can't contribute anything here (a leaf that doesn't fit, a container whose
// children all decline) — the overflow cascade decides what happens.
const fit = (state, fragment, index) => {
    let step;
    if (isColumn(fragment.item)) {
        step = fit$3(state, fragment, index);
    }
    else if (isRow(fragment.item)) {
        step = fit$1(state, fragment, index);
    }
    else {
        step = fit$2(state, fragment);
    }
    if (step.kind !== 'continue')
        return step;
    state.usedHeight += height(fragment);
    const next = state.fragments[index + 1];
    const insideWindow = state.usedHeight < state.forbidUntil;
    if ((next === undefined || !isForbidPenalty(next.item)) && !insideWindow) {
        state.bestBreak = {
            remainingIndex: index + 1,
            placedCount: state.placed.length,
        };
    }
    return CONTINUE();
};

const canSplit = (item) => isLeaf(item) && item.split !== undefined;

// On overflow, decide whether the pending lazy committed (something from
// it landed on this page) or should be un-spliced and handed to the next
// page for re-materialization. Returns the lazy's restored index, or
// null if nothing was pending or the lazy already committed.
const restore = (state) => {
    if (state.pendingLazy === null)
        return null;
    const { spliceStart, fragment, count, placedAtMaterialize } = state.pendingLazy;
    state.pendingLazy = null;
    if (state.placed.length > placedAtMaterialize)
        return null;
    state.fragments.splice(spliceStart, count, fragment);
    return spliceStart;
};

// Placed something already but can't fit current and have no better
// break to rewind to — stop here and let the next page continue.
const deferToNextPage = (state, i) => {
    const lazyIndex = restore(state);
    return DONE({
        placed: state.placed,
        remaining: state.fragments.slice(lazyIndex ?? i),
    });
};

// Can't fit here — end the page at the last clean break instead.
// Any items placed after that break are dropped from this page and
// will reappear on the next one. If some of those dropped items
// came from a lazy node, the next page will re-run it fresh.
const rewindToBestBreak = (state, bestBreak) => {
    state.placed.length = bestBreak.placedCount;
    const lazyIndex = restore(state);
    const remaining = state.fragments.slice(lazyIndex ?? bestBreak.remainingIndex);
    return DONE({ placed: state.placed, remaining });
};

const spillOntoOwnPage = (state, i, fragment, height) => {
    const lazyIndex = restore(state);
    // Nothing fit, but a lazy was pending — hand it back to the next
    // page so it can re-materialize with the updated pageNumber.
    if (lazyIndex !== null) {
        return DONE({ placed: [], remaining: state.fragments.slice(lazyIndex) });
    }
    const { item, isFirst } = fragment;
    const label = 'id' in item && item.id ? ` "${item.id}"` : '';
    // eslint-disable-next-line no-console
    console.warn(`[paginate] Item${label} of height ${height} exceeds available height ${state.height}; placing on its own page.`);
    if (isRow(item)) {
        const placedChildren = place(fragment, height, state.pageNumber, true)?.placed ?? [];
        const placed = [
            {
                item,
                y: 0,
                height,
                part: { isFirst, isLast: true },
                children: placedChildren,
            },
        ];
        return DONE({ placed, remaining: state.fragments.slice(i + 1) });
    }
    return DONE({
        placed: [{ item, y: 0, height, part: { isFirst, isLast: true } }],
        remaining: state.fragments.slice(i + 1),
    });
};

const trySplitLeaf = (state, i, item, isFirst) => {
    const availHeight = state.height - state.usedHeight;
    const result = item.split(availHeight);
    if (!result)
        return null;
    state.placed.push({
        item: result.current,
        y: state.usedHeight,
        height: result.current.height,
        part: { isFirst, isLast: false },
    });
    const remainingFragment = { item: result.next, isFirst: false, children: [] };
    return DONE({
        placed: state.placed,
        remaining: [remainingFragment, ...state.fragments.slice(i + 1)],
    });
};

const canRewind = (bestBreak, i) => bestBreak !== null && bestBreak.remainingIndex < i + 1;
const tryOverflow = (state, fragment, i) => {
    // A split is a break at the page bottom — not allowed inside a window.
    if (state.height >= state.forbidUntil && canSplit(fragment.item)) {
        const split = trySplitLeaf(state, i, fragment.item, fragment.isFirst);
        if (split !== null)
            return split;
    }
    // Rewind: end the page at the last spot where breaking was allowed.
    // Anything placed after that spot is taken back off this page and moves
    // to the next one — that's how FORBID groups travel together.
    if (canRewind(state.bestBreak, i)) {
        return rewindToBestBreak(state, state.bestBreak);
    }
    // No legal break on this page. Forcing bad output (spilling, breaking a
    // forbid) is only justified at the top of a page, where deferring would
    // loop forever; anywhere else, hand everything back and retry next page.
    if (!state.canForce) {
        restore(state);
        return DONE({ placed: [], remaining: state.fragments });
    }
    if (state.placed.length === 0) {
        const height$1 = height(fragment);
        return spillOntoOwnPage(state, i, fragment, height$1);
    }
    return deferToNextPage(state, i);
};

const isForcePenalty = (item) => isPenalty(item) && item.type === 'force';

// Run the user's materialize(ctx), replace the lazy with its output,
// and rewind so the new fragments flow through normal placement logic.
const materialize = (state, fragment, index) => {
    const item = fragment.item;
    const produced = item.materialize({ pageNumber: state.pageNumber });
    const materialized = toFragments(produced);
    if (isRepeat(item))
        for (const f of materialized)
            f.origin = item;
    state.fragments.splice(index, 1, ...materialized);
    if (materialized.length > 0) {
        state.pendingLazy = {
            spliceStart: index,
            fragment,
            count: materialized.length,
            placedAtMaterialize: state.placed.length,
        };
    }
    return REWIND();
};

const fillStep = (state, index) => {
    const fragment = state.fragments[index];
    if (isForcePenalty(fragment.item)) {
        const placed = state.placed;
        const remaining = state.fragments.slice(index + 1);
        return DONE({ placed, remaining });
    }
    if (isForbidPenalty(fragment.item)) {
        // A window only arms when a break exists before the preceding item —
        // with nowhere to rewind to, moving it wouldn't improve its presence.
        const { ahead } = fragment.item;
        if (ahead && state.bestBreak !== null) {
            state.forbidUntil = Math.max(state.forbidUntil, state.usedHeight + ahead);
        }
        return CONTINUE();
    }
    if (isLazy$1(fragment.item)) {
        return materialize(state, fragment, index);
    }
    const step = fit(state, fragment, index);
    if (step.kind === 'decline') {
        return tryOverflow(state, fragment, index);
    }
    return step;
};

const fill = (fragments, height, pageNumber, canForce = false, contentAbove = false) => {
    const state = {
        fragments,
        height,
        placed: [],
        usedHeight: 0,
        bestBreak: null,
        pendingLazy: null,
        pageNumber,
        canForce,
        contentAbove,
        forbidUntil: 0,
    };
    for (let i = 0; i < state.fragments.length; i += 1) {
        const step = fillStep(state, i);
        if (step.kind === 'done')
            return step.result;
        if (step.kind === 'rewind')
            i -= 1;
    }
    return { placed: state.placed, remaining: [] };
};

const FORCE_BREAK = { kind: 'penalty', type: 'force' };
const FORBID_BREAK = { kind: 'penalty', type: 'forbid' };
// No page break may land within `ahead` of this point.
const presenceWindow = (ahead) => ({
    kind: 'penalty',
    type: 'forbid',
    ahead,
});
const isContainer = (node) => 'children' in node;
const isLazy = (node) => 'materialize' in node;
const isAbsolute = (node) => 'absolute' in node && !!node.absolute;
// The type system forbids these, but plain JS callers get no such help.
const validate = (node) => {
    const mixed = node;
    if (mixed.children && (mixed.split || mixed.materialize)) {
        throw new Error('[paginate] A node with children cannot also have split or materialize.');
    }
    if (mixed.split && mixed.materialize) {
        throw new Error('[paginate] A node cannot have both split and materialize.');
    }
};
const marginTop = (node) => node.box.marginTop || 0;
const marginBottom = (node) => node.box.marginBottom || 0;
const edgeTop = (node) => node.box.edgeTop || 0;
// Items live in margin-box space: heights are margin boxes and tops are
// margin-box tops. `outerTop` converts a border-box top into that space.
const outerTop = (node) => node.box.top - marginTop(node);
const outerHeight = (node) => marginTop(node) + node.box.height + marginBottom(node);
// Blank space between two flow siblings that belongs to neither box.
const gapBefore = (flow, index) => {
    const previous = flow[index - 1];
    if (!previous)
        return 0;
    return outerTop(flow[index]) - outerTop(previous) - outerHeight(previous);
};
// Node-less blank space; edges carry across breaks, collapsing gaps drop.
const space = (height, collapse = false) => ({
    kind: 'spacer',
    height,
    split: (avail) => {
        if (!collapse && avail <= 0)
            return null;
        return {
            current: { kind: 'spacer', height: avail },
            next: collapse ? { kind: 'spacer', height: 0 } : space(height - avail),
        };
    },
});
// Split closures receive content height — the engine subtracts the top
// margin — and return public nodes, converted as the engine descends.
const splitOf = (node) => {
    const { split } = node;
    if (!split)
        return undefined;
    return (availHeight) => {
        const pair = split(availHeight - marginTop(node));
        if (!pair)
            return null;
        return { current: leafOf(pair[0]), next: leafOf(pair[1]) };
    };
};
// An absolute is a zero-height marker: it takes no space and never splits,
// but it lands on the page the flow reaches it on, in source order.
const leafOf = (node) => ({
    kind: 'leaf',
    height: node.absolute ? 0 : outerHeight(node),
    id: node.id,
    data: node,
    split: node.absolute ? undefined : splitOf(node),
});
const lazyOf = (node) => ({
    kind: 'lazy',
    id: node.id,
    materialize: (ctx) => [toItem(node.materialize(ctx))],
});
// The node's edges (margin + border + padding) stack as spacers above and
// below its body, riding on a column so they continue across page breaks.
const withEdges = (node, bodyTop, bodyBottom, body) => {
    const topSpace = marginTop(node) + bodyTop;
    const bottomSpace = marginBottom(node) + node.box.height - bodyBottom;
    return {
        kind: 'column',
        id: node.id,
        data: node,
        children: [
            ...(topSpace > 0 ? [space(topSpace)] : []),
            ...body,
            ...(bottomSpace > 0 ? [space(bottomSpace)] : []),
        ],
    };
};
const withFlags = (node, item) => ({
    ...item,
    ...(node.repeat ? { repeat: true } : {}),
});
// Children in flow order: absolutes become zero-height leaves where they
// stand but stay out of the gap math — their tops aren't flow positions.
// A break turns into a force penalty before its node; minPresenceAhead into
// a forbid window after it.
const itemsOf = (children) => {
    const flow = children.filter((child) => !isAbsolute(child));
    return children.flatMap((child) => {
        if (isAbsolute(child))
            return [withFlags(child, leafOf(child))];
        const index = flow.indexOf(child);
        const before = gapBefore(flow, index);
        const item = withFlags(child, toItem(child));
        const breaker = child.break && index > 0 ? FORCE_BREAK : null;
        const lead = before > 0 ? space(before, true) : null;
        const window = child.minPresenceAhead
            ? presenceWindow(child.minPresenceAhead)
            : null;
        return [breaker, lead, item, window].filter(Boolean);
    });
};
// A row's children share a y. A cell pushed down by alignment gets its
// offset as a spacer, forbidden from parting with the cell so an offset
// band never strands at a page bottom on its own.
const rowOf = (node) => {
    const flow = node.children.filter((child) => !isAbsolute(child));
    const cells = flow.map((child) => {
        const item = withFlags(child, toItem(child));
        const offset = outerTop(child) - edgeTop(node);
        if (offset <= 0.001)
            return item;
        return { kind: 'column', children: [space(offset), FORBID_BREAK, item] };
    });
    const bodyBottom = Math.max(...flow.map((child) => outerTop(child) + outerHeight(child)));
    return withEdges(node, edgeTop(node), bodyBottom, [
        { kind: 'row', children: cells },
    ]);
};
// A column whose children overlap vertically wrapped into visual columns:
// its boxes no longer describe a vertical flow, so there is nowhere sane to
// break inside it. Rows are exempt — their cells share a y by design.
const isWrapped = (flow) => flow.some((_, index) => gapBefore(flow, index) < -1e-3);
const columnOf = (node) => {
    const flow = node.children.filter((child) => !isAbsolute(child));
    if (isWrapped(flow)) {
        return { kind: 'leaf', height: outerHeight(node), id: node.id, data: node };
    }
    const first = flow[0];
    const last = flow[flow.length - 1];
    return withEdges(node, first ? outerTop(first) : edgeTop(node), last ? outerTop(last) + outerHeight(last) : node.box.height, itemsOf(node.children));
};
const toItem = (node) => {
    validate(node);
    if (isLazy(node))
        return lazyOf(node);
    if (isContainer(node)) {
        return node.direction === 'row' ? rowOf(node) : columnOf(node);
    }
    return leafOf(node);
};
// The top-level nodes are the flow itself: they fill pages directly, with
// no enclosing box — page geometry is the caller's business.
const toItems = (nodes) => ({
    kind: 'column',
    children: itemsOf(nodes),
});

// Structural items dissolve into positions: a spacer's space and a synthetic
// wrapper's nesting are already in the accumulated y. Data-bearing items come
// out as placed nodes whose children are relative to the parent's border box.
const rebuild = (placed, origin) => {
    const node = placed.item.data;
    const top = origin + placed.y;
    if (!node) {
        return (placed.children || []).flatMap((child) => rebuild(child, top));
    }
    const lead = placed.part.isFirst ? node.box.marginTop || 0 : 0;
    const data = 'data' in node ? node.data : undefined;
    const children = placed.children?.flatMap((child) => rebuild(child, -lead));
    return [
        { box: { top, height: placed.height }, part: placed.part, data, children },
    ];
};
const toPlaced = (page) => page.flatMap((item) => rebuild(item, 0));

// Stepwise pagination: each next(height) fills exactly one page, so callers
// can pass a different height per page (a template whose chrome varies).
// Page numbering stays sealed inside; callers own termination. The stream
// is a vertical flow by definition — rows live inside it as containers.
const createPaginator = (nodes) => {
    let pageNumber = 1;
    let fragments = toFragments([toItems(nodes)]);
    return {
        get done() {
            return fragments.length === 0;
        },
        next(height) {
            if (fragments.length === 0) {
                throw new Error('[paginate] next() called after done');
            }
            // canForce: true. If something doesn't fit even at the top of an empty
            // page, moving it to the next page won't help — place it anyway.
            const result = fill(fragments, height, pageNumber, true);
            pageNumber += 1;
            fragments = result.remaining;
            return toPlaced(result.placed);
        },
    };
};

export { createPaginator };
