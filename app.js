// ===================== TopStone Fabric Selector =====================
const SUPABASE_URL = "https://cejgurbaweucfpuzvdpw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlamd1cmJhd2V1Y2ZwdXp2ZHB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5OTM5NDYsImV4cCI6MjA5OTU2OTk0Nn0.XuxVRqjznvt5xS1u9Xx1-Fe7qy4yCGUpTKr0XesxrCE";
const BUCKET_FABRICS = "topstone-fabrics";
const BUCKET_PRODUCTS = "topstone-products";
const BUCKET_PADS = "topstone-pads";
const BUCKET_EYEWEAR = "topstone-eyewear";

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
  { value: "speedsuit", label: "Speedsuit" },
];

const SIZE_OPTIONS = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL"];
const GENDER_OPTIONS = ["Hombre", "Mujer", "Unisex"];

// fabricFunctions is now DB-backed (topstone_fabric_functions) instead of a hardcoded list,
// so the user can add/rename/delete characteristics from the UI. Loaded via loadFabricFunctions().
let fabricFunctions = []; // [{id, name, sort_order}]

// Pad/badana characteristics — used by the Pads catalog (topstone_pads), a peer catalog to
// Telas: pads are assigned into products by zone (see productZoneRows), not created as products
// themselves. Terminology based on Elastic Interface's own product literature (chamois-design
// and long-distance-pad guides at elasticinterface.com).
const PAD_GENDER_OPTIONS = ["Hombre", "Mujer", "Unisex", "Niño"];
const PAD_DENSITY_OPTIONS = ["Adaptativa (~80 kg/m³)", "Media (~110 kg/m³)", "Alta / HCS (~200 kg/m³)", "Multi-densidad"];
const PAD_FOAM_OPTIONS = ["Célula cerrada", "Célula abierta", "Híbrida (HCS: cerrada + abierta)", "Reticulada (sandwich 3 capas)"];
const PAD_TOPSHEET_OPTIONS = ["Estándar transpirable", "Super Air Layer (perforado)", "Air Mapping (zonas sin espuma)"];
const PAD_USAGE_OPTIONS = ["Ruta / Road", "Gravel", "MTB", "Triatlón / TT", "Ultra-distancia / Ultracycling"];
const PAD_HOURS_OPTIONS = ["Hasta 3h", "3-5h", "5-8h", "8h+ / Ultra"];
const PAD_ATTACHMENT_OPTIONS = ["Cosido (sewn-in)", "Termosellado / pegado (bonded)"];
const PAD_TREATMENT_OPTIONS = ["Antibacterial", "Secado rápido", "Control térmico", "Anti-rozadura (wings)"];

let fabrics = [];       // cache: [{...fabric, images:[url,...]}]
let pads = [];           // cache: [{...pad}] — topstone_pads, assigned into products by zone
let eyewear = [];        // cache: [{...eyewear model, images:[url,...], variants:[...]}]
let companyProfile = null;
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
  populateFuncFilter();
  renderFabrics();
}

function populateFuncFilter() {
  const sel = $("#f-func");
  if (!sel) return;
  const current = sel.value;
  const known = fabricFunctions.map(f => f.name);
  const found = new Set();
  fabrics.forEach(f => (f.functions || []).forEach(fn => found.add(fn)));
  // keep the known list first (in a sensible order), then any custom/orphan tags found in the data
  const ordered = known.filter(fn => found.has(fn)).concat([...found].filter(fn => !known.includes(fn)).sort());
  sel.innerHTML = '<option value="">Toda característica</option>' + ordered.map(fn => `<option value="${esc(fn)}">${esc(fn)}</option>`).join("");
  sel.value = current;
}

