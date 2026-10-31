# Discord — Access & Delivery

Discord only allows DMs between accounts that share a server. Who can DM your bot depends on where it's installed: one private server means only that server's members can reach it; a public community means every member there can open a DM.

The **Public Bot** toggle in the Developer Portal (Bot tab, on by default) controls who can add the bot to new servers. Turn it off and only your own account can install it. This is your first gate, and it's enforced by Discord rather than by this process.

For DMs that do get through, the default policy is **pairing**. An unknown sender gets a 6-character code in reply and their message is dropped. You run `/discord:access pair <code>` from your assistant session to approve them. Once approved, their messages pass through.

All state lives in `~/.claude/channels/discord/access.json`. The `/discord:access` skill commands edit this file; the server re-reads it on every inbound message, so changes take effect without a restart. Set `DISCORD_ACCESS_MODE=static` to pin config to what was on disk at boot (pairing is unavailable in static mode since it requires runtime writes).

## At a glance

| | |
| --- | --- |
| Default policy | `pairing` |
| Sender ID | User snowflake (numeric, e.g. `184695080709324800`) |
| Group key | Channel snowflake — not guild ID |
| Config file | `~/.claude/channels/discord/access.json` |

## DM policies

`dmPolicy` controls how DMs from senders not on the allowlist are handled.

| Policy | Behavior |
| --- | --- |
| `pairing` (default) | Reply with a pairing code, drop the message. Approve with `/discord:access pair <code>`. |
| `allowlist` | Drop silently. No reply. Use this once everyone who needs access is already on the list, or if pairing replies would attract spam. |
| `disabled` | Drop everything, including allowlisted users and guild channels. |

```
/discord:access policy allowlist
```

## User IDs

Discord identifies users by **snowflakes**: permanent numeric IDs like `184695080709324800`. Usernames are mutable; snowflakes aren't. The allowlist stores snowflakes.

Pairing captures the ID automatically. To add someone manually, enable **User Settings → Advanced → Developer Mode** in Discord, then right-click any user and choose **Copy User ID**. Your own ID is available by right-clicking your avatar in the lower-left.

```
/discord:access allow 184695080709324800
/discord:access remove 184695080709324800
```

## Guild channels

Guild channels are off by default. Opt each one in individually, keyed on the **channel** snowflake (not the guild). Threads inherit their parent channel's opt-in; no separate entry needed. Find channel IDs the same way as user IDs: Developer Mode, right-click the channel, Copy Channel ID.

```
/discord:access group add 846209781206941736
```

With the default `requireMention: true`, the bot responds only when @mentioned or replied to. Pass `--no-mention` to process every message in the channel, or `--allow id1,id2` to restrict which members can trigger it.

```
/discord:access group add 846209781206941736 --no-mention
/discord:access group add 846209781206941736 --allow 184695080709324800,221773638772129792
/discord:access group rm 846209781206941736
```

### Bots and webhooks

Messages from other bots and from webhooks are dropped everywhere by default: an alert feed talking to an assistant that answers is a loop waiting to happen. Pass `--allow-bots` to deliver them in one channel — the Sentry, deploy or CI feed you actually want to see.

```
/discord:access group add 846209781206941736 --no-mention --allow-bots
```

`--allow-bots` is orthogonal to `requireMention`: an alert bot never @mentions anyone, so an alert channel wants both flags. `--allow` applies to bots too, so `--allow <sentry-bot-id> --allow-bots` delivers Sentry and nothing else. The bot's own messages are never delivered, and DMs from bots are always dropped.

Bot-authored messages arrive with `author_is_bot="true"` and get no typing indicator and no ack reaction — those are for a human waiting on an answer.

### Reactions

Emoji reactions are not delivered unless a channel opts in with `--reactions`. A 👍 on an answer is often the whole reply, and without this the assistant never sees it.

```
/discord:access group add 846209781206941736 --no-mention --reactions
```

`requireMention` narrows reactions the same way it narrows messages: with it on (the default), only reactions on messages the bot itself sent are delivered; with `--no-mention`, every reaction in the channel is. The channel's `--allow` list and the `--allow-bots` rule apply to the reacting user as well. Reactions arrive as `<channel ... event="reaction" reaction="👍" message_id="..." on_own_message="true">`. Reactions in DMs are not delivered — there is no per-channel policy to opt in with.

## Mention detection

In channels with `requireMention: true`, any of the following triggers the bot:

