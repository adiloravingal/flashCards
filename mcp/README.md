# MCP server

Lets Claude read and write your cards from a normal conversation — Claude
Desktop, Claude Code, or anything else that speaks MCP.

## Setup

The app must be running (`npm start`), because this talks to its API rather
than to the database directly. That is deliberate: everything goes through the
same validation, deduplication and activity log the web UI uses.

Add this to your MCP client's config, with your own key from
**Settings → AI agent access** (or `data/agent-key.txt`):

```json
{
  "mcpServers": {
    "flashcards": {
      "command": "node",
      "args": ["/absolute/path/to/flashCards/mcp/server.js"],
      "env": {
        "FC_AGENT_KEY": "paste-your-key-here"
      }
    }
  }
}
```

Set `FC_URL` as well if the app runs somewhere other than
`http://localhost:3939` — your home server, for instance.

Claude Desktop reads
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS.
For Claude Code, use `claude mcp add`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_courses` | Courses, chapters, card and due counts |
| `create_cards` | Add cards; creates the course and chapter if needed |
| `search_cards` | Full-text search across fronts, backs, notes and tags |
| `update_card` | Edit a card's text, hint, notes or tags |
| `review_stats` | Streak, recall rate, forecast, sticking points |
| `list_due` | What is waiting to be reviewed |

## What it deliberately cannot do

No deleting, no restoring backups, no maintenance. An agent that can delete a
course is a bad trade for a capability you would rarely want, and that mistake
is not recoverable from the chat that caused it. Do those in the app.

`create_cards` accepts `dryRun`, and the tool description tells the model to
use it first and show you the plan. Duplicate fronts are skipped, so asking
twice does not leave you with two copies.

Every write lands in **Activity** attributed to `agent`, so you can always see
what was added — and undo it.

## When something goes wrong

If the app is not running, the tools say so in words and tell you to start it,
rather than returning a connection error. If the key is wrong, they say that
instead. Those are the two failures worth spelling out, because both look
identical from inside a chat otherwise.

## Example

> "Read this chapter on Bayes' theorem and make me 15 cards, cloze where the
> wording matters. Show me the plan first."
