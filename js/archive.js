/* 存档业务文件：本地存储读写、旧版留档、JSON 导出。
   不做业务判定、不操作页面。 */
(function () {
  "use strict";

  var MARKS_KEY = "zfl30Marks";
  var LINES_KEY = "zfl30Lines";
  var ARCHIVE_KEY = "zfl30LineArchive";

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch (e) { return []; }
  }

  function store(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  var Archive = {
    loadMarks: function () { return load(MARKS_KEY); },
    saveMarks: function (marks) { store(MARKS_KEY, marks); },
    loadLines: function () { return load(LINES_KEY); },
    saveLines: function (lines) { store(LINES_KEY, lines); },
    listArchives: function () { return load(ARCHIVE_KEY); },

    // 旧版留档：测线修订前把当前完整版本快照追加存档，不覆盖历史
    archiveVersion: function (line, meta) {
      var records = load(ARCHIVE_KEY);
      records.unshift({
        archivedId: typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        lineId: line.id,
        code: line.code,
        version: Number(line.version) || 1,
        reason: (meta && meta.reason) || "复测重设基线",
        confirmedBy: meta && meta.confirmer,
        confirmedAt: meta && meta.confirmedAt,
        archivedAt: new Date().toISOString(),
        judged: meta && meta.judged,
        snapshot: clone(line)
      });
      store(ARCHIVE_KEY, records);
      return records;
    },

    exportMarks: function (marks) {
      download("dive-marks.json", JSON.stringify(marks, null, 2));
    },
    exportLines: function (lines, marks) {
      var payload = {
        exportedAt: new Date().toISOString(),
        lines: lines,
        archives: load(ARCHIVE_KEY),
        marks: marks
      };
      download("survey-lines.json", JSON.stringify(payload, null, 2));
    }
  };

  function download(filename, text) {
    var blob = new Blob([text], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.Archive = Archive;
})();
