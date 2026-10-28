const { useState, useRef } = React;
const ASANA = "https://app.asana.com/api/1.0";
const CLAUDE = "https://api.anthropic.com/v1/messages";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP_RE = /strategic\s+(initiatives?|planning)\s*202\d/i;
class Pool {
  constructor(n = 3) {
    this.n = n;
    this.a = 0;
    this.q = [];
  }
  run(fn) {
    return new Promise((res, rej) => {
      const go = () => {
        this.a++;
        Promise.resolve(fn()).then(res, rej).finally(() => {
          this.a--;
          this.q.shift()?.();
        });
      };
      this.a < this.n ? go() : this.q.push(go);
    });
  }
}
const aHdrs = (t) => ({ Authorization: `Bearer ${t}`, Accept: "application/json", "Content-Type": "application/json" });
async function aGet(path, token, pool, params = {}) {
  const all = [];
  let off = null;
  do {
    const qs = new URLSearchParams({ limit: "100", ...params });
    if (off) qs.set("offset", off);
    const data = await pool.run(async () => {
      for (; ; ) {
        const r = await fetch(`${ASANA}${path}?${qs}`, { headers: aHdrs(token) });
        if (r.status === 429) {
          await sleep(Math.max(+(r.headers.get("Retry-After") || 15), 5) * 1e3);
          continue;
        }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.errors?.[0]?.message || `HTTP ${r.status}`);
        }
        return r.json();
      }
    });
    all.push(...data.data ?? []);
    off = data.next_page?.offset ?? null;
  } while (off);
  return all;
}
async function aPut(path, token, pool, body) {
  return pool.run(async () => {
    for (; ; ) {
      const r = await fetch(`${ASANA}${path}`, { method: "PUT", headers: aHdrs(token), body: JSON.stringify({ data: body }) });
      if (r.status === 429) {
        await sleep(Math.max(+(r.headers.get("Retry-After") || 15), 5) * 1e3);
        continue;
      }
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.errors?.[0]?.message || `HTTP ${r.status}`);
      }
      return r.json();
    }
  });
}
function mkGoalTree(flat) {
  const m = {};
  flat.forEach((g) => m[g.gid] = { ...g, resource_type: "goal", children: [] });
  const roots = [];
  flat.forEach((g) => {
    const pid = g.parent_goal?.gid;
    pid && m[pid] ? m[pid].children.push(m[g.gid]) : roots.push(m[g.gid]);
  });
  return roots;
}
const ICO = { goal: "ti-target", portfolio: "ti-folder", project: "ti-layout-kanban" };
const ICOCLR = { goal: "#f59e0b", portfolio: "#3b82f6", project: "var(--cx)" };
function Row({ item, exp, onToggle, sugg, edits, onEdit, res }) {
  const type = item.resource_type || "project";
  const kids = (item.children?.length ?? 0) > 0;
  const open = exp[item.gid];
  const s = sugg[item.gid], e = edits[item.gid];
  const eff = e || s;
  const st = res[item.gid];
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "stretch",
    borderBottom: "0.5px solid var(--bsm)",
    background: st === "success" ? "rgba(34,197,94,0.05)" : st === "error" ? "rgba(239,68,68,0.05)" : void 0,
    borderLeft: st === "success" ? "2px solid #22c55e" : st === "error" ? "2px solid #ef4444" : "2px solid transparent",
    minHeight: 40
  } }, /* @__PURE__ */ React.createElement("button", { onClick: () => kids && onToggle(item.gid), style: {
    flexShrink: 0,
    width: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    cursor: kids ? "pointer" : "default",
    color: "var(--cx)",
    paddingTop: 2
  } }, kids ? /* @__PURE__ */ React.createElement("i", { className: `ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`, style: { fontSize: 11, color: "var(--cs)" } }) : /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "var(--bmd)", display: "inline-block" } })), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 18, display: "flex", alignItems: "center", marginRight: 8 } }, /* @__PURE__ */ React.createElement("i", { className: `ti ${ICO[type] || "ti-file"}`, style: { fontSize: 13, color: ICOCLR[type] || "var(--cx)" } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "8px 8px 8px 0", minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, fontWeight: 500, color: "var(--ct)", margin: 0, lineHeight: 1.4, wordBreak: "break-word" } }, item.name), item.notes && /* @__PURE__ */ React.createElement("p", { style: {
    fontSize: 10,
    color: "var(--cx)",
    margin: "2px 0 0",
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden"
  } }, item.notes)), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      style: {
        width: "100%",
        fontSize: 12,
        padding: "3px 7px",
        borderRadius: 5,
        boxSizing: "border-box",
        border: eff?.name ? "0.5px solid #a5b4fc" : "0.5px solid var(--bmd)",
        background: eff?.name ? "rgba(165,180,252,0.07)" : "var(--bp)",
        color: "var(--ct)"
      },
      value: eff?.name ?? "",
      onChange: (ev) => onEdit(item.gid, { ...eff || {}, name: ev.target.value }),
      placeholder: s ? "" : "generate names first\u2026"
    }
  ), item.notes && /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: 2,
      style: {
        width: "100%",
        fontSize: 10,
        padding: "3px 7px",
        borderRadius: 5,
        resize: "none",
        boxSizing: "border-box",
        border: "0.5px solid var(--bmd)",
        background: "var(--bp)",
        color: "var(--ct)",
        lineHeight: 1.5
      },
      value: eff?.description ?? "",
      onChange: (ev) => onEdit(item.gid, { ...eff || {}, description: ev.target.value }),
      placeholder: "new description\u2026"
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 22, display: "flex", alignItems: "center", justifyContent: "center" } }, st === "success" && /* @__PURE__ */ React.createElement("i", { className: "ti ti-check", style: { color: "#22c55e", fontSize: 12 } }), st === "error" && /* @__PURE__ */ React.createElement("i", { className: "ti ti-x", style: { color: "#ef4444", fontSize: 12 } }))), kids && open && /* @__PURE__ */ React.createElement("div", { style: { marginLeft: 24, borderLeft: "1.5px solid var(--bsm)" } }, item.children.map((c) => /* @__PURE__ */ React.createElement(
    Row,
    {
      key: c.gid,
      item: c,
      exp,
      onToggle,
      sugg,
      edits,
      onEdit,
      res
    }
  ))));
}
function ColHdr() {
  return /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "stretch",
    background: "var(--bs)",
    borderBottom: "0.5px solid var(--bmd)",
    fontSize: 9,
    fontWeight: 700,
    color: "var(--cx)",
    textTransform: "uppercase",
    letterSpacing: "0.07em"
  } }, /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 30 } }), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 18, marginRight: 8 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "5px 8px 5px 0" } }, /* @__PURE__ */ React.createElement("div", null, "Current"), /* @__PURE__ */ React.createElement("div", null, "Suggested / override")), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 22 } }));
}
function App() {
  const [token, setToken] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [workspaces, setWorkspaces] = useState([]);
  const [wsGid, setWsGid] = useState("");
  const [showSettings, setShowSettings] = useState(true);
  const [mode, setMode] = useState("org");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [dept, setDept] = useState("");
  const [gTree, setGTree] = useState([]);
  const [pTree, setPTree] = useState([]);
  const [flat, setFlat] = useState({});
  const [sugg, setSugg] = useState({});
  const [edits, setEdits] = useState({});
  const [exp, setExp] = useState({});
  const [res, setRes] = useState({});
  const [phase, setPhase] = useState("setup");
  const [prog, setProg] = useState({ lbl: "", n: 0, of: 0 });
  const [log, setLog] = useState([]);
  const [errMsg, setErrMsg] = useState("");
  const pool = useRef(new Pool(3)).current;
  const lg = (msg) => setLog((l) => [...l.slice(-299), `${(/* @__PURE__ */ new Date()).toLocaleTimeString()} ${msg}`]);
  async function connect() {
    setErrMsg("");
    try {
      const ws = await aGet("/workspaces", token, pool, { opt_fields: "gid,name" });
      setWorkspaces(ws);
      if (ws.length === 1) setWsGid(ws[0].gid);
      setShowSettings(false);
      setPhase("config");
      lg(`\u2713 Connected \u2014 ${ws.length} workspace(s)`);
    } catch (e) {
      setErrMsg(`Connection failed: ${e.message}`);
      lg(`\u2717 ${e.message}`);
    }
  }
  async function fetchData() {
    setSugg({});
    setEdits({});
    setRes({});
    setErrMsg("");
    setPhase("fetching");
    try {
      lg("Fetching goals\u2026");
      const rawG = await aGet("/goals", token, pool, {
        workspace: wsGid,
        opt_fields: "gid,name,notes,resource_type,parent_goal.gid,parent_goal.name"
      });
      lg(`${rawG.length} goal(s) fetched`);
      const tree = mkGoalTree(rawG);
      const rootCount = tree.length;
      const childCount = rawG.length - rootCount;
      if (childCount > 0) lg(`Goal tree: ${rootCount} root goal(s), ${childCount} sub-goal(s)`);
      setGTree(tree);
      lg("Fetching workspace members to discover all portfolios\u2026");
      const wsMbrs = await aGet(`/workspaces/${wsGid}/workspace_memberships`, token, pool, { opt_fields: "user.gid" });
      const memberGids = [...new Set(wsMbrs.map((m) => m.user?.gid).filter(Boolean))];
      lg(`${memberGids.length} workspace member(s) \u2014 querying portfolios for each\u2026`);
      setProg({ lbl: "Scanning portfolios across members\u2026", n: 0, of: memberGids.length });
      const portBuckets = await Promise.all(
        memberGids.map(async (uid) => {
          const ps = await aGet("/portfolios", token, pool, { workspace: wsGid, owner: uid, opt_fields: "gid,name" }).catch(() => []);
          setProg((pr) => ({ ...pr, n: pr.n + 1 }));
          return ps;
        })
      );
      const seenPort = /* @__PURE__ */ new Set();
      const rawP = portBuckets.flat().filter((p) => {
        if (seenPort.has(p.gid)) return false;
        seenPort.add(p.gid);
        return true;
      });
      lg(`${rawP.length} unique portfolio(s) found across all members`);
      if (rawP.length === 0) lg("\u26A0 Still no portfolios \u2014 verify the service account token has workspace read access.");
      const toGet = rawP.filter((p) => !SKIP_RE.test(p.name));
      if (rawP.length !== toGet.length) lg(`Skipping ${rawP.length - toGet.length} Strategic Initiatives portfolio(s)`);
      setProg({ lbl: "Fetching portfolio items\u2026", n: 0, of: toGet.length });
      const withKids = await Promise.all(toGet.map(async (p) => {
        const ch = await aGet(`/portfolios/${p.gid}/items`, token, pool, { opt_fields: "gid,name,notes,resource_type" });
        setProg((pr) => ({ ...pr, n: pr.n + 1 }));
        const projects = ch.filter((c) => (c.resource_type || "project") === "project");
        const subPorts = ch.filter((c) => c.resource_type === "portfolio");
        lg(`"${p.name}": ${projects.length} project(s)${subPorts.length ? `, ${subPorts.length} sub-portfolio(s)` : ""}`);
        return { ...p, resource_type: "portfolio", children: ch };
      }));
      setPTree(withKids);
      const f = {};
      rawG.forEach((g) => {
        f[g.gid] = { ...g, resource_type: "goal" };
      });
      const addF = (item) => {
        f[item.gid] = { ...item, resource_type: item.resource_type || "project" };
        item.children?.forEach(addF);
      };
      withKids.forEach(addF);
      setFlat(f);
      const initExp = {};
      tree.forEach((g) => {
        initExp[g.gid] = true;
      });
      withKids.forEach((p) => {
        initExp[p.gid] = true;
      });
      setExp(initExp);
      const nProj = withKids.reduce((s, p) => s + p.children.filter((c) => (c.resource_type || "project") === "project").length, 0);
      lg(`Ready: ${rawG.length} goals \xB7 ${withKids.length} portfolios \xB7 ${nProj} projects`);
      setPhase("fetched");
    } catch (e) {
      setErrMsg(`Fetch failed: ${e.message}`);
      lg(`\u2717 ${e.message}`);
      setPhase("config");
    }
  }
  async function generateNames() {
    if (!claudeKey) {
      setErrMsg("Enter your Anthropic API key in Settings first.");
      return;
    }
    setPhase("generating");
    setErrMsg("");
    lg("Calling Claude to generate names\u2026");
    const items = Object.values(flat).map((i) => ({
      gid: i.gid,
      type: i.resource_type || "project",
      name: i.name,
      ...i.notes?.trim() ? { currentDesc: i.notes.trim().slice(0, 300) } : {},
      ...i.parent_goal?.name ? { parentGoalName: i.parent_goal.name } : {}
    }));
    if (items.length === 0) {
      setErrMsg("No content loaded yet \u2014 click Fetch Content first.");
      setPhase("fetched");
      return;
    }
    const ctx = mode === "dept" ? `departmental demo for the ${dept} team at ${company} (${industry} industry)` : `company-wide demo for ${company} (${industry} industry)`;
    const mkPrompt = (batch) => [
      `Rename these Asana workspace objects for a ${ctx}.`,
      "",
      "Rules:",
      "1. Preserve the purpose/theme \u2014 if original is about intake, keep it about intake; budget\u2192budget; planning\u2192planning",
      `2. Make names realistic and specific to ${company} / ${industry}${mode === "dept" ? ` / ${dept} department` : ""}`,
      "3. Goals: check 'parentGoalName' \u2014 children must fit logically under their parent goal",
      "4. Include 'description' ONLY if item already has 'currentDesc'; otherwise omit",
      "5. Portfolios: name only, no description",
      "6. Match original name length; professional and concise",
      "",
      `Items: ${JSON.stringify(batch)}`,
      "",
      'Return JSON only \u2014 no markdown, no explanation: {"<gid>":{"name":"...","description":"..."},...}'
    ].join("\n");
    const BATCH = 40;
    const all = {};
    let stage = "start";
    try {
      for (let s = 0; s < items.length; s += BATCH) {
        const batch = items.slice(s, s + BATCH);
        const tag = `batch ${s / BATCH + 1}/${Math.ceil(items.length / BATCH)}`;
        stage = `${tag} request`;
        lg(`${tag}: sending ${batch.length} item(s)\u2026`);
        const r = await fetch(CLAUDE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 16e3,
            system: "You rename Asana workspace objects for demo environments. Return ONLY valid JSON \u2014 no markdown, no code fences.",
            messages: [{ role: "user", content: mkPrompt(batch) }]
          })
        });
        const raw = await r.text();
        lg(`${tag}: HTTP ${r.status}, ${raw.length} bytes`);
        console.log(`[generate] ${tag} HTTP ${r.status}`, raw.slice(0, 2e3));
        if (!raw.trim()) throw new Error(`Empty response body (HTTP ${r.status})`);
        stage = `${tag} parse API response`;
        let d;
        try {
          d = JSON.parse(raw);
        } catch (_) {
          throw new Error(`API returned non-JSON (HTTP ${r.status}): ${raw.slice(0, 200)}`);
        }
        if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
        lg(`${tag}: stop_reason=${d.stop_reason}, output_tokens=${d.usage?.output_tokens}`);
        if (d.stop_reason === "max_tokens") throw new Error(`${tag}: response truncated at max_tokens \u2014 lower BATCH size`);
        const txt = d.content?.find((b) => b.type === "text")?.text ?? "";
        console.log(`[generate] ${tag} model text`, txt);
        stage = `${tag} parse model JSON`;
        const clean = txt.replace(/```(?:json)?\n?/g, "").trim();
        const a = clean.indexOf("{"), z = clean.lastIndexOf("}");
        if (a < 0 || z < a) throw new Error(`Model returned no JSON object: ${clean.slice(0, 200) || "(empty)"}`);
        Object.assign(all, JSON.parse(clean.slice(a, z + 1)));
      }
      setSugg(all);
      lg(`\u2713 ${Object.keys(all).length} name(s) generated`);
      setPhase("review");
    } catch (e) {
      console.error("[generate] failed at", stage, e);
      setErrMsg(`Generation failed (${stage}): ${e.message}`);
      lg(`\u2717 [${stage}] ${e.message}`);
      setPhase("fetched");
    }
  }
  async function applyChanges(only) {
    setPhase("applying");
    setErrMsg("");
    if (!only) setRes({});
    const updates = Object.values(flat).filter((i) => !only || (i.resource_type || "project") === only).map((i) => ({ i, eff: edits[i.gid] || sugg[i.gid] })).filter((u) => u.eff?.name?.trim());
    setProg({ lbl: "Sending updates\u2026", n: 0, of: updates.length });
    lg(`Sending ${updates.length} ${only ? only + " " : ""}update(s) to Asana\u2026`);
    await Promise.all(updates.map(async ({ i, eff }) => {
      const t = i.resource_type || "project";
      const path = t === "goal" ? `/goals/${i.gid}` : t === "portfolio" ? `/portfolios/${i.gid}` : `/projects/${i.gid}`;
      const body = { name: eff.name.trim() };
      if (t !== "portfolio" && eff.description?.trim()) body.notes = eff.description.trim();
      try {
        await aPut(path, token, pool, body);
        setRes((r) => ({ ...r, [i.gid]: "success" }));
        lg(`\u2713 ${eff.name}`);
      } catch (e) {
        setRes((r) => ({ ...r, [i.gid]: "error" }));
        lg(`\u2717 "${i.name}": ${e.message}`);
      }
      setProg((p) => ({ ...p, n: p.n + 1 }));
    }));
    lg("All updates sent");
    setPhase("done");
  }
  const busy = ["fetching", "generating", "applying"].includes(phase);
  const hasData = gTree.length > 0 || pTree.length > 0;
  const canFetch = !!token && !!wsGid && !busy;
  const canGen = hasData && !!company && !!industry && (mode === "org" || !!dept) && !!claudeKey && !busy;
  const canApply = (phase === "review" || phase === "done") && !busy;
  const nG = Object.values(flat).filter((i) => i.resource_type === "goal").length;
  const nP = pTree.length;
  const nPr = Object.values(flat).filter((i) => (i.resource_type || "project") === "project").length;
  const nOK = Object.values(res).filter((v) => v === "success").length;
  const nFail = Object.values(res).filter((v) => v === "error").length;
  const onToggle = (gid) => setExp((e) => ({ ...e, [gid]: !e[gid] }));
  const onEdit = (gid, v) => setEdits((ed) => ({ ...ed, [gid]: v }));
  const expandAll = () => {
    const e = {};
    Object.keys(flat).forEach((g) => {
      e[g] = true;
    });
    setExp(e);
  };
  const collapseAll = () => setExp({});
  const iStyle = {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 11,
    padding: "5px 8px",
    borderRadius: 6,
    border: "0.5px solid var(--bmd)",
    background: "var(--bp)",
    color: "var(--ct)"
  };
  const Btn = ({ label, onClick, disabled, bg, outline }) => /* @__PURE__ */ React.createElement("button", { onClick, disabled, style: {
    width: "100%",
    fontSize: 11,
    fontWeight: 600,
    padding: "8px 0",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.38 : 1,
    color: outline ? "var(--cs)" : "#fff",
    background: outline ? "transparent" : disabled ? "#9ca3af" : bg,
    border: outline ? "0.5px solid var(--bmd)" : "none"
  } }, label);
  return /* @__PURE__ */ React.createElement("div", { style: { height: "100vh", display: "flex", flexDirection: "column", fontFamily: "var(--ff)", background: "var(--bt)" } }, /* @__PURE__ */ React.createElement("div", { style: {
    background: "var(--bp)",
    borderBottom: "0.5px solid var(--bmd)",
    padding: "9px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
    gap: 10
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  } }, /* @__PURE__ */ React.createElement("i", { className: "ti ti-refresh", style: { fontSize: 14, color: "#fff" } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { style: { margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ct)", lineHeight: 1.2 } }, "Asana Demo Renamer"), /* @__PURE__ */ React.createElement("p", { style: { margin: 0, fontSize: 9, color: "var(--cx)", lineHeight: 1.2 } }, "Rename goals, portfolios & projects for demos"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, hasData && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, fontSize: 11, color: "var(--cs)" } }, nG > 0 && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "ti ti-target", style: { marginRight: 3, fontSize: 11, color: "#f59e0b" } }), nG), nP > 0 && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "ti ti-folder", style: { marginRight: 3, fontSize: 11, color: "#3b82f6" } }), nP), nPr > 0 && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "ti ti-layout-kanban", style: { marginRight: 3, fontSize: 11, color: "var(--cx)" } }), nPr), phase === "done" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { color: "#22c55e", fontWeight: 600 } }, "\u2713", nOK), nFail > 0 && /* @__PURE__ */ React.createElement("span", { style: { color: "#ef4444", fontWeight: 600 } }, " \u2717", nFail))), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowSettings((s) => !s), style: {
    fontSize: 10,
    padding: "4px 9px",
    borderRadius: 5,
    cursor: "pointer",
    fontWeight: 500,
    border: showSettings ? "0.5px solid #a5b4fc" : "0.5px solid var(--bmd)",
    background: showSettings ? "rgba(165,180,252,0.12)" : "transparent",
    color: showSettings ? "#6366f1" : "var(--cs)"
  } }, /* @__PURE__ */ React.createElement("i", { className: "ti ti-settings", style: { marginRight: 3, fontSize: 11 } }), "Settings"))), errMsg && /* @__PURE__ */ React.createElement("div", { style: {
    background: "rgba(239,68,68,0.07)",
    borderBottom: "0.5px solid rgba(239,68,68,0.25)",
    padding: "7px 14px",
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexShrink: 0
  } }, /* @__PURE__ */ React.createElement("i", { className: "ti ti-alert-triangle", style: { color: "#ef4444", fontSize: 13, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#b91c1c", flex: 1 } }, errMsg), /* @__PURE__ */ React.createElement("button", { onClick: () => setErrMsg(""), style: { background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 13 } }, "\u2715")), showSettings && /* @__PURE__ */ React.createElement("div", { style: {
    background: "rgba(99,102,241,0.03)",
    borderBottom: "0.5px solid rgba(99,102,241,0.18)",
    padding: "11px 14px",
    flexShrink: 0
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 680 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 5px", fontSize: 9, fontWeight: 700, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Asana Service Account Token"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "password",
      value: token,
      onChange: (e) => setToken(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && token && connect(),
      placeholder: "1/XXXXXXXXXXXXXXXX:XXXXXXX\u2026",
      style: { ...iStyle, flex: 1, border: "0.5px solid rgba(99,102,241,0.35)" }
    }
  ), /* @__PURE__ */ React.createElement("button", { onClick: connect, disabled: !token, style: {
    background: token ? "#6366f1" : "#9ca3af",
    color: "#fff",
    border: "none",
    padding: "5px 12px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: token ? "pointer" : "not-allowed",
    flexShrink: 0
  } }, "Connect"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 5px", fontSize: 9, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Anthropic API Key ", /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 400, textTransform: "none", color: "var(--cx)" } }, "(for Generate Names)")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "password",
      value: claudeKey,
      onChange: (e) => setClaudeKey(e.target.value),
      placeholder: "sk-ant-api03-\u2026",
      style: { ...iStyle, border: "0.5px solid rgba(124,58,237,0.35)" }
    }
  ), /* @__PURE__ */ React.createElement("p", { style: { margin: "3px 0 0", fontSize: 9, color: "var(--cx)" } }, "Get one at ", /* @__PURE__ */ React.createElement("span", { style: { color: "#7c3aed", cursor: "default" } }, "console.anthropic.com \u2192 API Keys"))))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("aside", { style: {
    width: 196,
    background: "var(--bp)",
    borderRight: "0.5px solid var(--bmd)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    overflowY: "auto"
  } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 11px", borderBottom: "0.5px solid var(--bsm)" } }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 4px", fontSize: 9, fontWeight: 700, color: "var(--cx)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Workspace"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: wsGid,
      onChange: (e) => setWsGid(e.target.value),
      disabled: workspaces.length === 0,
      style: {
        width: "100%",
        fontSize: 11,
        padding: "5px 6px",
        borderRadius: 5,
        boxSizing: "border-box",
        border: "0.5px solid var(--bmd)",
        background: "var(--bp)",
        color: workspaces.length === 0 ? "var(--cx)" : "var(--ct)"
      }
    },
    /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 select \u2014"),
    workspaces.map((w) => /* @__PURE__ */ React.createElement("option", { key: w.gid, value: w.gid }, w.name))
  )), /* @__PURE__ */ React.createElement("div", { style: { padding: "9px 11px", borderBottom: "0.5px solid var(--bsm)" } }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 5px", fontSize: 9, fontWeight: 700, color: "var(--cx)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Demo scope"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 3 } }, [["org", "Company-wide"], ["dept", "Department"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, onClick: () => setMode(v), style: {
    flex: 1,
    fontSize: 10,
    padding: "5px 0",
    borderRadius: 5,
    cursor: "pointer",
    fontWeight: 500,
    border: mode === v ? "0.5px solid #6366f1" : "0.5px solid var(--bmd)",
    background: mode === v ? "#6366f1" : "transparent",
    color: mode === v ? "#fff" : "var(--cs)"
  } }, l)))), /* @__PURE__ */ React.createElement("div", { style: { padding: "9px 11px", borderBottom: "0.5px solid var(--bsm)", display: "flex", flexDirection: "column", gap: 7 } }, [["Company", company, setCompany, "Acme Corp"], ["Industry", industry, setIndustry, "Healthcare"]].map(([l, v, s, ph]) => /* @__PURE__ */ React.createElement("div", { key: l }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 3px", fontSize: 9, color: "var(--cs)", fontWeight: 500 } }, l), /* @__PURE__ */ React.createElement("input", { value: v, onChange: (e) => s(e.target.value), placeholder: ph, style: iStyle }))), mode === "dept" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 3px", fontSize: 9, color: "var(--cs)", fontWeight: 500 } }, "Department"), /* @__PURE__ */ React.createElement("input", { value: dept, onChange: (e) => setDept(e.target.value), placeholder: "Marketing", style: iStyle }))), /* @__PURE__ */ React.createElement("div", { style: { padding: "9px 11px", borderBottom: "0.5px solid var(--bsm)", display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement(Btn, { label: phase === "fetching" ? "\u23F3 Fetching\u2026" : "Fetch Content", onClick: fetchData, disabled: !canFetch, bg: "#374151" }), /* @__PURE__ */ React.createElement(Btn, { label: phase === "generating" ? "\u23F3 Generating\u2026" : "\u2728 Generate Names", onClick: generateNames, disabled: !canGen, bg: "#7c3aed" }), /* @__PURE__ */ React.createElement(Btn, { label: phase === "applying" ? "\u23F3 Applying\u2026" : "\u{1F680} Apply Changes - All", onClick: () => applyChanges(), disabled: !canApply, bg: "#059669" }), /* @__PURE__ */ React.createElement(Btn, { label: "Apply - Goals only", onClick: () => applyChanges("goal"), disabled: !canApply, bg: "#047857" }), /* @__PURE__ */ React.createElement(Btn, { label: "Apply - Projects only", onClick: () => applyChanges("project"), disabled: !canApply, bg: "#047857" }), /* @__PURE__ */ React.createElement(Btn, { label: "Apply - Portfolios only", onClick: () => applyChanges("portfolio"), disabled: !canApply, bg: "#047857" })), busy && prog.of > 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "7px 11px", borderBottom: "0.5px solid var(--bsm)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--cx)", marginBottom: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } }, prog.lbl), /* @__PURE__ */ React.createElement("span", { style: { flexShrink: 0, marginLeft: 5 } }, prog.n, "/", prog.of)), /* @__PURE__ */ React.createElement("div", { style: { height: 2.5, background: "var(--bs)", borderRadius: 2 } }, /* @__PURE__ */ React.createElement("div", { style: {
    height: "100%",
    borderRadius: 2,
    background: "#6366f1",
    width: `${prog.of ? prog.n / prog.of * 100 : 0}%`,
    transition: "width 0.2s"
  } }))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "9px 11px", overflowY: "auto", minHeight: 60 } }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 4px", fontSize: 9, fontWeight: 700, color: "var(--cx)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Log"), log.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: { fontSize: 9, color: "var(--cx)", fontStyle: "italic" } }, "No activity yet") : log.slice().reverse().slice(0, 50).map((l, i) => /* @__PURE__ */ React.createElement("p", { key: i, style: { fontSize: 9, color: "var(--cx)", margin: "0 0 1px", lineHeight: 1.5, fontFamily: "var(--fm)", wordBreak: "break-all" } }, l)))), /* @__PURE__ */ React.createElement("main", { style: { flex: 1, overflowY: "auto", padding: 14 } }, !hasData ? /* @__PURE__ */ React.createElement("div", { style: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    textAlign: "center",
    padding: 40
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    width: 50,
    height: 50,
    borderRadius: 14,
    background: "var(--bs)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  } }, /* @__PURE__ */ React.createElement("i", { className: "ti ti-hierarchy-2", style: { fontSize: 24, color: "var(--cx)" } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 5px", fontSize: 14, fontWeight: 500, color: "var(--cs)" } }, "No content loaded"), /* @__PURE__ */ React.createElement("p", { style: { margin: 0, fontSize: 11, color: "var(--cx)", maxWidth: 260, lineHeight: 1.6 } }, !token ? "Open Settings \u2192 enter Asana token \u2192 Connect" : !wsGid ? "Select a workspace, then Fetch Content" : "Click Fetch Content to load your demo environment"))) : /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 920 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5 } }, [["Expand all", expandAll], ["Collapse all", collapseAll]].map(([l, fn]) => /* @__PURE__ */ React.createElement("button", { key: l, onClick: fn, style: {
    fontSize: 9,
    padding: "3px 9px",
    borderRadius: 5,
    cursor: "pointer",
    border: "0.5px solid var(--bmd)",
    background: "transparent",
    color: "var(--cs)"
  } }, l))), /* @__PURE__ */ React.createElement("p", { style: { margin: 0, fontSize: 10, color: "var(--cx)" } }, phase === "review" && `${Object.keys(sugg).length} suggestions \u2014 edit inline then Apply`, phase === "done" && `Complete: ${nOK} updated${nFail ? ` \xB7 ${nFail} failed` : ""}`, phase === "fetched" && (!claudeKey ? "Add your Anthropic API key in Settings to generate names" : "Fill in Company & Industry, then Generate Names"))), gTree.length > 0 && /* @__PURE__ */ React.createElement("div", { style: {
    background: "var(--bp)",
    border: "0.5px solid var(--bmd)",
    borderRadius: pTree.length > 0 ? "10px 10px 0 0" : 10,
    overflow: "hidden",
    borderBottom: pTree.length > 0 ? "none" : void 0
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 11px",
    background: "rgba(245,158,11,0.05)",
    borderBottom: "0.5px solid rgba(245,158,11,0.18)"
  } }, /* @__PURE__ */ React.createElement("i", { className: "ti ti-target", style: { fontSize: 13, color: "#f59e0b" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Goals"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#b45309" } }, "(", nG, ")")), /* @__PURE__ */ React.createElement(ColHdr, null), gTree.map((g) => /* @__PURE__ */ React.createElement(
    Row,
    {
      key: g.gid,
      item: g,
      exp,
      onToggle,
      sugg,
      edits,
      onEdit,
      res
    }
  ))), pTree.length > 0 && /* @__PURE__ */ React.createElement("div", { style: {
    background: "var(--bp)",
    border: "0.5px solid var(--bmd)",
    borderRadius: gTree.length > 0 ? "0 0 10px 10px" : 10,
    overflow: "hidden",
    borderTop: gTree.length > 0 ? "none" : void 0
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 11px",
    background: "rgba(59,130,246,0.05)",
    borderBottom: "0.5px solid rgba(59,130,246,0.18)"
  } }, /* @__PURE__ */ React.createElement("i", { className: "ti ti-folder", style: { fontSize: 13, color: "#3b82f6" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, fontWeight: 700, color: "#1e3a8a", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Portfolios & Projects"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#1d4ed8" } }, "(", nP, " portfolios \xB7 ", nPr, " items)")), /* @__PURE__ */ React.createElement(ColHdr, null), pTree.map((p) => /* @__PURE__ */ React.createElement(
    Row,
    {
      key: p.gid,
      item: p,
      exp,
      onToggle,
      sugg,
      edits,
      onEdit,
      res
    }
  ))), hasData && gTree.length === 0 && pTree.length === 0 && /* @__PURE__ */ React.createElement("div", { style: {
    textAlign: "center",
    padding: "40px 20px",
    color: "var(--cx)",
    fontSize: 12
  } }, "Data loaded but nothing to display \u2014 check the activity log for details.")))));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
