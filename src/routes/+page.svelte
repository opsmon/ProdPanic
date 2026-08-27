<script lang="ts">
  import {
    Activity,
    AlertTriangle,
    Box,
    ChartColumn,
    CheckCircle2,
    Clock3,
    CreditCard,
    Database,
    Download,
    FileText,
    Flag,
    GitBranch,
    Globe,
    History,
    Landmark,
    Layers,
    LockKeyhole,
    MessageSquare,
    Network,
    Play,
    RotateCcw,
    Search,
    Send,
    Server,
    Settings,
    ShieldCheck,
    ShoppingCart,
    Tags,
    Terminal,
    Users,
    Workflow,
    XCircle
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import dockerScenario from '../scenarios/docker/wrong-redis-host.json';
  import dockerPoolScenario from '../scenarios/docker/db-pool-exhaustion.json';
  import dockerHealthScenario from '../scenarios/docker/broken-healthcheck.json';
  import k8sScenario from '../scenarios/kubernetes/argocd-failed-migration.json';
  import k8sSelectorScenario from '../scenarios/kubernetes/service-selector-mismatch.json';
  import k8sNetworkScenario from '../scenarios/kubernetes/networkpolicy-blocks-redis.json';
  import vmScenario from '../scenarios/vm/failed-db-migration.json';
  import vmDiskScenario from '../scenarios/vm/disk-full-logs.json';
  import vmNginxScenario from '../scenarios/vm/nginx-upstream-port.json';
  import architectureScenario from '../scenarios/architecture/checkout-cache-schema.json';
  import {
    buildImpactSummary,
    buildInterviewReport,
    buildResultSummary,
    findCommand,
    formatTimer,
    formatRub,
    estimateImpactTick,
    rootCauseLooksCorrect,
    timelineEntry
  } from '$lib/scenarioEngine';
  import type {
    CommandEntry,
    ImpactSummary,
    InterviewerAnswer,
    InterviewerQuestion,
    ManagerEvent,
    ResultSummary,
    Scenario,
    ScenarioAction,
    ScenarioDiagramLink,
    ScenarioDiagramNode,
    TimelineEntry
  } from '$lib/types';

  const scenarios = [
    vmScenario,
    vmDiskScenario,
    vmNginxScenario,
    dockerScenario,
    dockerPoolScenario,
    dockerHealthScenario,
    k8sScenario,
    k8sSelectorScenario,
    k8sNetworkScenario,
    architectureScenario
  ] as Scenario[];
  const genericCommandCompletions = [
    'help',
    'pwd',
    'ls',
    'ls -la',
    'cd ',
    'cat ',
    'tail -n 80 ',
    'top',
    'df -h',
    'du -sh *',
    'free -m',
    'uptime',
    'ps aux',
    'ss -tulpn',
    'ip addr',
    'env',
    'curl -i localhost',
    'whoami',
    'hostname',
    'clear'
  ];
  type DiagramNode = ScenarioDiagramNode;
  type DiagramLink = ScenarioDiagramLink;
  type DiagramLine = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    d?: string;
    label?: string;
    status?: DiagramLink['status'];
    direction?: DiagramLink['direction'];
  };
  type CandidateNote = { at: number; text: string };

  let selectedScenarioForStart: Scenario | null = scenarios[0];
  let scenario: Scenario | null = null;
  let activeSection = '';
  let selectedDiagramNode: DiagramNode | null = null;
  let shellPath = '/';
  let elapsed = 0;
  let score = 1000;
  let communication = 70;
  let errorRate = 0;
  let affectedUsers = 0;
  let serviceStatus = 'DEGRADED';
  let commandInput = '';
  let noteInput = '';
  let terminalOutputBySection: Record<string, string[]> = {};
  let timeline: TimelineEntry[] = [];
  let commandHistory: CommandEntry[] = [];
  let candidateNotes: CandidateNote[] = [];
  let visitedSections = new Set<string>();
  let discoveries = new Set<string>();
  let unsafeActions = 0;
  let serviceRestored = false;
  let serviceRestoredAt: number | null = null;
  let rootCauseFound = false;
  let finished = false;
  let result: ResultSummary | null = null;
  let impact: ImpactSummary | null = null;
  let reportText = '';
  let rootCauseAnswer = '';
  let recoveryAnswer = '';
  let preventionAnswer = '';
  let currentManager: ManagerEvent | null = null;
  let currentInterviewerQuestion: InterviewerQuestion | null = null;
  let seenManagerEvents = new Set<number>();
  let seenInterviewerQuestions = new Set<number>();
  let interviewerAnswerInput = '';
  let interviewerAnswers: InterviewerAnswer[] = [];
  let promisedEtaAt: number | null = null;
  let argocdWarning = false;
  let selfHealTimer: ReturnType<typeof setTimeout> | null = null;

  $: remaining = scenario ? scenario.duration - elapsed : 0;
  $: selectedSection = scenario?.sections.find((section) => section.id === activeSection);
  $: canFinish = scenario && rootCauseAnswer.trim() && recoveryAnswer.trim() && preventionAnswer.trim();
  $: activeTerminalOutput = activeSection ? terminalOutputBySection[activeSection] ?? [] : [];

  onMount(() => {
    const interval = setInterval(() => {
      if (!scenario || finished || remaining <= 0) return;

      elapsed += 1;
      peakAffectedUsers = Math.max(peakAffectedUsers, affectedUsers);
      impactedUserSeconds += affectedUsers * Math.max(0, Math.min(1, errorRate / 100));
      estimatedLossRub += estimateImpactTick(scenario, errorRate, affectedUsers);

      const event =
        scenario.difficulty === 'architecture'
          ? undefined
          : scenario.managerEvents.find((item) => elapsed >= item.at && !seenManagerEvents.has(item.at));
      if (event) {
        currentManager = event;
        seenManagerEvents = new Set(seenManagerEvents).add(event.at);
        pushTimeline(`Manager requested ETA`);
      }

      const interviewerQuestion =
        scenario.difficulty === 'architecture'
          ? undefined
          : scenario.interviewerQuestions?.find(
              (item) => elapsed >= item.at && !seenInterviewerQuestions.has(item.at)
            );
      if (interviewerQuestion) {
        currentInterviewerQuestion = interviewerQuestion;
        seenInterviewerQuestions = new Set(seenInterviewerQuestions).add(interviewerQuestion.at);
        pushTimeline('Interviewer asked architecture question');
      }

      if (promisedEtaAt && elapsed >= promisedEtaAt && !serviceRestored) {
        communication = Math.max(0, communication - 30);
        pushTimeline('Manager trust penalty: missed ETA');
        promisedEtaAt = null;
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      clearSelfHeal();
    };
  });

  let peakAffectedUsers = 0;
  let impactedUserSeconds = 0;
  let estimatedLossRub = 0;

  function startScenario(nextScenario: Scenario) {
    clearSelfHeal();
    scenario = nextScenario;
    activeSection = nextScenario.sections[0]?.id ?? '';
    selectedDiagramNode =
      nextScenario.diagram?.nodes.find((node) => node.sectionId === activeSection) ?? null;
    shellPath = getDefaultPath(nextScenario.sections[0]?.id ?? '');
    visitedSections = new Set(activeSection ? [activeSection] : []);
    elapsed = 0;
    score = 1000;
    communication = 70;
    errorRate = nextScenario.initialState.errorRate;
    affectedUsers = nextScenario.initialState.affectedUsers;
    serviceStatus = nextScenario.initialState.serviceStatus;
    commandInput = '';
    noteInput = '';
    terminalOutputBySection = Object.fromEntries(
      nextScenario.sections.map((section) => [
        section.id,
        section.id === activeSection
          ? [`${nextScenario.incidentNumber}\n${nextScenario.incidentTitle}\n\n${nextScenario.incidentText}`]
          : []
      ])
    );
    timeline = [timelineEntry(0, 'Incident started')];
    commandHistory = [];
    candidateNotes = [];
    discoveries = new Set();
    unsafeActions = 0;
    serviceRestored = false;
    serviceRestoredAt = null;
    rootCauseFound = false;
    finished = false;
    result = null;
    impact = null;
    reportText = '';
    peakAffectedUsers = nextScenario.initialState.affectedUsers;
    impactedUserSeconds = 0;
    estimatedLossRub = 0;
    rootCauseAnswer = '';
    recoveryAnswer = '';
    preventionAnswer = '';
    currentManager = null;
    currentInterviewerQuestion = null;
    seenManagerEvents = new Set();
    seenInterviewerQuestions = new Set();
    interviewerAnswerInput = '';
    interviewerAnswers = [];
    promisedEtaAt = null;
    argocdWarning = false;
  }

  function restartScenario() {
    if (scenario) startScenario(scenario);
  }

  function startSelectedScenario() {
    if (selectedScenarioForStart) startScenario(selectedScenarioForStart);
  }

  function clearSelfHeal() {
    if (selfHealTimer) {
      clearTimeout(selfHealTimer);
      selfHealTimer = null;
    }
  }

  function pushTimeline(text: string) {
    timeline = [...timeline, timelineEntry(elapsed, text)];
  }

  function pushOutput(title: string, output: string) {
    const sectionId = activeSection || 'incident';
    terminalOutputBySection = {
      ...terminalOutputBySection,
      [sectionId]: [...(terminalOutputBySection[sectionId] ?? []), `${promptFor(title)}\n${output}`]
    };
  }

  function changeSection(sectionId: string) {
    if (!scenario) return;
    activeSection = sectionId;
    selectedDiagramNode = scenario.diagram?.nodes.find((node) => node.sectionId === sectionId) ?? null;
    visitedSections = new Set(visitedSections).add(sectionId);
    const section = scenario.sections.find((item) => item.id === sectionId);
    shellPath = getDefaultPath(sectionId);
    if (section) {
      pushTimeline(`connect ${section.title}`);
      pushOutput('connect', `Connected to ${section.title.toLowerCase()} diagnostics\ncwd: ${shellPath}`);
    }
  }

  function awardDiscovery(discovery: string | undefined, delta = 0) {
    if (discovery && !discoveries.has(discovery)) {
      discoveries = new Set(discoveries).add(discovery);
      score += delta;
      return;
    }

    if (!discovery && delta > 0) score += Math.min(delta, 10);
  }

  function runCommand(rawCommand = commandInput) {
    if (!scenario) return;

    const command = rawCommand.trim();
    if (!command) return;

    pushTimeline(`${selectedSection?.title ?? 'terminal'}$ ${command}`);

    const controlOutput = runShellControlCommand(command);
    if (controlOutput !== undefined) {
      if (controlOutput !== '') pushOutput(command, controlOutput);
      trackCommand(command, true);
      commandInput = '';
      return;
    }

    const matched = findCommand(scenario, command, activeSection);
    if (matched) {
      pushOutput(matched.command, matched.output);
      awardDiscovery(matched.discovery, matched.scoreDelta ?? 0);
      trackCommand(command, true);
      commandInput = '';
      return;
    }

    const builtInOutput = runBuiltInCommand(command);
    if (builtInOutput !== undefined) {
      pushOutput(command, builtInOutput);
      awardGenericEvidence(command);
      trackCommand(command, true);
      commandInput = '';
      return;
    }

    score -= 5;
    pushOutput(command, `bash: ${command}: command not found\nTry: help`);
    trackCommand(command, false);
    commandInput = '';
  }

  function trackCommand(command: string, recognized: boolean) {
    commandHistory = [
      ...commandHistory,
      {
        at: elapsed,
        section: selectedSection?.title ?? activeSection,
        command,
        recognized
      }
    ];
  }

  function awardGenericEvidence(command: string) {
    const normalized = command.toLowerCase();
    if (normalized.startsWith('cat ') || normalized.startsWith('tail ')) {
      awardDiscovery(`read ${activeSection} file evidence`, 15);
      return;
    }

    if (['top', 'df -h', 'free -m', 'ps aux', 'ss -tulpn', 'ip addr', 'env'].includes(normalized)) {
      awardDiscovery(`checked ${activeSection} baseline diagnostics`, 10);
    }
  }

  function addCandidateNote() {
    const text = noteInput.trim();
    if (!text) return;

    candidateNotes = [...candidateNotes, { at: elapsed, text }];
    pushTimeline(`note: ${text}`);
    noteInput = '';
  }

  function promptFor(command: string) {
    const host = activeSection || 'incident';
    return `prod@${host}:${shellPath}$ ${command}`;
  }

  function getDefaultPath(sectionId: string) {
    if (sectionId === 'postgres') return '/var/lib/postgresql';
    if (sectionId === 'redis') return '/data/redis';
    if (sectionId === 'nginx') return '/var/log/nginx';
    if (sectionId === 'backend') return '/srv/backend';
    if (sectionId === 'argocd') return '/apps/backend-prod';
    if (sectionId === 'docker') return '/opt/prod/compose';
    if (sectionId === 'kubernetes') return '/cluster/prod';
    return '/';
  }

  function resolvePath(target: string) {
    if (!target || target === '~') return getDefaultPath(activeSection);
    if (target === '..') return shellPath.split('/').slice(0, -1).join('/') || '/';
    if (target.startsWith('/')) return target.replace(/\/+$/, '') || '/';
    return `${shellPath.replace(/\/+$/, '')}/${target}`.replace(/\/+$/, '');
  }

  function runShellControlCommand(command: string): string | undefined {
    const normalized = command.trim().replace(/\s+/g, ' ');
    const lower = normalized.toLowerCase();

    if (lower === 'clear') {
      terminalOutputBySection = {
        ...terminalOutputBySection,
        [activeSection]: []
      };
      return '';
    }

    if (lower === 'help' || lower === '?') return helpOutput();

    if (lower === 'pwd') return shellPath;

    if (lower === 'ls' || lower.startsWith('ls ')) {
      return listDirectory(lower.includes('-la'));
    }

    if (lower === 'cd' || lower.startsWith('cd ')) {
      shellPath = resolvePath(normalized.slice(2).trim());
      return shellPath;
    }

    if (lower === 'whoami') return 'incident-candidate';
    if (lower === 'hostname') return `${activeSection || 'prod'}-diag-01`;

    return undefined;
  }

  function runBuiltInCommand(command: string): string | undefined {
    const normalized = command.trim().replace(/\s+/g, ' ');
    const lower = normalized.toLowerCase();

    if (lower === 'uptime') return '15:08:42 up 91 days,  3 users,  load average: 0.72, 0.81, 0.77';
    if (lower === 'top') return topOutput();
    if (lower === 'df -h') return diskOutput();
    if (lower === 'free -m') return 'Mem: 7972 total, 3782 used, 2997 free, 1193 buff/cache\nSwap: 2048 total, 0 used';
    if (lower === 'ps aux') return processOutput();
    if (lower === 'env') return envOutput();
    if (lower === 'ip addr') return 'eth0: inet 10.42.1.18/24 brd 10.42.1.255 scope global eth0\nlo: inet 127.0.0.1/8 scope host lo';
    if (lower === 'ss -tulpn' || lower === 'netstat -tulpn') return socketOutput();
    if (lower === 'du -sh *') return diskUsageOutput();
    if (lower.startsWith('cat ')) return catOutput(normalized.slice(4).trim());
    if (lower.startsWith('tail ')) return tailOutput(normalized);
    if (lower === 'curl -i localhost' || lower === 'curl -i http://localhost') {
      return `HTTP/1.1 ${serviceRestored ? '200 OK' : '500 Internal Server Error'}\nx-request-id: sim-${elapsed}`;
    }

    return undefined;
  }

  function listDirectory(long = false) {
    const files = filesForSection(activeSection);
    if (!long) return files.map((file) => file.name + (file.type === 'dir' ? '/' : '')).join('\t');

    return [
      'total ' + files.length * 8,
      ...files.map((file) => {
        const mode = file.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
        return `${mode}\t1\t${file.owner}\t${file.group}\t${file.size}\tAug 26 15:${file.minute}\t${file.name}${file.type === 'dir' ? '/' : ''}`;
      })
    ].join('\n');
  }

  function filesForSection(sectionId: string) {
    const f = (name: string, type: 'file' | 'dir' = 'file', size = '4.0K', owner = 'prod', group = 'prod') => ({
      name,
      type,
      size,
      owner,
      group,
      minute: String(10 + name.length).padStart(2, '0')
    });
    const common = [f('logs', 'dir'), f('config', 'file'), f('metrics', 'dir'), f('runbook.md')];
    const entries: Record<string, ReturnType<typeof f>[]> = {
      vm: [f('systemd', 'dir'), f('proc', 'dir'), f('nginx', 'dir'), f('backend', 'dir'), f('postgresql', 'dir'), ...common],
      docker: [f('docker-compose.yml'), f('.env'), f('networks', 'dir'), f('containers', 'dir'), f('events.log'), ...common],
      kubernetes: [
        f('nodes', 'dir'),
        f('pods', 'dir'),
        f('deployments', 'dir'),
        f('services', 'dir'),
        f('events.log'),
        f('configmaps', 'dir'),
        f('secrets.metadata'),
        ...common
      ],
      argocd: [f('application.yaml'), f('history.log'), f('diff.patch'), f('sync-policy.yaml'), ...common],
      backend: [f('app.log'), f('error.log'), f('release.env'), f('migrations', 'dir'), f('health.json'), ...common],
      postgres: [
        f('postgresql.conf'),
        f('pg_stat_activity.tsv'),
        f('schema.sql'),
        f('migrations', 'dir'),
        f('pg_log', 'dir'),
        ...common
      ],
      redis: [f('redis.conf'), f('dump.rdb', 'file', '18M', 'redis', 'redis'), f('slowlog.txt'), f('clients.tsv'), ...common],
      nginx: [f('access.log'), f('error.log'), f('upstream.conf'), f('status.json'), ...common]
    };
    return entries[sectionId] ?? common;
  }

  function helpOutput() {
    return [
      'Tab completion: complete a base command or file name in the current connection.',
      'Navigation: pwd, ls, cd <dir>, clear',
      'Host checks: top, uptime, free -m, df -h, du -sh *, ps aux, ss -tulpn, ip addr',
      'HTTP checks: curl -i localhost',
      'Logs/configs: tail -n 80 <log>, cat <file>, journalctl -u <service>',
      'Docker style: docker ps, docker stats, docker logs <container>, docker inspect <container>, docker compose ps',
      'Kubernetes style: kubectl get <resource>, kubectl describe <object>, kubectl logs <object>, kubectl rollout history <object>',
      'Notes: write hypotheses in Findings so the interviewer can see your reasoning.'
    ].join('\n');
  }

  function topOutput() {
    if (activeSection === 'postgres') return 'top - 15:09\nTasks: 87 total\n%Cpu(s): 11.0 us, 3.1 sy, 85.9 id\nPID USER CPU MEM COMMAND\n431 postgres 9.1 18.4 postgres: backend user query\n892 postgres 2.4 4.1 walwriter';
    if (activeSection === 'redis') return 'top - 15:09\n%Cpu(s): 4.2 us, 1.0 sy, 94.8 id\nPID USER CPU MEM COMMAND\n91 redis 4.0 3.2 redis-server *:6379';
    if (activeSection === 'docker') return 'top - 15:09\nPID USER CPU MEM COMMAND\n2141 root 31.8 2.3 containerd-shim backend-2\n1850 root 6.2 1.4 dockerd';
    return 'top - 15:09\nTasks: 128 total\n%Cpu(s): 18.0 us, 4.0 sy, 78.0 id\nPID USER CPU MEM COMMAND\n1842 backend 14.1 3.8 backend\n810 nginx 2.2 1.1 nginx: worker';
  }

  function diskOutput() {
    if (activeSection === 'postgres') return 'Filesystem Size Used Avail Use% Mounted on\n/dev/vdb1 120G 67G 47G 59% /var/lib/postgresql\n/dev/vda1 80G 41G 36G 54% /';
    if (activeSection === 'docker') return 'Filesystem Size Used Avail Use% Mounted on\noverlay 80G 48G 29G 63% /var/lib/docker\n/dev/vda1 80G 48G 29G 63% /';
    return 'Filesystem Size Used Avail Use% Mounted on\n/dev/vda1 80G 41G 36G 54% /\ntmpfs 3.9G 0 3.9G 0% /run';
  }

  function processOutput() {
    if (activeSection === 'postgres') return 'postgres 431 9.1 18.4 postgres: backend backend 10.42.1.18 SELECT\npostgres 892 2.4 4.1 postgres: walwriter';
    if (activeSection === 'nginx') return 'nginx 810 2.2 1.1 nginx: master process\nnginx 811 4.8 1.8 nginx: worker process';
    if (activeSection === 'backend') return 'backend 1842 14.1 3.8 /srv/backend/backend --config release.env';
    return 'root 1 0.0 0.1 init\nbackend 1842 14.1 3.8 backend\nnginx 810 2.2 1.1 nginx';
  }

  function envOutput() {
    if (activeSection === 'backend') return 'APP_ENV=prod\nAPP_VERSION=v2.18.0\nDB_HOST=postgres\nREDIS_HOST=redis\nFEATURE_USER_SETTINGS=true';
    if (activeSection === 'docker') return 'COMPOSE_PROJECT_NAME=prod\nBACKEND_REPLICAS=3\nREDIS_HOST=redis-prod';
    if (activeSection === 'argocd') return 'ARGOCD_APP_NAME=backend-prod\nSYNC_POLICY=automated\nSELF_HEAL=true';
    return 'APP_ENV=prod\nREGION=local-sim\nINCIDENT_MODE=true';
  }

  function socketOutput() {
    if (activeSection === 'postgres') return 'LISTEN 0 4096 0.0.0.0:5432 users:(postgres)\nESTAB 0 0 10.42.3.8:5432 10.42.1.18:48122';
    if (activeSection === 'redis') return 'LISTEN 0 4096 0.0.0.0:6379 users:(redis-server)';
    if (activeSection === 'backend') return 'LISTEN 0 4096 0.0.0.0:9000 users:(backend)\nESTAB 0 0 backend:9000 postgres:5432';
    return 'LISTEN 0 4096 0.0.0.0:80 users:(nginx)\nLISTEN 0 4096 127.0.0.1:9000 users:(backend)';
  }

  function diskUsageOutput() {
    if (activeSection === 'postgres') return '18G base\n420M pg_wal\n96K postgresql.conf\n2.1G pg_log';
    if (activeSection === 'docker') return '9.4G overlay2\n180M containers\n42M volumes\n4.0K network';
    if (activeSection === 'kubernetes') return '12K pods\n8.0K services\n20K deployments\n4.0K events';
    return '64M logs\n28M config\n214M releases\n8.0K runbook.md';
  }

  function configOutput() {
    if (activeSection === 'postgres') return 'max_connections = 300\nshared_buffers = 2GB\nlog_min_error_statement = error';
    if (activeSection === 'nginx') return 'upstream backend { server backend:9000; }\nproxy_connect_timeout 2s;\nproxy_read_timeout 30s;';
    if (activeSection === 'backend') return envOutput();
    if (activeSection === 'argocd') return 'application: backend-prod\nautoSync: enabled\nselfHeal: enabled\ntargetRevision: 8f34a1c';
    return 'APP_ENV=prod\nLOG_LEVEL=info\nINCIDENT_SIM=true';
  }

  function catOutput(target: string) {
    if (!target) return 'cat: missing file operand';

    const file = target.split('/').filter(Boolean).at(-1) ?? target;
    const normalized = file.toLowerCase();
    const known = new Set(filesForSection(activeSection).map((item) => item.name.toLowerCase()));
    const isKnownPath = known.has(normalized) || target.startsWith('/etc/') || target.startsWith('/var/') || target.startsWith('/srv/');

    if (!isKnownPath) return `cat: ${target}: No such file or directory`;
    if (normalized === 'runbook.md') return runbookOutput();
    if (normalized === 'config' || normalized.endsWith('.conf') || normalized.endsWith('.env')) return configOutput();
    if (normalized.endsWith('.log') || normalized === 'slowlog.txt') return logOutput();
    if (normalized === 'application.yaml') return 'apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: backend-prod\nspec:\n  syncPolicy:\n    automated:\n      selfHeal: true\n  source:\n    targetRevision: 8f34a1c';
    if (normalized === 'sync-policy.yaml') return 'automated:\n  prune: true\n  selfHeal: true\nretry:\n  limit: 2';
    if (normalized === 'diff.patch') return 'diff --git a/prod/backend.yaml b/prod/backend.yaml\nNo live drift in current cluster state.';
    if (normalized === 'history.log') return '14:10 a9c7e01 backend:v2.17.4\n15:00 8f34a1c backend:v2.18.0';
    if (normalized === 'schema.sql') return 'CREATE TABLE users (...);\nCREATE TABLE sessions (...);\nCREATE TABLE orders (...);\n-- user_settings is not present in this schema snapshot';
    if (normalized === 'pg_stat_activity.tsv') return 'pid\tusename\tstate\twait_event\tquery\n431\tbackend\tactive\t\tSELECT ...\n442\tbackend\tidle\tClientRead\tCOMMIT';
    if (normalized === 'clients.tsv') return 'id\taddr\tage\tidle\tcmd\n21\tbackend:48112\t184\t0\tget\n22\tbackend:48130\t12\t1\tset';
    if (normalized === 'secrets.metadata') return 'backend-db-password\tOpaque\t1\t180d\nredis-auth\tOpaque\t1\t180d\nvalues intentionally redacted';
    if (normalized === 'status.json' || normalized === 'health.json') {
      return serviceRestored
        ? '{ "status": "ok", "error_rate": 0.5, "checks": { "db": "ok", "redis": "ok" } }'
        : `{ "status": "degraded", "error_rate": ${errorRate}, "checks": { "db": "check logs", "redis": "unknown" } }`;
    }

    return `${target}: is a directory`;
  }

  function runbookOutput() {
    return [
      '# Incident runbook',
      '1. Confirm user impact and current error rate.',
      '2. Check the edge layer, app layer, and data dependencies.',
      '3. Prefer evidence before restarts or scaling.',
      '4. Restore service first when a safe rollback or config revert is available.',
      '5. Record hypotheses in Findings before closing the incident.',
      '',
      'TODO: не забыть написать нормальный процесс и напомнить Сане, чтобы он наконец описал, как это чинится. Да, Сань, это про тебя.'
    ].join('\n');
  }

  function logOutput() {
    if (activeSection === 'backend') return '15:05:12 ERROR GET /account/settings 500\n15:05:12 ERROR pq: relation "user_settings" does not exist\n15:05:13 ERROR failed to read account settings';
    if (activeSection === 'postgres') return 'ERROR: relation "user_settings" does not exist\nSTATEMENT: SELECT theme, locale FROM user_settings WHERE user_id = $1';
    if (activeSection === 'nginx') return 'GET /account/settings 500 42ms\nupstream returned 500 while reading response header from upstream';
    if (activeSection === 'docker') return 'backend-2 | REDIS_HOST=redis-prod\nbackend-2 | connect ECONNREFUSED redis-prod:6379';
    if (activeSection === 'argocd') return 'backend-prod synced revision 8f34a1c\nhealth degraded after deploy\nselfHeal enabled';
    return 'No app.log in current directory';
  }

  function tailOutput(command: string) {
    const file = command.split(/\s+/).at(-1) ?? '';
    if (!file || file.startsWith('-')) return 'tail: missing file operand';
    if (!file.toLowerCase().endsWith('.log') && file.toLowerCase() !== 'slowlog.txt') {
      return `tail: cannot open '${file}' for reading: No such file or directory`;
    }
    return logOutput();
  }

  function diagramForScenario(current: Scenario) {
    if (current.diagram) return current.diagram;

    if (current.difficulty === 'vm') {
      const nodes: DiagramNode[] = [
        { id: 'internet', label: 'Internet', x: 50, y: 8, tone: 'edge' },
        { id: 'nginx', label: 'Nginx', x: 50, y: 31, tone: 'edge' },
        { id: 'backend', label: 'Backend', x: 50, y: 55, tone: 'app' },
        { id: 'postgres', label: 'PostgreSQL', x: 50, y: 80, tone: 'data' }
      ];
      return { nodes, links: chainLinks(nodes) };
    }

    if (current.difficulty === 'docker') {
      const nodes: DiagramNode[] = [
        { id: 'internet', label: 'Internet', x: 50, y: 8, tone: 'edge' },
        { id: 'nginx', label: 'Nginx container', x: 50, y: 29, tone: 'edge' },
        { id: 'b1', label: 'backend-1', x: 24, y: 54, tone: 'app' },
        { id: 'b2', label: 'backend-2', x: 50, y: 54, tone: 'app' },
        { id: 'b3', label: 'backend-3', x: 76, y: 54, tone: 'app' },
        { id: 'redis', label: 'Redis', x: 36, y: 80, tone: 'data' },
        { id: 'postgres', label: 'PostgreSQL', x: 64, y: 80, tone: 'data' }
      ];
      return {
        nodes,
        links: [
          { from: 'internet', to: 'nginx' },
          { from: 'nginx', to: 'b1' },
          { from: 'nginx', to: 'b2' },
          { from: 'nginx', to: 'b3' },
          { from: 'b1', to: 'redis' },
          { from: 'b2', to: 'redis' },
          { from: 'b3', to: 'redis' },
          { from: 'b1', to: 'postgres' },
          { from: 'b3', to: 'postgres' }
        ] as DiagramLink[]
      };
    }

    const nodes: DiagramNode[] = [
      { id: 'internet', label: 'Internet', x: 50, y: 6, tone: 'edge' },
      { id: 'ingress', label: 'Ingress Nginx', x: 50, y: 23, tone: 'edge' },
      { id: 'svc', label: 'Service', x: 50, y: 40, tone: 'control' },
      { id: 'backend', label: 'Backend Deployment', x: 50, y: 58, tone: 'app' },
      { id: 'redis', label: 'Redis', x: 30, y: 80, tone: 'data' },
      { id: 'postgres', label: 'PostgreSQL', x: 70, y: 80, tone: 'data' },
      { id: 'argocd', label: 'ArgoCD', x: 16, y: 42, tone: 'control' }
    ];
    return {
      nodes,
      links: [
        { from: 'internet', to: 'ingress' },
        { from: 'ingress', to: 'svc' },
        { from: 'svc', to: 'backend' },
        { from: 'backend', to: 'redis' },
        { from: 'backend', to: 'postgres' },
        { from: 'argocd', to: 'backend' }
      ] as DiagramLink[]
    };
  }

  function chainLinks(nodes: DiagramNode[]): DiagramLink[] {
    return nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id }));
  }

  function nodeById(nodes: DiagramNode[], id: string) {
    return nodes.find((node) => node.id === id);
  }

  function diagramLines(current: Scenario): DiagramLine[] {
    const diagram = diagramForScenario(current);
    if (current.difficulty === 'architecture') return architectureDiagramLines(diagram.links);

    return diagram.links.flatMap((link) => {
      const from = nodeById(diagram.nodes, link.from);
      const to = nodeById(diagram.nodes, link.to);
      if (!from || !to) return [];

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const trim = Math.abs(dy) < 1 ? 3.5 : Math.abs(dx) < 1 ? 3.2 : 4.4;

      return [
        {
          x1: from.x + ux * trim,
          y1: from.y + uy * trim,
          x2: to.x - ux * trim,
          y2: to.y - uy * trim,
          label: link.label,
          status: link.status,
          direction: link.direction ?? 'forward'
        }
      ];
    });
  }

  function architectureDiagramLines(links: DiagramLink[]): DiagramLine[] {
    return links.flatMap((link) => {
      const d = architecturePath(link);
      if (!d) return [];

      return [
        {
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          d,
          label: link.label,
          status: link.status,
          direction: link.direction ?? 'forward'
        }
      ];
    });
  }

  function architecturePath(link: DiagramLink) {
    const paths: Record<string, string> = {
      'users->cdn': 'M 170 90 L 210 90',
      'cdn->gateway': 'M 360 90 L 400 90',
      'gateway->checkout': 'M 475 122 L 475 170 L 515 205',
      'checkout->cart': 'M 425 265 L 335 265',
      'checkout->redis-session': 'M 425 330 L 335 410',
      'checkout->payment': 'M 695 250 L 770 250',
      'payment->psp': 'M 920 250 L 980 250',
      'checkout->redis-analytics': 'M 560 375 L 560 465',
      'checkout->postgres': 'M 695 350 L 770 410',
      'checkout->kafka': 'M 470 375 L 430 540 L 400 608',
      'kafka->outbox': 'M 475 640 L 600 640'
    };
    return paths[`${link.from}->${link.to}`];
  }

  function lineClass(status: DiagramLink['status'] = 'ok') {
    if (status === 'blocked') return 'stroke-danger';
    if (status === 'degraded') return 'stroke-signal';
    if (status === 'unknown') return 'stroke-slate-500';
    return 'stroke-slate-200';
  }

  function markerId(status: DiagramLink['status'] = 'ok') {
    if (status === 'blocked') return 'arrow-blocked';
    if (status === 'degraded') return 'arrow-degraded';
    if (status === 'unknown') return 'arrow-unknown';
    return 'arrow-ok';
  }

  function markerStart(line: DiagramLine) {
    return line.direction === 'back' || line.direction === 'both' ? `url(#${markerId(line.status)})` : undefined;
  }

  function markerEnd(line: DiagramLine) {
    return line.direction === 'forward' || line.direction === 'both' ? `url(#${markerId(line.status)})` : undefined;
  }

  function nodeClasses(node: DiagramNode, compact = false) {
    const base = compact ? 'min-h-10 w-[116px] text-[11px]' : 'min-h-12 w-[118px] text-[11px] sm:w-[132px] sm:text-xs';
    if (!compact) {
      const tone =
        node.tone === 'data'
          ? 'border-ok/60 bg-[#0f241a] text-ok'
          : node.tone === 'control'
            ? 'border-signal/70 bg-[#2a2110] text-signal'
            : node.tone === 'app'
              ? 'border-slate-400/70 bg-[#1e2329] text-slate-100'
              : node.tone === 'queue'
                ? 'border-cyan-300/70 bg-[#10272e] text-cyan-100'
                : node.tone === 'external'
                  ? 'border-fuchsia-300/60 bg-[#27172e] text-fuchsia-100'
                  : node.tone === 'risk'
                    ? 'border-danger/80 bg-[#2a1014] text-danger'
                    : 'border-line bg-[#12191f] text-slate-200';
      return `${base} ${tone}`;
    }

    const tone =
      node.tone === 'data'
        ? 'border-ok/50 bg-ok/10 text-ok'
        : node.tone === 'control'
          ? 'border-signal/60 bg-signal/10 text-signal'
          : node.tone === 'app'
            ? 'border-slate-400/60 bg-slate-200/10 text-slate-100'
            : node.tone === 'queue'
              ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100'
              : node.tone === 'external'
                ? 'border-fuchsia-300/50 bg-fuchsia-300/10 text-fuchsia-100'
                : node.tone === 'risk'
                  ? 'border-danger/70 bg-danger/10 text-danger'
                  : 'border-line bg-panelSoft text-slate-200';
    return `${base} ${tone}`;
  }

  function architectureNodeClasses(node: DiagramNode) {
    if (node.id === 'checkout') {
      return 'h-[190px] w-[270px] flex-col gap-4 rounded-lg border-2 border-danger bg-[#641a22] text-danger shadow-[0_0_42px_rgba(255,107,107,0.18)]';
    }

    const tone =
      node.tone === 'edge'
        ? 'border-sky-400 bg-[#08213b] text-sky-100 shadow-[0_0_24px_rgba(56,189,248,0.16)]'
        : node.tone === 'data'
          ? 'border-ok/80 bg-[#0f2c1b] text-ok shadow-[0_0_24px_rgba(110,231,168,0.12)]'
          : node.tone === 'queue'
            ? 'border-cyan-300/80 bg-[#0c2d3a] text-cyan-100 shadow-[0_0_24px_rgba(103,232,249,0.12)]'
            : node.tone === 'external'
              ? 'border-fuchsia-300/70 bg-[#251634] text-fuchsia-100 shadow-[0_0_24px_rgba(217,70,239,0.12)]'
              : node.tone === 'risk'
                ? 'border-danger/80 bg-[#2a1014] text-danger shadow-[0_0_24px_rgba(255,107,107,0.14)]'
                : 'border-signal/80 bg-[#2a2110] text-signal shadow-[0_0_24px_rgba(248,201,90,0.12)]';

    return `h-16 w-[150px] gap-3 rounded-md border-2 px-4 text-sm ${tone}`;
  }

  function architectureNodeStyle(node: DiagramNode) {
    const centers: Record<string, { x: number; y: number }> = {
      users: { x: 95, y: 90 },
      cdn: { x: 285, y: 90 },
      gateway: { x: 475, y: 90 },
      checkout: { x: 560, y: 280 },
      cart: { x: 260, y: 265 },
      'redis-session': { x: 260, y: 410 },
      'redis-analytics': { x: 560, y: 500 },
      kafka: { x: 400, y: 640 },
      outbox: { x: 675, y: 640 },
      payment: { x: 845, y: 250 },
      postgres: { x: 845, y: 410 },
      psp: { x: 1055, y: 250 }
    };
    const center = centers[node.id] ?? { x: node.x * 11.8, y: node.y * 7.2 };
    return `left: ${center.x}px; top: ${center.y}px;`;
  }

  function architectureIconClasses(node: DiagramNode) {
    return node.id === 'checkout' ? 'h-14 w-14' : 'h-7 w-7 shrink-0';
  }

  function architecturePrimaryLabel(node: DiagramNode) {
    if (node.id === 'redis-session') return 'Redis';
    if (node.id === 'redis-analytics') return 'Redis';
    if (node.id === 'postgres') return 'PostgreSQL';
    if (node.id === 'kafka') return 'Kafka';
    if (node.id === 'payment') return 'Payment';
    if (node.id === 'observability') return 'Observability';
    if (node.id === 'logging') return 'Logging';
    return node.label;
  }

  function architectureSecondaryLabel(node: DiagramNode) {
    if (node.id === 'redis-session') return 'primary';
    if (node.id === 'redis-analytics') return 'analytics';
    if (node.id === 'postgres') return 'orders';
    if (node.id === 'kafka') return 'checkout-events';
    if (node.id === 'payment') return 'Orchestrator';
    if (node.id === 'observability') return 'Prometheus / Grafana';
    if (node.id === 'logging') return 'Loki / ELK';
    return '';
  }

  function iconForNode(id: string) {
    const icons = {
      users: Users,
      cdn: Globe,
      gateway: Network,
      auth: LockKeyhole,
      feature: Flag,
      checkout: ShoppingCart,
      cart: ShoppingCart,
      pricing: Tags,
      payment: CreditCard,
      'redis-session': Database,
      'redis-analytics': Database,
      postgres: Database,
      kafka: Network,
      outbox: Settings,
      psp: Landmark,
      observability: ChartColumn,
      logging: Search
    };
    return icons[id as keyof typeof icons] ?? Box;
  }

  function architectureNodes(current: Scenario) {
    return diagramForScenario(current).nodes.filter(
      (node) => node.id !== 'observability' && node.id !== 'logging'
    );
  }

  function groupedNode(current: Scenario, id: string): DiagramNode {
    return (
      diagramForScenario(current).nodes.find((node) => node.id === id) ?? {
        id,
        label: id,
        x: 0,
        y: 0,
        tone: 'control'
      }
    );
  }

  function connectNode(node: DiagramNode) {
    if (!scenario) return;

    const sectionId =
      node.sectionId ??
      scenario.sections.find((section) => node.label.toLowerCase().includes(section.id))?.id;
    if (sectionId) changeSection(sectionId);
    selectedDiagramNode = node;
  }

  function performAction(action: ScenarioAction) {
    if (!scenario) return;

    pushTimeline(action.label);
    pushOutput(action.label, action.output);
    score += action.scoreDelta;
    communication += action.communicationDelta ?? 0;

    if (action.penaltyReason) unsafeActions += 1;
    if (action.rootCauseDiscovery) awardDiscovery(action.rootCauseDiscovery, 0);

    if (action.restoreService) {
      serviceRestored = true;
      serviceRestoredAt = serviceRestoredAt ?? elapsed;
      serviceStatus = 'RECOVERED';
      errorRate = 0.5;
      affectedUsers = Math.max(12, Math.round(affectedUsers * 0.02));
    }

    if (action.argocdSelfHeal) {
      argocdWarning = true;
      clearSelfHeal();
      selfHealTimer = setTimeout(() => {
        if (!scenario || finished) return;
        serviceRestored = false;
        serviceRestoredAt = null;
        serviceStatus = 'DEGRADED';
        errorRate = 34;
        affectedUsers = 11180;
        pushOutput(
          'ArgoCD Self-Heal triggered',
          'backend:v2.18.0 deployed again\nError rate: 0.5% -> 34%\n\nGit desired state still points to the broken revision.'
        );
        pushTimeline('ArgoCD returned desired revision from Git');
        argocdWarning = false;
      }, 7000);
    }
  }

  function answerManager(answer: 'five-minutes' | 'working' | 'no-eta') {
    if (!currentManager) return;

    if (answer === 'five-minutes') {
      promisedEtaAt = elapsed + 300;
      communication = Math.max(0, communication - 5);
      pushTimeline('Answered manager: 5 минут');
    }

    if (answer === 'working') {
      communication = Math.min(100, communication + 3);
      pushTimeline('Answered manager: разбираемся');
    }

    if (answer === 'no-eta') {
      communication = Math.min(100, communication + 10);
      pushTimeline('Answered manager: ETA пока нет, определяем причину');
    }

    currentManager = null;
  }

  function answerInterviewer() {
    if (!currentInterviewerQuestion) return;

    const answer = interviewerAnswerInput.trim();
    if (!answer) return;

    const matched = currentInterviewerQuestion.idealKeywords.some((keyword) =>
      answer.toLowerCase().includes(keyword.toLowerCase())
    );
    interviewerAnswers = [
      ...interviewerAnswers,
      {
        at: elapsed,
        question: currentInterviewerQuestion.question,
        answer,
        matched,
        followUp: currentInterviewerQuestion.followUp
      }
    ];
    communication = Math.min(100, communication + (matched ? 8 : 2));
    score += matched ? 25 : 5;
    pushTimeline(`interviewer answer: ${matched ? 'on track' : 'needs follow-up'}`);
    currentInterviewerQuestion = null;
    interviewerAnswerInput = '';
  }

  function finishInvestigation() {
    if (!scenario || !canFinish) return;

    rootCauseFound = rootCauseLooksCorrect(scenario, rootCauseAnswer);
    if (rootCauseFound) score += 100;

    pushTimeline('Root cause submitted');

    const resultSummary = buildResultSummary({
      scenario,
      score,
      communication,
      restored: serviceRestored,
      rootCauseFound,
      discoveries,
      unsafeActions,
      elapsed,
      commandHistory,
      notesCount: candidateNotes.length,
      visitedSections
    });
    const impactSummary = buildImpactSummary({
      peakAffectedUsers,
      impactedUserSeconds,
      estimatedLossRub,
      recoveryTime: serviceRestoredAt
    });
    result = resultSummary;
    impact = impactSummary;
    reportText = buildInterviewReport({
      scenario,
      elapsed,
      score,
      result: resultSummary,
      impact: impactSummary,
      serviceRestored,
      rootCauseFound,
      timeline,
      commandHistory,
      candidateNotes,
      interviewerAnswers,
      rootCauseAnswer,
      recoveryAnswer,
      preventionAnswer
    });
    finished = true;
  }

  function downloadReport() {
    if (!reportText || !scenario) return;

    const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${scenario.id}-interview-report.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function recognizedCommandCount() {
    return commandHistory.filter((item) => item.recognized).length;
  }

  function sectionEvidenceCount() {
    return new Set(commandHistory.map((item) => item.section).filter(Boolean)).size;
  }

  function handleTerminalKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;

    event.preventDefault();
    const completion = completeCommand(commandInput);
    if (completion) commandInput = completion;
  }

  function completeCommand(input: string) {
    const raw = input;
    const trimmedStart = raw.trimStart();
    const catLike = /^(cat|tail -n 80|tail)\s+(.+)?$/i.exec(trimmedStart);

    if (catLike) {
      const prefix = catLike[2] ?? '';
      const match = filesForSection(activeSection)
        .map((item) => item.name)
        .find((name) => name.toLowerCase().startsWith(prefix.toLowerCase()));
      if (!match) return raw;
      return `${catLike[1]} ${match}`;
    }

    const scenarioMatch = selectedSection?.commands.find((command) =>
      command.toLowerCase().startsWith(trimmedStart.toLowerCase())
    );
    if (scenarioMatch) {
      const leading = raw.slice(0, raw.length - trimmedStart.length);
      return leading + scenarioMatch;
    }

    const match = genericCommandCompletions.find((command) =>
      command.toLowerCase().startsWith(trimmedStart.toLowerCase())
    );
    if (!match) return raw;

    const leading = raw.slice(0, raw.length - trimmedStart.length);
    return leading + match;
  }
