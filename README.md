# MoonPaper

A roleplay chat site for your own characters. Write bots, give them pictures, set up a
world of lore, choose who you are, and talk to them through any OpenAI-compatible API
or reverse proxy.

Everything you create lives in your browser (IndexedDB). No accounts, no database, no
server-side storage of your key.

## What it does

- **Bots** with picture, tagline, tags, definition, scenario, first message, alternate
  first messages, example dialogue, and per-bot overrides for the system prompt,
  post-history instructions, model, temperature and reply length.
- **Pictures you crop yourself**: drag to move, wheel, pinch or the slider to zoom, for
  both bot pictures and personas. Backgrounds crop to 16:9.
- **Chat backgrounds**: one per bot, or a default for every chat, dimmed by an amount you
  choose so the words always sit on a plain surface.
- **Import and export character cards** in the format other roleplay sites use
  (Character Card V2: PNG with the card embedded, or JSON). Lorebooks inside a card
  are imported too.
- **Personas**: who you are in a chat, with a picture and description. Set a default
  and switch per chat.
- **Prompt page**: the main prompt, post-history instructions, what to include,
  generation settings, and a preview of the exact prompt a bot will receive.
  Save several presets.
- **Lorebooks**: lore entries live in books. A book can be used by every bot, or linked
  to the bots you choose, so a Fate bot and a sci-fi bot never see each other's world.
  Entries still enter the prompt only when their keywords appear in recent messages.
- **Text size**: choose a size for the whole site and, separately, for chat messages
  (Settings > Appearance). Saved in this browser.
- **Write my reply**: the pen button beside Send writes your next message as your persona,
  answering the bot's latest reply. Type a keyword or rough line first and it becomes a full
  message in your voice. The draft lands in the message box for you to edit, retry or undo;
  nothing is sent until you press Send. Its prompt is editable on the Prompt page.
- **Memory in layers** (`public/js/memory.js`): the newest messages (at least 12) are sent
  word for word; older ones become short chapters (one per 20 messages by default, set in
  Settings); once a few pile up, the oldest chapters fold into a story so far; lasting facts
  (names, promises, secrets, injuries, possessions) live in their own list, updated with each
  chapter; and old moments come back by keyword when the chat mentions them again. The
  prompt puts what rarely changes first and what changes every turn after the chat, and drops
  old messages in blocks of ten, so providers that cache repeated prompts can reuse most of
  each request. In a 200-message test chat this cut a reply's input from about 7,800 to about
  2,100 tokens. Read and edit it all from the book button in a chat; the usage numbers show
  how much the provider reused from its cache.
- **Long chats stay fast**: a chat draws its latest 100 messages, with "Show earlier" for more
  (jumping to an old message from search or pinned draws back to it). Recall keeps a word
  index per chat and only adds new messages to it, so looking up old moments takes well under
  a millisecond per reply even in a 100,000-message chat. A 5,000-message chat opens in about
  half a second instead of five.
- **Scene director**: the megaphone button (Alt+D) adds a hidden direction for the next
  reply only, such as "time skip to nightfall". It never appears in the chat.
- **Reply nudges**: the Regenerate button offers Shorter, Longer, More emotion, More action
  and More dialogue for a new version.
- **Group scenes**: add other bots to a chat from the people button. Pick who replies next,
  or leave it on Auto (the character you name, otherwise whoever has been quiet longest).
  Press Send with an empty box to let the next character carry the scene on.
- **Branches**: start a new chat from any message to try another path; the original stays.
- **Lore suggestions**: from a chat's ⋯ menu, the model proposes lore entries for lasting
  facts that came up. Edit, untick, and save them to a lorebook.
- **Character check**: the shield button on a reply checks it against the bot's definition
  and can write a new version that fixes what it found. Can run on every reply (Settings).
- **Ideas for what to say**: the bulb button (Alt+S) offers three options for your next move
  that fit your persona. Tap one to put it in the message box.
- **Translate**: translate any message into your language from its ⋯ menu, or write in
  your language and translate it into the chat's language before sending (Alt+T). Set
  both languages in Settings.
- **Scene tracker**: the map button keeps the state of the scene (location, time, who is
  there, mood, clothes, what they hold) and sends it with every reply. It can update
  itself after every reply.
- **Pinned moments**: pin a message that matters; pinned messages are always sent to the
  model, even after they fall out of the context. List them from the chat's ⋯ menu.
- **Recaps**: coming back to a chat after 12 hours or more shows a short "Previously…"
  recap. Ask for one any time from the ⋯ menu.
- **Turn into a story**: rewrite a chat, or its last messages, as prose to read or download.
- **Chat names**: the Rename box can suggest a title from what happened.
- **Find anything**: Ctrl+K (⌘K on a Mac), or the search button in the header, opens one
  box for every page, bot, setting and chat action. Type a word and press Enter. With
  text typed, the last result searches every chat for that line and jumps to it.
- **Welcome tour**: a six-step guide shows on the first visit. Open it again from
  Settings → Help or by typing "tour" in the search box. After an update, the home page
  shows a short "What's new" card.
