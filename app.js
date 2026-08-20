// ===================== TopStone Fabric Selector =====================
const SUPABASE_URL = "https://cejgurbaweucfpuzvdpw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlamd1cmJhd2V1Y2ZwdXp2ZHB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5OTM5NDYsImV4cCI6MjA5OTU2OTk0Nn0.XuxVRqjznvt5xS1u9Xx1-Fe7qy4yCGUpTKr0XesxrCE";
const BUCKET_FABRICS = "topstone-fabrics";
const BUCKET_PRODUCTS = "topstone-products";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRODUCT_TYPES = [
  { value: "jersey", label: "Jersey" },
  { value: "bib", label: "Bib" },
  { value: "medias", label: "Medias" },
  { value: "guantes", label: "Guantes" },
  { value: "chaleco", label: "Chaleco" },
  { value: "jacket", label: "Jacket" },
  { value: "casquette", label: "Casquette" },
  { value: "run_short", label: "Run Short" },
  { value: "run_shirt", label: "Run Shirt" },
];

const SIZE_OPTIONS = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL"];
const GENDER_OPTIONS = ["Hombre", "Mujer", "Unisex"];

let fabrics = [];       // cache: [{...fabric, images:[url,...]}]
let clients = [];
let products = [];      // [{...product, client_name, zone_count, file_count}]

