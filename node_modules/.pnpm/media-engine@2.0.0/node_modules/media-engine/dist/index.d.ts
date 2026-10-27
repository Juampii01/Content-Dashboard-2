import { MatchOptions } from './queries';
declare function matchMedia<T extends object>(queries: {
    [query: string]: T;
}, options: MatchOptions): Partial<T>;
export = matchMedia;
