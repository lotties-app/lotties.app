# ml-service: architecture (design, not implemented)

Status: proposal, October 2026. Nothing here is built yet. It follows the benchmark in
[`BENCHMARK.md`](BENCHMARK.md), whose recommendation decides the rollout order below: fix the heuristic first, then
run the service in shadow mode, and only then let it serve targets where it wins for that baby.

## 1. Goals and non-goals

Goals
- Serve per-baby predictions from small CPU models when, and only when, they beat the heuristic in that baby's own
  rolling backtest.
- Keep training in the background, bounded in CPU, memory and time, with every candidate model evaluated before it is
  promoted.
- Never make the app depend on it: the API always has the C# heuristic as a fallback.
- Hold as little child data as possible, delete it when the baby is deleted or opts out.

Non-goals
- No LLM, no GPU, no cross-family model (one baby's data never trains another baby's model in this design; a pooled
  prior across babies is a later, opt-in question, see section 14).
- No public endpoint and no direct browser access.
- Not a replacement for the Domain engine: "Predictions are pure Domain functions, no I/O" stays true; the service is
  reached through an Infrastructure adapter.

## 2. Context

```
browser ──> web (nginx) ──/api/──> api (.NET 10) ──> PostgreSQL
                                     │   ▲
                       outbox push   │   │  GET predictions (300 ms budget)
                                     ▼   │
                                 ml-service (FastAPI, CPU)  ── named volume ml-data
                                 network: ml-internal (internal: true)
```

- `ml-service` sits on its own compose network `ml-internal` declared `internal: true`; only `api` joins it. It has
  `expose: ["8000"]` and no `ports:`, so it is never published, not even on loopback.
- The API pushes event changes; the service never reads PostgreSQL and holds no database credentials.

Compose sketch (reviewed by eye only; there is no Docker on the dev machine, and Podman inside WSL needs
`--network host` for ad-hoc runs, see CLAUDE.md):

```yaml
services:
  ml-service:
    build: ./ml            # Dockerfile added when the service is implemented
    profiles: ["ml"]       # opt-in like `localdb`, so `docker compose up` without it needs no token
    environment:
      ML_SERVICE_TOKEN: ${ML_SERVICE_TOKEN:?set ML_SERVICE_TOKEN in .env}
      ML_SERVICE_TOKEN_PREVIOUS: ${ML_SERVICE_TOKEN_PREVIOUS:-}
      ML_DATA_DIR: /var/lib/ml-service
      OMP_NUM_THREADS: "1"
    expose: ["8000"]
    networks: [ml-internal]
    volumes: ["ml-data:/var/lib/ml-service"]
    read_only: true
    tmpfs: ["/tmp"]
    user: "10001:10001"
    cpus: 1.0
    mem_limit: 768m
    pids_limit: 128
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=2).status == 200 else 1)"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
  api:
    networks: [default, ml-internal]
    environment:
      MlService__Mode: ${ML_SERVICE_MODE:-Off}
      MlService__BaseUrl: http://ml-service:8000
      MlService__Token: ${ML_SERVICE_TOKEN:-}
networks:
  ml-internal:
    internal: true
volumes:
  ml-data:
```

## 3. Container

- Base `python:3.12-slim`, multi-stage build: wheels built in a builder stage, runtime stage with only the venv.
  Dependencies pinned with hashes (`numpy`, `pandas`, `scikit-learn`, `scipy`, `lightgbm`, `fastapi`, `uvicorn`,
  `pydantic`). No GPU wheels, no torch. Expected image size about 350-450 MB, dominated by scipy and pandas; a later
  pass can drop pandas from the serving path.
- `uvicorn --workers 1` (state lives in one process; training runs in a child process, section 6). Non-root user,
  read-only root filesystem, `/tmp` on tmpfs, all writes under `ML_DATA_DIR`.
- `OMP_NUM_THREADS=1` and LightGBM `n_jobs=1`, so training never takes more than the one CPU the container is given.

## 4. HTTP API (all JSON, camelCase, times ISO-8601 UTC)

Every route except `GET /health/live` requires `Authorization: Bearer <ML_SERVICE_TOKEN>`.