// ---------- helpers ----------
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, isErr) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("es-CR", { year: "numeric", month: "short", day: "numeric" });
}
function gradeClass(g) {
  if (g === "Premium") return "premium";
  if (g === "Mid-range") return "mid";
  if (g === "Basic") return "basic";
  return "none";
}
function slugFile(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_");
}
async function uploadFile(bucket, path, file) {
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
async function removeStorageObject(bucket, url) {
  try {
    const marker = `/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(url.slice(idx + marker.length));
    await sb.storage.from(bucket).remove([path]);
  } catch (e) { /* best effort */ }
}
function fileKind(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "photo";
  if (ext === "pdf") return "pdf";
  if (ext === "psd") return "psd";
  if (ext === "ai") return "ai";
  return "other";
}
function fileIcon(kind) {
  return { photo: "🖼️", pdf: "📄", psd: "🎨", ai: "🖊️", other: "📎" }[kind] || "📎";
}
function closeAllModals() { $all(".modal-bg").forEach(m => m.classList.remove("show")); }
function openImageLightbox(url) {
  if (!url) return;
  $("#lightbox-img").src = url;
  $("#modal-img-lightbox").classList.add("show");
}
function closeLightbox() { $("#modal-img-lightbox").classList.remove("show"); }
$all(".modal-bg").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.remove("show"); }));

// ---------- nav ----------
$all(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    $all(".nav-item").forEach(i => i.classList.remove("active"));
    item.classList.add("active");
    $all(".view").forEach(v => v.classList.remove("active"));
    $("#view-" + item.dataset.view).classList.add("active");
  });
});

// =====================================================================
// FABRICS
// =====================================================================
async function loadFabrics() {
  $("#fabric-grid").innerHTML = '<div class="empty">Cargando telas…</div>';
  const { data: fdata, error: ferr } = await sb.from("topstone_fabrics").select("*").order("code");
  if (ferr) { toast("Error cargando telas: " + ferr.message, true); return; }
  const { data: idata, error: ierr } = await sb.from("topstone_fabric_images").select("*").order("sort_order");
  if (ierr) { toast("Error cargando imágenes: " + ierr.message, true); return; }
  const { data: cdata, error: cerr } = await sb.from("topstone_fabric_colors").select("*").order("sort_order");
  if (cerr) { toast("Error cargando colores: " + cerr.message, true); return; }
  const imgMap = {};
  (idata || []).forEach(row => {
    (imgMap[row.fabric_id] = imgMap[row.fabric_id] || []).push(row.url);
  });
  const colorMap = {};
  (cdata || []).forEach(row => {
    (colorMap[row.fabric_id] = colorMap[row.fabric_id] || []).push(row);
  });
  fabrics = (fdata || []).map(f => ({ ...f, images: imgMap[f.id] || [], colors: colorMap[f.id] || [] }));
  renderFabricStats();
  renderFabrics();
}

function renderFabricStats() {
  const total = fabrics.length;
  const review = fabrics.filter(f => f.needs_review).length;
  const withImg = fabrics.filter(f => f.images.length).length;
  const cats = { tops: 0, bottoms: 0, others: 0 };
  fabrics.forEach(f => cats[f.category] = (cats[f.category] || 0) + 1);
  $("#fabric-stats").innerHTML = `
    <div class="stat"><b>${total}</b><span>Telas</span></div>
    <div class="stat"><b>${cats.tops}</b><span>Tops</span></div>
    <div class="stat"><b>${cats.bottoms}</b><span>Bottoms</span></div>
    <div class="stat"><b>${cats.others}</b><span>Others</span></div>
    <div class="stat"><b>${withImg}</b><span>Con foto</span></div>
    <div class="stat"><b>${review}</b><span>Por revisar</span></div>`;
}

function renderFabrics() {
  const q = ($("#f-search").value || "").toLowerCase();
  const cat = $("#f-cat").value;
  const grade = $("#f-grade").value;
  const review = $("#f-review").value;
  const sort = $("#f-sort").value;
  let rows = fabrics.filter(f => {
    if (cat && f.category !== cat) return false;
    if (grade && f.grade !== grade) return false;
    if (review === "1" && !f.needs_review) return false;
    if (review === "0" && f.needs_review) return false;
    if (q) {
      const hay = [f.code, f.name, f.composition, f.specification, f.probable_use, (f.functions || []).join(" ")].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (sort === "compression") rows.sort((a, b) => (b.compression_score || 0) - (a.compression_score || 0));
  else if (sort === "recent") rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  else rows.sort((a, b) => a.code.localeCompare(b.code));

  const grid = $("#fabric-grid");
  if (!rows.length) { grid.innerHTML = '<div class="empty">No hay telas con esos filtros.</div>'; return; }
  grid.innerHTML = rows.map(f => `
    <div class="card">
      <div class="thumb" onclick="${f.images[0] ? `openImageLightbox('${esc(f.images[0])}')` : `openFabricDetail('${f.id}')`}">${f.images[0] ? `<img loading="lazy" src="${esc(f.images[0])}">` : '<div class="noimg">Sin imagen</div>'}</div>
      <div class="body" onclick="openFabricDetail('${f.id}')">
        <div class="code">${esc(f.code)}</div>
        <div class="name">${esc(f.name)}</div>
        <div class="row-meta">
          <span class="badge cat-${f.category}">${f.category}</span>
          <span class="badge ${gradeClass(f.grade)}">${esc(f.grade)}</span>
          ${f.needs_review ? '<span class="badge review">Revisar</span>' : ""}
        </div>
        <div class="small">${esc(f.specification || "—")}</div>
        ${f.colors.length ? `
        <div class="color-count-hover">
          🎨 ${f.colors.length} color${f.colors.length > 1 ? "es" : ""}
          <div class="color-tooltip">
            ${f.colors.map(c => `<div class="color-tooltip-item">${c.color_hex ? `<span class="swatch" style="background:${esc(c.color_hex)}"></span>` : ""}${esc(c.color_name)}</div>`).join("")}
          </div>
        </div>` : ""}
      </div>
    </div>`).join("");
}

function openFabricDetail(id) {
  const f = fabrics.find(x => x.id === id);
  if (!f) return;
  $("#modal-fabric-detail-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${esc(f.code)} <span style="color:var(--muted);font-weight:400">— ${esc(f.name)}</span></h2>
    <div class="row-meta">
      <span class="badge cat-${f.category}">${f.category}</span>
      <span class="badge ${gradeClass(f.grade)}">${esc(f.grade)}</span>
      ${f.needs_review ? '<span class="badge review">Por revisar</span>' : ""}
      ${(f.functions || []).map(x => `<span class="badge mid">${esc(x)}</span>`).join("")}
    </div>
    <div class="gallery">${f.images.length ? f.images.map(u => `<img src="${esc(u)}" onclick="openImageLightbox('${esc(u)}')">`).join("") : '<div class="small">Sin fotos cargadas todavía.</div>'}</div>
    <div class="kv">
      <b>Especificación</b><span>${esc(f.specification || "—")}</span>
      <b>Composición</b><span>${esc(f.composition || "—")}</span>
      <b>Compresión estimada</b><span>${esc(f.compression_label || "—")} (${f.compression_score ?? "—"}/5)</span>
      <b>Uso probable</b><span>${esc(f.probable_use || "—")}</span>
      <b>Análisis técnico</b><span>${esc(f.technical_analysis || "—")}</span>
      <b>Descripción</b><span>${esc(f.description || "—")}</span>
      ${f.review_notes ? `<b>Notas de revisión</b><span>${esc(f.review_notes)}</span>` : ""}
      <b>Origen</b><span class="small">${esc(f.source_note || "—")}</span>
    </div>
    ${f.colors.length ? `
    <label style="margin-top:16px;display:block">Colores disponibles (${f.colors.length})</label>
    <div class="pfz-list">
      ${f.colors.map(c => `
        <div class="pfz-item">
          ${c.image_url
            ? `<img src="${esc(c.image_url)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;cursor:zoom-in" onclick="openImageLightbox('${esc(c.image_url)}')">`
            : (c.color_hex
              ? `<span class="swatch" style="width:28px;height:28px;border-radius:6px;background:${esc(c.color_hex)}"></span>`
              : '<div style="width:44px;height:44px;background:#0b1219;border-radius:6px"></div>')}
          <div style="flex:1"><b>${esc(c.color_name)}</b>${c.notes ? `<div class="small">${esc(c.notes)}</div>` : ""}</div>
        </div>`).join("")}
    </div>` : ""}
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn primary" onclick="closeAllModals();openFabricForm('${f.id}')">Editar</button>
      <button class="btn danger" onclick="deleteFabric('${f.id}')">Borrar</button>
    </div>`;
  closeAllModals();
  $("#modal-fabric-detail").classList.add("show");
}

let pendingFabricImages = []; // File objects staged for upload on save
let pendingFabricRemovals = []; // urls to remove on save
let fabricExistingOrder = []; // ordered urls of currently-kept existing images (index 0 = principal)
let fabricColorRows = []; // [{color_name, color_hex, notes, existingUrl, newFile}]

function openFabricForm(id) {
  const f = id ? fabrics.find(x => x.id === id) : null;
  pendingFabricImages = [];
  pendingFabricRemovals = [];
  fabricExistingOrder = f ? f.images.slice() : [];
  fabricColorRows = f ? f.colors.map(c => ({
    color_name: c.color_name, color_hex: c.color_hex || "", notes: c.notes || "",
    existingUrl: c.image_url || "", newFile: null,
  })) : [];
  $("#modal-fabric-form-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${f ? "Editar tela" : "Agregar tela"}</h2>
    <div class="formgrid">
      <div><label>Código *</label><input id="ff-code" value="${f ? esc(f.code) : ""}" ${f ? "disabled" : ""} placeholder="MN0099"></div>
      <div><label>Nombre</label><input id="ff-name" value="${f ? esc(f.name) : ""}"></div>
      <div><label>Categoría *</label>
        <select id="ff-cat">
          <option value="tops" ${f?.category === "tops" ? "selected" : ""}>Tops</option>
          <option value="bottoms" ${f?.category === "bottoms" ? "selected" : ""}>Bottoms</option>
          <option value="others" ${!f || f.category === "others" ? "selected" : ""}>Others</option>
        </select>
      </div>
      <div><label>Gama</label>
        <select id="ff-grade">
          ${["Premium", "Mid-range", "Basic", "No indicada"].map(g => `<option ${f?.grade === g ? "selected" : ""}>${g}</option>`).join("")}
        </select>
      </div>
      <div class="full"><label>Especificación</label><input id="ff-spec" value="${f ? esc(f.specification) : ""}" placeholder="150CM*200G/㎡"></div>
      <div class="full"><label>Composición</label><input id="ff-comp" value="${f ? esc(f.composition) : ""}" placeholder="80%NYLON+20%ELASTANE"></div>
      <div class="full"><label>Descripción</label><textarea id="ff-desc" rows="3">${f ? esc(f.description) : ""}</textarea></div>
      <div><label>Uso probable</label><input id="ff-role" value="${f ? esc(f.probable_use) : ""}"></div>
      <div><label>Compresión estimada (1-5)</label><input id="ff-compscore" type="number" min="1" max="5" step="0.1" value="${f?.compression_score ?? ""}"></div>
      <div class="full"><label>Análisis técnico</label><textarea id="ff-analysis" rows="3">${f ? esc(f.technical_analysis) : ""}</textarea></div>
      <div class="full">
        <label>Funcionalidad</label>
        <div class="tag-picker" id="ff-functions">
          ${["Compresión","Anti-deslizante / Grip","Transpirable","Secado rápido","Repelente al agua","Cortaviento","Térmico / Fleece","Reflectivo","UV / UPF","Grafeno","Antibacterial","Seamless / Clean-cut","Alta elasticidad","Ligera","Jacquard / Textura","Malla / Mesh"].map(tag => {
            const on = f && (f.functions || []).includes(tag);
            return `<span class="tag-opt ${on ? "on" : ""}" data-tag="${esc(tag)}" onclick="this.classList.toggle('on')">${esc(tag)}</span>`;
          }).join("")}
        </div>
      </div>
      <div class="full">
        <label>Colores disponibles</label>
        <div class="hint" style="margin:0 0 6px">Si esta tela viene en varios colores bajo el mismo código, agrégalos aquí — se muestran como cantidad en la tarjeta y en el detalle.</div>
        <div id="ff-colors"></div>
        <button type="button" class="btn small" onclick="addColorRow()">+ Agregar color</button>
      </div>
      <div class="full">
        <label>Fotos</label>
        <div class="hint" style="margin:0 0 6px">La primera foto (marcada "Principal") es la que se muestra en la tarjeta del catálogo. Usa las flechas para reordenar o "★ Principal" para elegir otra.</div>
        <div id="ff-existing-imgs" class="gallery"></div>
        <input type="file" id="ff-file-input" multiple accept="image/*" onchange="stageFabricImages(this.files)">
        <div class="hint">Puedes seleccionar varias fotos. Se suben al guardar, después de las existentes.</div>
        <div id="ff-staged-list"></div>
      </div>
      <div class="full" style="margin-top:16px;display:flex;gap:8px">
        <button class="btn primary" id="ff-save-btn" onclick="saveFabric('${f ? f.id : ""}')">Guardar</button>
        <button class="btn" onclick="closeAllModals()">Cancelar</button>
      </div>
    </div>`;
  closeAllModals();
  $("#modal-fabric-form").classList.add("show");
  renderFabricExistingImages();
  renderColorRows();
}
function renderColorRows() {
  const el = $("#ff-colors");
  if (!el) return;
  el.innerHTML = fabricColorRows.map((c, i) => `
    <div class="color-row">
      <div><label style="margin:0 0 3px">Color</label>
        <input type="color" class="color-input" value="${c.color_hex || "#888888"}" title="Color (opcional)" onchange="fabricColorRows[${i}].color_hex=this.value">
      </div>
      <div><label style="margin:0 0 3px">Nombre del color *</label><input value="${esc(c.color_name || "")}" placeholder="Ej: Azul marino" oninput="fabricColorRows[${i}].color_name=this.value"></div>
      <div><label style="margin:0 0 3px">Nota</label><input value="${esc(c.notes || "")}" oninput="fabricColorRows[${i}].notes=this.value"></div>
      <div>
        <label style="margin:0 0 3px">Foto (opcional)</label>
        ${c.existingUrl && !c.newFile ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><img src="${esc(c.existingUrl)}" style="width:30px;height:30px;object-fit:cover;border-radius:6px"><button type="button" class="btn danger small" style="padding:2px 6px" onclick="fabricColorRows[${i}].existingUrl='';renderColorRows()">×</button></div>` : ""}
        <input type="file" accept="image/*" onchange="stageColorImage(${i}, this.files[0])">
      </div>
      <button type="button" class="btn danger small" onclick="removeColorRow(${i})">×</button>
    </div>`).join("") || '<div class="small">Sin colores agregados — si la tela solo viene en un color, puedes dejar esto vacío.</div>';
}
function addColorRow() {
  fabricColorRows.push({ color_name: "", color_hex: "", notes: "", existingUrl: "", newFile: null });
  renderColorRows();
}
function removeColorRow(i) { fabricColorRows.splice(i, 1); renderColorRows(); }
function stageColorImage(i, file) {
  if (!file) return;
  fabricColorRows[i].newFile = file;
  renderColorRows();
}
function renderFabricExistingImages() {
  const el = $("#ff-existing-imgs");
  if (!el) return;
  const n = fabricExistingOrder.length;
  el.innerHTML = fabricExistingOrder.map((u, i) => `
    <div style="position:relative">
      <img src="${esc(u)}">
      ${i === 0 ? '<span class="badge premium" style="position:absolute;top:4px;left:4px">Principal</span>' : ""}
      <button class="btn danger small" style="position:absolute;top:4px;right:4px;padding:2px 7px" onclick="removeFabricImg(${i})">×</button>
      <div style="position:absolute;bottom:4px;left:4px;right:4px;display:flex;gap:4px;justify-content:space-between;background:rgba(4,8,12,.6);border-radius:6px;padding:3px">
        <div style="display:flex;gap:4px">
          <button type="button" class="btn small" style="padding:2px 6px" onclick="moveFabricImg(${i},-1)" ${i === 0 ? "disabled" : ""}>‹</button>
          <button type="button" class="btn small" style="padding:2px 6px" onclick="moveFabricImg(${i},1)" ${i === n - 1 ? "disabled" : ""}>›</button>
        </div>
        ${i !== 0 ? `<button type="button" class="btn small" style="padding:2px 6px" onclick="setFabricImgMain(${i})">★ Principal</button>` : ""}
      </div>
    </div>`).join("") || '<div class="small">Sin fotos todavía.</div>';
}
function moveFabricImg(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= fabricExistingOrder.length) return;
  [fabricExistingOrder[i], fabricExistingOrder[j]] = [fabricExistingOrder[j], fabricExistingOrder[i]];
  renderFabricExistingImages();
}
function setFabricImgMain(i) {
  const [u] = fabricExistingOrder.splice(i, 1);
  fabricExistingOrder.unshift(u);
  renderFabricExistingImages();
}
function removeFabricImg(i) {
  const [u] = fabricExistingOrder.splice(i, 1);
  pendingFabricRemovals.push(u);
  renderFabricExistingImages();
}
function stageFabricImages(fileList) {
  pendingFabricImages.push(...Array.from(fileList));
  $("#ff-staged-list").innerHTML = pendingFabricImages.map((f, i) =>
    `<span class="filepill">${esc(f.name)}<button onclick="pendingFabricImages.splice(${i},1);stageFabricImages([])">×</button></span>`).join("");
}
async function saveFabric(id) {
  const code = $("#ff-code").value.trim().toUpperCase();
  if (!code) { toast("El código es obligatorio", true); return; }
  const btn = $("#ff-save-btn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    const payload = {
      code,
      name: $("#ff-name").value.trim() || code,
      category: $("#ff-cat").value,
      grade: $("#ff-grade").value,
      specification: $("#ff-spec").value.trim(),
      composition: $("#ff-comp").value.trim(),
      description: $("#ff-desc").value.trim(),
      probable_use: $("#ff-role").value.trim(),
      compression_score: $("#ff-compscore").value ? parseFloat($("#ff-compscore").value) : null,
      technical_analysis: $("#ff-analysis").value.trim(),
      functions: $all("#ff-functions .tag-opt.on").map(t => t.dataset.tag),
      needs_review: false,
    };
    let fabricId = id;
    if (id) {
      const { error } = await sb.from("topstone_fabrics").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from("topstone_fabrics").insert(payload).select().single();
      if (error) throw error;
      fabricId = data.id;
    }
    // remove images marked for deletion
    for (const url of pendingFabricRemovals) {
      await sb.from("topstone_fabric_images").delete().eq("fabric_id", fabricId).eq("url", url);
      await removeStorageObject(BUCKET_FABRICS, url);
    }
    // NOTE: sort_order is a plain "integer" column (max ~2.1 billion) — it must stay a small
    // sequential index, NOT a millisecond timestamp (Date.now() overflows it and Postgres
    // rejects the insert with "value out of range for type integer", 22003). The upload path
    // filename can safely use Date.now() for uniqueness since that's just text.
    // persist the (possibly reordered) sort_order of images the user kept
    for (let i = 0; i < fabricExistingOrder.length; i++) {
      const { error: ordErr } = await sb.from("topstone_fabric_images")
        .update({ sort_order: i }).eq("fabric_id", fabricId).eq("url", fabricExistingOrder[i]);
      if (ordErr) throw ordErr;
    }
    // upload new images, continuing the order right after the kept ones
    let sortIndex = fabricExistingOrder.length;
    for (const file of pendingFabricImages) {
      const path = `${code}/${Date.now()}_${slugFile(file.name)}`;
      const url = await uploadFile(BUCKET_FABRICS, path, file);
      const { error: imgErr } = await sb.from("topstone_fabric_images").insert({ fabric_id: fabricId, url, sort_order: sortIndex++ });
      if (imgErr) throw imgErr;
    }
    // colors: clear + reinsert (simple + reliable, same pattern as zones/sizes)
    const validColors = fabricColorRows.filter(c => c.color_name.trim());
    await sb.from("topstone_fabric_colors").delete().eq("fabric_id", fabricId);
    for (let i = 0; i < validColors.length; i++) {
      const c = validColors[i];
      let imageUrl = c.existingUrl || "";
      if (c.newFile) {
        const path = `${code}/colors/${Date.now()}_${slugFile(c.newFile.name)}`;
        imageUrl = await uploadFile(BUCKET_FABRICS, path, c.newFile);
      }
      const { error: colErr } = await sb.from("topstone_fabric_colors").insert({
        fabric_id: fabricId, color_name: c.color_name.trim(), color_hex: c.color_hex || "",
        image_url: imageUrl, notes: (c.notes || "").trim(), sort_order: i,
      });
      if (colErr) throw colErr;
    }
    toast("Tela guardada ✓");
    closeAllModals();
    await loadFabrics();
  } catch (e) {
    toast("Error: " + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
  }
}
async function deleteFabric(id) {
  const f = fabrics.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`¿Borrar la tela ${f.code}? También se borrarán sus fotos y se desvinculará de productos que la usen.`)) return;
  try {
    for (const url of f.images) await removeStorageObject(BUCKET_FABRICS, url);
    for (const c of f.colors) if (c.image_url) await removeStorageObject(BUCKET_FABRICS, c.image_url);
    const { error } = await sb.from("topstone_fabrics").delete().eq("id", id);
    if (error) throw error;
    toast("Tela borrada");
    closeAllModals();
    await loadFabrics();
  } catch (e) { toast("Error: " + e.message, true); }
}

