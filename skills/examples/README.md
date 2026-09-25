# Worked examples

These fixtures are small, reviewable source samples, not applications to deploy.
The Rails sample pins Rails 8.0.0 to identify the conventions under inspection;
Rails and its tests are not booted by this validation. Its source slices deliberately
omit framework boot/test scaffolding, production configuration and authentication.
The no-database example is a complete three-module pure-function sample with a
runnable Node test. Neither contains customer data or requires dependency installs.

Each `map-plan.json` is a **worked audit output**, manually reviewed against the
adjacent source. It is not an automatic source parser and is not a format an agent
must adopt. The native exercise renders these plans through the real MCP adapter.
Source refs are relative to the fixture root; provenance uses `fixture:*`, a null
Git revision and file hashes, not fabricated commit links.

## Audit and map: Rails

Read [the plan](rails/map-plan.json) alongside [routes](rails/config/routes.rb),
[Person](rails/app/models/person.rb), [schema](rails/db/schema.rb) and
[migration](rails/db/migrate/20260101000000_create_crm.rb).

| Area                             | Finding and coverage                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                        | `Gemfile` pins 8.0.0; application defaults are 8.0; static inspection only.                                                                                                            |
| Request/UI                       | Resource routes resolve to controllers and implicit views; files establish the People flow without explicit requires.                                                                  |
| Names                            | Person/people is Rails' irregular convention; Person explicitly stores in `crm_members`. `cactus/cacti` and the API acronym are configured.                                            |
| Namespaces                       | `Admin::Person` uses `admin_people`; it is distinct from CRM Person. This fixture has a namespace, not an engine.                                                                      |
| Associations                     | Explicit member class/foreign-key override; Person/Team through Membership; Note polymorphism; VipPerson STI.                                                                          |
| Database                         | Six tables, implicit Rails primary keys, column types/nullability, timestamps, unique/composite indexes and two explicit foreign keys. Schema and migration agree.                     |
| Background work                  | `Notifies` enqueues after email changes; `PersonDigestJob` loads Person and logs. It does not send mail.                                                                               |
| Tests                            | Controller, model and job test source shows Minitest placement; execution needs the omitted Rails test harness.                                                                        |
| Partial/unknown                  | Dynamic `constantize` target, authentication, production deployment/CI, live schema state and metrics are unknown. No external API call is established merely by `APIClient` existing. |
| Not applicable to supplied slice | Mailers, channels and an isolated engine are absent. This is not a claim about an unseen full application.                                                                             |

The map groups overview → request/domain/operations → concrete implementation,
with separate Admin and Database roots. It keeps dependency edges distinct from
containment. Bookmarks cover overview, People flow, Admin, database, member columns
and jobs/tests. The unresolved dynamic target has no invented concrete dependency.

## Placement recommendations from this map

These are worked answers to realistic requests, grounded in fixture source. Each
diagram ID below is created by the native exercise. Existing files are distinguished
from proposed additions; advice does not write source or move the canvas.

