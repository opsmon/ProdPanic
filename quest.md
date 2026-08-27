# Задача для IDE-агента: MVP игры «Прод лёг»

Нужно разработать MVP браузерной интерактивной игры для технических собеседований DevOps-инженеров.

Рабочее название:

# Прод лёг

Подзаголовок:

> У тебя 20 минут.
> Прод не работает.
> Разбирайся.

Идея игры: кандидат во время технического интервью шарит экран и получает симуляцию production-инцидента. Он должен исследовать инфраструктуру, смотреть логи и метрики, выполнять действия и найти root cause.

Важно: на первом этапе **не нужно поднимать настоящие VM, Docker или Kubernetes**. Всё должно быть симуляцией на frontend/backend через заранее подготовленные сценарии.

---

## 1. Основная механика

После запуска игры кандидат выбирает уровень:

1. VM
2. Docker
3. Kubernetes

Для каждого уровня должен быть свой отдельный incident scenario.

После выбора уровня запускается таймер:

**20:00**

На экране отображается:

* описание инцидента;
* схема инфраструктуры;
* состояние сервиса;
* количество затронутых пользователей;
* error rate;
* таймер;
* очки;
* доступные разделы диагностики;
* история действий кандидата.

Пример:

```text
INCIDENT #001

Прод частично недоступен.

Error rate: 37%
Affected users: 12 430

Time: 18:42
Score: 120
```

---

# 2. Уровень 1 — VM

Самый простой уровень.

Схема:

```text
Internet
   |
 Nginx
   |
Backend
   |
PostgreSQL
```

Все компоненты работают непосредственно на VM.

Стартовая ситуация:

> Пользователи жалуются, что сайт отдаёт HTTP 500.
> Проблема появилась после изменения приложения.

Кандидат может проверять:

### VM

* CPU
* RAM
* disk usage
* load average
* running processes
* systemd services
* network connections

Примеры действий:

```text
top
free -m
df -h
systemctl status backend
journalctl -u backend
ss -tulpn
```

Не обязательно делать полноценный shell.

Можно сделать псевдотерминал, распознающий только заранее поддерживаемые команды.

Например:

```text
$ systemctl status backend
```

Ответ:

```text
backend.service
Active: active (running)
```

---

### Nginx

Доступны:

* status;
* access.log;
* error.log;
* upstream;
* latency.

---

### Backend

Доступны:

* logs;
* process;
* application errors;
* config.

---

### PostgreSQL

Доступны:

* CPU;
* connections;
* active queries;
* logs;
* состояние таблиц.

---

## Root cause уровня VM

Сделать понятную проблему.

Например:

**после релиза приложение ожидает новую таблицу PostgreSQL, но миграция БД не была выполнена.**

Лог приложения:

```text
ERROR: relation "user_settings" does not exist
```

Кандидат должен:

1. понять, что проблема появилась после изменения;
2. посмотреть backend logs;
3. определить проблему с БД;
4. восстановить сервис.

Правильное оперативное действие:

```text
Rollback
```

После rollback:

```text
Error rate:
37% → 4% → 0.5%

Service recovered.
```

Но игра не заканчивается.

Появляется сообщение:

> Сервис восстановлен. Теперь найди root cause.

---

# 3. Уровень 2 — Docker

Уровень немного сложнее.

Схема:

```text
Internet
   |
 Nginx container
   |
 Backend containers
   |
+---------+---------+
|                   |
Redis            PostgreSQL
```

Можно проверять:

```text
docker ps
docker stats
docker logs
docker inspect
docker network
docker compose ps
```

Через UI также должны быть доступны соответствующие разделы.

---

## Incident

Например:

> Сайт резко стал очень медленным.
> Иногда появляются 502/504.

Root cause:

**один backend container постоянно перезапускается из-за неправильного environment variable или проблем подключения к Redis.**

Например:

```text
backend-1    Up
backend-2    Restarting
backend-3    Up
```