- A structured `@botname` mention (typed via Discord's autocomplete)
- A reply to one of the bot's recent messages
- A match against any regex in `mentionPatterns`

Example regex setup for a nickname trigger:

```
/discord:access set mentionPatterns '["^hey claude\\b", "\\bassistant\\b"]'
```

## Delivery

Configure outbound behavior with `/discord:access set <key> <value>`.

**`ackReaction`** reacts to inbound messages on receipt as a "seen" acknowledgment. Unicode emoji work directly; custom server emoji require the full `<:name:id>` form. The emoji ID is at the end of the URL when you right-click the emoji and copy its link. Empty string disables.

```
/discord:access set ackReaction 🔨
/discord:access set ackReaction ""
```

**`replyToMode`** controls threading on chunked replies. When a long response is split, `first` (default) threads only the first chunk under the inbound message; `all` threads every chunk; `off` sends all chunks standalone.

**`textChunkLimit`** sets the split threshold. Discord rejects messages over 2000 characters, which is the hard ceiling.

**`chunkMode`** chooses the split strategy: `length` cuts exactly at the limit; `newline` prefers paragraph boundaries.

**`suppressEmbeds`** (default `true`) strips Discord's link preview cards from outbound messages. A reply with ten PR links renders as ten preview boxes otherwise. The `reply` tool's `suppress_embeds` parameter overrides it per message.

## Batching inbound messages

Every delivered message is a turn of the assistant's session, so a channel where people talk to each other costs a turn per line — twenty-four messages in twenty minutes is twenty-four turns, none of them addressed to the bot. Batching holds a chat's messages and delivers a burst as one event.

Off by default. Turn it on with a quiet window in milliseconds:

```
/discord:access set batchQuietMs 20000
/discord:access set batchMaxMs 60000
/discord:access set batchMentionQuietMs 5000
```

A chat's messages are held until it has been quiet for `batchQuietMs`, or `batchMaxMs` after the first message held, whichever comes first. Buckets are per chat — a channel, a thread and a DM each hold on their own and never merge. `batchMaxMs` defaults to three times the quiet window; setting `batchQuietMs` back to `0` restores one event per message.

A message that addresses the bot — an @mention, a reply to one of its messages, a `mentionPatterns` match, or any DM — switches its chat to the shorter `batchMentionQuietMs` and takes the messages held before it along, so the assistant gets the question with the conversation that led to it. With `batchMentionQuietMs` absent or `0`, the flush is immediate, which is what an unbatched channel does today.

Reaction events (`--reactions`) are held in the same bucket, so a 👍 and the message it followed keep their order. A reaction on one of the bot's own messages counts as addressing it, the same as an @mention.

Ack reactions and the typing indicator still fire when each message arrives, not when the batch is delivered — the sender sees the bot has read them.

A batch arrives as one `<channel batch="true" message_count="4" …>` tag holding one `<message>` per message:

```
<channel source="discord" chat_id="846209781206941736" channel_name="product" message_id="…" ts="…" mentions_bot="true" batch="true" message_count="2">
<message message_id="1547…" user="teammate" user_id="184…" ts="2026-09-15T09:38:41Z" mentions_bot="false">
shipping the redesign today
</message>
<message message_id="1547…" user="owner" user_id="221…" ts="2026-09-15T09:38:51Z" mentions_bot="true">
@claude what's left on it?
</message>
</channel>
```

Attributes describing the chat (`chat_id`, `channel_name`, `thread`, `parent_id`) sit on the `<channel>` tag; everything about a single message stays on its `<message>`, so `reply_to`, `react` and `download_attachment` still have a real id to work with. The `<channel>` tag's own `message_id` and `ts` are the newest held message's, and its `mentions_bot` is true when any held message addresses the bot. A chat holding one message delivers exactly as it does with batching off — no `batch` attribute, no `<message>` wrapper.

Held messages are flushed when the server shuts down. A kill that skips shutdown loses them from the session, not from Discord — `fetch_messages` reaches them.

## Skill reference

| Command | Effect |
| --- | --- |
| `/discord:access` | Print current state: policy, allowlist, pending pairings, enabled channels. |
| `/discord:access pair a4f91c` | Approve pairing code `a4f91c`. Adds the sender to `allowFrom` and sends a confirmation on Discord. |
| `/discord:access deny a4f91c` | Discard a pending code. The sender is not notified. |
| `/discord:access allow 184695080709324800` | Add a user snowflake directly. |
| `/discord:access remove 184695080709324800` | Remove from the allowlist. |
| `/discord:access policy allowlist` | Set `dmPolicy`. Values: `pairing`, `allowlist`, `disabled`. |
| `/discord:access group add 846209781206941736` | Enable a guild channel. Flags: `--no-mention`, `--allow id1,id2`, `--allow-bots`, `--reactions`. |
| `/discord:access group rm 846209781206941736` | Disable a guild channel. |
| `/discord:access set ackReaction 🔨` | Set a config key: `ackReaction`, `replyToMode`, `textChunkLimit`, `chunkMode`, `suppressEmbeds`, `mentionPatterns`, `batchQuietMs`, `batchMaxMs`, `batchMentionQuietMs`. |

## Config file

`~/.claude/channels/discord/access.json`. Absent file is equivalent to `pairing` policy with empty lists, so the first DM triggers pairing.

```jsonc
{
  // Handling for DMs from senders not in allowFrom.
  "dmPolicy": "pairing",

  // User snowflakes allowed to DM.
  "allowFrom": ["184695080709324800"],

  // Guild channels the bot is active in. Empty object = DM-only.
  "groups": {
    "846209781206941736": {
      // true: respond only to @mentions and replies.
      "requireMention": true,
      // Restrict triggers to these senders. Empty = any member (subject to requireMention).
      "allowFrom": [],
      // Deliver other bots' and webhooks' messages in this channel. Absent = false.
      "allowBots": false,
      // Deliver emoji reactions as events. Absent = false.
      "reactions": false
    }
  },

  // Case-insensitive regexes that count as a mention.
  "mentionPatterns": ["^hey claude\\b"],

  // Reaction on receipt. Empty string disables.
  "ackReaction": "👀",

  // Threading on chunked replies: first | all | off
  "replyToMode": "first",

  // Split threshold. Discord rejects > 2000.
  "textChunkLimit": 2000,

  // length = cut at limit. newline = prefer paragraph boundaries.
  "chunkMode": "newline",

  // Strip link preview cards from outbound messages. Absent = true.
  "suppressEmbeds": true,

  // Hold a chat's messages until it has been quiet this long, then deliver
  // them as one event. 0 or absent = one event per message.
  "batchQuietMs": 20000,

  // Ceiling on a hold, from the first message held. Absent = 3x batchQuietMs.
  "batchMaxMs": 60000,

  // The window used instead once a held message addresses the bot.
  // Absent = 0, delivering at once.
  "batchMentionQuietMs": 5000
}
```
