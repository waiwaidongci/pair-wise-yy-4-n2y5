/*
 * 测线判定业务（judge.js）
 * 纯函数模块，不接触 DOM / localStorage，便于复测规则单独核验。
 * 规则：
 *  1. 回收时任一基线点坐标与布设时偏差超过 COORD_TOLERANCE → 两端坐标不一致
 *  2. 回收淤积较布设淤积多两成（>= 1.2 倍）→ 淤积异常
 *  3. 回收浮标编号与布设浮标不同，或与其他在役测线回收浮标重复 → 浮标串线
 * 命中任意一条，测线转入“待复测”；复测须由另一名测绘员确认并重设基线。
 */
(function () {
  "use strict";

  const COORD_TOLERANCE = 0.5; // 平面图坐标（0-100）允许偏差
  const SILT_GROW_RATIO = 1.2; // 淤积较布设多两成

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function hasCoord(v) {
    return v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));
  }

  function genId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // 是否已经填写过回收信息（布设完成但未回收的测线不参与判定）
  function hasRecovery(line) {
    return Boolean(
      String(line.recoverAt || "").trim() ||
      String(line.buoyRecover || "").trim() ||
      String(line.flowRecover || "").trim() ||
      String(line.siltRecover || "").trim() ||
      hasCoord(line.aRecoverX) || hasCoord(line.aRecoverY) ||
      hasCoord(line.bRecoverX) || hasCoord(line.bRecoverY)
    );
  }

  // 两端基线点布设→回收的位移
  function endpointShift(line) {
    const result = { a: 0, b: 0, max: 0 };
    if (hasCoord(line.aRecoverX) && hasCoord(line.aRecoverY)) {
      result.a = Math.hypot(num(line.aRecoverX) - num(line.aDeployX), num(line.aRecoverY) - num(line.aDeployY));
    }
    if (hasCoord(line.bRecoverX) && hasCoord(line.bRecoverY)) {
      result.b = Math.hypot(num(line.bRecoverX) - num(line.bDeployX), num(line.bRecoverY) - num(line.bDeployY));
    }
    result.max = Math.max(result.a, result.b);
    return result;
  }

  function siltGrown(line) {
    const d = num(line.siltDeploy);
    const r = num(line.siltRecover);
    return d > 0 && r >= d * SILT_GROW_RATIO;
  }

  function siltRatio(line) {
    const d = num(line.siltDeploy);
    return d > 0 ? num(line.siltRecover) / d : null;
  }

  function buoyCrossed(line, lines) {
    const deployed = String(line.buoyDeploy || "").trim();
    const recovered = String(line.buoyRecover || "").trim();
    if (deployed && recovered && deployed !== recovered) return true;
    // 同一浮标被另一条在役测线回收，说明浮标串到了别人的测线上
    return (lines || []).some(function (o) {
      return o.id !== line.id && !o.archived &&
        String(o.buoyRecover || "").trim() &&
        String(o.buoyRecover || "").trim() === recovered;
    });
  }

  // 核心判定：返回 { status: 'normal' | 'pending' | 'archived', reasons: [] }
  function judgeLine(line, lines) {
    if (line.archived) return { status: "archived", reasons: [] };
    const reasons = [];
    if (!hasRecovery(line)) return { status: "normal", reasons: reasons };

    const shift = endpointShift(line);
    if (shift.max > COORD_TOLERANCE) {
      reasons.push("两端坐标偏差" + shift.max.toFixed(1) + "（超阈值" + COORD_TOLERANCE + "）");
    }
    if (siltGrown(line)) {
      const ratio = siltRatio(line);
      reasons.push("回收淤积较布设增加" + Math.round((ratio - 1) * 100) + "%（≥20%）");
    }
    if (buoyCrossed(line, lines)) {
      const deployed = String(line.buoyDeploy || "").trim();
      const recovered = String(line.buoyRecover || "").trim();
      reasons.push(deployed && recovered && deployed !== recovered
        ? "浮标串线（" + deployed + "→" + recovered + "）" : "浮标串线");
    }
    return { status: reasons.length ? "pending" : "normal", reasons: reasons };
  }

  // 复测确认校验：必须由“另一名”测绘员完成，并给出重设后的基线
  function validateResurvey(line, input) {
    const errors = [];
    const checker = String(input.checker || "").trim();
    if (!checker) errors.push("请填写复测测绘员");
    if (checker && checker === String(line.surveyor || "").trim()) {
      errors.push("复测须由另一名测绘员确认（不能与布设测绘员为同一人）");
    }
    if (!String(input.checkAt || "").trim()) errors.push("请填写复测时刻");
    if (!String(input.buoy || "").trim()) errors.push("请填写重布浮标编号");
    [["A", input.ax, input.ay], ["B", input.bx, input.by]].forEach(function (p) {
      [p[1], p[2]].forEach(function (v) {
        if (!hasCoord(v) || num(v) < 0 || num(v) > 100) {
          errors.push("基线点" + p[0] + "坐标需在 0-100 之间");
        }
      });
    });
    if (errors.length === 0) {
      const apart = Math.hypot(num(input.ax) - num(input.bx), num(input.ay) - num(input.by));
      if (apart <= COORD_TOLERANCE) errors.push("重设后的两个基线点不能重合");
    }
    return errors;
  }

  // 以复测结果生成测线新版本（不修改旧对象）；新版本从重设基线起重新累积布设/回收数据
  function buildRevision(line, input) {
    const base = JSON.parse(JSON.stringify(line));
    return Object.assign(base, {
      id: genId(),
      version: (Number(line.version) || 1) + 1,
      revisedFrom: line.id,
      surveyor: String(input.checker).trim(),
      deployAt: String(input.checkAt || "").trim(),
      recoverAt: "",
      flowRecover: "",
      siltRecover: "",
      buoyRecover: "",
      aName: String(input.aName || "").trim(),
      aDeployX: num(input.ax),
      aDeployY: num(input.ay),
      aRecoverX: "",
      aRecoverY: "",
      bName: String(input.bName || "").trim(),
      bDeployX: num(input.bx),
      bDeployY: num(input.by),
      bRecoverX: "",
      bRecoverY: "",
      buoyDeploy: String(input.buoy || "").trim(),
      note: String(input.note || "").trim()
    });
  }

  /*
   * 测线修订后，关联标记改挂新测线，潜次顺序按测线布设先后重排。
   * 返回 { marks, diveMap }，diveMap 记录旧潜次号→新潜次号，供留档追溯。
   */
  function resequence(marks, activeLines) {
    const ordered = activeLines
      .filter(function (l) { return !l.archived; })
      .slice()
      .sort(function (a, b) {
        return String(a.deployAt || "").localeCompare(String(b.deployAt || "")) ||
               String(a.code || "").localeCompare(String(b.code || ""));
      });
    const lineRank = new Map(ordered.map(function (l, i) { return [l.id, i]; }));
    const tailRank = ordered.length;

    const groups = new Map();
    marks.forEach(function (m) {
      if (!m.dive) return;
      const g = groups.get(m.dive) || { rank: tailRank + 1, seq: tailRank + 1 };
      const rank = m.lineId && lineRank.has(m.lineId) ? lineRank.get(m.lineId) : tailRank;
      g.rank = Math.min(g.rank, rank);
      const seq = parseInt(String(m.dive).replace(/\D+/g, ""), 10);
      if (Number.isFinite(seq)) g.seq = Math.min(g.seq, seq);
      groups.set(m.dive, g);
    });

    const sorted = Array.from(groups.entries()).sort(function (a, b) {
      return a[1].rank - b[1].rank || a[1].seq - b[1].seq ||
             String(a[0]).localeCompare(String(b[0]));
    });
    const remap = new Map(sorted.map(function (entry, i) {
      return [entry[0], "DIVE-" + String(i + 1).padStart(2, "0")];
    }));

    const nextMarks = marks.map(function (m) {
      return remap.has(m.dive) ? Object.assign({}, m, { dive: remap.get(m.dive) }) : m;
    });
    const diveMap = {};
    remap.forEach(function (v, k) { if (k !== v) diveMap[k] = v; });
    return { marks: nextMarks, diveMap: diveMap };
  }

  window.Judge = {
    COORD_TOLERANCE: COORD_TOLERANCE,
    SILT_GROW_RATIO: SILT_GROW_RATIO,
    genId: genId,
    hasRecovery: hasRecovery,
    endpointShift: endpointShift,
    siltGrown: siltGrown,
    siltRatio: siltRatio,
    buoyCrossed: buoyCrossed,
    judgeLine: judgeLine,
    validateResurvey: validateResurvey,
    buildRevision: buildRevision,
    resequence: resequence
  };
})();
