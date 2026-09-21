import { underCoveredSegments, totalSeconds, mergeSegments } from '../src/lib/coverage';
import { findBestMove } from '../src/lib/optimize';
import { createSampleProject } from '../src/lib/sample';
import {
  DEFAULT_BEAT_MAP,
  beatToBarBeat,
  beatToSeconds,
  fmtBeatPosition,
  normalizeBeatMap,
  sanitizeBeatMap,
  secondsToBeat,
  snapSecondsToBeat,
} from '../src/lib/beatmap';
import { sanitizeProject } from '../src/lib/storage';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// 1. 半开区间相邻不重叠：[0,2) 与 [2,4) 同一时刻最多 1 人换气 → 2 人声部 min 1 达标
check('half-open adjacency', underCoveredSegments([{ start: 0, end: 2 }, { start: 2, end: 4 }], 2, 1, 10), []);

// 2. 合并相接的不足时段：3 人 min 2（允许 1 人换气），[0,2)[1,3)[2,4) → [1,3)
{
  const segs = underCoveredSegments(
    [{ start: 0, end: 2 }, { start: 1, end: 3 }, { start: 2, end: 4 }],
    3, 2, 10,
  );
  check('merge touching', segs.map((s) => [s.start, s.end]), [[1, 3]]);
  check('merge stats', [segs[0].minSinging, segs[0].deficit], [1, 1]);
}

// 3. 歌手总数低于最低要求 → 全曲不足
{
  const segs = underCoveredSegments([], 1, 2, 10);
  check('always short', segs.map((s) => [s.start, s.end, s.deficit]), [[0, 10, 1]]);
}

// 4. minSingers = 0 → 无要求
check('no requirement', underCoveredSegments([{ start: 0, end: 5 }], 1, 0, 10), []);

// 5. 示例工程基线：女高 4s + 女低 5s + 男高 2s = 11s
{
  const p = createSampleProject();
  const perPart = p.parts.map((part) => {
    const breaths = p.singers.filter((s) => s.partId === part.id).flatMap((s) => s.breaths);
    const n = p.singers.filter((s) => s.partId === part.id).length;
    return totalSeconds(underCoveredSegments(breaths, n, part.minSingers, p.duration));
  });
  check('sample per-part under', perPart, [4, 5, 2, 0]);
  check('sample baseline', perPart.reduce((a, b) => a + b, 0), 11);
}

// 6. 寻优：李雪 [19,22) ±10 → 最优 +2s，全曲未达标 11 → 9
{
  const p = createSampleProject();
  const li = p.singers.find((s) => s.name === '李雪')!;
  const iv = li.breaths[0]; // [19,22)
  const r = findBestMove(p, li.id, iv.id, 10)!;
  check('optimize baseline', r.baseline, 11);
  check('optimize best offset', r.best.offset, 2);
  check('optimize best under', r.best.underSeconds, 9);
  check('optimize best range', [r.best.start, r.best.end], [21, 24]);
  check('optimize current', r.current.offset, 0);
}

// 7. 寻优平局取更早时刻：赵敏 [44,46) ±10 → -2 与 +3 同为 9s，|−2| 更小 → -2
{
  const p = createSampleProject();
  const zhao = p.singers.find((s) => s.name === '赵敏')!;
  const iv = zhao.breaths[0]; // [44,46)
  const r = findBestMove(p, zhao.id, iv.id, 10)!;
  check('tie-break offset', r.best.offset, -2);
  check('tie-break under', r.best.underSeconds, 9);
}

// 8. 寻优不重叠约束：移动后不得与同歌手其它区间重叠（王芳 [18,21) 不能移到 [44,47) 附近）
{
  const p = createSampleProject();
  const wang = p.singers.find((s) => s.name === '王芳')!;
  const iv = wang.breaths[0]; // [18,21)
  const r = findBestMove(p, wang.id, iv.id, 30)!;
  const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
  const bad = r.candidates.filter((c) =>
    wang.breaths.filter((b) => b.id !== iv.id).some((o) => overlaps(c.start, c.end, o.start, o.end)),
  );
  check('no-overlap candidates', bad.length, 0);
  check('overlap skipped counted', r.infeasible.overlap > 0, true);
}

