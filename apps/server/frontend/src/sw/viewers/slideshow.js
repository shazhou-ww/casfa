// Slideshow Viewer — cycles through images from _target/
(async () => {
  const body = document.body;
  body.style.cssText =
    "margin:0;display:flex;flex-direction:column;height:100vh;background:#000;color:#fff;font-family:system-ui;overflow:hidden;";

  const display = document.createElement("div");
  display.style.cssText =
    "flex:1;display:flex;align-items:center;justify-content:center;position:relative;min-height:0;overflow:hidden;";
  body.appendChild(display);

  const img = document.createElement("img");
  img.style.cssText =
    "max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;transition:opacity .3s;";
  display.appendChild(img);

  const controls = document.createElement("div");
  controls.style.cssText =
    "display:flex;align-items:center;justify-content:center;gap:16px;padding:12px;background:#111;";
  body.appendChild(controls);

  const btnStyle =
    "background:#333;border:none;color:#fff;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:16px;";

  try {
    const res = await fetch("_target/");
    const dir = await res.json();
    const imageExts = /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif)$/i;
    const names = Object.keys(dir.children || {})
      .filter((n) => imageExts.test(n))
      .sort();

    if (names.length === 0) {
      display.innerHTML =
        '<p style="opacity:.6;">No images found in target.</p>';
      return;
    }

    let idx = 0;
    let autoplay = true;
    let timer;

    const show = (i) => {
      idx = ((i % names.length) + names.length) % names.length;
      img.style.opacity = "0";
      setTimeout(() => {
        img.src = "_target/" + encodeURIComponent(names[idx]);
        img.alt = names[idx];
        counter.textContent = idx + 1 + " / " + names.length;
        img.style.opacity = "1";
      }, 150);
    };

    const prev = document.createElement("button");
    prev.style.cssText = btnStyle;
    prev.textContent = "\u25C0";
    prev.onclick = () => {
      autoplay = false;
      clearInterval(timer);
      show(idx - 1);
    };

    const playBtn = document.createElement("button");
    playBtn.style.cssText = btnStyle;
    playBtn.textContent = "\u23F8";
    playBtn.onclick = () => {
      autoplay = !autoplay;
      playBtn.textContent = autoplay ? "\u23F8" : "\u25B6";
      if (autoplay) timer = setInterval(() => show(idx + 1), 3000);
      else clearInterval(timer);
    };

    const next = document.createElement("button");
    next.style.cssText = btnStyle;
    next.textContent = "\u25B6";
    next.onclick = () => {
      autoplay = false;
      clearInterval(timer);
      show(idx + 1);
    };

    const counter = document.createElement("span");
    counter.style.cssText =
      "min-width:60px;text-align:center;font-size:14px;";

    controls.append(prev, playBtn, next, counter);

    show(0);
    timer = setInterval(() => {
      if (autoplay) show(idx + 1);
    }, 3000);

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") prev.click();
      else if (e.key === "ArrowRight") next.click();
      else if (e.key === " ") {
        e.preventDefault();
        playBtn.click();
      }
    });
  } catch (e) {
    display.innerHTML =
      '<p style="color:#e74c3c;">Failed to load: ' + e.message + "</p>";
  }
})();
