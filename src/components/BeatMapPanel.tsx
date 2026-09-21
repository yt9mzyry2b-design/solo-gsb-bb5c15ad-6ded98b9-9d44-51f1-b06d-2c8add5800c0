import { useState } from 'react';
import type { BeatMap, Project } from '../types';
import { MAX_BPM, MIN_BPM, fmtTempoPoint, normalizeBeatMap } from '../lib/beatmap';

interface Props {
  beatMap: BeatMap;
  /** 以不可变方式修改工程（会自动使寻优结果失效） */
  mutate: (fn: (p: Project) => Project) => void;
}

const BEAT_UNITS = [1, 2, 4, 8, 16];

/**
 * 节拍图编辑：拍号、起始 BPM、在小节首拍插入/删除变速点。
 * 换气段以秒存储，修改节拍图不会移动已有换气段，仅改变拍位显示与吸附。
 */
export default function BeatMapPanel({ beatMap, mutate }: Props) {
  const [barInput, setBarInput] = useState('2');
  const [bpmInput, setBpmInput] = useState('120');

  const setMap = (fn: (m: BeatMap) => BeatMap) =>
    mutate((p) => ({ ...p, beatMap: normalizeBeatMap(fn(p.beatMap)) }));

  const setBeatsPerBar = (raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > 32) return;
    setMap((m) => ({ ...m, beatsPerBar: n }));
  };

  const setBeatUnit = (raw: string) => {
    const n = Number(raw);
    if (!BEAT_UNITS.includes(n)) return;
    setMap((m) => ({ ...m, beatUnit: n }));
  };

  const setBpm = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MIN_BPM || n > MAX_BPM) return;
    setMap((m) => ({ ...m, bpm: n }));
  };

  /** 在指定小节首拍插入变速点；同拍位已存在则更新其 BPM（保证不重复）。 */
  const addTempo = () => {
    const bar = Math.round(Number(barInput));
    const bpm = Number(bpmInput);
    if (!Number.isFinite(bar) || bar < 1 || bar > 9999) return;
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return;
    if (bar === 1) {
      alert('第 1 小节首拍即起始速度，请直接修改「起始 BPM」。');
      return;
    }
    const beat = (bar - 1) * beatMap.beatsPerBar;
    setMap((m) => ({
      ...m,
      tempoChanges: [...m.tempoChanges.filter((tp) => tp.beat !== beat), { beat, bpm }],
    }));
  };

  const removeTempo = (beat: number) =>
    setMap((m) => ({ ...m, tempoChanges: m.tempoChanges.filter((tp) => tp.beat !== beat) }));

  return (
    <section className="side-section">
      <h3>🎵 节拍图</h3>
      <label className="field">
        <span>拍号</span>
        <input
          type="number"
          min={1}
          max={32}
          value={beatMap.beatsPerBar}
          onChange={(e) => setBeatsPerBar(e.target.value)}
        />
        <span className="slash">/</span>
        <select value={beatMap.beatUnit} onChange={(e) => setBeatUnit(e.target.value)}>
          {BEAT_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>起始 BPM</span>
        <input
          type="number"
          min={MIN_BPM}
          max={MAX_BPM}
          value={beatMap.bpm}
          onChange={(e) => setBpm(e.target.value)}
        />
      </label>

      <div className="tempo-list">
        {beatMap.tempoChanges.length === 0 && <div className="tempo-empty">无变速点（全曲恒速）</div>}
        {beatMap.tempoChanges.map((tp) => (
          <div className="tempo-row" key={tp.beat}>
            <span>{fmtTempoPoint(beatMap, tp)} 首拍</span>
            <span className="tempo-bpm">{tp.bpm} BPM</span>
            <button className="icon-btn" title="删除该变速点" onClick={() => removeTempo(tp.beat)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="tempo-add">
        <span>第</span>
        <input type="number" min={2} value={barInput} onChange={(e) => setBarInput(e.target.value)} />
        <span>小节起</span>
        <input type="number" min={MIN_BPM} max={MAX_BPM} value={bpmInput} onChange={(e) => setBpmInput(e.target.value)} />
        <span>BPM</span>
        <button onClick={addTempo}>＋变速</button>
      </div>
      <p className="note">变速点落在小节首拍；修改节拍图不会移动已有换气段，仅重算拍位显示与吸附。</p>
    </section>
  );
}
