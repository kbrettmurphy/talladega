# Talladega family reunion

Responsive, buildless family planner with a Supabase database, private photo storage, and password-authenticated Edge Function.

## Development

Run `npm run dev` and open http://127.0.0.1:4173. Run `npm test` for date and shirt-count checks. The local preview uses the real backend. Do not enter demonstration records into the current reunion year.

## Access and data

One shared password grants access to the entire family's records. The server verifies a salted PBKDF2 hash and issues a signed 30-day session. Remembering a device stores the session, never the password. Locking the device removes its local session. Failed login attempts are limited per IP to 30 in 15 minutes. Password and service credentials are not included in browser assets.

All records are grouped by reunion year. Dates, campground, sites, people, meal assignments, shirt plans, and messages are editable. Arrival and departure are independent dates. Arrival belongs to the selected reunion year; departure may extend into the next year. Existing records without a departure keep their previously calculated date until edited.

People belong to a **crew**: whoever travels, camps, and cooks together, named after the grown-ups (e.g. "Mike & Lisa"). It is stored in the record's `family` field. Meals are claimed by crew. Each meal records `addedBy` (who first put it in the plan, kept on later edits) and `by` (who last changed it), using the device's "Who's this?" name; meals saved before October 11, 2026 have no names. Each device can remember who is using it ("Who's this?", saved in localStorage only) to fill in chat names and default meal crews. It is a convenience, not an identity check; everyone shares the one family password.

The interface follows iOS conventions: bottom tab bar on phones, grouped lists, and bottom sheets for editing. Light and dark mode follow the device setting unless overridden in Settings (stored per device). The meal planner starts with arrival dinner, three meals on intermediate days, and no departure-day meals. Any breakfast, lunch, or dinner can be added or removed on any trip date. Changing dates preserves assignments against their old dates. Data is refreshed after edits and with the Refresh plans button; simultaneous edits to the same record use the last saved edit.

Photos are private and accessed through the authenticated API. Before upload, the browser decodes each photo (including iPhone HEIC), scales its long edge to at most 2560 px, and re-encodes it as JPEG at 85% quality, which also strips location metadata; the server still accepts only JPEG/PNG/WebP up to 10 MB. Safari decodes HEIC natively; other browsers lazy-load `dist/vendor/heic2any.min.js` (heic2any 0.0.4, MIT, bundling libheif under LGPL-3.0) only when a HEIC file is picked. The album has its own year chips, so past years can be browsed without switching the planner, and photos can be uploaded to any year from 2000 on (an empty trip record is created for a new year so it appears in the list). Shirt orders export as CSV. The Shirts tab also holds a design vote: anyone can upload candidate designs (stored as photos flagged `candidate`, kept out of the album), and each "Who's this?" name gets one vote per year (`vote` records, ID derived from the lowercased name, so voting again switches it). Removing a design removes its votes. Like chat names, votes rely on the honor system. Lincoln weather is fetched from Open-Meteo in Fahrenheit for dates within its forecast window. The Home hero embeds Eric Church's "Talladega" video from YouTube. It loads only after sign-in, autoplays muted and loops (browsers block autoplay with sound), and pauses while another tab is showing; the speaker button turns sound on. YouTube refuses this video on pages served from a bare IP, so preview locally at http://localhost:4173 rather than 127.0.0.1.

## Deployment

The site is hosted on **Cloudflare Pages**, connected to this GitHub repository. Every push to `main` publishes `dist/` automatically (no build command; output directory `dist`). `dist/_headers` sets response headers on Cloudflare Pages. The murphsmitts.com zone lets browsers cache `.css` and `.js` files for hours, so `index.html` links the stylesheet as `/style.css?v=<build>`: **whenever `style.css` changes, bump the build value in both the `<meta name="build">` tag and that `?v=`** so phones fetch the new styles right away.

The Edge Function source is `supabase/functions/reunion-api/index.ts`; `supabase/schema.sql` records the initial schema. Tables deny access to anonymous/authenticated browser roles. Only the Edge Function uses the server-side Supabase service credential, after verifying the family session. The function only accepts browser requests from the origins listed in `origins` at the top of that file; serving the site from a new hostname requires adding it there and redeploying the function.

To deploy backend changes (requires `npx supabase@2 login` once, with the account that owns the project):

```sh
npx supabase@2 functions deploy reunion-api --project-ref sdfleesxvattrwcsavqc --no-verify-jwt --use-api
```

Keep `--no-verify-jwt` (also set in `supabase/config.toml`): the browser does not send a Supabase JWT, so enabling verification would reject every request. Deploy the backend before pushing front-end changes that depend on it.

`.openai/hosting.json` is left over from the original ChatGPT Sites deployment and is not used by Cloudflare Pages.

The password is delivered separately to the organizer. To set or rotate it, run `node scripts/set-password.mjs` locally and paste the printed SQL into the Supabase SQL editor. Existing signed sessions last up to 30 days; rotate the session-signing mechanism if immediate global revocation is required. No account password belongs in source control.

Custom domain: https://talladega.murphsmitts.com (see `CLOUDFLARE-DNS.md`).
