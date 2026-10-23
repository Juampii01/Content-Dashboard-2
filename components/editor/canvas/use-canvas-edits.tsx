"use client";

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { cleanAnim, cleanTransform, IDENTITY_TRANSFORM, type Anim, type Transform } from "@/lib/video/canvas/transform";
import { cleanCaptionPlacement, placeCaptionBlocks, type CaptionPlacement } from "@/lib/video/canvas/captions";
import { isDefaultEdit, resolveEdit, type BrollEditInput } from "@/lib/video/broll-edit";
import { FX_INFO, FX_MOVABLE } from "@/lib/video/fx/catalog";
import type { FxItem } from "@/lib/video/fx/schema";
import { graphicKindLabel, isMotionScene, setSceneField } from "@/lib/video/motion-graphics";
import type { BrollItem, CaptionBlock, EditPlan } from "@/lib/video/types";
import type { PreviewCanvas } from "../preview-player";
import { movableEffectLabel, parseCanvasId } from "./elements";
import { TransformControls, type ControlsTarget } from "./transform-controls";

/**
 * Estado y cambios del lienzo de la revisión, aparte de la pantalla que lo usa: qué está elegido, el lugar de los
 * subtítulos y cómo se guarda cada cambio (en el b-roll, el efecto o las correcciones). Devuelve lo que se le pasa a la
 * vista previa (`canvas`, `placeBlocks`), los controles del inspector (`controls`) y lo que va en la revisión
 * (`review`).
 */
