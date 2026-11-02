export default function (element) {
  requestAnimationFrame(() => {
    element.dataset.frame = "1";
  });
}