</script>

<svelte:head>
  <title>Прод лёг</title>
</svelte:head>

<main class="min-h-screen text-ink">
  <section class="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
    <header
      class="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-end lg:justify-between"
    >
      <div>
        <p class="font-mono text-xs uppercase tracking-[0.24em] text-signal">DevOps interview incident simulator</p>
        <h1 class="mt-1 text-3xl font-semibold tracking-normal sm:text-5xl">Прод лёг</h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-300">
          У тебя 20 минут. Прод не работает. Разбирайся.
        </p>
      </div>

      {#if scenario && scenario.difficulty !== 'architecture'}
          <div class="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-3 xl:grid-cols-6">
            <div class="border border-line bg-panel px-3 py-2">
              <span class="block text-slate-500">ERROR RATE</span>
              <strong class="text-xl text-danger">{errorRate}%</strong>
            </div>
            <div class="border border-line bg-panel px-3 py-2">
              <span class="block text-slate-500">USERS</span>
              <strong class="text-xl">{affectedUsers.toLocaleString('ru-RU')}</strong>
            </div>
            <div class="border border-line bg-panel px-3 py-2">
              <span class="block text-slate-500">STATUS</span>
              <strong class:text-ok={serviceStatus === 'RECOVERED'} class:text-danger={serviceStatus !== 'RECOVERED'}>
                {serviceStatus}
              </strong>
            </div>
            <div class="border border-line bg-panel px-3 py-2">
              <span class="block text-slate-500">TIME</span>
              <strong class="text-xl">{formatTimer(remaining)}</strong>
            </div>
            <div class="border border-line bg-panel px-3 py-2">
              <span class="block text-slate-500">SCORE</span>
              <strong class="text-xl text-signal">{score}</strong>
            </div>
            <div class="border border-line bg-panel px-3 py-2">
              <span class="block text-slate-500">LOSS</span>
              <strong class="text-xl text-danger">{formatRub(estimatedLossRub)}</strong>
            </div>
          </div>
      {/if}
    </header>

    {#if !scenario}
      <div class="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each scenarios as item}
            <button
              class={`group flex min-h-[220px] flex-col justify-between border p-5 text-left transition ${
                selectedScenarioForStart?.id === item.id
                  ? 'border-signal bg-signal/10'
                  : 'border-line bg-panel hover:border-signal hover:bg-panelSoft'
              }`}
              on:click={() => (selectedScenarioForStart = item)}
            >
              <span>
                <span class="mb-4 flex h-11 w-11 items-center justify-center border border-line bg-black/30 text-signal">
                  {#if item.difficulty === 'vm'}
                    <Server size={22} aria-hidden="true" />
                  {:else if item.difficulty === 'docker'}
                    <Layers size={22} aria-hidden="true" />
                  {:else}
                    <Workflow size={22} aria-hidden="true" />
                  {/if}
                </span>
                <span class="block font-mono text-xs uppercase text-slate-500">{item.incidentNumber}</span>
                <span class="mt-2 block text-lg font-semibold">{item.name}</span>
                <span class="mt-3 block text-sm leading-6 text-slate-300">{item.incidentTitle}</span>
              </span>
              <span class="mt-5 font-mono text-xs uppercase text-slate-500">{item.difficulty}</span>
            </button>
          {/each}
        </div>

        <aside class="border border-line bg-panel p-5">
          {#if selectedScenarioForStart}
            <p class="font-mono text-xs uppercase text-slate-500">{selectedScenarioForStart.incidentNumber}</p>
            <h2 class="mt-2 text-2xl font-semibold">{selectedScenarioForStart.name}</h2>
            <p class="mt-4 text-sm leading-6 text-slate-300">{selectedScenarioForStart.incidentText}</p>
            <div class="mt-6 grid grid-cols-2 gap-2 font-mono text-xs">
              <div class="border border-line bg-black/20 p-3">
                <span class="block text-slate-500">TIMEBOX</span>
                <strong>{formatTimer(selectedScenarioForStart.duration)}</strong>
              </div>
              <div class="border border-line bg-black/20 p-3">
                <span class="block text-slate-500">ERROR RATE</span>
                <strong class="text-danger">{selectedScenarioForStart.initialState.errorRate}%</strong>
              </div>
            </div>
            <button
              class="mt-6 flex min-h-12 w-full items-center justify-center gap-2 border border-signal bg-signal px-4 py-3 font-semibold text-black transition hover:bg-[#ffd974]"
              on:click={startSelectedScenario}
            >
              <Play size={18} aria-hidden="true" />
              Start
            </button>
          {/if}
        </aside>
      </div>
    {:else if finished && result && impact}
      <section class="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div class="border border-line bg-panel p-5">
          <p class="font-mono text-sm uppercase text-ok">Incident resolved</p>
          <h2 class="mt-2 text-3xl font-semibold">
            {serviceRestored ? 'Сервис восстановлен' : 'Расследование завершено без восстановления'}
          </h2>
          <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Time</span>
              <strong class="font-mono text-2xl">{formatTimer(elapsed)}</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Score</span>
              <strong class="font-mono text-2xl text-signal">{score}</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Service restored</span>
              <strong class="inline-flex items-center gap-2">
                {#if serviceRestored}<CheckCircle2 size={18} class="text-ok" /> YES{:else}<XCircle size={18} class="text-danger" /> NO{/if}
              </strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Root cause found</span>
              <strong class="inline-flex items-center gap-2">
                {#if rootCauseFound}<CheckCircle2 size={18} class="text-ok" /> YES{:else}<XCircle size={18} class="text-danger" /> NO{/if}
              </strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Total score</span>
              <strong class="font-mono text-2xl text-ok">{result.total}/100</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Signal</span>
              <strong class="text-lg">{result.levelSignal}</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Confidence</span>
              <strong class="font-mono text-2xl">{result.confidence}/100</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="block text-sm text-slate-400">Recovered at</span>
              <strong class="font-mono text-2xl">
                {impact.recoveryTime === null ? 'N/A' : formatTimer(impact.recoveryTime)}
              </strong>
            </div>
          </div>

          <div class="mt-6 border border-line bg-black/20 p-4">
            <h3 class="flex items-center gap-2 font-semibold">
              <Activity size={18} />
              Business Impact
            </h3>
            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Estimated loss</span>
                <strong class="font-mono text-xl text-danger">{formatRub(impact.estimatedLossRub)}</strong>
              </div>
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Peak affected users</span>
                <strong class="font-mono text-xl">{impact.peakAffectedUsers.toLocaleString('ru-RU')}</strong>
              </div>
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Estimated affected</span>
                <strong class="font-mono text-xl">{impact.estimatedAffectedUsers.toLocaleString('ru-RU')}</strong>
              </div>
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">User-minutes</span>
                <strong class="font-mono text-xl">{impact.impactedUserMinutes.toLocaleString('ru-RU')}</strong>
              </div>
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-400">
              Это симуляционная оценка impact: она помогает сравнивать прохождения одного кейса, но не заменяет
              реальные бизнес-метрики компании.
            </p>
          </div>

          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <div class="border border-line bg-black/20 p-4">
              <span class="text-sm text-slate-400">Recovery</span>
              <meter class="mt-2 block w-full" min="0" max="100" value={result.recovery}></meter>
              <strong>{result.recovery}/100</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="text-sm text-slate-400">Diagnostics</span>
              <meter class="mt-2 block w-full" min="0" max="100" value={result.diagnostics}></meter>
              <strong>{result.diagnostics}/100</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="text-sm text-slate-400">Root Cause</span>
              <meter class="mt-2 block w-full" min="0" max="100" value={result.rootCause}></meter>
              <strong>{result.rootCause}/100</strong>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="text-sm text-slate-400">Safety</span>
              <meter class="mt-2 block w-full" min="0" max="100" value={result.safety}></meter>
              <strong>{result.safety}/100</strong>
            </div>
            <div class="border border-line bg-black/20 p-4 sm:col-span-2">
              <span class="text-sm text-slate-400">Communication</span>
              <meter class="mt-2 block w-full" min="0" max="100" value={result.communication}></meter>
              <strong>{result.communication}/100</strong>
            </div>
          </div>

          <div class="mt-6 border border-line bg-black/20 p-4">
            <h3 class="flex items-center gap-2 font-semibold">
              <ShieldCheck size={18} />
              Assessment Calibration
            </h3>
            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Commands</span>
                <strong class="font-mono text-xl">{commandHistory.length}</strong>
              </div>
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Recognized</span>
                <strong class="font-mono text-xl">{recognizedCommandCount()}</strong>
              </div>
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Sections touched</span>
                <strong class="font-mono text-xl">{sectionEvidenceCount()}</strong>
              </div>
              <div class="border border-line bg-panel p-3">
                <span class="block text-sm text-slate-400">Notes</span>
                <strong class="font-mono text-xl">{candidateNotes.length}</strong>
              </div>
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-400">
              Итоговая оценка опирается на evidence: команды, покрытие компонентов, заметки, безопасность действий
              и финальную формулировку. Низкий confidence означает, что стоит задать уточняющие вопросы, а не
              автоматически снижать кандидата.
            </p>
          </div>

          <div class="mt-6 border border-line bg-black/20 p-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 class="flex items-center gap-2 font-semibold">
                <FileText size={18} />
                Full Report
              </h3>
              <button
                class="flex min-h-10 items-center justify-center gap-2 border border-signal bg-signal px-3 py-2 text-sm font-semibold text-black transition hover:bg-[#ffd974]"
                on:click={downloadReport}
              >
                <Download size={16} aria-hidden="true" />
                Download Markdown
              </button>
            </div>
            <textarea
              class="terminal-scroll mt-4 h-80 w-full border-line bg-[#06080a] font-mono text-xs leading-5 text-slate-200 focus:border-signal focus:ring-signal"
              readonly
              value={reportText}
            ></textarea>
          </div>

          <div class="mt-6 border border-line bg-black/20 p-4">
            <h3 class="flex items-center gap-2 font-semibold">
              <FileText size={18} />
              Candidate Findings
            </h3>
            {#if candidateNotes.length}
              <ol class="mt-4 space-y-3">
                {#each candidateNotes as note}
                  <li class="grid grid-cols-[52px_1fr] gap-3 border-l border-signal/60 pl-3 text-sm">
                    <span class="font-mono text-xs text-slate-500">{formatTimer(note.at)}</span>
                    <span class="whitespace-pre-wrap text-slate-200">{note.text}</span>
                  </li>
                {/each}
              </ol>
            {:else}
              <p class="mt-3 text-sm text-slate-500">Кандидат не оставил заметок во время расследования.</p>
            {/if}
          </div>

          <div class="mt-4 grid gap-3">
            <div class="border border-line bg-black/20 p-4">
              <span class="font-mono text-xs uppercase text-slate-500">Root cause answer</span>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{rootCauseAnswer}</p>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="font-mono text-xs uppercase text-slate-500">Recovery answer</span>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{recoveryAnswer}</p>
            </div>
            <div class="border border-line bg-black/20 p-4">
              <span class="font-mono text-xs uppercase text-slate-500">Prevention answer</span>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{preventionAnswer}</p>
            </div>
          </div>

          <p class="mt-6 border-l-4 border-signal bg-signal/10 px-4 py-3 text-sm text-slate-200">
            Score является игровой метрикой и не является автоматической оценкой уровня инженера.
          </p>
        </div>

        <aside class="border border-line bg-panel p-5">
          <h3 class="flex items-center gap-2 font-semibold"><History size={18} /> Timeline</h3>
          <ol class="terminal-scroll mt-4 max-h-[520px] space-y-3 overflow-auto pr-2 font-mono text-xs">
            {#each timeline as item}
              <li class="grid grid-cols-[48px_1fr] gap-3">
                <span class="text-slate-500">{formatTimer(item.at)}</span>
                <span>{item.text}</span>
              </li>
            {/each}
          </ol>
        </aside>
      </section>
    {:else}
      {#if scenario.difficulty === 'architecture'}
        <section class="grid gap-4">
          <section class="overflow-hidden border border-line bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
            <div class="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h3 class="flex items-center gap-2 font-semibold">
                  <Workflow size={18} />
                  Incident Map
                </h3>
              </div>
              <span class="font-mono text-2xl font-semibold text-signal sm:text-3xl">{formatTimer(remaining)}</span>
            </div>

            <div class="overflow-auto bg-[#03080d]">
              <div
                class="relative mx-auto h-[720px] w-[1180px] overflow-hidden bg-[#061019]"
                style="background-image: linear-gradient(90deg, rgba(59, 130, 246, 0.05) 1px, transparent 1px), linear-gradient(rgba(59, 130, 246, 0.045) 1px, transparent 1px); background-size: 48px 48px;"
              >
                <svg class="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 1180 720" aria-hidden="true">
                  <defs>
                    <marker id="arrow-ok" viewBox="0 0 14 14" refX="12" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                      <path d="M 1 1 L 13 7 L 1 13 z" fill="#e2e8f0" />
                    </marker>
                    <marker id="arrow-degraded" viewBox="0 0 14 14" refX="12" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                      <path d="M 1 1 L 13 7 L 1 13 z" fill="#f8c95a" />
                    </marker>
                    <marker id="arrow-blocked" viewBox="0 0 14 14" refX="12" refY="7" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                      <path d="M 1 1 L 13 7 L 1 13 z" fill="#ff6b6b" />
                    </marker>
                    <marker id="arrow-unknown" viewBox="0 0 14 14" refX="12" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                      <path d="M 1 1 L 13 7 L 1 13 z" fill="#64748b" />
                    </marker>
                  </defs>
                  {#each diagramLines(scenario) as line}
                    {#if line.d}
                      <path
                        d={line.d}
                        class={lineClass(line.status)}
                        fill="none"
                        opacity={line.status === 'blocked' ? '0.95' : '0.82'}
                        stroke-width={line.status === 'blocked' ? '5' : '3'}
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        marker-start={markerStart(line)}
                        marker-end={markerEnd(line)}
                      />
                    {:else}
                      <line
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        class={lineClass(line.status)}
                        opacity={line.status === 'blocked' ? '0.95' : '0.82'}
                        stroke-width={line.status === 'blocked' ? '0.58' : '0.34'}
                        stroke-linecap="round"
                        marker-start={markerStart(line)}
                        marker-end={markerEnd(line)}
                      />
                    {/if}
                  {/each}
                </svg>

                {#each architectureNodes(scenario) as node}
                  {@const Icon = iconForNode(node.id)}
                  <div
                    class={`absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center font-mono font-semibold leading-tight ${architectureNodeClasses(node)}`}
                    style={architectureNodeStyle(node)}
                  >
                    <Icon class={architectureIconClasses(node)} strokeWidth={1.8} aria-hidden="true" />
                    <span class={node.id === 'checkout' ? 'text-2xl text-white' : 'grid text-sm'}>
                      <span>{architecturePrimaryLabel(node)}</span>
                      {#if node.id !== 'checkout' && architectureSecondaryLabel(node)}
                        <span class="text-xs font-normal opacity-90">{architectureSecondaryLabel(node)}</span>
                      {/if}
                    </span>
                  </div>
                {/each}

                <div
                  class="absolute z-20 grid -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-dashed border-slate-400/60 bg-[#111827]/55 p-4"
                  style="left: 1045px; top: 520px; width: 220px;"
                >
                  {#if groupedNode(scenario, 'observability')}
                    {@const observability = groupedNode(scenario, 'observability')}
                    {@const ObservabilityIcon = iconForNode('observability')}
                    <div class="flex min-h-[82px] items-center gap-4 rounded-md border-2 border-orange-400/80 bg-[#2a2110] px-4 text-orange-100 shadow-[0_0_24px_rgba(251,146,60,0.14)]">
                      <ObservabilityIcon class="h-8 w-8 shrink-0 text-orange-300" strokeWidth={1.8} aria-hidden="true" />
                      <span class="grid font-mono leading-tight">
                        <span class="font-semibold">{architecturePrimaryLabel(observability)}</span>
                        <span class="text-[11px] text-orange-100/80">{architectureSecondaryLabel(observability)}</span>
                      </span>
                    </div>
                  {/if}
                  {#if groupedNode(scenario, 'logging')}
                    {@const logging = groupedNode(scenario, 'logging')}
                    {@const LoggingIcon = iconForNode('logging')}
                    <div class="flex min-h-[82px] items-center gap-4 rounded-md border-2 border-orange-400/80 bg-[#2a2110] px-4 text-orange-100 shadow-[0_0_24px_rgba(251,146,60,0.14)]">
                      <LoggingIcon class="h-8 w-8 shrink-0 text-orange-300" strokeWidth={1.8} aria-hidden="true" />
                      <span class="grid font-mono leading-tight">
                        <span class="font-semibold">{architecturePrimaryLabel(logging)}</span>
                        <span class="text-[11px] text-orange-100/80">{architectureSecondaryLabel(logging)}</span>
                      </span>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </section>
        </section>
      {:else}
      <section class="grid gap-4 xl:grid-cols-[320px_1fr_360px]">
        <aside class="flex flex-col gap-4">
          <div class="border border-line bg-panel p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-mono text-xs uppercase text-slate-500">{scenario.incidentNumber}</p>
                <h2 class="mt-1 text-xl font-semibold">{scenario.incidentTitle}</h2>
              </div>
              <button
                class="flex h-11 w-11 items-center justify-center border border-signal bg-signal text-black transition hover:bg-[#ffd974]"
                title="Restart game"
                on:click={restartScenario}
              >
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            </div>
            <p class="mt-4 text-sm leading-6 text-slate-300">{scenario.incidentText}</p>
          </div>

          <div class="border border-line bg-panel p-4">
            <h3 class="flex items-center gap-2 text-sm font-semibold uppercase text-slate-300">
              <Activity size={16} />
              Infrastructure
            </h3>
            <div class="relative mt-4 h-[280px] overflow-hidden border border-line bg-black/25">
              <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
                {#each diagramLines(scenario) as line}
                  <line
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    class={lineClass(line.status)}
                    opacity="0.5"
                    stroke-width="0.6"
                  />
                {/each}
              </svg>
              {#each diagramForScenario(scenario).nodes as node}
                <button
                  class={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border px-2 text-center font-mono leading-4 transition hover:border-signal ${nodeClasses(node, true)} ${
                    selectedDiagramNode?.id === node.id ? 'ring-2 ring-signal ring-offset-2 ring-offset-black' : ''
                  }`}
                  style={`left: ${node.x}%; top: ${node.y}%`}
                  title={`Connect to ${node.label}`}
                  on:click={() => connectNode(node)}
                >
                  {node.label}
                </button>
              {/each}
            </div>
          </div>

          <div class="border border-line bg-panel p-4">
            <h3 class="flex items-center gap-2 text-sm font-semibold uppercase text-slate-300">
              <ShieldCheck size={16} />
              Actions
            </h3>
            <div class="mt-4 grid gap-2">
              {#each scenario.actions as action}
                <button
                  class={`flex min-h-11 items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition ${
                    action.tone === 'primary'
                      ? 'border-signal bg-signal text-black hover:bg-[#ffd974]'
                      : action.tone === 'danger'
                        ? 'border-danger/70 bg-danger/10 text-danger hover:bg-danger/20'
                        : 'border-line bg-black/20 text-slate-100 hover:border-slate-400'
                  }`}
                  on:click={() => performAction(action)}
                >
                  {#if action.id === 'rollback' || action.id === 'git-rollback'}
                    <GitBranch size={16} aria-hidden="true" />
                  {:else}
                    <AlertTriangle size={16} aria-hidden="true" />
                  {/if}
                  {action.label}
                </button>
              {/each}
            </div>
            {#if argocdWarning}
              <p class="mt-3 border border-signal/60 bg-signal/10 p-3 font-mono text-xs text-signal">
                ArgoCD detected drift. Self-heal armed.
              </p>
            {/if}
          </div>
        </aside>

        <div class="grid gap-4">
          <section class="border border-line bg-panel">
            <div class="flex flex-wrap border-b border-line">
              {#each scenario.sections as section}
                <button
                  class={`min-h-12 border-r border-line px-4 py-2 text-sm transition ${
                    activeSection === section.id ? 'bg-signal text-black' : 'bg-transparent text-slate-300 hover:bg-panelSoft'
                  }`}
                  on:click={() => changeSection(section.id)}
                >
                  {section.title}
                </button>
              {/each}
            </div>

            {#if selectedSection}
              <div class="grid gap-4 p-4 lg:grid-cols-[220px_1fr]">
                <div>
                  <p class="font-mono text-xs uppercase text-slate-500">Connected target</p>
                  <p class="mt-2 text-lg font-semibold">{selectedSection.title}</p>
                  <p class="mt-3 text-sm leading-6 text-slate-300">{selectedSection.description}</p>
                  <div class="mt-4 border border-line bg-black/20 p-3 font-mono text-xs text-slate-400">
                    cwd: {shellPath}<br />
                    type `help` for shell basics
                  </div>
                </div>

                <div class="min-h-[420px] border border-line bg-[#06080a]">
                  <div class="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 class="flex items-center gap-2 font-mono text-sm">
                      <Terminal size={16} />
                      Output
                    </h3>
                    <span class="font-mono text-xs text-slate-500">{scenario.name}</span>
                  </div>
                  <div class="terminal-scroll h-[360px] overflow-auto p-4">
                    {#each activeTerminalOutput as output}
                      <pre class="mb-4 whitespace-pre-wrap border-l border-line pl-4 font-mono text-xs leading-6 text-slate-200">{output}</pre>
                    {/each}
                  </div>
                  <form class="flex border-t border-line" on:submit|preventDefault={() => runCommand()}>
                    <input
                      class="min-h-12 flex-1 border-0 bg-black px-4 font-mono text-sm text-ink placeholder:text-slate-600 focus:ring-0"
                      placeholder="$ command"
                      bind:value={commandInput}
                      on:keydown={handleTerminalKeydown}
                    />
                    <button
                      class="flex min-h-12 w-14 items-center justify-center bg-signal text-black transition hover:bg-[#ffd974]"
                      title="Run command"
                      type="submit"
                    >
                      <Send size={18} aria-hidden="true" />
                    </button>
                  </form>
                </div>
              </div>
            {/if}
          </section>

          <section class="grid gap-4 lg:grid-cols-2">
            <div class="border border-line bg-panel p-4">
              <h3 class="flex items-center gap-2 font-semibold">
                <FileText size={18} />
                Findings
              </h3>
              <form class="mt-4 grid gap-3" on:submit|preventDefault={addCandidateNote}>
                <textarea
                  class="min-h-28 border-line bg-black/30 text-sm text-ink placeholder:text-slate-600 focus:border-signal focus:ring-signal"
                  placeholder="Гипотеза, наблюдение, что проверить дальше..."
                  bind:value={noteInput}
                ></textarea>
                <button
                  class="flex min-h-11 items-center justify-center gap-2 border border-signal bg-signal px-3 py-2 text-sm font-semibold text-black transition hover:bg-[#ffd974]"
                  type="submit"
                >
                  <Send size={16} aria-hidden="true" />
                  Записать
                </button>
              </form>
              {#if candidateNotes.length}
                <ol class="terminal-scroll mt-4 max-h-44 space-y-2 overflow-auto pr-2">
                  {#each candidateNotes as note}
                    <li class="grid grid-cols-[48px_1fr] gap-3 border-l border-line pl-3 text-sm">
                      <span class="font-mono text-xs text-slate-500">{formatTimer(note.at)}</span>
                      <span class="whitespace-pre-wrap text-slate-200">{note.text}</span>
                    </li>
                  {/each}
                </ol>
              {/if}
            </div>

            <div class="border border-line bg-panel p-4">
              <h3 class="flex items-center gap-2 font-semibold">
                <MessageSquare size={18} />
                Manager
              </h3>
              <div class="mt-4 min-h-[112px] border border-line bg-black/20 p-4">
                {#if currentManager}
                  <p class="font-mono text-sm uppercase text-signal">Менеджер</p>
                  <p class="mt-3 text-lg font-semibold">{currentManager.message}</p>
                  <div class="mt-4 grid gap-2 sm:grid-cols-3">
                    <button class="border border-line px-3 py-2 text-sm hover:border-signal" on:click={() => answerManager('five-minutes')}>
                      5 минут
                    </button>
                    <button class="border border-line px-3 py-2 text-sm hover:border-signal" on:click={() => answerManager('working')}>
                      Разбираемся
                    </button>
                    <button class="border border-line px-3 py-2 text-sm hover:border-signal" on:click={() => answerManager('no-eta')}>
                      ETA пока нет
                    </button>
                  </div>
                {:else}
                  <p class="font-mono text-sm text-slate-500">Communication: {communication}/100</p>
                  <p class="mt-3 text-sm text-slate-400">Тишина в чате инцидента. Почти роскошь.</p>
                {/if}
              </div>
            </div>
          </section>

          <section class="border border-line bg-panel p-4">
            <h3 class="font-semibold">Завершить расследование</h3>
            <div class="mt-4 grid gap-3">
              <label class="grid gap-2 text-sm">
                <span class="text-slate-300">В чём была причина инцидента?</span>
                <textarea class="min-h-24 border-line bg-black/30 text-ink focus:border-signal focus:ring-signal" bind:value={rootCauseAnswer}></textarea>
              </label>
              <label class="grid gap-2 text-sm">
                <span class="text-slate-300">Что вы сделали для восстановления?</span>
                <textarea class="min-h-20 border-line bg-black/30 text-ink focus:border-signal focus:ring-signal" bind:value={recoveryAnswer}></textarea>
              </label>
              <label class="grid gap-2 text-sm">
                <span class="text-slate-300">Что бы вы сделали, чтобы проблема не повторилась?</span>
                <textarea class="min-h-20 border-line bg-black/30 text-ink focus:border-signal focus:ring-signal" bind:value={preventionAnswer}></textarea>
              </label>
              <button
                class="flex min-h-12 items-center justify-center gap-2 border border-ok bg-ok text-black font-semibold disabled:cursor-not-allowed disabled:border-line disabled:bg-slate-800 disabled:text-slate-500"
                disabled={!canFinish}
                on:click={finishInvestigation}
              >
                <CheckCircle2 size={18} aria-hidden="true" />
                Завершить расследование
              </button>
            </div>
          </section>
        </div>

        <aside class="border border-line bg-panel p-4">
          <div class="flex items-center justify-between gap-3">
            <h3 class="flex items-center gap-2 font-semibold">
              <History size={18} />
              Timeline
            </h3>
            <span class="flex items-center gap-1 font-mono text-xs text-slate-500">
              <Clock3 size={14} />
              {formatTimer(elapsed)}
            </span>
          </div>
          <ol class="terminal-scroll mt-4 max-h-[760px] space-y-3 overflow-auto pr-2 font-mono text-xs">
            {#each timeline as item}
              <li class="grid grid-cols-[48px_1fr] gap-3">
                <span class="text-slate-500">{formatTimer(item.at)}</span>
                <span>{item.text}</span>
              </li>
            {/each}
          </ol>
        </aside>
      </section>
      {/if}
    {/if}
  </section>
</main>
