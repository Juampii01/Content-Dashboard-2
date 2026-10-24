/**
 * Escribe el caso de la prueba de sincronía del worker (worker/tests/fixtures/sync-plan.json) a partir de
 * tests/video-sync-case.ts. Correr después de cambiar el timeline, los efectos o la entrada del render:
 *   node --import tsx scripts/make-sync-fixture.mts
 */
import { writeFileSync } from "node:fs";
import { syncFixture } from "../tests/video-sync-case";

writeFileSync(new URL("../worker/tests/fixtures/sync-plan.json", import.meta.url), `${JSON.stringify(syncFixture(), null, 1)}\n`);
console.log("listo: worker/tests/fixtures/sync-plan.json");
