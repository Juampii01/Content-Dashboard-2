"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Query;
function Query(type, value) {
    var size = Number(value);
    switch (type) {
        case 'max-height':
            return { match: function (o) { return o.height !== undefined && size >= o.height; } };
        case 'min-height':
            return { match: function (o) { return o.height !== undefined && size <= o.height; } };
        case 'max-width':
            return { match: function (o) { return o.width !== undefined && size >= o.width; } };
        case 'min-width':
            return { match: function (o) { return o.width !== undefined && size <= o.width; } };
        case 'orientation':
            return { match: function (o) { return value === o.orientation; } };
        default:
            throw new Error(value);
    }
}
