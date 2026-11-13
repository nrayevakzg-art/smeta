"use strict";

const positions = document.querySelector("#positions");
const template = document.querySelector("#position-template");
const addButton = document.querySelector("#add-position");
const grandTotal = document.querySelector("#grand-total");
const discountInput = document.querySelector("#discount-percent");
const vatInput = document.querySelector("#vat-percent");
const currencySelect = document.querySelector("#currency");
const storageKey = "smeta-draft-v1";
const draftFields = {
  sender: '[name="sender"]',
  recipient: '[name="recipient"]',
  number: '[name="estimate-number"]',
  date: "#estimate-date",
  discount: "#discount-percent",
  vat: "#vat-percent",
  currency: "#currency",
  comment: "#comment",
};
let restoringDraft = true;
let copyStatusTimer;

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

function parseNumber(value) {
  const normalized = value.trim().replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatMoney(value) {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  return `${moneyFormatter.format(safeValue).replace(/[\u00a0\u202f]/g, " ")} ${currencySelect.value}`;
}

function setSummary(outputId, rowId, amount) {
  document.querySelector(outputId).textContent = formatMoney(amount);
  if (rowId) document.querySelector(rowId).hidden = amount === 0;
}

function recalculate() {
  let total = 0;
  for (const row of positions.rows) {
    const quantity = parseNumber(row.querySelector(".quantity").value);
    const price = parseNumber(row.querySelector(".price").value);
    const product = quantity * price;
    const rounded = Math.round(product);
    const amount = Number.isFinite(rounded) ? rounded : 0;
    row.querySelector(".row-total").textContent = formatMoney(amount);
    total += amount;
  }
  if (!Number.isFinite(total)) total = 0;
  const discountPercent = Math.min(parseNumber(discountInput.value), 100);
  const discount = Math.round(total * (discountPercent / 100));
  const discounted = total - discount;
  const vatProduct = discounted * (parseNumber(vatInput.value) / 100);
  const vat = Number.isFinite(vatProduct) ? Math.round(vatProduct) : 0;
  setSummary("#subtotal", null, total);
  setSummary("#discount-amount", "#discount-summary", discount);
  setSummary("#discounted-total", "#discounted-summary", discounted);
  setSummary("#vat-amount", "#vat-summary", vat);
  grandTotal.textContent = formatMoney(discounted + vat);

  for (const mark of document.querySelectorAll(".currency-mark")) {
    mark.textContent = currencySelect.value;
  }
  for (const price of positions.querySelectorAll(".price")) {
    price.setAttribute("aria-label", `Цена, ${currencySelect.value}`);
  }
}

function addPosition(focus = true) {
  const row = template.content.firstElementChild.cloneNode(true);
  positions.append(row);
  recalculate();
  if (focus) row.querySelector(".position-name").focus();
  saveDraft();
  return row;
}

addButton.addEventListener("click", () => addPosition());
positions.addEventListener("input", recalculate);
discountInput.addEventListener("input", recalculate);
vatInput.addEventListener("input", recalculate);
currencySelect.addEventListener("change", recalculate);

positions.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button");
  if (!button) return;
  const row = button.closest("tr");
  const nextRow = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  recalculate();
  saveDraft();
  if (nextRow) nextRow.querySelector(".position-name").focus();
  else addButton.focus();
});

positions.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || event.repeat) return;
  if (!event.target.matches("input")) return;
  if (event.target.closest("tr") !== positions.lastElementChild) return;
  event.preventDefault();
  addPosition();
});

function preparePrint() {
  recalculate();
  const number = document.querySelector('[name="estimate-number"]').value.trim() || "—";
  const date = document.querySelector("#estimate-date").value;
  const formattedDate = date ? date.split("-").reverse().join(".") : "—";
  document.querySelector("#print-title").textContent = `Смета № ${number} от ${formattedDate}`;

  // Обычный текст печатается целиком, даже если он не помещается в поле ввода.
  for (const previous of document.querySelectorAll(".print-value")) previous.remove();
  for (const field of document.querySelectorAll(".details-grid input, .position-row input, .position-row select, #comment")) {
    const value = document.createElement("span");
    value.className = "print-value";
    if (field.matches(".price")) {
      value.textContent = moneyFormatter.format(parseNumber(field.value)).replace(/[\u00a0\u202f]/g, " ");
    } else if (field.matches(".quantity")) {
      value.textContent = String(parseNumber(field.value)).replace(".", ",");
    } else if (field.type === "date") {
      value.textContent = formattedDate;
    } else {
      value.textContent = field.value.trim();
    }
    field.after(value);
  }
}

document.querySelector("#save-pdf").addEventListener("click", () => {
  preparePrint();
  window.print();
});
window.addEventListener("beforeprint", preparePrint);

function todayValue() {
  const today = new Date();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")].join("-");
}

function saveDraft() {
  if (restoringDraft) return;
  const fields = {};
  for (const [key, selector] of Object.entries(draftFields)) {
    fields[key] = document.querySelector(selector).value;
  }
  const rows = Array.from(positions.rows, (row) => ({
    name: row.querySelector(".position-name").value,
    quantity: row.querySelector(".quantity").value,
    unit: row.querySelector(".unit").value,
    price: row.querySelector(".price").value,
  }));
  try {
    localStorage.setItem(storageKey, JSON.stringify({ fields, rows }));
    document.querySelector("#storage-status").textContent = "";
  } catch {
    document.querySelector("#storage-status").textContent = "Браузер не смог сохранить черновик. Сохрани смету в PDF или скопируй текст.";
  }
}

function restoreDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !saved.fields || !Array.isArray(saved.rows)) return false;
    if (!Object.keys(draftFields).every((key) => typeof saved.fields[key] === "string")) return false;
    if (!["₸", "₽", "$", "€"].includes(saved.fields.currency)) return false;
    if (!saved.rows.every((row) => row && ["name", "quantity", "unit", "price"].every((key) => typeof row[key] === "string") && ["шт", "час", "услуга"].includes(row.unit))) return false;
    for (const [key, selector] of Object.entries(draftFields)) {
      document.querySelector(selector).value = saved.fields[key];
    }
    for (const savedRow of saved.rows) {
      const row = addPosition(false);
      row.querySelector(".position-name").value = savedRow.name;
      row.querySelector(".quantity").value = savedRow.quantity;
      row.querySelector(".unit").value = savedRow.unit;
      row.querySelector(".price").value = savedRow.price;
    }
    return true;
  } catch {
    return false;
  }
}

function clearCopyFeedback() {
  clearTimeout(copyStatusTimer);
  document.querySelector("#copy-status").textContent = "";
  document.querySelector("#manual-copy").hidden = true;
  document.querySelector("#share-text").value = "";
}

function newEstimate() {
  if (!window.confirm("Создать новую смету? Текущий черновик будет очищен.")) return;
  const currentNumber = document.querySelector(draftFields.number).value.trim();
  const match = currentNumber.match(/^(\D*)(\d+)(\D*)$/);
  const nextNumber = match
    ? `${match[1]}${String(BigInt(match[2]) + 1n).padStart(match[2].length, "0")}${match[3]}`
    : "1";
  restoringDraft = true;
  for (const selector of Object.values(draftFields)) document.querySelector(selector).value = "";
  document.querySelector(draftFields.number).value = nextNumber;
  document.querySelector(draftFields.date).value = todayValue();
  discountInput.value = "0";
  vatInput.value = "0";
  currencySelect.value = "₸";
  positions.replaceChildren();
  addPosition();
  clearCopyFeedback();
  for (const value of document.querySelectorAll(".print-value")) value.remove();
  document.querySelector("#print-title").textContent = "";
  restoringDraft = false;
  saveDraft();
}

function buildShareText() {
  recalculate();
  const number = document.querySelector(draftFields.number).value.trim() || "—";
  const date = document.querySelector(draftFields.date).value;
  const lines = [`Смета № ${number} от ${date ? date.split("-").reverse().join(".") : "—"}`];
  for (const [key, title] of [["sender", "От кого"], ["recipient", "Для кого"]]) {
    const value = document.querySelector(draftFields[key]).value.trim();
    if (value) lines.push(`${title}: ${value}`);
  }
  lines.push("");
  for (const row of positions.rows) {
    const name = row.querySelector(".position-name").value.trim() || "Без наименования";
    const quantity = String(parseNumber(row.querySelector(".quantity").value)).replace(".", ",");
    const unit = row.querySelector(".unit").value;
    const price = formatMoney(parseNumber(row.querySelector(".price").value));
    lines.push(`• ${name} — ${quantity} ${unit} × ${price} = ${row.querySelector(".row-total").textContent}`);
  }
  lines.push("", `Сумма: ${document.querySelector("#subtotal").textContent}`);
  if (!document.querySelector("#discount-summary").hidden) {
    lines.push(`Скидка (${Math.min(parseNumber(discountInput.value), 100)} %): ${document.querySelector("#discount-amount").textContent}`);
    lines.push(`Сумма со скидкой: ${document.querySelector("#discounted-total").textContent}`);
  }
  if (!document.querySelector("#vat-summary").hidden) {
    lines.push(`НДС (${parseNumber(vatInput.value)} %): ${document.querySelector("#vat-amount").textContent}`);
  }
  lines.push(`Итого к оплате: ${grandTotal.textContent}`);
  const comment = document.querySelector("#comment").value.trim();
  if (comment) lines.push("", comment);
  return lines.join("\n");
}

async function copyForWhatsApp() {
  clearCopyFeedback();
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    document.querySelector("#copy-status").textContent = "Скопировано ✓";
    copyStatusTimer = setTimeout(() => {
      document.querySelector("#copy-status").textContent = "";
    }, 2000);
  } catch {
    const field = document.querySelector("#share-text");
    field.value = text;
    document.querySelector("#manual-copy").hidden = false;
    field.focus();
    field.select();
  }
}

document.querySelector("main").addEventListener("input", (event) => {
  if (event.target.matches("input, select, textarea:not([readonly])")) saveDraft();
});
document.querySelector("main").addEventListener("change", (event) => {
  if (event.target.matches("input, select, textarea:not([readonly])")) saveDraft();
});
document.querySelector("#new-estimate").addEventListener("click", newEstimate);
document.querySelector("#copy-whatsapp").addEventListener("click", copyForWhatsApp);

if (!restoreDraft()) {
  document.querySelector("#estimate-date").value = todayValue();
  addPosition(false);
}
restoringDraft = false;
recalculate();
saveDraft();
