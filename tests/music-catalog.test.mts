/**
 * Catálogo de música (Jamendo detrás de MusicProvider): solo licencias que permiten musicalizar el video de una marca
 * (CC BY y CC0), atribución lista y errores claros. Con un fetch simulado (sin red ni base).
 *   pnpm test:musica
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jamendoProvider, JamendoError } from "../lib/video/music-providers/jamendo";
import { attributionText, commercialLicense } from "../lib/video/music-providers/types";

const LIC = ["https://creativecommons.org/licenses/by/4.0/", "https://creativecommons.org/licenses/by-nc/3.0/", "https://creativecommons.org/licenses/by-nd/4.0/", "https://creativecommons.org/licenses/by-sa/4.0/", "https://creativecommons.org/publicdomain/zero/1.0/"];
const track = (i: number) => ({ id: String(100 + i), name: `Pista ${i}`, duration: 90, artist_name: "Duna", audio: `https://cdn/a${i}.mp3`, audiodownload: `https://cdn/d${i}.mp3`, audiodownload_allowed: i !== 4, license_ccurl: LIC[i % LIC.length]!, shareurl: `https://www.jamendo.com/track/${100 + i}` });

function fakeFetch(calls: string[], body: unknown, status = 200): typeof fetch {
  return (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("licencias", () => {
  test("solo CC BY y CC0", () => {
    assert.deepEqual(commercialLicense(LIC[0]), { ok: true, label: "CC BY 4.0", attribution: true });
    assert.equal(commercialLicense(LIC[1]).ok, false, "NC");
    assert.equal(commercialLicense(LIC[2]).ok, false, "ND");
    assert.equal(commercialLicense(LIC[3]).ok, false, "SA");
    assert.deepEqual(commercialLicense(LIC[4]), { ok: true, label: "CC0 (dominio público)", attribution: false });
    assert.equal(commercialLicense(null).ok, false);
    assert.equal(commercialLicense("https://example.com/licencia").ok, false);
  });

  test("atribución con artista, licencia, catálogo y link", () => {
    const t = attributionText({ title: "Sol", artist: "Duna", pageUrl: "https://www.jamendo.com/track/1", license: { url: LIC[0]!, label: "CC BY 4.0" } }, "Jamendo");
    assert.equal(t, "Música: «Sol» de Duna (CC BY 4.0) · Jamendo · https://www.jamendo.com/track/1");
  });
});

describe("Jamendo", () => {
  test("pide sin NC/ND/SA, instrumental, y descarta lo que no sirve aunque venga", async () => {
    const calls: string[] = [];
    const p = jamendoProvider("abc123", { base: "https://api.test/v3.0", fetcher: fakeFetch(calls, { headers: { status: "success" }, results: [0, 1, 2, 3, 4, 5].map(track) }) });
    const res = await p.search("lofi");
    const u = new URL(calls[0]!);
    assert.equal(u.pathname, "/v3.0/tracks/");
    for (const [k, v] of [["ccnc", "false"], ["ccnd", "false"], ["ccsa", "false"], ["client_id", "abc123"], ["search", "lofi"], ["vocalinstrumental", "instrumental"]]) assert.equal(u.searchParams.get(k), v, k);
    assert.deepEqual(res.map((t) => t.id), ["100", "104", "105"]);
    assert.equal(res[0]!.license.label, "CC BY 4.0");
  });

  test("get: solo si se puede bajar y la licencia sirve", async () => {
    const ok = jamendoProvider("abc123", { base: "https://api.test/v3.0", fetcher: fakeFetch([], { headers: { status: "success" }, results: [track(0)] }) });
    assert.equal((await ok.get("100"))?.downloadUrl, "https://cdn/d0.mp3");
    const noDl = jamendoProvider("abc123", { base: "https://api.test/v3.0", fetcher: fakeFetch([], { headers: { status: "success" }, results: [track(4)] }) });
    assert.equal(await noDl.get("104"), null);
    const nc = jamendoProvider("abc123", { base: "https://api.test/v3.0", fetcher: fakeFetch([], { headers: { status: "success" }, results: [track(1)] }) });
    assert.equal(await nc.get("101"), null);
    assert.equal(await ok.get("../hack"), null);
  });

  test("client_id rechazado: error claro en español", async () => {
    const p = jamendoProvider("malo00", { base: "https://api.test/v3.0", fetcher: fakeFetch([], { headers: { status: "failed", code: 5 }, results: [] }) });
    await assert.rejects(p.search(""), (e: unknown) => e instanceof JamendoError && /client_id/.test((e as Error).message));
  });
});
