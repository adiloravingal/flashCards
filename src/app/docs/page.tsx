"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, PageHeader, Panel } from "@/components/ui";
import { cx } from "@/lib/client";

/**
 * The manual, kept inside the app.
 *
 * Nothing in the rest of the UI explains itself with tooltips or tours — the
 * screens are meant to be obvious. When they aren't, everything is written
 * down here in one place you can search.
 */

const SECTIONS = [
  { id: "start", label: "Getting started" },
  { id: "review", label: "Reviewing" },
  { id: "getting-around", label: "Getting around" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "cards", label: "Making cards" },
  { id: "progress", label: "Reading your progress" },
  { id: "cloze", label: "Cloze deletions" },
  { id: "import", label: "Importing spreadsheets" },
  { id: "sharing", label: "Sharing a course or chapter" },
  { id: "devices", label: "Using more than one device" },
  { id: "android", label: "The Android app" },
  { id: "anki", label: "Importing Anki decks" },
  { id: "media", label: "Images, audio & files" },
  { id: "scheduling", label: "How scheduling works" },
  { id: "agents", label: "AI agent access" },
  { id: "data", label: "Your data & backups" },
  { id: "hosting", label: "Running it on a server" },
];

export default function DocsPage() {
  const [active, setActive] = useState("start");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <PageHeader
        title="Guide"
        subtitle="Everything this app does, written down once."
      />

      <div className="flex gap-10">
        {/* Sticky contents */}
        <nav className="hidden lg:block w-48 shrink-0">
          <div className="sticky top-8 space-y-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={cx(
                  "block px-2.5 py-1.5 rounded-lg text-[13px] transition-colors",
                  active === s.id
                    ? "bg-[var(--surface-2)] text-[var(--text)] font-medium"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 grow space-y-10 pb-16">
          <Doc id="start" title="Getting started">
            <P>
              There are two ways to get cards in. Either{" "}
              <A href="/import">import a spreadsheet</A> you already have, or{" "}
              <A href="/add">write cards by hand</A>. You can also let an AI
              agent add them for you — see{" "}
              <a href="#agents" className="text-[var(--accent)] hover:underline">
                AI agent access
              </a>
              .
            </P>
            <P>
              Cards are organised as <B>Course → Chapter → Card</B>. A course is
              a subject (&ldquo;Spanish&rdquo;), a chapter is a slice of it
              (&ldquo;Irregular verbs&rdquo;). You can review at any level: one
              chapter, a whole course, or everything at once.
            </P>
            <P>
              The <B>Today</B> screen is the only one you need day to day. It
              shows a single button with the number of cards waiting. Press it.
            </P>
          </Doc>

          <Doc id="review" title="Reviewing">
            <P>
              A card shows its front. You try to recall the answer, then flip it
              and say whether you got it. That&apos;s the whole loop.
            </P>
            <List
              items={[
                <>
                  <B>Sessions end.</B> Each round is capped (20 cards by
                  default, changeable in Settings) so there is always a visible
                  finish line rather than an endless queue.
                </>,
                <>
                  <B>Missed cards come back.</B> If you press &ldquo;Missed
                  it&rdquo;, the card is added to the end of the current session
                  so you see it again before you finish.
                </>,
                <>
                  <B>Undo is always there.</B> Press <K>u</K> or the undo arrow
                  to take back your last answer, including the scheduling change.
                  Mis-clicking &ldquo;Easy&rdquo; is not permanent.
                </>,
                <>
                  <B>Practice mode.</B> &ldquo;Practise anyway&rdquo; shuffles
                  through cards without touching their schedule — useful the
                  night before an exam, harmless the rest of the time.
                </>,
                <>
                  <B>Edit mid-review.</B> Press <K>e</K> when you spot a typo or
                  a card that&apos;s trying to hold too much.
                </>,
              ]}
            />
          </Doc>

          <Doc id="getting-around" title="Getting around">
            <P>
              On a wide screen everything sits in the left sidebar. On a phone
              or tablet the bottom bar carries the four things you reach for
              constantly — <B>Today</B>, <B>Courses</B>, the <B>+</B> button,
              and <B>Search</B> — and <B>More</B> holds the rest:{" "}
              <B>Progress</B>, <B>Activity</B>, <B>Import</B>, <B>Guide</B> and{" "}
              <B>Settings</B>.
            </P>
            <P>
              More lights up when you&apos;re inside one of those screens, so
              the bar always shows where you actually are. Tap anywhere outside
              the panel to dismiss it.
            </P>
          </Doc>

          <Doc id="shortcuts" title="Keyboard shortcuts">
            <P>
              The whole app is usable without a mouse. These work everywhere:
            </P>
            <Keys
              rows={[
                ["⌘K / Ctrl+K", "Jump to anything — cards, courses, actions"],
                ["n", "Write a new card, wherever you are"],
              ]}
            />
            <P className="mt-5">During review:</P>
            <Keys
              rows={[
                ["Space", "Show the answer · then “Got it” in two-button mode"],
                ["1", "Missed it / Again"],
                ["2", "Got it · or Hard in four-button mode"],
                ["3 / 4", "Good / Easy (four-button mode only)"],
                ["u", "Undo the last answer"],
                ["e", "Edit this card"],
                ["s", "Star this card"],
                ["h", "Show the hint"],
                ["Esc", "Leave the session"],
              ]}
            />
            <P className="mt-5">In the card editor:</P>
            <Keys rows={[["⌘↵ / Ctrl+↵", "Save and start the next card"]]} />
          </Doc>

          <Doc id="cards" title="Making cards">
            <P>
              Only the front and back are required. Hint, notes and tags are
              collapsed until you ask for them.
            </P>
            <List
              items={[
                <>
                  <B>Front</B> — the prompt. <B>Back</B> — the answer, and only
                  the answer.
                </>,
                <>
                  <B>Hint</B> — hidden until you press <K>h</K> during review.
                  Good for a first letter or a category.
                </>,
                <>
                  <B>Notes</B> — shown after you flip. Context, mnemonics, a
                  source link. Keeps the answer itself clean.
                </>,
                <>
                  <B>Tags</B> — free-form labels. The Search screen lets you
                  review any tag as its own deck.
                </>,
                <>
                  <B>Star</B> — a manual flag for cards you care about. Review
                  just the starred ones from the command palette.
                </>,
                <>
                  <B>Pause</B> — takes a card out of rotation without deleting
                  it. Useful for material you&apos;ve dropped but might return
                  to.
                </>,
              ]}
            />
            <Callout>
              One fact per card. If the back has a comma-separated list in it,
              it&apos;s usually two or three cards wearing a trench coat — and
              those are the ones that show up under &ldquo;Sticking points&rdquo;
              on the Progress screen.
            </Callout>
          </Doc>

          <Doc id="progress" title="Reading your progress">
            <P>
              <A href="/stats">Progress</A> opens on the current week. Switch
              between <B>Day</B>, <B>Week</B> and <B>Month</B>, and move back
              through time by swiping the chart sideways or pressing{" "}
              <K>←</K> and <K>→</K>.
            </P>
            <List
              items={[
                <>
                  <B>Day</B> buckets by hour, and tells you your busiest one —
                  useful for noticing when you actually study, rather than when
                  you intend to.
                </>,
                <>
                  <B>Week</B> and <B>Month</B> bucket by day, with today
                  highlighted.
                </>,
                <>
                  <B>Recall</B> counts only cards you had already learned.
                  Grading a card you&apos;re still learning says nothing about
                  long-term retention, so including it would flatter the number.
                </>,
                <>
                  Each period is compared against the one before it, and the
                  arrows stop at your oldest review — there&apos;s no endless
                  empty history to scroll into.
                </>,
              ]}
            />
            <Callout>
              A quiet week is information, not a verdict. The chart exists to
              show you when you study best, not to be kept full.
            </Callout>
          </Doc>

          <Doc id="cloze" title="Cloze deletions">
            <P>
              A cloze card blanks out part of a sentence instead of asking a
              separate question. Select the words you want hidden and press{" "}
              <K>⌘⇧C</K> (or the <B>Blank out selection</B> button).
            </P>
            <CodeBlock>{`Water is {{c1::H2O}}, and salt is {{c2::NaCl}}.`}</CodeBlock>
            <List
              items={[
                <>
                  <B>Each number becomes its own card</B> with its own schedule.
                  The example above makes two. Forgetting one doesn&apos;t drag
                  the other backwards.
                </>,
                <>
                  <B>Reuse a number</B> to blank two things at once:{" "}
                  <C>{`{{c1::Na}}`}</C> and <C>{`{{c1::K}}`}</C> are asked
                  together on one card.
                </>,
                <>
                  <B>Add a nudge</B> with a second <C>::</C> —{" "}
                  <C>{`{{c1::ATP::which molecule}}`}</C> shows{" "}
                  <C>[which molecule]</C> in place of the blank.
                </>,
                <>
                  <B>Other blanks stay visible</B> while you answer, because the
                  surrounding sentence is what makes the card answerable.
                </>,
                <>
                  <B>Editing is safe.</B> Fixing a typo updates every card in
                  the note and keeps their review history. Adding a new number
                  makes one new card; deleting one removes just that card.
                </>,
                <>
                  <B>Back is optional</B> on a cloze card — the answer is
                  already in the sentence, so it&apos;s only for extra context.
                </>,
              ]}
            />
            <Callout>
              Cloze is the fastest way to turn a sentence you already wrote into
              a card. If you find yourself rephrasing a fact into a question,
              try blanking the fact instead.
            </Callout>
          </Doc>

          <Doc id="import" title="Importing spreadsheets">
            <P>
              <A href="/import">Import</A> accepts <B>.xlsx</B>, <B>.xls</B>,{" "}
              <B>.csv</B> and <B>.tsv</B>. Drop the file in and you get a preview
              screen before anything is written.
            </P>
            <List
              items={[
                <>
                  <B>Each sheet becomes a chapter</B>, named after the sheet. You
                  can rename it or untick it on the preview screen.
                </>,
                <>
                  <B>Columns are guessed.</B> Headers like{" "}
                  <C>front</C>, <C>back</C>, <C>question</C>, <C>answer</C>,{" "}
                  <C>term</C>, <C>definition</C>, <C>word</C>,{" "}
                  <C>translation</C> are recognised. Without headers, the first
                  two columns are used.
                </>,
                <>
                  <B>Extra columns</B> for hint, notes and tags are picked up if
                  present, and can be re-pointed with the dropdowns.
                </>,
                <>
                  <B>Tags split</B> on commas, semicolons and pipes, so{" "}
                  <C>verbs; past-tense</C> becomes two tags.
                </>,
                <>
                  <B>Empty rows are skipped</B> silently. Rows where both the
                  front and back are empty never become cards.
                </>,
              ]}
            />
            <P>
              Nothing is saved until you press the Import button, and the preview
              shows you the first three rows exactly as they will appear.
            </P>
          </Doc>

          <Doc id="sharing" title="Sharing a course or chapter">
            <P>
              Open a course and press <B>Export course</B>, or open a chapter
              and press <B>Export chapter</B>. You get a single{" "}
              <C>.fcdeck</C> file — send it however you like. Whoever receives
              it drops it on their <A href="/import">Import</A> screen.
            </P>
            <List
              items={[
                <>
                  <B>Everything comes along:</B> cards, cloze notes, tags,
                  hints, notes, and every image or audio file they use.
                </>,
                <>
                  <B>Your review history doesn&apos;t.</B> Cards arrive unseen.
                  Your intervals describe your memory, not theirs — passing them
                  on would just give someone confidently wrong due dates.
                </>,
                <>
                  <B>Importing is previewed.</B> You see the course name,
                  chapters and card counts, and can rename the course before
                  anything is written.
                </>,
                <>
                  <B>Importing twice is safe.</B> A chapter that already exists
                  is reused rather than duplicated, and identical media is
                  stored once.
                </>,
              ]}
            />
            <Callout>
              For your own backup, use <A href="/settings">Settings → Backup</A>{" "}
              instead. That export <em>does</em> keep scheduling, because it&apos;s
              meant to come back to you.
            </Callout>
          </Doc>

          <Doc id="devices" title="Using more than one device">
            <P>
              There is no account and nothing syncs over the internet, so you
              move between devices by moving a file. Go to{" "}
              <A href="/settings">Settings → Moving between devices</A> and
              press <B>Export everything</B>. You get one{" "}
              <C>.fcbackup</C> file holding every card, every image and audio
              file, your settings, and your whole review history.
            </P>
            <P>
              Put that file on the other device however you like — AirDrop, a
              USB stick, a shared folder — then press{" "}
              <B>Restore from a backup</B> there and pick it. You&apos;ll see
              what&apos;s in the file next to what&apos;s already on that
              device before anything happens.
            </P>
            <List
              items={[
                <>
                  <B>Add what&apos;s missing</B> brings across anything that
                  device doesn&apos;t have. Cards you already study there keep
                  their own schedule — nothing is overwritten. This is the
                  safe one, and it&apos;s pre-selected when the device already
                  has cards.
                </>,
                <>
                  <B>Replace everything</B> makes that device an exact copy:
                  same cards, same due dates, same history. Anything on it that
                  isn&apos;t in the file is removed. A copy of what was there is
                  written into <C>data/</C> first, so a mistake costs a minute.
                </>,
                <>
                  <B>Restoring twice is harmless.</B> Cards keep their identity
                  across devices, so the same file applied again changes
                  nothing.
                </>,
                <>
                  <B>Your API key is never in the file.</B> Each device keeps
                  its own, so a backup is safe to send through anything.
                </>,
              ]}
            />
            <Callout>
              This is a one-way copy, not sync. If you study on both devices and
              then restore in one direction, whichever device you restored
              <em>onto</em> loses the progress it made. Pick a direction each
              time — or use <B>Add what&apos;s missing</B>, which never throws
              work away.
            </Callout>
          </Doc>

          <Doc id="android" title="The Android app">
            <P>
              There is an Android build of this same app. It runs entirely on
              the phone — no server, no network, nothing to keep running at
              home. Your cards live in the app&apos;s own storage.
            </P>
            <List
              items={[
                <>
                  <B>Everything you study with is there:</B> courses, chapters,
                  cloze cards, images and audio, scheduling, progress and
                  search.
                </>,
                <>
                  <B>Move cards across with a backup.</B> Export a{" "}
                  <C>.fcbackup</C> here, open it on the phone, restore. It
                  works in either direction.
                </>,
                <>
                  <B>No AI agent API on the phone.</B> Nothing is listening on
                  a port there, so <C>/api/v1</C> doesn&apos;t exist. Write
                  cards with an agent on the machine running the server, then
                  carry them over.
                </>,
                <>
                  <B>It is not sync.</B> Restoring in one direction replaces
                  what was on the receiving device, so pick a direction each
                  time — or use <B>Add what&apos;s missing</B>, which never
                  discards work.
                </>,
              ]}
            />
            <Callout>
              The app isn&apos;t on the Play Store, so Android will ask you to
              allow installing from wherever you downloaded it, and may warn
              that the developer is unknown. That is what sideloading looks
              like; it is not a sign anything is wrong.
            </Callout>
          </Doc>

          <Doc id="anki" title="Importing Anki decks">
            <P>
              Drop an <B>.apkg</B> file on the <A href="/import">Import</A>{" "}
              screen. Both the old and new Anki export formats are read, so
              anything from AnkiWeb or a friend&apos;s export works.
            </P>
            <List
              items={[
                <>
                  <B>Subdecks become courses and chapters.</B>{" "}
                  <C>Spanish::Verbs::Irregular</C> becomes the course
                  “Spanish”, chapter “Verbs › Irregular”. You can edit both
                  before importing.
                </>,
                <>
                  <B>Cloze notes stay cloze</B>, with one card per deletion,
                  exactly as they were.
                </>,
                <>
                  <B>Images and audio come across</B> and are attached to the
                  right side of the card. <C>[sound:…]</C> markers become audio
                  players.
                </>,
                <>
                  <B>Extra fields are kept</B> as notes rather than dropped.
                </>,
                <>
                  <B>Tags are preserved.</B>
                </>,
              ]}
            />
            <P>What deliberately doesn&apos;t come across:</P>
            <List
              items={[
                <>
                  <B>Note templates and styling.</B> Anki&apos;s card templates
                  are a small programming language; rather than half-execute
                  them, fields are flattened to plain text. Field 1 becomes the
                  front, field 2 the back.
                </>,
                <>
                  <B>Scheduling history.</B> Imported cards start fresh. FSRS
                  here and the scheduler there don&apos;t share assumptions, and
                  pretending otherwise would give you wrong intervals rather
                  than no intervals.
                </>,
              ]}
            />
            <Callout>
              Import is additive and previewed. If a deck lands somewhere you
              didn&apos;t want, delete the course and try again with different
              names — nothing else is touched.
            </Callout>
          </Doc>

          <Doc id="media" title="Images, audio & files">
            <P>
              Any file type can go on either side of a card. The fastest way is
              to <B>paste or drop it straight into the Front or Back box</B> —
              whichever box you paste into is the side it attaches to. Take a
              screenshot, click into Front, press <K>⌘V</K>, done. There is also
              an <B>Attach</B> button if you&apos;d rather browse for the file.
            </P>
            <List
              items={[
                <>
                  <B>Text still pastes normally.</B> Only files are intercepted.
                  If a paste carries both — copying a chunk of a web page, say —
                  the text lands at your cursor and the image attaches.
                </>,
                <>
                  <B>Anything the clipboard holds</B> works: screenshots, images
                  copied from a page, and files copied from Finder or Explorer,
                  of any type.
                </>,
                <>
                  <B>Images</B> display inline on the card.
                </>,
                <>
                  <B>Audio</B> gets a player, and can auto-play when the card
                  appears (Settings → During review). Ideal for language
                  pronunciation.
                </>,
                <>
                  <B>Video</B> gets an inline player with seeking.
                </>,
                <>
                  <B>PDFs and anything else</B> appear as a labelled chip that
                  opens in a new tab.
                </>,
              ]}
            />
            <P>
              Pasted images are named by the moment you pasted them (
              <C>Pasted image 2026-08-12 14.32.05.png</C>) rather than the
              browser&apos;s default <C>image.png</C>, so a library of
              screenshots stays tellable apart.
            </P>
            <P>
              Identical files are stored once no matter how many cards use them,
              so attaching the same diagram to forty cards costs one copy on
              disk. Files live in <C>data/media/</C>.
            </P>
          </Doc>

          <Doc id="scheduling" title="How scheduling works">
            <P>
              The app uses <B>FSRS</B>, the same algorithm modern Anki uses. You
              don&apos;t need to configure it. Each answer updates a model of how
              well you know that specific card, and it picks the moment you&apos;re
              about to forget as the best time to show it again.
            </P>
            <List
              items={[
                <>
                  <B>Target retention</B> (Settings) is the one knob that
                  matters. 90% means you&apos;re aiming to recall nine cards in
                  ten. Raising it means more reviews; lowering it means fewer,
                  with more forgetting.
                </>,
                <>
                  <B>New cards per day</B> caps how fast fresh material enters
                  rotation. This is what stops a 500-card import from burying you
                  next week.
                </>,
                <>
                  <B>New cards are mixed in</B>, not stacked at the end — a wall
                  of unfamiliar cards is where sessions get abandoned.
                </>,
                <>
                  <B>Practice mode never changes the schedule</B>, so you can
                  cram freely without damaging your long-term intervals.
                </>,
              ]}
            />
            <P>
              Under each answer button you&apos;ll see when that choice would
              bring the card back (<C>10m</C>, <C>4d</C>, <C>2.1mo</C>). It&apos;s
              a preview, not a commitment.
            </P>
          </Doc>

          <Doc id="agents" title="AI agent access">
            <P>
              This app contains no AI of its own. Instead it exposes a complete
              REST API so an <B>external</B> agent — Claude, a script, whatever
              you like — can create and manage cards on your behalf.
            </P>
            <P>
              Give the agent your key (Settings → AI agent access) and point it
              at <C>/api/v1/spec</C>. That endpoint returns a full,
              machine-readable description of every route, its safety rails, and
              a worked example, so you don&apos;t have to explain the API
              yourself.
            </P>

            <CodeBlock>{`curl -s http://localhost:3939/api/v1/spec \\
  -H "Authorization: Bearer YOUR_KEY" | jq`}</CodeBlock>

            <P>Creating cards in bulk:</P>
            <CodeBlock>{`curl -X POST http://localhost:3939/api/v1/cards \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "courseName": "Pharmacology",
    "chapterName": "Beta blockers",
    "dryRun": true,
    "cards": [
      { "front": "Mechanism of propranolol?",
        "back": "Non-selective beta-adrenergic antagonist",
        "tags": ["cardio"] }
    ]
  }'`}</CodeBlock>

            <P>The safety rails that make this survivable:</P>
            <List
              items={[
                <>
                  <B>Dry run.</B> <C>dryRun: true</C> reports exactly what would
                  happen and writes nothing. An agent can show you the plan
                  first.
                </>,
                <>
                  <B>Deduplication is on by default.</B> Cards whose front
                  already exists in the target chapter are skipped, so re-running
                  the same request twice is harmless.
                </>,
                <>
                  <B>Everything is logged.</B> Every agent write appears in{" "}
                  <A href="/logs">Activity</A> tagged as an agent, with the
                  request details. You can always see what was done in your name.
                </>,
                <>
                  <B>Strict validation.</B> Malformed requests are rejected with
                  a specific message naming the field, not a 500.
                </>,
                <>
                  <B>Courses and chapters are created on demand</B>, so an agent
                  never needs to look up ids before writing.
                </>,
                <>
                  <B>Hard limits.</B> 500 cards per request, 25 files per upload.
                </>,
              ]}
            />
            <Callout>
              The key is the only thing standing between your cards and anything
              else on your network. Rotate it from Settings if you ever paste it
              somewhere you shouldn&apos;t have.
            </Callout>
          </Doc>

          <Doc id="data" title="Your data & backups">
            <P>
              Everything is in one folder: <C>data/</C>, next to the app.
              It contains <C>app.db</C> (a normal SQLite database) and{" "}
              <C>media/</C> (your files, with their original bytes). Copy that
              folder and you have a complete, restorable backup.
            </P>
            <List
              items={[
                <>
                  <B>Nothing leaves your machine.</B> There is no account, no
                  sync, no telemetry, no outbound request of any kind.
                </>,
                <>
                  <B>JSON export</B> (Settings → Your data) writes every course,
                  chapter and card to a plain file, so your content is never
                  trapped in a format only this app reads.
                </>,
                <>
                  <B>The database is just SQLite.</B> Open it with any SQLite
                  browser if you want to query it yourself.
                </>,
              ]}
            />
          </Doc>

          <Doc id="hosting" title="Running it on a server">
            <P>
              To run this on a home server rather than your laptop, set{" "}
              <C>FC_LOCK_UI=1</C> in <C>.env.local</C>. The web UI will then ask
              for your API key once and remember it, instead of opening freely.
            </P>
            <CodeBlock>{`# .env.local
FC_DATA_DIR=./data
FC_AGENT_KEY=pick-a-long-random-string
FC_LOCK_UI=1
FC_MAX_UPLOAD_MB=64`}</CodeBlock>
            <P>Then build and start it:</P>
            <CodeBlock>{`npm run build
npm start   # listens on port 3939`}</CodeBlock>
            <P>
              <C>npm run dev</C> uses port 3000 instead, so you can work on the
              code without taking down the copy you actually study from.
            </P>
            <P>
              A <C>Dockerfile</C> and <C>docker-compose.yml</C> are included if
              you&apos;d rather run it as a container — the <C>data/</C> folder is
              mounted as a volume so upgrades never touch your cards.
            </P>
            <Callout>
              Leave <C>FC_LOCK_UI</C> off while it&apos;s only on your own
              machine. Every unnecessary lock screen is a reason not to open the
              app, and an app you don&apos;t open teaches you nothing.
            </Callout>
          </Doc>
        </div>
      </div>
    </>
  );
}

