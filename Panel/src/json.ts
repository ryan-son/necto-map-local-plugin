//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "./localization";

const CURLY_DOUBLE_QUOTE = /[“”„‟]/;
const CURLY_DOUBLE_QUOTES = /[“”„‟]/g;

export type ReadJSON = { ok: true; value: unknown; text: string } | { ok: false; message: string };

/// macOS turns " into “ ” while typing (the Smart Quotes system setting). Only when the text
/// fails to parse are the quotes straightened and the text read again, and the fixed text is
/// returned so the field shows it too. Text that parses as typed keeps its curly quotes,
/// because inside a string they are content.
export function readJSON(text: string): ReadJSON {
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch (error) {
    const message = (error as Error).message;
    if (!CURLY_DOUBLE_QUOTE.test(text)) return { ok: false, message };
    const straightened = text.replace(CURLY_DOUBLE_QUOTES, '"');
    try {
      return { ok: true, value: JSON.parse(straightened), text: straightened };
    } catch {
      return { ok: false, message: t('{message} — replace curly quotes (“ ”) with straight quotes (")', { message }) };
    }
  }
}

/// True for an object or array that parses as JSON as it is. A rule's JSON body is stored as
/// text, so this tells the editor which mode to open it in.
export function isJSONDocument(text: string): boolean {
  const start = text.trimStart()[0];
  if (start !== "{" && start !== "[") return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/// Indents a JSON object or array sent on one line, for editing. Only the whitespace between
/// tokens changes: the text is never parsed and written again, so numbers past 2^53, key
/// order and repeated keys stay exactly as sent. Anything else comes back as it is: text
/// already on several lines, text that isn't JSON, a bare value, nesting deeper than
/// `indentDepthLimit`, and text that would grow more than fourfold.
const indentDepthLimit = 100;
export function indentJSON(text: string): string {
  if (text.trim().includes("\n") || !isJSONDocument(text)) return text;
  const unit = "  ";
  // Growth is about commas times depth, so a wide and deep body is left as it is.
  const limit = text.length * 4 + 1024;
  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => "\n" + unit.repeat(depth);
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') inString = false;
      continue;
    }
    if (out.length > limit) return text;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") continue;
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      let next = i + 1;
      while (" \t\r\n".includes(text[next])) next += 1;
      if (text[next] === close) {
        out += c + close;
        i = next;
      } else {
        depth += 1;
        if (depth > indentDepthLimit) return text;
        out += c + newline();
      }
    } else if (c === "}" || c === "]") {
      depth -= 1;
      out += newline() + c;
    } else if (c === ",") {
      out += c + newline();
    } else if (c === ":") {
      out += ": ";
    } else {
      out += c;
    }
  }
  return out;
}
