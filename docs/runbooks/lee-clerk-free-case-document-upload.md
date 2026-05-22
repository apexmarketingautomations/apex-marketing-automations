# Lee Clerk Free Case Document Upload

This is the practical path for **free** Lee Clerk court-case documents while we keep building the deeper automation.

It works when:

- you have a **Lee Clerk CRI** account or public access to the case
- the traffic/criminal-traffic case has a downloadable document
- you know the **case number** or **citation number**
- or you know the **Apex crash report id**
- you know which **crash report id(s)** in Apex should receive the document

## What This Does

1. Opens [Lee Clerk CRI](https://matrix.leeclerk.org/)
2. Auto-fills the traffic case search
3. Attempts the search automatically
4. If Akamai blocks the automated submit, the script re-fills the form and lets you click Search manually
5. Apex either watches the browser download **or captures the visible case text**
6. The file/text is uploaded into the existing `police_report_documents` lane
7. The chosen crash report(s) are linked to that stored artifact immediately

## Why This Is Useful

It gets us off the “wait for FLHSMV” treadmill and lets us use the **free Lee Clerk document lane** today, without pretending we already know every CRI screen and selector perfectly.

## Required Inputs

- `CASE_NUMBER`
- or `CITATION_NUMBER`
- or `CRASH_REPORT_ID`
- `SUB_ACCOUNT_ID`
- `CRASH_REPORT_IDS`

## Run

```bash
CASE_NUMBER="24-TR-012345" \
SUB_ACCOUNT_ID="3" \
CRASH_REPORT_IDS="12345,12346" \
STANDALONE_ADMIN_SECRET="<your secret>" \
RAILWAY_URL="https://apexmarketingautomations.com" \
node scripts/lee-clerk-watch-upload.mjs
```

Or:

```bash
CITATION_NUMBER="A1234567" \
SUB_ACCOUNT_ID="3" \
CRASH_REPORT_IDS="12345,12346" \
STANDALONE_ADMIN_SECRET="<your secret>" \
RAILWAY_URL="https://apexmarketingautomations.com" \
node scripts/lee-clerk-watch-upload.mjs
```

Or search from an existing Apex crash row:

```bash
CRASH_REPORT_ID="12345" \
CRASH_REPORT_IDS="12345" \
STANDALONE_ADMIN_SECRET="<your secret>" \
RAILWAY_URL="https://apexmarketingautomations.com" \
node scripts/lee-clerk-watch-upload.mjs
```

## What To Click

After the script opens the browser:

1. Sign into CRI if needed
2. If the automated search succeeds, review the candidate results the script searched for
3. If Akamai blocks the automated submit, click **Search** manually in the already-filled form
4. The script will print any case-number candidates it can extract from the visible page text
5. Open the actual report document you want
6. Either click download, or leave the case page open for text capture

The script will ask whether you want:

- `d` = wait for a downloaded file
- `t` = capture the visible page text and reformat it into a stored `.txt` artifact

## Storage Key

The script stores the file under a synthetic document key:

`LEE-CRI:<caseNumber>`

That key is internal to Apex. It exists so Lee Clerk documents can use the same durable storage lane as FLHSMV-derived PDFs.

## Notes

- This route is for **case documents**, not guaranteed official FLHSMV crash PDFs
- Text capture is useful when the report content is visible on the page but the site makes downloading awkward
- The best use is when the case includes the officer narrative, citation packet, crash attachment, or similar
- If the wrong file is downloaded, decline the upload prompt and try again
