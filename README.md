# Studio — Professional Drawing App

A professional drawing application built for **iPad + Apple Pencil**, hosted on GitHub Pages.

## Features

- **Apple Pencil pressure sensitivity** — size and opacity respond to pencil pressure
- **High-precision input** — uses `getCoalescedEvents()` for sub-frame accuracy
- **Palm rejection** — pen events are tracked separately from touch
- **Pinch to zoom** (5% – 2000%) and **two-finger pan**
- **Three-finger tap to undo**, four-finger tap to redo (like Procreate)
- **8 tools**: Pencil, Ink Pen, Brush, Marker, Eraser, Fill, Eyedropper, Move/Pan
- **Unlimited layers** with blend modes and per-layer opacity
- **Full color picker** with HSL gradient, hex input, and recent colors
- **Export** as PNG, JPEG, or copy to clipboard
- **Undo/Redo** (40-step history)
- **Grid overlay**, adjustable canvas size, canvas background options

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `P` | Pencil |
| `N` | Ink Pen |
| `B` | Brush |
| `M` | Marker |
| `E` | Eraser |
| `G` | Fill |
| `I` | Eyedropper |
| `V` | Move/Pan |
| `[` / `]` | Decrease / Increase brush size |
| `0` | Fit canvas to screen |
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |

## Deploying to GitHub Pages

1. **Create a new GitHub repository** (e.g. `studio-drawing`)

2. **Upload all files**, keeping the folder structure:
   ```
   index.html
   css/style.css
   js/canvas-engine.js
   js/tools.js
   js/app.js
   README.md
   ```

3. **Enable GitHub Pages**:
   - Go to your repo → Settings → Pages
   - Under **Source**, select `Deploy from a branch`
   - Choose `main` branch and `/ (root)` folder
   - Click **Save**

4. Your app will be live at:
   `https://YOUR_USERNAME.github.io/studio-drawing/`

## Add to iPad Home Screen

For the best experience, open the URL in Safari on iPad, tap the Share button, then **Add to Home Screen**. The app will launch full-screen with status bar hidden.

## File Structure

```
studio-drawing-app/
├── index.html          # App shell + all UI markup
├── css/
│   └── style.css       # Dark theme, iPad-optimized layout
├── js/
│   ├── canvas-engine.js   # Layer system, compositing, zoom/pan, undo
│   ├── tools.js           # Brush rendering, stroke smoothing, all tools
│   └── app.js             # UI controller, events, color picker, layers
└── README.md
```

## Technical Notes

- **Canvas size**: Defaults to 2732×2048px (iPad Pro native resolution)
- **Stroke rendering**: Catmull-Rom spline smoothing with stamp-based brush
- **Brush stamps**: Cached radial gradient images for performance
- **Undo system**: ImageData snapshots per stroke (up to 40 steps)
- **No dependencies**: Pure vanilla JS, HTML5 Canvas, CSS — no frameworks
