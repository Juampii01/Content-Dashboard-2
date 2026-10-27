interface Box {
    /** Border-box top, relative to the parent's border box. */
    top: number;
    /** Border-box height. */
    height: number;
    /** Numbers only — resolve 'auto' margins before handing nodes over. */
    marginTop?: number;
    marginBottom?: number;
    /** Top border + padding, summed — the engine never needs them apart. */
    edgeTop?: number;
    edgeBottom?: number;
}
interface LeafNode {
    box: Box;
    /**
     * Split at `avail` of content height (margins already subtracted by the
     * engine). Return the fragment that fits and the remainder, or null to
     * move the whole leaf to the next page.
     */
    split?: (avail: number) => [LeafNode, LeafNode] | null;
    /** Takes no space and never splits; lands where the flow reaches it. */
    absolute?: boolean;
    repeat?: boolean;
    break?: boolean;
    minPresenceAhead?: number;
    data?: unknown;
    id?: string;
}
interface ContainerNode {
    box: Box;
    children: FlowNode[];
    direction: 'row' | 'column';
    repeat?: boolean;
    break?: boolean;
    minPresenceAhead?: number;
    data?: unknown;
    id?: string;
}
interface LazyNode {
    box: Box;
    materialize: (ctx: {
        pageNumber: number;
    }) => FlowNode;
    repeat?: boolean;
    break?: boolean;
    minPresenceAhead?: number;
    id?: string;
}
type FlowNode = LeafNode | ContainerNode | LazyNode;
interface PlacedNode {
    /**
     * `top` is the node's margin-box y: relative to the page for top-level
     * nodes, to the parent's border box below. `height` is the margin-box
     * height the fragment occupied on this page.
     */
    box: {
        top: number;
        height: number;
    };
    part: {
        isFirst: boolean;
        isLast: boolean;
    };
    data?: unknown;
    children?: PlacedNode[];
}

interface Paginator {
    readonly done: boolean;
    next(height: number): PlacedNode[];
}
declare const createPaginator: (nodes: FlowNode[]) => Paginator;

export { type Box, type ContainerNode, type FlowNode, type LazyNode, type LeafNode, type Paginator, type PlacedNode, createPaginator };
