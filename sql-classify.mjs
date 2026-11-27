// Same lexical rules as server37/overlay mcp_server.py classify().
// This is not a claim that a read is effect-free. PostgreSQL grants and the
// Server's read_only refusal stay authoritative. An undelimitable statement
// is destructive. Anything that is not a read is not admitted by this adapter
// because exact-SQL operator approval is not integrated.

const DESTRUCTIVE = /^\s*(drop|truncate|delete\s+from|alter\s+system|drop\s+database)\b/i;
const READ = /^\s*(select|with|explain|show|table|values)\b/i;
const MUTATES_ANYWHERE = /\b(insert\s+into|update\s+\w|delete\s+from|merge\s+into|truncate\b|drop\s+\w|alter\s+\w|create\s+\w|grant\s+\w|revoke\s+\w|copy\b[^;]*\bto\s+program|do\s*\$)/i;
const DESTRUCTIVE_ANYWHERE = /\b(drop\s+\w|truncate\b|delete\s+from|alter\s+system)/i;
const OPAQUE_EXECUTOR = /^(do|call)\b/i;
const DOLLAR_TAG = /\$([A-Za-z_\u0080-\uFFEF][A-Za-z0-9_\u0080-\uFFEF]*)?\$/u;

const alnum = (ch) => typeof ch === "string" && (ch === "_" || /[\p{L}\p{N}]/u.test(ch));

export function lexicalShadow(sql) {
  const out = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? n : j + 1;
      out.push(" ");
      continue;
    }
    if (c === "/" && sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < n && depth) {
        if (sql.startsWith("/*", i)) { depth += 1; i += 2; }
        else if (sql.startsWith("*/", i)) { depth -= 1; i += 2; }
        else i += 1;
      }
      if (depth) return { shadow: out.join(""), reason: "unterminated block comment" };
      out.push(" ");
      continue;
    }
    let prefix = "";
    if ((c === "e" || c === "E") && sql[i + 1] === "'") prefix = "E";
    else if ((c === "u" || c === "U") && sql.startsWith("&'", i + 1)) prefix = "U&";
    if (prefix || c === "'") {
      if (prefix && i > 0 && alnum(sql[i - 1])) { out.push(c); i += 1; continue; }
      i += prefix.length + 1;
      const escapes = prefix === "E";
      for (;;) {
        if (i >= n) return { shadow: out.join(""), reason: "unterminated string constant" };
        const ch = sql[i];
        if (escapes && ch === "\\") { i += 2; continue; }
        if (ch === "\\" && !escapes && sql[i + 1] === "'") {
          return { shadow: out.join(""), reason: "backslash before a quote in a plain string constant; its meaning depends on standard_conforming_strings" };
        }
        if (ch === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      out.push("''");
      continue;
    }
    if (c === '"' || ((c === "u" || c === "U") && sql.startsWith('&"', i + 1))) {
      i += c === '"' ? 1 : 3;
      for (;;) {
        if (i >= n) return { shadow: out.join(""), reason: "unterminated quoted identifier" };
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      out.push('"x"');
      continue;
    }
    if (c === "$") {
      const m = DOLLAR_TAG.exec(sql.slice(i));
      if (m && m.index === 0) {
        const close = m[0];
        const j = sql.indexOf(close, i + close.length);
        if (j < 0) return { shadow: out.join(""), reason: "unterminated dollar-quoted string" };
        out.push("$$");
        i = j + close.length;
        continue;
      }
    }
    out.push(c);
    i += 1;
  }
  return { shadow: out.join(""), reason: "" };
}

export function classifySql(sql) {
  if (typeof sql !== "string") return "write";
  const { shadow, reason } = lexicalShadow(sql);
  if (reason) return "destructive";
  const s = shadow.trimStart();
  if (DESTRUCTIVE.test(s)) return "destructive";
  if (READ.test(s)) return MUTATES_ANYWHERE.test(s) ? "destructive" : "read";
  if (OPAQUE_EXECUTOR.test(s) || DESTRUCTIVE_ANYWHERE.test(s)) return "destructive";
  return "write";
}
