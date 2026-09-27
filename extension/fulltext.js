/* Runs in X's page world so it can read the post data already attached to React. */
(() => {
  "use strict";
  const REQUEST = "xtags:fulltext-request";
  const RESPONSE = "xtags:fulltext-response";

  document.addEventListener(REQUEST, (event) => {
    const article = event.target;
    if (!(article instanceof Element) || !article.matches('article[data-testid="tweet"]')) return;
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (!/^\d{1,30}$/.test(request?.id) || !Number.isSafeInteger(request?.token)) return;
    const ownTime = [...article.querySelectorAll('a[href*="/status/"]')].find((a) => {
      if (!a.querySelector("time") || a.closest('article[data-testid="tweet"]') !== article) return false;
      for (let parent = a.parentElement; parent && parent !== article; parent = parent.parentElement) {
        if (parent.matches('[role="link"], [data-testid="quoteTweet"]')) return false;
      }
      return true;
    });
    if (ownTime?.getAttribute("href")?.match(/status\/(\d+)/)?.[1] !== request.id) return;

    let fiber = article[Object.keys(article).find((key) => key.startsWith("__reactFiber$"))];
    let text = null;
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      const tweet = fiber.memoizedProps?.tweet;
      if (String(tweet?.id_str ?? tweet?.rest_id) !== request.id) continue;
      const note = tweet.note_tweet;
      const candidate = note?.text ?? note?.note_tweet_results?.result?.text;
      if (typeof candidate === "string" && candidate.trim() && candidate.length <= 100000) {
        text = candidate.trim();
        break;
      }
    }
    article.dispatchEvent(new CustomEvent(RESPONSE, {
      detail: JSON.stringify({ token: request.token, id: request.id, text }),
    }));
  }, true);
})();
