// static/js/main.js
// =======================================================
// BioDash - Final main.js (Option A: column delete allowed; Sample column cannot be deleted)
// Single-step undo + critical params + column delete (Sample protected)
// =======================================================

/* ---------------------------
   Utility: HTML escape
   --------------------------- */
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------------------
   Toast
   --------------------------- */
function toast(msg, isErr = false) {
  const t = document.getElementById("toast");
  if (!t) return console.log("TOAST:", msg);
  t.innerText = msg;
  t.classList.toggle("error", !!isErr);
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3000);
}

/* ---------------------------
   Dark Mode
   --------------------------- */
function applyDarkMode() {
  document.documentElement.classList.toggle(
    "dark",
    localStorage.getItem("biodash_dark") === "1"
  );
}
function toggleDark() {
  if (document.documentElement.classList.contains("dark"))
    localStorage.removeItem("biodash_dark");
  else
    localStorage.setItem("biodash_dark", "1");
  applyDarkMode();
}
function setupDarkToggle() {
  applyDarkMode();
  document.querySelectorAll("#darkToggle").forEach(btn => btn.addEventListener("click", toggleDark));
}

/* ---------------------------
   Fetch wrapper
   --------------------------- */
async function apiFetch(url, opts = {}) {
  opts.headers ||= {};
  if (!(opts.body instanceof FormData) && !opts.headers["Content-Type"])
    opts.headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(url, opts);
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { msg: String(e) } };
  }
}

/* ---------------------------
   Auth helpers
   --------------------------- */
function bindLoginForm(form) {
  form.onsubmit = async e => {
    e.preventDefault();
    const u = form.username.value.trim();
    const p = form.password.value.trim();
    if (!u || !p) return toast("Required", true);
    const r = await apiFetch("/login", {
      method: "POST", body: JSON.stringify({ username: u, password: p })
    });
    if (!r.ok) return toast("Invalid login", true);
    location.href = "/";
  };
}
function bindRegisterForm(form) {
  form.onsubmit = async e => {
    e.preventDefault();
    const u = form.username.value.trim();
    const p = form.password.value.trim();
    const c = form.confirm.value.trim();
    if (!u || !p) return toast("Required", true);
    if (p !== c) return toast("Mismatch", true);
    const r = await apiFetch("/register", { method: "POST", body: JSON.stringify({ username: u, password: p }) });
    if (!r.ok) return toast(r.data?.msg || "Register failed", true);
    toast("Registered");
    setTimeout(() => location.href = "/login", 700);
  };
}
function bindLogoutBtn() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.onclick = async () => {
    await apiFetch("/logout", { method: "POST" });
    location.href = "/login";
  };
}

/* ============================================================
   Experiments List Page
   ============================================================ */
