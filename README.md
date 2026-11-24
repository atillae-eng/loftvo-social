# loftvo-social

LOFTVO Instagram card renderer. One JSON file in, finished Instagram images out:

| `type` | Output |
|---|---|
| `daily` | `01_card.jpg` (1080×1350) and `story.jpg` (1080×1920) |
| `weekly` | `01_cover.jpg`, one slide per story, `NN_end.jpg` (1080×1350) and `story.jpg` |

Every run also writes `caption.txt` and `alt.txt`. All images are JPEG, the only
format Instagram's publishing API accepts.

## Run

```bash
npm install
npm install playwright          # only on a computer that does not have it yet
npx playwright install chromium # same
node render.js examples/daily.json out/daily
node render.js examples/weekly.json out/weekly
```

## Content rules (checked by `render.js`)

- `region` ≤ 28 characters, `stat` ≤ 6 characters (`16%`, `3.75M`, `2029`)
- `statLabel` ≤ 100 characters, reads on from the number
- `facts`: exactly 3, each ≤ 70 characters
- `source` starts with `Source:` or `Sources:`, names the publisher, the outlet and the date, ≤ 110 characters
- `caption` ≤ 2,200 characters and at most 5 hashtags (Instagram's limit)
- `altText` ≤ 300 characters
- weekly: 3 to 5 slides

If a field is too long, or text runs into the next block on the card, the script
prints what to shorten and exits with code 1.

## Where the images go

Upload the JPEGs together with `caption.txt` at <https://www.loftvo.com/admin/social>.
Approved posts are published automatically at their scheduled time.

This repository holds no keys, passwords or customer data, and never should.
