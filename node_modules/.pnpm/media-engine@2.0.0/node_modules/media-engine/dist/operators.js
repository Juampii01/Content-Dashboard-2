"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Operator;
function Operator(type, left, right) {
    switch (type) {
        case 'and':
            return { match: function (o) { return left.match(o) && right.match(o); } };
        case ',':
            return { match: function (o) { return left.match(o) || right.match(o); } };
        default:
            throw new Error(type);
    }
}
