// ==================================================
// CONTENT.JS — Keyword Search & Highlight Engine
//
// Performance architecture:
//   1. TreeWalker (NodeFilter.SHOW_TEXT) — O(n) text scan, no element collection
//   2. Lazy highlight — viewport matches first, offscreen batched via rAF
//   3. removeHighlights() — unwrap individual <mark> tags, normalize only affected parents
//   4. Batch processing — 50 entries per frame, yields control to browser
//   5. All CSS transitions use background-color/box-shadow only — zero reflow
// ==================================================

(function() {
  'use strict';

  // ===== Guard against re-injection =====
  // When popup reopens, executeScript runs again but this guard
  // prevents duplicate listeners and state reset
  if (window.__kwHighlightLoaded) return;
  window.__kwHighlightLoaded = true;

  // ===== State =====
  // entries: Text node entries from TreeWalker
  //   [{ node, matches: [{ start, end, text, mark }], highlighted: bool }]
  let entries = [];
  // flatMatches: Flattened index for O(1) navigation
  //   [{ entryIdx, matchIdx }]
  let flatMatches = [];
  let totalMatches = 0;
  let currentFlatIdx = -1;
  let batchTaskId = null;       // rAF ID for batch processing
  let searchId = 0;             // Incremented per search — cancels stale batches
  let currentTerm = '';
  let currentCaseSensitive = false;

  // ===== Inject highlight CSS (idempotent) =====
  // PERFORMANCE: transition only uses background-color and box-shadow.
  // No width/height/padding changes — zero reflow on highlight activation.
  function injectStyles() {
    if (document.querySelector('style[data-kw-styles]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-kw-styles', 'true');
    style.textContent = `
      mark[data-hl="true"] {
        background-color: #FFD700;
        color: #000;
        border-radius: 2px;
        box-shadow: 0 0 4px rgba(255, 215, 0, 0.5);
        transition: background-color 0.2s ease, box-shadow 0.2s ease;
        padding: 0 1px;
        display: inline;
      }
      mark[data-hl="true"].kw-active {
        background-color: #FF6B35;
        color: #fff;
        box-shadow: 0 0 10px rgba(255, 107, 53, 0.7);
        outline: 2px dashed #fff;
        outline-offset: 1px;
        z-index: 9999;
        position: relative;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  // ===== Escape string for RegExp =====
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ===== Collect text nodes containing keyword via TreeWalker =====
  // PERFORMANCE: TreeWalker is dramatically faster than querySelectorAll('*')
  // because it traverses the DOM tree lazily without building an element collection.
  // It also skips elements we don't care about (SCRIPT, STYLE, INPUT, etc.)
  // via the filter function, reducing the traversal set.
  function collectTextNodes(term, caseSensitive) {
    const results = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escapeRegExp(term), flags);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tag = parent.tagName;

          // Skip non-content elements
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' ||
              tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip already-highlighted nodes (inside our <mark> tags)
          if (tag === 'MARK' && parent.hasAttribute('data-hl')) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip empty/whitespace-only text nodes
          if (node.nodeValue.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // Walk the tree and collect matches
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue;
      const matches = [];
      let m;

      // Reset regex state (global regex maintains lastIndex)
      regex.lastIndex = 0;
      while ((m = regex.exec(text)) !== null) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          mark: null  // Will be set when highlighted
        });
        // Guard against zero-length matches (theoretical edge case)
        if (m.index === regex.lastIndex) regex.lastIndex++;
      }

      if (matches.length > 0) {
        results.push({
          node: walker.currentNode,
          matches,
          highlighted: false
        });
      }
    }

    return results;
  }

  // ===== Highlight a single text node entry =====
  // Splits the text node and wraps each match in a <mark> element.
  // Matches are processed in REVERSE order (last match first) so that
  // earlier character indices remain valid after each splitText() call.
  //
  // splitText(offset) splits a text node at `offset`:
  //   - Original node keeps text[0..offset]
  //   - Returns new node with text[offset..end]
  //
  // By processing from the end, the "original node" always contains
  // the text before the current match, preserving earlier indices.
  function highlightEntry(entry) {
    if (entry.highlighted) return;
    if (!entry.node.isConnected || !entry.node.nodeValue) return;

    const node = entry.node;

    // Sort match indices by start position, descending (reverse order)
    const indices = entry.matches
      .map((_, i) => i)
      .sort((a, b) => entry.matches[b].start - entry.matches[a].start);

    for (const i of indices) {
      const match = entry.matches[i];

      try {
        // Split at match end → [before+match] [after]
        node.splitText(match.end);
        // Split at match start → [before] [match] [after]
        const matchNode = node.splitText(match.start);

        // Create <mark> wrapper
        const mark = document.createElement('mark');
        mark.setAttribute('data-hl', 'true');
        mark.className = 'kw-highlight';
        mark.textContent = matchNode.nodeValue;

        // Replace the match text node with the <mark> element
        node.parentNode.replaceChild(mark, matchNode);
        match.mark = mark;
      } catch (e) {
        // Text node may have been modified by page JavaScript
        console.warn('[KW Highlight] Failed to highlight match:', e);
      }
    }

    entry.highlighted = true;
  }

  // ===== Build flat match list for O(1) navigation =====
  // Entries are in document order (TreeWalker guarantees this),
  // and matches within each entry are in text order.
  // So the flat list is naturally in document order.
  function buildFlatMatches() {
    flatMatches = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = 0; j < entries[i].matches.length; j++) {
        flatMatches.push({ entryIdx: i, matchIdx: j });
      }
    }
    totalMatches = flatMatches.length;
  }

  // ===== Lazy Highlight: viewport first, then batch the rest =====
  //
  // PERFORMANCE STRATEGY:
  // 1. Check each text node's parent position via getBoundingClientRect
  // 2. If in/near viewport (±200px buffer): highlight immediately (synchronous)
  // 3. If offscreen: queue for batch processing via requestAnimationFrame
  //
  // This ensures the user sees results instantly for visible content,
  // while offscreen content is processed without blocking the main thread.
  // A page with 5,000 matches processes ~50 per frame, completing in ~100 frames
  // (~1.6 seconds at 60fps) with zero perceived lag.
  function lazyHighlight() {
    const viewportHeight = window.innerHeight;
    const viewportEntries = [];
    const offscreenEntries = [];

    for (const entry of entries) {
      const parent = entry.node.parentElement;
      if (!parent) continue;

      const rect = parent.getBoundingClientRect();

      // Check if element is in or near viewport (200px buffer for smooth scroll)
      const inViewport =
        rect.bottom > -200 &&
        rect.top < viewportHeight + 200 &&
        rect.width > 0;

      if (inViewport) {
        viewportEntries.push(entry);
      } else {
        offscreenEntries.push(entry);
      }
    }

    // Highlight viewport entries immediately (synchronous)
    for (const entry of viewportEntries) {
      highlightEntry(entry);
    }

    // Batch highlight offscreen entries
    batchHighlight(offscreenEntries);
  }

  // ===== Batch highlight using requestAnimationFrame =====
  //
  // Processes entries in small batches (50 per frame) to maintain 60fps.
  // Each frame: highlight 50 entries → yield to browser → next frame.
  // Checks searchId to cancel if a new search has started.
  function batchHighlight(entriesToProcess) {
    let idx = 0;
    const batchSize = 50;
    const currentSearchId = searchId;

    function processBatch() {
      // Cancel if a new search has started
      if (currentSearchId !== searchId) return;

      const end = Math.min(idx + batchSize, entriesToProcess.length);

      for (let i = idx; i < end; i++) {
        highlightEntry(entriesToProcess[i]);
      }

      idx = end;

      if (idx < entriesToProcess.length) {
        batchTaskId = requestAnimationFrame(processBatch);
      } else {
        batchTaskId = null;
      }
    }

    if (entriesToProcess.length > 0) {
      batchTaskId = requestAnimationFrame(processBatch);
    }
  }

  // ===== Remove all highlights efficiently =====
  //
  // PERFORMANCE STRATEGY:
  // 1. Query all <mark data-hl> elements (fast — attribute selector on known tag)
  // 2. For each mark: move its text content out, then remove the mark element
  // 3. Collect affected parent elements
  // 4. Call normalize() ONLY on affected parents (not the entire document)
  //
  // This is O(m) where m = number of marks, vs O(n) for re-parsing HTML.
  // normalize() merges adjacent text nodes that were split during highlighting,
  // restoring the original DOM structure.
  function removeHighlights() {
    const marks = document.querySelectorAll('mark[data-hl="true"]');
    const parents = new Set();

    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;

      // Move text content out of <mark> back into parent
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parents.add(parent);
    }

    // Normalize only affected parents — merges split text nodes
    for (const parent of parents) {
      if (parent.isConnected) {
        parent.normalize();
      }
    }

    // Reset state
    entries = [];
    flatMatches = [];
    totalMatches = 0;
    currentFlatIdx = -1;

    // Cancel any pending batch
    if (batchTaskId) {
      cancelAnimationFrame(batchTaskId);
      batchTaskId = null;
    }
  }

  // ===== Main search function =====
  function searchKeyword(term, caseSensitive) {
    // Increment search ID — cancels any pending batch from previous search
    searchId++;

    // Remove existing highlights
    removeHighlights();

    // Store current search params (for getStatus)
    currentTerm = term;
    currentCaseSensitive = caseSensitive;

    if (!term || !document.body) {
      currentTerm = '';
      return 0;
    }

    // Inject styles (idempotent)
    injectStyles();

    // Collect all text nodes with matches via TreeWalker
    entries = collectTextNodes(term, caseSensitive);

    if (entries.length === 0) {
      return 0;
    }

    // Build flat match list for navigation
    buildFlatMatches();

    // Lazy highlight: viewport first, then batch offscreen
    lazyHighlight();

    return totalMatches;
  }

  // ===== Navigate to next/previous match =====
  //
  // If the target match hasn't been highlighted yet (lazy highlight
  // hasn't processed it), force-highlight its entire text node entry.
  // Then add the .kw-active class and smooth-scroll into view.
  function navigate(direction) {
    if (totalMatches === 0) return { current: -1, total: 0 };

    // Remove active class from current match
    if (currentFlatIdx >= 0 && currentFlatIdx < flatMatches.length) {
      const curr = flatMatches[currentFlatIdx];
      const mark = entries[curr.entryIdx].matches[curr.matchIdx].mark;
      if (mark) mark.classList.remove('kw-active');
    }

    // Calculate next index with wrap-around
    if (direction === 'next') {
      currentFlatIdx = (currentFlatIdx + 1) % totalMatches;
    } else {
      currentFlatIdx = currentFlatIdx <= 0
        ? totalMatches - 1
        : currentFlatIdx - 1;
    }

    // Get target match
    const target = flatMatches[currentFlatIdx];
    const entry = entries[target.entryIdx];

    // Force-highlight if not yet processed by lazy highlight
    if (!entry.highlighted) {
      highlightEntry(entry);
    }

    // Set active class and smooth-scroll
    const mark = entry.matches[target.matchIdx].mark;
    if (mark) {
      mark.classList.add('kw-active');

      // PERFORMANCE: requestAnimationFrame ensures the scroll happens
      // during the next paint cycle, avoiding layout thrashing.
      // scrollIntoView with behavior: 'smooth' uses the browser's
      // native smooth-scroll implementation (compositor-driven, 60fps).
      requestAnimationFrame(() => {
        mark.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      });
    }

    return { current: currentFlatIdx, total: totalMatches };
  }

  // ===== Message listener =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === 'search') {
      // Synchronous search — count is available immediately
      // (lazy highlighting continues in background via rAF)
      const count = searchKeyword(message.term, message.caseSensitive);
      sendResponse({ count });

    } else if (message.action === 'next') {
      const result = navigate('next');
      sendResponse(result);

    } else if (message.action === 'prev') {
      const result = navigate('prev');
      sendResponse(result);

    } else if (message.action === 'getStatus') {
      // Return current search state (for popup restoration)
      sendResponse({
        term: currentTerm,
        count: totalMatches,
        caseSensitive: currentCaseSensitive
      });
    }

    return true; // Keep message channel open
  });

})();
