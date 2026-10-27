const require_crypto = require("./crypto.cjs");
const require_utils = require("./utils.cjs");
//#region src/cookies.ts
const COOKIE_PREFIXES = {
	secure: "__Secure-",
	host: "__Host-"
};
const getCookieKey = (key, prefix) => {
	if (!prefix) return key;
	if (prefix !== "secure" && prefix !== "host") return void 0;
	return COOKIE_PREFIXES[prefix] + key;
};
/**
* Parse an HTTP Cookie header string and returning an object of all cookie
* name-value pairs.
*
* Inspired by https://github.com/unjs/cookie-es/blob/main/src/cookie/parse.ts
*
* @param str the string representing a `Cookie` header value
*/
function parseCookies(str) {
	if (typeof str !== "string") throw new TypeError("argument str must be a string");
	const cookies = /* @__PURE__ */ new Map();
	let index = 0;
	while (index < str.length) {
		const eqIdx = str.indexOf("=", index);
		if (eqIdx === -1) break;
		let endIdx = str.indexOf(";", index);
		if (endIdx === -1) endIdx = str.length;
		else if (endIdx < eqIdx) {
			index = str.lastIndexOf(";", eqIdx - 1) + 1;
			continue;
		}
		const key = str.slice(index, eqIdx).trim();
		if (!cookies.has(key)) {
			let val = str.slice(eqIdx + 1, endIdx).trim();
			if (val.codePointAt(0) === 34) val = val.slice(1, -1);
			cookies.set(key, require_utils.tryDecode(val));
		}
		index = endIdx + 1;
	}
	return cookies;
}
function resolveCookie(name, value, options = {}) {
	const resolvedName = getCookieKey(name, options.prefix) ?? name;
	const resolvedOptions = { ...options };
	const lowerName = resolvedName.toLowerCase();
	if (lowerName.startsWith("__host-")) {
		resolvedOptions.secure = true;
		resolvedOptions.path = "/";
		resolvedOptions.domain = void 0;
	} else if (lowerName.startsWith("__secure-")) resolvedOptions.secure = true;
	if (resolvedOptions.partitioned === true || resolvedOptions.sameSite?.toLowerCase() === "none") resolvedOptions.secure = true;
	return {
		name: resolvedName,
		value,
		options: resolvedOptions
	};
}
function serializeCookieValue({ name, value, options }) {
	let cookie = `${name}=${value}`;
	if (typeof options.maxAge === "number" && options.maxAge >= 0) {
		if (options.maxAge > 3456e4) throw new Error("Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.");
		cookie += `; Max-Age=${Math.floor(options.maxAge)}`;
	}
	if (options.domain) cookie += `; Domain=${options.domain}`;
	if (options.path) cookie += `; Path=${options.path}`;
	if (options.expires) {
		if (options.expires.getTime() - Date.now() > 3456e7) throw new Error("Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.");
		cookie += `; Expires=${options.expires.toUTCString()}`;
	}
	if (options.httpOnly) cookie += "; HttpOnly";
	if (options.secure) cookie += "; Secure";
	if (options.sameSite) cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
	if (options.partitioned) cookie += "; Partitioned";
	return cookie;
}
const serializeCookie = (key, value, opt) => {
	value = encodeURIComponent(value);
	return serializeCookieValue(resolveCookie(key, value, opt));
};
const serializeSignedCookie = async (key, value, secret, opt) => {
	value = await require_crypto.signCookieValue(value, secret);
	return serializeCookieValue(resolveCookie(key, value, opt));
};
//#endregion
exports.getCookieKey = getCookieKey;
exports.parseCookies = parseCookies;
exports.serializeCookie = serializeCookie;
exports.serializeSignedCookie = serializeSignedCookie;

//# sourceMappingURL=cookies.cjs.map