# flashCards.io

A local-first flashcard app. Runs entirely on your machine, keeps everything in
one folder, and exposes a full REST API so external AI agents can create cards
for you.

There is no account, no sync, no telemetry, and no outbound network request of
any kind.

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:3939>. The database and media folder are created on first
boot, along with an API key at `data/agent-key.txt`.

For a real deployment:

```bash
npm run build
npm start
```

Or with Docker (`data/` is mounted as a volume, so upgrades never touch your
cards):

```bash
docker compose up -d
```

## Using it from your phone or another machine

Find this machine's address on the network, then open `http://<that address>:3939`
from the other device. Both devices must be on the same network.

```bash
ipconfig getifaddr en0
```

Two things are worth knowing:

**Use the production build for this, not `npm run dev`.** The dev server
rebuilds on every request and ships a hot-reload client; on a phone over a weak
access point it feels broken even when it isn't.

```bash
npm run build && npm start
```

**Dev mode blocks other devices by default.** Next.js serves the HTML to
anyone but returns `403` for the JavaScript chunks unless the requesting origin
is listed in `allowedDevOrigins`. The failure is confusing because the page
loads and then simply does nothing — it looks like a broken app rather than a
blocked request. `next.config.ts` now fills that list in automatically from
this machine's own interfaces, so it works without editing anything. Production
builds have no such restriction.

If it still won't connect, the problem is below the app:

- Confirm the other device is really on the same network — phones silently fall
  back to cellular when an access point has no internet, which an ESP32 SoftAP
  typically doesn't.
- Use the IP, not `hostname.local`. mDNS needs multicast forwarding that small
  access points often don't do.
- Check the access point isn't isolating clients. From this machine,
  `ping <other device IP>` — no reply in both directions means the AP won't
  pass traffic between stations, and nothing in this app can fix that.
- An ESP32 SoftAP defaults to a small number of simultaneous clients (often 4).

**Anyone on that network can now read and edit your cards.** Set `FC_LOCK_UI=1`
and the UI asks for the API key once, then remembers it.

## First-time setup

On a fresh machine, run the setup script. It checks what you have, installs
what's missing, and tells you exactly what to do next.

**macOS and Linux**

```bash
./scripts/setup.sh
```

**Windows** (PowerShell)

```powershell
.\scripts\setup.ps1
```

Both accept `--build` / `-Build` to produce a production build at the same
time, and `--yes` / `-Yes` to run without prompting.

What they do:

- Check Node is present and at least **v22**. This is stricter than Next's own
  `>=20.9` because `better-sqlite3` — which stores your cards — requires 22.
  Checking the looser number would let setup pass and then fail later with an
  opaque native-module error.
- Offer to install Node via the package manager you already have (Homebrew,
  apt + NodeSource, dnf, pacman, zypper, apk, or winget), after asking. If
  there isn't one, they print the download link instead of guessing.
- Install dependencies with `npm ci` when a lockfile is present.
- **Actually run** `better-sqlite3` and create an FTS5 table, rather than
  assuming a successful install means a working native module. Prebuilt
  binaries ship for macOS, Linux, musl and Windows on both x64 and arm64, so
  no compiler is normally needed — and if the check does fail, the script names
  the build tools to install.
- Create `data/` and copy `.env.example` to `.env.local` if you don't have one.

They never touch an existing database, media folder or API key.

## Checking it still works

```bash
npm run smoke
```

Exercises the whole app over HTTP the way an agent would — auth, card
creation, the review loop, undo, cloze expansion, spreadsheet and Anki import,
search, logs and export. It creates a throwaway `SMOKE …` course and deletes it
afterwards, so it's safe to run against a real collection.

## Configuration

Everything is optional — copy `.env.example` to `.env.local` to change it.

| Variable | Default | What it does |
| --- | --- | --- |
| `FC_DATA_DIR` | `./data` | Where the database and media live |
| `FC_AGENT_KEY` | generated | Key agents send as `Authorization: Bearer …` |
| `FC_LOCK_UI` | `0` | `1` makes the web UI ask for the key once. Use on a home server; leave off on your laptop |
| `FC_MAX_UPLOAD_MB` | `64` | Per-file upload limit |

## How it's put together

