const countEl = document.getElementById("count");
const clicker = document.getElementById("clicker");
const copied = document.getElementById("copied");
const checklist = document.getElementById("checklist");

let clicks = Number(localStorage.getItem("bench-clicks") || 0);
countEl.textContent = String(clicks);

clicker.addEventListener("click", () => {
  clicks += 1;
  countEl.textContent = String(clicks);
  localStorage.setItem("bench-clicks", String(clicks));
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", async () => {
    const prompt = button.getAttribute("data-prompt");
    try {
      await navigator.clipboard.writeText(prompt);
      copied.hidden = false;
      copied.textContent = "Prompt copied. Paste it into Cursor chat.";
    } catch {
      copied.hidden = false;
      copied.textContent = prompt;
    }
  });
});

const tasks = [
  "Ask Agent to change the headline on this page.",
  "Select a paragraph, press Cmd+K, and rewrite it in one sentence.",
  "Type @styles.css in chat and ask what the terracotta color is used for.",
  "Switch to Ask mode and have it explain script.js without editing.",
  "Add a footer link to cursor.com/docs.",
];

const saved = JSON.parse(localStorage.getItem("cursor-tasks") || "{}");

tasks.forEach((task, index) => {
  const item = document.createElement("li");
  const box = document.createElement("input");
  const label = document.createElement("label");
  const id = `task-${index}`;

  box.type = "checkbox";
  box.id = id;
  box.checked = Boolean(saved[id]);
  label.htmlFor = id;
  label.textContent = task;

  box.addEventListener("change", () => {
    saved[id] = box.checked;
    localStorage.setItem("cursor-tasks", JSON.stringify(saved));
  });

  item.append(box, label);
  checklist.append(item);
});
