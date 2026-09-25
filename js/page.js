/* 页面业务文件：标记台与测线/浮标回收台的渲染与交互。
   判定调用 Judge，持久化与留档调用 Archive。 */
(function () {
  "use strict";

  var num = Judge.num;
  var typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
  var statusNames = { normal: "正常", resurvey: "待复测", deployed: "未回收" };

  /* ---------- 状态与种子数据 ---------- */

  var marks = Archive.loadMarks();
  var lines = Archive.loadLines();
  var archives = Archive.listArchives();
  var pending = null; // 待保存标记的点击坐标

  if (!marks.length && !lines.length && !archives.length) {
    marks = [
      { id: uid(), code: "A-017", type: "ceramic", lineCode: "L-01", seq: 1, dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋" },
      { id: uid(), code: "W-003", type: "wood", lineCode: "L-01", seq: 2, dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁" }
    ];
    lines = [
      // 正常测线
      {
        id: uid(), code: "L-01", version: 1, buoyCode: "B-01",
        startPoint: "BP-甲", endPoint: "BP-乙",
        deployStartX: 34, deployStartY: 62, deployEndX: 66, deployEndY: 26,
        deployedAt: "2026-09-20T08:30", siltDeploy: 12,
        recoveredAt: "2026-09-22T09:10", siltRecover: 13,
        recoverStartX: 34, recoverStartY: 62, recoverEndX: 66, recoverEndY: 26,
        currentSpeed: 0.25, foundLineCode: "L-01",
        surveyor: "陈海", note: "基线稳定", resurveyHistory: [], orderedDives: ["DIVE-01", "DIVE-02"]
      },
      // 两端坐标不一致
      {
        id: uid(), code: "L-02", version: 1, buoyCode: "B-02",
        startPoint: "BP-丙", endPoint: "BP-丁",
        deployStartX: 20, deployStartY: 70, deployEndX: 48, deployEndY: 30,
        deployedAt: "2026-09-21T08:00", siltDeploy: 10,
        recoveredAt: "2026-09-23T10:00", siltRecover: 11,
        recoverStartX: 23, recoverStartY: 74, recoverEndX: 52, recoverEndY: 27,
        currentSpeed: 0.42, foundLineCode: "L-02",
        surveyor: "林洲", note: "浮标位置漂移", resurveyHistory: []
      },
      // 淤积多两成 + 浮标串线
      {
        id: uid(), code: "L-03", version: 1, buoyCode: "B-03",
        startPoint: "BP-戊", endPoint: "BP-己",
        deployStartX: 55, deployStartY: 68, deployEndX: 82, deployEndY: 40,
        deployedAt: "2026-09-21T09:20", siltDeploy: 10,
        recoveredAt: "2026-09-23T11:30", siltRecover: 15,
        recoverStartX: 55, recoverStartY: 68, recoverEndX: 82, recoverEndY: 40,
        currentSpeed: 0.35, foundLineCode: "L-04",
        surveyor: "陈海", note: "淤泥明显增厚", resurveyHistory: []
      },
      // 仅布设、尚未回收
      {
        id: uid(), code: "L-04", version: 1, buoyCode: "B-04",
        startPoint: "BP-庚", endPoint: "BP-辛",
        deployStartX: 12, deployStartY: 40, deployEndX: 40, deployEndY: 18,
        deployedAt: "2026-09-24T07:50", siltDeploy: 8,
        recoveredAt: "", siltRecover: null,
        recoverStartX: null, recoverStartY: null, recoverEndX: null, recoverEndY: null,
        currentSpeed: null, foundLineCode: "L-04",
        surveyor: "林洲", note: "", resurveyHistory: []
      }
    ];
    lines.forEach(function (l) { l.judged = Judge.judgeLine(l); });
    persistMarks();
    persistLines();
  }

  lines.forEach(function (l) { l.judged = Judge.judgeLine(l); });

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }
  function persistMarks() { Archive.saveMarks(marks); }
  function persistLines() { Archive.saveLines(lines); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nowLocal() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function fmtTime(v) {
    return v ? String(v).replace("T", " ") : "—";
  }

  /* ---------- 顶部页签 ---------- */

  var pageMarks = document.querySelector("#pageMarks");
  var pageLines = document.querySelector("#pageLines");
  var subtitle = document.querySelector("#subtitle");
  var tabMarks = document.querySelector("#tabMarks");
  var tabLines = document.querySelector("#tabLines");

  tabMarks.onclick = function () { switchTab("marks"); };
  tabLines.onclick = function () { switchTab("lines"); };

  function switchTab(name) {
    var isLines = name === "lines";
    pageLines.classList.toggle("hidden", !isLines);
    pageMarks.classList.toggle("hidden", isLines);
    tabLines.classList.toggle("active", isLines);
    tabMarks.classList.toggle("active", !isLines);
    subtitle.textContent = isLines
      ? "测线与浮标回收台：登记测线与回收数据，自动判定待复测，复测由另一名测绘员确认并留档。"
      : "标记台：点击沉船平面图添加标记，筛选、编辑并导出JSON。";
    if (isLines) renderLinesPage();
  }

  /* =========================================================
     标记台（原有视图与导出保留）
     ========================================================= */

  var map = document.querySelector("#map");
  var form = document.querySelector("#form");
  var list = document.querySelector("#list");
  var filter = document.querySelector("#filter");
  var viewSel = document.querySelector("#view");
  var listTitle = document.querySelector("#listTitle");
  var lineSelect = form.elements.lineCode;

  for (var i = 0; i < 7; i++) {
    var rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  function syncLineOptions(selected) {
    var current = selected !== undefined ? selected : lineSelect.value;
    lineSelect.innerHTML = '<option value="">不关联</option>' +
      lines.map(function (l) {
        return '<option value="' + esc(l.code) + '"' +
          (l.code === current ? " selected" : "") + ">" + esc(l.code) +
          "（v" + (l.version || 1) + "）</option>";
      }).join("");
  }

  function render() {
    map.querySelectorAll(".marker").forEach(function (el) { el.remove(); });
    var filtered = filter.value ? marks.filter(function (m) { return m.type === filter.value; }) : marks;
    filtered.forEach(function (mark) {
      var el = document.createElement("button");
      el.className = "marker " + mark.type + (mark.id === form.id.value ? " selected" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.title = mark.code;
      el.textContent = mark.code.slice(0, 2);
      el.onclick = function (event) { event.stopPropagation(); editMark(mark.id); };
      map.appendChild(el);
    });
    if (viewSel.value === "timeline") renderTimeline(filtered);
    else renderMarkList(filtered);
  }

  function renderMarkList(data) {
    listTitle.textContent = "标记列表";
    list.className = "list";
    list.innerHTML = data.map(function (m) {
      var seq = m.seq ? ' <span class="pill">#' + esc(m.seq) + "</span>" : "";
      var line = m.lineCode ? ' <span class="pill">' + esc(m.lineCode) + "</span>" : "";
      return '<div class="item ' + (m.id === form.id.value ? "active" : "") +
        '" data-id="' + esc(m.id) + '"><b>' + esc(m.code) + "</b>" +
        ' <span class="pill">' + typeNames[m.type] + "</span>" + line + seq +
        '<div class="muted">' + esc(m.dive) + " · " + esc(m.depth) + " · " +
        esc(m.orientation) + "</div><div>" + esc(m.condition) + "</div></div>";
    }).join("");
    list.querySelectorAll("[data-id]").forEach(function (el) {
      el.onclick = function () { editMark(el.dataset.id); };
    });
  }

  function renderTimeline(data) {
    listTitle.textContent = "潜次时间线";
    list.className = "timeline";
    var groups = data.reduce(function (g, item) {
      (g[item.dive] || (g[item.dive] = [])).push(item);
      return g;
    }, {});
    // 测线修订后重排的潜次顺序优先
    var order = diveOrder();
    var dives = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1) ia = 999;
      if (ib === -1) ib = 999;
      return ia === ib ? (a < b ? -1 : a > b ? 1 : 0) : ia - ib;
    });
    list.innerHTML = dives.map(function (dive) {
      var items = groups[dive];
      var note = order.indexOf(dive) >= 0 ? "（按修订后测线顺序）" : "";
      return '<div class="item"><b>' + esc(dive) + "</b>" +
        '<div class="muted">新增' + items.length + "个标记" + note + "</div>" +
        items.map(function (it) {
          return "<div>" + esc(it.code) + " · " + typeNames[it.type] +
            (it.lineCode ? " · " + esc(it.lineCode) : "") + "</div>";
        }).join("") + "</div>";
    }).join("");
  }

  function diveOrder() {
    var revised = lines.filter(function (l) {
      return Array.isArray(l.orderedDives) && l.orderedDives.length &&
        (l.resurveyHistory || []).length;
    });
    var order = [];
    revised.forEach(function (l) {
      l.orderedDives.forEach(function (d) {
        if (order.indexOf(d) === -1) order.push(d);
      });
    });
    return order;
  }

  function editMark(id) {
    var mark = marks.find(function (m) { return m.id === id; });
    if (!mark) return;
    syncLineOptions(mark.lineCode || "");
    Object.entries(mark).forEach(function (kv) {
      if (form[kv[0]]) form[kv[0]].value = kv[1] == null ? "" : kv[1];
    });
    pending = { x: mark.x, y: mark.y };
    render();
  }

  map.addEventListener("click", function (event) {
    var rect = map.getBoundingClientRect();
    pending = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    form.reset();
    form.id.value = "";
    form.code.value = "M-" + String(marks.length + 1).padStart(3, "0");
    form.dive.value = "DIVE-01";
    syncLineOptions("");
    render();
  });

  form.onsubmit = function (event) {
    event.preventDefault();
    if (!pending) pending = { x: 50, y: 50 };
    var data = Object.fromEntries(new FormData(form).entries());
    var lineCode = data.lineCode || "";
    if (data.id) {
      var existing = marks.find(function (m) { return m.id === data.id; });
      var oldLine = existing.lineCode || "";
      Object.assign(existing, data, pending);
      existing.lineCode = lineCode;
      if (lineCode && (oldLine !== lineCode || existing.seq == null)) {
        existing.seq = nextSeq(lineCode);
      }
      if (!lineCode) existing.seq = null;
    } else {
      var mark = Object.assign({ id: uid() }, data, pending);
      mark.lineCode = lineCode;
      mark.seq = lineCode ? nextSeq(lineCode) : null;
      marks.push(mark);
    }
    persistMarks();
    syncLineOptions(lineCode);
    render();
  };

  function nextSeq(lineCode) {
    var seqs = marks.filter(function (m) { return m.lineCode === lineCode && m.seq; })
      .map(function (m) { return m.seq; });
    return seqs.length ? Math.max.apply(null, seqs) + 1 : 1;
  }

  document.querySelector("#deleteBtn").onclick = function () {
    if (!form.id.value) return;
    marks = marks.filter(function (m) { return m.id !== form.id.value; });
    form.reset();
    pending = null;
    persistMarks();
    syncLineOptions("");
    render();
  };

  document.querySelector("#exportBtn").onclick = function () {
    Archive.exportMarks(marks); // 原有导出：dive-marks.json
  };

  filter.onchange = render;
  viewSel.onchange = render;

  /* =========================================================
     测线与浮标回收台
     ========================================================= */

  var lineListEl = document.querySelector("#lineList");
  var archiveListEl = document.querySelector("#archiveList");
  var lineFilter = document.querySelector("#lineFilter");
  var lineForm = document.querySelector("#lineForm");
  var lineCancelBtn = document.querySelector("#lineCancelBtn");
  var resurveyForm = document.querySelector("#resurveyForm");
  var resurveyInfo = document.querySelector("#resurveyInfo");
  var resurveyError = document.querySelector("#resurveyError");
  var editingLineId = null;

  lineFilter.onchange = renderLinesPage;

  document.querySelector("#newLineBtn").onclick = newLineForm;

  document.querySelector("#exportLinesBtn").onclick = function () {
    Archive.exportLines(lines, marks);
  };

  function renderLinesPage() {
    syncLineOptions(lineSelect.value);
    var f = lineFilter.value;
    var shown = lines.filter(function (l) { return !f || l.judged.status === f; });
    lineListEl.innerHTML = shown.map(function (l) {
      var j = l.judged;
      var reasons = j.reasons.length
        ? '<ul class="reasons">' + j.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>"
        : "";
      var silt = [l.siltDeploy, l.siltRecover].map(function (v) { return v == null || v === "" ? "—" : v + "cm"; }).join(" → ");
      var coord = function (x, y) {
        return num(x) === null || num(y) === null ? "—" : num(x) + "," + num(y);
      };
      var resurveyBtn = j.status === "resurvey"
        ? '<button type="button" class="danger" data-act="resurvey" data-id="' + esc(l.id) + '">复测确认</button>'
        : "";
      var dives = (l.orderedDives || []).length
        ? '<div class="muted">潜次顺序：' + l.orderedDives.map(esc).join(" → ") + "</div>"
        : "";
      var linked = marks.filter(function (m) { return m.lineCode === l.code; }).length;
      return '<div class="line-card ' + j.status + '">' +
        '<div class="line-head"><b>' + esc(l.code) + " v" + (l.version || 1) + "</b>" +
        '<span class="pill status ' + j.status + '">' + statusNames[j.status] + "</span>" +
        '<span class="spacer"></span>' +
        '<button type="button" class="secondary" data-act="edit" data-id="' + esc(l.id) + '">修订登记</button>' +
        resurveyBtn + "</div>" +
        '<div class="muted">浮标 ' + esc(l.buoyCode || "—") + " · 基线 " +
        esc(l.startPoint || "—") + " → " + esc(l.endPoint || "—") + " · 关联标记" + linked + "个</div>" +
        '<div class="muted">布设 ' + fmtTime(l.deployedAt) + " / 回收 " + fmtTime(l.recoveredAt) +
        " · 流速 " + (l.currentSpeed == null || l.currentSpeed === "" ? "—" : l.currentSpeed + "m/s") +
        " · 淤积 " + silt + "</div>" +
        '<div class="muted">布设坐标 ' + coord(l.deployStartX, l.deployStartY) + " | " +
        coord(l.deployEndX, l.deployEndY) + "<br>回收坐标 " +
        coord(l.recoverStartX, l.recoverStartY) + " | " + coord(l.recoverEndX, l.recoverEndY) + "</div>" +
        dives + reasons + "</div>";
    }).join("") || '<div class="muted">暂无符合条件的测线。</div>';

    lineListEl.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.onclick = function () {
        var l = lines.find(function (x) { return x.id === btn.dataset.id; });
        if (!l) return;
        if (btn.dataset.act === "resurvey") startResurvey(l);
        else editLine(l);
      };
    });

    renderArchives();
  }

  function renderArchives() {
    if (!archives.length) {
      archiveListEl.innerHTML = '<div class="muted">尚无旧版留档。</div>';
      return;
    }
    archiveListEl.innerHTML = archives.map(function (r) {
      var reasons = r.judged && r.judged.reasons && r.judged.reasons.length
        ? r.judged.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("")
        : "<li>常规留档</li>";
      return '<details class="archive-card"><summary><b>' + esc(r.code) + " v" + esc(r.version) +
        "</b><span class=\"pill\">" + esc(r.reason) + "</span>" +
        '<span class="muted">' + fmtTime(r.confirmedAt) + " · " +
        esc(r.confirmedBy || "—") + "</span></summary>" +
        '<div class="body"><ul class="reasons">' + reasons + "</ul>" +
        '<div class="muted">留档时间 ' + fmtTime(r.archivedAt) + "</div>" +
        '<pre style="white-space:pre-wrap;margin:6px 0 0;font-size:12px">' +
        esc(JSON.stringify(r.snapshot, null, 2)) + "</pre></div></details>";
    }).join("");
  }

  /* ---------- 测线登记 / 修订 ---------- */

  var lineNumFields = ["deployStartX", "deployStartY", "deployEndX", "deployEndY",
    "siltDeploy", "siltRecover", "recoverStartX", "recoverStartY", "recoverEndX", "recoverEndY",
    "currentSpeed"];

  function fillLineForm(l) {
    lineForm.reset();
    lineForm.querySelectorAll("[name]").forEach(function (el) {
      var v = l[el.name];
      el.value = v == null ? "" : v;
    });
    lineForm.version.value = l.version || 1;
  }

  function newLineForm() {
    lineForm.reset();
    editingLineId = null;
    lineForm.version.value = "1";
    lineForm.code.value = "L-" + String(lines.length + 1).padStart(2, "0");
    lineForm.foundLineCode.value = lineForm.code.value;
    lineForm.deployedAt.value = nowLocal();
    document.querySelector("#lineFormTitle").textContent = "测线登记";
    lineCancelBtn.classList.add("hidden");
    lineForm.classList.remove("hidden");
    resurveyForm.classList.add("hidden");
    lineForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function editLine(l) {
    editingLineId = l.id;
    fillLineForm(l);
    document.querySelector("#lineFormTitle").textContent = "测线登记 · 修订 " + l.code + " v" + (l.version || 1);
    lineCancelBtn.classList.remove("hidden");
    lineForm.classList.remove("hidden");
    resurveyForm.classList.add("hidden");
    lineForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  lineCancelBtn.onclick = function () {
    editingLineId = null;
    lineForm.reset();
    lineCancelBtn.classList.add("hidden");
    document.querySelector("#lineFormTitle").textContent = "测线登记";
  };

  lineForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var d = Object.fromEntries(new FormData(lineForm).entries());
    lineNumFields.forEach(function (k) { d[k] = num(d[k]); });
    d.foundLineCode = (d.foundLineCode || "").trim() || d.code;
    d.note = d.note || "";
    d.buoyCode = d.buoyCode || "";
    d.startPoint = d.startPoint || "";
    d.endPoint = d.endPoint || "";
    d.orderedDives = [];
    d.resurveyHistory = [];

    if (editingLineId) {
      var idx = lines.findIndex(function (x) { return x.id === editingLineId; });
      if (idx === -1) return;
      var old = lines[idx];
      d.id = old.id;
      d.resurveyHistory = old.resurveyHistory || [];
      d.orderedDives = old.orderedDives || [];
      // 测线号变更：同步关联标记与旧版引用
      if (old.code !== d.code) {
        marks.forEach(function (m) {
          if (m.lineCode === old.code) m.lineCode = d.code;
        });
        persistMarks();
      }
      lines[idx] = withJudge(d);
      editingLineId = null;
      lineCancelBtn.classList.add("hidden");
      document.querySelector("#lineFormTitle").textContent = "测线登记";
    } else {
      d.id = uid();
      lines.push(withJudge(d));
    }
    lineForm.reset();
    lineForm.version.value = "1";
    persistLines();
    syncLineOptions(lineSelect.value);
    render();
    renderLinesPage();
  });

  function withJudge(l) {
    l.judged = Judge.judgeLine(l);
    return l;
  }

  /* ---------- 复测确认 ---------- */

  var resurveyLineId = null;
  document.querySelector("#resurveyCancelBtn").onclick = function () {
    resurveyForm.classList.add("hidden");
    resurveyError.classList.add("hidden");
    resurveyLineId = null;
  };

  function startResurvey(l) {
    resurveyLineId = l.id;
    document.querySelector("#resurveyTitle").textContent = "复测确认 · " + l.code + " v" + (l.version || 1);
    resurveyInfo.innerHTML = "原测绘员：<b>" + esc(l.surveyor) + "</b>，复测须由<b>另一名测绘员</b>确认并重设基线。" +
      (l.resurveyHistory && l.resurveyHistory.length
        ? " 已复测 " + l.resurveyHistory.length + " 次。" : "");
    resurveyForm.reset();
    resurveyError.classList.add("hidden");
    var f = resurveyForm.elements;
    f.resetStartPoint.value = l.startPoint || "";
    f.resetEndPoint.value = l.endPoint || "";
    f.resetStartX.value = l.deployStartX == null ? "" : l.deployStartX;
    f.resetStartY.value = l.deployStartY == null ? "" : l.deployStartY;
    f.resetEndX.value = l.deployEndX == null ? "" : l.deployEndX;
    f.resetEndY.value = l.deployEndY == null ? "" : l.deployEndY;
    f.confirmedAt.value = nowLocal();
    f.resilt.value = l.siltRecover == null ? "" : l.siltRecover;
    f.recurrent.value = l.currentSpeed == null ? "" : l.currentSpeed;
    lineForm.classList.add("hidden");
    resurveyForm.classList.remove("hidden");
    resurveyForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  resurveyForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var line = lines.find(function (x) { return x.id === resurveyLineId; });
    if (!line) return;
    var input = Object.fromEntries(new FormData(resurveyForm).entries());
    var error = Judge.validateResurvey(line, input);
    if (error) {
      resurveyError.textContent = error;
      resurveyError.classList.remove("hidden");
      return;
    }
    // 旧版留档 -> 构建新版本（内部重排关联标记与潜次顺序）-> 存档与持久化
    var judged = Judge.judgeLine(line);
    var rev = Judge.buildRevision(line, input, marks);
    archives = Archive.archiveVersion(line, {
      reason: "复测重设基线",
      confirmer: input.confirmer,
      confirmedAt: input.confirmedAt,
      judged: judged
    });
    var idx = lines.findIndex(function (x) { return x.id === line.id; });
    lines[idx] = rev;
    persistLines();
    persistMarks();
    resurveyForm.classList.add("hidden");
    resurveyError.classList.add("hidden");
    resurveyLineId = null;
    render();
    renderLinesPage();
  });

  /* ---------- 启动 ---------- */

  syncLineOptions("");
  // 测线登记表默认值：下一个测线号、浮标默认归位、布设时刻默认当前
  lineForm.code.value = "L-" + String(lines.length + 1).padStart(2, "0");
  lineForm.foundLineCode.value = lineForm.code.value;
  lineForm.deployedAt.value = nowLocal();
  render();
})();