// 9. 边界：区间不能移出 [0, duration)
{
  const p = createSampleProject();
  const zheng = p.singers.find((s) => s.name === '郑伟')!;
  const iv = zheng.breaths[0]; // [10,13)
  const r = findBestMove(p, zheng.id, iv.id, 20)!;
  const out = r.candidates.filter((c) => c.start < 0 || c.end > p.duration);
  check('bounds respected', out.length, 0);
  check('bounds skipped counted', r.infeasible.bounds > 0, true);
}

// 10. mergeSegments 基本行为
check(
  'mergeSegments',
  mergeSegments([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 2.5, end: 4 }]),
  [{ start: 1, end: 4 }, { start: 5, end: 6 }],
);

// ---------- 节拍图：小节/拍 ↔ 秒 ----------

// 11. 默认节拍图（旧工程缺字段回退）：4/4、120 BPM、无变速点
{
  const m = sanitizeBeatMap(undefined);
  check('default beatmap', [m.beatsPerBar, m.beatUnit, m.bpm, m.tempoChanges.length], [4, 4, 120, 0]);
  check('default constant', DEFAULT_BEAT_MAP.bpm, 120);
}

// 12. 恒速换算：120 BPM → 1 拍 = 0.5s，双向互逆
{
  const m = sanitizeBeatMap(undefined);
  check('const beat->sec', [beatToSeconds(m, 0), beatToSeconds(m, 1), beatToSeconds(m, 8)], [0, 0.5, 4]);
  check('const sec->beat', [secondsToBeat(m, 0), secondsToBeat(m, 4), secondsToBeat(m, 2.25)], [0, 8, 4.5]);
}

// 13. 分段恒速：120 BPM，第 5 小节首拍（第 16 拍）变速到 60 BPM
//     前 16 拍共 8s，之后 1s/拍
{
  const m = normalizeBeatMap({ beatsPerBar: 4, beatUnit: 4, bpm: 120, tempoChanges: [{ beat: 16, bpm: 60 }] });
  check('seg beat->sec', [beatToSeconds(m, 16), beatToSeconds(m, 20)], [8, 12]);
  check('seg sec->beat', [secondsToBeat(m, 8), secondsToBeat(m, 10), secondsToBeat(m, 12)], [16, 18, 20]);
  // 跨变速点往返换算还原
  check('seg roundtrip', Math.round(secondsToBeat(m, beatToSeconds(m, 27)) * 1e9) / 1e9, 27);
  // 末段外推：超出最后一个变速点仍按末段 BPM
  check('seg extrapolate', beatToSeconds(m, 24), 16);
}

// 14. 多个变速点：120 →(拍4) 240 →(拍8) 60
//     拍0-4: 2s；拍4-8: 1s；拍8 起 1s/拍 → 拍10 = 5s
{
  const m = normalizeBeatMap({
    beatsPerBar: 4,
    beatUnit: 4,
    bpm: 120,
    tempoChanges: [
      { beat: 4, bpm: 240 },
      { beat: 8, bpm: 60 },
    ],
  });
  check('multi beat->sec', [beatToSeconds(m, 4), beatToSeconds(m, 8), beatToSeconds(m, 10)], [2, 3, 5]);
  check('multi sec->beat', [secondsToBeat(m, 2), secondsToBeat(m, 3), secondsToBeat(m, 5)], [4, 8, 10]);
}