// =====================================================================
// CLIENTS
// =====================================================================
async function loadClients() {
  const { data, error } = await sb.from("topstone_clients").select("*").order("name");
  if (error) { toast("Error cargando clientes: " + error.message, true); return; }
  clients = data || [];
  renderClientSelect();
  renderClients();
}
function renderClientSelect() {
  const sel = $("#p-client");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Todo cliente</option>' + clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  sel.value = current;
}
function renderClients() {
  const q = ($("#c-search").value || "").toLowerCase();
  let rows = clients.filter(c => !q || (c.name + " " + c.email + " " + c.code).toLowerCase().includes(q));
  const body = $("#client-rows");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="empty">Sin clientes todavía.</td></tr>'; return; }
  body.innerHTML = rows.map(c => {
    const n = products.filter(p => p.client_id === c.id).length;
    return `<tr>
      <td>${esc(c.code || "—")}</td>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.contact_name || "—")}</td>
      <td>${esc(c.email || "—")}</td>
      <td>${esc(c.phone || "—")}</td>
      <td>${n}</td>
      <td style="display:flex;gap:6px">
        <button class="btn small" onclick="openClientForm('${c.id}')">Editar</button>
        <button class="btn danger small" onclick="deleteClient('${c.id}')">Borrar</button>
      </td>
    </tr>`;
  }).join("");
}
function openClientForm(id) {
  const c = id ? clients.find(x => x.id === id) : null;
  $("#modal-client-form-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${c ? "Editar cliente" : "Agregar cliente"}</h2>
    <label>Nombre *</label><input id="cf-name" value="${c ? esc(c.name) : ""}">
    <label>Contacto</label><input id="cf-contact" value="${c ? esc(c.contact_name) : ""}">
    <label>Email</label><input id="cf-email" value="${c ? esc(c.email) : ""}">
    <label>Teléfono</label><input id="cf-phone" value="${c ? esc(c.phone) : ""}">
    <label>Notas</label><textarea id="cf-notes" rows="3">${c ? esc(c.notes) : ""}</textarea>
    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn primary" id="cf-save-btn" onclick="saveClient('${c ? c.id : ""}')">Guardar</button>
      <button class="btn" onclick="closeAllModals()">Cancelar</button>
    </div>`;
  closeAllModals();
  $("#modal-client-form").classList.add("show");
}
async function saveClient(id) {
  const name = $("#cf-name").value.trim();
  if (!name) { toast("El nombre es obligatorio", true); return; }
  const btn = $("#cf-save-btn"); btn.disabled = true;
  try {
    const payload = {
      name,
      contact_name: $("#cf-contact").value.trim(),
      email: $("#cf-email").value.trim(),
      phone: $("#cf-phone").value.trim(),
      notes: $("#cf-notes").value.trim(),
    };
    let newClientId = null;
    if (id) {
      const { error } = await sb.from("topstone_clients").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data: codeData, error: codeErr } = await sb.rpc("topstone_next_client_code");
      if (codeErr) throw codeErr;
      payload.code = codeData;
      const { data, error } = await sb.from("topstone_clients").insert(payload).select().single();
      if (error) throw error;
      newClientId = data.id;
    }
    window.__lastCreatedClientId = newClientId;
    toast("Cliente guardado ✓");
    closeAllModals();
    await loadClients();
  } catch (e) { toast("Error: " + e.message, true); }
  finally { btn.disabled = false; }
}
async function deleteClient(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Borrar el cliente ${c.name}? Los productos ligados quedarán sin cliente asignado.`)) return;
  const { error } = await sb.from("topstone_clients").delete().eq("id", id);
  if (error) { toast("Error: " + error.message, true); return; }
  toast("Cliente borrado");
  await loadClients();
  await loadProducts();
}

