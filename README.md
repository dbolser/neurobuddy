<img src="assets/icon.svg" width="64" height="64" alt="">

# NeuroBuddy

A desk clock for an old phone that pops up swipeable task cards from a Trello board.
Swipe right = do it, left = not now, up = deal something else (the task you were on waits
underneath; swipe down to swap back). Saying no walks through the card's checklist,
then asks about missing the deadline, breaking it down, or a bad-brain-day skip.

- `app/` – the web app (served by GitHub Pages), `npm test` runs the logic tests.
- First open: `<app url>#key=…&token=…&board=…` (stored on the device only).
- `phone/` – notes on the desk phone (Galaxy A20e) setup.
