// Image Gallery Viewer — displays images from _target/ in a grid
(async () => {
  const body = document.body;
  body.style.cssText =
    "margin:0;padding:16px;font-family:system-ui;background:#1a1a2e;color:#eee;";

  const header = document.createElement("div");
  header.style.cssText = "text-align:center;padding:8px 0 16px;";
  header.innerHTML = "<h2 style='margin:0;'>Image Gallery</h2>";
  body.appendChild(header);

  const grid = document.createElement("div");
  grid.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;";
  body.appendChild(grid);

  try {
    const res = await fetch("_target/");
    const dir = await res.json();
    const imageExts = /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif)$/i;
    const names = Object.keys(dir.children || {})
      .filter((n) => imageExts.test(n))
      .sort();

    if (names.length === 0) {
      grid.innerHTML =
        '<p style="grid-column:1/-1;text-align:center;opacity:.6;">No images found in target.</p>';
      return;
    }

    for (const name of names) {
      const card = document.createElement("div");
      card.style.cssText =
        "border-radius:8px;overflow:hidden;background:#16213e;cursor:pointer;";

      const img = document.createElement("img");
      img.src = "_target/" + encodeURIComponent(name);
      img.alt = name;
      img.style.cssText =
        "width:100%;aspect-ratio:1;object-fit:cover;display:block;";
      img.loading = "lazy";

      const label = document.createElement("div");
      label.style.cssText =
        "padding:6px 8px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      label.textContent = name;

      card.appendChild(img);
      card.appendChild(label);
      grid.appendChild(card);

      // Click to view full size
      card.onclick = () => window.open(img.src, "_blank");
    }
  } catch (e) {
    grid.innerHTML =
      '<p style="color:#e74c3c;">Failed to load target: ' + e.message + "</p>";
  }
})();
