import type { Project, Selection } from '../types';
import { totalSeconds, type Segment, type UnderSegment } from '../lib/coverage';
import { placeNewInterval, snap } from '../lib/constraints';
import { beatToSeconds, secondsToBeat, snapSecondsToBeat } from '../lib/beatmap';
import { fmtSec, fmtTick } from '../lib/format';
import BreathBlock from './BreathBlock';

export interface Ghost {
  singerId: string;
  start: number;
  end: number;
}

export type RulerMode = 'seconds' | 'beats';

interface Props {
  project: Project;
  /** 各声部未达标时段（预览时基于预览工程计算） */
  coverage: Map<string, UnderSegment[]>;
  selection: Selection | null;
  ghost: Ghost | null;
  pxPerSec: number;
  /** 标尺模式：秒 / 节拍 */
  rulerMode: RulerMode;
  /** 新增/拖拽换气段时是否吸附到最近拍 */
  snapToBeat: boolean;
  onSelect: (sel: Selection | null) => void;
  onUpdateInterval: (singerId: string, intervalId: string, start: number, end: number) => void;
  onAddInterval: (singerId: string, seg: Segment) => void;
}

export default function Timeline(props: Props) {
  const { project, pxPerSec, rulerMode } = props;
  const map = project.beatMap;
  const width = project.duration * pxPerSec;

  /** 秒吸附函数：按拍吸附开启时吸附到最近拍（跨变速点仍落在正确拍位），否则吸附到 0.1s */
  const snapSec = props.snapToBeat ? (v: number) => snapSecondsToBeat(map, v) : snap;

  // ---------- 秒标尺刻度 ----------
  const ticks: number[] = [];
  for (let t = 0; t <= project.duration; t++) ticks.push(t);

  // ---------- 节拍标尺刻度（小节首拍为大刻度，拍为小刻度） ----------
  const bars: { bar: number; sec: number }[] = [];
  const beatTicks: number[] = [];
  if (rulerMode === 'beats') {
    for (let i = 0; i < 5000; i++) {
      const sec = beatToSeconds(map, i * map.beatsPerBar);
      if (sec > project.duration + 1e-9) break;
      bars.push({ bar: i + 1, sec });
    }
    const maxBpm = Math.max(map.bpm, ...map.tempoChanges.map((tp) => tp.bpm));
    const showBeats = (60 / maxBpm) * pxPerSec >= 6; // 太密时只画小节线
    if (showBeats) {
      const totalBeats = secondsToBeat(map, project.duration);
      for (let b = 1; b <= Math.floor(totalBeats + 1e-9) && b < 20000; b++) {
        if (b % map.beatsPerBar === 0) continue; // 小节首拍已是大刻度
        beatTicks.push(beatToSeconds(map, b));
      }
    }
  }
  const barLines = bars.map((b) => b.sec);

  // 变速标记（含起始 BPM），两种标尺下都显示
  const tempoMarkers = [
    { sec: 0, bpm: map.bpm },
    ...map.tempoChanges.map((tp) => ({ sec: beatToSeconds(map, tp.beat), bpm: tp.bpm })),
  ].filter((m) => m.sec <= project.duration + 1e-9);

  const gridStyle =
    rulerMode === 'seconds'
      ? {
          width,
          backgroundImage: 'linear-gradient(to right, rgba(148,163,184,.10) 1px, transparent 1px)',
          backgroundSize: `${5 * pxPerSec}px 100%`,
        }
      : { width };

  const renderBarLines = () =>
    rulerMode === 'beats' &&
    barLines.map((sec) => <div key={sec} className="bar-line" style={{ left: sec * pxPerSec }} />);

  return (
    <div className="timeline" onClick={() => props.onSelect(null)}>
      <div className="trow ruler-row">
        <div className="trow-label">
          {rulerMode === 'seconds' ? '时间轴（秒）' : `时间轴（节拍 ${map.beatsPerBar}/${map.beatUnit}）`}
        </div>
        <div className="track ruler" style={{ width }}>
          {rulerMode === 'seconds'
            ? ticks.map((t) => (
                <div key={t} className={t % 5 === 0 ? 'tick major' : 'tick minor'} style={{ left: t * pxPerSec }}>
                  {t % 5 === 0 && <span>{fmtTick(t)}</span>}
                </div>
              ))
            : bars.map((b) => (
                <div key={b.bar} className="tick major" style={{ left: b.sec * pxPerSec }}>
                  <span>{b.bar}</span>
                </div>
              ))}
          {rulerMode === 'beats' &&
            beatTicks.map((sec) => <div key={sec} className="tick minor" style={{ left: sec * pxPerSec }} />)}
          {tempoMarkers.map((m) => (
            <div
              key={`${m.sec}-${m.bpm}`}
              className="tempo-marker"
              style={{ left: m.sec * pxPerSec }}
              title={`♩=${m.bpm}（${fmtSec(m.sec)}）`}
            >
              ♩={m.bpm}
            </div>
          ))}
        </div>
      </div>

      {project.parts.map((part) => {
        const singers = project.singers.filter((s) => s.partId === part.id);
        const under = props.coverage.get(part.id) ?? [];
        const underSec = totalSeconds(under);
        return (
          <div className="part-block" key={part.id}>
            <div className="trow coverage-row">
              <div className="trow-label">
                <span className="dot" style={{ background: part.color }} />
                <span className="part-title">{part.name}</span>
                <span className="part-req">需≥{part.minSingers}人</span>
                <em className={underSec > 0 ? 'bad' : 'ok'}>
                  {underSec > 0 ? `未达标 ${underSec.toFixed(1)}s` : '达标'}
                </em>
              </div>
              <div className="track coverage-track" style={gridStyle}>
                {renderBarLines()}
                {under.map((seg) => (
                  <div
                    key={`${seg.start}-${seg.end}`}
                    className="under-seg"
                    style={{ left: seg.start * pxPerSec, width: Math.max(2, (seg.end - seg.start) * pxPerSec) }}
                    title={`人数不足 ${fmtSec(seg.start)} – ${fmtSec(seg.end)}\n最少 ${seg.minSinging} 人发声（缺 ${seg.deficit} 人）`}
                  />
                ))}
              </div>
            </div>

            {singers.length === 0 && (
              <div className="trow empty-row">
                <div className="trow-label" />
                <div className="track empty-track" style={{ width }}>
                  该声部暂无歌手，请在左侧添加
                </div>
              </div>
            )}

            {singers.map((singer) => (
              <div className="trow singer-row" key={singer.id}>
                <div className="trow-label">{singer.name}</div>
                <div
                  className="track singer-track"
                  style={gridStyle}
                  onDoubleClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const t = snapSec((e.clientX - rect.left) / pxPerSec);
                    const seg = placeNewInterval(t, singer.breaths, project.duration);
                    if (seg) props.onAddInterval(singer.id, seg);
                  }}
                >
                  {renderBarLines()}
                  {singer.breaths.map((b) => (
                    <BreathBlock
                      key={b.id}
                      interval={b}
                      others={singer.breaths.filter((o) => o.id !== b.id)}
                      songDuration={project.duration}
                      pxPerSec={pxPerSec}
                      color={part.color}
                      beatMap={map}
                      snapSec={snapSec}
                      selected={props.selection?.intervalId === b.id}
                      dimmed={props.ghost !== null && props.selection?.intervalId === b.id}
                      onSelect={() => props.onSelect({ singerId: singer.id, intervalId: b.id })}
                      onChange={(s, en) => props.onUpdateInterval(singer.id, b.id, s, en)}
                    />
                  ))}
                  {props.ghost && props.ghost.singerId === singer.id && (
                    <div
                      className="breath-ghost"
                      style={{
                        left: props.ghost.start * pxPerSec,
                        width: Math.max(4, (props.ghost.end - props.ghost.start) * pxPerSec),
                        borderColor: part.color,
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