- **Backup reminders**: once you have 20 or more messages and no backup in 7 days, the home
  page offers a one-click backup (API keys left out) or a reminder in 3 days.
- **Dice**: type `/roll d20`, `/roll 2d6+1 to pick the lock`, or use + → Roll dice. The
  roll is a fair random number, shown in the chat, and the next reply is told to respect it.
- **Persona per bot**: each bot remembers who you last were with it, and new chats with it
  start as that persona.
- **Favourites**: star a bot on the home page to keep it at the front of the list.
- **Rename in place**: click a chat's name in the chat header to rename it. The ⋯ menu's
  Rename still offers a suggested title.
- **Colours**: Moon Cell (violet and rose, after BB; the default) or Paper (warm cream and
  clay), in light and dark. Settings → Appearance → Colours.
- **BB**: a built-in Moon Cancer bot, written from `bots/BB.md`.
- **Chat look**: ⋯ → Chat look in a chat sets the bot's background, the dim amount, the font
  (Rounded, Book or Plain), the message size and the picture size (Small, Medium, Large), live.
  The font and picture size are also in Settings → Appearance.
- **Edit your persona from a chat**: the pencil beside "Speaking as" edits the persona's
  name and description. The change applies to every chat that uses that persona.
- **Bonds in group scenes**: every character in a group chat has a bond of their own.
  The bond meter opens all of them, with a chart of how each moved over the chat.
- **Rewind**: from a message's ⋯ menu, delete every message after it and continue from
  there. Offers to rebuild memory and the scene so they match. Can be undone.
- **Mature content**: Settings has three levels: Off (default), Mature (dark themes and
  violence, sexual content kept implied) and Explicit. Turning it on asks you to confirm
  you are 18 or older. Every request follows the level, including ideas, summaries and
  translations. A bot can be kept safe for work in its own settings. Characters in any
  sexual content are always adults. Your provider's own rules still apply.
- **Install as an app**: Settings → Install as an app puts the site on your home screen or
  app list. It opens full screen and loads bots and chats even offline (replies still
  need your connection).
- **Continue**: a reply cut off by the length limit says so and offers **Continue
  writing**, which finishes it in the same message. Also in any last reply's ⋯ menu.
- **Expressions**: upload a face per mood (neutral, happy, sad, angry, surprised,
  flustered, plus any moods you add, such as devious or mocking) in the bot editor. Replies end with a hidden mood tag, and the chat shows
  the matching face in place of the bot's picture. Only the moods you fill in are used; a reply
  without a mood shows the Neutral face if there is one.
  Kept in backups; not included in exported character cards.
- **Journal**: bots write a short private diary entry about the chat when you leave after
  12 or more new messages, or on demand. Read them from the chat's ⋯ menu.
- **Surprise me**: in the message box's + menu, a random event that fits the scene,
  placed in the direction bar to check, edit or re-roll before it shapes the next reply.
- **Usage**: Settings → Usage shows tokens for today, 7 and 30 days, a 14-day chart and
  a table by model, with a cost estimate if you enter prices. Counts the provider does
  not report are estimated and labelled as such. Each chat's ⋯ menu shows its own total.
- **Model switch**: the model chip in the chat header shows which model answers and lets
  you pick another for that chat only (in the ⋯ menu on phones).
- **Swipe**: on touch screens, swipe a reply left or right to move between its versions;
  swiping left on the newest version of the last reply writes a new one.
- **At a glance**: header tools are labelled on wide screens, and a line under the
  message box says what is happening in the background (writing, updating memory,
  checking, translating, writing the journal).
- **Confirmations**: deleting a message, saving an edit, branching and removing a
  character from a scene ask first. Turn this off in Settings.
- **Start from an idea**: in the bot editor, describe a character in a line and the model
  drafts every field for you to edit before saving.
- **Bond meter**: an optional relationship score per chat, shown in the chat header and
  told to the bot. Each bot has its own kind of bond (Affection, Romance, Rivalry, Loyalty,
  Fear to trust, or Custom), which names the six levels and says how the bot acts at each.
  When the bond changes level, a divider marks it in the chat and the next reply shows
  the change.
- **Chat**: streaming replies, stop, regenerate with swipes between versions, edit any
  message, delete with undo, several chats per bot (named Chat 1, Chat 2, … until you rename them), export a chat as text, Markdown or
  JSON, and a per-message view of which lore was used and how many tokens were spent.
- **Connection**: as many API profiles as you like, a model list fetched from the
  provider, a test button, and custom headers for fussy proxies.
- Light and dark theme, keyboard shortcuts, and a full backup/restore of your data.

## Running it locally

Requires Node 22.9 or newer.

```bash
npm install
npm start          # http://localhost:3000
```

`npm start` compiles `bots/*.md` and `lore/*.md` into `public/library.json`, then serves
`public/` and the `api/` functions. The server only listens on 127.0.0.1, so nobody else
on your network can open it.

## Deploying to Vercel

1. Push this folder to a Git repository.
2. In Vercel, **Add New → Project**, import the repository, and deploy. No settings to
   change: `vercel.json` already sets the build command and output directory.
