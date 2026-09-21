/** 换气区间：半开区间 [start, end)，单位秒。歌手在该区间内不发声。 */
export interface BreathInterval {
  id: string;
  /** 起始秒（含） */
  start: number;
  /** 结束秒（不含） */
  end: number;
}

export interface Singer {
  id: string;
  name: string;
  partId: string;
  breaths: BreathInterval[];
}

export interface VoicePart {
  id: string;
  name: string;
  color: string;
  /** 该声部任意时刻的最低发声人数 */
  minSingers: number;
}

/** 变速点：从某一拍（须为小节首拍）起改用新的 BPM，分段恒速。 */
export interface TempoPoint {
  /** 拍序号（从 0 起按全曲累计） */
  beat: number;
  /** 每分钟拍数 */
  bpm: number;
}

/** 节拍图：拍号 + 起始 BPM + 变速点（按拍位升序、不重复）。 */
export interface BeatMap {
  /** 拍号分子：每小节拍数 */
  beatsPerBar: number;
  /** 拍号分母：以几分音符为一拍（仅影响拍号显示；BPM 始终按“拍/分钟”计） */
  beatUnit: number;
  /** 起始 BPM */
  bpm: number;
  tempoChanges: TempoPoint[];
}

export interface Project {
  name: string;
  /** 全曲时长（秒） */
  duration: number;
  /** 节拍图：秒 ↔ 小节/拍 换算与按拍吸附的依据 */
  beatMap: BeatMap;
  parts: VoicePart[];
  singers: Singer[];
}

/** 当前选中的换气段 */
export interface Selection {
  singerId: string;
  intervalId: string;
}
