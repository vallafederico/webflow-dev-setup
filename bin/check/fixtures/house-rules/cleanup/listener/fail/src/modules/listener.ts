export default function (element: HTMLElement) {
  const onClick = () => {
    element.dataset.clicked = "true";
  };
  element.addEventListener("click", onClick);
}