window.initExperimentsPage = () => {
  setupDarkToggle();
  bindLogoutBtn();

  const tbody = document.querySelector("#expTable tbody");
  const form = document.getElementById("experimentForm");

  async function loadExperiments() {
    const r = await apiFetch("/api/experiments");
    if (!r.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Failed to load</td></tr>`;
      return;
    }

    const rows = Array.isArray(r.data) ? r.data : [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6">No experiments</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(exp => `
      <tr>
        <td style="text-align:left;">${escapeHtml(exp.name)}</td>
        <td>${escapeHtml(exp.type || "")}</td>
        <td>${escapeHtml(exp.organism || "")}</td>
        <td>${escapeHtml(exp.pi || "")}</td>
        <td>${escapeHtml(exp.date || "")}</td>
        <td>
          <button class="btn" onclick="location.href='/experiment/${exp.id}'">View</button>
          <button class="btn-ghost" style="margin-left:8px;" data-id="${exp.id}" onclick="(async function(){ if(!confirm('Delete experiment?')) return; await fetch('/api/experiments/${exp.id}',{method:'DELETE'}); location.reload(); })()">Delete</button>
        </td>
      </tr>
    `).join("");
  }

  loadExperiments();

  form.onsubmit = async e => {
    e.preventDefault();
    const payload = {
      name: document.getElementById("expName").value.trim(),
      desc: document.getElementById("expDesc").value.trim(),
      type: document.getElementById("expType").value.trim(),
      organism: document.getElementById("expOrganism").value.trim(),
      pi: document.getElementById("expPI").value.trim(),
      date: document.getElementById("expDate").value.trim(),
      params: []
    };
    if (!payload.name) return toast("Name required", true);
    const r = await apiFetch("/api/experiments", { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) return toast("Save failed", true);
    toast("Experiment saved");
    form.reset();
    loadExperiments();
  };
};

/* ============================================================
   Experiment View Page
   - Single-step undo (snapshot)
   - Import file -> headers/rows created
   - Manual add parameter -> column added
   - Column delete allowed except 'Sample'
   - SaveAll replaces DB entries for the experiment
   - Critical params saved into experiment.params and used by alerts computation
   ============================================================ */
window.initExperimentView = () => {
  setupDarkToggle();
  bindLogoutBtn();

  const expId = Number(location.pathname.split("/").pop());
  if (!expId) return;

  // DOM refs
  const expTitle = document.getElementById("expTitle");
  const expMeta = document.getElementById("expMeta");
  const fileInput = document.getElementById("bulkDataFile");
  const importBtn = document.getElementById("importCsv");
  const newParamInput = document.getElementById("newParamName");
  const addParamBtn = document.getElementById("addParamFieldTop");
  const paramListEl = document.getElementById("paramList");
  const critContainer = document.getElementById("criticalParamContainer");
  const addCritBtn = document.getElementById("addCriticalParamBtn");
  const entryContainer = document.getElementById("entryContainer");
  const addRowBtn = document.getElementById("addRow");
  const saveAllBtn = document.getElementById("saveAll");
  const entryFilter = document.getElementById("entryFilter");
  const vizType = document.getElementById("vizType");
  const vizParam = document.getElementById("vizParam");
  const drawVizBtn = document.getElementById("drawViz");
  const vizCanvas = document.getElementById("vizChart");
  const deleteExpBtn = document.getElementById("deleteExpBtn");

  // create single Undo button next to Save All (if not present in DOM)
  let undoBtn = document.getElementById("undoTableBtn");
  if (!undoBtn) {
    undoBtn = document.createElement("button");
    undoBtn.id = "undoTableBtn";
    undoBtn.className = "btn-ghost";
    undoBtn.style.marginLeft = "8px";
    undoBtn.textContent = "Undo";
    undoBtn.disabled = true;
    if (saveAllBtn && saveAllBtn.parentNode) saveAllBtn.parentNode.insertBefore(undoBtn, saveAllBtn.nextSibling);
  }

  // Internal state
  let params = [];         // [{name, threshold|null}, ...]
  let headers = [];        // ["Sample", "ParamA", ...] - empty until file/param added
  let rows = [];           // [[...], ...] rows of strings, optional property _entryId
  let criticalParams = []; // [{param, threshold}, ...]
  let lastSnapshot = null; // single snapshot for single-step undo

  // Snapshot helpers
  function takeSnapshot() {
    lastSnapshot = {
      params: JSON.parse(JSON.stringify(params)),
      headers: JSON.parse(JSON.stringify(headers)),
      rows: JSON.parse(JSON.stringify(rows)),
      critical: JSON.parse(JSON.stringify(criticalParams))
    };
    if (undoBtn) undoBtn.disabled = false;
  }
  function clearSnapshot() {
    lastSnapshot = null;
    if (undoBtn) undoBtn.disabled = true;
  }
  function restoreSnapshot() {
    if (!lastSnapshot) return toast("Nothing to undo");
    params = JSON.parse(JSON.stringify(lastSnapshot.params));
    headers = JSON.parse(JSON.stringify(lastSnapshot.headers));
    rows = JSON.parse(JSON.stringify(lastSnapshot.rows));
    criticalParams = JSON.parse(JSON.stringify(lastSnapshot.critical));
    clearSnapshot(); // single-step undo
    renderParamList();
    renderCriticalBox();
    fillVizOptions();
    buildTable();
    // persist params to backend because column/threshold names changed back
    apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });
    toast("Reverted last change");
  }

  // init undo disabled
  clearSnapshot();

  /* ---------------------------
     Load experiment metadata and existing DB entries
     --------------------------- */
  async function loadExperiment() {
    const r = await apiFetch(`/api/experiments/${expId}`);
    if (!r.ok) return toast("Failed to load experiment", true);
    const exp = r.data;
    expTitle.textContent = exp.name || "Experiment";
    expMeta.textContent = `PI: ${exp.pi || ""} • Organism: ${exp.organism || ""} • Start: ${exp.date || ""}`;

    try { params = JSON.parse(exp.params || "[]"); } catch { params = []; }
    params = params.map(p => (typeof p === "string" ? { name: p, threshold: null } : p));

    // only set headers from params if params exist; otherwise leave headers empty until file/param added
    headers = params.length ? params.map(p => p.name) : [];

    criticalParams = params.filter(p => p.threshold != null).map(p => ({ param: p.name, threshold: p.threshold }));

    await loadEntries(); // load DB rows, which may extend headers
    renderParamList();
    renderCriticalBox();
    fillVizOptions();
    buildTable();
  }

  /* ---------------------------
     Load entries from DB and convert to table rows
     --------------------------- */
  async function loadEntries() {
    const r = await apiFetch(`/api/experiments/${expId}/entries`);
    if (!r.ok) {
      rows = [];
      return;
    }
    const entries = Array.isArray(r.data) ? r.data : [];
    if (!entries.length) {
      rows = [];
      return;
    }

    // group by sample name
    const grouped = {};
    entries.forEach(e => {
      if (!grouped[e.name]) grouped[e.name] = { _ids: [] };
      grouped[e.name][e.param] = e.val;
      grouped[e.name]._ids.push(e.id);
    });

    // ensure headers include any seen params
    const all = new Set(headers);
    entries.forEach(e => all.add(e.param));
    headers = Array.from(all);

    // ensure Sample is first column
    if (!headers.includes("Sample")) headers.unshift("Sample");
    else {
      // move Sample to front if not first
      const idx = headers.indexOf("Sample");
      if (idx > 0) {
        headers.splice(idx, 1);
        headers.unshift("Sample");
      }
    }

    rows = Object.keys(grouped).map(s => {
      const obj = grouped[s];
      const arr = headers.map(h => (h === "Sample" ? s : (obj[h] ?? "")));
      arr._entryId = obj._ids.length ? obj._ids[obj._ids.length - 1] : null; // store last id (for delete)
      return arr;
    });
  }

  /* ---------------------------
     Render parameter list (read-only)
     --------------------------- */
  function renderParamList() {
    paramListEl.innerHTML = params.length
      ? params.map(p => `<div class="param-item"><b>${escapeHtml(p.name)}</b>${p.threshold != null ? ` • threshold: ${escapeHtml(String(p.threshold))}` : ""}</div>`).join("")
      : "No parameters defined";
  }

  /* ---------------------------
     Critical parameters UI
     --------------------------- */
  function renderCriticalBox() {
    critContainer.innerHTML = "";
    criticalParams.forEach((cp, idx) => {
      const row = document.createElement("div");
      row.className = "critical-row";
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.marginBottom = "6px";

      const sel = document.createElement("select");
      headers.forEach(h => {
        const o = document.createElement("option"); o.value = h; o.textContent = h;
        if (h === cp.param) o.selected = true;
        sel.appendChild(o);
      });

      const thr = document.createElement("input");
      thr.type = "number";
      thr.value = cp.threshold == null ? "" : cp.threshold;

      const del = document.createElement("button");
      del.className = "btn-ghost";
      del.textContent = "×";

      sel.onchange = () => { cp.param = sel.value; saveCriticalsToParams(); renderParamList(); };
      thr.onchange = () => { cp.threshold = thr.value === "" ? null : Number(thr.value); saveCriticalsToParams(); renderParamList(); };
      del.onclick = () => { takeSnapshot(); criticalParams.splice(idx, 1); saveCriticalsToParams(); renderCriticalBox(); };

      row.appendChild(sel); row.appendChild(thr); row.appendChild(del);
      critContainer.appendChild(row);
    });
  }

  /* ---------------------------
     Save criticals into params[] and persist
     --------------------------- */
  function saveCriticalsToParams() {
    // clear thresholds
    params.forEach(p => p.threshold = null);
    // apply criticals
    criticalParams.forEach(cp => {
      const obj = params.find(p => p.name === cp.param);
      if (obj) obj.threshold = (cp.threshold == null ? null : Number(cp.threshold));
      else {
        // add missing param if necessary
        params.push({ name: cp.param, threshold: cp.threshold == null ? null : Number(cp.threshold) });
        if (!headers.includes(cp.param)) headers.push(cp.param);
      }
    });

    // persist params
    apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });
    renderParamList();
    fillVizOptions();
  }

  addCritBtn.onclick = () => {
    takeSnapshot();
    const pick = headers.find(h => h !== "Sample") || headers[0] || "Sample";
    criticalParams.push({ param: pick, threshold: null });
    renderCriticalBox();
    saveCriticalsToParams();
  };

  /* ---------------------------
     Add parameter (manual)
     --------------------------- */
  addParamBtn.onclick = async () => {
    const name = (newParamInput.value || "").trim();
    if (!name) return toast("Enter parameter name", true);
    if (params.some(p => p.name === name)) return toast("Parameter already exists", true);

    takeSnapshot();
    params.push({ name, threshold: null });
    // ensure headers structure
    if (!headers.length) headers = ["Sample", name];
    else headers.push(name);

    rows.forEach(r => r.push("")); // expand rows

    newParamInput.value = "";

    // persist columns
    const resp = await apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });
    if (!resp.ok) toast("Failed to save param", true);
    renderParamList(); renderCriticalBox(); fillVizOptions(); buildTable();
  };

  /* ---------------------------
     Import file (CSV/TSV/XLSX)
     --------------------------- */
  importBtn.onclick = async () => {
    const f = fileInput.files[0];
    if (!f) return toast("Choose a file", true);

    takeSnapshot(); // destructive action snapshot

    let arr = [];
    try {
      const name = (f.name || "").toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf);
        arr = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      } else {
        const text = await f.text();
        const delim = text.includes("\t") ? "\t" : ",";
        arr = text.split(/\r?\n/).filter(Boolean).map(l => l.split(delim));
      }
    } catch (err) {
      console.error(err);
      return toast("Parse failed", true);
    }

    if (!arr.length) return toast("File empty", true);

    const hdr = arr[0].map(x => String(x || "").trim());
    const dataRows = arr.slice(1).map(r => r.map(c => String(c || "")));

    headers = hdr.length ? hdr : [];
    rows = dataRows.length ? dataRows.map(r => { const a = Array.from(r); while (a.length < headers.length) a.push(""); return a; }) : [];

    // ensure Sample header present as first col
    if (!headers.includes("Sample")) {
      headers.unshift("Sample");
      rows = rows.map(r => ["", ...r]);
    } else {
      // ensure Sample is first column
      const idx = headers.indexOf("Sample");
      if (idx > 0) {
        headers.splice(idx, 1);
        headers.unshift("Sample");
        rows = rows.map(r => {
          const arr = Array.from(r);
          const val = arr.splice(idx, 1)[0];
          arr.unshift(val);
          return arr;
        });
      }
    }

    // sync params from headers (preserve existing param thresholds when possible)
    params = headers.map(h => {
      const existing = params.find(p => p.name === h);
      return existing ? existing : { name: h, threshold: null };
    });

    // remove duplicate headers while preserving order
    const seen = new Set();
    headers = headers.filter(h => {
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    });

    // persist params
    await apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });

    criticalParams = params.filter(p => p.threshold != null).map(p => ({ param: p.name, threshold: p.threshold }));

    renderParamList(); renderCriticalBox(); fillVizOptions(); buildTable();
    toast("File imported");
  };

  /* ---------------------------
     Fill visualization choices
     --------------------------- */
  function fillVizOptions() {
    vizParam.innerHTML = `<option value="">— choose —</option>`;
    headers.forEach(h => {
      const o = document.createElement("option"); o.value = h; o.textContent = h;
      vizParam.appendChild(o);
    });
  }

  /* ---------------------------
     Build table (headers + rows)
     - Column delete button exists; Sample protected (delete disabled)
     --------------------------- */
  function buildTable() {
    entryContainer.innerHTML = "";
    const table = document.createElement("table");
    table.className = "sheetTable";

    // header
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");

    headers.forEach((h, ci) => {
      const th = document.createElement("th");
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.gap = "6px";
      wrapper.style.alignItems = "center";

      const inp = document.createElement("input");
      inp.value = h;
      inp.onchange = () => {
        const old = headers[ci];
        const nv = inp.value.trim() || `col_${ci}`;
        takeSnapshot();
        headers[ci] = nv;
        const p = params.find(x => x.name === old);
        if (p) p.name = nv;
        criticalParams.forEach(cp => { if (cp.param === old) cp.param = nv; });
        apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });
        renderParamList(); renderCriticalBox(); fillVizOptions();
      };
      wrapper.appendChild(inp);

      // delete column button
      const delColBtn = document.createElement("button");
      delColBtn.className = "btn-ghost";
      delColBtn.textContent = "🗑";
      delColBtn.title = "Delete column / parameter";
      // disable deletion for Sample header
      if (h === "Sample") {
        delColBtn.disabled = true;
        delColBtn.title = "Cannot delete Sample column";
        delColBtn.style.opacity = 0.5;
        delColBtn.style.cursor = "not-allowed";
      } else {
        delColBtn.onclick = async () => {
          if (!confirm(`Delete column "${headers[ci]}"? This removes the parameter and all values in this column from view. (DB entries will be removed when you click Save All)`)) return;
          takeSnapshot();
          const removed = headers.splice(ci, 1)[0];
          // remove from params
          params = params.filter(p => p.name !== removed);
          // remove from critical params
          criticalParams = criticalParams.filter(cp => cp.param !== removed);
          // remove column from rows
          rows = rows.map(r => { const a = Array.from(r); a.splice(ci, 1); return a; });
          // persist params change
          await apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });
          renderParamList(); renderCriticalBox(); fillVizOptions(); buildTable();
        };
      }
      wrapper.appendChild(delColBtn);

      th.appendChild(wrapper);
      trh.appendChild(th);
    });

    const thDel = document.createElement("th");
    thDel.textContent = "Delete row";
    trh.appendChild(thDel);
    thead.appendChild(trh);
    table.appendChild(thead);

    // body
    const tbody = document.createElement("tbody");
    rows.forEach((r, ri) => {
      const tr = document.createElement("tr");
      headers.forEach((h, ci) => {
        const td = document.createElement("td");
        const inp = document.createElement("input");
        inp.value = r[ci] ?? "";
        inp.oninput = () => { rows[ri][ci] = inp.value; };
        td.appendChild(inp);
        tr.appendChild(td);
      });

      const tdDel = document.createElement("td");
      tdDel.classList.add("delete-cell");
      const btnDel = document.createElement("button");
      btnDel.className = "btn-ghost";
      btnDel.textContent = "×";
      btnDel.onclick = async () => {
        takeSnapshot();
        const entryId = r._entryId;
        rows.splice(ri, 1);
        buildTable();
        if (entryId) {
          await apiFetch(`/api/entries/${entryId}`, { method: "DELETE" });
          toast("Row deleted (DB entry removed)");
        } else {
          toast("Row deleted");
        }
      };
      tdDel.appendChild(btnDel);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    entryContainer.appendChild(table);

    // undo button state
    if (lastSnapshot) undoBtn.disabled = false; else undoBtn.disabled = true;
  }

  /* ---------------------------
     Add Row
     --------------------------- */
  addRowBtn.onclick = () => {
    takeSnapshot();
    // ensure headers exist; if not, create a Sample column by default
    if (!headers.length) {
      headers = ["Sample"];
      params = [{ name: "Sample", threshold: null }];
    }
    const blank = Array(headers.length).fill("");
    rows.push(blank);
    buildTable();
  };

  /* ---------------------------
     Save All - replace DB entries
     --------------------------- */
  saveAllBtn.onclick = async () => {
    const sampleIdx = headers.indexOf("Sample");
    if (sampleIdx < 0) return toast("Add a 'Sample' column or import a file with Sample column", true);

    // build bulk
    const bulk = [];
    rows.forEach(r => {
      const sample = (r[sampleIdx] || "").trim();
      if (!sample) return;
      headers.forEach((h, ci) => {
        if (ci === sampleIdx) return;
        const v = r[ci];
        if (v === "" || v == null) return;
        const num = Number(v);
        bulk.push({ name: sample, param: h, val: isNaN(num) ? v : num });
      });
    });

    if (!bulk.length) return toast("Nothing to save", true);

    // delete existing, then insert bulk
    const delRes = await apiFetch(`/api/experiments/${expId}/entries`, { method: "DELETE" });
    if (!delRes.ok) {
      toast("Failed to clear existing entries", true);
      return;
    }

    const res = await apiFetch(`/api/experiments/${expId}/entries/bulk`, {
      method: "POST", body: JSON.stringify({ rows: bulk })
    });
    if (!res.ok) return toast("Save failed", true);

    // persist params (columns + thresholds)
    await apiFetch(`/api/experiments/${expId}`, { method: "PUT", body: JSON.stringify({ params }) });

    // reload DB rows (to refresh _entryId values)
    await loadEntries();
    buildTable();
    toast("Saved (database replaced)");
    clearSnapshot();
  };

  /* ---------------------------
     Undo (single-step)
     --------------------------- */
  undoBtn.onclick = () => {
    restoreSnapshot();
  };

  /* ---------------------------
     Entry filter
     --------------------------- */
  entryFilter.oninput = () => {
    const q = (entryFilter.value || "").toLowerCase();
    entryContainer.querySelectorAll("tbody tr").forEach(tr => {
      tr.style.display = tr.innerText.toLowerCase().includes(q) ? "" : "none";
    });
  };

  /* ---------------------------
     Visualization
     --------------------------- */
  function fillVizOptions() {
    vizParam.innerHTML = `<option value="">— choose —</option>`;
    headers.forEach(h => {
      const o = document.createElement("option"); o.value = h; o.textContent = h; vizParam.appendChild(o);
    });
  }
  drawVizBtn.onclick = () => {
    const h = vizParam.value;
    if (!h) return toast("Choose parameter", true);
    const sampleIdx = headers.indexOf("Sample");
    const labels = []; const values = [];
    rows.forEach(r => {
      const s = sampleIdx >= 0 ? r[sampleIdx] : "";
      const v = r[headers.indexOf(h)];
      if (s && v !== "" && !isNaN(Number(v))) { labels.push(s); values.push(Number(v)); }
    });
    if (!values.length) return toast("No numeric data", true);
    if (window._sheetChart) window._sheetChart.destroy();
    window._sheetChart = new Chart(vizCanvas.getContext("2d"), {
      type: vizType.value === "hist" ? "bar" : vizType.value,
      data: { labels, datasets: [{ label: h, data: values }] }
    });
  };

  /* ---------------------------
     Delete experiment
     --------------------------- */
  deleteExpBtn.onclick = async () => {
    if (!confirm("Delete entire experiment?")) return;
    const r = await apiFetch(`/api/experiments/${expId}`, { method: "DELETE" });
    if (!r.ok) return toast("Delete failed", true);
    location.href = "/experiments";
  };

  // initial load
  loadExperiment();
};

/* ============================================================
   Alerts Page
   - simplified: no clear buttons in UI
   ============================================================ */
window.initAlertsPage = async () => {
  setupDarkToggle();
  bindLogoutBtn();
  const tb = document.querySelector("#alertsTable tbody");
  const r = await apiFetch("/api/alerts");
  if (!r.ok) {
    tb.innerHTML = `<tr><td colspan="5">Failed to load alerts</td></tr>`;
    return;
  }
  const rows = Array.isArray(r.data) ? r.data : [];
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="5">No alerts</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(a => `
    <tr>
      <td>${escapeHtml(a.id)}</td>
      <td>${escapeHtml(a.experiment)}</td>
      <td>${escapeHtml(a.message)}</td>
      <td>${escapeHtml(a.level)}</td>
      <td>${escapeHtml(a.time)}</td>
    </tr>
  `).join("");
};

/* ============================================================
   Dashboard
   - counts and a simple trend from the latest experiment entries
   ============================================================ */
window.initDashboard = async () => {
  setupDarkToggle();
  bindLogoutBtn();

  const expCountEl = document.getElementById("expCount");
  const sensorCountEl = document.getElementById("sensorCount");
  const alertCountEl = document.getElementById("alertCount");

  // experiments
  const expRes = await apiFetch("/api/experiments");
  const exps = expRes.ok && Array.isArray(expRes.data) ? expRes.data : [];
  expCountEl && (expCountEl.textContent = exps.length);

  // entries count
  let totalEntries = 0;
  for (const exp of exps) {
    const r = await apiFetch(`/api/experiments/${exp.id}/entries`);
    if (r.ok && Array.isArray(r.data)) totalEntries += r.data.length;
  }
  sensorCountEl && (sensorCountEl.textContent = totalEntries);

  // alerts
  const alertRes = await apiFetch("/api/alerts");
  const alerts = alertRes.ok && Array.isArray(alertRes.data) ? alertRes.data : [];
  alertCountEl && (alertCountEl.textContent = alerts.length);

  // trend chart: collect numeric values from most recent experiment (if any)
  const ctx = document.getElementById("chart") ? document.getElementById("chart").getContext("2d") : null;
  if (ctx && exps.length) {
    const lastExp = exps[0];
    const r = await apiFetch(`/api/experiments/${lastExp.id}/entries`);
    if (r.ok && Array.isArray(r.data) && r.data.length) {
      // pick numeric entries — group by param and pick first numeric param for display
      const numeric = r.data.filter(e => !isNaN(Number(e.val)));
      if (numeric.length) {
        const labels = numeric.map(e => e.name);
        const values = numeric.map(e => Number(e.val));
        new Chart(ctx, {
          type: "line",
          data: { labels, datasets: [{ label: "Recent Values", data: values, borderWidth: 2 }] }
        });
      }
    }
  }
};

/* ============================================================
   Global init
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  setupDarkToggle();
  bindLogoutBtn();

  const lf = document.getElementById("loginForm");
  if (lf) bindLoginForm(lf);
  const rf = document.getElementById("registerForm");
  if (rf) bindRegisterForm(rf);
  if (document.getElementById("expTable")) window.initExperimentsPage();
  if (document.getElementById("criticalParamContainer")) window.initExperimentView();
  if (document.getElementById("alertsTable")) window.initAlertsPage();
  if (document.getElementById("expCount")) window.initDashboard();
});

