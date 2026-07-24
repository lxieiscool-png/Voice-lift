export type PlayerDecision = {
  player: string; role: string; action: string; sport: string; grade: string;
  whatHappened: string; decisionRead: string; bestAlternative: string;
  whyBetter: string; otherOptions: string[]; patternToImprove: string; practiceFocus: string;
};

export type PlayerStat = { label: string; raw: string };

export type TeamComparison = {
  teamA: string; teamB: string;
  score: string | null;          // "46–44" or null if no scoreboard was visible
  winner: string | null;         // team name or null if unclear
  stats: { label: string; a: number; b: number }[];
  why: string;
};

export type GameReport = {
  overallGrade: string; gameSummary: string; periodBreakdown: string;
  foulPatterns: string; decisionTrends: string; strengths: string[];
  improvements: string[]; practiceFocus: string; playerStats: PlayerStat[];
  teamComparison?: TeamComparison | null;
};

export type ChunkSummary = { index: number; start: string; end: string; text: string };

export type Review = {
  id: string; fileName: string; sport: string; mode: "clip" | "game";
  grade: string; timestamp: number;
  decisions?: PlayerDecision[]; gameReport?: GameReport;
  teamId?: string | null; opponentName?: string | null; gameType?: string | null;
  gameDate?: string | null; location?: string | null; thumbnailUrl?: string | null;
};

export type Profile = { name: string; sport: string; team: string; jersey?: string; position?: string; teamColor?: string };

export type Team = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  season?: string | null;
  gender?: string | null;
  ageGroup?: string | null;
  level?: string | null;
  sport: string;
  coachUserId: string;
  isPublic: boolean;
  slug?: string | null;
  createdAt: number;
};

export type TeamMember = {
  id: string;
  teamId: string;
  userId?: string | null;
  displayName?: string | null;
  jerseyNumber?: string | null;
  role: "coach" | "assistant_coach" | "player";
  createdAt: number;
};

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
