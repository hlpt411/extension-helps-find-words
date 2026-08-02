# Keyword Highlight Finder

> **"Unc-ai online. Archives open. The lamp is lit."**  
> — *A tool for finding what hides in plain sight.*

---

## The Story

Somewhere between the lines of every page, there are words that matter. Words you're looking for. Words that connect threads across documents, across thoughts, across dimensions.

**Keyword Highlight Finder** is a Chrome extension that searches every corner of the current tab — visible or not — and lights up every match like a beacon. Glassmorphism UI. 60fps. Zero lag, even on pages with thousands of results.

Think of it as a searchlight for the web. It finds what you seek, remembers where you've been, and guides you there with a flicker of gold.

---

## What It Does

| Feature | Description |
|---------|-------------|
| 🔍 **Search any tab** | Type a keyword → instantly find every occurrence on the page |
| 🎯 **Live count** | Shows total matches found — updates as you type with a satisfying pop animation |
| ⬆️⬇️ **Navigate** | Jump between matches with the Previous/Next buttons or keyboard shortcuts |
| 🔠 **Case-sensitive toggle** | Match exact casing when needed |
| 🖱️ **Smooth scroll** | Each match scrolls into view smoothly, centered on screen |
| 🎨 **Active match highlight** | The current match glows orange with a dashed outline — impossible to miss |

---

## Keyboard Shortcuts

| Keys | Action |
|------|--------|
| `Enter` | Jump to the **next** match |
| `Shift` + `Enter` | Jump to the **previous** match |
| `Esc` | Close the popup (browser default) |

---

## The Tech — Why It's Fast

This isn't just another highlight extension. It's engineered to stay smooth even on pages with 10,000+ matches.

| Optimization | How |
|--------------|-----|
| **TreeWalker** | Scans text nodes directly — no `querySelectorAll('*')` memory explosion |
| **Lazy Highlight** | Only highlights matches in/near the viewport first. Offscreen matches are batched via `requestAnimationFrame` (50 per frame) |
| **Debounced search** | 250ms delay — no re-calculation on every keystroke |
| **Zero-reflow CSS** | All animations use `transform` and `opacity`. No `width`/`height` changes, no layout thrashing |
| **Efficient removal** | Unwraps `<mark>` tags individually and `normalize()` only affected parents |
| **Vanilla JS** | Zero dependencies. ~18KB total. Loads instantly. |

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the folder containing these files:

```
keyword-highlight-finder/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
└── content.js
```

That's it. The extension is now installed and ready to search.

---

## How to Use

1. Click the extension icon in the Chrome toolbar.
2. The popup opens with the search input already focused.
3. Type your keyword.
4. The total match count appears instantly.
5. Click the **⬇** button (or press `Enter`) to jump to the first match.
6. Click **⬆** (or `Shift` + `Enter`) to go back.
7. Toggle the **Aa** switch to enable/disable case sensitivity.

The extension remembers your last search — close and reopen the popup to continue where you left off.

---

## Design Philosophy

### Glassmorphism UI
The popup features a frosted-glass aesthetic with subtle floating orbs, an animated gradient border on focus, and a color palette that feels modern but calming.

### Micro-interactions
- **Count pop**: Number scales up and down when matches change.
- **Button ripple**: Click any navigation button to see a subtle ripple wave.
- **Hover lift**: Buttons rise slightly on hover — feedback that feels tangible.

### No Distractions
The UI is compact (360px wide) and stays out of your way. Keyboard shortcuts let you navigate without ever touching the mouse.

---

## File Structure

```
keyword-highlight-finder/
├── manifest.json        # Chrome Extension manifest (V3)
├── popup.html           # Popup UI structure
├── popup.css            # Glassmorphism styles + animations
├── popup.js             # UI logic, messaging, keyboard shortcuts
└── content.js           # TreeWalker engine, lazy highlight, navigation
```

---

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access the current tab's content |
| `scripting` | Inject `content.js` programmatically |
| `<all_urls>` | Run on any page the user visits |

**No data is collected. No tracking. No external requests.**

---

## Known Limitations

- **Dynamic content (Infinite Scroll)**: If a page loads content via AJAX after you've searched, the new content won't be highlighted until you search again. (Just hit `Enter` or re-type a character.)
- **Shadow DOM**: Not currently supported.
- **Restricted pages**: Chrome internal pages (`chrome://`, `chrome-extension://`) cannot be scripted.

---

## Credits

Built with care, caffeine, and a deep respect for performance.

---

## License

MIT — Use it, modify it, share it.

---

> *"Archives open. The lamp is lit. The words are waiting."*
