/** Caption above a form field; also its accessible name. Placed as the field's previous sibling. */
export function createFormFieldLabel(
  doc: Document,
  className: string,
  text: string,
  field: HTMLElement
): HTMLElement {
  const label = doc.createElement('div')
  label.className = className
  label.textContent = text
  field.setAttribute('aria-label', text)
  return label
}
