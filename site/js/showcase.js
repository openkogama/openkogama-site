const showcase = document.querySelector(".showcase");
const track = showcase.querySelector(".track");
const videos = track.querySelectorAll("iframe");
const prev = showcase.querySelector(".prev");
const next = showcase.querySelector(".next");
const dots = [...videos].map((video, i) => {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.setAttribute("aria-label", video.title);
  dot.addEventListener("click", () => show(i));
  showcase.querySelector(".dots").append(dot);
  return dot;
});
let current = 0;

function show(i) {
  current = Math.max(0, Math.min(videos.length - 1, i));
  track.style.transform = `translateX(${-100 * current}%)`;
  prev.disabled = current === 0;
  next.disabled = current === videos.length - 1;
  dots.forEach((dot, j) => dot.setAttribute("aria-current", j === current));
}

prev.addEventListener("click", () => show(current - 1));
next.addEventListener("click", () => show(current + 1));
show(0);
i18n.ready.then(() => dots.forEach((dot, i) => dot.setAttribute("aria-label", videos[i].title)));
