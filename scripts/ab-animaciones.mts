/**
 * Prueba A/B del código de las animaciones: los mismos 10 pedidos escritos por Opus 5.5 y por Sonnet 5.5, con el mismo
 * prompt, el mismo razonamiento (bajo) y el mismo tope de tokens que el taller (lib/video/compos/work.ts). Para cada
 * uno guarda el código, si pasa la validación del sandbox, el costo (de api_usage, con los precios oficiales) y una hoja
 * de cuadros dibujada con el mismo motor que el worker. Al final arma un informe HTML lado a lado.
 *
 * NO cambia el modelo de la app: solo mide. Gasta IA de verdad (unos USD 5 entre los 20 pedidos).
 *
 *   DATABASE_URL=postgres://… (una base de PRUEBA, para api_usage)  ANTHROPIC_API_KEY=sk-ant-…  \
 *   node --conditions=react-server --import tsx scripts/ab-animaciones.mts <carpeta de salida> [--solo 3]
 *
 * La clave va solo por variable de entorno (nunca en archivos).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sql } from "drizzle-orm";

const args = process.argv.slice(2);
const out = args[0] ?? "/tmp/ab-animaciones";
const solo = args.includes("--solo") ? Number(args[args.indexOf("--solo") + 1]) : 10;
if (!process.env.ANTHROPIC_API_KEY && process.env.AI_FAKE !== "1") throw new Error("Falta ANTHROPIC_API_KEY (por variable de entorno).");
mkdirSync(out, { recursive: true });

const { generateStructured, withAiScope } = await import("../lib/ai/client");
const { getDb } = await import("../lib/db");
const { COMPOS_RULES, composCodeTask, composCodeWireSchema } = await import("../lib/ai/prompts/compos");
const { languageRules } = await import("../lib/ai/language");
const { COMPOS_SAMPLES } = await import("../lib/video/compos/samples");

/** Los pedidos: variados y parecidos a los reales (textos, gráficos, listas, comparaciones, ir detrás de la persona). */
const PEDIDOS = [
  "Título grande «EL ERROR QUE ME COSTÓ CARO» que entra letra por letra arriba de la cara, con un subrayado que se dibuja cuando dice «dinero».",
  "Contador de dinero que baja de $10.000 a $0 en rojo mientras habla, como si se perdiera, con monedas que caen.",
  "Checklist de 3 pasos que aparecen uno por uno con un tilde verde cuando dice «tres pasos».",
  "Texto «3 PASOS» enorme DETRÁS de la persona (ella adelante), con un leve zoom.",
  "Gráfico de barras que crece de izquierda a derecha y una flecha hacia arriba al final, estilo dashboard limpio.",
  "Pantalla dividida: arriba un cartel «ANTES» gris y abajo «DESPUÉS» con el color de la marca, que se cruzan en el medio.",
  "Notificación de celular que baja desde arriba con el texto «Perdiste $3.200 este mes» y vibra un poco.",
  "Palabras clave del texto que aparecen sueltas alrededor de la persona y se acomodan en una frase al final.",
  "Mapa simple de Latinoamérica dibujado con líneas y un punto que pulsa en Argentina con la etiqueta «aquí empecé».",
  "Cierre: logo de la marca con un círculo que se dibuja y el texto «SÍGUEME PARA MÁS» con rebote suave.",
].slice(0, solo);

const MODELOS = [
  { key: "opus", model: "deep" as const, label: "Opus 5.5" },
  { key: "sonnet", model: "main" as const, label: "Sonnet 5.5" },
];

// La misma frase y duración que scripts/compos-stills.mts (así los cuadros coinciden con lo que dice la persona).
const sentence = "Te voy a contar el error que más dinero me hizo perder este año y cómo lo arreglé en solo tres pasos simples";
const parts = sentence.split(" ");
const duration = 3.6;
const step = (duration - 0.4) / parts.length;
const words = parts.map((text, i) => `${text}@${(0.2 + i * step).toFixed(2)}`).join(" ");
// La marca vacía (lo mismo que arma brandContext sin perfil): los dos modelos reciben exactamente lo mismo.
const context = `${COMPOS_RULES}\n\nMARCA: todavía no hay perfil de marca. Escribe para un creador de contenido latino que vende un servicio o infoproducto.\n${languageRules("es-neutro")}`;

type Row = { pedido: number; modelo: string; ok: boolean; error: string | null; usd: number; segundos: number; tokensSalida: number; sheet: string | null };
const rows: Row[] = [];

