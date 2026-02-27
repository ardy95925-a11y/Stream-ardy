
// ============ TOAST ============

export function showToast(message, duration = 3000) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============ MODAL ============

const overlay = document.getElementById("modal-overlay");
const modalBox = document.getElementById("modal-box");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");

export function openModal(title, bodyHTML) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;
  overlay.classList.remove("hidden");
  // Focus first input if available
  setTimeout(() => {
    const firstInput = modalBody.querySelector("input");
    if (firstInput) firstInput.focus();
  }, 50);
}

export function closeModal() {
  overlay.classList.add("hidden");
  modalBody.innerHTML = "";
}

modalClose.addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
