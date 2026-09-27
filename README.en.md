# Xtags

English | [简体中文](README.md)

See what each post on your X timeline wants you to do. By default, Xtags uses [Jev](https://docs.typesafe.ai/), a TypeSafe model that returns structured judgments and probabilities rather than generated explanations.

![Xtags in use: an intent label appears next to a post](store/assets/screenshot-labels-original.png)

*Actual screenshot provided by the author, with the UI in Simplified Chinese. The red arrow points to the intent label. Its score predates the 0.1.8 criteria update and may differ when judged again. AI estimates can be incorrect.*

## Install

1. Download and extract the extension package, or use this repository's `extension/` directory.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted directory containing `manifest.json`.
4. Open the Xtags popup, click **Settings**, read the data notice and privacy policy, check the acknowledgement and click **Agree and enable**. Enter an API key for your selected service ([TypeSafe by default](https://console.typesafe.ai/settings/keys)). To use a compatible third-party service, first save its full HTTPS API URL and grant access to its host, then consent to that destination.
5. Open or refresh an X page.

After updating an unpacked extension, reload it on the extensions page and refresh any open X pages.

## Language

The default **Auto (system)** setting follows Chrome's UI language: Chinese locales use Simplified Chinese; all other locales use English. The popup's **Language** menu lets you choose **中文**, **English**, or switch back to automatic selection.

Your choice is saved locally and immediately updates labels, tooltips, the status panel, and extension error messages on open X pages. Switching languages does not clear cached probabilities, cancel active judgments, or trigger new API requests. Chrome controls the language of the extension description in its management UI.

## Labels and settings

Every classified post receives one intent label: **Inform**, **Persuade**, **Provoke**, **Sell**, **Entertain**, or **Other**. The number beside it is the probability of that intent.

Three additional signals appear when they meet the selected threshold:

- **Rage bait**
- **Undisclosed ad**
- **Machine-generated**

Version 0.1.8 narrows the judgment criteria: forceful criticism or a missing citation alone does not imply rage bait; polished wording in a short post does not establish machine generation; and undisclosed promotion is estimated from the text without claiming an actual payment or partnership. Older judgments are invalidated and revisiting posts may make new API requests.

Collapsed long posts are classified using the full text already present in X's page data, before you click **Show more**. If the full text is temporarily unavailable, Xtags displays **Full text unavailable** instead of classifying the preview. It retries three times automatically, then tries again when the page changes or the post is expanded. This update requires renewed data-transfer consent in Settings and invalidates old preview-based cache entries.

The threshold accepts values from 0 to 1 and only affects these signals. You can also skip replies, show all signal probabilities, hide the status panel, pause processing, or clear the cache.

## Reliability and privacy

- Post text and the author's handle are sent to the selected API service (TypeSafe by default) for classification. Your API key is stored in `chrome.storage.local` and sent only as authentication to the selected API service; it is not synced to a browser account. Persistent storage is restricted to trusted extension contexts. X-page content scripts receive only sanitized settings and a key-present flag. Local storage is not encrypted.
- The background worker owns the persistent cache and deduplicates requests by post ID and content fingerprint across tabs. Changed text is classified again, and responses are rebuilt from an allowlist before returning or caching them. The persistent cache stores neither raw text nor extra debug fields. It is limited to 3,000 entries / 2 MiB and writes only changed records. At most three requests run concurrently. Labels track their post ID when the timeline reuses DOM nodes.
- Pausing stops queued requests and attempts to abort active ones. Requests already received by the provider may still incur charges.
- Each attempt has a 20-second timeout. Network errors, HTTP 429, and server errors receive up to three attempts. After those attempts are exhausted, transient failures can start two further rounds after 15 and 60 seconds (up to nine total API attempts). Reconnecting can trigger a remaining round early. Authentication, permission and response-format errors are not automatically retried. The popup shows the last API status and provides Retry failed posts. Changing the text or fixing the key also permits retrying; pausing cancels recovery timers.
- Queued posts are revalidated against their current main body, author and reply setting. Each page queue is capped at 100 entries. Removed or changed posts release their background requests, while other tabs can continue sharing the same job. Quote-only text is never assigned to an outer author.
- **Pause and clear cache** in Settings waits for deletion, retains your key and leaves processing paused until you enable it again. Failed preference writes restore the saved controls and show an error.
- Labels follow the actual page theme and support focus, Enter/Space, click and Escape for their details. Intent and probability remain visible.
- Language and threshold changes reuse raw cached probabilities. Cache versions are incremented when the response format or classification criteria change, so judgments made with older questions are rebuilt.
- There is no analytics or telemetry. Counters are held in the current tab's memory. Only controlled status/error codes, HTTP status and the latest request time are kept in temporary session storage; provider error bodies are not retained. Cost estimates exclude other tabs and any charges from failed requests.

AI labels can be wrong. They are predictions about text, not established facts about a person or a post. This project is independent and not affiliated with, authorized, or endorsed by X Corp. It is intended for personal browsing assistance. Review the [usage notice](README.md) and [MIT license](LICENSE).

## Development and tests

Node.js 20+ is required. The extension requires Chrome 140+ for restricted local storage access. Browser tests also need Chrome or Chromium; no npm dependencies are needed.

```bash
npm test
npm run test:browser
```

Set `CHROME_BIN` if your browser is installed outside a default location. Tests use a separate temporary browser profile and mocked APIs; they do not use a real key or incur API charges. They do not replace end-to-end testing on the live X site.

## Chrome Web Store preparation

See [submission materials](store/README.md) for listing copy, artwork, permission explanations, reviewer instructions and remaining checks. The [English privacy policy](https://manifoldor.github.io/xtags/privacy.html), [Chinese policy](https://manifoldor.github.io/xtags/privacy.zh-CN.html) and [support page](https://manifoldor.github.io/xtags/support.html) are published from `docs/` on the `main` branch. See the [0.1.9 release notes](store/RELEASE_NOTES_0.1.9.md). Rebuild the candidate package with `python3 scripts/package-store.py`. Live testing and reviewer access preparation remain before submission.

Version 0.1.3 adds a prominent data-transfer notice, explicit opt-in and withdrawal. Both new and existing installations require current consent before classification. English and Chinese privacy policies are bundled for offline access.

Version 0.1.4 moves disclosure, consent, API key configuration, cache clearing and version information to a dedicated Settings page. Open it from the popup or Chrome’s extension options. The compact popup keeps language, pause/resume, threshold and display controls. Changes synchronize between both pages.

Version 0.1.5 adds custom HTTPS API endpoints. TypeSafe remains the default. Custom providers must support the TypeSafe System One request/response format; OpenAI chat APIs are not supported. Saving a different URL clears the old key and cache, pauses processing and requires consent to the new destination. Configure a key issued for that service. Custom hosts are authorized individually.

Version 0.1.8 refines the existing criteria without changing the label categories, classifies collapsed long posts from their full text before expansion, and restricts the API key to trusted extension contexts. Existing users must renew data-transfer consent. Chrome 140 or later is required.

Version 0.1.9 fixes quoted-text attribution and stale uploads, adds bounded recovery from transient errors, limits and sanitizes provider responses, and improves theme contrast, keyboard details and save feedback. Clearing the cache now pauses processing first.