for (const [i, brief] of PEDIDOS.entries()) {
  for (const m of MODELOS) {
    const requestId = `ab:${m.key}:${i + 1}:${Date.now()}`;
    const t0 = Date.now();
    let code: string | null = null;
    let params: unknown[] = [];
    let error: string | null = null;
    try {
      const wire = await withAiScope(
        null,
        () =>
          generateStructured({
            feature: "video.compos.codigo",
            model: m.model,
            thinking: { effort: "low" },
            context,
            task: composCodeTask({ brief, said: sentence, words, duration, format: "9:16", width: 1080, height: 1920, face: "x 676, y 648, ancho 528, alto 644", refFrames: 0 }),
            schema: composCodeWireSchema,
            maxTokens: 32000,
            timeoutMs: 540_000,
            // Solo para probar el script sin gastar (AI_FAKE=1): una muestra de la biblioteca como respuesta.
            fake: () => { const smp = COMPOS_SAMPLES[i % COMPOS_SAMPLES.length]!; return { name: smp.name, why: "simulado", code: smp.code, params: smp.params, sounds: smp.sounds, hide_captions: smp.hide_captions, tags: smp.tags }; },
          }),
        { requestId },
      );
      code = wire.code;
      params = wire.params;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const segundos = (Date.now() - t0) / 1000;
    const usage = await getDb().execute<{ usd: number; out: number }>(sql`select coalesce(sum(cost_usd),0)::float usd, coalesce(sum(output_tokens),0)::int out from api_usage where request_id = ${requestId}`);
    let sheet: string | null = null;
    let ok = false;
    if (code) {
      const file = join(out, `${i + 1}-${m.key}.js`);
      writeFileSync(file, code);
      const paramsFile = join(out, `${i + 1}-${m.key}.params.json`);
      writeFileSync(paramsFile, JSON.stringify(params));
      const dir = join(out, `${i + 1}-${m.key}`);
      try {
        const log = execFileSync("node", ["--import", "tsx", "scripts/compos-stills.mts", dir, "--file", file, "--params", paramsFile], { encoding: "utf8", timeout: 180_000 });
        ok = /^archivo ok/m.test(log);
        if (!ok) error = log.split("\n").find((l) => l.startsWith("archivo"))?.slice(0, 300) ?? "no pasó la validación";
        const png = join(dir, "archivo-9x16.png");
        if (existsSync(png)) sheet = png;
      } catch (e) {
        error = `no se pudo dibujar: ${e instanceof Error ? e.message.slice(0, 200) : e}`;
      }
    }
    const row = { pedido: i + 1, modelo: m.label, ok, error, usd: Number(usage.rows[0]?.usd ?? 0), segundos, tokensSalida: Number(usage.rows[0]?.out ?? 0), sheet };
    rows.push(row);
    console.log(`${row.pedido} ${row.modelo}: ${ok ? "ok" : "FALLA"} · USD ${row.usd.toFixed(3)} · ${segundos.toFixed(0)} s${error ? ` · ${error}` : ""}`);
  }
}

const sum = (label: string) => {
  const r = rows.filter((x) => x.modelo === label);
  return { usd: r.reduce((n, x) => n + x.usd, 0), ok: r.filter((x) => x.ok).length, n: r.length, seg: r.reduce((n, x) => n + x.segundos, 0) / Math.max(1, r.length) };
};
const img = (p: string | null) => (p ? `<img src="data:image/png;base64,${readFileSync(p).toString("base64")}" alt="">` : `<div class="sin">Sin cuadros</div>`);
const html = `<!doctype html><meta charset="utf-8"><title>A/B animaciones · Opus vs Sonnet</title>
<style>body{font:14px system-ui;margin:24px;color:#16171b;background:#f6f6f4}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e7e6e2;padding:8px;vertical-align:top;background:#fff}img{width:100%}.sin{padding:40px;text-align:center;color:#6a6e75}.ko{color:#c0362c}.okk{color:#1f7a4d}</style>
<h1>A/B del código de las animaciones</h1>
<p>Mismo prompt, razonamiento bajo y tope de 32.000 tokens. Costos de api_usage con los precios oficiales.</p>
<table><tr><th></th>${MODELOS.map((m) => { const s = sum(m.label); return `<th>${m.label}<br>USD ${s.usd.toFixed(2)} en total · ${s.ok}/${s.n} pasan la validación · ${s.seg.toFixed(0)} s promedio</th>`; }).join("")}</tr>
${PEDIDOS.map((p, i) => `<tr><td style="width:18%"><b>${i + 1}.</b> ${p}</td>${MODELOS.map((m) => { const r = rows.find((x) => x.pedido === i + 1 && x.modelo === m.label)!; return `<td><p class="${r.ok ? "okk" : "ko"}">${r.ok ? "Pasa" : "Falla"} · USD ${r.usd.toFixed(3)} · ${r.segundos.toFixed(0)} s · ${r.tokensSalida} tokens de salida${r.error ? `<br>${r.error.replace(/</g, "&lt;")}` : ""}</p>${img(r.sheet)}</td>`; }).join("")}</tr>`).join("\n")}
</table>`;
writeFileSync(join(out, "informe.html"), html);
writeFileSync(join(out, "resultados.json"), JSON.stringify(rows, null, 1));
console.log(`Informe: ${join(out, "informe.html")}`);
process.exit(0);
