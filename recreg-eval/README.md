# recreg evaluation kit

This kit measures whether recreg's presets hide what they should and leave everything
else visible. There is no model to train. You feed video titles into recreg's own
filtering code and count the results.

## Files
- `titles.csv`: 200 hand-written video titles with labels
  - `split`: `dev` (100 titles, for tuning keywords) or `test` (100 titles, for the final numbers)
  - `category`: gambling, alcohol, shopping, news, phobias, or none
  - `hard`: `yes` for difficult titles (no obvious keyword, changed spelling) and for trap titles
  - `trap_for`: titles that contain a word from that preset but should stay visible
    (for example, "Spider-Man: No Way Home official trailer")
- `adapter.mjs`: connects the measurement script to recreg's filtering code. It currently
  contains a stand-in matcher so the script runs out of the box.
- `measure.mjs`: the measurement script (Node 18 or newer)

## Steps
1. Put this folder inside the repo (for example, `eval/`).
2. In `adapter.mjs`, remove the stand-in code and import recreg's real presets and
   matching function instead. There is an example at the top of the file. Set
   `isStandIn` to `false`.
3. Run on the dev split while you tune keywords:
   `node measure.mjs --split dev`
4. When you are done tuning, run the test split once:
   `node measure.mjs --split test --out results.json`
5. Update the Evidence section on the website with the numbers and failure examples
   from `results.json`, then remove the "Example numbers" label.

## What the numbers mean
- caught: of the titles that should be hidden, the share that was hidden
- mistakes: of the titles that should stay visible, the share that was wrongly hidden
- precision: of the titles that were hidden, the share that should have been
- hard caught: how many of the difficult titles were caught
- traps hidden: how many trap titles were wrongly hidden

## Things to keep in mind
- Each preset has about 12 "should hide" titles per split, so one title moves the
  number by about 8 percentage points. Show counts next to percentages on the site,
  for example "11/12".
- Do not tune keywords after looking at the test results. If you do, the test numbers
  become inflated like the dev numbers.
- Labels were set by people, so judgement can differ. Have two teammates review them
  separately and note any titles you disagree on.
- All titles are in English and were written by us. State this as a limitation, since
  real feeds are messier.
- Numbers from the stand-in matcher are not recreg's numbers. Never use them in the
  pitch or on the site.
