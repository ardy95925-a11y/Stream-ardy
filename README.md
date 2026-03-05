# 🦴 MARROW — 2D Bone Animator

A professional 2D bone animation studio designed for **iPad + Apple Pencil**, hosted on GitHub Pages.

## 🚀 Live App
**[Open MARROW →](https://yourusername.github.io/marrow)**

> Add to Home Screen on iPad for the full standalone experience.

---

## ✨ Features

| Feature | Description |
|---|---|
| ✏️ **Draw** | Pressure-sensitive drawing with Apple Pencil — pencil, brush, eraser |
| 🦴 **Rig** | Place joints and connect them into a skeleton |
| 🕹 **Pose** | Drag joints to pose your character (FK chain) |
| 🎞 **Animate** | Keyframe timeline like Moon Animator — drag to auto-keyframe |
| 🧅 **Onion Skin** | See previous/next frames while animating |
| 📱 **PWA** | Install to iPad home screen, works offline |
| 💾 **Export** | Save project as JSON |

---

## 🎮 How to Use

### 1. Draw Your Character
Switch to **Draw** mode. Use your Apple Pencil to sketch your character on the canvas. Use multiple layers to organise (e.g. background, body, outlines).

### 2. Rig It
Switch to **Rig** mode:
1. Tap **Joint** tool → tap on your character to place joints (circles)
2. Tap **Connect** tool → tap one joint, then another to create a bone between them
3. Hit **Auto-Assign** in the right panel to link your drawing to the nearest bones

### 3. Pose It
Switch to **Pose** mode. Drag any joint to rotate its bone (forward kinematics). Child bones follow automatically. Hit **+ Keyframe** to save the pose.

### 4. Animate
Switch to **Animate** mode:
- Scrub the timeline or use ⏮ ⏪ ⏩ ⏭ buttons to move between frames
- Pose your character — dragging a joint **auto-saves a keyframe**
- Press ▶ to play back your animation
- Keyframes are shown as orange diamonds ◆ on the timeline

---

## 🛠 Hosting on GitHub Pages

1. Fork or upload these files to a GitHub repo
2. Go to **Settings → Pages**
3. Set source to `main` branch, `/ (root)` folder
4. Your app will be live at `https://yourusername.github.io/repo-name`

Files needed:
```
index.html   ← main app
manifest.json
sw.js
icon.svg
README.md
```

---

## 📱 iPad Tips

- **Add to Home Screen** (Safari → Share → Add to Home Screen) for fullscreen mode
- Pinch-to-zoom is disabled for drawing accuracy
- Apple Pencil pressure & tilt are detected automatically
- Use landscape orientation for the full timeline

---

## 🎨 Tech Stack

- Vanilla HTML5 Canvas + Pointer Events API
- No dependencies — pure JavaScript
- PWA (Service Worker + Web Manifest)
- Apple Pencil: `pointerType === 'pen'`, `e.pressure` for line width

---

*Made with 🦴 — MARROW Animation Studio*
