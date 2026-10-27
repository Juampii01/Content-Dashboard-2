export interface MatchOptions {
    width?: number;
    height?: number;
    orientation?: string;
}
export interface Matcher {
    match(options: MatchOptions): boolean;
}
export default function Query(type: string, value: string): Matcher;
