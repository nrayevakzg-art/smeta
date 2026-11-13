"use strict";

const positions = document.querySelector("#positions");
const template = document.querySelector("#position-template");
const addButton = document.querySelector("#add-position");
const grandTotal = document.querySelector("#grand-total");

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

function parseNumber(value) {
  const normalized = value.trim().replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatMoney(value) {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  return `${moneyFormatter.format(safeValue).replace(/[\u00a0\u202f]/g, " ")} ₸`;
}

function recalculate() {
  let total = 0;
  for (const row of positions.rows) {
    const quantity = parseNumber(row.querySelector(".quantity").value);
    const price = parseNumber(row.querySelector(".price").value);
    const product = quantity * price;
    const rounded = Math.round(product * 100) / 100;
    const amount = Number.isFinite(rounded) ? rounded : 0;
    row.querySelector(".row-total").textContent = formatMoney(amount);
    total += amount;
  }
  grandTotal.textContent = formatMoney(Math.round(total * 100) / 100);
}

function addPosition(focus = true) {
  const row = template.content.firstElementChild.cloneNode(true);
  positions.append(row);
  if (focus) row.querySelector(".position-name").focus();
  return row;
}

addButton.addEventListener("click", () => addPosition());
positions.addEventListener("input", recalculate);

positions.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button");
  if (!button) return;
  const row = button.closest("tr");
  const nextRow = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  recalculate();
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

const today = new Date();
document.querySelector("#estimate-date").value = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

addPosition(false);
recalculate();