```
src/
  lib/
    schema.ts       ordered SQL migrations (append-only)
    db.ts           connection, migrations, settings, agent key
    repo.ts         all queries: courses, chapters, cards, queue, answering
    scheduler.ts    FSRS wrapper — the only file that knows the algorithm
    cloze.ts        {{c1::…}} parsing, rendering and authoring helpers
    importer.ts     xlsx/csv parsing and column detection
    anki.ts         .apkg reading: zip, zstd, both collection schemas
    deck.ts         .fcdeck — the shareable export/import format
    periods.ts      day/week/month aggregation for the Progress screen
    staging.ts      holds an upload between an import's preview and commit
    media.ts        upload, content-hash dedupe, MIME resolution
    auth.ts         bearer key / unlock cookie
    log.ts          append-only audit trail
    api.ts          route wrapper: auth, uniform {ok,data} shape, error capture
    validators.ts   zod schemas for every write endpoint
  app/api/v1/       the REST API — used by the UI and by agents alike
  app/              the screens
  components/       UI built from scratch, no component library
```

The web UI has no privileged path: it calls the same `/api/v1` endpoints an
agent would. Anything you can do, an agent can do, and vice versa.

**Data model.** Course → Chapter → Card. Scheduling state lives inline on the
card, so resetting progress is one `UPDATE`. `review_log` stores a snapshot of
the card *before* each answer, which is what makes undo an exact restore rather
than a guess.

**Notes vs cards.** A note is what you author; a card is one thing you get
asked. A basic note makes one card. A cloze note (`{{c1::…}}`) makes one card
per deletion index, grouped by `note_id`, each with its own schedule. Editing
shared text fans out across siblings while preserving their individual review
histories — that invariant is the whole reason the two concepts are separate.

**Two kinds of export, on purpose.** `Settings → Backup` writes the whole
collection as JSON *including* scheduling — it is meant to come back to you.
`Export course` / `Export chapter` writes a `.fcdeck` zip (deck.json + media)
carrying content only — it is meant for someone else, and your intervals
describe your memory rather than theirs. A deck file stores *notes*, so a cloze
note travels as one entry and re-expands into its cards on import.

**Anki import.** Three .apkg generations exist in the wild and all three are
read: plain `collection.anki2`, plain `collection.anki21`, and zstd-compressed
`collection.anki21b` with its protobuf media manifest. Note *templates* are
deliberately not interpreted — field 1 becomes the front, field 2 the back, and
extras become notes. Cloze needs no special casing, because the `{{c1::…}}`
markup survives as text and the normal card pipeline expands it.

**Search** is SQLite FTS5, kept in sync by triggers, with a `LIKE` fallback for
queries the FTS parser rejects.

## For AI agents

Give an agent the key and point it at `/api/v1/spec` — that endpoint returns a
machine-readable description of every route, the safety rails, and a worked
example, so you don't have to explain the API yourself.

```bash
curl -s localhost:3939/api/v1/spec -H "Authorization: Bearer $KEY" | jq
```

Creating cards:

```bash
curl -X POST localhost:3939/api/v1/cards \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "courseName": "Pharmacology",
    "chapterName": "Beta blockers",
    "dryRun": true,
    "cards": [{ "front": "Mechanism of propranolol?",
                "back": "Non-selective beta-adrenergic antagonist" }]
  }'
```

What keeps this safe to hand to an agent:

- **`dryRun: true`** reports what would happen and writes nothing.
- **Dedupe is on by default**, so re-running the same request is a no-op.
- **Every write is logged** with `actor: "agent"` and shown at `/logs`.
- **Strict validation** returns a 400 naming the offending field.
- **Hard limits**: 500 cards per request, 25 files per upload.
- Courses and chapters are created on demand, so no id lookups are needed.

## Backups

Copy the `data/` folder. That's the whole backup — `app.db` is a normal SQLite
database and `media/` holds your files with their original bytes. Settings →
Your data also exports everything as plain JSON.

## Notes

- Scheduling is [FSRS](https://github.com/open-spaced-repetition/ts-fsrs), the
  algorithm modern Anki uses. The only knob is target retention.
- Practice ("cram") mode never modifies the schedule.
- Imported Anki cards start unscheduled on purpose: FSRS here and the scheduler
  they came from don't share assumptions, so carrying intervals over would give
  you confidently wrong dates rather than an honest fresh start.
- The full manual is inside the app at `/docs`.
