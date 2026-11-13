"use strict";

const positions = document.querySelector("#positions");
const template = document.querySelector("#position-template");
const addButton = document.querySelector("#add-position");
const grandTotal = document.querySelector("#grand-total");
const discountInput = document.querySelector("#discount-percent");
const vatInput = document.querySelector("#vat-percent");
const currencySelect = document.querySelector("#currency");
const exchangeInput = document.querySelector("#exchange-rate");
const currencies = ["₸", "$", "€", "₽"];
let baseCurrency = "₸";
let appliedCurrency = "₸";
let exchangeRates = { "₸": "1" };
let exchangeDrafts = { "₸": "1" };
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
  return `${moneyFormatter.format(safeValue).replace(/[\u00a0\u202f]/g, " ")} ${appliedCurrency}`;
}

function setSummary(outputId, rowId, amount) {
  document.querySelector(outputId).textContent = formatMoney(amount);
  if (rowId) document.querySelector(rowId).hidden = amount === 0;
}

function readRows() {
  return Array.from(positions.rows, (row) => {
    const price = row.querySelector(".price").value;
    if (row.dataset.displayPrice !== price || row.dataset.basePrice === undefined) {
      const base = parseNumber(price) * parseNumber(exchangeRates[appliedCurrency]);
      row.dataset.basePrice = String(Number.isFinite(base) ? base : 0);
      row.dataset.displayPrice = price;
    }
    return {
      name: row.querySelector(".position-name").value,
      quantity: row.querySelector(".quantity").value,
      unit: row.querySelector(".unit").value,
      price,
      basePrice: Number(row.dataset.basePrice),
    };
  });
}

function updateExchangeUI(message = "") {
  const selected = currencySelect.value;
  const isBase = selected === baseCurrency;
  document.querySelector("#exchange-controls").hidden = isBase;
  exchangeInput.disabled = isBase;
  document.querySelector("#exchange-label").textContent = `Курс вручную: 1 ${selected} = сколько ${baseCurrency}?`;
  exchangeInput.setAttribute("aria-invalid", String(!isBase && parseNumber(exchangeInput.value) <= 0));
  document.querySelector("#exchange-status").textContent = message;
  const note = appliedCurrency === baseCurrency ? "" : `Курс: 1 ${appliedCurrency} = ${exchangeRates[appliedCurrency]} ${baseCurrency} (введён вручную).`;
  document.querySelector("#exchange-note").textContent = note;
}

