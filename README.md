# Прод лёг

Браузерная интерактивная игра для технических собеседований DevOps/SRE-инженеров.

Кандидат получает production-инцидент, смотрит псевдологи и метрики, выполняет диагностические действия, восстанавливает сервис и формулирует root cause. В MVP всё симулируется во frontend через JSON-сценарии: реальных VM, Docker, Kubernetes, PostgreSQL и Redis нет.

## Что есть в MVP

- уровни `VM`, `Docker`, `Kubernetes`;
- 10 scenarios: по 3 кейса на `VM`, `Docker`, `Kubernetes` и отдельный architecture drill;
- отдельная кнопка `Start`, после которой начинается таймер;
- 20-минутный таймер, score и communication score;
- постоянные incident metrics: error rate, affected users, service status;
- псевдотерминал с поддержанными командами;
- UI-разделы диагностики как подключения к компонентам;
- отдельный terminal output для каждой вкладки подключения;
- схема инфраструктуры с узлами и связями;
- ручной блок `Findings` для заметок, гипотез и плана проверки кандидата;
- timeline действий кандидата;
- большая кнопка `ROLLBACK`;
- Kubernetes-сценарий с ArgoCD self-heal после ручного rollback;
- manager events с вариантами ответа;
- architecture drill с большой кликабельной схемой, подготовленными вопросами интервьюера и правой панелью заметок;
- экран результата с impact estimate, scoring rubric и полным interview report;
- скачивание полного отчёта в Markdown;
- textarea-ответы по root cause, восстановлению и prevention.

## Локальный запуск

```bash
npm install
npm run dev
```

По умолчанию Vite покажет локальный URL, обычно `http://localhost:5173`.

## Docker

```bash
docker compose up -d
```

После сборки приложение доступно на:

```text
http://localhost:8080
```

Остановить:

```bash
docker compose down
```

## GitHub Pages

Добавлен workflow:

```text
.github/workflows/pages.yml
```

Он собирает статическую версию SvelteKit и публикует папку `build` через GitHub Pages artifact. В настройках репозитория нужно выбрать:

```text
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

Для project pages workflow передаёт `BASE_PATH=/<repo-name>`, чтобы SvelteKit корректно собрал пути ассетов.
Workflow использует официальный Pages-пайплайн: `actions/configure-pages`, `actions/upload-pages-artifact` и `actions/deploy-pages`.

## Структура

```text
src/
  lib/
    scenarioEngine.ts
    types.ts
  routes/
    +page.svelte
  scenarios/
    vm/
      failed-db-migration.json
      disk-full-logs.json
      nginx-upstream-port.json
    docker/
      wrong-redis-host.json
      db-pool-exhaustion.json
      broken-healthcheck.json
    kubernetes/
      argocd-failed-migration.json
      service-selector-mismatch.json
      networkpolicy-blocks-redis.json
    architecture/
      checkout-cache-schema.json
```

## Как добавить scenario

1. Создать JSON-файл в подходящей папке `src/scenarios/<level>/`.
2. Заполнить поля сценария: incident metadata, initial state, sections, commands, actions, manager events.
   Для architecture drill можно дополнительно указать `diagram`, `businessContext` и `interviewerQuestions`.
3. Импортировать JSON в `src/routes/+page.svelte` и добавить его в массив `scenarios`.

Минимальная форма:

```json
{
  "id": "k8s-002",
  "name": "New incident",
  "difficulty": "kubernetes",
  "duration": 1200,
  "incidentNumber": "INCIDENT #004",
  "incidentTitle": "Service degraded",
  "incidentText": "Short incident description.",
  "architecture": ["Internet", "Ingress", "Service", "Backend"],
  "rootCause": "Human-readable root cause.",
  "rootCauseKeywords": ["keyword"],
  "initialState": {
    "errorRate": 37,
    "affectedUsers": 12430,
    "serviceStatus": "DEGRADED"
  },
  "sections": [],
  "commands": [],
  "actions": [],
  "managerEvents": []
}
```

## Scoring

Начальный score: `1000`.

Примеры:

- `+100` за восстановление сервиса;
- `+100` за найденный root cause;
- `+50` за проверку последнего изменения;
- `+30` за application logs или состояние БД;
- штрафы за опасные действия: random restarts, pod deletion, full infrastructure restart.

Финальная оценка дополнительно считается по объективной рубрике `0..100`:

- `Recovery` — восстановлен ли сервис и насколько быстро;
- `Diagnostics` — глубина команд, покрытие компонентов и найденные технические сигналы;
- `Root Cause` — совпадает ли итоговая формулировка с причиной сценария;
- `Safety` — были ли опасные действия без подтверждения;
- `Communication` — ответы менеджеру и ручные заметки.

Также считается `Confidence`: насколько хватает evidence для оценки. Если кандидат мало вводил команд и не писал ход мыслей, система показывает низкую уверенность вместо жёсткого вывода.

Score и rubric являются игровыми/интервьюерскими метриками и не являются автоматическим решением по кандидату.

## Business Impact

Во время инцидента симулируется impact:

- estimated loss в RUB;
- peak affected users;
- estimated affected users;
- impacted user-minutes;
- recovery time.

Модель зависит от уровня сценария, текущего error rate, affected users и длительности деградации. Это нужно для сравнения прохождений одного кейса и обсуждения приоритизации, а не для финансового отчёта компании.

## Findings и ход мыслей

`Findings` — это не автоподсказки игры. Кандидат сам пишет туда наблюдения, гипотезы и следующие проверки.

Каждая заметка сохраняется с timestamp и попадает в общий timeline рядом с командами. На финальном экране остаются:

- все команды и действия из timeline;
- ручные заметки кандидата;
- итоговые ответы про root cause, восстановление и prevention.
- полный Markdown interview report со scoring, impact и evidence.

## Команды

Интерфейс не показывает список “правильных” команд сценария. Кандидат работает через терминал.

`help` показывает только базовые категории диагностики: навигация, host checks, logs/configs, Docker-style и Kubernetes-style команды. Конкретные команды с важными выводами остаются частью scenario JSON и вводятся кандидатом вручную.

Поддержаны shell-механики:

- `ls` и `ls -la` с файлами текущего подключения;
- `cd <dir>` и отдельный `cwd` для каждой вкладки;
- `cat <file>` для конфигов, логов, runbook, schema, ArgoCD manifests и metadata;
- `tail <log>` для логов текущего компонента;
- Tab-completion для базовых команд и имён файлов в текущей вкладке.

Tab и `help` не раскрывают “правильный путь” кейса, а только помогают не спотыкаться о синтаксис симуляции.

## Manager Events

`managerEvents` описывают, когда появляется менеджер:

```json
{
  "at": 180,
  "message": "У нас прод лежит. Что сказать бизнесу?"
}
```

Ответы влияют на отдельный `Communication: 0..100`. Обещание "5 минут" создаёт риск штрафа, если сервис не восстановлен вовремя.

## Технологии

- SvelteKit
- TypeScript
- Tailwind CSS
- Docker + docker compose
- SvelteKit static adapter
- Nginx для Docker-раздачи статической сборки на `8080`