// =====================================================================
// FABRIC FUNCTIONS (characteristics) — DB-backed master list
// =====================================================================
async function loadFabricFunctions() {
  const { data, error } = await sb.from("topstone_fabric_functions").select("*").order("sort_order");
  if (error) { toast("Error cargando características: " + error.message, true); return; }
  fabricFunctions = data || [];
}
function openFuncManager() {
  renderFuncManager();
  closeAllModals();
  $("#modal-func-manager").classList.add("show");
}
function closeFuncManager() {
  closeAllModals();
  // if the fabric form is open behind it, refresh its tag-picker so new/renamed/deleted
  // characteristics show up immediately without losing the ones already selected
  const picker = $("#ff-functions");
  if (picker) {
    const onNames = $all("#ff-functions .tag-opt.on").map(t => t.dataset.tag);
    picker.innerHTML = fabricFunctions.map(fn => {
      const on = onNames.includes(fn.name);
      return `<span class="tag-opt ${on ? "on" : ""}" data-tag="${esc(fn.name)}" onclick="this.classList.toggle('on')">${esc(fn.name)}</span>`;
    }).join("");
  }
  populateFuncFilter();
}
function renderFuncManager() {
  $("#modal-func-manager-body").innerHTML = `
    <button class="close" onclick="closeFuncManager()">×</button>
    <h2>Características de telas</h2>
    <div class="hint" style="margin:0 0 10px">Agrega, renombra o elimina las características disponibles (Funcionalidad). Al renombrar, se actualiza en todas las telas que ya la tengan asignada. Al eliminar, se quita de esas telas — la tela en sí no se borra.</div>
    <div id="func-manager-rows">
      ${fabricFunctions.map(fn => `
        <div class="filepill" style="display:flex;gap:6px;align-items:center;width:100%;margin:0 0 6px 0;padding:6px 8px">
          <input value="${esc(fn.name)}" style="flex:1" id="func-name-${fn.id}" onkeydown="if(event.key==='Enter')renameFabricFunction('${fn.id}')">
          <button class="btn small" onclick="renameFabricFunction('${fn.id}')">Guardar</button>
          <button class="btn danger small" onclick="deleteFabricFunction('${fn.id}','${esc(fn.name).replace(/'/g, "\\'")}')">×</button>
        </div>`).join("") || '<div class="small">Sin características todavía.</div>'}
    </div>
    <div style="display:flex;gap:6px;margin-top:12px">
      <input id="func-new-name" placeholder="Nueva característica (ej: Aero)" style="flex:1" onkeydown="if(event.key==='Enter')addFabricFunction()">
      <button class="btn primary small" onclick="addFabricFunction()">+ Agregar</button>
    </div>
    <div style="margin-top:16px"><button class="btn" onclick="closeFuncManager()">Cerrar</button></div>
  `;
}
async function addFabricFunction() {
  const input = $("#func-new-name");
  const name = input.value.trim();
  if (!name) return;
  const nextOrder = fabricFunctions.length ? Math.max(...fabricFunctions.map(f => f.sort_order)) + 1 : 0;
  const { error } = await sb.from("topstone_fabric_functions").insert({ name, sort_order: nextOrder });
  if (error) { toast(error.code === "23505" ? "Esa característica ya existe" : "Error: " + error.message, true); return; }
  await loadFabricFunctions();
  renderFuncManager();
  toast(`"${name}" agregada ✓`);
}
async function renameFabricFunction(id) {
  const fn = fabricFunctions.find(f => f.id === id);
  const input = $("#func-name-" + id);
  const newName = input.value.trim();
  if (!fn || !newName || newName === fn.name) return;
  const { error } = await sb.from("topstone_fabric_functions").update({ name: newName }).eq("id", id);
  if (error) { toast(error.code === "23505" ? "Ya existe una característica con ese nombre" : "Error: " + error.message, true); input.value = fn.name; return; }
  const { error: cascErr } = await sb.rpc("topstone_rename_fabric_function", { p_old: fn.name, p_new: newName });
  if (cascErr) toast("Se renombró, pero hubo un error actualizando las telas: " + cascErr.message, true);
  await loadFabricFunctions();
  await loadFabrics();
  renderFuncManager();
  toast(`Renombrada a "${newName}" ✓`);
}
async function deleteFabricFunction(id, name) {
  if (!confirm(`¿Eliminar "${name}"? Se quitará de todas las telas que la tengan asignada (las telas no se borran).`)) return;
  const { error: cascErr } = await sb.rpc("topstone_delete_fabric_function", { p_name: name });
  if (cascErr) { toast("Error: " + cascErr.message, true); return; }
  const { error } = await sb.from("topstone_fabric_functions").delete().eq("id", id);
  if (error) { toast("Error: " + error.message, true); return; }
  await loadFabricFunctions();
  await loadFabrics();
  renderFuncManager();
  toast(`"${name}" eliminada ✓`);
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
  const func = $("#f-func") ? $("#f-func").value : "";
  const review = $("#f-review").value;
  const sort = $("#f-sort").value;
  let rows = fabrics.filter(f => {
    if (cat && f.category !== cat) return false;
    if (grade && f.grade !== grade) return false;
    if (func && !(f.functions || []).includes(func)) return false;
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
        <label>Funcionalidad <a href="#" onclick="openFuncManager();return false" style="font-weight:400;font-size:11px;margin-left:8px">⚙ Gestionar características</a></label>
        <div class="tag-picker" id="ff-functions">
          ${fabricFunctions.map(fn => {
            const on = f && (f.functions || []).includes(fn.name);
            return `<span class="tag-opt ${on ? "on" : ""}" data-tag="${esc(fn.name)}" onclick="this.classList.toggle('on')">${esc(fn.name)}</span>`;
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
// PADS — peer catalog to Telas; assigned into products by zone (like fabrics),
// not created as products themselves.
// =====================================================================
async function loadPads() {
  const grid = $("#pad-grid");
  if (grid) grid.innerHTML = '<div class="empty">Cargando pads…</div>';
  const { data, error } = await sb.from("topstone_pads").select("*").order("code");
  if (error) { toast("Error cargando pads: " + error.message, true); return; }
  const { data: idata, error: ierr } = await sb.from("topstone_pad_images").select("*").order("sort_order");
  if (ierr) { toast("Error cargando fotos de pads: " + ierr.message, true); return; }
  const { data: vdata, error: verr } = await sb.from("topstone_pad_variants").select("*").order("sort_order");
  if (verr) { toast("Error cargando variantes de pads: " + verr.message, true); return; }
  const imgMap = {};
  (idata || []).forEach(row => {
    (imgMap[row.pad_id] = imgMap[row.pad_id] || []).push(row.url);
  });
  const varMap = {};
  (vdata || []).forEach(row => {
    (varMap[row.pad_id] = varMap[row.pad_id] || []).push(row);
  });
  pads = (data || []).map(p => ({ ...p, images: imgMap[p.id] || [], variants: varMap[p.id] || [] }));
  renderPads();
}
function padThumb(p) {
  if (p.images && p.images[0]) return p.images[0];
  const withPhoto = (p.variants || []).find(v => v.image_url);
  return withPhoto ? withPhoto.image_url : "";
}
function renderPads() {
  const grid = $("#pad-grid");
  if (!grid) return;
  const q = ($("#pd-search").value || "").toLowerCase();
  const origin = $("#pd-origin") ? $("#pd-origin").value : "";
  let rows = pads.filter(p => !q || (p.code + " " + p.name + " " + p.brand).toLowerCase().includes(q));
  if (origin) rows = rows.filter(p => p.origin === origin);
  if (!rows.length) { grid.innerHTML = '<div class="empty">Sin pads todavía. Crea el primero con "+ Agregar pad".</div>'; return; }
  grid.innerHTML = rows.map(p => {
    const thumb = padThumb(p);
    const genders = (p.variants || []).length ? (p.variants || []).map(v => v.gender).filter(Boolean) : (p.pad_gender ? [p.pad_gender] : []);
    return `
    <div class="card">
      <div class="thumb" onclick="${thumb ? `openImageLightbox('${esc(thumb)}')` : `openPadDetail('${p.id}')`}">${thumb ? `<img loading="lazy" src="${esc(thumb)}">` : '<div class="noimg">Sin imagen</div>'}</div>
      <div class="body" onclick="openPadDetail('${p.id}')">
        <div class="code">${esc(p.code)}</div>
        <div class="name">${esc(p.name || "—")}</div>
        <div class="row-meta">
          ${p.brand ? `<span class="badge mid">${esc(p.brand)}</span>` : ""}
          ${p.origin ? `<span class="badge mid">${esc(p.origin)}</span>` : ""}
          ${genders.map(g => `<span class="badge mid">${esc(g)}</span>`).join("")}
        </div>
        <div class="small">${(p.pad_usage || []).length ? esc(p.pad_usage.join(", ")) : "—"}${p.pad_thickness_mm != null ? " · " + esc(String(p.pad_thickness_mm)) + " mm" : ""}</div>
      </div>
    </div>`;
  }).join("");
}
let padVariantRows = []; // [{gender, supplier_code, thickness_mm, size_text, notes, existingUrl, newFile}]
function openPadForm(id) {
  const p = id ? pads.find(x => x.id === id) : null;
  padVariantRows = p ? p.variants.map(v => ({
    gender: v.gender || "", supplier_code: v.supplier_code || "", thickness_mm: v.thickness_mm ?? "",
    size_text: v.size_text || "", notes: v.notes || "", existingUrl: v.image_url || "", newFile: null,
  })) : [];
  $("#modal-pad-form-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${p ? "Editar pad" : "Agregar pad"}</h2>
    <div class="formgrid">
      <div><label>Nombre</label><input id="pd-name" value="${p ? esc(p.name) : ""}" placeholder="Ej: Ronde HP"></div>
      <div><label>Marca</label><input id="pd-brand" value="${p ? esc(p.brand) : "Elastic Interface"}"></div>
      <div><label>Origen</label>
        <select id="pd-origin-field">
          <option value="">— sin indicar —</option>
          <option value="Doméstico" ${p?.origin === "Doméstico" ? "selected" : ""}>Doméstico</option>
          <option value="Italiano" ${p?.origin === "Italiano" ? "selected" : ""}>Italiano</option>
        </select>
      </div>
      <div><label>Código de proveedor (si no varía por género)</label><input id="pd-supplier-code" value="${p ? esc(p.supplier_code || "") : ""}" placeholder="Ej: KD0015"></div>
      <div><label>Género (si el pad no tiene variantes por género)</label>
        <select id="pd-gender">
          <option value="">— sin indicar —</option>
          ${PAD_GENDER_OPTIONS.map(g => `<option value="${esc(g)}" ${p?.pad_gender === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div><label>Densidad de espuma</label>
        <select id="pd-density">
          <option value="">— sin indicar —</option>
          ${PAD_DENSITY_OPTIONS.map(g => `<option value="${esc(g)}" ${p?.pad_density === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div><label>Tecnología de espuma</label>
        <select id="pd-foam">
          <option value="">— sin indicar —</option>
          ${PAD_FOAM_OPTIONS.map(g => `<option value="${esc(g)}" ${p?.pad_foam_tech === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div><label>Tejido superior (topsheet)</label>
        <select id="pd-topsheet">
          <option value="">— sin indicar —</option>
          ${PAD_TOPSHEET_OPTIONS.map(g => `<option value="${esc(g)}" ${p?.pad_topsheet === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div class="full"><label>Uso recomendado</label>
        <div class="hint" style="margin:0 0 6px">Puedes marcar varios — ej. un pad crossover que sirve para ruta, gravel y MTB a la vez.</div>
        <div class="tag-picker" id="pd-usage">
          ${PAD_USAGE_OPTIONS.map(tag => {
            const on = p && (p.pad_usage || []).includes(tag);
            return `<span class="tag-opt ${on ? "on" : ""}" data-tag="${esc(tag)}" onclick="this.classList.toggle('on')">${esc(tag)}</span>`;
          }).join("")}
        </div>
      </div>
      <div><label>Grosor (mm) — si no varía por género</label><input type="number" id="pd-thickness" min="0" step="0.5" value="${p?.pad_thickness_mm ?? ""}" placeholder="Ej: 8"></div>
      <div><label>Horas de uso recomendadas</label>
        <select id="pd-hours">
          <option value="">— sin indicar —</option>
          ${PAD_HOURS_OPTIONS.map(g => `<option value="${esc(g)}" ${p?.pad_hours === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div><label>Método de fijación</label>
        <select id="pd-attachment">
          <option value="">— sin indicar —</option>
          ${PAD_ATTACHMENT_OPTIONS.map(g => `<option value="${esc(g)}" ${p?.pad_attachment === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div class="full"><label>Tratamientos</label>
        <div class="tag-picker" id="pd-treatments">
          ${PAD_TREATMENT_OPTIONS.map(tag => {
            const on = p && (p.pad_treatments || []).includes(tag);
            return `<span class="tag-opt ${on ? "on" : ""}" data-tag="${esc(tag)}" onclick="this.classList.toggle('on')">${esc(tag)}</span>`;
          }).join("")}
        </div>
      </div>
      <div class="full"><label>Descripción</label><textarea id="pd-desc" rows="3">${p ? esc(p.description) : ""}</textarea></div>
      <div class="full">
        <label>Variantes por género</label>
        <div class="hint" style="margin:0 0 6px">Si este pad viene en versión hombre y mujer (mismo modelo, distinto código de proveedor / grosor / tamaño / foto), agrégalas aquí en vez de crear un pad separado por cada una.</div>
        <div id="pd-variants"></div>
        <button type="button" class="btn small" onclick="addVariantRow()">+ Agregar variante de género</button>
      </div>
    </div>
    <div style="margin-top:18px;display:flex;gap:8px">
      <button class="btn primary" id="pd-save-btn" onclick="savePad('${p ? p.id : ""}')">Guardar pad</button>
      <button class="btn" onclick="closeAllModals()">Cancelar</button>
    </div>
    ${p ? `<div class="hint" style="margin-top:10px">Código: <b>${esc(p.code)}</b></div>` : `<div class="hint" style="margin-top:10px">El código se genera automáticamente al guardar.</div>`}
  `;
  closeAllModals();
  $("#modal-pad-form").classList.add("show");
  renderVariantRows();
}
function renderVariantRows() {
  const el = $("#pd-variants");
  if (!el) return;
  el.innerHTML = padVariantRows.map((v, i) => `
    <div class="color-row">
      <div><label style="margin:0 0 3px">Género *</label>
        <select onchange="padVariantRows[${i}].gender=this.value">
          <option value="">— elegir —</option>
          ${PAD_GENDER_OPTIONS.map(g => `<option value="${esc(g)}" ${v.gender === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select>
      </div>
      <div><label style="margin:0 0 3px">Código proveedor</label><input value="${esc(v.supplier_code || "")}" placeholder="Ej: KD0015" oninput="padVariantRows[${i}].supplier_code=this.value"></div>
      <div><label style="margin:0 0 3px">Grosor (mm)</label><input type="number" min="0" step="0.5" value="${v.thickness_mm ?? ""}" oninput="padVariantRows[${i}].thickness_mm=this.value"></div>
      <div><label style="margin:0 0 3px">Tamaño</label><input value="${esc(v.size_text || "")}" placeholder="Ej: 388×200 mm" oninput="padVariantRows[${i}].size_text=this.value"></div>
      <div>
        <label style="margin:0 0 3px">Foto (opcional)</label>
        ${v.existingUrl && !v.newFile ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><img src="${esc(v.existingUrl)}" style="width:30px;height:30px;object-fit:cover;border-radius:6px"><button type="button" class="btn danger small" style="padding:2px 6px" onclick="padVariantRows[${i}].existingUrl='';renderVariantRows()">×</button></div>` : ""}
        <input type="file" accept="image/*" onchange="stageVariantImage(${i}, this.files[0])">
      </div>
      <button type="button" class="btn danger small" onclick="removeVariantRow(${i})">×</button>
    </div>`).join("") || '<div class="small">Sin variantes agregadas — si este pad no se divide por género, puedes dejar esto vacío y usar el campo "Género" de arriba.</div>';
}
function addVariantRow() {
  padVariantRows.push({ gender: "", supplier_code: "", thickness_mm: "", size_text: "", notes: "", existingUrl: "", newFile: null });
  renderVariantRows();
}
function removeVariantRow(i) { padVariantRows.splice(i, 1); renderVariantRows(); }
function stageVariantImage(i, file) {
  if (!file) return;
  padVariantRows[i].newFile = file;
  renderVariantRows();
}
async function savePad(id) {
  const btn = $("#pd-save-btn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    const thickness = $("#pd-thickness").value;
    const payload = {
      name: $("#pd-name").value.trim(),
      brand: $("#pd-brand").value.trim(),
      origin: $("#pd-origin-field").value,
      supplier_code: $("#pd-supplier-code").value.trim(),
      pad_gender: $("#pd-gender").value,
      pad_density: $("#pd-density").value,
      pad_foam_tech: $("#pd-foam").value,
      pad_topsheet: $("#pd-topsheet").value,
      pad_usage: $all("#pd-usage .tag-opt.on").map(t => t.dataset.tag),
      pad_thickness_mm: thickness ? parseFloat(thickness) : null,
      pad_hours: $("#pd-hours").value,
      pad_attachment: $("#pd-attachment").value,
      pad_treatments: $all("#pd-treatments .tag-opt.on").map(t => t.dataset.tag),
      description: $("#pd-desc").value.trim(),
    };
    let padId = id, code = id ? pads.find(x => x.id === id)?.code : null;
    if (id) {
      const { error } = await sb.from("topstone_pads").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data: codeData, error: codeErr } = await sb.rpc("topstone_next_pad_code");
      if (codeErr) throw codeErr;
      code = codeData;
      const { data, error } = await sb.from("topstone_pads").insert({ ...payload, code }).select().single();
      if (error) throw error;
      padId = data.id;
    }
    // gender variants: clear + reinsert (same pattern as fabric colors/zones)
    const validVariants = padVariantRows.filter(v => v.gender);
    await sb.from("topstone_pad_variants").delete().eq("pad_id", padId);
    for (let i = 0; i < validVariants.length; i++) {
      const v = validVariants[i];
      let imageUrl = v.existingUrl || "";
      if (v.newFile) {
        const path = `${code}/variants/${Date.now()}_${slugFile(v.newFile.name)}`;
        imageUrl = await uploadFile(BUCKET_PADS, path, v.newFile);
      }
      const { error: varErr } = await sb.from("topstone_pad_variants").insert({
        pad_id: padId, gender: v.gender, supplier_code: (v.supplier_code || "").trim(),
        thickness_mm: v.thickness_mm ? parseFloat(v.thickness_mm) : null,
        size_text: (v.size_text || "").trim(), notes: (v.notes || "").trim(), sort_order: i,
        image_url: imageUrl,
      });
      if (varErr) throw varErr;
    }
    toast(`Pad ${code} guardado ✓`);
    closeAllModals();
    await loadPads();
  } catch (e) {
    toast("Error: " + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Guardar pad";
  }
}
function openPadDetail(id) {
  const p = pads.find(x => x.id === id);
  if (!p) return;
  $("#modal-pad-detail-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${esc(p.code)} <span style="color:var(--muted);font-weight:400">— ${esc(p.name || "Pad")}</span></h2>
    <div class="row-meta">
      ${p.brand ? `<span class="badge mid">${esc(p.brand)}</span>` : ""}
      ${p.origin ? `<span class="badge mid">${esc(p.origin)}</span>` : ""}
      ${p.supplier_code ? `<span class="badge mid">Prov: ${esc(p.supplier_code)}</span>` : ""}
    </div>
    ${(p.images || []).length ? `<div class="gallery">${p.images.map(u => `<img src="${esc(u)}" onclick="openImageLightbox('${esc(u)}')">`).join("")}</div>` : ""}
    ${p.description ? `<p class="small">${esc(p.description)}</p>` : ""}
    <div class="table-wrap" style="margin-bottom:10px">
      <table>
        <tbody>
          ${!p.variants.length ? `<tr><td><b>Género</b></td><td>${esc(p.pad_gender || "—")}</td></tr>` : ""}
          <tr><td><b>Densidad de espuma</b></td><td>${esc(p.pad_density || "—")}</td></tr>
          <tr><td><b>Tecnología de espuma</b></td><td>${esc(p.pad_foam_tech || "—")}</td></tr>
          <tr><td><b>Tejido superior</b></td><td>${esc(p.pad_topsheet || "—")}</td></tr>
          <tr><td><b>Uso recomendado</b></td><td>${(p.pad_usage || []).length ? p.pad_usage.map(esc).join(", ") : "—"}</td></tr>
          ${!p.variants.length ? `<tr><td><b>Grosor</b></td><td>${p.pad_thickness_mm != null ? esc(String(p.pad_thickness_mm)) + " mm" : "—"}</td></tr>` : ""}
          <tr><td><b>Horas de uso</b></td><td>${esc(p.pad_hours || "—")}</td></tr>
          <tr><td><b>Fijación</b></td><td>${esc(p.pad_attachment || "—")}</td></tr>
          <tr><td><b>Tratamientos</b></td><td>${(p.pad_treatments || []).length ? (p.pad_treatments || []).map(esc).join(", ") : "—"}</td></tr>
        </tbody>
      </table>
    </div>
    ${p.variants.length ? `
    <div style="margin-bottom:10px">
      <div class="small" style="margin-bottom:6px"><b>Variantes por género</b></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${p.variants.map(v => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;min-width:160px">
            ${v.image_url ? `<img src="${esc(v.image_url)}" style="width:100%;max-width:140px;border-radius:8px;cursor:pointer;margin-bottom:6px" onclick="openImageLightbox('${esc(v.image_url)}')">` : ""}
            <div><b>${esc(v.gender || "—")}</b></div>
            ${v.supplier_code ? `<div class="small">Prov: ${esc(v.supplier_code)}</div>` : ""}
            ${v.thickness_mm != null ? `<div class="small">${esc(String(v.thickness_mm))} mm</div>` : ""}
            ${v.size_text ? `<div class="small">${esc(v.size_text)}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>` : ""}
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn primary" onclick="closeAllModals();openPadForm('${p.id}')">Editar</button>
      <button class="btn danger" onclick="deletePad('${p.id}')">Borrar</button>
    </div>`;
  closeAllModals();
  $("#modal-pad-detail").classList.add("show");
}
async function deletePad(id) {
  const p = pads.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Borrar el pad ${p.code}? Se desvinculará de las zonas de producto que lo usen (esas zonas quedan sin pad asignado).`)) return;
  try {
    for (const url of p.images) await removeStorageObject(BUCKET_PADS, url);
    for (const v of p.variants) if (v.image_url) await removeStorageObject(BUCKET_PADS, v.image_url);
    const { error } = await sb.from("topstone_pads").delete().eq("id", id);
    if (error) throw error;
    toast("Pad borrado");
    closeAllModals();
    await loadPads();
  } catch (e) { toast("Error: " + e.message, true); }
}

// =====================================================================
// EYEWEAR (Anteojos) — peer catalog to Pads: model with color/lens variants
// inside, each variant carrying its own cost/SRP price and photo. Used
// internally to build supplier orders (see ORDER BUILDER below).
// =====================================================================
async function loadEyewear() {
  const grid = $("#ey-grid");
  if (grid) grid.innerHTML = '<div class="empty">Cargando anteojos…</div>';
  const { data, error } = await sb.from("topstone_eyewear").select("*").order("code");
  if (error) { toast("Error cargando anteojos: " + error.message, true); return; }
  const { data: idata, error: ierr } = await sb.from("topstone_eyewear_images").select("*").order("sort_order");
  if (ierr) { toast("Error cargando fotos de anteojos: " + ierr.message, true); return; }
  const { data: vdata, error: verr } = await sb.from("topstone_eyewear_variants").select("*").order("sort_order");
  if (verr) { toast("Error cargando variantes de anteojos: " + verr.message, true); return; }
  const imgMap = {};
  (idata || []).forEach(row => { (imgMap[row.eyewear_id] = imgMap[row.eyewear_id] || []).push(row.url); });
  const varMap = {};
  (vdata || []).forEach(row => { (varMap[row.eyewear_id] = varMap[row.eyewear_id] || []).push(row); });
  eyewear = (data || []).map(e => ({ ...e, images: imgMap[e.id] || [], variants: varMap[e.id] || [] }));
  populateEyewearSeriesFilter();
  renderEyewear();
}
function populateEyewearSeriesFilter() {
  const sel = $("#ey-series");
  if (!sel) return;
  const current = sel.value;
  const series = [...new Set(eyewear.map(e => e.series).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Toda serie</option>' + series.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  sel.value = current;
}
function eyewearThumb(e) {
  if (e.images && e.images[0]) return e.images[0];
  const withPhoto = (e.variants || []).find(v => v.image_url);
  return withPhoto ? withPhoto.image_url : "";
}
function renderEyewear() {
  const grid = $("#ey-grid");
  if (!grid) return;
  const q = ($("#ey-search").value || "").toLowerCase();
  const series = $("#ey-series") ? $("#ey-series").value : "";
  let rows = eyewear.filter(e => {
    if (series && e.series !== series) return false;
    if (!q) return true;
    const hay = [e.code, e.name, e.series, e.brand, ...(e.variants || []).map(v => v.variant_code + " " + v.spec_text)].join(" ").toLowerCase();
    return hay.includes(q);
  });
  if (!rows.length) { grid.innerHTML = '<div class="empty">Sin anteojos todavía. Crea el primero con "+ Agregar modelo".</div>'; return; }
  grid.innerHTML = rows.map(e => {
    const thumb = eyewearThumb(e);
    const costs = (e.variants || []).map(v => v.cost_price).filter(v => v != null);
    const priceRange = costs.length ? (Math.min(...costs) === Math.max(...costs) ? `$${esc(String(Math.min(...costs)))}` : `$${esc(String(Math.min(...costs)))}–$${esc(String(Math.max(...costs)))}`) : "—";
    return `
    <div class="card">
      <div class="thumb" onclick="${thumb ? `openImageLightbox('${esc(thumb)}')` : `openEyewearDetail('${e.id}')`}">${thumb ? `<img loading="lazy" src="${esc(thumb)}">` : '<div class="noimg">Sin imagen</div>'}</div>
      <div class="body" onclick="openEyewearDetail('${e.id}')">
        <div class="code">${esc(e.code)}</div>
        <div class="name">${esc(e.name || "—")}</div>
        <div class="row-meta">
          ${e.series ? `<span class="badge mid">${esc(e.series)}</span>` : ""}
          <span class="badge mid">${(e.variants || []).length} variante${(e.variants || []).length === 1 ? "" : "s"}</span>
        </div>
        <div class="small">Costo: ${priceRange}</div>
      </div>
    </div>`;
  }).join("");
}
let eyVariantRows = []; // [{variant_code, spec_text, cost_price, srp_price, existingUrl, newFile}]
function openEyewearForm(id) {
  const e = id ? eyewear.find(x => x.id === id) : null;
  eyVariantRows = e ? e.variants.map(v => ({
    variant_code: v.variant_code || "", spec_text: v.spec_text || "",
    cost_price: v.cost_price ?? "", srp_price: v.srp_price ?? "",
    existingUrl: v.image_url || "", newFile: null,
  })) : [];
  $("#modal-eyewear-form-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${e ? "Editar modelo" : "Agregar modelo"}</h2>
    <div class="formgrid">
      <div><label>Modelo</label><input id="ey-name" value="${e ? esc(e.name) : ""}" placeholder="Ej: Lumina"></div>
      <div><label>Serie</label><input id="ey-series-field" value="${e ? esc(e.series) : ""}" placeholder="Ej: CYCLING, Running, Youth…" list="ey-series-list">
        <datalist id="ey-series-list">${[...new Set(eyewear.map(x => x.series).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      </div>
      <div><label>Marca</label><input id="ey-brand" value="${e ? esc(e.brand) : "NSVE"}"></div>
      <div class="full"><label>Descripción</label><textarea id="ey-desc" rows="2">${e ? esc(e.description) : ""}</textarea></div>
      <div class="full">
        <label>Variantes (color / lente)</label>
        <div class="hint" style="margin:0 0 6px">Cada colorway del modelo con su propio código de proveedor, especificación, precio costo, SRP y foto.</div>
        <div id="ey-variants"></div>
        <button type="button" class="btn small" onclick="addEyVariantRow()">+ Agregar variante</button>
      </div>
    </div>
    <div style="margin-top:18px;display:flex;gap:8px">
      <button class="btn primary" id="ey-save-btn" onclick="saveEyewear('${e ? e.id : ""}')">Guardar modelo</button>
      <button class="btn" onclick="closeAllModals()">Cancelar</button>
    </div>
    ${e ? `<div class="hint" style="margin-top:10px">Código: <b>${esc(e.code)}</b></div>` : `<div class="hint" style="margin-top:10px">El código se genera automáticamente al guardar.</div>`}
  `;
  closeAllModals();
  $("#modal-eyewear-form").classList.add("show");
  renderEyVariantRows();
}
function renderEyVariantRows() {
  const el = $("#ey-variants");
  if (!el) return;
  el.innerHTML = eyVariantRows.map((v, i) => `
    <div class="color-row" style="grid-template-columns:1.2fr 2fr .8fr .8fr auto auto">
      <div><label style="margin:0 0 3px">Código proveedor *</label><input value="${esc(v.variant_code || "")}" placeholder="Ej: XS60011|TT/PK" oninput="eyVariantRows[${i}].variant_code=this.value"></div>
      <div><label style="margin:0 0 3px">Especificación</label><input value="${esc(v.spec_text || "")}" placeholder="Color marco / lente, tratamiento…" oninput="eyVariantRows[${i}].spec_text=this.value"></div>
      <div><label style="margin:0 0 3px">Precio costo</label><input type="number" min="0" step="0.01" value="${v.cost_price ?? ""}" oninput="eyVariantRows[${i}].cost_price=this.value"></div>
      <div><label style="margin:0 0 3px">SRP</label><input type="number" min="0" step="0.01" value="${v.srp_price ?? ""}" oninput="eyVariantRows[${i}].srp_price=this.value"></div>
      <div>
        <label style="margin:0 0 3px">Foto</label>
        ${v.existingUrl && !v.newFile ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><img src="${esc(v.existingUrl)}" style="width:30px;height:30px;object-fit:cover;border-radius:6px"><button type="button" class="btn danger small" style="padding:2px 6px" onclick="eyVariantRows[${i}].existingUrl='';renderEyVariantRows()">×</button></div>` : ""}
        <input type="file" accept="image/*" onchange="stageEyVariantImage(${i}, this.files[0])">
      </div>
      <button type="button" class="btn danger small" onclick="removeEyVariantRow(${i})">×</button>
    </div>`).join("") || '<div class="small">Sin variantes agregadas — agrega al menos un colorway.</div>';
}
function addEyVariantRow() {
  eyVariantRows.push({ variant_code: "", spec_text: "", cost_price: "", srp_price: "", existingUrl: "", newFile: null });
  renderEyVariantRows();
}
function removeEyVariantRow(i) { eyVariantRows.splice(i, 1); renderEyVariantRows(); }
function stageEyVariantImage(i, file) {
  if (!file) return;
  eyVariantRows[i].newFile = file;
  renderEyVariantRows();
}
async function saveEyewear(id) {
  const btn = $("#ey-save-btn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    const payload = {
      name: $("#ey-name").value.trim(),
      series: $("#ey-series-field").value.trim(),
      brand: $("#ey-brand").value.trim(),
      description: $("#ey-desc").value.trim(),
    };
    let eyewearId = id, code = id ? eyewear.find(x => x.id === id)?.code : null;
    if (id) {
      const { error } = await sb.from("topstone_eyewear").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data: codeData, error: codeErr } = await sb.rpc("topstone_next_eyewear_code");
      if (codeErr) throw codeErr;
      code = codeData;
      const { data, error } = await sb.from("topstone_eyewear").insert({ ...payload, code }).select().single();
      if (error) throw error;
      eyewearId = data.id;
    }
    // variants: clear + reinsert (same pattern as pad gender variants / fabric colors)
    const validVariants = eyVariantRows.filter(v => v.variant_code.trim());
    await sb.from("topstone_eyewear_variants").delete().eq("eyewear_id", eyewearId);
    for (let i = 0; i < validVariants.length; i++) {
      const v = validVariants[i];
      let imageUrl = v.existingUrl || "";
      if (v.newFile) {
        const path = `${code}/variants/${Date.now()}_${slugFile(v.newFile.name)}`;
        imageUrl = await uploadFile(BUCKET_EYEWEAR, path, v.newFile);
      }
      const { error: varErr } = await sb.from("topstone_eyewear_variants").insert({
        eyewear_id: eyewearId, variant_code: v.variant_code.trim(), spec_text: (v.spec_text || "").trim(),
        cost_price: v.cost_price !== "" ? parseFloat(v.cost_price) : null,
        srp_price: v.srp_price !== "" ? parseFloat(v.srp_price) : null,
        sort_order: i, image_url: imageUrl,
      });
      if (varErr) throw varErr;
    }
    toast(`Modelo ${code} guardado ✓`);
    closeAllModals();
    await loadEyewear();
  } catch (e2) {
    toast("Error: " + e2.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Guardar modelo";
  }
}
function openEyewearDetail(id) {
  const e = eyewear.find(x => x.id === id);
  if (!e) return;
  $("#modal-eyewear-detail-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>${esc(e.code)} <span style="color:var(--muted);font-weight:400">— ${esc(e.name || "Modelo")}</span></h2>
    <div class="row-meta">
      ${e.series ? `<span class="badge mid">${esc(e.series)}</span>` : ""}
      ${e.brand ? `<span class="badge mid">${esc(e.brand)}</span>` : ""}
    </div>
    ${(e.images || []).length ? `<div class="gallery">${e.images.map(u => `<img src="${esc(u)}" onclick="openImageLightbox('${esc(u)}')">`).join("")}</div>` : ""}
    ${e.description ? `<p class="small">${esc(e.description)}</p>` : ""}
    <div style="margin-bottom:10px">
      <div class="small" style="margin-bottom:6px"><b>Variantes (${(e.variants || []).length})</b> · <a href="#" onclick="closeAllModals();openOrderBuilder();return false">🧾 Ver pedido completo</a></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${(e.variants || []).map(v => { const it = orderItems[v.id]; return `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;min-width:170px">
            ${v.image_url ? `<img src="${esc(v.image_url)}" style="width:100%;max-width:150px;border-radius:8px;cursor:pointer;margin-bottom:6px" onclick="openImageLightbox('${esc(v.image_url)}')">` : ""}
            <div><b>${esc(v.variant_code || "—")}</b></div>
            ${v.spec_text ? `<div class="small">${esc(v.spec_text)}</div>` : ""}
            <div class="small">Costo: ${v.cost_price != null ? "$" + esc(String(v.cost_price)) : "—"} · SRP: ${v.srp_price != null ? "$" + esc(String(v.srp_price)) : "—"}</div>
            <div style="margin-top:8px;display:flex;gap:6px">
              <input type="number" min="0" step="1" placeholder="Cant." value="${it ? it.qty : ""}" style="width:64px" oninput="setOrderItemQty('${v.id}', this.value)">
              <input type="text" placeholder="Nota (opcional)" value="${it ? esc(it.note || "") : ""}" style="flex:1;min-width:0" oninput="setOrderItemNote('${v.id}', this.value)">
            </div>
            <div class="small" id="oi-status-${v.id}" style="margin-top:4px;color:var(--muted)">${it && it.qty > 0 ? `En el pedido: ${it.qty}` : ""}</div>
          </div>`; }).join("")}
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn primary" onclick="closeAllModals();openEyewearForm('${e.id}')">Editar</button>
      <button class="btn danger" onclick="deleteEyewear('${e.id}')">Borrar</button>
    </div>`;
  closeAllModals();
  $("#modal-eyewear-detail").classList.add("show");
}
async function deleteEyewear(id) {
  const e = eyewear.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`¿Borrar el modelo ${e.code}? Se borrarán todas sus variantes y fotos.`)) return;
  try {
    for (const url of e.images) await removeStorageObject(BUCKET_EYEWEAR, url);
    for (const v of e.variants) if (v.image_url) await removeStorageObject(BUCKET_EYEWEAR, v.image_url);
    const { error } = await sb.from("topstone_eyewear").delete().eq("id", id);
    if (error) throw error;
    toast("Modelo borrado");
    closeAllModals();
    await loadEyewear();
  } catch (err) { toast("Error: " + err.message, true); }
}

// =====================================================================
// COMPANY PROFILE — editable header used on order (pedido) XLS exports
// =====================================================================
async function loadCompanyProfile() {
  const { data, error } = await sb.from("topstone_company_profile").select("*").eq("id", "default").maybeSingle();
  if (error) { toast("Error cargando datos de empresa: " + error.message, true); return; }
  companyProfile = data || { id: "default", company_name: "", tax_id: "", address: "", phone: "", email: "", contact_name: "", notes: "" };
}
function openCompanyProfileForm() {
  const c = companyProfile || {};
  $("#modal-company-profile-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>Datos de la empresa</h2>
    <div class="hint" style="margin-bottom:10px">Este encabezado se usa al generar el XLS de pedidos.</div>
    <div class="formgrid">
      <div class="full"><label>Nombre de la empresa</label><input id="cp-name" value="${esc(c.company_name || "")}"></div>
      <div><label>RFC / Tax ID</label><input id="cp-tax" value="${esc(c.tax_id || "")}"></div>
      <div><label>Teléfono</label><input id="cp-phone" value="${esc(c.phone || "")}"></div>
      <div class="full"><label>Dirección</label><input id="cp-address" value="${esc(c.address || "")}"></div>
      <div><label>Email</label><input id="cp-email" value="${esc(c.email || "")}"></div>
      <div><label>Persona de contacto</label><input id="cp-contact" value="${esc(c.contact_name || "")}"></div>
      <div class="full"><label>Notas</label><textarea id="cp-notes" rows="2">${esc(c.notes || "")}</textarea></div>
    </div>
    <div style="margin-top:18px;display:flex;gap:8px">
      <button class="btn primary" id="cp-save-btn" onclick="saveCompanyProfile()">Guardar</button>
      <button class="btn" onclick="closeAllModals()">Cancelar</button>
    </div>`;
  closeAllModals();
  $("#modal-company-profile").classList.add("show");
}
async function saveCompanyProfile() {
  const btn = $("#cp-save-btn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    const payload = {
      id: "default",
      company_name: $("#cp-name").value.trim(),
      tax_id: $("#cp-tax").value.trim(),
      address: $("#cp-address").value.trim(),
      phone: $("#cp-phone").value.trim(),
      email: $("#cp-email").value.trim(),
      contact_name: $("#cp-contact").value.trim(),
      notes: $("#cp-notes").value.trim(),
    };
    const { error } = await sb.from("topstone_company_profile").upsert(payload);
    if (error) throw error;
    companyProfile = payload;
    toast("Datos de la empresa guardados ✓");
    closeAllModals();
  } catch (e) {
    toast("Error: " + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

// =====================================================================
// ORDER BUILDER — one continuous, searchable list of every model/variant,
// each row with its own cantidad + nota inputs wired directly to the cart
// (orderItems) — editing a row updates the cart instantly, no separate
// add dialog or screen to leave and come back to. The same cantidad/nota
// inputs also appear inline on each variant inside the eyewear detail view
// (openEyewearDetail), sharing the same setOrderItemQty/setOrderItemNote
// functions, so adding from there updates the same cart live. Export the
// cart (rows with cantidad > 0) as a supplier-order XLS.
// =====================================================================
let orderItems = {}; // variant_id -> { qty, note }

function variantById(variantId) {
  for (const e of eyewear) {
    const v = (e.variants || []).find(x => x.id === variantId);
    if (v) return { ...v, _model: e };
  }
  return null;
}

function openOrderBuilder() {
  $("#modal-order-builder-body").innerHTML = `
    <button class="close" onclick="closeAllModals()">×</button>
    <h2>Generar pedido</h2>
    <div class="hint" style="margin-bottom:10px">Indica cantidad (y nota, opcional) junto a cada modelo/variante — queda agregado al pedido al instante. El encabezado usa los <a href="#" onclick="closeAllModals();openCompanyProfileForm();return false">datos de la empresa</a>.</div>
    <div class="formgrid" style="margin-bottom:10px">
      <div><label>Fecha del pedido</label><input type="date" id="ob-date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <input id="ob-search" placeholder="Buscar código, modelo, variante…" style="margin-bottom:10px" oninput="renderOrderList()">
    <div id="ob-list" style="display:flex;flex-direction:column;gap:8px;max-height:430px;overflow:auto;margin-bottom:10px"></div>
    <div style="display:flex;justify-content:flex-end;margin:10px 0;font-size:16px"><b>Total: <span id="ob-total">$0.00</span></b></div>
    <div style="display:flex;gap:8px">
      <button class="btn primary" onclick="exportOrderXLS()">⬇ Descargar XLS</button>
      <button class="btn" onclick="closeAllModals()">Cerrar</button>
    </div>`;
  closeAllModals();
  $("#modal-order-builder").classList.add("show");
  renderOrderList();
}
function renderOrderList() {
  const list = $("#ob-list");
  if (!list) return;
  const q = ($("#ob-search") ? $("#ob-search").value : "").toLowerCase().trim();
  const rows = [];
  eyewear.forEach(e => {
    (e.variants || []).forEach(v => {
      const hay = `${e.code || ""} ${e.name || ""} ${e.series || ""} ${v.variant_code || ""} ${v.spec_text || ""}`.toLowerCase();
      if (q && !hay.includes(q)) return;
      const it = orderItems[v.id];
      const qty = it ? it.qty : 0;
      const note = it ? (it.note || "") : "";
      rows.push(`
        <div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;flex-wrap:wrap">
          ${v.image_url ? `<img src="${esc(v.image_url)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex:none">` : `<div style="width:40px;height:40px;border-radius:6px;background:var(--bg2);flex:none"></div>`}
          <div style="flex:1;min-width:160px">
            <div><b>${esc(e.name || "—")}</b> <span class="small" style="color:var(--muted)">${esc(v.variant_code || "")}</span></div>
            <div class="small" style="color:var(--muted)">${esc(e.series || "")}${v.spec_text ? " · " + esc(v.spec_text) : ""}</div>
          </div>
          <div class="small" style="width:56px;flex:none">${v.cost_price != null ? "$" + esc(String(v.cost_price)) : "—"}</div>
          <input type="number" min="0" step="1" placeholder="Cant." value="${qty || ""}" style="width:64px;flex:none" oninput="setOrderItemQty('${v.id}', this.value)">
          <input type="text" placeholder="Nota" value="${esc(note)}" style="width:150px;flex:none" oninput="setOrderItemNote('${v.id}', this.value)">
          <div class="small ob-subtotal" data-variant="${v.id}" style="width:66px;flex:none;text-align:right">${money(qty * (v.cost_price || 0))}</div>
          <button class="btn small" style="flex:none" onclick="clearOrderItem('${v.id}')" title="Quitar del pedido">✕</button>
        </div>`);
    });
  });
  list.innerHTML = rows.join("") || '<div class="empty">No hay anteojos cargados todavía.</div>';
  updateOrderTotal();
}
function money(n) { return "$" + (Math.round(n * 100) / 100).toFixed(2); }
function updateOrderTotal() {
  let total = 0;
  Object.keys(orderItems).forEach(id => {
    const v = variantById(id);
    if (v) total += (orderItems[id].qty || 0) * (v.cost_price || 0);
  });
  const el = $("#ob-total");
  if (el) el.textContent = money(total);
}
function setOrderItemQty(variantId, val) {
  const qty = parseInt(val, 10) || 0;
  if (!orderItems[variantId]) orderItems[variantId] = { qty: 0, note: "" };
  orderItems[variantId].qty = qty;
  if (qty <= 0 && !orderItems[variantId].note) delete orderItems[variantId];
  refreshOrderUI(variantId);
}
function setOrderItemNote(variantId, val) {
  const note = val || "";
  if (!orderItems[variantId]) orderItems[variantId] = { qty: 0, note: "" };
  orderItems[variantId].note = note;
  if ((orderItems[variantId].qty || 0) <= 0 && !note) delete orderItems[variantId];
  refreshOrderUI(variantId);
}
function clearOrderItem(variantId) {
  delete orderItems[variantId];
  if ($("#ob-list")) renderOrderList(); else refreshOrderUI(variantId);
}
function refreshOrderUI(variantId) {
  const v = variantById(variantId);
  const it = orderItems[variantId];
  const qty = it ? (it.qty || 0) : 0;
  const cell = document.querySelector(`.ob-subtotal[data-variant="${variantId}"]`);
  if (cell && v) cell.textContent = money(qty * (v.cost_price || 0));
  const status = document.getElementById(`oi-status-${variantId}`);
  if (status) status.textContent = qty > 0 ? `En el pedido: ${qty}` : "";
  updateOrderTotal();
}

function exportOrderXLS() {
  const items = [];
  Object.keys(orderItems).forEach(id => {
    const v = variantById(id);
    if (!v) return;
    const it = orderItems[id];
    if ((it.qty || 0) > 0) items.push({ series: v._model.series, model: v._model.name, code: v.variant_code, spec: v.spec_text, cost: v.cost_price || 0, qty: it.qty, note: it.note || "", subtotal: it.qty * (v.cost_price || 0) });
  });
  if (!items.length) { toast("Agrega al menos un modelo al pedido", true); return; }
  const c = companyProfile || {};
  const dateVal = $("#ob-date") ? $("#ob-date").value : new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([c.company_name || "(sin nombre de empresa — configúralo en 'Datos de la empresa')"]);
  if (c.tax_id) aoa.push(["RFC / Tax ID:", c.tax_id]);
  if (c.address) aoa.push(["Dirección:", c.address]);
  if (c.phone) aoa.push(["Teléfono:", c.phone]);
  if (c.email) aoa.push(["Email:", c.email]);
  if (c.contact_name) aoa.push(["Contacto:", c.contact_name]);
  aoa.push(["Fecha del pedido:", dateVal]);
  aoa.push([]);
  aoa.push(["Serie", "Modelo", "Código variante", "Especificación", "Precio costo", "Cantidad", "Nota", "Subtotal"]);
  items.forEach(it => aoa.push([it.series, it.model, it.code, it.spec, it.cost, it.qty, it.note, it.subtotal]));
  aoa.push([]);
  const grandTotal = items.reduce((s, it) => s + it.subtotal, 0);
  const totalUnits = items.reduce((s, it) => s + it.qty, 0);
  aoa.push(["", "", "", "", "Total unidades:", totalUnits, "", ""]);
  aoa.push(["", "", "", "", "TOTAL:", "", "", grandTotal]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedido");
  XLSX.writeFile(wb, `pedido_anteojos_${dateVal}.xlsx`);
  toast("XLS generado ✓");
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

    <label>Zonas (telas y pads)</label>
    <div class="hint" style="margin:0 0 6px">Agrega una fila por cada zona de la prenda. Elige si esa zona usa una tela o un pad, y busca el código o nombre.</div>
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
        item_type: z.item_type || "fabric",
        fabric_id: z.fabric_id, pad_id: z.pad_id,
        code: z.item_type === "pad" ? z.pad_code_snapshot : z.fabric_code_snapshot,
        zone_name: z.zone_name, notes: z.notes || ""
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
  $("#pf-zones").innerHTML = productZoneRows.map((z, i) => {
    const isPad = z.item_type === "pad";
    const itemName = isPad ? (pads.find(p => p.id === z.pad_id)?.name || "") : (fabrics.find(f => f.id === z.fabric_id)?.name || "");
    return `
    <div class="zone-row">
      <div><label style="margin:0 0 3px">Tipo</label>
        <select onchange="setZoneItemType(${i}, this.value)">
          <option value="fabric" ${!isPad ? "selected" : ""}>Tela</option>
          <option value="pad" ${isPad ? "selected" : ""}>Pad</option>
        </select>
      </div>
      <div class="autocomplete">
        <label style="margin:0 0 3px">${isPad ? "Pad" : "Tela"}</label>
        <input value="${z.code ? esc(z.code + " — " + itemName) : ""}"
               placeholder="Buscar código o nombre…"
               oninput="itemAutocomplete(this, ${i})" onfocus="itemAutocomplete(this, ${i})">
        <div class="ac-list" id="ac-list-${i}"></div>
      </div>
      <div><label style="margin:0 0 3px">Zona / uso</label><input value="${esc(z.zone_name || "")}" placeholder="Ej: Mangas" oninput="productZoneRows[${i}].zone_name=this.value"></div>
      <div><label style="margin:0 0 3px">Notas</label><input value="${esc(z.notes || "")}" oninput="productZoneRows[${i}].notes=this.value"></div>
      <button type="button" class="btn danger small" onclick="removeZoneRow(${i})">×</button>
    </div>`;
  }).join("");
}
function addZoneRow() {
  productZoneRows.push({ item_type: "fabric", fabric_id: null, pad_id: null, code: "", zone_name: "", notes: "" });
  renderZoneRows();
}
function removeZoneRow(i) { productZoneRows.splice(i, 1); renderZoneRows(); }
function setZoneItemType(i, type) {
  productZoneRows[i].item_type = type;
  productZoneRows[i].fabric_id = null;
  productZoneRows[i].pad_id = null;
  productZoneRows[i].code = "";
  renderZoneRows();
}
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
function itemAutocomplete(input, i) {
  const q = input.value.toLowerCase();
  const list = $("#ac-list-" + i);
  const isPad = productZoneRows[i].item_type === "pad";
  const source = isPad ? pads : fabrics;
  const matches = source.filter(x => !q || (x.code + " " + x.name).toLowerCase().includes(q)).slice(0, 30);
  list.innerHTML = matches.map(x => `<div class="ac-item" onmousedown="selectItemForZone(${i}, '${x.id}')">${esc(x.code)} — ${esc(x.name)}</div>`).join("") || '<div class="ac-item">Sin resultados</div>';
  list.classList.add("show");
  input.onblur = () => setTimeout(() => list.classList.remove("show"), 200);
}
function selectItemForZone(i, itemId) {
  const isPad = productZoneRows[i].item_type === "pad";
  const x = (isPad ? pads : fabrics).find(v => v.id === itemId);
  if (!x) return;
  if (isPad) { productZoneRows[i].pad_id = x.id; } else { productZoneRows[i].fabric_id = x.id; }
  productZoneRows[i].code = x.code;
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
    const validZones = productZoneRows.filter(z => (z.item_type === "pad" ? z.pad_id : z.fabric_id) && z.zone_name.trim());
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
      await sb.from("topstone_product_fabric_zones").insert(validZones.map((z, i) => {
        const isPad = z.item_type === "pad";
        return {
          product_id: productId, item_type: isPad ? "pad" : "fabric",
          fabric_id: isPad ? null : z.fabric_id, pad_id: isPad ? z.pad_id : null,
          fabric_code_snapshot: isPad ? "" : z.code, pad_code_snapshot: isPad ? z.code : "",
          zone_name: z.zone_name.trim(), notes: z.notes.trim(), sort_order: i,
        };
      }));
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
    <label>Zonas (telas y pads)</label>
    <div class="pfz-list">
      ${(zdata || []).map(z => {
        if (z.item_type === "pad") {
          const pd = pads.find(x => x.id === z.pad_id);
          return `<div class="pfz-item">
            <div style="width:44px;height:44px;background:#0b1219;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px">🧵</div>
            <div class="zn">${esc(z.zone_name)}</div>
            <div style="flex:1"><b>${esc(z.pad_code_snapshot)}</b> ${pd ? "— " + esc(pd.name) : ""} <span class="badge mid">Pad</span>${z.notes ? `<div class="small">${esc(z.notes)}</div>` : ""}</div>
          </div>`;
        }
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
  await loadFabricFunctions();
  await loadPads();
  await loadEyewear();
  await loadCompanyProfile();
  await loadClients();
  await loadFabrics();
  await loadProducts();
})();