// =====================================================================
// PRODUCTS
// =====================================================================
async function loadProducts() {
  $("#product-rows").innerHTML = '<tr><td colspan="9" class="empty">Cargando productos…</td></tr>';
  const { data, error } = await sb.from("topstone_products").select("*").order("created_at", { ascending: false });
  if (error) { toast("Error cargando productos: " + error.message, true); return; }
  const { data: zones } = await sb.from("topstone_product_fabric_zones").select("product_id");
  const { data: sizes } = await sb.from("topstone_product_sizes").select("product_id, quantity");
  const { data: files } = await sb.from("topstone_product_files").select("product_id");
  const zoneCounts = {}, sizeCounts = {}, fileCounts = {};
  (zones || []).forEach(z => zoneCounts[z.product_id] = (zoneCounts[z.product_id] || 0) + 1);
  (sizes || []).forEach(s => sizeCounts[s.product_id] = (sizeCounts[s.product_id] || 0) + (s.quantity || 0));
  (files || []).forEach(f => fileCounts[f.product_id] = (fileCounts[f.product_id] || 0) + 1);
  products = (data || []).map(p => ({
    ...p,
    client_name: (clients.find(c => c.id === p.client_id) || {}).name || "",
    zone_count: zoneCounts[p.id] || 0,
    size_qty: sizeCounts[p.id] || 0,
    file_count: fileCounts[p.id] || 0,
  }));
  renderProductTypeSelect();
  renderProducts();
  renderClients(); // refresh product counts on client tab
}
function renderProductTypeSelect() {
  const sel = $("#p-type");
  if (sel.options.length <= 1) {
    sel.innerHTML = '<option value="">Todo tipo</option>' + PRODUCT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join("");
  }
}
function renderProducts() {
  const q = ($("#p-search").value || "").toLowerCase();
  const type = $("#p-type").value;
  const clientId = $("#p-client").value;
  let rows = products.filter(p => {
    if (type && p.product_type !== type) return false;
    if (clientId && p.client_id !== clientId) return false;
    if (q && !(p.code + " " + p.name + " " + p.client_name).toLowerCase().includes(q)) return false;
    return true;
  });
  const body = $("#product-rows");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="9" class="empty">No hay productos todavía. Crea el primero con "+ Crear producto".</td></tr>'; return; }
  const typeLabel = v => (PRODUCT_TYPES.find(t => t.value === v) || {}).label || v;
  body.innerHTML = rows.map(p => `
    <tr style="cursor:pointer" onclick="openProductDetail('${p.id}')">
      <td><b style="color:var(--accent2)">${esc(p.code)}</b></td>
      <td>${esc(p.name || "—")}</td>
      <td><span class="badge mid">${esc(typeLabel(p.product_type))}</span></td>
      <td>${esc(p.client_name || "—")}</td>
      <td>${p.zone_count}</td>
      <td>${p.size_qty}</td>
      <td>${p.file_count}</td>
      <td class="small">${fmtDate(p.created_at)}</td>
      <td onclick="event.stopPropagation()">
        <button class="btn small" onclick="openProductForm('${p.id}')">Editar</button>
        <button class="btn danger small" onclick="deleteProduct('${p.id}')">Borrar</button>
      </td>
    </tr>`).join("");
}

