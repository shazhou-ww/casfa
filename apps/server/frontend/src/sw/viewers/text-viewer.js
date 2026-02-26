// Text Viewer — displays text files from _target/ with a sidebar file list
(async () => {
  const body = document.body;
  body.style.cssText =
    "margin:0;font-family:system-ui;background:#fafafa;color:#333;display:flex;height:100vh;";

  const sidebar = document.createElement("div");
  sidebar.style.cssText =
    "width:220px;background:#f0f0f0;border-right:1px solid #ddd;overflow-y:auto;padding:8px 0;";
  body.appendChild(sidebar);

  const content = document.createElement("div");
  content.style.cssText = "flex:1;overflow-y:auto;padding:16px 24px;";
  body.appendChild(content);

  const title = document.createElement("div");
  title.style.cssText =
    "padding:8px 12px;font-weight:bold;font-size:14px;border-bottom:1px solid #ddd;margin-bottom:4px;";
  title.textContent = "Files";
  sidebar.appendChild(title);

  try {
    const res = await fetch("_target/");
    const dir = await res.json();
    const textExts =
      /\.(txt|md|json|xml|css|js|ts|html|yaml|yml|toml|ini|cfg|log|csv|sh|py|rb|go|rs|java|c|h|cpp|hpp)$/i;
    const names = Object.keys(dir.children || {})
      .filter((n) => textExts.test(n))
      .sort();

    if (names.length === 0) {
      content.innerHTML =
        '<p style="opacity:.6;">No text files found in target.</p>';
      return;
    }

    const show = async (name) => {
      content.innerHTML = '<p style="opacity:.5;">Loading...</p>';
      try {
        const r = await fetch("_target/" + encodeURIComponent(name));
        const text = await r.text();
        const pre = document.createElement("pre");
        pre.style.cssText =
          "white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.5;margin:0;";
        pre.textContent = text;
        const h = document.createElement("h3");
        h.style.cssText = "margin:0 0 12px;font-size:16px;";
        h.textContent = name;
        content.innerHTML = "";
        content.append(h, pre);
      } catch (e) {
        content.innerHTML =
          '<p style="color:red;">Error: ' + e.message + "</p>";
      }
      // Highlight active
      for (const btn of sidebar.querySelectorAll(".file-item"))
        btn.style.background =
          btn.dataset.name === name ? "#ddd" : "";
    };

    for (const name of names) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.dataset.name = name;
      item.style.cssText =
        "padding:4px 12px;cursor:pointer;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      item.textContent = name;
      item.onmouseenter = () => {
        if (item.style.background !== "rgb(221, 221, 221)")
          item.style.background = "#e8e8e8";
      };
      item.onmouseleave = () => {
        if (item.style.background !== "rgb(221, 221, 221)")
          item.style.background = "";
      };
      item.onclick = () => show(name);
      sidebar.appendChild(item);
    }

    show(names[0]);
  } catch (e) {
    content.innerHTML =
      '<p style="color:red;">Failed to load target: ' + e.message + "</p>";
  }
})();
