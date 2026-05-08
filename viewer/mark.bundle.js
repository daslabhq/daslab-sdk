// ../mark/src/path.ts
var SEGMENT_RE = /^([^.[\]]+)/;
function parsePath(path) {
  const out = [];
  let i = 0;
  let first = true;
  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      continue;
    }
    if (path[i] === "[") {
      const close = path.indexOf("]", i);
      if (close < 0)
        throw new Error(`unclosed [ in path: ${path}`);
      const inner = path.slice(i + 1, close);
      i = close + 1;
      const hasMatch = inner.match(/^(\S+)\s+has\s+(.+)$/);
      const eqMatch = inner.match(/^([^=]+)=(.+)$/);
      if (hasMatch) {
        out.push({ kind: "findHas", key: hasMatch[1].trim(), value: hasMatch[2].trim() });
      } else if (eqMatch) {
        out.push({ kind: "find", key: eqMatch[1].trim(), value: eqMatch[2].trim() });
      } else if (/^\d+$/.test(inner)) {
        out.push({ kind: "index", key: inner });
      } else {
        throw new Error(`invalid bracket segment in path: [${inner}]`);
      }
      continue;
    }
    const m = path.slice(i).match(SEGMENT_RE);
    if (!m)
      throw new Error(`unparseable path segment at ${i}: ${path}`);
    if (!first || m[1] !== "")
      out.push({ kind: "prop", key: m[1] });
    i += m[1].length;
    first = false;
  }
  return out;
}
function walk(value, segs) {
  let cur = value;
  for (const s of segs) {
    if (cur == null)
      return;
    switch (s.kind) {
      case "prop":
        cur = cur[s.key];
        break;
      case "index":
        if (!Array.isArray(cur))
          return;
        cur = cur[parseInt(s.key, 10)];
        break;
      case "find":
        if (!Array.isArray(cur))
          return;
        cur = cur.find((el) => el != null && String(el[s.key]) === String(s.value));
        break;
      case "findHas":
        if (!Array.isArray(cur))
          return;
        cur = cur.find((el) => el != null && Array.isArray(el[s.key]) && el[s.key].some((v) => String(v) === String(s.value)));
        break;
    }
  }
  return cur;
}
function resolve(world, path) {
  return walk(world, parsePath(path));
}
function lookup(world, path) {
  const segs = parsePath(path);
  if (segs.length === 0)
    return { present: world !== undefined, value: world };
  const parent = walk(world, segs.slice(0, -1));
  const last = segs[segs.length - 1];
  if (parent == null)
    return { present: false, value: undefined };
  switch (last.kind) {
    case "prop":
      return { present: Object.prototype.hasOwnProperty.call(parent, last.key), value: parent[last.key] };
    case "index": {
      if (!Array.isArray(parent))
        return { present: false, value: undefined };
      const idx = parseInt(last.key, 10);
      return { present: idx < parent.length, value: parent[idx] };
    }
    case "find":
    case "findHas": {
      const v = walk(world, segs);
      return { present: v !== undefined, value: v };
    }
  }
}

