"use strict";
var parser_1 = require("./parser");
function matchMedia(queries, options) {
    var result = {};
    Object.keys(queries).forEach(function (query) {
        if ((0, parser_1.parse)(query).match(options)) {
            Object.assign(result, queries[query]);
        }
    });
    return result;
}
module.exports = matchMedia;