let productZoneRows = [];   // [{fabric_id, code, name, zone_name, notes}]
let productSizeRows = [];   // [{size, quantity, gender, note}]
let productFiles = [];      // existing: [{id,file_url,file_name,file_type}]
let productNewFiles = [];   // File objects staged

function openProductForm(id) {
  const p = id ? products.find(x => x.id === id) : null;
  productZoneRows = [];
  productSizeRows = [];
  productNewFiles = [];
  productFiles = [];
  $("#modal-product-form-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${p ? "Editar producto" : "Crear producto"}</h2>
    <div class="formgrid">
      <div><label>Tipo de prenda *</label>
        <select id="pf-type" ${p ? "disabled" : ""}>
          ${PRODUCT_TYPES.map(t => `<option value="${t.value}" ${p?.product_type === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
      </div>
      <div><label>Cliente</label>
        <div style="display:flex;gap:6px">
          <select id="pf-client" style="flex:1">
            <option value="">— sin cliente —</option>
            ${clients.map(c => `<option value="${c.id}" ${p?.client_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
          <button type="button" class="btn small" onclick="quickAddClient()">+ Cliente</button>
        </div>
      </div>
      <div class="full"><label>Nombre del producto</label><input id="pf-name" value="${p ? esc(p.name) : ""}" placeholder="Ej: Jersey Equipo XYZ 2026"></div>
      <div class="full"><label>Descripción</label><textarea id="pf-desc" rows="3">${p ? esc(p.description) : ""}</textarea></div>
    </div>
    <label>Zonas y telas</label>
    <div class="pfz-list" id="pf-zones"></div>
    <button type="button" class="btn small" onclick="addZoneRow()">+ Agregar zona</button>

    <label style="margin-top:18px">Tallas</label>
    <div id="pf-sizes"></div>
    <button type="button" class="btn small" onclick="addSizeRow()">+ Agregar talla</button>

    <label style="margin-top:18px">Recursos (fotos, PDF, PSD, etc.)</label>
    <div id="pf-files-existing"></div>
    <input type="file" id="pf-file-input" multiple onchange="stageProductFiles(this.files)">
    <div id="pf-files-staged"></div>

    <div style="margin-top:18px;display:flex;gap:8px">
      <button class="btn primary" id="pf-save-btn" onclick="saveProduct('${p ? p.id : ""}')">Guardar producto</button>
      <button class="btn" onclick="closeAllModals()">Cancelar</button>
    </div>
    ${p ? `<div class="hint" style="margin-top:10px">Código: <b>${esc(p.code)}</b></div>` : `<div class="hint" style="margin-top:10px">El código se genera automáticamente al guardar.</div>`}
  `;
  closeAllModals();
  $("#modal-product-form").classList.add("show");

  if (id) {
    // load existing zones + sizes + files async
    (async () => {
      const { data: zdata } = await sb.from("topstone_product_fabric_zones").select("*").eq("product_id", id).order("sort_order");
      productZoneRows = (zdata || []).map(z => ({
        fabric_id: z.fabric_id, code: z.fabric_code_snapshot, zone_name: z.zone_name, notes: z.notes || ""
      }));
      const { data: sdata } = await sb.from("topstone_product_sizes").select("*").eq("product_id", id).order("sort_order");
      productSizeRows = (sdata || []).map(s => ({
        size: s.size, quantity: s.quantity, gender: s.gender || "", note: s.note || ""
      }));
      const { data: fdata } = await sb.from("topstone_product_files").select("*").eq("product_id", id);
      productFiles = fdata || [];
      renderZoneRows();
      renderSizeRows();
      renderExistingFiles();
    })();
  } else {
    addZoneRow();
    addSizeRow();
  }
}
function quickAddClient() {
  window.__lastCreatedClientId = null;
  openClientForm(null);
  // after saving, the client list refreshes; hook a one-time listener to reselect
  // the newly created client (tracked by id, not array position) once the modal closes:
  const check = setInterval(() => {
    if (!$("#modal-client-form").classList.contains("show")) {
      clearInterval(check);
      const sel = $("#pf-client");
      if (sel) {
        sel.innerHTML = '<option value="">— sin cliente —</option>' + clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
        if (window.__lastCreatedClientId) sel.value = window.__lastCreatedClientId;
      }
    }
  }, 400);
}
function renderZoneRows() {
  $("#pf-zones").innerHTML = productZoneRows.map((z, i) => `
    <div class="zone-row">
      <div class="autocomplete">
        <label style="margin:0 0 3px">Tela</label>
        <input value="${z.code ? esc(z.code + " — " + (fabrics.find(f=>f.id===z.fabric_id)?.name || "")) : ""}"
               placeholder="Buscar código o nombre…"
               oninput="fabricAutocomplete(this, ${i})" onfocus="fabricAutocomplete(this, ${i})">
        <div class="ac-list" id="ac-list-${i}"></div>
      </div>
      <div><label style="margin:0 0 3px">Zona / uso</label><input value="${esc(z.zone_name || "")}" placeholder="Ej: Mangas" oninput="productZoneRows[${i}].zone_name=this.value"></div>
      <div><label style="margin:0 0 3px">Notas</label><input value="${esc(z.notes || "")}" oninput="productZoneRows[${i}].notes=this.value"></div>
      <button type="button" class="btn danger small" onclick="removeZoneRow(${i})">×</button>
    </div>`).join("");
}
function addZoneRow() {
  productZoneRows.push({ fabric_id: null, code: "", zone_name: "", notes: "" });
  renderZoneRows();
}
function removeZoneRow(i) { productZoneRows.splice(i, 1); renderZoneRows(); }
function renderSizeRows() {
  $("#pf-sizes").innerHTML = productSizeRows.map((s, i) => `
    <div class="size-row">
      <div><label style="margin:0 0 3px">Talla</label>
        <select onchange="productSizeRows[${i}].size=this.value">
          ${SIZE_OPTIONS.map(sz => `<option value="${sz}" ${s.size === sz ? "selected" : ""}>${sz}</option>`).join("")}
        </select>
      </div>
      <div><label style="margin:0 0 3px">Cantidad</label>
        <input type="number" min="1" step="1" value="${s.quantity ?? 1}" oninput="productSizeRows[${i}].quantity=parseInt(this.value)||1">
      </div>
      <div><label style="margin:0 0 3px">Género</label>
        <select onchange="productSizeRows[${i}].gender=this.value">
          <option value="">— sin indicar —</option>
          ${GENDER_OPTIONS.map(g => `<option value="${g}" ${s.gender === g ? "selected" : ""}>${g}</option>`).join("")}
        </select>
      </div>
      <div><label style="margin:0 0 3px">Nota</label><input value="${esc(s.note || "")}" placeholder="Ej: corte ajustado" oninput="productSizeRows[${i}].note=this.value"></div>
      <button type="button" class="btn danger small" onclick="removeSizeRow(${i})">×</button>
    </div>`).join("") || '<div class="small">Sin tallas agregadas.</div>';
}
function addSizeRow() {
  productSizeRows.push({ size: SIZE_OPTIONS[0], quantity: 1, gender: "", note: "" });
  renderSizeRows();
}
function removeSizeRow(i) { productSizeRows.splice(i, 1); renderSizeRows(); }
function fabricAutocomplete(input, i) {
  const q = input.value.toLowerCase();
  const list = $("#ac-list-" + i);
  const matches = fabrics.filter(f => !q || (f.code + " " + f.name).toLowerCase().includes(q)).slice(0, 30);
  list.innerHTML = matches.map(f => `<div class="ac-item" onmousedown="selectFabricForZone(${i}, '${f.id}')">${esc(f.code)} — ${esc(f.name)}</div>`).join("") || '<div class="ac-item">Sin resultados</div>';
  list.classList.add("show");
  input.onblur = () => setTimeout(() => list.classList.remove("show"), 200);
}
function selectFabricForZone(i, fabricId) {
  const f = fabrics.find(x => x.id === fabricId);
  if (!f) return;
  productZoneRows[i].fabric_id = f.id;
  productZoneRows[i].code = f.code;
  renderZoneRows();
}
function renderExistingFiles() {
  $("#pf-files-existing").innerHTML = productFiles.map(f => `
    <span class="filepill">${fileIcon(f.file_type)} <a href="${esc(f.file_url)}" target="_blank">${esc(f.file_name)}</a>
      <button onclick="removeExistingProductFile('${f.id}', this)">×</button></span>`).join("");
}
async function removeExistingProductFile(fid, btn) {
  const f = productFiles.find(x => x.id === fid);
  if (!f) return;
  if (!confirm(`¿Quitar el archivo "${f.file_name}"?`)) return;
  try {
    const { error } = await sb.from("topstone_product_files").delete().eq("id", fid);
    if (error) throw error;
    await removeStorageObject(BUCKET_PRODUCTS, f.file_url);
    productFiles = productFiles.filter(x => x.id !== fid);
    btn.parentElement.remove();
    toast("Archivo eliminado");
  } catch (e) {
    toast("Error borrando archivo: " + e.message, true);
  }
}
function stageProductFiles(fileList) {
  productNewFiles.push(...Array.from(fileList));
  $("#pf-files-staged").innerHTML = productNewFiles.map((f, i) =>
    `<span class="filepill">${fileIcon(fileKind(f.name))} ${esc(f.name)}<button onclick="productNewFiles.splice(${i},1);stageProductFiles([])">×</button></span>`).join("");
}
async function saveProduct(id) {
  const type = $("#pf-type").value;
  const btn = $("#pf-save-btn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    const validZones = productZoneRows.filter(z => z.fabric_id && z.zone_name.trim());
    const payload = {
      product_type: type,
      client_id: $("#pf-client").value || null,
      name: $("#pf-name").value.trim(),
      description: $("#pf-desc").value.trim(),
    };
    let productId = id, code;
    if (id) {
      const { error } = await sb.from("topstone_products").update(payload).eq("id", id);
      if (error) throw error;
      code = products.find(p => p.id === id).code;
    } else {
      const { data: codeData, error: codeErr } = await sb.rpc("topstone_next_product_code", { p_type: type });
      if (codeErr) throw codeErr;
      code = codeData;
      const { data, error } = await sb.from("topstone_products").insert({ ...payload, code }).select().single();
      if (error) throw error;
      productId = data.id;
    }
    // zones: clear + reinsert (simple + reliable)
    await sb.from("topstone_product_fabric_zones").delete().eq("product_id", productId);
    if (validZones.length) {
      await sb.from("topstone_product_fabric_zones").insert(validZones.map((z, i) => ({
        product_id: productId, fabric_id: z.fabric_id, fabric_code_snapshot: z.code,
        zone_name: z.zone_name.trim(), notes: z.notes.trim(), sort_order: i,
      })));
    }
    // sizes: clear + reinsert
    const validSizes = productSizeRows.filter(s => s.size && s.quantity > 0);
    await sb.from("topstone_product_sizes").delete().eq("product_id", productId);
    if (validSizes.length) {
      await sb.from("topstone_product_sizes").insert(validSizes.map((s, i) => ({
        product_id: productId, size: s.size, quantity: s.quantity, gender: s.gender || "",
        note: (s.note || "").trim(), sort_order: i,
      })));
    }
    // files: existing removals already applied immediately via removeExistingProductFile();
    // here we only need to upload newly staged files.
    for (const file of productNewFiles) {
      const path = `${code}/${Date.now()}_${slugFile(file.name)}`;
      const url = await uploadFile(BUCKET_PRODUCTS, path, file);
      await sb.from("topstone_product_files").insert({
        product_id: productId, file_url: url, file_name: file.name, file_type: fileKind(file.name),
      });
    }
    toast(`Producto ${code} guardado ✓`);
    closeAllModals();
    await loadProducts();
  } catch (e) {
    toast("Error: " + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Guardar producto";
  }
}
async function openProductDetail(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const { data: zdata } = await sb.from("topstone_product_fabric_zones").select("*").eq("product_id", id).order("sort_order");
  const { data: sdata } = await sb.from("topstone_product_sizes").select("*").eq("product_id", id).order("sort_order");
  const { data: fdata } = await sb.from("topstone_product_files").select("*").eq("product_id", id);
  const typeLabel = (PRODUCT_TYPES.find(t => t.value === p.product_type) || {}).label || p.product_type;
  $("#modal-product-detail-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${esc(p.code)} <span style="color:var(--muted);font-weight:400">— ${esc(p.name || typeLabel)}</span></h2>
    <div class="row-meta">
      <span class="badge mid">${esc(typeLabel)}</span>
      ${p.client_name ? `<span class="badge cat-tops">${esc(p.client_name)}</span>` : ""}
    </div>
    ${p.description ? `<p class="small">${esc(p.description)}</p>` : ""}
    <label>Zonas de tela</label>
    <div class="pfz-list">
      ${(zdata || []).map(z => {
        const f = fabrics.find(x => x.id === z.fabric_id);
        return `<div class="pfz-item">
          ${f && f.images[0] ? `<img src="${esc(f.images[0])}">` : '<div style="width:44px;height:44px;background:#0b1219;border-radius:6px"></div>'}
          <div class="zn">${esc(z.zone_name)}</div>
          <div style="flex:1"><b>${esc(z.fabric_code_snapshot)}</b> ${f ? "— " + esc(f.name) : ""}${z.notes ? `<div class="small">${esc(z.notes)}</div>` : ""}</div>
        </div>`;
      }).join("") || '<div class="small">Sin zonas asignadas.</div>'}
    </div>
    <label>Tallas</label>
    <div class="table-wrap" style="margin-bottom:10px">
      <table>
        <thead><tr><th>Talla</th><th>Cantidad</th><th>Género</th><th>Nota</th></tr></thead>
        <tbody>
          ${(sdata || []).length ? (sdata || []).map(s => `<tr><td><b>${esc(s.size)}</b></td><td>${s.quantity}</td><td>${esc(s.gender || "—")}</td><td class="small">${esc(s.note || "—")}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">Sin tallas asignadas.</td></tr>'}
        </tbody>
      </table>
    </div>
    <label>Archivos</label>
    <div>${(fdata || []).map(f => `<span class="filepill">${fileIcon(f.file_type)} <a href="${esc(f.file_url)}" target="_blank">${esc(f.file_name)}</a></span>`).join("") || '<div class="small">Sin archivos.</div>'}</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn primary" onclick="closeAllModals();openProductForm('${p.id}')">Editar</button>
      <button class="btn danger" onclick="deleteProduct('${p.id}')">Borrar</button>
    </div>`;
  closeAllModals();
  $("#modal-product-detail").classList.add("show");
}
async function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Borrar el producto ${p.code}?`)) return;
  const { data: fdata } = await sb.from("topstone_product_files").select("*").eq("product_id", id);
  for (const f of (fdata || [])) await removeStorageObject(BUCKET_PRODUCTS, f.file_url);
  const { error } = await sb.from("topstone_products").delete().eq("id", id);
  if (error) { toast("Error: " + error.message, true); return; }
  toast("Producto borrado");
  closeAllModals();
  await loadProducts();
}

// ---------- boot ----------
(async function init() {
  await loadClients();
  await loadFabrics();
  await loadProducts();
})();