function applyExchangeRate() {
  const selected = currencySelect.value;
  if (!currencies.includes(selected)) return;
  const rawRate = selected === baseCurrency ? "1" : exchangeInput.value;
  exchangeDrafts[selected] = rawRate;
  const rate = parseNumber(rawRate);
  if (rate <= 0) {
    updateExchangeUI(`Введи курс больше 0. Суммы пока остаются в ${appliedCurrency}.`);
    saveDraft();
    return;
  }
  captureOffer();
  // Исходные цены хранятся отдельно: повторная конвертация не накапливает округление.
  const converted = offers.map((offer) => ({
    ...offer,
    rows: offer.rows.map((row) => {
      const basePrice = Number.isFinite(row.basePrice) ? row.basePrice : parseNumber(row.price) * parseNumber(exchangeRates[appliedCurrency]);
      return { ...row, basePrice, convertedPrice: basePrice / rate };
    }),
  }));
  if (converted.some((offer) => offer.rows.some((row) => !Number.isFinite(row.convertedPrice)))) {
    updateExchangeUI("Не удалось пересчитать цены: проверь величину курса.");
    saveDraft();
    return;
  }
  const priceFormatter = new Intl.NumberFormat("ru-RU", { useGrouping: false, maximumFractionDigits: 12 });
  offers = converted.map((offer) => ({
    ...offer,
    rows: offer.rows.map(({ convertedPrice, ...row }) => ({
      ...row,
      price: row.price.trim() === "" ? "" : priceFormatter.format(convertedPrice),
    })),
  }));
  exchangeRates[selected] = rawRate;
  appliedCurrency = selected;
  showOffer(activeOffer);
  updateExchangeUI();
  clearCopyFeedback();
  saveDraft();
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
    mark.textContent = appliedCurrency;
  }
  for (const price of positions.querySelectorAll(".price")) {
    price.setAttribute("aria-label", `Цена, ${appliedCurrency}`);
  }
  renderComparison();
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
    if (Number.isFinite(saved.basePrice)) {
      row.dataset.basePrice = String(saved.basePrice);
      row.dataset.displayPrice = saved.price;
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
currencySelect.addEventListener("change", () => {
  exchangeInput.value = exchangeDrafts[currencySelect.value] ?? "";
  applyExchangeRate();
});
exchangeInput.addEventListener("input", applyExchangeRate);

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

function comparisonData() {
  const entries = new Map();
  const results = offers.map(calculateOffer);
  offers.forEach((offer, offerIndex) => {
    offer.rows.forEach((row, rowIndex) => {
      if (!row.name.trim() && !row.quantity.trim() && !row.price.trim()) return;
      const name = row.name.trim().replace(/\s+/g, " ");
      // Сравниваем только одинаковые названия и единицы; безымянные строки не объединяем.
      const key = name ? JSON.stringify([name.toLocaleLowerCase("ru"), row.unit]) : `unnamed:${offerIndex}:${rowIndex}`;
      if (!entries.has(key)) entries.set(key, { name: name || "Без наименования", cells: [null, null, null] });
      const entry = entries.get(key);
      const cell = entry.cells[offerIndex] || { quantity: 0, amount: 0, unit: row.unit };
      const quantity = cell.quantity + parseNumber(row.quantity);
      const amount = cell.amount + results[offerIndex].amounts[rowIndex];
      cell.quantity = Number.isFinite(quantity) ? quantity : 0;
      cell.amount = Number.isFinite(amount) ? amount : 0;
      entry.cells[offerIndex] = cell;
    });
  });
  return { entries: Array.from(entries.values()), results };
}

function renderComparison() {
  const { entries, results } = comparisonData();
  const table = printElement("table", undefined, "comparison-table");
  table.setAttribute("aria-labelledby", "comparison-heading");
  const head = printElement("thead");
  const header = printElement("tr");
  for (const title of ["Что входит", ...offerNames]) {
    const th = printElement("th", title);
    th.setAttribute("scope", "col");
    header.append(th);
  }
  head.append(header);
  const body = printElement("tbody");
  for (const entry of entries) {
    const row = printElement("tr");
    const name = printElement("th", entry.name);
    name.setAttribute("scope", "row");
    row.append(name);
    for (const cell of entry.cells) {
      const td = printElement("td");
      if (cell) {
        const quantity = String(Number(cell.quantity.toPrecision(12))).replace(".", ",");
        td.append(printElement("span", `${quantity} ${cell.unit}`, "comparison-quantity"),
          printElement("span", formatMoney(cell.amount), "comparison-amount"));
      } else {
        td.textContent = "—";
        td.className = "comparison-missing";
        td.setAttribute("aria-label", "Не входит");
      }
      row.append(td);
    }
    body.append(row);
  }
  if (!entries.length) {
    const row = printElement("tr");
    const td = printElement("td", "Добавь позиции в предложения — здесь появится сравнение.");
    td.setAttribute("colspan", "4");
    row.append(td);
    body.append(row);
  }
  const foot = printElement("tfoot");
  const summaries = [["Сумма", "total"]];
  if (results.some((result) => result.discount)) {
    summaries.push(["Скидка", "discount"], ["Сумма со скидкой", "discounted"]);
  }
  if (results.some((result) => result.vat)) summaries.push(["НДС", "vat"]);
  summaries.push(["Итого к оплате", "payable"]);
  for (const [title, key] of summaries) {
    const row = printElement("tr", undefined, key === "payable" ? "comparison-payable" : "");
    const label = printElement("th", title);
    label.setAttribute("scope", "row");
    row.append(label);
    results.forEach((result) => row.append(printElement("td", formatMoney(result[key]))));
    foot.append(row);
  }
  table.append(head, body, foot);
  document.querySelector("#comparison").replaceChildren(table);
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
    for (const title of ["Наименование", "Количество", "Единица", `Цена, ${appliedCurrency}`, "Сумма"]) {
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
    const exchange = { baseCurrency, appliedCurrency, rates: exchangeRates, drafts: exchangeDrafts };
    localStorage.setItem(storageKey, JSON.stringify({ fields, rows, offers, activeOffer, exchange }));
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
    // У старого черновика исходная валюта — та, в которой пользователь уже ввёл цены.
    baseCurrency = saved.fields.currency;
    appliedCurrency = baseCurrency;
    exchangeRates = { [baseCurrency]: "1" };
    exchangeDrafts = { [baseCurrency]: "1" };
    if (validExchange(saved.exchange)) {
      baseCurrency = saved.exchange.baseCurrency;
      appliedCurrency = saved.exchange.appliedCurrency;
      exchangeRates = { ...saved.exchange.rates, [baseCurrency]: "1" };
      exchangeDrafts = { ...saved.exchange.drafts, [baseCurrency]: "1" };
    }
    // Фиксируем исходную стоимость также у неактивных предложений старого черновика.
    offers.forEach((offer) => offer.rows.forEach((row) => {
      if (!Number.isFinite(row.basePrice)) {
        const base = parseNumber(row.price) * parseNumber(exchangeRates[appliedCurrency]);
        row.basePrice = Number.isFinite(base) ? base : 0;
      }
    }));
    exchangeInput.value = exchangeDrafts[currencySelect.value] ?? "";
    const pending = currencySelect.value !== appliedCurrency || (currencySelect.value !== baseCurrency && parseNumber(exchangeInput.value) <= 0);
    updateExchangeUI(pending ? `Введи курс больше 0. Суммы пока остаются в ${appliedCurrency}.` : "");
    showOffer(Number.isInteger(saved.activeOffer) && saved.activeOffer >= 0 && saved.activeOffer < 3 ? saved.activeOffer : 0);
    return true;
  } catch {
    return false;
  }
}

function validRows(rows) {
  return Array.isArray(rows) && rows.every((row) => row && ["name", "quantity", "unit", "price"].every((key) => typeof row[key] === "string") && ["шт", "час", "услуга"].includes(row.unit) && (row.basePrice === undefined || (Number.isFinite(row.basePrice) && row.basePrice >= 0)));
}

function validExchange(exchange) {
  return exchange && currencies.includes(exchange.baseCurrency) && currencies.includes(exchange.appliedCurrency)
    && exchange.rates && exchange.drafts
    && Object.entries(exchange.rates).every(([key, value]) => currencies.includes(key) && typeof value === "string" && parseNumber(value) > 0)
    && parseNumber(exchange.rates[exchange.appliedCurrency] || "") > 0
    && Object.entries(exchange.drafts).every(([key, value]) => currencies.includes(key) && typeof value === "string");
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
  baseCurrency = "₸";
  appliedCurrency = "₸";
  exchangeRates = { "₸": "1" };
  exchangeDrafts = { "₸": "1" };
  exchangeInput.value = "1";
  updateExchangeUI();
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
  const exchangeNote = document.querySelector("#exchange-note").textContent;
  if (exchangeNote) lines.push(exchangeNote);
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
  exchangeInput.value = "1";
  updateExchangeUI();
  showOffer(0);
}
restoringDraft = false;
recalculate();
saveDraft();
