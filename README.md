# LotBoss

Measure parking lots from satellite, price sealcoat, crack fill and striping jobs with your real costs, and send professional quotes.

## Putting it online (free, GitHub Pages)

1. In GitHub Desktop: **File → Add local repository**, pick this `lotcalc` folder, and publish it as a new repository named `lotcalc`. It has to be **public** for free GitHub Pages. That's safe: the key in the code is Supabase's public key, and the database only lets each company see its own data.
2. On github.com, open the repo, then **Settings → Pages**. Under "Build and deployment" pick **Deploy from a branch**, branch **main**, folder **/docs**, and click Save.
3. After a minute or two the app is live at `https://darrenruth2-sys.github.io/lotcalc/`.
4. In Supabase (the project the bots use): **Authentication → URL Configuration → Redirect URLs → Add URL** and add `https://darrenruth2-sys.github.io/lotcalc/`. This makes the sign-up confirmation and password-reset emails send people back to LotBoss instead of Ashvale.
5. On your phone, open the link and add it to your home screen (iPhone: Share → Add to Home Screen. Android: menu → Install app).

## What's in it

- Sign in, create a company or join one with an invite code. Owners, admins, estimators and crew each see what they should (crew never sees wages or profit).
- Satellite map: find the lot by name or address, or use GPS. Tap to draw sealcoat areas (and skip islands), cracks, stall rows (stalls counted at your stall width, single or double lines), paint lines, hash zones and stencils.
- Layout designer (Map tab > Design the layout): outline the lot with Area, mark islands/buildings as "Skip it", drop a Door marker on the main entrance, and it lays out 90° stall rows with two-way drive aisles and end lanes, the ADA-required number of accessible and van spaces (2010 ADA table) with access aisles centered on the door, arrows, and wheel stops (none / ADA / every space). It tries every direction and keeps the one that fits the most cars. Live preview with counts; change stall size, aisle width, curb setback, or turn the rows 90°. One tap puts it on the map and in the estimate (replacing any rows you hand-drew); run it again to redo, or remove it.
- Estimate: sealcoat with tank mix, crack filler boxes, paint by color, stencils, ADA spaces (2010 ADA table) with signs and aisles, wheel stops, crew wages and burden, equipment, overhead, minimum job price, discount, tax, profit and margin, days on the job.
- Quote: professional quote with scope of work (no costs shown), numbered and saved, print/PDF, email, text or copy.
- Good / Better / Best: give the customer up to 3 options (for example 1 coat, 2 coats + cracks + lines, 3 coats). You choose what's in each and which one is recommended.
- Customer sign-off link: each saved quote gets a private link. The customer opens it on their phone (no account), picks an option, signs with a finger and accepts, or declines with a reason. The job turns Won at the price they picked, and you see who signed, when, and their signature. Old links point to the newest quote; quotes expire after 30 days (change it in Settings).
- Weather: 14-day forecast on every job with a go / risky / no-go call for each day, based on what the job is (sealcoat needs 50°F and 24 hours dry after, striping 50°F, crack fill 40°F, plus rain and wind). Tap a good day to schedule it. The schedule flags booked jobs with bad weather. Your own rules are in Settings. Forecast from Open-Meteo (free, no key).
- Photos: before / after / damage photos on each job, with notes. Shrunk to about 250 KB each, stored privately so only your company sees them. Crew can add photos but only delete their own.
- Invoices and getting paid (Money tab, office only): bill the whole job, or ask for a deposit first and bill the rest later. The final bill subtracts the deposit, so they always add up to the job price. Record checks, cash, card or bank payments (no overpaying, no future dates). Invoices go late automatically after the due date (15 days, change it in Settings). Print / PDF, text or email. Void an unpaid invoice to redo it. The Jobs page shows what you're owed and what's late; tap it for the Money page.
- Job wrap-up: after the job, put in each person's hours and what materials you really used (blank = same as estimated) plus any extra costs. You see real profit next to the estimate, line by line, and why it was off ("crew took 13% longer", "used 10% more sealer"). Mark the job done to lock it in.
- Learns from your jobs: after 2+ finished jobs, Settings > Prices and rates suggests better production, coverage and waste numbers from what your crew really did. One tap to use them.
- AI photo check (Photos tab, office only): pick up to 4 photos and AI (Google Gemini, through our own Supabase function so the key never reaches a phone) reports the condition (good/fair/poor/failed), crack types and how many feet it can see, alligator cracking, potholes, oil spots, sealer and striping condition, what to quote, and what sealing won't fix. One tap puts crack footage, oil spot primer, sealcoat or restriping into the estimate. The answer is saved with the job.
- New job from an email (Jobs page > ✨ From an email): paste a customer's email, text or voicemail notes; AI pulls out the job name, customer, phone, email, lot address, what they want, size and deadline, and fills in a new job for you to check. Spam is flagged. Text inside the message can't give the AI orders.
- AI limits: 60 checks per company per day (keeps you inside Google's free tier). Needs the GEMINI_KEY secret in Supabase. The demo shows sample answers.
- Crew schedules: a week board (each person's jobs, day by day, with double-bookings outlined in red and days off shaded). Book people on a job from its Details tab and it shows who's free, busy (and on what) or off for those dates, and warns before you double-book. Days off per person in Settings > Crew. Tap ✉ to text someone their week. Link a crew member's login and they get "My jobs": just their own schedule, no prices or wages.
- Live calendars: each person (and the whole company) gets a private link their phone calendar subscribes to (iPhone, Google, Outlook). Jobs show up and update by themselves. No prices in it. Make a new link any time to cut off an old one. (Real accounts only; the demo can still download a calendar file.)
- Schedule: start date and days, add to phone calendar (.ics), text the crew the job details.
- AI outline the lot (Map tab > ✨ AI outline the lot): zoom so the lot fills the screen and AI traces the paved area from the satellite picture, plus islands and buildings to skip. You see it dashed first, then keep it or not.
- Follow-ups (Jobs page > Follow-ups today): one list of who to contact today. New website requests (call them while they're hot), quotes nobody answered (3 and 10 days; opened ones first), late payments (1, 14 and 30 days late), review requests after a job, and reseal reminders about 3 years later. Each has a ready-to-send message; tap Text or Email and it opens your own phone's app with it filled in (no texting service to pay for). Done, snooze or stop for that job.
- Review requests: put your Google review link in Settings > Company and the thank-you message includes it.
- Website quote form: turn it on in Settings > Company and share the link (or put it on your website). A customer finds their lot, outlines it, picks services and sees a price range right away (your rates never reach their browser; the price is worked out on the server). Sending it makes a lead on your Jobs list with their outline already measured. Bot checks and limits on how many requests one visitor can send.
- How customers pay you (Settings > Company): your own pay link (Square, Stripe, PayPal, etc.), Venmo, Cash App, Zelle and where to mail checks. They show on every invoice, printed or texted, as tappable links. No fees from us.
- QuickBooks export (Money page > For your accountant): invoices, payments and customers as spreadsheet files QuickBooks Online can import, for this year, last year or everything.
- Crew time clock (Schedule page): a crew member with a linked login taps Clock in at today's job; the phone's GPS records how far from the lot they were. Clock out at the end. In the job wrap-up, "Use time clock hours" fills in everyone's hours.
- Driveways (Calculators): price one driveway or a whole street at your homeowner rates (per sq ft, crack fill per foot, your own driveway minimum), text the price, or make it a job. Driveway jobs skip the commercial minimum job price.
- Calculators: driveways, sealcoat and tank mix, crack filler, paint, stalls in a row, ADA spaces.
- Settings: company info and logo, every price and rate, quote terms, crew and wages, team invites.
- Demo mode on the sign-in screen: try everything without an account (saved on that device only).

## Working on the code

```
npm install
npm test               # math + map tests
npm run build          # builds the app into docs/
npm run test:browser   # clicks through the whole app on phone + desktop sizes
npm run test:abuse     # tries to break it: hostile text, no signal, two people editing, 500 jobs, crew view, tiny phones
npm run test:ai        # AI photo check + job from an email (demo answers): pick limits, no signal, Cancel, crew blocked
npm run test:schedule  # week board, double-booking and day-off warnings, crew-only view, 28 crew x 120 jobs
npm run test:layout    # layout designer: lots of all shapes, islands, doors, junk options, every Cancel button
npm run test:money     # invoices, deposits, payments, wrap-up: walks through it and tries to break it
npm run test:attack    # quote options + customer sign-off attacks, switching companies mid-edit, 50 quotes
npm run test:follow    # follow-ups: who shows up, in what order, done/snooze/stop, review link
npm run test:webform   # website quote form as a customer: price, bad input, bots, no signal
npm run test:extras    # driveways, how-to-pay on invoices, QuickBooks files, time clock
npm run test:monkey    # random tapping/typing/reloading for 1,500 steps, checking every step
```

Source is in `src/`: `calc.js` (all the math), `money.js` (invoices, payments, wrap-up, learning), `layout.js` (parking layout designer), `crewplan.js` (who's on what, double-booking, days off), `followups.js` (who to contact today), `webquote.js` (website form pricing, also bundled into the lotcalc-web function by `node build-web.mjs`), `books.js` (QuickBooks files, how-to-pay, driveways), `geo.js` (map measuring), `mapview.js` (map drawing), `quote.js`, `store.js` (Supabase + demo storage), `main.js` (screens), `styles.css`. Database tables and security are in `supabase/schema.sql` (already applied to the bots' Supabase project).

## Known limits

- A crew member who knows how to use the database API directly could read the company's price settings. The app screens hide them, and wages and profit are fully locked down.
- Two people editing the same job at once get a warning and pick whose version to keep. There's no live merging.
- Tested in Chrome-engine browsers. Check it in iPhone Safari once it's live.

## Notes

- Satellite imagery is Esri World Imagery and address search is OpenStreetMap (Nominatim). Both are free for this kind of use. Before selling subscriptions, sign up for a free ArcGIS developer key so the imagery is properly licensed for commercial use.
- Satellite measurements are usually within a few percent. Double-check big numbers with a wheel.
- ADA counts follow the 2010 ADA Standards. Cities and states can add rules, so check local code.