3. Open the site, go to **Connection**, and add your API base URL, key and model.

Or from this folder:

```bash
npx vercel
```

Environment variables are optional (see below). The site works with none set: each
visitor brings their own key, and it is kept in their own browser.

## How requests reach your API

Set this per connection, on the Connection page.

| Mode | Path | Use when |
| --- | --- | --- |
| **Relay** (default) | Browser → this site's `/api/chat` → your proxy | Almost always. Avoids CORS errors that stop proxies working from a browser. Your key is sent with each request, used once, and never stored or logged. |
| **Direct** | Browser → your proxy | Your provider allows browser requests, or you run a local server such as Ollama. The key never touches this site. |
| **This site's key** | Browser → `/api/chat` → the key in the site's environment | You run the site and want to supply the key yourself. |

The relay refuses non-HTTPS URLs and private or local addresses when deployed, so a
public deployment can't be used to reach machines inside a network. Locally those
restrictions are off, so `http://localhost:11434/v1` works through the relay too.

## Environment variables (optional)

Copy `.env.example` to `.env` for local use, or set them in Vercel's project settings.

| Variable | Meaning |
| --- | --- |
| `API_BASE_URL` | Base URL used by the "This site's key" mode. |
| `API_KEY` | The key for that mode. |
| `DEFAULT_MODEL` | Model used when a request doesn't name one. |
| `ACCESS_CODE` | Required to allow "This site's key" on a deployed site. Without it, that mode works only when you run the site locally, so strangers can't spend your credit. Visitors type the code once on the Connection page. |
| `PORT` | Local server port. Default 3000. |

## The bond meter

When bond tracking is on, two things happen. The bot is told where it stands, for
example `Bond is 34 out of 100 (Civil)`, so the number colours how it behaves. And it is
asked to end each reply with a hidden tag such as `<bond:+2>`, from -5 to +5, which the
site strips out before showing the message.

The meter is worked out from the replies currently on screen, not from a running total,
so swiping to another version of a reply, editing it or deleting it moves the bond back
in step. The header shows a tier: Hostile, Wary, Civil, Warm, Close, Devoted.

Click the meter to set where *this* chat starts, so a stranger can begin at Hostile and
an old friend at Close. Anything the conversation has already earned stays on top of the
new figure, and other chats keep their own starting point. **Settings** holds the figure
new chats begin at.

Turn it off for one bot in that bot's **Scene** section, or everywhere in **Settings**.
Some small models ignore the tag; the bond then simply stays where it is.

## Lorebooks

Every entry belongs to a book, managed on the **Lore** page.

- A book marked **use with every bot** behaves like plain shared world lore.
- Any other book reaches a bot only when that bot ticks it in its **Scene** section.
- Importing a character card that carries a lorebook creates a book for it and links it
  to the imported bot.
- **Export** writes the book you are looking at; **Import** reads a book exported here, a
  plain array of entries, or a SillyTavern world-info file into the current book.

## Adding built-in bots and lore

Files in `bots/` and `lore/` are compiled at build time and copied into each visitor's
browser the first time they open the site. After that the copy belongs to them: editing
or deleting it does not come back on reload, and changing the `.md` file does not
overwrite their version.

A bot file:

```markdown
---
title: Morgan
tagline: Queen of Fairy Britain. Cold, exact, and slow to trust.
tags: [fate, royalty]
avatar: avatars/morgan.webp     # a file you put in public/
greeting: Speak.
alternate_greetings:
  - You again. Say what you came to say.
scenario: The throne room of Camelot, late in the night.
temperature: 0.85
max_tokens: 600
---

You are Morgan le Fay… (the definition: who they are, how they speak, their rules)
```

A lore file:

```markdown
---
title: Chaldea Security Organization
category: Organizations
keywords: [chaldea, security organization]
priority: 10
constant: false     # true = always in the prompt, ignoring keywords
---

Two to six short lines. Only what a bot needs in order to behave correctly.
```

Use `{{char}}` for the bot's name and `{{user}}` for your persona's name in any of these.

## Project layout

```
api/            Vercel functions: chat.js, models.js, config.js (thin wrappers)
lib/relay.js    Forwards requests to your API; blocks private addresses when deployed
lib/entries.js  Reads the .md files
scripts/build.js  bots/ + lore/  ->  public/library.json
dev.js          Local server; runs the same api/ handlers Vercel does
public/         The whole site: plain ES modules, no build step, no framework
  js/store.js     IndexedDB data layer
  js/prompt.js    Builds the messages sent to the model
  js/api.js       Talks to the API, parses streams
  js/card.js      Character card V2 import/export, including PNG
  js/ui.js        Shared widgets: crop dialog, pickers, dialogs, toasts
  js/views/       One file per page
```

There is no bundler and no dependency in the browser. `gray-matter` is used only by the
build script.

## Your data

Bots, chats, personas, lorebooks, presets, pictures and API keys are stored by your
browser, for this site only. Clearing site data deletes them. **Settings → Download backup** writes a JSON
file with everything (API keys are left out unless you tick the box), and **Restore**
reads it back.
