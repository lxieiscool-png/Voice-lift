export type PlayerDecision = {
  player: string; role: string; action: string; sport: string; grade: string;
  whatHappened: string; decisionRead: string; bestAlternative: string;
  whyBetter: string; otherOptions: string[]; patternToImprove: string; practiceFocus: string;
};

export type PlayerStat = { label: string; raw: string };

export type GameReport = {
  overallGrade: string; gameSummary: string; periodBreakdown: string;
  foulPatterns: string; decisionTrends: string; strengths: string[];
  improvements: string[]; practiceFocus: string; playerStats: PlayerStat[];
};

export type ChunkSummary = { index: number; start: string; end: string; text: string };

export type Review = {
  id: string; fileName: string; sport: string; mode: "clip" | "game";
  grade: string; timestamp: number;
  decisions?: PlayerDecision[]; gameReport?: GameReport;
};

export type Profile = { name: string; sport: string; team: string };

export type ChatMessage = { role: "user" | "coach"; content: string };

export type DrillDay = {
  day: string;
  focus: string;
  drills: { name: string; description: string; reps: string; why: string }[];
};

export type PracticePlan = {
  weekFocus: string;
  days: DrillDay[];
  coachNote: string;
};
