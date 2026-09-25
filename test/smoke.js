// 判定/存档业务冒烟测试（node test/smoke.js，无 DOM 依赖）
global.window = global;
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
require("../js/judge.js");
require("../js/archive.js");

let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name)); }

const base = {
  id: "l1", code: "L-01", version: 1, surveyor: "张舟",
  aName: "A", aDeployX: 30, aDeployY: 30, aRecoverX: 30.2, aRecoverY: 30.1,
  bName: "B", bDeployX: 70, bDeployY: 60, bRecoverX: 70.0, bRecoverY: 59.9,
  deployAt: "2026-09-10 08:00", recoverAt: "2026-09-12 09:00",
  flowDeploy: "0.3", flowRecover: "0.4",
  siltDeploy: 10, siltRecover: 11,
  buoyDeploy: "BUOY-1", buoyRecover: "BUOY-1"
};

console.log("判定规则:");
ok("正常回收 → normal", Judge.judgeLine(base, [base]).status === "normal");
ok("未回收 → normal（不判定）", Judge.judgeLine(Object.assign({}, base, { recoverAt: "", flowRecover: "", siltRecover: "", buoyRecover: "", aRecoverX: "", aRecoverY: "", bRecoverX: "", bRecoverY: "" }), [base]).status === "normal");

const shifted = JSON.parse(JSON.stringify(base)); shifted.aRecoverX = 31.8; shifted.aRecoverY = 32.4;
ok("坐标偏差>0.5 → 待复测", Judge.judgeLine(shifted, [shifted]).status === "pending");
ok("偏差原因包含偏差描述", /偏差/.test(Judge.judgeLine(shifted, [shifted]).reasons[0]));

const silt = JSON.parse(JSON.stringify(base)); silt.siltRecover = 12;
ok("淤积增加20%（10→12）→ 待复测", Judge.judgeLine(silt, [silt]).status === "pending");
const silt19 = JSON.parse(JSON.stringify(base)); silt19.siltRecover = 11.9;
ok("淤积增加19%（10→11.9）→ 正常", Judge.judgeLine(silt19, [silt19]).status === "normal");

const cross = JSON.parse(JSON.stringify(base)); cross.buoyRecover = "BUOY-9";
ok("回收浮标≠布设浮标 → 待复测（串线）", Judge.judgeLine(cross, [cross]).status === "pending");
const other = Object.assign({}, base, { id: "l2", buoyRecover: "BUOY-2" });
const sameBuoy = Object.assign({}, base, { id: "l1", buoyDeploy: "BUOY-2", buoyRecover: "BUOY-2" });
ok("两条在役测线回收同一浮标 → 串线", Judge.judgeLine(sameBuoy, [other, sameBuoy]).status === "pending");
ok("归档测线不参与在役串线冲突", Judge.judgeLine(sameBuoy, [Object.assign({}, other, { archived: true }), sameBuoy]).status === "normal");

console.log("复测校验:");
const input = { checker: "李潜", checkAt: "2026-09-14 09:00", buoy: "BUOY-1", aName: "A", ax: 28, ay: 32, bName: "B", bx: 72, by: 58 };
ok("另一名测绘员 + 有效基线 → 通过", Judge.validateResurvey(base, input).length === 0);
ok("复测人与布设人相同 → 拒绝", Judge.validateResurvey(base, Object.assign({}, input, { checker: "张舟" })).some(e => e.includes("另一名")));
ok("缺少复测人 → 拒绝", Judge.validateResurvey(base, Object.assign({}, input, { checker: "" })).length > 0);
ok("基线点重合 → 拒绝", Judge.validateResurvey(base, Object.assign({}, input, { bx: 28, by: 32 })).length > 0);
ok("坐标越界 → 拒绝", Judge.validateResurvey(base, Object.assign({}, input, { ax: 130 })).length > 0);

console.log("版本生成:");
const rev = Judge.buildRevision(base, input);
ok("新版本号 +1", rev.version === 2);
ok("新版本有新 id 且保留 revisedFrom", rev.id !== base.id && rev.revisedFrom === base.id);
ok("新基线采用复测坐标", rev.aDeployX === 28 && rev.bDeployY === 58);
ok("回收字段被重置（重新布设）", rev.recoverAt === "" && rev.siltRecover === "" && rev.buoyRecover === "" && rev.aRecoverX === "");
ok("布设浮标更新为重布浮标", rev.buoyDeploy === "BUOY-1");
ok("原对象未被修改", base.aDeployX === 30);

console.log("潜次重排:");
const lines = [
  { id: "x1", code: "L-01", archived: false, deployAt: "2026-09-11 08:00" },
  { id: "x2", code: "L-02", archived: false, deployAt: "2026-09-10 08:00" }
];
const marks = [
  { id: "m1", code: "A", dive: "DIVE-01", lineId: "x1" },
  { id: "m2", code: "B", dive: "DIVE-02", lineId: "x2" },
  { id: "m3", code: "C", dive: "DIVE-03", lineId: null }
];
const r = Judge.resequence(marks, lines);
ok("按测线布设先后重排（x2 的 DIVE-02 → DIVE-01）", r.marks.find(m => m.id === "m2").dive === "DIVE-01");
ok("x1 的潜次顺延为 DIVE-02", r.marks.find(m => m.id === "m1").dive === "DIVE-02");
ok("未挂测线的潜次排末尾", r.marks.find(m => m.id === "m3").dive === "DIVE-03");
ok("diveMap 记录变化", r.diveMap["DIVE-01"] === "DIVE-02" && r.diveMap["DIVE-02"] === "DIVE-01");
ok("归档测线不参与排序", Judge.resequence(marks, lines.concat([{ id: "old", code: "L-00", archived: true, deployAt: "2020-01-01" }])).marks.find(m => m.id === "m2").dive === "DIVE-01");

console.log("存档:");
let state = { marks: [{ id: "m1", code: "A", dive: "DIVE-01", lineId: base.id }], lines: [base], archive: [] };
state.marks[0].lineId = rev.id;
Archive.archiveRevision(state, base, rev, { m1: "A" }, { "DIVE-01": "DIVE-02" }, { checker: "李潜", checkAt: "2026-09-14 09:00", reason: "测试", remark: "" });
ok("留档记录含旧版快照与映射", state.archive[0].oldLine.code === "L-01" && state.archive[0].diveMap["DIVE-01"] === "DIVE-02");
ok("快照保留修订前标记潜次号", state.archive[0].marksSnapshot[0].dive === "DIVE-01");
Archive.save(state);
const loaded = Archive.load();
ok("存档可重新载入", loaded.lines.length === 1 && loaded.archive.length === 1);
const exp = Archive.buildExport({ marks: [], lines: [Object.assign({}, base)], archive: [] });
ok("导出载荷 marks/lines/archive 齐全，lines 带状态", Array.isArray(exp.marks) && exp.lines[0].status === "normal" && Array.isArray(exp.archive));

store[Archive.LEGACY_KEY] = JSON.stringify([{ id: "z1", code: "OLD-1", type: "wood", dive: "DIVE-09" }]);
delete store[Archive.STORE_KEY];
const migrated = Archive.load();
ok("旧版 zfl30Marks 数据可迁入", migrated && migrated.marks[0].code === "OLD-1" && migrated.lines.length === 0);

console.log("\n" + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