// ../mark/src/evaluate.ts
function evaluate(world, p) {
  switch (p.op) {
    case "eq": {
      const v = resolve(world, p.path);
      const ok = deepEq(v, p.value);
      return ok ? { satisfied: true, gap: 0, evidence: `${p.path} = ${json(v)}` } : { satisfied: false, gap: 1, evidence: `${p.path}: expected ${json(p.value)}, got ${json(v)}` };
    }
    case "neq": {
      const v = resolve(world, p.path);
      const ok = !deepEq(v, p.value);
      return ok ? { satisfied: true, gap: 0 } : { satisfied: false, gap: 1, evidence: `${p.path}: expected ≠ ${json(p.value)}, got ${json(v)}` };
    }
    case "contains": {
      if (typeof p.substring !== "string") {
        return { satisfied: false, gap: 1, evidence: `${p.path}: malformed substring (expected string, got ${json(p.substring)})` };
      }
      const v = resolve(world, p.path);
      if (typeof v !== "string") {
        return { satisfied: false, gap: 1, evidence: `${p.path}: expected string containing "${p.substring}", got ${json(v)}` };
      }
      const hay = p.ci ? v.toLowerCase() : v;
      const ndl = p.ci ? p.substring.toLowerCase() : p.substring;
      return hay.includes(ndl) ? { satisfied: true, gap: 0 } : { satisfied: false, gap: 1, evidence: `${p.path}: "${p.substring}" not in ${json(v).slice(0, 80)}` };
    }
    case "exists": {
      const r = lookup(world, p.path);
      return r.present ? { satisfied: true, gap: 0, evidence: `${p.path} present` } : { satisfied: false, gap: 1, evidence: `${p.path}: missing` };
    }
    case "missing": {
      const r = lookup(world, p.path);
      return !r.present ? { satisfied: true, gap: 0 } : { satisfied: false, gap: 1, evidence: `${p.path}: expected missing, got ${json(r.value)}` };
    }
    case "find": {
      const coll = resolve(world, p.collection);
      if (!Array.isArray(coll)) {
        return { satisfied: false, gap: 1, evidence: `${p.collection}: not an array` };
      }
      let best;
      for (const el of coll) {
        const r = evaluate(el, p.where);
        if (r.satisfied)
          return { satisfied: true, gap: 0, evidence: r.evidence };
        if (!best || r.gap < best.gap)
          best = r;
      }
      const gap = best ? Math.max(1, best.gap) : 1;
      return { satisfied: false, gap, evidence: `${p.collection}: no element matched` + (best?.evidence ? ` (closest: ${best.evidence})` : "") };
    }
    case "count": {
      const coll = resolve(world, p.collection);
      if (!Array.isArray(coll)) {
        return { satisfied: false, gap: 1, evidence: `${p.collection}: not an array` };
      }
      const n = p.where ? coll.filter((el) => evaluate(el, p.where).satisfied).length : coll.length;
      const checks = [];
      if (p.eq !== undefined)
        checks.push({ ok: n === p.eq, gap: Math.abs(n - p.eq), msg: `count = ${p.eq}` });
      if (p.gte !== undefined)
        checks.push({ ok: n >= p.gte, gap: Math.max(0, p.gte - n), msg: `count ≥ ${p.gte}` });
      if (p.lte !== undefined)
        checks.push({ ok: n <= p.lte, gap: Math.max(0, n - p.lte), msg: `count ≤ ${p.lte}` });
      if (checks.length === 0) {
        return { satisfied: true, gap: 0, evidence: `${p.collection}: ${n} elements` };
      }
      const allOk = checks.every((c) => c.ok);
      const totalGap = checks.reduce((s, c) => s + c.gap, 0);
      return {
        satisfied: allOk,
        gap: totalGap,
        evidence: `${p.collection}: count=${n}, expected ${checks.map((c) => c.msg).join(" & ")}`
      };
    }
    case "and": {
      const sub = p.of.map((q) => evaluate(world, q));
      const satisfied = sub.every((r) => r.satisfied);
      const gap = sub.reduce((s, r) => s + r.gap, 0);
      const firstFail = sub.find((r) => !r.satisfied);
      return { satisfied, gap, evidence: firstFail?.evidence };
    }
    case "or": {
      const sub = p.of.map((q) => evaluate(world, q));
      const satisfied = sub.some((r) => r.satisfied);
      const gap = satisfied ? 0 : Math.min(...sub.map((r) => r.gap));
      const winner = sub.find((r) => r.satisfied);
      return { satisfied, gap, evidence: winner?.evidence ?? `none of ${sub.length} branches satisfied` };
    }
    case "not": {
      const r = evaluate(world, p.of);
      return r.satisfied ? { satisfied: false, gap: 1, evidence: `negated condition held: ${r.evidence ?? ""}` } : { satisfied: true, gap: 0 };
    }
  }
}
function deepEq(a, b) {
  if (a === b)
    return true;
  if (a == null || b == null)
    return a === b;
  if (typeof a !== typeof b)
    return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((x, i) => deepEq(x, b[i]));
  }
  if (typeof a === "object") {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length)
      return false;
    return ak.every((k) => deepEq(a[k], b[k]));
  }
  return false;
}
function json(v) {
  if (v === undefined)
    return "undefined";
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + "..." : s;
  } catch {
    return String(v);
  }
}
// ../mark/src/tools.ts
var TOOL_DESCRIPTORS = {
  check_goal: {
    name: "check_goal",
    description: "Evaluate a goal predicate against a world state. Returns {satisfied, gap, evidence}. " + "Use this when you need to know whether a task's success criterion currently holds. " + "`gap` is non-negative and 0 iff satisfied — it's a heuristic distance to goal, " + "useful for planning and self-assessment.",
    input_schema: {
      type: "object",
      properties: {
        goal: { description: "Predicate AST. JSON-serializable." },
        world: { description: "World state to evaluate against." }
      },
      required: ["goal", "world"]
    }
  },
  gap: {
    name: "gap",
    description: "Return only the goal-distance (a non-negative number, 0 iff satisfied). " + "Cheaper than check_goal when you don't need diagnostics — useful for inner " + "loops of search or planning where you're calling the grader thousands of times.",
    input_schema: {
      type: "object",
      properties: {
        goal: { description: "Predicate AST." },
        world: { description: "World state." }
      },
      required: ["goal", "world"]
    }
  },
  diagnose: {
    name: "diagnose",
    description: "Evaluate and return ONLY the diagnostic when unsatisfied. Token-efficient: " + "use when you've already failed and need the agent to read why and decide next step.",
    input_schema: {
      type: "object",
      properties: {
        goal: { description: "Predicate AST." },
        world: { description: "World state." }
      },
      required: ["goal", "world"]
    }
  }
};
// ../mark/src/translate/automationbench.ts
var SF_OBJECT_MAP = {
  Account: "accounts",
  Contact: "contacts",
  Lead: "leads",
  Opportunity: "opportunities",
  Campaign: "campaigns",
  Case: "cases",
  Task: "tasks",
  Event: "events",
  Note: "notes"
};
function sfCollection(a) {
  if (typeof a.collection === "string")
    return a.collection;
  const ot = a.object_type ?? a.object;
  if (!ot)
    return;
  return SF_OBJECT_MAP[ot] ?? ot.toLowerCase() + "s";
}
function coerceValue(v) {
  return v;
}
function fieldVariants(name) {
  const exact = name;
  const lower = name.toLowerCase();
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const aliases = {
    stage: "stage_name",
    account: "account_id",
    contact: "contact_id",
    owner: "owner_id"
  };
  const aliased = aliases[lower];
  return [...new Set([exact, lower, snake, aliased].filter(Boolean))];
}
function eqOverFields(basePath, fields, value) {
  if (fields.length === 1)
    return { op: "eq", path: `${basePath}.${fields[0]}`, value };
  return { op: "or", of: fields.map((f) => ({ op: "eq", path: `${basePath}.${f}`, value })) };
}
function containsOverFields(basePath, fields, substring, ci = true) {
  if (fields.length === 1)
    return { op: "contains", path: `${basePath}.${fields[0]}`, substring, ci };
  return { op: "or", of: fields.map((f) => ({ op: "contains", path: `${basePath}.${f}`, substring, ci })) };
}
function arrayIncludes(path, value) {
  return { op: "find", collection: path, where: { op: "eq", path: "", value } };
}
function arrayContainsSubstring(path, substring, ci = true) {
  return { op: "find", collection: path, where: { op: "contains", path: "", substring, ci } };
}
function sfFieldEquals(a) {
  const collection = sfCollection(a);
  const recordId = a.record_id ?? a.id;
  if (!collection || !recordId || !a.field) {
    throw new Error(`incomplete salesforce_field_equals: ${JSON.stringify(a)}`);
  }
  return {
    predicate: eqOverFields(`salesforce.${collection}[id=${recordId}]`, fieldVariants(a.field), coerceValue(a.value)),
    approximate: true
  };
}
function sfContactFieldEquals(a) {
  const id = a.contact_id ?? a.id;
  return {
    predicate: eqOverFields(`salesforce.contacts[id=${id}]`, fieldVariants(a.field), coerceValue(a.value))
  };
}
function sfLeadFieldEquals(a) {
  const id = a.lead_id ?? a.id;
  return {
    predicate: eqOverFields(`salesforce.leads[id=${id}]`, fieldVariants(a.field), coerceValue(a.value))
  };
}
function sfFieldContains(a) {
  const collection = sfCollection(a);
  const recordId = a.record_id ?? a.id;
  if (!collection || !recordId || !a.field)
    throw new Error(`incomplete salesforce_field_contains`);
  return {
    predicate: containsOverFields(`salesforce.${collection}[id=${recordId}]`, fieldVariants(a.field), String(a.value), true),
    approximate: true
  };
}
var SENT_LABEL = arrayIncludes("label_ids", "SENT");
function recipientMatch(recipient) {
  const recipients = Array.isArray(recipient) ? recipient : [recipient];
  if (recipients.length === 1) {
    return {
      op: "or",
      of: [
        arrayContainsSubstring("to", String(recipients[0]), true),
        arrayContainsSubstring("cc", String(recipients[0]), true)
      ]
    };
  }
  return {
    op: "and",
    of: recipients.map((r) => ({
      op: "or",
      of: [
        arrayContainsSubstring("to", String(r), true),
        arrayContainsSubstring("cc", String(r), true)
      ]
    }))
  };
}
function gmailMessageSent(a) {
  const filters = [SENT_LABEL];
  const expectedTo = a.to;
  const toContains = a.to_contains;
  const subjC = a.subject_contains;
  const bodyC = a.body_contains;
  if (expectedTo)
    filters.push(recipientMatch(expectedTo));
  if (toContains)
    filters.push(recipientMatch(toContains));
  if (subjC)
    filters.push({ op: "contains", path: "subject", substring: subjC, ci: true });
  const bodyArr = Array.isArray(bodyC) ? bodyC : bodyC ? [bodyC] : [];
  for (const s of bodyArr) {
    if (typeof s === "string") {
      filters.push({ op: "contains", path: "body_plain", substring: s, ci: true });
    }
  }
  return {
    predicate: {
      op: "find",
      collection: "gmail.messages",
      where: filters.length === 1 ? filters[0] : { op: "and", of: filters }
    },
    approximate: true
  };
}
function gmailMessageNotSent(a) {
  return { predicate: { op: "not", of: gmailMessageSent(a).predicate }, approximate: true };
}
function gmailMessageSentTo(a) {
  const recipient = String(a.recipient ?? a.to ?? "");
  return {
    predicate: {
      op: "find",
      collection: "gmail.messages",
      where: { op: "and", of: [SENT_LABEL, recipientMatch(recipient)] }
    },
    approximate: true
  };
}
function gmailMessageNotSentTo(a) {
  return { predicate: { op: "not", of: gmailMessageSentTo(a).predicate }, approximate: true };
}
function gmailMessageSentToWithBodyContains(a) {
  const recipient = String(a.to ?? a.recipient ?? "");
  const bodyContains = Array.isArray(a.body_contains) ? a.body_contains : [a.body_contains];
  const bodyChecks = bodyContains.filter((s) => typeof s === "string").map((s) => ({ op: "contains", path: "body_plain", substring: s, ci: true }));
  const subjectExpected = a.subject ?? a.subject_contains;
  const where = {
    op: "and",
    of: [
      SENT_LABEL,
      recipientMatch(recipient),
      ...subjectExpected ? [{ op: "contains", path: "subject", substring: subjectExpected, ci: true }] : [],
      ...bodyChecks
    ]
  };
  return {
    predicate: { op: "find", collection: "gmail.messages", where },
    approximate: true
  };
}
function gmailMessageNotSentToWithBodyContains(a) {
  return { predicate: { op: "not", of: gmailMessageSentToWithBodyContains(a).predicate }, approximate: true };
}
function gmailMessageSentToWithBodyNotContains(a) {
  const recipient = String(a.to ?? a.recipient ?? "");
  const noBody = String(a.body_not_contains ?? a.body_contains ?? "");
  return {
    predicate: {
      op: "find",
      collection: "gmail.messages",
      where: {
        op: "and",
        of: [
          SENT_LABEL,
          recipientMatch(recipient),
          { op: "not", of: { op: "contains", path: "body_plain", substring: noBody, ci: true } }
        ]
      }
    },
    approximate: true
  };
}
function gmailEmailBodyContains(a) {
  const needle = String(a.body_contains ?? a.text ?? a.value ?? a.contains ?? "");
  const expectedTo = a.to;
  const filters = [
    SENT_LABEL,
    { op: "contains", path: "body_plain", substring: needle, ci: true }
  ];
  if (expectedTo)
    filters.push(recipientMatch(expectedTo));
  return {
    predicate: { op: "find", collection: "gmail.messages", where: { op: "and", of: filters } },
    approximate: true
  };
}
function slackMessageInChannel(a) {
  const channel = a.channel ?? a.channel_id ?? a.channel_name;
  const textC = a.text_contains;
  if (!channel) {
    return { predicate: { op: "eq", path: "__never_present__", value: "__never__" }, approximate: true };
  }
  const channelMatch = {
    op: "or",
    of: [
      { op: "eq", path: "channel_id", value: channel },
      { op: "eq", path: "channel_id", value: channel.startsWith("#") ? channel.slice(1) : channel }
    ]
  };
  const textChecks = [];
  const textArr = Array.isArray(textC) ? textC : textC ? [textC] : [];
  for (const s of textArr) {
    textChecks.push({ op: "contains", path: "text", substring: s, ci: true });
  }
  const where = {
    op: "and",
    of: [
      { op: "neq", path: "is_deleted", value: true },
      channelMatch,
      ...textChecks
    ]
  };
  return {
    predicate: { op: "find", collection: "slack.messages", where },
    approximate: true
  };
}
function slackMessageNotInChannel(a) {
  return { predicate: { op: "not", of: slackMessageInChannel(a).predicate }, approximate: true };
}
function slackMessageExists(a) {
  const channel = a.channel ?? a.channel_id ?? a.channel_name;
  const textC = a.text_contains;
  const filters = [{ op: "neq", path: "is_deleted", value: true }];
  if (channel) {
    filters.push({
      op: "or",
      of: [
        { op: "eq", path: "channel_id", value: channel },
        { op: "eq", path: "channel_id", value: channel.startsWith("#") ? channel.slice(1) : channel }
      ]
    });
  }
  const textArr = Array.isArray(textC) ? textC : textC ? [textC] : [];
  for (const s of textArr) {
    filters.push({ op: "contains", path: "text", substring: s, ci: true });
  }
  return {
    predicate: {
      op: "find",
      collection: "slack.messages",
      where: filters.length === 1 ? filters[0] : { op: "and", of: filters }
    },
    approximate: true
  };
}
function slackMessageNotExists(a) {
  return { predicate: { op: "not", of: slackMessageExists(a).predicate }, approximate: true };
}
function googleSheetsRowExists(a) {
  const ssId = a.spreadsheet_id ?? a.spreadsheet;
  const wsId = a.worksheet_id ?? a.worksheet ?? a.worksheet_name;
  const column = a.column;
  const value = a.value;
  const cells = a.cells;
  const cellContains = a.cell_contains ?? a.contains;
  if (!ssId) {
    return { predicate: { op: "eq", path: "__never__", value: "__never__" }, approximate: true };
  }
  let rowMatch;
  if (cells && typeof cells === "object" && !Array.isArray(cells)) {
    rowMatch = {
      op: "and",
      of: Object.entries(cells).map(([k, v]) => ({ op: "eq", path: `cells.${k}`, value: v }))
    };
  } else if (column && value !== undefined) {
    rowMatch = { op: "eq", path: `cells.${column}`, value };
  } else if (cellContains) {
    rowMatch = { op: "exists", path: "cells" };
  } else {
    rowMatch = { op: "exists", path: "cells" };
  }
  const wsPredicate = {
    op: "find",
    collection: "rows",
    where: rowMatch
  };
  const wsFilter = wsId ? { op: "and", of: [
    { op: "or", of: [
      { op: "eq", path: "id", value: wsId },
      { op: "eq", path: "title", value: wsId }
    ] },
    wsPredicate
  ] } : wsPredicate;
  return {
    predicate: {
      op: "find",
      collection: `google_sheets.spreadsheets[id=${ssId}].worksheets`,
      where: wsFilter
    },
    approximate: true
  };
}
function googleSheetsRowNotExists(a) {
  return { predicate: { op: "not", of: googleSheetsRowExists(a).predicate }, approximate: true };
}
var TRANSLATORS = {
  salesforce_field_equals: sfFieldEquals,
  salesforce_contact_field_equals: sfContactFieldEquals,
  salesforce_lead_field_equals: sfLeadFieldEquals,
  salesforce_field_contains: sfFieldContains,
  gmail_message_sent: gmailMessageSent,
  gmail_message_not_sent: gmailMessageNotSent,
  gmail_message_sent_to: gmailMessageSentTo,
  gmail_message_not_sent_to: gmailMessageNotSentTo,
  gmail_message_sent_to_with_body_contains: gmailMessageSentToWithBodyContains,
  gmail_message_not_sent_to_with_body_contains: gmailMessageNotSentToWithBodyContains,
  gmail_message_sent_to_with_body_not_contains: gmailMessageSentToWithBodyNotContains,
  gmail_email_body_contains: gmailEmailBodyContains,
  slack_message_exists: slackMessageExists,
  slack_message_in_channel: slackMessageInChannel,
  slack_message_not_exists: slackMessageNotExists,
  slack_message_not_in_channel: slackMessageNotInChannel,
  google_sheets_row_exists: googleSheetsRowExists,
  google_sheets_row_not_exists: googleSheetsRowNotExists
};
function translate(a) {
  const fn = TRANSLATORS[a.type];
  if (!fn)
    return null;
  try {
    return fn(a);
  } catch (e) {
    return null;
  }
}
var SUPPORTED_TYPES = new Set(Object.keys(TRANSLATORS));
export {
  translate,
  resolve,
  lookup,
  evaluate,
  SUPPORTED_TYPES
};
