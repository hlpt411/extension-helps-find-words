// ==================================================
// POPUP.JS — UI Controller + Message Bridge
// Debounce 250ms • Web Animations API • Ripple
// ==================================================

(function() {
  'use strict';

  // ===== DOM References =====
  const searchInput       = document.getElementById('searchInput');
  const caseSensitiveCB   = document.getElementById('caseSensitive');
  const countEl           = document.getElementById('count');
  const countTotalEl      = document.getElementById('countTotal');
  const countLabelEl      = document.getElementById('countLabel');
  const prevBtn           = document.getElementById('prevBtn');
  const nextBtn           = document.getElementById('nextBtn');
  const noResultsEl       = document.getElementById('noResults');

  // ===== State =====
  let debounceTimer    = null;
  let lastTerm         = '';
  let lastCaseSensitive = false;

  // ===== Auto-focus input on popup open =====
  searchInput.focus();

  // ===== Get active tab =====
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ===== Ensure content script is injected (programmatic injection) =====
  // Idempotent: content.js has a guard against re-injection
  async function ensureContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
    } catch (e) {
      // Already injected, or restricted page (chrome://, etc.)
    }
  }

  // ===== Send message to content script =====
  async function sendMessage(message) {
    const tab = await getActiveTab();
    if (!tab) return null;

    await ensureContentScript(tab.id);

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not responding — restricted page
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ===== Perform search (called after debounce) =====
  function performSearch() {
    const term = searchInput.value.trim();
    const caseSensitive = caseSensitiveCB.checked;

    // Skip if nothing changed
    if (term === lastTerm && caseSensitive === lastCaseSensitive) return;

    lastTerm = term;
    lastCaseSensitive = caseSensitive;

    sendMessage({
      action: 'search',
      term,
      caseSensitive
    }).then(response => {
      if (response) {
        updateCount(response.count);
      } else {
        // Restricted page — show error
        showError();
      }
    });
  }

  // ===== Update count display with pop animation =====
  // PERFORMANCE: Uses Web Animations API instead of class toggle + reflow
  function popAnimation() {
    countEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.35)' },
        { transform: 'scale(1)' }
      ],
      { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
  }

  function updateCount(count) {
    countEl.textContent = count;
    countTotalEl.textContent = '';
    countLabelEl.textContent = 'kết quả';
    countEl.style.color = '#f5a623';

    // Show/hide no-results state
    if (count === 0 && searchInput.value.trim() !== '') {
      noResultsEl.classList.remove('hidden');
      noResultsEl.querySelector('.sad-icon').textContent = '😕';
      noResultsEl.querySelector('span:last-child').textContent = 'Không tìm thấy kết quả';
    } else {
      noResultsEl.classList.add('hidden');
    }

    popAnimation();
  }

  // ===== Update count with position (after navigation) =====
  function updateCountPosition(current, total) {
    countEl.textContent = current;
    countTotalEl.textContent = ` / ${total}`;
    countLabelEl.textContent = 'kết quả';
    countEl.style.color = '#FF6B35';
    noResultsEl.classList.add('hidden');
    popAnimation();
  }

  // ===== Show error (restricted page) =====
  function showError() {
    countEl.textContent = '—';
    countTotalEl.textContent = '';
    countLabelEl.textContent = '';
    noResultsEl.classList.remove('hidden');
    noResultsEl.querySelector('.sad-icon').textContent = '⚠️';
    noResultsEl.querySelector('span:last-child').textContent = 'Không thể chạy trên trang này';
  }

  // ===== Navigation =====
  function navigateNext() {
    sendMessage({ action: 'next' }).then(response => {
      if (response && response.total > 0) {
        updateCountPosition(response.current + 1, response.total);
      }
    });
  }

  function navigatePrev() {
    sendMessage({ action: 'prev' }).then(response => {
      if (response && response.total > 0) {
        updateCountPosition(response.current + 1, response.total);
      }
    });
  }

  // ===== Ripple effect on button click =====
  // PERFORMANCE: transform: scale() only — no layout changes
  function createRipple(e) {
    const button = e.currentTarget;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';

    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  // ===== Flash button (for keyboard-triggered navigation) =====
  function flashButton(btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 150);
  }

  // ===== Event Listeners =====

  // Debounced input — 250ms delay to avoid excessive computation
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performSearch, 250);
  });

  // Keyboard shortcuts:
  //   Enter       → Next match
  //   Shift+Enter → Previous match
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        flashButton(prevBtn);
        navigatePrev();
      } else {
        flashButton(nextBtn);
        navigateNext();
      }
    }
  });

  // Case-sensitive toggle — re-run search immediately
  caseSensitiveCB.addEventListener('change', performSearch);

  // Navigation buttons with ripple
  prevBtn.addEventListener('click', (e) => {
    createRipple(e);
    navigatePrev();
  });

  nextBtn.addEventListener('click', (e) => {
    createRipple(e);
    navigateNext();
  });

  // ===== On popup open: restore previous search state =====
  // Checks if content script already has a search running
  sendMessage({ action: 'getStatus' }).then(response => {
    // Only restore if user hasn't started typing yet
    if (response && response.term && !searchInput.value) {
      searchInput.value = response.term;
      caseSensitiveCB.checked = response.caseSensitive;
      lastTerm = response.term;
      lastCaseSensitive = response.caseSensitive;

      if (response.count > 0) {
        updateCount(response.count);
      } else if (response.term) {
        updateCount(0);
      }
    }
  });

})();
