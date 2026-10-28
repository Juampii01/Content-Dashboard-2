"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquare,
  Eye,
  Film,
  Folder,
  FolderInput,
  ImageIcon,
  Loader2,
  RefreshCcw,
  Sparkles,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { ChipGroup, SearchInput } from "@/components/ui/filters";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import type { Ficha, FichaStatus } from "@/lib/video/library-ficha";
import { FichaDialog } from "./library-ficha-dialog";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  analyzeMissingAction,
  deleteClipAction,
  moveClipsAction,
  retryClipAction,
  retryFichaAction,
  searchLibraryAction,
  updateClipAction,
} from "./media-actions";
import {
  LIBRARY_ACCEPT,
  MAX_LIBRARY_FILE,
  uploadToLibrary,
} from "./library-upload";
import {
  DRAG_CLIPS,
  FolderBar,
  MoveDialog,
  type FolderItem,
} from "./library-folders";
import { useAutoRefresh } from "./use-auto-refresh";

export type ClipItem = {
  id: string;
  kind: "video" | "image";
  ficha: Ficha | null;
  fichaStatus: FichaStatus;
  fichaError: string | null;
  title: string;
  tags: string[];
  folderId: string | null;
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  thumbUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  errorMessage: string | null;
  job: { progress: number; stage: string | null } | null;
};

type Uploading = { name: string; pct: number; error?: string };

type KindFilter = "video" | "image";

/**
 * Biblioteca: subir videos e imágenes (varios a la vez), buscarlos por lo que se ve (nombre, etiquetas y ficha), ver y
 * corregir la ficha que escribió la IA, etiquetarlos y borrarlos.
 */
