/* 判定业务文件：测线状态判定、复测确认校验、修订重排。
   纯函数，不读写存储、不碰 DOM。 */
(function () {
  "use strict";

  // 两端坐标不一致阈值：布设端与回收端相差超过 0.5 米即视为基线错位
  var ENDPOINT_TOLERANCE_M = 0.5;
  // 淤积阈值倍率：回收淤积达到布设淤积的 1.2 倍（多两成）即触发待复测
  var SILT_RATIO_LIMIT = 1.2;

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function endpointDistance(line, which) {
    var dx = num(line["recover" + which + "X"]) - num(line["deploy" + which + "X"]);
    var dy = num(line["recover" + which + "Y"]) - num(line["deploy" + which + "Y"]);
    if (![dx, dy].every(Number.isFinite)) return null;
    return Math.hypot(dx, dy);
  }

  function bothEndsRecorded(line) {
    return ["deployStartX", "deployStartY", "deployEndX", "deployEndY",
      "recoverStartX", "recoverStartY", "recoverEndX", "recoverEndY"]
      .every(function (k) { return num(line[k]) !== null; });
  }

  // 浮标串线：浮标实际回收所在测线与登记测线号不一致
  function buoyCrossed(line) {
    return !!line.foundLineCode && !!line.code &&
      String(line.foundLineCode).trim() !== String(line.code).trim();
  }

  // 回收淤积较布设淤积多两成（达到布设值 120% 即触发）
  function siltOverLimit(line) {
    var dep = num(line.siltDeploy);
    var rec = num(line.siltRecover);
    if (dep === null || rec === null || dep <= 0) return false;
    return rec >= dep * SILT_RATIO_LIMIT;
  }

  // 返回 { status, reasons }，reasons 供页面展示与旧版留档
  function judgeLine(line) {
    var reasons = [];
    if (!line.recoveredAt) {
      return { status: "deployed", reasons: reasons }; // 尚未回收
    }
    if (bothEndsRecorded(line)) {
      var ds = endpointDistance(line, "Start");
      var de = endpointDistance(line, "End");
      if (ds !== null && de !== null &&
          (ds > ENDPOINT_TOLERANCE_M || de > ENDPOINT_TOLERANCE_M)) {
        reasons.push("两端坐标不一致（起点偏" + ds.toFixed(2) + "m、终点偏" + de.toFixed(2) + "m，超过" + ENDPOINT_TOLERANCE_M + "m）");
      }
    }
    if (siltOverLimit(line)) {
      reasons.push("回收淤积" + num(line.siltRecover) + "cm，较布设淤积" +
        num(line.siltDeploy) + "cm多两成以上");
    }
    if (buoyCrossed(line)) {
      reasons.push("浮标串线：实际回收于" + line.foundLineCode + "，登记测线为" + line.code);
    }
    return { status: reasons.length ? "resurvey" : "normal", reasons: reasons };
  }

  // 复测确认校验：目标须处于待复测，且必须由另一名测绘员确认
  function validateResurvey(line, input) {
    var result = judgeLine(line);
    if (result.status !== "resurvey") return "仅待复测测线需要复测确认";
    var confirmer = (input.confirmer || "").trim();
    var surveyor = (line.surveyor || "").trim();
    if (!confirmer) return "请填写复测测绘员";
    if (confirmer === surveyor) return "复测须由另一名测绘员确认，复测人不能与原测绘员（" + surveyor + "）为同一人";
    if (!input.resetStartPoint || !input.resetEndPoint) return "请填写新基线两端基线点";
    if (["resetStartX", "resetStartY", "resetEndX", "resetEndY"]
        .some(function (k) { return num(input[k]) === null; })) {
      return "请完整填写重设基线两端坐标";
    }
    return null;
  }

  // 标记在测线基线上的投影参数（用场地百分比坐标排序，与平面图一致）
  function projection(mark, line) {
    var ax = num(line.deployStartX), ay = num(line.deployStartY);
    var bx = num(line.deployEndX), by = num(line.deployEndY);
    var mx = mark.x, my = mark.y;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) return 0;
    return ((mx - ax) * dx + (my - ay) * dy) / len2;
  }

  // 按新基线重排关联标记序号与潜次顺序；就地修改 marks，返回潜次顺序数组
  function resequence(line, marks) {
    var linked = marks.filter(function (m) { return m.lineCode === line.code; });
    linked.sort(function (a, b) { return projection(a, line) - projection(b, line); });
    linked.forEach(function (mark, i) { mark.seq = i + 1; });
    var dives = linked.map(function (m) { return m.dive; })
      .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
    return dives;
  }

  // 测线修订：旧版留档由调用方完成，本函数产出新版本
  function buildRevision(line, input, marks) {
    var now = input.confirmedAt || new Date().toISOString();
    var rev = {
      id: line.id,
      code: line.code,
      version: (Number(line.version) || 1) + 1,
      buoyCode: line.buoyCode,
      startPoint: input.resetStartPoint,
      endPoint: input.resetEndPoint,
      deployStartX: num(input.resetStartX),
      deployStartY: num(input.resetStartY),
      deployEndX: num(input.resetEndX),
      deployEndY: num(input.resetEndY),
      deployedAt: now,
      siltDeploy: num(input.resilt),
      // 重设基线后等待再次回收
      recoveredAt: "",
      siltRecover: null,
      recoverStartX: null,
      recoverStartY: null,
      recoverEndX: null,
      recoverEndY: null,
      currentSpeed: num(input.recurrent),
      foundLineCode: line.code,
      surveyor: line.surveyor,
      note: input.renote || "",
      resurveyHistory: (line.resurveyHistory || []).concat([{
        fromVersion: Number(line.version) || 1,
        confirmedBy: input.confirmer,
        confirmedAt: now,
        reasons: judgeLine(line).reasons
      }])
    };
    rev.orderedDives = resequence(rev, marks);
    rev.judged = judgeLine(rev);
    return rev;
  }

  window.Judge = {
    ENDPOINT_TOLERANCE_M: ENDPOINT_TOLERANCE_M,
    SILT_RATIO_LIMIT: SILT_RATIO_LIMIT,
    num: num,
    judgeLine: judgeLine,
    validateResurvey: validateResurvey,
    resequence: resequence,
    buildRevision: buildRevision
  };
})();
