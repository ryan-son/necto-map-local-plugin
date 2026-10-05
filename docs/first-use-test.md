# First-use test

[한국어](first-use-test-ko.md)

Walking the [recipes](recipes.md) proves the panel does what the docs say. It cannot show
where someone who has never seen the panel gets stuck, because whoever walks them already
knows the way. This test does: hand the panel to someone new, give them tasks without the
docs, and watch.

Run it before a release that changes the panel, and after any change to how a task is done.
Record each run in [verification-log.md](verification-log.md).

## Setup

- **Tester:** an iOS developer or QA engineer who has used Necto but not Map Local. One is
  enough to find the worst problems; three find most of them.
- **App:** an app the tester knows, with a list screen backed by a JSON request that takes a
  page query, running on a simulator with Map Local registered and Necto's network plugin
  after it ([Capturing real responses](usage.md#capturing-real-responses)).
- **Start state:** Map Local on, no allowed hosts, no rules. The simulator on the left, Necto
  with the Map Local panel open on the right.
- **Facilitator:** reads the tasks, keeps the clock and takes notes. Does not explain or point.
  After three minutes stuck on one task, gives the smallest hint that unblocks it and notes it.
- **Ask the tester to think aloud:** what they are looking for, what they expect a control to
  do, and what surprised them.

## Tasks

Read each one as written. Do not name controls.

1. "Make the list screen show an empty list."
2. "Make the same screen show the error you get when the server fails with 500. Then bring
   the normal list back."
3. "Make that list take three seconds to load."
4. "Make only the second page show different data, and leave the first page as it is."
5. "Turn off everything you set up, so the app talks to the real server again."

## What to note for each task

| Note | How |
| --- | --- |
| Done | Yes, with a hint, or no |
| Time | From reading the task to the app showing the result |
| First move | What they clicked or looked at first |
| Hesitations | Each pause of five seconds or more, and where they were looking |
| Wrong turns | Clicks that did not help, and what they expected from them |
| Words | The words they used for things, where they differ from the panel's |
| Hint | The hint given, if any |

## After the tasks

Ask three questions and write the answers down as said:

1. Which task was the hardest, and why?
2. Where did the panel do something you did not expect?
3. What would you look for first next time?

## Reading the results

- A task more than one tester needed a hint for is a defect, not a training issue.
- A wrong turn two testers share points at a control in the wrong place or with the wrong
  name. Compare their words with the panel's.
- A pause in the same spot points at something missing there: a state, a reason or the next
  step.
- Fix by changing the panel first; a sentence in the docs is the last resort.

## Record template

Paste it under the release's `##` entry in [verification-log.md](verification-log.md).

```markdown
### First-use test — <date>, build <commit>

Tester: <role, Necto experience>. App: <kind of app, not its name>.

| Task | Done | Time | First move | Hesitations | Wrong turns | Hint |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Empty list | | | | | | |
| 2 Error 500 and back | | | | | | |
| 3 Three-second load | | | | | | |
| 4 Page 2 only | | | | | | |
| 5 Turn it all off | | | | | | |

Their words: <…>
Answers: 1 <…> 2 <…> 3 <…>
Defects found: <…>
```