| Request                                         | Existing implementation and diagram evidence                                                                                                                                                                                                       | Tests / proposed additions and rationale                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a CRM People JSON endpoint                  | `config/routes.rb` (`routes`), `PeopleController` in `app/controllers/people_controller.rb` (`controller`), `Person` in `app/models/person.rb` (`person`, ancestor `domain`, root `crm`). Add the resource action/format in this established flow. | Extend existing `test/controllers/people_controller_test.rb`; check serialization/auth requirements before adding a serializer or policy. No such layer is evidenced. `people-flow` shows this scope; `admin-person` is not its model.                                                                                                         |
| Add an email-preferences UI                     | Existing `app/views/people/_person.html.erb` and `index.html.erb` (`view`) plus `PeopleController#update` (`controller`) establish form rendering and allowed fields.                                                                              | Existing controller tests can cover parameter handling; **proposed** `test/system/people_preferences_test.rb` needs confirmation of the omitted system-test setup. Do not claim that file exists. Follow the database request below if persistence is required.                                                                                |
| Add a persisted notification flag to CRM people | Existing Person (`person`), permitted parameters (`controller`), form (`view`) and storage `crm_members` (`table-crm_members`, `member-columns`).                                                                                                  | **Proposed** `db/migrate/<timestamp>_add_notifications_enabled_to_crm_members.rb`; choose nullability/default/backfill from product requirements. Extend existing `test/models/person_test.rb` and controller tests. Schema evidence points to `crm_members`, not a guessed `people` table; do not hand-edit the old migration or schema dump. |
| Add a membership role / team-related rule       | `Membership` in `app/models/membership.rb` (`membership`) has `member_id` mapped to Person; Person/Team declarations establish the through relation. `table-memberships`, `member-fk` and `team-fk` distinguish actual foreign keys.               | **Proposed** additive migration and `test/models/membership_test.rb`, near the existing Minitest model pattern. Confirm whether the role belongs to a membership or person; do not store it on `admin_people` or invent a direct Person→Team foreign key.                                                                                      |
| Change digest background behavior               | Existing `Notifies#schedule_digest` (`notifies`) and `PersonDigestJob#perform` (`job`) with `concern-job` show the trigger and queue boundary.                                                                                                     | Extend existing job/model tests; **proposed** callback coverage in `test/models/person_test.rb`. Clarify whether the trigger changes: the current callback only runs after an email change. Adding actual delivery needs new evidenced requirements, not an assumed mailer.                                                                    |
| Add a Cactus field                              | Actual `Cactus`, `CactiController`, custom inflection initializer and table `cacti` (`cactus`, `table-cacti`).                                                                                                                                     | **Proposed** additive migration targeting `cacti` and model/controller tests following existing Minitest patterns. Do not guess `cactuses`.                                                                                                                                                                                                    |
| Add an Admin Person display attribute           | `Admin::Person` in `app/models/admin/person.rb` (`admin-person`, root `admin`), Admin controller/view (`admin-controller`) and `admin_people` (`table-admin_people`).                                                                              | **Proposed** migration targeting `admin_people` and `test/controllers/admin/people_controller_test.rb`. Keep top-level Person/`crm_members` unchanged unless the request crosses both domains.                                                                                                                                                 |

## No database

[The small plan](no-db/map-plan.json) maps `responseFor` and `statusLabel` under one
root, using duplicate “Health” display names with distinct IDs (`status-api`,
`status-ui`). All three source modules are examined; none imports persistence or
defines a schema, so database is not applicable. Hosting/deployment are unknown.
No connection is invented between the two pure functions: their only supplied
consumer is the test.

Adding `/version` belongs in existing `server.mjs:responseFor` and
`server.test.mjs` (`status-api`), while changing status wording belongs in existing
`view.mjs:statusLabel` and its test (`status-ui`). The identical display labels are
not sufficient to choose between them.

## Adverse cases and repeat runs

Use these requests when evaluating the skills. Source copies for destructive
experiments belong in a temporary directory, never in the user's checkout.

| Scenario                                              | Expected observable behavior                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Map cites Person but current source moved it          | Verify the actual renamed symbol via source/diff; mark the map stale. Do not propose editing a missing file. Recommend a bounded audit/refresh. |
| File was deleted and no replacement is found          | Mark the location missing; give source-only alternatives only with evidence.                                                                    |
| Provenance absent or points to another repository     | Ask for identity/correct map; diagram-path proximity is not proof.                                                                              |
| “Change Person” with CRM and Admin matches            | Preserve both scopes and ask which behavior/namespace; do not choose the first sorted result.                                                   |
| Search for an unknown feature                         | Report no matches in the examined scope and distinguish source-only findings from diagram evidence.                                             |
| Search unavailable; ten fallback pages exhausted      | Report incomplete object/connection/bookmark coverage with counts; never report a document-wide negative result.                                |
| Large entity or stale cursor                          | Use bounded chunk reads; restart once on fresh state, charging retries to the same budget. Repeated churn ends with a limitation.               |
| User edited a managed field and added a note/bookmark | Refresh preserves the conflict and unrelated content; stable IDs prevent duplicates. Missing baselines are not ownership proof.                 |
| A source file changes after audit                     | Re-audit affected findings; do not stamp an old map as current merely because it can be reopened.                                               |

## Reproduce the executable checks

From the DepthPlan repository root:

```sh
node --test skills/examples/no-db/server.test.mjs
npm run build:automation
node scripts/skills-smoke.mjs
```

The native exercise launches its own temporary app profile, uses the existing test
driver to enable MCP and approve **only that temporary folder**, and then uses MCP
for document creation, reads, edits, file receipts and reopen. This is test setup,
not a permission mechanism available to installed skills. It checks source hashes,
hierarchy, labels/endpoints, bookmark visibility/framing, read-only retrieval,
pagination/chunks, and a refresh conflict plus unrelated edits. It prints the saved
temporary example paths, which can be opened in DepthPlan for visual inspection.

The deterministic exercise verifies the supplied worked plans and protocol behavior;
it is not proof that every model will independently produce the same audit or
recommendation. Use the prompts and adverse cases above for behavioral evaluation.
