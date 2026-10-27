/**
 * Revisión estática del código de una composición (antes de guardarlo y antes de correrlo): se parsea con acorn y se
 * recorre el árbol. Solo pasa un módulo con `export default { … }`, declaraciones de funciones y constantes, sin
 * import, sin acceso a globales fuera de una lista blanca y sin las puertas de escape conocidas (constructor,
 * __proto__, prototype, eval, Function…). Es la primera barrera: la segunda es el sandbox (vm sin generación de código
 * en Node; Web Worker sin red en el navegador) y la tercera, que la lista de dibujo se vuelve a validar al dibujarla.
 *
 * `prepareModule` devuelve el cuerpo listo para el sandbox: el `export default` pasa a ser una asignación.
 */
import { parse, type Node } from "acorn";
import { COMPOS_LIMITS } from "./contract";

/** Globales que puede usar el código (todo lo demás está prohibido). */
const ALLOWED_GLOBALS = new Set([
  "Math",
  "Number",
  "String",
  "Array",
  "Object",
  "Boolean",
  "JSON",
  "Map",
  "Set",
  "WeakMap",
  "Infinity",
  "NaN",
  "undefined",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "Float32Array",
  "Float64Array",
  "Uint8Array",
  "Int32Array",
  "RegExp",
  "Error",
  "Symbol",
  "console",
]);

/** Nombres que nunca se pueden usar (ni como variable ni como propiedad). */
const FORBIDDEN_NAMES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "caller",
  "callee",
  "arguments",
  "globalThis",
  "self",
  "window",
  "global",
  "process",
  "require",
  "module",
  "exports",
  "Function",
  "eval",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "importScripts",
  "postMessage",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "Promise",
  "Reflect",
  "Proxy",
  "WebAssembly",
  "SharedArrayBuffer",
  "Atomics",
  "Date",
  "performance",
  "navigator",
  "location",
  "document",
  "indexedDB",
  "caches",
  "localStorage",
  "sessionStorage",
  "__compos",
  "__exports",
]);

export type StaticIssue = { message: string; line: number | null };

type AnyNode = Node & Record<string, unknown>;

function walk(node: AnyNode, visit: (n: AnyNode, parent: AnyNode | null, key: string) => void, parent: AnyNode | null = null, key = "") {
  visit(node, parent, key);
  for (const [k, v] of Object.entries(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c === "object" && typeof (c as AnyNode).type === "string") walk(c as AnyNode, visit, node, k);
    } else if (v && typeof v === "object" && typeof (v as AnyNode).type === "string") walk(v as AnyNode, visit, node, k);
  }
}

/** Nombres declarados en cualquier parte (variables, parámetros, funciones, catch, destructuración). */
function declaredNames(ast: AnyNode): Set<string> {
  const out = new Set<string>();
  const addPattern = (p: AnyNode | null | undefined) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier":
        out.add(p.name as string);
        break;
      case "ObjectPattern":
        for (const prop of p.properties as AnyNode[]) addPattern(prop.type === "RestElement" ? (prop.argument as AnyNode) : (prop.value as AnyNode));
        break;
      case "ArrayPattern":
        for (const el of p.elements as (AnyNode | null)[]) addPattern(el);
        break;
      case "RestElement":
        addPattern(p.argument as AnyNode);
        break;
      case "AssignmentPattern":
        addPattern(p.left as AnyNode);
        break;
    }
  };
  walk(ast, (n) => {
    if (n.type === "VariableDeclarator") addPattern(n.id as AnyNode);
    else if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      if (n.id) addPattern(n.id as AnyNode);
      for (const p of n.params as AnyNode[]) addPattern(p);
    } else if (n.type === "CatchClause") addPattern(n.param as AnyNode | null);
    else if (n.type === "ClassDeclaration" && n.id) addPattern(n.id as AnyNode);
  });
  return out;
}

const lineAt = (code: string, pos: number) => code.slice(0, pos).split("\n").length;

