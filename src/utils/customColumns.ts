// Persistence layer for request-table custom columns.
//
// Users can add columns by specifying an expression like:
//   reqheader:X-Trace          -> value of the "X-Trace" request header
//   resheader:Content-Encoding -> value of the "Content-Encoding" response header
//   reqcookie:sessionid        -> value of the "sessionid" request cookie
//
// Stored in localStorage under the given key, typed as CustomColumn[].

import type { HarHeader, HarCookie, ParsedEntry } from '@/types/har';

export interface CustomColumn {
  id: string;             // stable unique id
  label: string;          // visible column header
  expression: string;     // the user-entered expression
}

const STORAGE_KEY = 'har-viewer-custom-columns';

export function loadCustomColumns(key = STORAGE_KEY): CustomColumn[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(c => c.id && c.label && c.expression);
  } catch {
    return [];
  }
}

export function saveCustomColumns(columns: CustomColumn[], key = STORAGE_KEY): void {
  localStorage.setItem(key, JSON.stringify(columns));
}

export function addCustomColumn(columns: CustomColumn[], label: string, expression: string): CustomColumn[] {
  const column: CustomColumn = {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    expression
  };
  return [...columns, column];
}

export function removeCustomColumn(columns: CustomColumn[], columnId: string): CustomColumn[] {
  return columns.filter(c => c.id !== columnId);
}

// Evaluates a custom column expression against a ParsedEntry and returns the
// display value as a string.
//
// Supported expressions:
//   reqheader:name          -> value of the named request header
//   resheader:name          -> value of the named response header
//   reqcookie:name          -> value of the named request cookie
//   rescookie:name          -> value of the named response cookie
//   reqheader:name=val      -> same as above; everything after = is ignored
export function evaluateCustomColumn(column: CustomColumn, entry: ParsedEntry): string {
  const expr = column.expression.trim().toLowerCase();
  return getValueFromExpression(expr, entry) ?? '';
}

type HeaderCookieSide = 'reqHeader' | 'resHeader' | 'reqCookie' | 'resCookie';

function getList(entry: ParsedEntry, side: HeaderCookieSide): (HarHeader | HarCookie)[] {
  switch (side) {
    case 'reqHeader': return entry.request.headers || [];
    case 'resHeader': return entry.response.headers || [];
    case 'reqCookie': return entry.request.cookies || [];
    case 'resCookie': return entry.response.cookies || [];
    default: return [];
  }
}

function normalizeSide(raw: string): HeaderCookieSide {
  // raw is lowercased (e.g. "reqheader"). Convert to camelCase matching
  // the HeaderCookieSide union: 'reqHeader' | 'resHeader' | 'reqCookie' | 'resCookie'.
  const camel = raw.replace(/(header|cookie)/i, m => m.charAt(0).toUpperCase() + m.slice(1));
  return camel as HeaderCookieSide;
}

function getValueFromExpression(expr: string, entry: ParsedEntry): string | null {
  const headerMatch = /^(reqheader|resheader|reqcookie|rescookie):(.+)$/i.exec(expr);
  if (!headerMatch) return null;

  const side = normalizeSide(headerMatch[1]!.toLowerCase());
  let name = headerMatch[2]!;

  // Handle "name=value" — ignore the =value part.
  const eqIndex = name.indexOf('=');
  if (eqIndex !== -1) {
    name = name.slice(0, eqIndex);
  }

  const list = getList(entry, side);
  const found = list.find(h => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}
