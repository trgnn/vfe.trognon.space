const body = document.querySelector("body");
const modalContainer = document.querySelector(".modal-filter");
const modalTriggers = document.querySelectorAll(".modal-filter-trigger");

modalTriggers.forEach(trigger => trigger.addEventListener("click", toggleModal))

function toggleModal(){
  modalContainer.classList.toggle("active");
  this.classList.toggle("active");
  body.classList.toggle("active");
}

document.addEventListener("keydown", e => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === "Escape" && modalContainer.classList.contains("active")) {
    modalContainer.classList.remove("active");
    body.classList.remove("active");
    modalTriggers.forEach(t => t.classList.remove("active"));
  } else if (e.key === "e" || e.key === "E") {
    modalTriggers[0].click();
  }
});