// 15. 跨变速点吸附：秒位置先换算成拍再取整，落回正确拍位
{
  const m = normalizeBeatMap({ beatsPerBar: 4, beatUnit: 4, bpm: 120, tempoChanges: [{ beat: 16, bpm: 60 }] });
  // 9.4s → 拍 17.4 → 17 拍 → 9s（变速后 1s/拍）
  check('snap after change', snapSecondsToBeat(m, 9.4), 9);
  // 8.6s → 拍 16.6 → 17 拍 → 9s（跨过变速点仍落到拍 17）
  check('snap across change', snapSecondsToBeat(m, 8.6), 9);
  // 7.4s → 拍 14.8 → 15 拍 → 7.5s（变速前 0.5s/拍）
  check('snap before change', snapSecondsToBeat(m, 7.4), 7.5);
  // 恒速下：1.2s → 拍 2.4 → 2 拍 → 1s
  check('snap constant', snapSecondsToBeat(sanitizeBeatMap(undefined), 1.2), 1);
}

// 16. 变速点必须按拍位排序且不得重复；剔除第 0 拍与非法 BPM
{
  const m = sanitizeBeatMap({
    beatsPerBar: 3,
    beatUnit: 8,
    bpm: 90,
    tempoChanges: [
      { beat: 12, bpm: 60 },
      { beat: 6, bpm: 100 },
      { beat: 12, bpm: 72 }, // 重复拍位：保留先出现者
      { beat: 0, bpm: 30 }, // 第 0 拍即起始 BPM，剔除
      { beat: -2, bpm: 50 }, // 非法拍位，剔除
    ],
  });
  check('tempo sorted unique', m.tempoChanges, [
    { beat: 6, bpm: 100 },
    { beat: 12, bpm: 60 },
  ]);
  check('time signature kept', [m.beatsPerBar, m.beatUnit, m.bpm], [3, 8, 90]);
}

// 17. 小节/拍 显示（1 起）
{
  const m = sanitizeBeatMap(undefined);
  check('bar/beat', beatToBarBeat(m, 9), { bar: 3, beatInBar: 2 });
  check('fmt position', fmtBeatPosition(m, 4.5), '第3小节第2拍'); // 4.5s = 第 9 拍
}

// 18. 旧工程缺少 beatMap 字段：导入后补默认 4/4、120 BPM，换气段秒位置不变
{
  const legacy = {
    name: '旧工程',
    duration: 30,
    parts: [{ id: 'p1', name: '女高', color: '#fff', minSingers: 1 }],
    singers: [{ id: 's1', name: '甲', partId: 'p1', breaths: [{ id: 'b1', start: 3, end: 5 }] }],
  };
  const p = sanitizeProject(legacy)!;
  check('legacy default beatmap', [p.beatMap.beatsPerBar, p.beatMap.beatUnit, p.beatMap.bpm], [4, 4, 120]);
  check('legacy breaths kept', [p.singers[0].breaths[0].start, p.singers[0].breaths[0].end], [3, 5]);
}

// 19. 带节拍图的工程：导入/导出（JSON 往返）后节拍图保留
{
  const raw = {
    name: 'x',
    duration: 30,
    beatMap: { beatsPerBar: 3, beatUnit: 4, bpm: 150, tempoChanges: [{ beat: 9, bpm: 80 }] },
    parts: [{ id: 'p1', name: 'P', color: '#fff', minSingers: 1 }],
    singers: [],
  };
  const p = sanitizeProject(JSON.parse(JSON.stringify(raw)))!;
  check('beatmap roundtrip', [p.beatMap.beatsPerBar, p.beatMap.bpm, p.beatMap.tempoChanges[0].bpm], [3, 150, 80]);
}

// 20. 编辑节拍图（如改 BPM）不影响已有换气段的秒位置，仅拍位显示变化
{
  const p = createSampleProject();
  const before = p.singers.flatMap((s) => s.breaths.map((b) => [b.start, b.end]));
  const faster = normalizeBeatMap({ ...p.beatMap, bpm: 150 });
  const after = p.singers.flatMap((s) => s.breaths.map((b) => [b.start, b.end]));
  check('tempo edit keeps seconds', after, before);
  // 同一秒位置在不同 BPM 下拍位不同：18s 在 120BPM=第36拍，150BPM=第45拍
  check('display re-derived', [secondsToBeat(p.beatMap, 18), secondsToBeat(faster, 18)], [36, 45]);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
