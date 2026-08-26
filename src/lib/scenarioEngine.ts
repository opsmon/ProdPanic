import type {
  CommandEntry,
  ImpactSummary,
  InterviewReportInput,
  ResultSummary,
  Scenario,
  ScenarioCommand,
  TimelineEntry
} from './types';

export function formatTimer(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const rest = (clamped % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function findCommand(
  scenario: Scenario,
  rawCommand: string,
  sectionId?: string
): ScenarioCommand | undefined {
  const normalized = normalizeCommand(rawCommand);
  return scenario.commands.find((item) => {
    if (sectionId && item.section !== sectionId) return false;
    const variants = [item.command, ...(item.aliases ?? [])].map(normalizeCommand);
    return variants.includes(normalized);
  });
}

export function timelineEntry(elapsed: number, text: string): TimelineEntry {
  return {
    at: elapsed,
    text
  };
}

export function rootCauseLooksCorrect(scenario: Scenario, answer: string): boolean {
  const normalized = answer.toLowerCase();
  return scenario.rootCauseKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function buildResultSummary(options: {
  scenario: Scenario;
  score: number;
  communication: number;
  restored: boolean;
  rootCauseFound: boolean;
  discoveries: Set<string>;
  unsafeActions: number;
  elapsed: number;
  commandHistory: CommandEntry[];
  notesCount: number;
  visitedSections: Set<string>;
}): ResultSummary {
  const commandDepth = Math.min(28, options.commandHistory.filter((item) => item.recognized).length * 3);
  const sectionBreadth = Math.min(20, options.visitedSections.size * 5);
  const diagnostics = Math.min(100, 25 + options.discoveries.size * 8 + commandDepth + sectionBreadth);
  const safety = Math.max(30, 100 - options.unsafeActions * 18);
  const recovery = options.restored
    ? Math.max(72, Math.round(100 - (options.elapsed / options.scenario.duration) * 22))
    : 35;
  const communication = Math.max(0, Math.min(100, options.communication + Math.min(8, options.notesCount * 2)));
  const rootCause = options.rootCauseFound ? 100 : options.discoveries.size >= 4 ? 62 : 35;
  const total = Math.round(
    recovery * 0.25 + diagnostics * 0.25 + rootCause * 0.25 + safety * 0.15 + communication * 0.1
  );
  const confidence = Math.min(
    100,
    35 +
      options.commandHistory.length * 3 +
      options.visitedSections.size * 7 +
      options.notesCount * 5 +
      (options.rootCauseFound ? 10 : 0)
  );

  return {
    recovery,
    diagnostics,
    rootCause,
    safety,
    communication,
    total,
    confidence,
    levelSignal: scoreSignal(total, confidence)
  };
}

export function estimateImpactTick(scenario: Scenario, errorRate: number, affectedUsers: number): number {
  const revenuePerMinute = {
    vm: 18000,
    docker: 30000,
    kubernetes: 45000,
    architecture: scenario.businessContext?.lossRubPerMinute ?? 85000
  }[scenario.difficulty];
  const supportCostPerAffectedUserHour = {
    vm: 3,
    docker: 5,
    kubernetes: 7,
    architecture: 10
  }[scenario.difficulty];
  const failedFraction = Math.max(0, Math.min(1, errorRate / 100));
  const revenueLoss = (revenuePerMinute / 60) * failedFraction;
  const supportLoss = ((affectedUsers * supportCostPerAffectedUserHour) / 3600) * failedFraction;
  return revenueLoss + supportLoss;
}

export function buildImpactSummary(options: {
  peakAffectedUsers: number;
  impactedUserSeconds: number;
  estimatedLossRub: number;
  recoveryTime: number | null;
}): ImpactSummary {
  return {
    peakAffectedUsers: options.peakAffectedUsers,
    estimatedAffectedUsers: Math.max(
      options.peakAffectedUsers,
      Math.round(options.impactedUserSeconds / 60)
    ),
    impactedUserMinutes: Math.round(options.impactedUserSeconds / 60),
    estimatedLossRub: Math.round(options.estimatedLossRub),
    recoveryTime: options.recoveryTime
  };
}

export function formatRub(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} RUB`;
}

export function buildInterviewReport(input: InterviewReportInput): string {
  const recognizedCommands = input.commandHistory.filter((item) => item.recognized).length;
  const unknownCommands = input.commandHistory.length - recognizedCommands;
  const sections = Array.from(new Set(input.commandHistory.map((item) => item.section))).filter(Boolean);

  return [
    `# Incident interview report`,
    ``,
    `## Scenario`,
    `- Incident: ${input.scenario.incidentNumber} ${input.scenario.name}`,
    `- Difficulty: ${input.scenario.difficulty}`,
    `- Time spent: ${formatTimer(input.elapsed)}`,
    `- Service restored: ${input.serviceRestored ? 'YES' : 'NO'}`,
    `- Root cause matched: ${input.rootCauseFound ? 'YES' : 'NO'}`,
    ``,
    `## Business impact estimate`,
    `- Estimated loss: ${formatRub(input.impact.estimatedLossRub)}`,
    `- Peak affected users: ${input.impact.peakAffectedUsers.toLocaleString('ru-RU')}`,
    `- Estimated affected users: ${input.impact.estimatedAffectedUsers.toLocaleString('ru-RU')}`,
    `- Impacted user-minutes: ${input.impact.impactedUserMinutes.toLocaleString('ru-RU')}`,
    `- Recovery time: ${input.impact.recoveryTime === null ? 'not recovered' : formatTimer(input.impact.recoveryTime)}`,
    ``,
    `## Objective scoring`,
    `- Total: ${input.result.total}/100`,
    `- Signal: ${input.result.levelSignal}`,
    `- Confidence: ${input.result.confidence}/100`,
    `- Recovery: ${input.result.recovery}/100`,
    `- Diagnostics: ${input.result.diagnostics}/100`,
    `- Root Cause: ${input.result.rootCause}/100`,
    `- Safety: ${input.result.safety}/100`,
    `- Communication: ${input.result.communication}/100`,
    ``,
    `## Evidence`,
    `- Commands entered: ${input.commandHistory.length}`,
    `- Recognized diagnostic commands: ${recognizedCommands}`,
    `- Unknown commands: ${unknownCommands}`,
    `- Connected sections: ${sections.join(', ') || 'none'}`,
    `- Candidate notes: ${input.candidateNotes.length}`,
    `- Interviewer answers: ${input.interviewerAnswers.length}`,
    ``,
    `## Candidate notes`,
    ...(input.candidateNotes.length
      ? input.candidateNotes.map((note) => `- ${formatTimer(note.at)} ${note.text}`)
      : ['- none']),
    ``,
    `## Interviewer questions`,
    ...(input.interviewerAnswers.length
      ? input.interviewerAnswers.flatMap((item) => [
          `### ${formatTimer(item.at)} ${item.question}`,
          item.answer,
          `Matched prepared rubric: ${item.matched ? 'YES' : 'NO'}`,
          item.followUp ? `Follow-up: ${item.followUp}` : ''
        ])
      : ['- none']),
    ``,
    `## Candidate final answers`,
    `### Root cause`,
    input.rootCauseAnswer || 'No answer',
    ``,
    `### Recovery`,
    input.recoveryAnswer || 'No answer',
    ``,
    `### Prevention`,
    input.preventionAnswer || 'No answer',
    ``,
    `## Timeline`,
    ...input.timeline.map((item) => `- ${formatTimer(item.at)} ${item.text}`),
    ``,
    `## Calibration note`,
    `This score is an interview aid, not an automatic hiring decision. Use it to anchor a debrief: ask why the candidate chose commands, which hypotheses they discarded, and what they would do with production access.`
  ].join('\n');
}

function scoreSignal(total: number, confidence: number): ResultSummary['levelSignal'] {
  if (confidence < 55) return 'Needs more evidence';
  if (total >= 86) return 'Strong';
  if (total >= 70) return 'Solid';
  return 'Developing';
}