/** ¿Es una referencia a una variable (no la clave de un objeto ni el nombre de una propiedad)? */
function isReference(n: AnyNode, parent: AnyNode | null, key: string): boolean {
  if (!parent) return true;
  if ((parent.type === "MemberExpression" && key === "property" && !parent.computed) || (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand)) return false;
  if ((parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && key === "key" && !parent.computed) return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") return false;
  return true;
}

export function checkStatic(code: string): { ok: true; body: string } | { ok: false; issues: StaticIssue[] } {
  const issues: StaticIssue[] = [];
  const add = (message: string, pos: number | null) => issues.push({ message, line: pos == null ? null : lineAt(code, pos) });
  if (typeof code !== "string" || !code.trim()) return { ok: false, issues: [{ message: "El código está vacío.", line: null }] };
  // El tope de una pieza única («Animar todo»); las de un tramo quedan muy por debajo.
  if (code.length > COMPOS_LIMITS.longCodeChars) return { ok: false, issues: [{ message: `El código es demasiado largo (${code.length} caracteres; máximo ${COMPOS_LIMITS.longCodeChars}).`, line: null }] };
  let ast: AnyNode;
  try {
    ast = parse(code, { ecmaVersion: 2022, sourceType: "module", locations: false }) as unknown as AnyNode;
  } catch (error) {
    const e = error as { message?: string; pos?: number };
    return { ok: false, issues: [{ message: `No se puede leer el código: ${String(e.message ?? error).slice(0, 200)}`, line: typeof e.pos === "number" ? lineAt(code, e.pos) : null }] };
  }

  // Nivel superior: solo declaraciones y un export default.
  let exportDefault: AnyNode | null = null;
  for (const stmt of ast.body as AnyNode[]) {
    if (stmt.type === "ExportDefaultDeclaration") {
      if (exportDefault) add("Hay más de un export default.", stmt.start);
      exportDefault = stmt;
      const d = stmt.declaration as AnyNode;
      if (d.type !== "ObjectExpression" && d.type !== "Identifier") add("El export default tiene que ser un objeto: export default { render(ctx, t, env) { … } }.", d.start);
    } else if (stmt.type === "ImportDeclaration" || stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportAllDeclaration") add("No se puede importar ni exportar otra cosa: solo export default { … }.", stmt.start);
    else if (stmt.type !== "VariableDeclaration" && stmt.type !== "FunctionDeclaration" && stmt.type !== "EmptyStatement") add("En el nivel superior solo van const, let, function y el export default (el dibujo va dentro de render).", stmt.start);
  }
  if (!exportDefault) add("Falta el export default { render(ctx, t, env) { … } }.", null);

  const declared = declaredNames(ast);
  walk(ast, (n, parent, key) => {
    switch (n.type) {
      case "Identifier": {
        const name = n.name as string;
        if (FORBIDDEN_NAMES.has(name)) {
          add(`No se puede usar «${name}».`, n.start);
          break;
        }
        if (isReference(n, parent, key) && !declared.has(name) && !ALLOWED_GLOBALS.has(name)) add(`«${name}» no existe (no se pueden usar globales: todo viene en ctx y env).`, n.start);
        break;
      }
      case "Literal":
        if (typeof n.value === "string" && parent?.type === "MemberExpression" && parent.computed && FORBIDDEN_NAMES.has(n.value)) add(`No se puede usar «${n.value}».`, n.start);
        if (n.regex && String((n.regex as { pattern: string }).pattern).length > 200) add("Expresión regular demasiado larga.", n.start);
        break;
      case "TemplateLiteral":
        if (parent?.type === "MemberExpression" && parent.computed) add("No se puede acceder a propiedades con plantillas de texto.", n.start);
        break;
      case "ImportExpression":
        add("No se puede importar nada.", n.start);
        break;
      case "MetaProperty":
        add("No se puede usar import.meta ni new.target.", n.start);
        break;
      case "AwaitExpression":
      case "YieldExpression":
        add("render es síncrono: nada de async, await ni generadores.", n.start);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (n.async || n.generator) add("render es síncrono: nada de async, await ni generadores.", n.start);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        add("No uses clases: usa funciones y objetos.", n.start);
        break;
      case "WithStatement":
      case "DebuggerStatement":
        add("No se puede usar with ni debugger.", n.start);
        break;
      case "TaggedTemplateExpression":
        add("No se pueden usar plantillas con etiqueta.", n.start);
        break;
      case "ThisExpression":
        // Dentro de render, `this` es el módulo: se permite solo como `this.algo` (atajo a sus propias funciones).
        if (!(parent?.type === "MemberExpression" && key === "object")) add("Usa `this` solo como this.nombre (o mejor, funciones declaradas).", n.start);
        break;
    }
  });

  if (issues.length) return { ok: false, issues: issues.slice(0, 12) };
  const d = exportDefault!;
  const body = `${code.slice(0, d.start)}__exports.default = ${code.slice((d.declaration as AnyNode).start)}`;
  return { ok: true, body };
}

/** El script que corre el sandbox con el cuerpo preparado (función estricta: las declaraciones quedan locales). */
export function moduleScript(body: string): string {
  return `__compos.define((function (__exports) {\n"use strict";\n${body}\n;return __exports.default;\n})({}));`;
}

/** Línea del código original a partir de la del script (moduleScript agrega dos líneas arriba). */
export const sourceLine = (scriptLine: number | null) => (scriptLine == null ? null : Math.max(1, scriptLine - 2));
