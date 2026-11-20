# NeuroBuddy: ideas for neurodiverse-friendly working

The guide is the original chat. Its core points:

- To-do lists in the inbox get ignored. A device in front of you that asks for one tap does not.
- Putting something off should be a decision you make on purpose, not something that just happens.
- The real blocker is often the pile of hurdles in front of a task, not the task itself (the Yanis email had five).
- "Bad brain day" is a legitimate answer.
- A deadline is a motivator, and the brain only takes it seriously once it feels real.
- When something stalls, start a conversation about it rather than adding more nagging.

Each idea below says where it comes from, how it would work on the desk phone, and roughly what it costs to build.

---

## 1. "Send it ugly": sorting the hurdles  ★ build first

**From:** the Yanis email. Five self-set hurdles stood between you and one email.
**How:** when a card's steps have been skipped twice, the app stops offering the next step. Instead it deals out the steps one at a time and asks **"Needed before you send?"** for each.
Swipe right means needed. Left means it can come later: the app moves it to a "Later" checklist and words it as a promise ("search site coming next week").
It ends with **"Send it now with what's ready?"**
**Why it fits:** it attacks perfectionism gating directly. It's still the same yes/no interaction.
**Cost:** small. Pure app logic plus one Trello checklist.

## 2. Transition runway

**From:** "time to switch tasks, or get ready to switch task".
**How:** the clock gives you a soft lead-in before a meeting or the end of a time block. Ten minutes before, the linear bar shows the meeting as a coloured block and the words clock says "meeting at half past". Five minutes before, a single card appears: **"Park it: one line on where you got to?"** That line is saved as a comment on the task, so picking it back up is easy.
**Why it fits:** time blindness and costly task switching. Leaving a note for future-you removes the "where was I" cost.
**Dan's add (20 Nov):** a linear timer counting down to the meeting, like the task strip.
**Cost:** medium. Needs your calendar: a small job on outsee2, next to the digest, copies today's meetings into a hidden Trello card.

## 3. Done wall and the weekly list for Alex

**From:** "write weekly TODOs for Alex", and the feeling that a day vanished.
**How:** at 17:30 the clock shows today's ticks as a list: **"Today you did: …"**. On Friday, one card shows the week's done list next to next week's top cards and asks **"Send this to Alex?"** One tap sends it. The digest on outsee2 already sends email.
**Why it fits:** completed work becomes visible, which counters "I did nothing". Telling Alex is accountability to a person, and that works better than self-set deadlines.
**Cost:** small for the done wall. Medium for sending email.
**Dan's steer (20 Nov):** make the Friday review an email you pick up in a Claude session. The loop closes through Trello: that session reads the email, talks it through with you, then edits the board (new cards, deadlines, checklists, a "next week" list). The phone just reads Trello, so it acts on the review's results with no extra plumbing.

## 4. Focus sprint with a body double

**How:** "Do it" on a card offers **15 / 25 / 45 min**. The linear bar becomes that sprint, draining from full to empty. A soft pulse halfway through shows it's still running. At the end you get one tap: **"Flowing / Done / Stuck"**. "Flowing" quietly extends the sprint. Hyperfocus is fine, so it never interrupts it.
**Why it fits:** starting a task is easier with a visible container around it. The bar acts as a quiet companion, a "body double".
**Cost:** small.

## 5. Interest-based picker (bad-brain-day menu)

**From:** "Or just, okay, it's a bad brain day, let's do something completely different."
**How:** saying yes to "bad brain day" doesn't just skip the card. It asks **"What would help: something quick / something new / something urgent / something fun?"** Then it offers a matching card from a "menu" of easy wins tagged with Trello labels (e.g. tidy one folder, reply to one email, read one paper abstract).
**Why it fits:** ADHD runs on interest, novelty, challenge and urgency rather than importance. A planned menu of easy wins beats doom-scrolling.
**Cost:** small. Just labels and a list.

## 6. Capture from anywhere

**From:** the paper notebook ("WRITE WEEKLY TODOs FOR ALEX"), and voice chats in the car.
**How:** every Trello board has its own email address, and any email sent to it becomes a card. So "Claude, add 'email Yanis' to my board" works from the car in voice mode, because the Claude app can already send email. A photo of a notebook page sent to the same address lands as a card too. Later, Claude could split a photo into separate cards.
**Cost:** no code. Just copy the board's email address.

## 7. Thread radar

**From:** the T3 Code / Claude Code status worry in the chat.
**How:** the outsee2 digest already gathers recent Claude sessions. A card appears for any thread that's been waiting on you for more than a day: **"'neurobuddy' has been waiting on you since Tue. Reply, settle, or drop?"**
**Why it fits:** open loops cause background anxiety. Showing one at a time, with a decision attached, closes them.
**Cost:** medium. Needs the outsee2 job and a way to settle a thread.

## 8. Stall conversations

**From:** "When things don't make progress, we queue up a conversation about what's going on and what the real issues are."
**How:** each week Claude reads the swipe log and the Trello comments. For any card skipped five or more times, it writes a single honest question onto the card, for example: *"You've skipped 'review benchmark literature' 9 times. Is it unclear, boring, or not actually needed?"* The phone shows it as a card with **"Talk it through"**. That puts the question in your inbox, ready to open in Claude voice mode on the drive home.
**Why it fits:** a pattern you've repeated becomes a conversation, not more guilt.
**Cost:** medium. Needs the swipe log uploaded (or kept in Trello) and a weekly Claude run.

---

## My pick

1. **Send it ugly (1)**: small, and aimed straight at the pattern from your own example.
2. **Focus sprint (4)**: small, and it makes the linear clock earn its place.
3. Then the **calendar runway (2)**, because calendar access already exists on outsee2.

**Capture (6)** costs nothing, so do it this week whatever you choose.