Лог:

```text
REDIS_HOST=redis-prod
connection refused
```

Но текущий Redis service называется:

```text
redis
```

После исправления или rollback сервис восстанавливается.

---

# 4. Уровень 3 — Kubernetes

Самый интересный уровень MVP.

Схема:

```text
Internet
   |
Ingress Nginx
   |
Service
   |
Backend Deployment
   |
+-------------+-------------+
|                           |
Redis                   PostgreSQL
|
ArgoCD
```

Доступные разделы:

### Kubernetes

* Nodes
* Pods
* Deployments
* ReplicaSets
* Services
* Endpoints
* Events
* ConfigMaps
* Secrets — только metadata, не показывать реальные secret values
* resource usage

Псевдокоманды:

```text
kubectl get pods
kubectl get nodes
kubectl describe pod
kubectl get events
kubectl get deploy
kubectl rollout history
kubectl logs
kubectl get svc
kubectl get endpoints
```

---

### ArgoCD

Раздел:

```text
ArgoCD
```

Показывать:

* application status;
* sync status;
* health;
* revision;
* sync history;
* diff;
* last sync;
* auto-sync status.

Например:

```text
Application: backend-prod
Status: Synced
Health: Degraded
Revision: 8f34a1c
Auto Sync: Enabled
```

---

## Incident Kubernetes

Старт:

> В 15:00 был deploy backend.
> В 15:05 поддержка сообщает о HTTP 500.

Kubernetes при этом выглядит нормально:

```text
Nodes: Ready
Pods: Running
Restart count: 0
```

Backend logs:

```text
ERROR relation "user_settings" does not exist
```

Pipeline:

```text
Build ........ SUCCESS
Tests ........ SUCCESS
DB migration . FAILED
Deploy ....... SUCCESS
```

Root cause:

**пайплайн позволил выполнить deployment после failed migration job.**

---

# 5. Rollback

Во всех трёх сценариях должна быть большая кнопка:

```text
ROLLBACK
```

Но она не должна автоматически означать победу.

Например кандидат нажал rollback.

Получает:

```text
Rollback initiated...

Error rate:
37% → 12% → 0.5%

Service recovered.
```

Очки:

```text
+100 Service restored
```

После этого игра сообщает:

> Прод восстановлен.
> Но причина инцидента пока неизвестна.

Кандидат продолжает расследование.

---

# 6. Особенность Kubernetes + ArgoCD

Добавить небольшой дополнительный прикол.

Если кандидат делает ручной rollback Kubernetes deployment:

```text
kubectl rollout undo deployment/backend
```

Сервис сначала восстанавливается.

Но через некоторое время:

```text
ArgoCD Self-Heal triggered
```

И ArgoCD снова возвращает версию из Git.

На экране:

```text
WARNING

ArgoCD detected drift.

Desired:
backend:v2.18.0

Live:
backend:v2.17.4

Self-heal started.
```

Через несколько секунд:

```text
backend:v2.18.0 deployed again

Error rate:
0.5% → 34%
```

Это должно быть отдельным неожиданным моментом.

Кандидат должен понять:

> Git является source of truth.

Правильные варианты:

* rollback commit/revision в Git;
* изменить target revision;
* контролируемо остановить auto-sync;
* после этого выполнить rollback.

---

# 7. Очки

Очки нужны больше как игровой элемент.

Не делать их главным критерием оценки кандидата.

Начальное значение:

```text
Score: 1000
```

Примеры начисления:

```text
+100 восстановил сервис
+100 нашёл root cause
+50 проверил последнее изменение
+30 посмотрел application logs
+30 посмотрел состояние БД
+20 проверил events
```

Штрафы:

```text
-10 бессмысленный restart
-20 restart PostgreSQL без подтверждения проблемы
-15 scale без причины
-30 удаление pod'ов наугад
-50 restart всей инфраструктуры
```