/* ========================================================================== */

function Doc({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="text-lg font-semibold tracking-[-0.015em] mb-3 pb-2 border-b border-[var(--border)]">
        {title}
      </h2>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

const P = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <p
    className={cx(
      "text-[14px] leading-[1.75] text-[var(--text-muted)]",
      className,
    )}
  >
    {children}
  </p>
);

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-semibold text-[var(--text)]">{children}</strong>
);

const C = ({ children }: { children: React.ReactNode }) => (
  <code className="px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] text-[var(--accent)] font-mono text-[12.5px]">
    {children}
  </code>
);

const K = ({ children }: { children: React.ReactNode }) => (
  <span className="kbd">{children}</span>
);

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="text-[var(--accent)] hover:underline">
    {children}
  </Link>
);

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="text-[14px] leading-[1.7] text-[var(--text-muted)] pl-5 relative"
        >
          <span className="absolute left-0 top-[0.6em] w-1.5 h-1.5 rounded-full bg-[var(--border-strong)]" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Keys({ rows }: { rows: [string, string][] }) {
  return (
    <Panel className="divide-y divide-[var(--border)] overflow-hidden">
      {rows.map(([keys, desc]) => (
        <div key={keys} className="flex items-center gap-4 px-4 py-2.5">
          <span className="kbd shrink-0 min-w-[5.5rem] px-2">{keys}</span>
          <span className="text-[13px] text-[var(--text-muted)]">{desc}</span>
        </div>
      ))}
    </Panel>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-3.5 rounded-[var(--radius)] bg-[var(--accent-soft)] border border-[var(--accent)]/25">
      <Icon
        name="help"
        className="w-[18px] h-[18px] text-[var(--accent)] shrink-0 mt-0.5"
      />
      <p className="text-[13px] leading-[1.7] text-[var(--text)]">{children}</p>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="p-3.5 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] overflow-x-auto text-[12.5px] leading-relaxed font-mono text-[var(--text-muted)]">
      {children}
    </pre>
  );
}