| Method and path | Purpose |
|---|---|
| `PUT /v1/babies/{babyId}` | Upsert the baby profile: `{birthDate, timeZone, optOut}`. `optOut: true` purges and refuses later ingest (409 `baby_opted_out`). |
| `POST /v1/babies/{babyId}/events:batch` | Idempotent upsert/delete of up to 500 changes: `[{eventId, op: "upsert"\|"delete", typeKey, startedAt, endedAt, kind, method, content, updatedAt}]`. A change older than the stored `updatedAt` (server receive time of the API, never a client clock) is ignored, like the API's own conflict rule. Returns `{applied, ignored}`. |
| `DELETE /v1/babies/{babyId}` | Purge everything of the baby (events, models, registry rows, cached features). 204, idempotent. |
| (no resync route) | When the service does not know a baby (new volume, purge after opt-out was undone) a batch gets 409 `resync_required`; the API's forwarder then replays all the baby's non-deleted events in pages of 500 before sending further changes. |
| `GET /v1/babies/{babyId}/predictions?now=...&utcOffsetMinutes=...` | Predictions, same shape as the API's `PredictionsResponse` plus provenance (below). 404 when the baby is unknown, 200 with `predictions: []` when nothing is promoted. |
| `GET /v1/babies/{babyId}/models` | Registry view for operators: per target the champion, its backtest summary and the last candidates (aggregate numbers only). |
| `GET /health/live`, `GET /health/ready` | Liveness (process up) and readiness (volume writable, registry loaded, migrations done). |
| `GET /metrics` | Prometheus text format, no baby ids or timestamps in labels. |