export function useCanvasEdits({
  canEdit,
  captions,
  brollItems,
  setBrollItems,
  fxItems,
  setFxItems,
  setCorrections,
  wordCount,
  place,
  onPlace,
  selected,
  onSelected,
}: {
  canEdit: boolean;
  /** Los subtítulos del plan guardado (de ahí sale el lugar inicial). */
  captions: EditPlan["captions"];
  brollItems: BrollItem[];
  setBrollItems: Dispatch<SetStateAction<BrollItem[]>>;
  fxItems: FxItem[];
  setFxItems: Dispatch<SetStateAction<FxItem[]>>;
  setCorrections: Dispatch<SetStateAction<Record<string, string>>>;
  wordCount: number;
  /**
   * Opcional: el lugar de los subtítulos y lo elegido los maneja quien usa el hook (el Estudio los guarda en su estado
   * con historial, para deshacer y rehacer). Sin esto, el hook los guarda solo.
   */
  place?: CaptionPlacement;
  onPlace?: Dispatch<SetStateAction<CaptionPlacement>>;
  selected?: string | null;
  onSelected?: (id: string | null) => void;
}) {
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const [ownPlace, setOwnPlace] = useState<CaptionPlacement>(() => cleanCaptionPlacement({ transform: captions.transform, lines: captions.lines }, wordCount));
  const selectedId = selected !== undefined ? selected : ownSelected;
  const setSelectedId = onSelected ?? setOwnSelected;
  const captionPlace = place ?? ownPlace;
  const setCaptionPlace = onPlace ?? setOwnPlace;
  // Los bloques con su lugar (la misma lista mientras no cambien los bloques ni el lugar).
  const placed = useRef<{ src: CaptionBlock[]; place: CaptionPlacement; out: CaptionBlock[] } | null>(null);
  const placeBlocks = useCallback(
    (blocks: CaptionBlock[]) => {
      const hit = placed.current;
      if (hit && hit.src === blocks && hit.place === captionPlace) return hit.out;
      const out = placeCaptionBlocks(blocks, captionPlace);
      placed.current = { src: blocks, place: captionPlace, out };
      return out;
    },
    [captionPlace],
  );
  const target = parseCanvasId(selectedId);

  // ─── Guardar cambios ──────────────────────────────────────────────────────

  const editBroll = useCallback(
    (id: string, patch: (edit: BrollEditInput) => BrollEditInput) =>
      setBrollItems((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          const edit = patch({ ...(b.edit ?? {}) });
          for (const k of Object.keys(edit) as (keyof BrollEditInput)[]) if (edit[k] === undefined) delete edit[k];
          const next = { ...b };
          if (isDefaultEdit(resolveEdit(edit))) delete next.edit;
          else next.edit = edit;
          return next;
        }),
      ),
    [setBrollItems],
  );

  const editFx = useCallback(
    (id: string, patch: (item: FxItem) => FxItem) =>
      setFxItems((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          const next = patch({ ...e });
          if (!next.transform) delete next.transform;
          if (!next.anim) delete next.anim;
          return next;
        }),
      ),
    [setFxItems],
  );

  /** Subtítulos: "Solo esta línea" si esa línea ya tiene lugar propio; si no, todos. */
  const [lineScope, setLineScope] = useState<Record<string, boolean>>({});
  const captionScope = (key: string): "all" | "line" => (lineScope[key] ?? Boolean(captionPlace.lines?.[key]) ? "line" : "all");

  const setCaptionTransform = useCallback(
    (key: string, scope: "all" | "line", t: Transform | undefined) =>
      setCaptionPlace((prev) => {
        if (scope === "line") {
          const lines = { ...(prev.lines ?? {}) };
          if (t) lines[key] = t;
          else delete lines[key];
          return { ...prev, lines: Object.keys(lines).length ? lines : undefined };
        }
        return { ...prev, transform: t && (t.x || t.y || t.scale !== 1) ? t : undefined };
      }),
    [setCaptionPlace],
  );

  const onTransform = useCallback(
    (id: string, next: Transform) => {
      const t = parseCanvasId(id);
      if (!t || !canEdit) return;
      if (t.kind === "graphic") editBroll(t.key, (e) => ({ ...e, transform: cleanTransform(next) }));
      else if (t.kind === "effect") {
        const item = fxItems.find((e) => e.id === t.key);
        const movable = item ? FX_MOVABLE[item.kind] : null;
        if (movable) editFx(t.key, (e) => ({ ...e, transform: cleanTransform(next, { rotation: movable.rotation }) }));
      } else setCaptionTransform(t.key, captionScope(t.key), { x: next.x, y: next.y, scale: next.scale });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, editBroll, editFx, fxItems, setCaptionTransform, lineScope, captionPlace],
  );

  const onAnim = useCallback(
    (id: string, next: Anim | null) => {
      const t = parseCanvasId(id);
      if (!t || !canEdit) return;
      if (t.kind === "graphic") editBroll(t.key, (e) => ({ ...e, anim: next ? cleanAnim(next) : undefined }));
      else if (t.kind === "effect") editFx(t.key, (e) => ({ ...e, anim: next ? cleanAnim(next, { keepDefault: true }) : undefined }));
    },
    [canEdit, editBroll, editFx],
  );

  const onText = useCallback(
    (id: string, textId: string, value: string) => {
      const t = parseCanvasId(id);
      if (!t || !canEdit) return;
      if (t.kind === "graphic") {
        setBrollItems((prev) =>
          prev.map((b) => {
            if (b.id !== t.key || !b.choice || !isMotionScene(b.choice.graphic)) return b;
            return { ...b, choice: { ...b.choice, graphic: setSceneField(b.choice.graphic, textId, value.slice(0, 120)) } };
          }),
        );
      } else if (t.kind === "effect") {
        editFx(t.key, (e) => {
          const info = FX_INFO[e.kind];
          if (textId === "text" && info.text) return { ...e, text: value.slice(0, info.text.max) };
          if (textId === "kicker" && info.kicker) return { ...e, kicker: value.slice(0, info.kicker.max) };
          const m = /^items\.(\d+)$/.exec(textId);
          if (m && info.items) {
            const items = [...(e.items ?? [])];
            const i = Number(m[1]);
            while (items.length <= i) items.push("");
            items[i] = value.slice(0, info.items.max);
            return { ...e, items };
          }
          return e;
        });
      } else {
        // Subtítulos: corrección de esa palabra (vacía = vuelve a la palabra dicha).
        setCorrections((prev) => {
          const next = { ...prev };
          const clean = value.trim().slice(0, 60);
          if (clean) next[textId] = clean;
          else delete next[textId];
          return next;
        });
      }
    },
    [canEdit, setBrollItems, editFx, setCorrections],
  );

  const canvas: PreviewCanvas = useMemo(
    () => ({ selectedId, onSelect: setSelectedId, onTransform, onText, disabled: !canEdit }),
    [selectedId, setSelectedId, onTransform, onText, canEdit],
  );

  // ─── Controles del inspector ─────────────────────────────────────────────

  let controlsTarget: ControlsTarget | null = null;
  if (target?.kind === "graphic") {
    const item = brollItems.find((b) => b.id === target.key);
    if (item?.choice?.graphic) {
      const edit = item.edit ?? {};
      controlsTarget = { id: selectedId!, kind: "graphic", label: `Gráfico · ${graphicKindLabel(item.choice.graphic)}`, transform: cleanTransform(edit.transform) ?? IDENTITY_TRANSFORM, rotatable: true, anim: cleanAnim(edit.anim) ?? null, animatable: true, defaultAnimLabel: "Aparecer (0,2 s)" };
    }
  } else if (target?.kind === "effect") {
    const item = fxItems.find((e) => e.id === target.key);
    const movable = item ? FX_MOVABLE[item.kind] : null;
    if (item && movable)
      controlsTarget = { id: selectedId!, kind: "effect", label: movableEffectLabel(item.kind), transform: cleanTransform(item.transform, { rotation: movable.rotation }) ?? IDENTITY_TRANSFORM, rotatable: movable.rotation, anim: cleanAnim(item.anim, { keepDefault: true }) ?? null, animatable: true, defaultAnimLabel: "la del efecto" };
  } else if (target?.kind === "caption") {
    const scope = captionScope(target.key);
    const t = (scope === "line" ? captionPlace.lines?.[target.key] : undefined) ?? captionPlace.transform ?? IDENTITY_TRANSFORM;
    controlsTarget = { id: selectedId!, kind: "caption", label: scope === "line" ? "Subtítulos · esta línea" : "Subtítulos · todos", transform: t, rotatable: false, anim: null, animatable: false };
  }

  const review = useMemo(() => ({ captionPlace }), [captionPlace]);

  const controls = controlsTarget ? (
    <TransformControls
      target={controlsTarget}
      onTransform={(next) => onTransform(controlsTarget!.id, next)}
      onAnim={(next) => onAnim(controlsTarget!.id, next)}
      onReset={() => {
        const t = parseCanvasId(controlsTarget!.id)!;
        if (t.kind === "graphic") editBroll(t.key, (e) => ({ ...e, transform: undefined, anim: undefined }));
        else if (t.kind === "effect") editFx(t.key, (e) => ({ ...e, transform: undefined, anim: undefined }));
        else setCaptionTransform(t.key, captionScope(t.key), undefined);
      }}
      scope={target?.kind === "caption" ? captionScope(target.key) : undefined}
      onScope={
        target?.kind === "caption"
          ? (scope) => {
              const key = target.key;
              setLineScope((prev) => ({ ...prev, [key]: scope === "line" }));
              // Al pasar a "solo esta línea" arranca desde donde está; al volver a "todos", la línea sigue a los demás.
              if (scope === "line") setCaptionTransform(key, "line", captionPlace.lines?.[key] ?? captionPlace.transform ?? { ...IDENTITY_TRANSFORM });
              else setCaptionTransform(key, "line", undefined);
            }
          : undefined
      }
    />
  ) : null;

  return {
    canvas,
    /** Los bloques de subtítulos con el lugar del lienzo (para la vista previa). */
    placeBlocks,
    controls,
    selectedId,
    select: setSelectedId,
    /** Va en la revisión (lib/video/service.ts → applyReview). */
    review,
  };
}
