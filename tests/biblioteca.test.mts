/**
 * Biblioteca con visión (Etapa 2): fichas de clips e imágenes, búsqueda por lo que se ve, b-roll elegido por la ficha
 * con su tramo dentro del clip, @menciones en el chat y consumo de la ficha en api_usage.
 *   pnpm test:biblioteca                      (solo funciones puras)
 *   TEST_DATABASE_URL=postgres://... pnpm test:biblioteca   (también base, almacenamiento local y Claude simulado)
 * Nunca la corras contra la base de un cliente: crea y borra filas de broll_clips, api_usage y ai_credit_limits.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
Object.assign(process.env, {
  DATABASE_URL: url ?? "postgres://nadie@localhost:1/nada",
  DATABASE_URL_UNPOOLED: url ?? "postgres://nadie@localhost:1/nada",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
  AI_FAKE: "1",
  NODE_ENV: "test",
  ANTHROPIC_API_KEY: "sk-ant-api03-prueba",
});

const F = await import("../lib/video/library-ficha");
const { chatItems } = await import("../lib/video/chat-library");

// Dos clips de prueba con su ficha (como la escribiría Claude mirando los cuadros).
const oficina: import("../lib/video/library-ficha").LibraryEntry & { fileKey: string; thumbKey: string | null } = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "video",
  title: "IMG 2041",
  tags: [],
  duration: 14,
  width: 1080,
  height: 1920,
  fileKey: "editor/biblioteca/11111111-1111-4111-8111-111111111111/clip.mp4",
  thumbKey: null,
  ficha: {
    description: "Oficina luminosa con una persona trabajando en su laptop y un equipo reunido al fondo.",
    moments: [
      { start: 0, end: 4.5, what: "Manos escribiendo en el teclado de una laptop" },
      { start: 4.5, end: 9, what: "Equipo reunido alrededor de una mesa mirando una pizarra" },
      { start: 9, end: 14, what: "Pantalla con un gráfico de ventas que sube" },
    ],
    colors: ["#f2efe9", "#1f2a44"],
    style: "Plano medio, luz natural, cámara en mano.",
    uses: ["productividad", "trabajo en equipo"],
    tags: ["oficina", "laptop", "equipo"],
    tagsEn: ["office", "teamwork"],
  },
};
const clinica: typeof oficina = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "video",
  title: "toma recepción",
  tags: ["recepcion"],
  duration: 10,
  width: 1080,
  height: 1920,
  fileKey: "editor/biblioteca/22222222-2222-4222-8222-222222222222/clip.mp4",
  thumbKey: null,
  ficha: {
    description: "Recepción de una clínica dental.",
    moments: [
      { start: 0, end: 5, what: "Paciente entrando por la puerta de la clínica" },
      { start: 5, end: 10, what: "Recepcionista atendiendo una llamada por teléfono" },
    ],
    colors: ["#ffffff", "#2a7fd4"],
    style: "Plano general, luz de estudio, cámara fija.",
    uses: ["atender pacientes", "agendar citas"],
    tags: ["clínica", "recepción", "teléfono"],
    tagsEn: ["dental clinic", "phone call"],
  },
};

describe("ficha (funciones puras)", () => {
  test("lo que dice Claude queda dentro del clip, en orden, sin superponerse y con colores en hexadecimal", () => {
    const f = F.fichaFromAi(
      {
        description: "  Una   playa  ",
        moments: [
          { start: 6, end: 30, what: "Olas" },
          { start: -2, end: 3, what: "Arena" },
          { start: 2, end: 7, what: "Gaviotas" },
          { start: 8, end: 8.1, what: "Muy corto" },
        ],
        colors: ["#AABBCC", "azul", "112233"],
        style: "Dron",
        uses: ["vacaciones"],
        tags: ["Playa", "playa", "x"],
        tags_en: ["Beach"],
      },
      10,
      "video",
    );
    assert.equal(f.description, "Una playa");
    assert.deepEqual(
      f.moments.map((m) => [m.start, m.end, m.what]),
      [
        [0, 3, "Arena"],
        [3, 7, "Gaviotas"],
        [7, 10, "Olas"],
      ],
    );
    assert.deepEqual(f.colors, ["#aabbcc", "#112233"]);
    assert.deepEqual(f.tags, ["playa"]);
    assert.deepEqual(f.tagsEn, ["beach"]);
  });

  test("una imagen no tiene momentos", () => {
    const f = F.fichaFromAi({ description: "Logo", moments: [{ start: 0, end: 3, what: "x" }], colors: [], style: "", uses: [], tags: [], tags_en: [] }, 0, "image");
    assert.equal(f.moments.length, 0);
  });

  test("elige el clip y el momento por lo que se ve, no por el nombre del archivo", () => {
    const phrase = "cuando un paciente llama por teléfono a la recepción";
    const a = F.matchLibrary(oficina, phrase.split(" "));
    const b = F.matchLibrary(clinica, phrase.split(" "));
    assert.ok(b.score > a.score, `clínica ${b.score} > oficina ${a.score}`);
    assert.equal(b.moment?.what, "Recepcionista atendiendo una llamada por teléfono");
    // "IMG 2041" no dice nada: el gráfico de ventas sale de la ficha.
    const sales = F.matchLibrary(oficina, ["ventas", "crecen", "grafico"]);
    assert.ok(sales.score > 0);
    assert.equal(sales.moment?.start, 9);
    // En inglés (la consulta de stock) también encuentra.
    assert.ok(F.matchLibrary(oficina, ["teamwork"]).score >= 3);
    assert.equal(F.matchLibrary(oficina, ["playa", "surf"]).score, 0);
  });

  test("el segundo del clip cubre el tramo sin pasarse del final", () => {
    assert.equal(F.clipStartFor(oficina, { start: 9, end: 14 }, 3), 9);
    assert.equal(F.clipStartFor(oficina, { start: 12, end: 14 }, 4), 10);
    assert.equal(F.clipStartFor({ kind: "image", duration: 0 }, { start: 3, end: 5 }, 2), 0);
  });

  test("con el momento elegido, el b-roll se ve desde ese segundo", () => {
    const opt = F.pieceOption(clinica, clinica.ficha!.moments[1]!);
    const item = F.withLibraryStart({ id: "b1", from_word: 3, to_word: 8, query_en: "", keywords: [], choice: opt, options: [opt] }, 3);
    assert.equal(item.edit?.clip_start, 5);
    const img = F.pieceOption({ ...clinica, kind: "image", duration: 0 });
    assert.equal(img.kind, "image");
    assert.equal(img.duration, 0);
  });

  test("el catálogo para Claude lleva código, qué se ve y los tramos, y corta antes de pasarse", () => {
    const { text, codes } = F.libraryCatalog([oficina, clinica]);
    assert.match(text, /^C1 «IMG 2041» \(video 14\.0 s, vertical\): Oficina luminosa/m);
    assert.match(text, /\[5\.0–10\.0\] Recepcionista atendiendo/);
    assert.equal(codes.get("C2")?.id, clinica.id);
    const short = F.libraryCatalog([oficina, clinica], { maxChars: 250 });
    assert.ok(short.text.length <= 250);
    assert.ok(short.codes.size >= 1);
  });

  test("búsqueda y menciones normalizadas (sin tildes ni mayúsculas)", () => {
    const text = F.searchTextOf({ title: "Recepción", tags: ["Clínica"], ficha: clinica.ficha });
    assert.match(text, /recepcion clinica/);
    assert.match(text, /telefono/);
    assert.equal(F.searchQueryOf("  Teléfono  "), "telefono");
    assert.equal(F.mentionSlug("Oficina de Noche (2)"), "oficina-de-noche-2");
    assert.deepEqual(F.mentionsIn("usa @oficina-de-noche como referencia y @Logo al final, correo a@b.com"), ["oficina-de-noche", "logo"]);
  });

  test("una ficha editada se valida y ordena", () => {
    const f = F.readFicha({ ...clinica.ficha!, moments: [{ start: 5, end: 9, what: "B" }, { start: 0, end: 3, what: "A" }, { start: 4, end: 4, what: "vacío" }] }, 10);
    assert.deepEqual(f?.moments.map((m) => m.what), ["A", "B"]);
    assert.equal(F.readFicha({ description: 3 }), null);
  });
});

describe("chat del video con la biblioteca (validación de acciones)", () => {
  const library = { text: "", codes: new Map([["C1", oficina], ["C2", clinica]]) } as unknown as import("../lib/video/broll").LibraryPrompt;
  const ids = new Set(Array.from({ length: 40 }, (_, i) => i));
  const base = { scope: "momento" as const, title: "t", prompt: "p", layout: null, library: null, clip_start: null };

  test("«pon b-roll de lo que hablo»: un video de la biblioteca por su código, con su segundo dentro del clip", () => {
    const out = chatItems(
      [
        { ...base, kind: "video", from_word: 3, to_word: 9, attachments: [], library: "c2", clip_start: 5 },
        { ...base, kind: "video", from_word: 12, to_word: 15, attachments: [], library: "C1", clip_start: 99 },
        { ...base, kind: "video", from_word: 20, to_word: 22, attachments: [], library: "C9", clip_start: 0 },
      ],
      [],
      39,
      ids,
      library,
    );
    assert.equal(out.length, 2, "el código que no existe se descarta");
    assert.equal(out[0]!.clipId, clinica.id);
    assert.equal(out[0]!.clipStart, 5);
    assert.equal(out[1]!.clipStart, 13.5, "se ajusta al largo del clip");
  });

  test("@clip como referencia: un video de la biblioteca se puede usar de estilo en una animación; uno subido, no", () => {
    const out = chatItems(
      [{ ...base, kind: "animacion", from_word: 2, to_word: 6, attachments: [{ ref: "A1", use: "style" }, { ref: "A2", use: "style" }] }],
      [
        { ref: "A1", kind: "video", libraryId: oficina.id },
        { ref: "A2", kind: "video" },
      ],
      39,
      ids,
      library,
    );
    assert.deepEqual(out[0]!.attachments, [{ ref: "A1", use: "style" }]);
  });

  test("una imagen de la biblioteca puede ir de b-roll fijo", () => {
    const out = chatItems([{ ...base, kind: "video", from_word: 2, to_word: 6, attachments: [{ ref: "A1", use: "broll" }] }], [{ ref: "A1", kind: "image", libraryId: clinica.id }], 39, ids, library);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]!.attachments, [{ ref: "A1", use: "broll" }]);
  });
});

// ─── Con base de datos, almacenamiento local y Claude simulado ────────────

describe("biblioteca en la base", { skip: !url && "TEST_DATABASE_URL no está definida" }, () => {
  let sim: import("node:http").Server;
  let userId = "";
  let calls = 0;
  const chatRequests: { messages: { content: { type: string; text?: string }[] }[] }[] = [];
  const made: string[] = [];
  let mod: typeof import("../lib/video/library");
  let db: typeof import("../lib/db");
  let sql: typeof import("drizzle-orm").sql;

  before(async () => {
    // Simulador de la API de Anthropic (streaming): devuelve una ficha según la tarea.
    const { createServer } = await import("node:http");
    sim = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls++;
        const msg = JSON.parse(body) as { messages: { content: { type: string; text?: string }[] }[] };
        const task = JSON.stringify(msg.messages);
        const images = msg.messages[0]!.content.filter((c) => c.type === "image").length;
        if (!task.includes("FICHA DE")) {
          // Un turno del chat del video o del asistente de pedidos: se guarda lo que recibió Claude para revisarlo.
          chatRequests.push(msg);
          const reply = { reply: "En los cuadros veo un personaje redondo naranja que rebota.", go: false, items: [{ kind: "animacion", scope: "momento", from_word: 0, to_word: 3, title: "Personaje que rebota", prompt: "Un personaje redondo naranja rebota sobre la frase clave.", attachments: [], layout: null, library: null, clip_start: null }], note: "" };
          return stream(res, reply);
        }
        const ficha = task.includes("FICHA DE UNA IMAGEN")
          ? { description: `Logo azul sobre fondo blanco (${images} imagen).`, moments: [], colors: ["#2457f5", "#ffffff"], style: "Gráfico plano.", uses: ["marca"], tags: ["logo"], tags_en: ["logo"] }
          : { description: `Recepcionista con auriculares (${images} hojas).`, moments: [{ start: 0, end: 3, what: "Recepcionista sonriendo" }, { start: 3, end: 6, what: "Recepcionista contestando el teléfono" }], colors: ["#ffffff"], style: "Plano medio, luz de estudio.", uses: ["atender llamadas"], tags: ["recepción", "llamadas"], tags_en: ["phone"] };
        stream(res, ficha);
      });
    });
    function stream(res: import("node:http").ServerResponse, json: object) {
        const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2600, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 400 } } }) +
            ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
            ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: JSON.stringify(json) } }) +
            ev("content_block_stop", { index: 0 }) +
            ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 420 } }) +
            ev("message_stop", {}),
        );
    }
    await new Promise<void>((r) => sim.listen(0, r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(sim.address() as { port: number }).port}`;
    process.env.AI_FAKE = "0";
    mod = await import("../lib/video/library");
    db = await import("../lib/db");
    sql = (await import("drizzle-orm")).sql;
    const [u] = await db.getDb().select({ id: db.schema.users.id }).from(db.schema.users).limit(1);
    assert.ok(u, "la base de prueba necesita al menos un usuario");
    userId = u.id;
    await db.getDb().execute(sql`delete from api_usage where step = 'biblioteca.ficha'`);
    await db.getDb().execute(sql`delete from ai_credit_limits where id = ${userId}`);
  });

  after(async () => {
    process.env.AI_FAKE = "1";
    for (const id of made) await mod.deleteClip(id).catch(() => undefined);
    await db.getDb().execute(sql`delete from api_usage where step in ('biblioteca.ficha', 'prueba.tope')`);
    await db.getDb().execute(sql`delete from ai_credit_limits where id = ${userId}`);
    sim.close();
  });

  async function upload(name: string, type: string, bytes: Buffer) {
    const { writeBytes } = await import("../lib/storage/files");
    const { id, key, kind } = await mod.createClipUpload({ fileName: name, fileType: type, fileSize: bytes.byteLength, userId });
    made.push(id);
    await writeBytes(key, bytes, type);
    return { id, key, kind };
  }

  test("una imagen: se valida, se achica, queda lista con miniatura, y Claude escribe su ficha (cargada a quien la subió)", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#2457f5" } }).png().toBuffer();
    const { id, kind } = await upload("logo-azul.png", "image/png", png);
    assert.equal(kind, "image");
    const done = await mod.completeClipUpload(id, userId);
    assert.equal(done.ficha, true);
    let row = (await mod.loadClip(id))!;
    assert.equal(row.status, "READY");
    assert.equal(row.width, 2400);
    assert.equal(row.height, 1200);
    assert.match(row.fileKey, /imagen\.webp$/);
    assert.match(row.thumbKey ?? "", /miniatura\.jpg$/);
    assert.equal(row.fichaStatus, "pending");
    await mod.generateFicha(id);
    row = (await mod.loadClip(id))!;
    assert.equal(row.fichaStatus, "ready");
    assert.match(row.ficha!.description, /Logo azul/);
    assert.match(row.searchText, /logo azul/);
    const usage = await db.getDb().execute<{ step: string; user_id: string; cost_usd: number; model: string }>(sql`select step, user_id, cost_usd, model from api_usage where step = 'biblioteca.ficha'`);
    assert.equal(usage.rows.length, 1);
    assert.equal(usage.rows[0]!.user_id, userId);
    assert.ok(usage.rows[0]!.cost_usd > 0.005 && usage.rows[0]!.cost_usd < 0.05, `costo ${usage.rows[0]!.cost_usd}`);
  });

  test("un video: solo se aceptan hojas de ese clip; con ellas Claude escribe los momentos", async () => {
    const { id } = await upload("clip-recepcion.mp4", "video/mp4", Buffer.from("video de prueba"));
    await mod.completeClipUpload(id, userId);
    // Lo que hace el worker al terminar: listo, con duración y miniatura; las hojas, aparte.
    await db.getDb().execute(sql`update broll_clips set status = 'READY', duration = 6, width = 1080, height = 1920 where id = ${id}`);
    const sharp = (await import("sharp")).default;
    const { writeBytes } = await import("../lib/storage/files");
    const sheetKey = `editor/biblioteca/${id}/hoja-01.jpg`;
    await writeBytes(sheetKey, await sharp({ create: { width: 1296, height: 1218, channels: 3, background: "#888" } }).jpeg().toBuffer(), "image/jpeg");
    const ajena = { key: `editor/biblioteca/${clinica.id}/hoja-01.jpg`, width: 10, height: 10, frames: [1], times: [0] };
    assert.equal(await mod.saveClipSheets(id, { ok: true, sheets: [ajena] }), false, "una hoja de otro clip no se acepta");
    assert.equal((await mod.loadClip(id))!.fichaStatus, "failed");
    await db.getDb().execute(sql`update broll_clips set ficha_status = 'pending' where id = ${id}`);
    assert.equal(await mod.saveClipSheets(id, { ok: true, sheets: [{ key: sheetKey, width: 1296, height: 1218, frames: [1, 2, 3], times: [0.15, 2, 4] }] }), true);
    await mod.generateFicha(id);
    const row = (await mod.loadClip(id))!;
    assert.equal(row.fichaStatus, "ready");
    assert.deepEqual(row.ficha!.moments.map((m) => m.start), [0, 3]);
    assert.match(row.ficha!.description, /1 hojas/);
  });

  test("búsqueda por texto en Postgres: con raíces en español y sin tildes", async () => {
    const all = await mod.searchLibrary("llamada");
    const recep = (await db.getDb().execute<{ id: string }>(sql`select id from broll_clips where file_name = 'clip-recepcion.mp4'`)).rows[0]!.id;
    assert.ok(all.includes(recep), "«llamada» encuentra «llamadas»");
    assert.ok((await mod.searchLibrary("TELÉFONO")).includes(recep));
    assert.ok((await mod.searchLibrary("recepcio")).includes(recep), "por parte de palabra");
    assert.equal((await mod.searchLibrary("dinosaurio")).length, 0);
    assert.ok((await mod.searchLibrary("logo", { kind: "image" })).length >= 1);
  });

  test("el b-roll de la biblioteca sale por lo que se ve, con el tramo exacto del clip", async () => {
    const { librarySource, libraryForPrompt, resolveLibraryPick, preferLibrary } = await import("../lib/video/broll");
    const found = await librarySource.search({ queryEn: "phone", keywords: ["teléfono", "contestando"], format: "9:16", minDuration: 2 }, 3);
    assert.equal(found[0]?.title, "clip recepcion");
    assert.deepEqual(found[0]?.moment, { start: 3, end: 6, what: "Recepcionista contestando el teléfono" });
    const lib = await libraryForPrompt();
    assert.match(lib.text, /Recepcionista contestando el teléfono/);
    const code = [...lib.codes].find(([, p]) => p.title === "clip recepcion")![0];
    const own = resolveLibraryPick(lib, code, 3.2, [], 2);
    assert.equal(own?.moment?.start, 3);
    const item = preferLibrary({ id: "b", from_word: 0, to_word: 4, query_en: "phone", keywords: [], choice: null, options: [] }, own, 2);
    assert.equal(item.choice?.id, own?.id);
    assert.equal(item.edit?.clip_start, 3);
  });

  test("al llegar al tope de créditos no se llama a Claude: la pieza sigue lista y la ficha queda para reintentar", async () => {
    const { recordUsage } = await import("../lib/ai/usage");
    await db.getDb().insert(db.schema.aiCreditLimits).values({ id: userId, monthlyUsd: 0.001 });
    await recordUsage({ step: "prueba.tope", model: "claude-sonnet-5-5", userId, usage: { input_tokens: 10_000, output_tokens: 1000 } });
    const recep = (await db.getDb().execute<{ id: string }>(sql`select id from broll_clips where file_name = 'clip-recepcion.mp4'`)).rows[0]!.id;
    const before = calls;
    const r = await mod.retryFicha(recep, userId);
    assert.equal(r.ficha, true);
    await mod.generateFicha(recep);
    const row = (await mod.loadClip(recep))!;
    assert.equal(calls, before, "no se llamó a la API");
    assert.equal(row.status, "READY");
    assert.equal(row.fichaStatus, "failed");
    assert.match(row.fichaError ?? "", /créditos de IA/);
    await db.getDb().execute(sql`delete from ai_credit_limits where id = ${userId}`);
  });

  test("chat: un video adjunto se mira (cuadros y ficha) y el turno siguiente le manda a Claude las hojas; sus animaciones las llevan de referencia", async () => {
    const { chatTurn, clipStates, conversationClips } = await import("../lib/video/chat-turn");
    const PROJECT = "33333333-3333-4333-8333-333333333333";
    await db.getDb().execute(sql`delete from video_projects where id = ${PROJECT}`);
    const words = "Hoy te muestro cómo animar tu marca con un personaje".split(" ").map((text, id) => ({ id, text, start: id * 0.5, end: id * 0.5 + 0.4 }));
    await db.getDb().insert(db.schema.videoProjects).values({ id: PROJECT, title: "Chat", createdBy: userId, transcript: { version: 1, provider: "prueba", language: "es", duration: 6, words } as never });
    try {
      // 1. La persona adjunta su reel de referencia en el chat: se sube a la biblioteca y el worker lo mira.
      const { id } = await upload("reel-referencia.mp4", "video/mp4", Buffer.from("reel de 34 s"));
      await mod.completeClipUpload(id, userId);
      assert.equal((await clipStates([id]))[0]!.state, "waiting", "mientras se mira, el chat espera");
      await db.getDb().execute(sql`update broll_clips set status = 'READY', duration = 34, width = 1080, height = 1920 where id = ${id}`);
      const sharp = (await import("sharp")).default;
      const { writeBytes } = await import("../lib/storage/files");
      const sheets = [1, 2].map((n) => ({ key: `editor/biblioteca/${id}/hoja-0${n}.jpg`, width: 1296, height: 1218, frames: [n * 2 - 1, n * 2], times: [n * 8, n * 8 + 4] }));
      for (const sh of sheets) await writeBytes(sh.key, await sharp({ create: { width: 1296, height: 1218, channels: 3, background: "#f80" } }).jpeg().toBuffer(), "image/jpeg");
      assert.ok(await mod.saveClipSheets(id, { ok: true, sheets }));
      await mod.generateFicha(id);
      assert.equal((await clipStates([id]))[0]!.state, "ready");
      // 2. El turno siguiente: Claude recibe las hojas como imágenes y la ficha en el texto.
      const text = "Mira cómo son las animaciones y el personajito, es una referencia";
      const messages = [{ role: "user" as const, text, at: new Date().toISOString(), clips: [{ ref: "A1", id, name: "reel-referencia" }] }];
      assert.equal(conversationClips(messages)[0]!.reference, true);
      const ctx = { projectId: PROJECT, sentences: [{ from: 0, to: 9, start: 0, end: 5, text: words.map((w) => w.text).join(" ") }], duration: 6, format: "9:16" as const, playhead: null, selection: null, state: "", attachments: [{ ref: "A1", kind: "video" as const, name: "reel-referencia", duration: 34, libraryId: id }] };
      const before = chatRequests.length;
      const out = await chatTurn(ctx, messages, userId, null, text);
      assert.equal(chatRequests.length, before + 1);
      const content = chatRequests.at(-1)!.messages[0]!.content;
      assert.equal(content.filter((c) => c.type === "image").length, 2, "van las 2 hojas de cuadros");
      const task = content.find((c) => c.type === "text")!.text!;
      assert.match(task, /VIDEOS QUE ADJUNTÓ/);
      assert.match(task, /V1 \(A1 cuando lo adjuntó\): «reel referencia» \(video de 34\.0 s/);
      assert.match(task, /Recepcionista con auriculares/, "la ficha que escribió Claude");
      assert.match(task, /REFERENCIA de estilo/);
      assert.match(task, /#1 8\.0 s/);
      // 3. La animación que sale de esa charla lleva ese video como referencia de estilo (sus hojas).
      assert.ok(!("ok" in out));
      if (!("ok" in out)) assert.deepEqual((out.message.items as { styleClips?: string[] }[])[0]!.styleClips, [id]);
      // 4. Y en los turnos que siguen, el video sigue a la vista (con la charla guardada).
      await chatTurn({ ...ctx, attachments: [] }, [...messages, { role: "assistant", text: "Veo un personaje.", at: new Date().toISOString() }, { role: "user", text: "Hazlo más lento", at: new Date().toISOString() }], userId, null, "Hazlo más lento");
      assert.equal(chatRequests.at(-1)!.messages[0]!.content.filter((c) => c.type === "image").length, 2);
    } finally {
      await db.getDb().execute(sql`delete from video_projects where id = ${PROJECT}`);
    }
  });

  test("una pieza de antes de las fichas («none») se analiza: el video vuelve al worker por sus hojas, la charla espera y no se pide dos veces", async () => {
    const { clipStates } = await import("../lib/video/chat-turn");
    const { id } = await upload("reel-viejo.mp4", "video/mp4", Buffer.from("reel de antes de las fichas"));
    await db.getDb().execute(sql`update broll_clips set status = 'READY', duration = 20, width = 1080, height = 1920, ficha_status = 'none', ficha_sheets = null where id = ${id}`);
    try {
      assert.ok((await mod.missingFichaIds()).includes(id), "aparece en «Analizar»");
      // Antes quedaba «failed: No pudimos sacar los cuadros» y la charla nunca lo miraba.
      assert.equal((await clipStates([id]))[0]!.state, "waiting");
      assert.deepEqual(await mod.analyzeMissing([id], userId), { now: [], queued: [id] });
      const row = (await mod.loadClip(id))!;
      assert.equal(row.fichaStatus, "pending");
      const jobs = (await db.getDb().execute<{ input: { clipId: string; fichaOnly?: boolean } }>(sql`select input from jobs where type = 'VIDEO_CLIP' and input->>'clipId' = ${id}`)).rows;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.input.fichaOnly, true, "solo saca las hojas: el clip ya estaba listo");
      assert.deepEqual(await mod.analyzeMissing([id], userId), { now: [], queued: [] }, "ya pedida: no se encola otra vez");
      assert.ok(!(await mod.missingFichaIds()).includes(id));
      // Una imagen sin ficha se escribe enseguida (quien llama corre generateFicha).
      const sharp = (await import("sharp")).default;
      const img = await upload("logo-viejo.png", "image/png", await sharp({ create: { width: 400, height: 400, channels: 3, background: "#2457f5" } }).png().toBuffer());
      await mod.completeClipUpload(img.id, userId);
      await db.getDb().execute(sql`update broll_clips set ficha_status = 'none' where id = ${img.id}`);
      assert.deepEqual(await mod.analyzeMissing([img.id], userId), { now: [img.id], queued: [] });
      await mod.generateFicha(img.id);
      assert.equal((await mod.loadClip(img.id))!.fichaStatus, "ready");
    } finally {
      await db.getDb().execute(sql`delete from jobs where type = 'VIDEO_CLIP' and input->>'clipId' = ${id}`);
    }
  });

  test("la ficha editada a mano queda lista y se puede buscar por lo nuevo", async () => {
    const recep = (await db.getDb().execute<{ id: string }>(sql`select id from broll_clips where file_name = 'clip-recepcion.mp4'`)).rows[0]!.id;
    const f = await mod.updateFicha(recep, { ...clinica.ficha!, description: "Mostrador con una orquídea", moments: [{ start: 0, end: 6, what: "Orquídea sobre el mostrador" }] });
    assert.equal(f.moments.length, 1);
    assert.ok((await mod.searchLibrary("mostradores")).includes(recep));
    await assert.rejects(mod.updateFicha(recep, { description: 1 }));
  });
});