Prediction response (`source`, `modelVersion` and `backtest` are the additions to the API's shape):

```json
{
  "babyId": "…", "generatedAt": "2026-10-21T15:04:00Z",
  "predictions": [{
    "typeKey": "feeding",
    "nextStart": {"earliest": "…", "expected": "…", "latest": "…"},
    "expectedDuration": null, "confidence": "Medium", "sampleCount": 212,
    "reason": "…", "basis": {"kind": "StartInterval", "medianGapMinutes": 118, "lookBackDays": 14, "ageBand": "0-3m", "dayPhase": "day", "assumesEventInProgressEnds": false},
    "source": "model",
    "modelVersion": "feed/ensemble/2026-10-21T03:00Z/3f9c",
    "backtest": {"windowDays": 21, "n": 203, "maeMinutes": 69, "heuristicMaeMinutes": 73, "relImprovement": 0.055, "ciLow": 0.005, "ciHigh": 0.10, "previousWindowRelImprovement": 0.001, "coverage80": 0.78}
  }],
  "insufficientData": []
}
```

- `nextStart.earliest/latest` are q25/q75, the same 50 % window the heuristic shows, so the UI does not change.
- `source` is `model` or `heuristic`. The service may return a heuristic-sourced entry (it embeds the same port the
  benchmark uses) but the API ignores those and uses its own C# result, so only one heuristic implementation is ever
  shown to users.
- New targets that the C# engine does not have (wake-up while asleep, tonight's bed time) are returned only in an
  `extensions` object that old clients ignore: `{"wakeUp": {window}, "bedtime": {window}}`.

## 5. Storage and registry

One SQLite database (`ml.sqlite`, WAL mode) on the named volume, plus model files:

```
/var/lib/ml-service/
  ml.sqlite                     babies, events, registry, ingest_log (counts only)
  models/{babyId}/{target}/{version}/model.txt    LightGBM text models (one per quantile)
  models/{babyId}/{target}/{version}/meta.json     features hash, code version, data window, params, backtest
```

- `events(baby_id, event_id, type_key, started_at, ended_at, kind, method, content, updated_at, deleted)`: only the
  fields the features use. No notes, no medication names, no user ids, no free text.
- `registry(baby_id, target, version, status: candidate|champion|retired, created_at, train_rows, backtest_json)`.
- Model files are small: in the benchmark a five-quantile LightGBM set is 100-520 KB per target in text format (about
  2.5 MB per baby for six targets), the hazard model about 170 KB, a linear quantile set 12 KB, and the shrinkage model
  has no file at all (it is a few sufficient statistics recomputed at request time). Writes go to a temporary
  directory and are renamed into place, so a crash never leaves half a model; the champion pointer changes in one
  SQLite transaction.

## 6. Training and promotion

- Triggers: nightly at 03:00 in the baby's time zone, and after 30 new events for that baby (debounced 10 minutes).
  A baby is trained at most once per 6 hours.
- Execution: one `ProcessPoolExecutor(max_workers=1)` child; a job trains every target of one baby. Hard limits per
  job: 60 s wall time (killed after), `RLIMIT_AS` 512 MB in the child, `os.nice(10)`. Measured on the benchmark data
  (7 weeks, one baby, one CPU thread): fitting all six targets takes about 1 s with LightGBM quantile sets or the hazard
  model; the rolling backtest that gates promotion (21 daily refits) takes 20-40 s per model family, which is what the
  60 s budget is sized for. Feature building costs about 3 ms per decision point.
- Candidate evaluation is the benchmark code itself (`ml/benchmark/backtest.py`), on the baby's last 21 days with
  daily refits, against the C# heuristic port (and the kind-aware v1.1 port once the API ships it).
- Promotion gate, per baby and per target. A candidate becomes champion only if all of these hold:
  1. Enough data: at least 80 scored decision points in the window (15 for night duration), over at least 14
     distinct days. Three weeks of diapers is about 100 points, of feeds about 200, of nights about 20.
  2. It beats the reference (the kind-aware heuristic v1.1 once shipped) by at least 5 % in MAE and the lower bound of
     the 95 % day-block bootstrap interval of the improvement is above 0.
  3. The improvement is also positive on the 21 days before (two consecutive windows): in the benchmark,
     single-window gains of 5-11 % disappeared in the window before. Applied to the benchmark baby, this gate promotes
     the ensemble for diapers and, only just, for feeds; nothing else.
  4. Its mean pinball loss (q10/q50/q90) is not worse than the reference's.
  5. Its empirical 80 % coverage is between 65 % and 92 % (the benchmark's LightGBM sets were too narrow, 62-77 %).
  6. It is not worse than the current champion on the same window (otherwise the champion stays).
  Otherwise the target is served by the heuristic. Each decision is stored with its numbers, so the operator view
  explains why a target is or is not on the model.
- Staleness: a champion trained more than 72 h ago, or a baby without events for 12 h, falls back to the heuristic
  until the next successful training.

## 7. Authentication between API and service

- Shared bearer secret `ML_SERVICE_TOKEN` (at least 32 random bytes, base64), injected from the root `.env` into both
  containers. Compared with `hmac.compare_digest`; missing or wrong token is 401 with no body detail and is counted in
  `/metrics`.
- Rotation: the service also accepts `ML_SERVICE_TOKEN_PREVIOUS` while both are set; the API sends the current one.
- The service refuses to start without a token (no default), and logs neither the token nor request bodies.
- Network isolation (internal network, no published port) is the first line; the token is the second.

## 8. Data handling

- Minimisation: section 5. Diaper `content` and feeding `method` are kept because they are features; nothing else.
- Retention: events older than 120 days are deleted nightly (models use the last 60 days); retired model versions are
  deleted after 7 days; logs keep no event data.
- Deletion: when a baby is deleted in the API (or its last member leaves and the baby is removed), the API enqueues
  `DELETE /v1/babies/{id}` in the same transaction; the service purges rows and model directories and `VACUUM`s
  weekly. A member leaving a baby that still has other members changes nothing, because data belongs to the baby, not
  to a member.
- Opt-out: a per-baby flag (`predictionModelOptOut`) in the baby settings. In phase 2 the model is opt-in per family;
  from phase 3 it is on by default with this opt-out (section 13). Opting out stops forwarding and purges the service's
  copy; opting back in triggers a resync.
- Encryption at rest, options in order of preference: (1) put the volume on an encrypted filesystem (LUKS, cloud disk
  encryption), no code needed; (2) SQLCipher for `ml.sqlite` with the key from `ML_DB_KEY`; (3) application-level
  encryption of the events table with a key from env. Model files hold no event rows but do encode the baby's
  rhythm, so (1) is the baseline recommendation for any deployment holding real families' data.
- Backups: not required. The service can be rebuilt from the API with a resync; models retrain overnight.

## 9. Failure behaviour

API side, per request:
- Timeout budget 300 ms for the whole call (connect included); no retry on the request path.
- Circuit breaker: after 5 consecutive failures (timeout, connection error, 5xx, 401) the breaker opens for 30 s and the
  API does not call the service at all.
- Merge per type key: a type uses the service only when its entry has `source: "model"`, a `modelVersion`, a
  `backtest.relImprovement` above the configured floor and a confidence other than `Low`; every other type comes from
  the C# engine. A malformed response is a failure.
- The user never sees an error caused by the service; failures are logged at Warning without baby data and counted.

Service side:
- No champion, stale champion, or a baby inside a logging gap: return no model entry for that type (the API uses the
  heuristic).
- Training failure or timeout: keep the previous champion, record the failure, retry at the next trigger.
- Volume full or corrupt database: readiness fails, the API's breaker opens, everything falls back to the heuristic.

## 10. API-side integration

- `Application/Predictions/IPredictionProvider`: `Task<PredictionsResponse?> GetAsync(Guid babyId, DateTimeOffset now, CancellationToken ct)`.
  - `HeuristicPredictionProvider`: today's `PredictionService` (Domain engine, unchanged).
  - `MlPredictionProvider` (Infrastructure, typed `HttpClient` with the timeout and breaker above).
  - `CompositePredictionProvider`: calls the heuristic and, in `Serve` mode, the ML provider in parallel; merges per
    type (section 9). The endpoint keeps its contract; the added `source`/`modelVersion`/`backtest` fields are
    optional for the web client.
- Event forwarding with a transactional outbox:
  - Table `ml_outbox(id, baby_id, event_id, operation, enqueued_at, attempts, next_attempt_at, dead)` written in the
    same `SaveChanges` as event upserts, soft deletes, imports and baby deletion (EF Core migration, code-first).
  - Hosted `MlOutboxForwarder : BackgroundService` (one instance per API process; with several API replicas only one
    is elected through a lease row, so no Postgres-specific locking is needed) polls every 5 s, takes up to 500 rows per
    baby through EF Core, reads the current event state (so a later change supersedes an earlier row), posts one batch,
    deletes the rows on 2xx, and backs off exponentially with jitter (1 s to 15 min) otherwise. After 20 attempts a row
    is marked dead and counted; a resync repairs it.
  - Imports enqueue one `resync` row per baby instead of thousands of event rows.
- Configuration (section `MlService`, env `MlService__*`):

| Key | Default | Meaning |
|---|---|---|
| `Mode` | `Off` | `Off` (no calls, no outbox rows), `Shadow` (outbox and training, predictions not used), `Serve` |
| `BaseUrl` | `http://ml-service:8000` | Internal URL |
| `Token` | none | From `ML_SERVICE_TOKEN`; startup fails in `Shadow`/`Serve` without it |
| `TimeoutMilliseconds` | `300` | Whole-call budget |
| `BreakerFailures` / `BreakerSeconds` | `5` / `30` | Circuit breaker |
| `MinRelImprovement` | `0.05` | Floor applied to `backtest.relImprovement` when merging |
| `Outbox:BatchSize` / `Outbox:PollSeconds` / `Outbox:MaxAttempts` | `500` / `5` / `20` | Forwarder |

## 11. Testing strategy

- Unit (Python): feature building (including the leakage test that recomputes features on history truncated at the
  decision instant), heuristic port parity with the C# unit tests, target construction, promotion gate decisions on
  hand-made backtest summaries. Already in `ml/tests/` for the benchmark parts.
- HTTP contract: an OpenAPI document generated by FastAPI is committed; a test fails when it changes without a version
  bump. On the API side, contract tests against a stub server (WireMock.Net or a minimal Kestrel stub) cover: model and
  heuristic merge per type, timeout at 300 ms, 401, 500, malformed JSON, breaker open/close, `Mode=Off` making no calls.
- Service tests (FastAPI `TestClient`): auth required on every route, idempotent batch upsert and stale-change ignore,
  delete purges files and rows, opt-out refuses ingest, predictions shape and provenance fields.
- Outbox tests (API, SQLite like the other API tests): rows written in the same transaction as event changes, superseded
  rows collapse, backoff schedule, dead-lettering.
- Backtest regression with synthetic data (`benchmark/synthetic.py`): a regular synthetic baby must keep MAE under fixed
  thresholds for every target, and no training row may have an outcome after its refit instant. Runs in CI in seconds.
- No real data in any test or fixture.

## 12. Observability and resource limits

- Metrics: request latency histogram per route; predictions by `source` and target; promotion decisions by outcome and
  target; training job duration, failures and timeouts; outbox lag (oldest pending row age) and dead rows on the API
  side; process RSS. No baby ids, timestamps or values in labels or logs.
- Logs: structured JSON, event counts only; Warning on training failure, Error on storage failure.
- Limits: 1 CPU, 768 MB memory for the container (the whole benchmark, every model and both windows in one process,
  peaked at about 0.2 GB), one training job at a time, 60 s per job, 500 changes per ingest batch, 1 MiB request body.
  Serving one prediction set is a feature build (about 3 ms) plus 5 ms per LightGBM target, well inside the API's
  300 ms budget.

## 13. Phased rollout

| Phase | What ships | Exit criterion |
|---|---|---|
| 0 | Heuristic v1.1 in C#: durations from sessions of the same kind (nap vs night) and a bed-time window from recent bed-time clocks. No service. | Parity tests updated; the benchmark shows the v1.1 port at least matching ML on durations. |
| 1 | ml-service in `Shadow`: outbox, ingest, nightly training, rolling backtest, operator view. API never reads its predictions. | Four weeks of shadow backtests on consenting families' babies; promotion decisions stable from week to week. |
| 2 | `Serve` behind a per-family opt-in, only for targets that pass the gate for that baby. | No regression in the app's prediction quality metrics; breaker rarely opens; p95 latency under 100 ms. |
| 3 | Default on with a per-baby opt-out, if the aggregate across babies holds. | Documented in SPEC and DEPLOY. |

Kill switch at every phase: `MlService__Mode=Off` (an environment change and an API restart, no code change) restores
the current behaviour.

## 14. Open questions

- Should a pooled prior across consenting babies (same age band) replace the hand-written priors? It would help cold
  start, but it is a privacy decision for the project, not a technical one.
- Time zone per baby: the API passes only `utcOffsetMinutes`; the service needs the zone (DST) for nightly scheduling
  and clock features. Add `timeZone` to the baby profile?
- Whether to show `source`/`backtest` in the Why sheet ("Learned from your last 3 weeks") is a product and UX decision.
