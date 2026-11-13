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
const offerNames = ["Минимум", "Стандарт", "Полный"];
const emptyOffer = () => ({ rows: [{ name: "", quantity: "", unit: "шт", price: "" }], discount: "0", vat: "0" });
let offers = offerNames.map(emptyOffer);
let activeOffer = 0;

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

function readRows() {
  return Array.from(positions.rows, (row) => ({
    name: row.querySelector(".position-name").value,
    quantity: row.querySelector(".quantity").value,
    unit: row.querySelector(".unit").value,
    price: row.querySelector(".price").value,
  }));
}

function captureOffer() {
  offers[activeOffer] = { rows: readRows(), discount: discountInput.value, vat: vatInput.value };
}

function calculateOffer(offer) {
  const amounts = offer.rows.map((row) => {
    const amount = Math.round(parseNumber(row.quantity) * parseNumber(row.price));
    return Number.isFinite(amount) ? amount : 0;
  });
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  const total = Number.isFinite(sum) ? sum : 0;
  const discountPercent = Math.min(parseNumber(offer.discount), 100);
  const discount = Math.round(total * (discountPercent / 100));
  const discounted = total - discount;
  const vatProduct = discounted * (parseNumber(offer.vat) / 100);
  const vat = Number.isFinite(vatProduct) ? Math.round(vatProduct) : 0;
  const payable = discounted + vat;
  return { amounts, total, discount, discounted, vat, payable: Number.isFinite(payable) ? payable : 0 };
}

function recalculate() {
  if (!restoringDraft) captureOffer();
  const result = calculateOffer({ rows: readRows(), discount: discountInput.value, vat: vatInput.value });
  let rowIndex = 0;
  for (const row of positions.rows) {
    row.querySelector(".row-total").textContent = formatMoney(result.amounts[rowIndex++]);
  }
  setSummary("#subtotal", null, result.total);
  setSummary("#discount-amount", "#discount-summary", result.discount);
  setSummary("#discounted-total", "#discounted-summary", result.discounted);
  setSummary("#vat-amount", "#vat-summary", result.vat);
  grandTotal.textContent = formatMoney(result.payable);
  offers.forEach((offer, index) => {
    const payable = index === activeOffer ? result.payable : calculateOffer(offer).payable;
    document.querySelector(`#offer-total-${index}`).textContent = formatMoney(payable);
  });

  for (const mark of document.querySelectorAll(".currency-mark")) {
    mark.textContent = currencySelect.value;
  }
  for (const price of positions.querySelectorAll(".price")) {
    price.setAttribute("aria-label", `Цена, ${currencySelect.value}`);
  }
}

