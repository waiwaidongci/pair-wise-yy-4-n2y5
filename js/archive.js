/*
 * 存档业务（archive.js）
 * 负责 localStorage 读写、旧版测线快照留档、导出载荷组装。
 * 不处理判定规则（见 judge.js），不渲染界面（见 page.js）。
 *
 * 存储结构：
 *   marks    当前标记（修订后标记直接改挂新版本测线）
 *   lines    当前生效测线（含跨版本 revisionId 链）
 *   archive  留档：每次复测修订前的测线快照 + 关联标记 / 潜次重排映射
 */
(function () {
  "use strict";

  const STORE_KEY = "zfl30SurveyStation";
  const LEGACY_KEY = "zfl30Marks";

  function load() {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return {
          marks: Array.isArray(parsed.marks) ? parsed.marks : [],
          lines: Array.isArray(parsed.lines) ? parsed.lines : [],
          archive: Array.isArray(parsed.archive) ? parsed.archive : []
        };
      } catch (e) { /* 存档损坏时回落到空状态 */ }
    }
    // 兼容旧版单页数据：历史标记直接迁入，旧视图与导出沿用
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      try {
        const marks = JSON.parse(legacy);
        if (Array.isArray(marks)) return { marks: marks, lines: [], archive: [] };
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function save(state) {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      marks: state.marks || [],
      lines: state.lines || [],
      archive: state.archive || []
    }));
  }

  function nowText() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // 复测修订时调用：旧版测线整体快照留档，并记录标记改挂与潜次重排映射
  function archiveRevision(state, oldLine, newLine, idsRemapped, diveMap, input) {
    const snapshotMarks = state.marks
      .filter(function (m) { return m.lineId === oldLine.id || idsRemapped[m.id]; })
      .map(function (m) { return JSON.parse(JSON.stringify(m)); });
    const rec = {
      id: Judge.genId(),
      type: "line-revision",
      archivedAt: nowText(),
      oldLine: JSON.parse(JSON.stringify(oldLine)),
      newLineId: newLine.id,
      newLineCode: newLine.code,
      checker: String(input.checker || "").trim(),
      checkAt: String(input.checkAt || "").trim(),
      reason: String(input.reason || "").trim(),
      remark: String(input.remark || "").trim(),
      remappedMarks: idsRemapped,
      diveMap: diveMap,
      marksSnapshot: snapshotMarks
    };
    state.archive.unshift(rec);
    return rec;
  }

  // 导出载荷：marks 仍为顶层数组，旧版导出/读取方式继续可用
  function buildExport(state) {
    const lineStatus = function (line) {
      return Judge.judgeLine(line, state.lines).status;
    };
    return {
      exportedAt: new Date().toISOString(),
      marks: state.marks || [],
      lines: (state.lines || []).map(function (l) {
        const j = Judge.judgeLine(l, state.lines);
        return Object.assign({}, l, { status: j.status, reasons: j.reasons });
      }),
      archive: state.archive || []
    };
  }

  window.Archive = {
    STORE_KEY: STORE_KEY,
    LEGACY_KEY: LEGACY_KEY,
    load: load,
    save: save,
    nowText: nowText,
    archiveRevision: archiveRevision,
    buildExport: buildExport
  };
})();
