import type { BeatMap, TempoPoint } from '../types';

export const MIN_BPM = 20;
export const MAX_BPM = 400;

/** 旧工程缺少节拍图字段时的默认值：4/4、120 BPM。 */
export const DEFAULT_BEAT_MAP: BeatMap = {
  beatsPerBar: 4,
  beatUnit: 4,
  bpm: 120,
  tempoChanges: [],
};

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 规范化节拍图：拍号与 BPM 限幅；变速点取整拍、剔除第 0 拍（即起始 BPM）、
 * 按拍位升序排序并去重（同拍位保留先出现者）。
 */
export function normalizeBeatMap(map: BeatMap): BeatMap {
  const beatsPerBar = clampNum(Math.round(map.beatsPerBar) || DEFAULT_BEAT_MAP.beatsPerBar, 1, 32);
  const beatUnit = [1, 2, 4, 8, 16].includes(map.beatUnit) ? map.beatUnit : DEFAULT_BEAT_MAP.beatUnit;
  const bpm = clampNum(
    Number.isFinite(map.bpm) ? map.bpm : DEFAULT_BEAT_MAP.bpm,
    MIN_BPM,
    MAX_BPM,
  );
  const seen = new Set<number>();
  const tempoChanges: TempoPoint[] = [];
  const list = Array.isArray(map.tempoChanges) ? map.tempoChanges : [];
  for (const tp of list) {
    if (!tp || typeof tp !== 'object') continue;
    const beat = Math.round(tp.beat);
    const b = Number(tp.bpm);
    if (!Number.isFinite(beat) || beat <= 0 || !Number.isFinite(b)) continue;
    if (seen.has(beat)) continue;
    seen.add(beat);
    tempoChanges.push({ beat, bpm: clampNum(b, MIN_BPM, MAX_BPM) });
  }
  tempoChanges.sort((a, b) => a.beat - b.beat);
  return { beatsPerBar, beatUnit, bpm, tempoChanges };
}

/** 从外部数据（localStorage / 导入的 JSON）还原节拍图；缺失或非法时回退默认 4/4、120 BPM。 */
export function sanitizeBeatMap(raw: unknown): BeatMap {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BEAT_MAP, tempoChanges: [] };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return normalizeBeatMap({
    beatsPerBar: num(o.beatsPerBar, DEFAULT_BEAT_MAP.beatsPerBar),
    beatUnit: num(o.beatUnit, DEFAULT_BEAT_MAP.beatUnit),
    bpm: num(o.bpm, DEFAULT_BEAT_MAP.bpm),
    tempoChanges: (Array.isArray(o.tempoChanges) ? o.tempoChanges : []) as TempoPoint[],
  });
}

/** 拍 → 秒（分段恒速；超出最后一个变速点按末段 BPM 外推）。 */
export function beatToSeconds(map: BeatMap, beat: number): number {
  if (beat <= 0) return 0;
  let t = 0;
  let prevBeat = 0;
  let bpm = map.bpm;
  for (const tp of map.tempoChanges) {
    if (tp.beat >= beat) break;
    t += ((tp.beat - prevBeat) * 60) / bpm;
    prevBeat = tp.beat;
    bpm = tp.bpm;
  }
  return t + ((beat - prevBeat) * 60) / bpm;
}

/** 秒 → 拍（beatToSeconds 的逆换算，分段恒速）。 */
export function secondsToBeat(map: BeatMap, seconds: number): number {
  if (seconds <= 0) return 0;
  let t = 0;
  let prevBeat = 0;
  let bpm = map.bpm;
  for (const tp of map.tempoChanges) {
    const segSec = ((tp.beat - prevBeat) * 60) / bpm;
    if (t + segSec >= seconds) return prevBeat + ((seconds - t) * bpm) / 60;
    t += segSec;
    prevBeat = tp.beat;
    bpm = tp.bpm;
  }
  return prevBeat + ((seconds - t) * bpm) / 60;
}

/** 把秒位置吸附到最近的拍，返回吸附后的秒位置（跨变速点同样落在正确拍位）。 */
export function snapSecondsToBeat(map: BeatMap, seconds: number): number {
  return beatToSeconds(map, Math.round(secondsToBeat(map, seconds)));
}

/** 拍序号 → 小节/拍（均为 1 起；拍内位置可为小数）。 */
export function beatToBarBeat(map: BeatMap, beat: number): { bar: number; beatInBar: number } {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / map.beatsPerBar);
  return { bar: bar + 1, beatInBar: b - bar * map.beatsPerBar + 1 };
}

/** 秒位置 → "第3小节第2拍"（拍内位置保留至多两位小数）。 */
export function fmtBeatPosition(map: BeatMap, seconds: number): string {
  const { bar, beatInBar } = beatToBarBeat(map, secondsToBeat(map, seconds));
  const b = Math.round(beatInBar * 100) / 100;
  return `第${bar}小节第${b}拍`;
}

/** 变速点显示：小节首拍 → "第5小节"，否则 → "第18拍"。 */
export function fmtTempoPoint(map: BeatMap, tp: TempoPoint): string {
  return tp.beat % map.beatsPerBar === 0 ? `第${tp.beat / map.beatsPerBar + 1}小节` : `第${tp.beat}拍`;
}