function showOffer(index) {
  activeOffer = index;
  const offer = offers[index];
  discountInput.value = offer.discount;
  vatInput.value = offer.vat;
  positions.replaceChildren();
  for (const saved of offer.rows) {
    const row = template.content.firstElementChild.cloneNode(true);
    for (const [key, selector] of Object.entries({ name: ".position-name", quantity: ".quantity", unit: ".unit", price: ".price" })) {
      row.querySelector(selector).value = saved[key];
    }
    positions.append(row);
  }
  document.querySelector("#positions-heading").textContent = `Позиции — ${offerNames[index]}`;
  for (const button of document.querySelectorAll("[data-offer]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.offer) === index));
  }
  recalculate();
}

function switchOffer(index) {
  captureOffer();
  showOffer(index);
  clearCopyFeedback();
  saveDraft();
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

function offerSummary(offer, result) {
  const lines = [["Сумма", result.total]];
  if (result.discount) {
    lines.push([`Скидка (${Math.min(parseNumber(offer.discount), 100)} %)`, result.discount]);
  }
  if (result.discounted) lines.push(["Сумма со скидкой", result.discounted]);
  if (result.vat) lines.push([`НДС (${parseNumber(offer.vat)} %)`, result.vat]);
  lines.push(["Итого к оплате", result.payable]);
  return lines;
}

function printElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderPrintOffers() {
  const container = document.querySelector("#print-offers");
  container.replaceChildren();
  offers.forEach((offer, index) => {
    const result = calculateOffer(offer);
    const section = printElement("section", undefined, "print-offer");
    section.append(printElement("h2", offerNames[index]));
    const table = printElement("table");
    table.setAttribute("aria-label", `Позиции — ${offerNames[index]}`);
    const head = printElement("thead");
    const headRow = printElement("tr");
    for (const title of ["Наименование", "Количество", "Единица", `Цена, ${currencySelect.value}`, "Сумма"]) {
      const th = printElement("th", title);
      th.setAttribute("scope", "col");
      headRow.append(th);
    }
    head.append(headRow);
    const body = printElement("tbody");
    offer.rows.forEach((row, rowIndex) => {
      if (!row.name.trim() && !row.quantity.trim() && !row.price.trim()) return;
      const tr = printElement("tr");
      const values = [row.name.trim() || "Без наименования", String(parseNumber(row.quantity)).replace(".", ","), row.unit,
        moneyFormatter.format(parseNumber(row.price)).replace(/[\u00a0\u202f]/g, " "), formatMoney(result.amounts[rowIndex])];
      values.forEach((value, column) => tr.append(printElement("td", value, column >= 3 ? "row-total-cell" : "")));
      body.append(tr);
    });
    if (body.children.length) {
      table.append(head, body);
      section.append(table);
    } else {
      section.append(printElement("p", "Позиции не добавлены"));
    }
    const summary = printElement("dl", undefined, "summary-list");
    const lines = offerSummary(offer, result);
    lines.forEach(([title, amount], lineIndex) => {
      const line = printElement("div", undefined, lineIndex === lines.length - 1 ? "print-payable" : "");
      line.append(printElement("dt", title), printElement("dd", formatMoney(amount)));
      summary.append(line);
    });
    section.append(summary);
    container.append(section);
  });
}

function preparePrint() {
  recalculate();
  renderPrintOffers();
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
  captureOffer();
  const fields = {};
  for (const [key, selector] of Object.entries(draftFields)) {
    fields[key] = document.querySelector(selector).value;
  }
  const rows = readRows();
  try {
    localStorage.setItem(storageKey, JSON.stringify({ fields, rows, offers, activeOffer }));
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
    if (!validRows(saved.rows)) return false;
    if (saved.offers !== undefined && (!Array.isArray(saved.offers) || saved.offers.length !== 3 || !saved.offers.every((offer) => offer && validRows(offer.rows) && typeof offer.discount === "string" && typeof offer.vat === "string"))) return false;
    for (const [key, selector] of Object.entries(draftFields)) {
      document.querySelector(selector).value = saved.fields[key];
    }
    // Старый черновик становится предложением «Минимум» без потери полей и строк.
    offers = saved.offers || [{ rows: saved.rows, discount: saved.fields.discount, vat: saved.fields.vat }, emptyOffer(), emptyOffer()];
    showOffer(Number.isInteger(saved.activeOffer) && saved.activeOffer >= 0 && saved.activeOffer < 3 ? saved.activeOffer : 0);
    return true;
  } catch {
    return false;
  }
}

function validRows(rows) {
  return Array.isArray(rows) && rows.every((row) => row && ["name", "quantity", "unit", "price"].every((key) => typeof row[key] === "string") && ["шт", "час", "услуга"].includes(row.unit));
}

function clearCopyFeedback() {
  clearTimeout(copyStatusTimer);
  document.querySelector("#copy-status").textContent = "";
  document.querySelector("#manual-copy").hidden = true;
  document.querySelector("#share-text").value = "";
}

function newEstimate() {
  if (!window.confirm("Создать новую смету? Все 3 предложения текущего черновика будут очищены.")) return;
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
  offers = offerNames.map(emptyOffer);
  showOffer(0);
  positions.querySelector(".position-name").focus();
  clearCopyFeedback();
  for (const value of document.querySelectorAll(".print-value")) value.remove();
  document.querySelector("#print-title").textContent = "";
  document.querySelector("#print-offers").replaceChildren();
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
  offers.forEach((offer, index) => {
    const result = calculateOffer(offer);
    lines.push(offerNames[index]);
    offer.rows.forEach((row, rowIndex) => {
      if (!row.name.trim() && !row.quantity.trim() && !row.price.trim()) return;
      const quantity = String(parseNumber(row.quantity)).replace(".", ",");
      lines.push(`• ${row.name.trim() || "Без наименования"} — ${quantity} ${row.unit} × ${formatMoney(parseNumber(row.price))} = ${formatMoney(result.amounts[rowIndex])}`);
    });
    if (!offer.rows.some((row) => row.name.trim() || row.quantity.trim() || row.price.trim())) lines.push("Позиции не добавлены");
    lines.push(...offerSummary(offer, result).map(([title, amount]) => `${title}: ${formatMoney(amount)}`), "");
  });
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
for (const button of document.querySelectorAll("[data-offer]")) {
  button.addEventListener("click", () => switchOffer(Number(button.dataset.offer)));
}

if (!restoreDraft()) {
  document.querySelector("#estimate-date").value = todayValue();
  showOffer(0);
}
restoringDraft = false;
recalculate();
saveDraft();
