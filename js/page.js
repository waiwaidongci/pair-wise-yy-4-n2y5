/*
 * 页面业务（page.js）
 * 标记页扩展为「测线与浮标回收台」：
 *  - 原标记列表、潜次时间线两个视图、筛选与 JSON 导出保持可用
 *  - 新增测线回收台：登记测线号、两端基线点、布设/回收时刻、流速、淤积与浮标
 *  - 判定结果（judge.js）驱动“待复测”，复测由另一名测绘员确认并重设基线
 *  - 修订后关联标记改挂新版测线，潜次顺序重排，旧版经 archive.js 留档
 */
(function () {
  "use strict";

  // ---------- 状态 ----------
  function seed() {
    const a = Judge.genId(), b = Judge.genId(), c = Judge.genId();
    const l1 = Judge.genId(), l2 = Judge.genId();
    const marks = [
      { id: a, code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋", lineId: l1 },
      { id: b, code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁", lineId: l1 },
      { id: c, code: "M-021", type: "unknown", dive: "DIVE-03", x: 36, y: 61, depth: "19.0m", orientation: "", condition: "表面附着贝类", note: "", lineId: l2 }
    ];
    return {
      marks: marks,
      lines: [
        {
          id: l1, code: "L-01", version: 1, revisionId: 1,
          surveyor: "张舟",
          aName: "BA-1", aDeployX: 24, aDeployY: 30, aRecoverX: 24.2, aRecoverY: 30.1,
          bName: "BA-2", bDeployX: 72, bDeployY: 64, bRecoverX: 72.1, bRecoverY: 63.9,
          deployAt: "2026-09-10 08:20", recoverAt: "2026-09-12 15:40",
          flowDeploy: "0.3m/s", flowRecover: "0.4m/s",
          siltDeploy: 8, siltRecover: 9,
          buoyDeploy: "BUOY-11", buoyRecover: "BUOY-11", note: "船艏测线"
        },
        {
          id: l2, code: "L-02", version: 1, revisionId: 1,
          surveyor: "李潜",
          aName: "BA-3", aDeployX: 30, aDeployY: 70, aRecoverX: 31.8, aRecoverY: 72.4,
          bName: "BA-4", bDeployX: 68, bDeployY: 28, bRecoverX: 66.9, bRecoverY: 26.2,
          deployAt: "2026-09-11 07:50", recoverAt: "2026-09-13 16:10",
          flowDeploy: "0.4m/s", flowRecover: "0.9m/s",
          siltDeploy: 10, siltRecover: 13,
          buoyDeploy: "BUOY-12", buoyRecover: "BUOY-07", note: "船舯测线，回收时浮标移位"
        }
      ],
      archive: []
    };
  }

  let state = Archive.load() || seed();
  Archive.save(state); // 首次使用或旧版数据迁入后落盘
  let pendingPoint = null;

  // ---------- DOM ----------
  const map = document.querySelector("#map");
  const svg = document.querySelector("#linesSvg");
  const markForm = document.querySelector("#markForm");
  const lineForm = document.querySelector("#lineForm");
  const resurveyForm = document.querySelector("#resurveyForm");
  const list = document.querySelector("#list");
  const listTitle = document.querySelector("#listTitle");
  const filter = document.querySelector("#filter");
  const view = document.querySelector("#view");
  const markBox = document.querySelector("#markBox");
  const linesPane = document.querySelector("#linesPane");
  const lineListEl = document.querySelector("#lineList");
  const archiveListEl = document.querySelector("#archiveList");
  const resurveyBox = document.querySelector("#resurveyBox");
  const resurveyErrors = document.querySelector("#resurveyErrors");
  const lineError = document.querySelector("#lineError");
  const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
  const statusNames = { normal: "正常", pending: "待复测", archived: "已归档（旧版）" };

  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  function persist() { Archive.save(state); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function activeLine(id) { return state.lines.find(function (l) { return l.id === id; }); }
  function lineCode(id) {
    const l = activeLine(id);
    return l ? l.code + "(v" + l.version + ")" : "";
  }
  function isNum(v) { return v !== "" && v != null && Number.isFinite(Number(v)); }

  // ---------- 视图切换（原列表/时间线视图保留） ----------
  function showView() {
    const station = view.value === "lines";
    markBox.style.display = station ? "none" : "";
    list.style.display = station ? "none" : "";
    listTitle.style.display = station ? "none" : "";
    linesPane.style.display = station ? "" : "none";
    resurveyBox.style.display = resurveyBox.dataset.open === "1" ? "" : "none";
    if (!station) renderMarkPane();
    renderLinePane();
  }

  // ---------- 平面图：测线 + 标记 ----------
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(function (kv) { el.setAttribute(kv[0], kv[1]); });
    return el;
  }
  function hasRecoverPoint(line, p) {
    return isNum(line[p + "RecoverX"]) && isNum(line[p + "RecoverY"]);
  }

  function renderLines() {
    svg.innerHTML = "";
    state.lines.forEach(function (line) {
      const j = Judge.judgeLine(line, state.lines);
      const color = line.archived ? "#93a3a6" : (j.status === "pending" ? "#ff6b4a" : "#f0c75e");
      const faded = line.archived ? "0.45" : "0.95";
      const g = svgEl("g", { opacity: faded });

      const ax = line.aDeployX, ay = line.aDeployY, bx = line.bDeployX, by = line.bDeployY;
      g.appendChild(svgEl("line", {
        x1: ax, y1: ay, x2: bx, y2: by,
        stroke: color, "stroke-width": 2.4, "stroke-dasharray": "none"
      }));
      [["A", ax, ay, line.aName], ["B", bx, by, line.bName]].forEach(function (p) {
        g.appendChild(svgEl("rect", {
          x: p[1] - 3, y: p[2] - 3, width: 6, height: 6, fill: color
        }));
        g.appendChild(svgEl("text", {
          x: p[1] + 5, y: p[2] - 5, "font-size": 9,
          fill: "#fff", "paint-order": "stroke", stroke: "#07333f", "stroke-width": 2.6
        })).textContent = p[3];
      });

      if (hasRecoverPoint(line, "a") && hasRecoverPoint(line, "b") && Judge.hasRecovery(line)) {
        g.appendChild(svgEl("line", {
          x1: line.aRecoverX, y1: line.aRecoverY, x2: line.bRecoverX, y2: line.bRecoverY,
          stroke: color, "stroke-width": 2, "stroke-dasharray": "6 4", opacity: 0.8
        }));
      }

      const label = svgEl("text", {
        x: (Number(ax) + Number(bx)) / 2,
        y: (Number(ay) + Number(by)) / 2 - 6,
        "font-size": 11, "font-weight": 800,
        fill: color, "text-anchor": "middle",
        "paint-order": "stroke", stroke: "#07333f", "stroke-width": 3
      });
      label.textContent = line.code + " v" + line.version;
      g.appendChild(label);
      svg.appendChild(g);
    });
  }

  function renderMarkers() {
    map.querySelectorAll(".marker").forEach(function (el) { el.remove(); });
    const filtered = filter.value ? state.marks.filter(function (m) { return m.type === filter.value; }) : state.marks;
    filtered.forEach(function (mark) {
      const el = document.createElement("button");
      el.className = "marker " + mark.type + (mark.id === markForm.id.value ? " selected" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.textContent = mark.code.slice(0, 2);
      el.onclick = function (event) { event.stopPropagation(); editMark(mark.id); };
      map.appendChild(el);
    });
  }

  // ---------- 标记侧栏（原列表 / 时间线） ----------
  function renderLineOptions(selectedId) {
    const sel = markForm.querySelector("[name=lineId]");
    sel.innerHTML = '<option value="">未关联测线</option>' + state.lines.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === selectedId ? " selected" : "") + ">" +
             esc(l.code + " v" + l.version + (l.archived ? "（旧版）" : "")) + "</option>";
    }).join("");
  }

  function renderMarkPane() {
    const data = filter.value ? state.marks.filter(function (m) { return m.type === filter.value; }) : state.marks;
    if (view.value === "timeline") renderTimeline(data);
    else renderList(data);
  }

  function renderList(data) {
    listTitle.textContent = "标记列表";
    list.className = "list";
    list.innerHTML = data.map(function (m) {
      const badge = m.lineId && activeLine(m.lineId)
        ? ' <span class="pill linepill">' + esc(lineCode(m.lineId)) + "</span>" : "";
      return '<div class="item ' + (m.id === markForm.id.value ? "active" : "") + '" data-mark="' + esc(m.id) + '">' +
        "<b>" + esc(m.code) + '</b> <span class="pill">' + esc(typeNames[m.type]) + "</span>" + badge +
        '<div class="muted">' + esc(m.dive) + " · " + esc(m.depth) + " · " + esc(m.orientation || "—") + "</div>" +
        "<div>" + esc(m.condition || "") + "</div></div>";
    }).join("");
    list.querySelectorAll("[data-mark]").forEach(function (el) {
      el.onclick = function () { editMark(el.dataset.mark); };
    });
  }

  function renderTimeline(data) {
    listTitle.textContent = "潜次时间线";
    list.className = "timeline";
    const groups = data.reduce(function (acc, item) {
      (acc[item.dive] ||= []).push(item);
      return acc;
    }, {});
    list.innerHTML = Object.entries(groups).map(function (entry) {
      const items = entry[1];
      return '<div class="item"><b>' + esc(entry[0]) + '</b><div class="muted">新增' + items.length + "个标记</div>" +
        items.map(function (i) {
          const badge = i.lineId && activeLine(i.lineId) ? " · " + esc(lineCode(i.lineId)) : "";
          return "<div>" + esc(i.code + " · " + typeNames[i.type]) + badge + "</div>";
        }).join("") + "</div>";
    }).join("");
  }

  function editMark(id) {
    const mark = state.marks.find(function (m) { return m.id === id; });
    if (!mark) return;
    markForm.reset();
    Object.entries(mark).forEach(function (kv) {
      if (markForm[kv[0]]) markForm[kv[0]].value = kv[1];
    });
    renderLineOptions(mark.lineId || "");
    pendingPoint = { x: mark.x, y: mark.y };
    if (view.value === "lines") { view.value = "list"; showView(); }
    renderMarkers();
  }

  map.addEventListener("click", function (event) {
    if (event.target.closest(".marker")) return;
    const rect = map.getBoundingClientRect();
    pendingPoint = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    markForm.reset();
    markForm.id.value = "";
    markForm.code.value = "M-" + String(state.marks.length + 1).padStart(3, "0");
    markForm.dive.value = "DIVE-01";
    renderLineOptions("");
    if (view.value === "lines") { view.value = "list"; showView(); }
    renderMarkers();
  });

  markForm.onsubmit = function (event) {
    event.preventDefault();
    if (!pendingPoint) pendingPoint = { x: 50, y: 50 };
    const data = Object.fromEntries(new FormData(markForm).entries());
    if (data.id) {
      const old = state.marks.find(function (m) { return m.id === data.id; });
      if (old) Object.assign(old, data, pendingPoint);
    } else {
      state.marks.push(Object.assign({}, data, { id: Judge.genId() }, pendingPoint));
    }
    persist();
    markForm.reset();
    pendingPoint = null;
    renderLineOptions("");
    renderMarkPane();
    renderMarkers();
  };

  document.querySelector("#deleteMarkBtn").onclick = function () {
    if (!markForm.id.value) return;
    state.marks = state.marks.filter(function (m) { return m.id !== markForm.id.value; });
    markForm.reset();
    pendingPoint = null;
    persist();
    renderLineOptions("");
    renderMarkPane();
    renderMarkers();
  };

  // ---------- 测线回收台 ----------
  function coordText(name, x, y) {
    if (!isNum(x) || !isNum(y)) return name + " 未设";
    return name + "(" + Number(x).toFixed(1) + "," + Number(y).toFixed(1) + ")";
  }

  function renderLinePane() {
    lineListEl.innerHTML = state.lines.map(function (l) {
      const j = Judge.judgeLine(l, state.lines);
      const linked = state.marks.filter(function (m) { return m.lineId === l.id; }).length;
      const reasons = j.reasons.length
        ? '<ul class="reasons">' + j.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>"
        : "";
      const btns = l.archived ? "" :
        ((j.status === "pending"
          ? '<button type="button" class="mini" data-act="resurvey" data-id="' + esc(l.id) + '">复测确认</button>'
          : "") +
        '<button type="button" class="mini secondary" data-act="editline" data-id="' + esc(l.id) + '">编辑</button>' +
        '<button type="button" class="mini secondary" data-act="delline" data-id="' + esc(l.id) + '">删除</button>');
      return '<div class="item ' + (l.id === lineForm.id.value ? "active" : "") + '">' +
        "<div><b>" + esc(l.code) + '</b> <span class="pill st-' + j.status + '">' + esc(statusNames[j.status]) +
        '</span> <span class="muted">v' + esc(l.version) + " · " + esc(l.surveyor || "?") + " · 关联" + linked + "标记</span></div>" +
        '<div class="muted">布设 ' + esc(l.deployAt || "—") + " · " + esc(l.flowDeploy || "—") + " · 淤积" + esc(l.siltDeploy ?? "—") + "cm · 浮标" + esc(l.buoyDeploy || "—") + "</div>" +
        '<div class="muted">　基线 ' + esc(coordText(l.aName || "A", l.aDeployX, l.aDeployY)) + " — " + esc(coordText(l.bName || "B", l.bDeployX, l.bDeployY)) + "</div>" +
        (Judge.hasRecovery(l)
          ? '<div class="muted">回收 ' + esc(l.recoverAt || "—") + " · " + esc(l.flowRecover || "—") + " · 淤积" + esc(l.siltRecover ?? "—") + "cm · 浮标" + esc(l.buoyRecover || "—") + "</div>"
          : '<div class="muted">尚未登记回收</div>') +
        reasons + '<div class="rowbtns">' + btns + "</div></div>";
    }).join("");

    lineListEl.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.onclick = function (event) {
        event.stopPropagation();
        const id = btn.dataset.id;
        if (btn.dataset.act === "editline") editLine(id);
        else if (btn.dataset.act === "resurvey") openResurvey(id);
        else deleteLine(id);
      };
    });

    archiveListEl.innerHTML = state.archive.length ? state.archive.map(function (rec) {
      const maps = Object.entries(rec.diveMap || {}).map(function (kv) {
        return esc(kv[0]) + "→" + esc(kv[1]);
      }).join("，");
      return '<div class="item"><div><b>' + esc(rec.oldLine.code) + " v" + esc(rec.oldLine.version) +
        " → " + esc(rec.newLineCode) + "</b> <span class=\"pill st-archived\">旧版留档</span></div>" +
        '<div class="muted">留档 ' + esc(rec.archivedAt) + " · 复测人 " + esc(rec.checker) + " · " + esc(rec.checkAt) + "</div>" +
        (rec.reason ? "<div>复测原因：" + esc(rec.reason) + "</div>" : "") +
        '<div class="muted">标记改挂 ' + Object.keys(rec.remappedMarks || {}).length + " 个" +
        (maps ? "；潜次重排：" + maps : "；潜次顺序未变") + "</div></div>";
    }).join("") : '<div class="muted">尚无修订留档。</div>';
  }

  function fillLineForm(l) {
    lineForm.reset();
    lineError.textContent = "";
    Object.entries(l).forEach(function (kv) {
      if (lineForm[kv[0]]) lineForm[kv[0]].value = kv[1] == null ? "" : kv[1];
    });
  }

  function newLine() {
    const max = state.lines.reduce(function (acc, l) {
      const m = /^L-(\d+)$/.exec(l.code || "");
      return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
    }, 0);
    fillLineForm({
      code: "L-" + String(max + 1).padStart(2, "0"),
      version: 1,
      surveyor: "",
      aName: "BA-A", aDeployX: 25, aDeployY: 50,
      bName: "BA-B", bDeployX: 75, bDeployY: 50,
      deployAt: Archive.nowText(),
      siltDeploy: 0
    });
    lineForm.id.value = "";
    lineForm.querySelector("[name=version]").value = 1;
  }

  function editLine(id) {
    const l = state.lines.find(function (x) { return x.id === id; });
    if (!l) return;
    resurveyBox.dataset.open = "0";
    resurveyBox.style.display = "none";
    fillLineForm(l);
    renderLinePane();
    lineForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function deleteLine(id) {
    const linked = state.marks.filter(function (m) { return m.lineId === id; });
    if (linked.length) {
      alert("该测线仍关联 " + linked.length + " 个标记，请先在标记表单中改挂或解除关联。");
      return;
    }
    if (!confirm("删除该测线（含旧版记录）？")) return;
    state.lines = state.lines.filter(function (l) { return l.id !== id; });
    if (lineForm.id.value === id) { lineForm.reset(); lineForm.id.value = ""; }
    persist();
    renderLinePane();
    renderLines();
    renderLineOptions(markForm.id.value);
  }

  lineForm.onsubmit = function (event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(lineForm).entries());
    ["aDeployX", "aDeployY", "bDeployX", "bDeployY",
     "aRecoverX", "aRecoverY", "bRecoverX", "bRecoverY", "siltDeploy", "siltRecover"].forEach(function (k) {
      data[k] = data[k] === "" ? "" : Number(data[k]);
    });
    data.version = Number(data.version) || 1;

    if (![data.aDeployX, data.aDeployY, data.bDeployX, data.bDeployY].every(function (v) {
      return Number.isFinite(v) && v >= 0 && v <= 100;
    })) {
      lineError.textContent = "两端布设基线点坐标需在 0-100 之间。";
      return;
    }
    lineError.textContent = "";
    if (data.id) {
      const old = state.lines.find(function (l) { return l.id === data.id; });
      if (old) Object.assign(old, data);
    } else {
      const id = Judge.genId();
      state.lines.push(Object.assign({}, data, {
        id: id,
        revisionId: 1,
        revisedFrom: null
      }));
      lineForm.id.value = id;
    }
    persist();
    renderLinePane();
    renderLines();
    renderLineOptions(markForm.id.value);
  };

  document.querySelector("#newLineBtn").onclick = newLine;

  // ---------- 复测确认（另一名测绘员 + 重设基线 → 新版本） ----------
  function openResurvey(id) {
    const l = state.lines.find(function (x) { return x.id === id; });
    if (!l) return;
    fillLineForm(l);
    resurveyForm.reset();
    resurveyErrors.textContent = "";
    resurveyForm.lineId.value = id;
    resurveyForm.querySelector("[name=aName]").value = l.aName || "";
    resurveyForm.querySelector("[name=bName]").value = l.bName || "";
    resurveyForm.querySelector("[name=ax]").value = l.aDeployX;
    resurveyForm.querySelector("[name=ay]").value = l.aDeployY;
    resurveyForm.querySelector("[name=bx]").value = l.bDeployX;
    resurveyForm.querySelector("[name=by]").value = l.bDeployY;
    resurveyForm.querySelector("[name=buoy]").value = l.buoyDeploy || "";
    resurveyForm.querySelector("[name=checkAt]").value = Archive.nowText();
    resurveyBox.dataset.open = "1";
    resurveyBox.style.display = "";
    resurveyBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.querySelector("#cancelResurveyBtn").onclick = function () {
    resurveyBox.dataset.open = "0";
    resurveyBox.style.display = "none";
  };

  resurveyForm.onsubmit = function (event) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(resurveyForm).entries());
    const old = state.lines.find(function (l) { return l.id === f.lineId; });
    if (!old) return;
    const errors = Judge.validateResurvey(old, f);
    if (errors.length) {
      resurveyErrors.textContent = errors.join("；");
      return;
    }

    const newLine = Judge.buildRevision(old, f);

    // 关联标记改挂新测线
    const idsRemapped = {};
    state.marks.forEach(function (m) {
      if (m.lineId === old.id) {
        idsRemapped[m.id] = m.code;
        m.lineId = newLine.id;
      }
    });

    // 旧版整体留档（此刻标记仍保留修订前潜次号，便于快照追溯）
    Archive.archiveRevision(state, old, newLine, idsRemapped, {}, f);

    old.archived = true;
    state.lines.push(newLine);

    // 潜次顺序按现行测线布设先后重排
    const r = Judge.resequence(state.marks, state.lines);
    state.marks = r.marks;
    if (Object.keys(r.diveMap).length) {
      state.archive[0].diveMap = r.diveMap;
    }

    persist();
    resurveyBox.dataset.open = "0";
    resurveyBox.style.display = "none";
    lineForm.reset();
    lineForm.id.value = "";
    renderLinePane();
    renderLines();
    renderMarkPane();
    renderMarkers();
    renderLineOptions(markForm.id.value);
  };

  // ---------- 导出（原 JSON 导出继续可用，载荷扩展测线与留档） ----------
  document.querySelector("#exportBtn").onclick = function () {
    const blob = new Blob([JSON.stringify(Archive.buildExport(state), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dive-marks.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  filter.onchange = function () { renderMarkPane(); renderMarkers(); };
  view.onchange = function () {
    if (view.value !== "lines") { resurveyBox.dataset.open = "0"; resurveyBox.style.display = "none"; }
    showView();
  };

  // ---------- 初始化 ----------
  showView();
  renderLines();
  renderMarkers();
  renderLineOptions(markForm.id.value);
})();
