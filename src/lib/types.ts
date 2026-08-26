export type Difficulty = 'vm' | 'docker' | 'kubernetes' | 'architecture';

export type SeverityStatus = 'DEGRADED' | 'RECOVERING' | 'RECOVERED' | 'DOWN';

export interface MetricState {
  errorRate: number;
  affectedUsers: number;
  serviceStatus: SeverityStatus;
}

export interface ScenarioCommand {
  command: string;
  aliases?: string[];
  section: string;
  output: string;
  discovery?: string;
  scoreDelta?: number;
}

export interface ScenarioSection {
  id: string;
  title: string;
  description: string;
  commands: string[];
}

export interface ScenarioAction {
  id: string;
  label: string;
  tone: 'primary' | 'neutral' | 'danger';
  output: string;
  scoreDelta: number;
  communicationDelta?: number;
  restoreService?: boolean;
  rootCauseDiscovery?: string;
  penaltyReason?: string;
  argocdSelfHeal?: boolean;
}

export interface ManagerEvent {
  at: number;
  message: string;
}

export interface ScenarioDiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  tone: 'edge' | 'app' | 'data' | 'control' | 'queue' | 'external' | 'risk';
  sectionId?: string;
  detail?: string;
}

export interface ScenarioDiagramLink {
  from: string;
  to: string;
  label?: string;
  status?: 'ok' | 'degraded' | 'blocked' | 'unknown';
}

export interface ScenarioDiagram {
  nodes: ScenarioDiagramNode[];
  links: ScenarioDiagramLink[];
}

export interface InterviewerQuestion {
  at: number;
  question: string;
  idealKeywords: string[];
  followUp?: string;
}

export interface BusinessContext {
  headline: string;
  lossRubPerMinute: number;
  objective: string;
}

export interface Scenario {
  id: string;
  name: string;
  difficulty: Difficulty;
  duration: number;
  incidentNumber: string;
  incidentTitle: string;
  incidentText: string;
  architecture: string[];
  rootCause: string;
  rootCauseKeywords: string[];
  businessContext?: BusinessContext;
  diagram?: ScenarioDiagram;
  interviewerQuestions?: InterviewerQuestion[];
  initialState: MetricState;
  sections: ScenarioSection[];
  commands: ScenarioCommand[];
  actions: ScenarioAction[];
  managerEvents: ManagerEvent[];
}

export interface TimelineEntry {
  at: number;
  text: string;
}

export interface CommandEntry {
  at: number;
  section: string;
  command: string;
  recognized: boolean;
}

export interface InterviewerAnswer {
  at: number;
  question: string;
  answer: string;
  matched: boolean;
  followUp?: string;
}

export interface ResultSummary {
  recovery: number;
  diagnostics: number;
  rootCause: number;
  safety: number;
  communication: number;
  total: number;
  confidence: number;
  levelSignal: 'Needs more evidence' | 'Developing' | 'Solid' | 'Strong';
}

export interface ImpactSummary {
  peakAffectedUsers: number;
  estimatedAffectedUsers: number;
  impactedUserMinutes: number;
  estimatedLossRub: number;
  recoveryTime: number | null;
}

export interface InterviewReportInput {
  scenario: Scenario;
  elapsed: number;
  score: number;
  result: ResultSummary;
  impact: ImpactSummary;
  serviceRestored: boolean;
  rootCauseFound: boolean;
  timeline: TimelineEntry[];
  commandHistory: CommandEntry[];
  candidateNotes: Array<{ at: number; text: string }>;
  interviewerAnswers: InterviewerAnswer[];
  rootCauseAnswer: string;
  recoveryAnswer: string;
  preventionAnswer: string;
}