Можно также постепенно вычитать очки за время:

```text
-1 point / 10 seconds
```

Но сделать это опционально в конфигурации.

---

# 8. Менеджер

Добавить игровой элемент:

периодически во время расследования справа/снизу появляется менеджер.

Например через 3 минуты:

```text
┌────────────────────────────────────┐
│ 👨‍💼 Менеджер                       │
│                                    │
│ ЧЕ ТАМ?                            │
│ КОГДА ПОЧИНИТЕ?                    │
└────────────────────────────────────┘
```

Через некоторое время:

```text
👨‍💼 Менеджер

У НАС ПРОД ЛЕЖИТ.
ЧТО СКАЗАТЬ БИЗНЕСУ?
```

Ещё варианты:

```text
А МОЖЕТ СЕРВЕР ПЕРЕЗАГРУЗИТЬ?
```

```text
Я НЕ ТЕХНАРЬ.
МНЕ НУЖНО ВРЕМЯ.
```

```text
15 МИНУТ УЖЕ ПРОШЛО.
ЕСТЬ ETA?
```

```text
ПОЛЬЗОВАТЕЛИ ПИШУТ В ПОДДЕРЖКУ.
ЧЕ ДЕЛАЕМ?
```

---

## Ответ менеджеру

Сделать 3 кнопки ответа:

```text
[ 5 минут ]
[ Разбираемся ]
[ ETA пока нет ]
```

Можно добавить шуточные штрафы/бонусы.

Например:

### Ответ

```text
5 минут
```

Если через 5 минут сервис всё ещё лежит:

```text
-30 Manager trust
```

Если выбрал:

```text
ETA пока нет, определяем причину
```

```text
+10 Communication
```

Это не должно серьёзно влиять на технический score.

Это отдельная характеристика:

```text
Communication: 70/100
```

---

# 9. Показатели инцидента

В верхней части экрана постоянно показывать:

```text
ERROR RATE
37%

AFFECTED USERS
12 430

SERVICE STATUS
DEGRADED

TIME
14:32

SCORE
830
```

После правильных действий значения должны динамически меняться.

---

# 10. История действий

Обязательно сделать timeline.

Пример:

```text
00:32 Opened Kubernetes
00:48 kubectl get pods
01:20 Checked CPU
02:05 Opened Backend Logs
02:35 Found DB errors
03:10 Manager requested ETA
03:45 Checked PostgreSQL
05:02 Rollback initiated
05:50 Service recovered
07:32 Checked CI pipeline
08:20 Root cause identified
```

Это одна из самых важных функций.

---

# 11. Экран результата

После того как кандидат нажимает:

```text
Завершить расследование
```

показать результат:

```text
INCIDENT RESOLVED

Time:
11:42

Score:
810

Service restored:
YES

Root cause found:
YES
```

И категории:

```text
Recovery          95/100
Diagnostics       80/100
Root Cause        100/100
Safety            75/100
Communication     85/100
```

Но обязательно добавить:

> Score является игровой метрикой и не является автоматической оценкой уровня инженера.

---

# 12. Root cause

Перед завершением кандидат должен написать:

```text
В чём была причина инцидента?
```

Textarea.

Также:

```text
Что вы сделали для восстановления?
```

И:

```text
Что бы вы сделали, чтобы проблема не повторилась?
```

Ответы сохранить в session state.

---

# 13. Интерфейс

Стиль:

* dark DevOps/SRE dashboard;
* минималистично;
* немного юмора;
* похоже на monitoring/incident management tool;
* не превращать в детскую игру.

Пример layout:

```text
┌──────────────────────────────────────────────────────┐
│ PROD ЛЁГ                14:38              SCORE 810 │
├──────────────────────────────────────────────────────┤
│ Error rate 37% │ Users 12430 │ Status DEGRADED      │
├──────────────────────────────────────────────────────┤
│                                                      │
│               Infrastructure                         │
│                                                      │
│ Internet → Nginx → Kubernetes → Backend             │
│                                  ↓       ↓           │
│                                Redis   PostgreSQL     │
│                                                      │
├─────────────────────────┬────────────────────────────┤
│ Infrastructure          │ Output                     │
│                         │                            │
│ Kubernetes              │ $ kubectl get pods        │
│ ArgoCD                  │ backend... Running         │
│ Backend                 │                            │
│ PostgreSQL              │                            │
│ Redis                   │                            │
│ Nginx                   │                            │
├─────────────────────────┴────────────────────────────┤
│ Timeline                                             │
└──────────────────────────────────────────────────────┘
```

---

# 14. Сценарии хранить отдельно

Не хардкодить incident logic прямо в UI.

Сделать структуру:

```text
src/
  scenarios/
    vm/
      failed-db-migration.json

    docker/
      wrong-redis-host.json

    kubernetes/
      argocd-failed-migration.json
```

Пример структуры сценария:

```json
{
  "id": "k8s-001",
  "name": "Failed database migration",
  "difficulty": "kubernetes",
  "duration": 1200,
  "initialState": {
    "errorRate": 37,
    "affectedUsers": 12430
  },
  "rootCause": "database migration failed",
  "components": {},
  "actions": {},
  "managerEvents": []
}
```

Архитектуру scenario engine сделать расширяемой.

В будущем должны легко добавляться новые кейсы без переписывания frontend.

---

# 15. Технологии

Для MVP предлагаю:

```text
Frontend:
SvelteKit + TypeScript

Styles:
Tailwind CSS

Storage:
JSON / local state

Backend:
на первом этапе не нужен

Deploy:
Docker

Reverse proxy:
Nginx
```

Если проект уже использует React/Vue — можно использовать существующий стек.

Главное — не усложнять.

---

# 16. Docker

Обязательно добавить:

```text
Dockerfile
docker-compose.yml
```

Запуск должен быть:

```bash
docker compose up -d
```

После этого приложение доступно на:

```text
http://localhost:8080
```

---

# 17. README

Создать нормальный README:

* описание проекта;
* цель;
* скриншоты/структура интерфейса;
* как запустить;
* как добавить новый scenario;
* структура scenario JSON;
* описание scoring;
* описание manager events.

---

# 18. Что пока НЕ делать

Не нужно:

* настоящего Kubernetes;
* настоящего Docker runtime для симуляции;
* SSH к реальным VM;
* настоящего PostgreSQL;
* настоящего Redis;
* LLM;
* авторизации;
* нескольких пользователей;
* базы результатов;
* админки;
* Kubernetes deployment самого проекта.

Сначала нужен качественный standalone MVP.

---

# 19. Критерии готовности

MVP считается готовым, если:

### Главная

Можно выбрать:

```text
VM
Docker
Kubernetes
```

### Каждый уровень

Имеет:

* отдельную схему;
* отдельный scenario;
* симптомы;
* диагностику;
* действия;
* root cause.

### Работают:

* timer;
* score;
* rollback;
* infrastructure navigation;
* pseudo terminal;
* incident metrics;
* manager popups;
* timeline;
* root cause form;
* result screen;
* restart scenario.

### Kubernetes scenario

Обязательно содержит механику:

```text
manual rollback
        ↓
service recovered
        ↓
ArgoCD self-heal
        ↓
bad version returned
        ↓
incident returns
```

---

## Общая идея продукта

Это не экзамен на знание команд.

Игра должна проверять ход мыслей инженера:

```text
Что изменилось?
      ↓
Какой слой сломан?
      ↓
Какие данные нужны?
      ↓
Какая гипотеза?
      ↓
Как безопасно восстановить сервис?
      ↓
Что является root cause?
      ↓
Как предотвратить повторение?
```

Основная философия:

> PROD ЛЁГ
> У тебя 20 минут.
> Менеджер уже спрашивает, когда почините.