export function LibraryManager({
  clips,
  canEdit,
  folders = [],
}: {
  clips: ClipItem[];
  canEdit: boolean;
  folders?: FolderItem[];
}) {
  const router = useRouter();
  // Carpeta abierta (null = «Todo»: las piezas sin carpeta). La búsqueda mira toda la biblioteca.
  const [folder, setFolderState] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [bulk, startBulk] = useTransition();
  const folderName = useMemo(
    () => new Map(folders.map((f) => [f.id, f.name])),
    [folders],
  );
  const openFolder = (id: string | null) => {
    setFolderState(id && folderName.has(id) ? id : null);
    setSelected(new Set());
  };
  // Si la carpeta abierta se borró, se vuelve a «Todo».
  const current = folder && folderName.has(folder) ? folder : null;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [uploads, setUploads] = useState<Record<string, Uploading>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [kinds, setKinds] = useState<KindFilter[]>([]);
  useAutoRefresh(
    clips.some(
      (c) =>
        c.status === "PROCESSING" ||
        (c.status === "READY" &&
          (c.fichaStatus === "pending" || c.fichaStatus === "thinking")),
    ),
  );

  function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    setSearching(true);
    void searchLibraryAction(q)
      .then((r) => setFound(r.ok && r.data ? r.data.ids : []))
      .finally(() => setSearching(false));
  }

  const visible = useMemo(() => {
    const byKind = clips.filter((c) => !kinds.length || kinds.includes(c.kind));
    if (!found) return byKind.filter((c) => (c.folderId ?? null) === current);
    const rank = new Map(found.map((id, i) => [id, i]));
    return byKind
      .filter((c) => rank.has(c.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }, [clips, kinds, found, current]);
  const counts = {
    video: clips.filter((c) => c.kind === "video").length,
    image: clips.filter((c) => c.kind === "image").length,
  };
  // Las piezas de antes de que hubiera fichas: la IA no sabe qué se ve en ellas hasta analizarlas.
  const missing = clips.filter(
    (c) => c.status === "READY" && c.fichaStatus === "none",
  ).length;
  const [analyzing, startAnalyze] = useTransition();

  function analyzeAll() {
    startAnalyze(async () => {
      const r = await analyzeMissingAction();
      if (!r.ok) toast.error(r.error);
      else
        toast.success(
          r.data?.count
            ? `Analizando ${r.data.count === 1 ? "1 pieza" : `${r.data.count} piezas`}. Tarda 1 o 2 minutos por video.`
            : "No quedan piezas sin ficha.",
        );
      router.refresh();
    });
  }

  async function uploadOne(file: File, tempId: string) {
    try {
      await uploadToLibrary(file, {
        folderId: current,
        onProgress: (pct) =>
          setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct } })),
      });
      setUploads((u) => {
        const next = { ...u };
        delete next[tempId];
        return next;
      });
      router.refresh();
    } catch (e) {
      setUploads((u) => ({
        ...u,
        [tempId]: {
          name: file.name,
          pct: 0,
          error:
            e instanceof Error && /[áéíóú]|subida|archivo/i.test(e.message)
              ? e.message
              : "La subida falló. Vuelve a intentarlo.",
        },
      }));
    }
  }

  function onFiles(files: File[]) {
    for (const file of files.slice(0, 20)) {
      const tempId = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: 0 } }));
      void uploadOne(file, tempId);
    }
  }

  const pending = Object.entries(uploads);
  return (
    <div className="flex flex-col gap-6">
      {canEdit && (
        <div className="flex flex-col gap-3">
          <UploadDropzone
            accept={LIBRARY_ACCEPT}
            acceptLabel="clips MP4, MOV, WEBM o MKV, o imágenes JPG, PNG o WebP"
            maxSize={MAX_LIBRARY_FILE}
            multiple
            onFiles={onFiles}
            title="Arrastra tus clips e imágenes"
            hint="Tomas tuyas y fotos que se repiten en tus videos: tu oficina, tu equipo, tu producto, tu logo. La IA mira cada una y escribe su ficha para usarla donde encaja."
          />
          {pending.length > 0 && (
            <ul
              className="grid gap-2 sm:grid-cols-2"
              aria-label="Subidas en curso"
            >
              {pending.map(([id, u]) => (
                <li key={id} className="card flex flex-col gap-2 p-3">
                  {u.error ? (
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-danger">
                        <span className="font-semibold">{u.name}:</span>{" "}
                        {u.error}
                      </p>
                      <button
                        type="button"
                        className="grid h-6 w-6 flex-none place-items-center rounded-md text-muted hover:bg-white/10"
                        aria-label={`Quitar el aviso de ${u.name}`}
                        onClick={() =>
                          setUploads((all) => {
                            const next = { ...all };
                            delete next[id];
                            return next;
                          })
                        }
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <Progress value={u.pct} label={`Subiendo ${u.name}`} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canEdit && missing > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-text">
            <span className="font-semibold text-white">
              {missing === 1
                ? "1 pieza sin ficha"
                : `${missing} piezas sin ficha`}
              .
            </span>{" "}
            La IA todavía no sabe qué se ve en{" "}
            {missing === 1 ? "ella" : "ellas"}: analízalas para que el chat, el
            b-roll y el director las usen bien.
          </p>
          <Button
            size="sm"
            disabled={analyzing}
            icon={
              analyzing ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )
            }
            onClick={analyzeAll}
          >
            {missing === 1 ? "Analizar" : `Analizar ${Math.min(missing, 30)}`}
          </Button>
        </div>
      )}
      {clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={query}
            onChange={search}
            label="Buscar en tu biblioteca"
            placeholder="Busca por lo que se ve: manos, teléfono, oficina de noche…"
            className="min-w-[16rem] flex-1"
          />
          <ChipGroup<KindFilter>
            label="Tipo"
            value={kinds}
            onChange={setKinds}
            options={[
              {
                value: "video",
                label: "Videos",
                count: counts.video,
                icon: <Film className="h-3.5 w-3.5" aria-hidden />,
              },
              {
                value: "image",
                label: "Imágenes",
                count: counts.image,
                icon: <ImageIcon className="h-3.5 w-3.5" aria-hidden />,
              },
            ]}
          />
          {searching && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted motion-reduce:animate-none"
              aria-label="Buscando"
            />
          )}
        </div>
      )}
      {!found && (folders.length > 0 || canEdit) && (
        <FolderBar
          folders={folders}
          current={current}
          onOpen={openFolder}
          canEdit={canEdit}
          rootCount={clips.filter((c) => !c.folderId).length}
        />
      )}
      {found && (
        <p className="text-xs text-muted">
          Buscando en toda la biblioteca, en todas las carpetas.
        </p>
      )}
      {canEdit && selected.size > 0 && (
        <div
          className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-card/95 p-2 pl-4 shadow-lg backdrop-blur"
          role="toolbar"
          aria-label="Piezas elegidas"
        >
          <span className="text-sm font-semibold text-white">
            {selected.size === 1 ? "1 elegida" : `${selected.size} elegidas`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set(visible.map((c) => c.id)))}
          >
            Elegir todas
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            disabled={bulk}
            icon={<FolderInput className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => setMoving(true)}
          >
            Mover a…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            aria-label="Quitar la selección"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      )}
      {clips.length > 0 && visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-muted">
          {found
            ? `Nada en tu biblioteca coincide con «${query}». Prueba con otra palabra.`
            : current
              ? "Esta carpeta está vacía. Sube piezas aquí o arrastra piezas sobre su nombre."
              : kinds.length
                ? "No hay piezas de ese tipo aquí."
                : "Todas tus piezas están dentro de carpetas."}
        </p>
      )}
      {visible.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.map((c) => (
            <li
              key={c.id}
              draggable={canEdit}
              onDragStart={(e) => {
                const ids = selected.has(c.id) ? [...selected] : [c.id];
                e.dataTransfer.setData(DRAG_CLIPS, JSON.stringify(ids));
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <ClipCard
                clip={c}
                canEdit={canEdit}
                selected={selected.has(c.id)}
                onToggle={canEdit ? () => toggle(c.id) : undefined}
                folderLabel={
                  found && c.folderId
                    ? (folderName.get(c.folderId) ?? null)
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
      <MoveDialog
        open={moving}
        title={
          selected.size === 1
            ? "Mover la pieza a…"
            : `Mover ${selected.size} piezas a…`
        }
        folders={folders}
        exclude={new Set()}
        current={found ? undefined : current}
        onClose={() => setMoving(false)}
        busy={bulk}
        onPick={(target) =>
          startBulk(async () => {
            const r = await moveClipsAction([...selected], target);
            if (!r.ok) return void toast.error(r.error);
            toast.success(
              r.data?.moved === 1
                ? "Pieza movida."
                : `${r.data?.moved ?? 0} piezas movidas.`,
            );
            setMoving(false);
            setSelected(new Set());
            router.refresh();
          })
        }
      />
    </div>
  );
}

function ClipCard({
  clip,
  canEdit,
  selected = false,
  onToggle,
  folderLabel = null,
}: {
  clip: ClipItem;
  canEdit: boolean;
  selected?: boolean;
  onToggle?: () => void;
  folderLabel?: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(clip.title);
  const [tags, setTags] = useState(clip.tags);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [showFicha, setShowFicha] = useState(false);
  // La ficha guardada desde el diálogo se ve enseguida; si no, la que llega del servidor (se refresca sola).
  const [edited, setFicha] = useState<Ficha | null>(null);
  const ficha = edited ?? clip.ficha;
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const vertical = (clip.height ?? 16) >= (clip.width ?? 9);

  function save(next: { title?: string; tags?: string[] }) {
    start(async () => {
      const r = await updateClipAction(clip.id, next);
      if (!r.ok) toast.error(r.error);
    });
  }

  function addTag() {
    const t = draft.trim().toLowerCase();
    if (t.length < 2 || tags.includes(t) || tags.length >= 12) {
      setDraft("");
      return;
    }
    const next = [...tags, t.slice(0, 30)];
    setTags(next);
    setDraft("");
    save({ tags: next });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !draft && tags.length) {
      const next = tags.slice(0, -1);
      setTags(next);
      save({ tags: next });
    }
  }

  return (
    <article
      className={cn(
        "card flex h-full flex-col overflow-hidden transition-shadow",
        selected && "ring-2 ring-accent",
      )}
    >
      <div className="group relative aspect-video w-full overflow-hidden bg-black/50">
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={selected}
            aria-label={
              selected
                ? `Quitar ${clip.title} de la selección`
                : `Elegir ${clip.title}`
            }
            className={cn(
              "absolute top-2 right-2 z-10 grid h-7 w-7 place-items-center rounded-md bg-black/60 text-paper transition-opacity focus-visible:opacity-100",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {selected ? (
              <CheckSquare className="h-4 w-4" aria-hidden />
            ) : (
              <Square className="h-4 w-4" aria-hidden />
            )}
          </button>
        )}
        {folderLabel && (
          <span className="absolute bottom-2 left-2 z-10 inline-flex max-w-[70%] items-center gap-1 truncate rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] text-paper">
            <Folder className="h-3 w-3 flex-none" aria-hidden /> {folderLabel}
          </span>
        )}
        {clip.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clip.thumbUrl}
            alt=""
            className={cn(
              "h-full w-full",
              vertical ? "object-contain" : "object-cover",
            )}
            loading="lazy"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-placeholder">
            {clip.kind === "image" ? (
              <ImageIcon className="h-7 w-7" aria-hidden />
            ) : (
              <Film className="h-7 w-7" aria-hidden />
            )}
          </span>
        )}
        <span className="absolute top-2 left-2">
          {clip.status === "READY" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-paper">
              {clip.kind === "image" ? (
                <>
                  <ImageIcon className="h-3 w-3" aria-hidden /> Imagen
                </>
              ) : (
                formatDuration(clip.duration)
              )}
            </span>
          ) : (
            <StatusBadge tone={clip.status === "FAILED" ? "danger" : "info"}>
              {clip.status === "FAILED"
                ? "Con error"
                : clip.status === "UPLOADING"
                  ? "Subida incompleta"
                  : "Preparando"}
            </StatusBadge>
          )}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {clip.status === "PROCESSING" && (
          <Progress
            value={clip.job?.progress ?? 0}
            label={clip.job?.stage ?? "En cola"}
          />
        )}
        {clip.status === "FAILED" && (
          <p className="text-xs text-danger">
            {clip.errorMessage ?? "No pudimos preparar el clip."}
          </p>
        )}
        {clip.status === "READY" && (
          <FichaLine
            clip={{ ...clip, ficha }}
            canEdit={canEdit}
            busy={pending}
            onOpen={() => setShowFicha(true)}
            onRetry={() =>
              start(async () => {
                const r = await retryFichaAction(clip.id);
                if (!r.ok) toast.error(r.error);
                router.refresh();
              })
            }
          />
        )}
        <label className="sr-only" htmlFor={`clip-title-${clip.id}`}>
          Nombre del clip
        </label>
        <input
          id={`clip-title-${clip.id}`}
          className="field !h-9 !text-sm font-semibold"
          value={title}
          maxLength={120}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== clip.title && save({ title })}
        />
        <div
          className="field flex min-h-10 !h-auto flex-wrap items-center gap-1.5 !py-1.5"
          onClick={() => input.current?.focus()}
          role="group"
          aria-label="Etiquetas del clip"
        >
          <Tag className="h-3.5 w-3.5 flex-none text-placeholder" aria-hidden />
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 py-0.5 pr-1 pl-2 text-xs text-accent-glow"
            >
              {t}
              {canEdit && (
                <button
                  type="button"
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-white/15"
                  aria-label={`Quitar la etiqueta ${t}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = tags.filter((x) => x !== t);
                    setTags(next);
                    save({ tags: next });
                  }}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => draft.trim() && addTag()}
              placeholder={
                tags.length ? "Agregar…" : "Agrega etiquetas: oficina, equipo…"
              }
              aria-label="Nueva etiqueta (Enter para agregar)"
              className="min-w-[6rem] flex-1 bg-transparent text-xs text-text outline-none placeholder:text-placeholder"
            />
          )}
        </div>
        {canEdit && (
          <div className="mt-auto flex items-center justify-end gap-2">
            {clip.status === "FAILED" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />}
                onClick={() =>
                  start(async () => {
                    await retryClipAction(clip.id);
                    router.refresh();
                  })
                }
              >
                Reintentar
              </Button>
            )}
            <Button
              size="sm"
              variant="subtle"
              icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => setConfirm(true)}
              aria-label={`Borrar ${clip.title}`}
            >
              Borrar
            </Button>
          </div>
        )}
      </div>
      {showFicha && (
        <FichaDialog
          open={showFicha}
          onOpenChange={setShowFicha}
          clip={{
            id: clip.id,
            title: clip.title,
            kind: clip.kind,
            duration: clip.duration,
            ficha,
          }}
          canEdit={canEdit}
          onSaved={setFicha}
        />
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={
          clip.kind === "image" ? "¿Borrar esta imagen?" : "¿Borrar este clip?"
        }
        description="Los videos ya renderizados no cambian. En los que estás revisando, este b-roll deja de estar disponible."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending}
              className="!bg-danger/90 ![background-image:none]"
              onClick={() =>
                start(async () => {
                  const r = await deleteClipAction(clip.id);
                  if (!r.ok) toast.error(r.error);
                  else {
                    setConfirm(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending
                ? "Borrando…"
                : clip.kind === "image"
                  ? "Borrar imagen"
                  : "Borrar clip"}
            </Button>
          </>
        }
      />
    </article>
  );
}

/** Estado de la ficha en la tarjeta: lo que vio la IA (con «Ver ficha»), que la está escribiendo, o el aviso para reintentar. */
function FichaLine({
  clip,
  canEdit,
  busy,
  onOpen,
  onRetry,
}: {
  clip: ClipItem;
  canEdit: boolean;
  busy: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const st = clip.fichaStatus;
  if (st === "pending" || st === "thinking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden
        />{" "}
        La IA está mirando {clip.kind === "image" ? "la imagen" : "el clip"}…
      </p>
    );
  }
  if (st === "ready" && clip.ficha) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="line-clamp-2 text-xs text-text">
          {clip.ficha.description || "Ficha sin descripción."}
        </p>
        <div className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            {clip.ficha.colors.slice(0, 5).map((c) => (
              <span
                key={c}
                className="h-3.5 w-3.5 rounded-full border border-white/10"
                style={{
                  background: /^#[0-9a-f]{6}$/i.test(c) ? c : undefined,
                }}
              />
            ))}
          </span>
          {clip.kind === "video" && clip.ficha.moments.length > 0 && (
            <span className="text-[11px] text-muted">
              {clip.ficha.moments.length === 1
                ? "1 momento"
                : `${clip.ficha.moments.length} momentos`}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            icon={<Eye className="h-3.5 w-3.5" aria-hidden />}
            onClick={onOpen}
          >
            Ver ficha
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-2">
      <p
        className={cn(
          "text-xs",
          st === "failed" ? "text-danger" : "text-muted",
        )}
      >
        {st === "failed"
          ? (clip.fichaError ?? "No pudimos escribir la ficha.")
          : "Todavía sin ficha: la IA no sabe qué se ve."}
      </p>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          icon={
            st === "failed" ? (
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )
          }
          onClick={onRetry}
        >
          {st === "failed" ? "Reintentar" : "Analizar"}
        </Button>
      )}
    </div>
  );
}
